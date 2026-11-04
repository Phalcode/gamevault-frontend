//! Frontend responsiveness watchdog.
//!
//! The UI runs in its own webview process. When it hangs it cannot write a log
//! line itself, which is why a freeze otherwise leaves no trace at all. This
//! module runs entirely on the Rust side — which stays responsive during a UI
//! freeze — and records what the frontend was doing when it stopped answering.
//!
//! The frontend posts a small heartbeat every couple of seconds containing its
//! current route, the longest main-thread block since the previous heartbeat,
//! the JS heap size, the DOM size and the most recent breadcrumbs. A background
//! thread watches for a missing heartbeat and writes the last known state to the
//! regular app log twice: once when the freeze is detected and once when the
//! frontend comes back, including the total silence duration. That way a hang
//! leaves a timeline (how long, where, with what on screen) instead of silence.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Manager;

/// Log file name (without extension) written by `tauri_plugin_log` in the app
/// log directory. Kept here so the reported path matches what the logger uses.
pub(crate) const LOG_FILE_NAME: &str = "gamevault-frontend";

/// How often the frontend is expected to check in.
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(2);
/// A visible frontend that has not checked in for this long is treated as hung.
/// Deliberately generous: a busy machine or a long GC pause can delay timers.
const HANG_THRESHOLD: Duration = Duration::from_secs(8);
/// While still hung, re-log the last known state at most this often.
const HANG_REPEAT: Duration = Duration::from_secs(20);
/// How long a visible frontend must stay silent before the watchdog reloads the
/// webview to recover it. Deliberately longer than [`HANG_THRESHOLD`] so a
/// legitimately long synchronous task is not torn down.
const RECOVERY_AFTER: Duration = Duration::from_secs(25);
/// Build marker stamped into every watchdog log line.
///
/// Bumped whenever the watchdog's logging or behaviour changes, so any log line
/// (or excerpt) can be traced back to the build that produced it.
/// `wd1` = heartbeat + periodic snapshot + hang detection only.
/// `wd2` = adds the process/CPU snapshot, the Rust main-thread probe and the
/// automatic recovery reload.
/// `wd3` = adds the fix for the actual cause: the I/O-heavy commands no longer
/// run on the main thread (event loop), which is what froze the UI.
const BUILD_MARKER: &str = "wd3";

/// How long the main-thread liveness probe waits before declaring the event
/// loop blocked.
const MAIN_THREAD_PROBE_TIMEOUT: Duration = Duration::from_secs(5);
/// How many watchdog cycles between periodic "frontend alive" snapshots.
/// With a 2 s cycle this is one line per minute, which gives a memory/DOM
/// timeline without drowning the log.
const ALIVE_LOG_EVERY: u64 = 30;
/// How many breadcrumbs to include when reporting a hang.
const REPORT_BREADCRUMBS: usize = 15;

/// One heartbeat from the webview.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FrontendStatusPayload {
  /// `visible` or `hidden`.
  #[serde(default)]
  pub visibility: String,
  /// Current router path, e.g. `/library/12`.
  #[serde(default)]
  pub route: String,
  /// Monotonic heartbeat counter, so a report can spot missing check-ins.
  #[serde(default)]
  pub seq: u64,
  /// Longest main-thread block observed since the previous heartbeat (ms).
  #[serde(default)]
  pub max_lag_ms: u64,
  #[serde(default)]
  pub heap_used_mb: Option<f64>,
  #[serde(default)]
  pub heap_total_mb: Option<f64>,
  #[serde(default)]
  pub dom_nodes: Option<u64>,
  #[serde(default)]
  pub img_count: Option<u64>,
  /// Recent breadcrumbs, oldest first.
  #[serde(default)]
  pub breadcrumbs: Vec<String>,
}

struct LastStatus {
  received: Instant,
  payload: FrontendStatusPayload,
}

