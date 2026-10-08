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
}

static LAST_STATUS: OnceLock<Mutex<Option<LastStatus>>> = OnceLock::new();

fn last_status() -> &'static Mutex<Option<LastStatus>> {
  LAST_STATUS.get_or_init(|| Mutex::new(None))
}

/// Records a heartbeat from the webview. Called frequently; must stay cheap.
#[tauri::command]
pub(crate) fn frontend_heartbeat(status: FrontendStatusPayload) {
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

/// Starts the watchdog thread. Call once during app setup.
pub(crate) fn start_watchdog() {
  std::thread::spawn(|| {
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

      // Periodic snapshot: gives the log a timeline of route, heap and DOM size
      // so a freeze that creeps in as the app grows can be spotted after the
      // fact.
      if frozen.is_none() && cycles % ALIVE_LOG_EVERY == 0 {
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
            frozen = Some(FrozenState {
              since: received,
              payload,
              last_log: Instant::now(),
            });
          }
          Some(state) => {
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