/// A detected freeze; keeps the pre-freeze state for the recovery log.
struct FrozenState {
  /// Timestamp of the last heartbeat — i.e. when the silence began.
  since: Instant,
  payload: FrontendStatusPayload,
  last_log: Instant,
  /// Whether the self-heal reload has already been attempted.
  recovery_attempted: bool,
}

static LAST_STATUS: OnceLock<Mutex<Option<LastStatus>>> = OnceLock::new();

/// Whether the periodic interface snapshot is written to the app log.
///
/// Off by default and toggled by the "Verbose diagnostics logging" Developer
/// Tools setting: the snapshot is only useful when someone is actively hunting
/// a bug, and it costs a log line per minute for everyone else. Hang detection,
/// the hang report and the automatic recovery reload are always active.
static VERBOSE: AtomicBool = AtomicBool::new(false);

/// Enables or disables the periodic snapshot logging.
pub(crate) fn set_verbose(enabled: bool) {
  VERBOSE.store(enabled, Ordering::Relaxed);
}

fn last_status() -> &'static Mutex<Option<LastStatus>> {
  LAST_STATUS.get_or_init(|| Mutex::new(None))
}

/// Records a heartbeat from the webview. Called frequently; must stay cheap.
#[tauri::command]
pub(crate) fn frontend_heartbeat(status: FrontendStatusPayload) {
  // A decreasing sequence number means the JS context restarted: a titlebar
  // Refresh/F5, a navigation, or WebView2 recovering from a renderer crash.
  // Logging it makes an otherwise invisible reload visible in the timeline.
  let reloaded_from = match last_status().lock() {
    Ok(guard) => guard
      .as_ref()
      .filter(|previous| status.seq < previous.payload.seq)
      .map(|previous| previous.payload.seq),
    Err(_) => None,
  };
  if let Some(previous_seq) = reloaded_from {
    log::info!(
      "[watchdog] frontend page (re)loaded at {} (heartbeat sequence reset {previous_seq} -> {})",
      if status.route.is_empty() {
        "?"
      } else {
        &status.route
      },
      status.seq
    );
  }

  if let Ok(mut guard) = last_status().lock() {
    *guard = Some(LastStatus {
      received: Instant::now(),
      payload: status,
    });
  }
}

/// Absolute path of the app log file, so a bug report can point at it.
#[tauri::command]
pub(crate) fn get_diagnostics_log_path(app: tauri::AppHandle) -> Option<String> {
  app
    .path()
    .app_log_dir()
    .ok()
    .map(|dir| {
      dir
        .join(format!("{LOG_FILE_NAME}.log"))
        .to_string_lossy()
        .to_string()
    })
}

/// Human-readable one-line summary of a heartbeat.
fn describe(payload: &FrontendStatusPayload) -> String {
  let route = if payload.route.is_empty() {
    "?".to_string()
  } else {
    payload.route.clone()
  };
  let visibility = if payload.visibility.is_empty() {
    "?".to_string()
  } else {
    payload.visibility.clone()
  };

  let mut parts = vec![
    format!("build={BUILD_MARKER}"),
    format!("route={route}"),
    format!("visibility={visibility}"),
    format!("seq={}", payload.seq),
    format!("maxLagMs={}", payload.max_lag_ms),
  ];

  if let Some(used) = payload.heap_used_mb {
    match payload.heap_total_mb {
      Some(total) => parts.push(format!("heap={used:.0}/{total:.0}MB")),
      None => parts.push(format!("heap={used:.0}MB")),
    }
  }
  if let Some(nodes) = payload.dom_nodes {
    parts.push(format!("domNodes={nodes}"));
  }
  if let Some(images) = payload.img_count {
    parts.push(format!("imgs={images}"));
  }

  let mut report = parts.join(" ");
  if !payload.breadcrumbs.is_empty() {
    let start = payload.breadcrumbs.len().saturating_sub(REPORT_BREADCRUMBS);
    report.push_str(" | breadcrumbs: ");
    report.push_str(&payload.breadcrumbs[start..].join(" ; "));
  }
  report
}

/// Logs a process-level snapshot when a hang is detected.
///
/// The decisive question once the webview stops answering is whether its
/// renderer is *spinning* (a JavaScript/layout loop pegging a CPU core) or
/// *blocked* (near-idle CPU, e.g. waiting on the GPU/driver). CPU usage is a
/// per-process delta, so the watchdog samples the process list twice with a
/// short gap before reading it.
fn log_process_snapshot() {
  use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};

  let kind = ProcessRefreshKind::nothing().with_cpu().with_memory();
  let mut system = System::new();
  system.refresh_processes_specifics(ProcessesToUpdate::All, true, kind);
  std::thread::sleep(Duration::from_millis(600));
  system.refresh_processes_specifics(ProcessesToUpdate::All, true, kind);

  let own_pid = sysinfo::Pid::from_u32(std::process::id());
  let mut webview: Vec<String> = Vec::new();
  let mut by_cpu: Vec<(f32, String)> = Vec::new();

  for (pid, process) in system.processes() {
    let name = process.name().to_string_lossy().to_string();
    let lower = name.to_ascii_lowercase();
    let cpu = process.cpu_usage();
    let memory_mb = process.memory() as f64 / 1_048_576.0;
    let entry = format!(
      "{name}(pid {}, cpu {cpu:.0}%, mem {memory_mb:.0}MB)",
      pid.as_u32()
    );

    if *pid == own_pid
      || lower.contains("webview")
      || lower.contains("webkit")
      || lower.contains("gamevault")
    {
      webview.push(entry.clone());
    }
    by_cpu.push((cpu, entry));
  }

  by_cpu.sort_by(|a, b| b.0.total_cmp(&a.0));
  let busiest = by_cpu
    .iter()
    .take(6)
    .map(|(_, entry)| entry.clone())
    .collect::<Vec<_>>()
    .join(" | ");

  log::warn!(
    "[watchdog] webview processes at hang: {}",
    if webview.is_empty() {
      "none matched".to_string()
    } else {
      webview.join(" | ")
    }
  );
  log::warn!("[watchdog] busiest processes at hang: {busiest}");
}

/// Reloads the main webview to break out of a freeze.
///
/// The webview's own JavaScript cannot do this — that is the part that is stuck
/// — but the Rust side keeps running for the whole freeze (the field log has
/// the watchdog logging for 56 minutes while the UI was dead). Reloading tears
/// down the wedged renderer and brings the UI back in place, instead of leaving
/// the user with no option but a Task Manager kill. The reload is dispatched
/// asynchronously, so this cannot block the watchdog thread.
fn attempt_recovery(app: &tauri::AppHandle) {
  let Some(window) = app.get_webview_window("main") else {
    log::warn!("[watchdog] recovery skipped: main webview window not found");
    return;
  };
  // Written before the reload: the next boot reports it as an analytics event.
  crate::settings::mark_watchdog_recovery(app);
  match window.reload() {
    Ok(()) => log::warn!("[watchdog] reloading the main webview to recover the UI"),
    Err(error) => log::warn!("[watchdog] recovery reload failed: {error}"),
  }
}

/// Checks whether the Tauri main thread still runs tasks, by dispatching a
/// no-op onto it and waiting for it to run.
///
/// On Windows the webview's IPC is served on the main thread, so a blocked main
/// thread stops every `invoke` — which looks exactly like a frozen UI from the
/// frontend's point of view. This probe tells the two apart in the log:
/// `Ok` = the Rust side is healthy and the renderer is the stuck part;
/// `Err` = the event loop itself is blocked, so all IPC (and thus the UI) is
/// dead until the process is restarted.
fn main_thread_latency(app: &tauri::AppHandle) -> Result<Duration, Duration> {
  let (tx, rx) = std::sync::mpsc::channel::<()>();
  let dispatched_at = Instant::now();
  if app.run_on_main_thread(move || {
    let _ = tx.send(());
  }).is_err()
  {
    return Err(dispatched_at.elapsed());
  }
  match rx.recv_timeout(MAIN_THREAD_PROBE_TIMEOUT) {
    Ok(()) => Ok(dispatched_at.elapsed()),
    Err(_) => Err(dispatched_at.elapsed()),
  }
}

/// Starts the watchdog thread. Call once during app setup.
pub(crate) fn start_watchdog(app: tauri::AppHandle) {
  // Make the build unambiguous in the log: if this line (or the `build=` token
  // in any later line) is missing, the running app predates these diagnostics.
  log::info!(
    "[watchdog] diagnostics protocol {BUILD_MARKER} active (verbose={})",
    VERBOSE.load(Ordering::Relaxed)
  );
  std::thread::spawn(move || {
    let mut frozen: Option<FrozenState> = None;
    let mut cycles: u64 = 0;

    loop {
      std::thread::sleep(HEARTBEAT_INTERVAL);
      cycles += 1;

      let snapshot = match last_status().lock() {
        Ok(guard) => guard
          .as_ref()
          .map(|entry| (entry.received, entry.payload.clone())),
        Err(_) => None,
      };
      let Some((received, payload)) = snapshot else {
        continue;
      };

      let silent_for = received.elapsed();
      // A hidden window is expected to stop checking in: background timers are
      // throttled (Chromium clamps them to about one per minute), and there is
      // no visible work to lose. Only a *visible* frontend going quiet is a hang.
      let visible = payload.visibility != "hidden";

      // Periodic snapshot (verbose only): gives the log a timeline of route,
      // heap and DOM size so a freeze that creeps in as the app grows can be
      // spotted after the fact. The very first snapshot of each run is always
      // written once, so it is obvious in the log that logging works at all.
      let verbose = VERBOSE.load(Ordering::Relaxed);
      if frozen.is_none() && (cycles == 1 || (verbose && cycles % ALIVE_LOG_EVERY == 0)) {
        log::info!(
          "[watchdog] frontend alive ({:.1}s since last heartbeat): {}",
          silent_for.as_secs_f32(),
          describe(&payload)
        );
      }

      if visible && silent_for > HANG_THRESHOLD {
        match frozen.as_mut() {
          None => {
            log::warn!(
              "[watchdog] frontend unresponsive — no heartbeat for {}s. Last known state: {}",
              silent_for.as_secs(),
              describe(&payload)
            );
            // Capture whether the renderer is spinning or idle, so the cause
            // can be told apart without a manual Task Manager check.
            log_process_snapshot();
            // ...and whether the stuck part is the renderer or our own main
            // thread (which serves IPC on Windows).
            match main_thread_latency(&app) {
              Ok(latency) => log::warn!(
                "[watchdog] Rust main thread still responsive at hang ({:.0}ms) — the webview/renderer is the stuck part",
                latency.as_secs_f64() * 1000.0
              ),
              Err(waited) => log::warn!(
                "[watchdog] Rust main thread did NOT respond within {:.0}ms — the event loop is blocked, which also stops IPC for the webview",
                waited.as_secs_f64() * 1000.0
              ),
            }
            frozen = Some(FrozenState {
              since: received,
              payload,
              last_log: Instant::now(),
              recovery_attempted: false,
            });
          }
          Some(state) => {
            // Self-heal: once the freeze has lasted long enough to rule out a
            // merely slow task, reload the webview so the app recovers on its
            // own instead of needing a force-quit.
            if !state.recovery_attempted && state.since.elapsed() >= RECOVERY_AFTER {
              state.recovery_attempted = true;
              attempt_recovery(&app);
            }
            if state.last_log.elapsed() >= HANG_REPEAT {
              state.last_log = Instant::now();
              log::warn!(
                "[watchdog] frontend still unresponsive after ~{}s. State before the freeze: {}",
                state.since.elapsed().as_secs(),
                describe(&state.payload)
              );
            }
          }
        }
      } else if let Some(state) = frozen.take() {
        log::warn!(
          "[watchdog] frontend recovered after ~{}s of silence. State before the freeze: {}",
          state.since.elapsed().as_secs(),
          describe(&state.payload)
        );
      }
    }
  });
}
