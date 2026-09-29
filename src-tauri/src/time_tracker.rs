use crate::events::InstalledGameInfo;
use crate::games::{collect_launch_candidates, list_installed_games_blocking};
use crate::settings::load_settings;
use crate::state::{
  pending_offline_minutes, reset_tracker_stats, tracker_config, tracker_ledger,
  tracker_ledger_snapshot, tracker_stats, tracker_stop_tx, GamePlayLedger, TrackerConfig,
  TrackerRuntimeStats,
};
use crate::tracker_log;
use crate::util::{is_ignored_executable, paths_match};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, UNIX_EPOCH};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::Emitter;
use tokio::sync::watch;

/// Seconds between tracker ticks. One matched tick credits exactly one minute,
/// so every skipped tick is a minute of playtime that never reaches the server.
const TICK_INTERVAL_SECS: u64 = 60;
/// A tick that fires earlier than this is a catch-up burst after a stall.
const CATCH_UP_TOLERANCE_SECS: u64 = 5;
/// Backoff after repeated session rejections: retry after 1, 2, 5, then 15 min.
const AUTH_BACKOFF_SECS: [u64; 4] = [60, 120, 300, 900];
/// Ticks a game may be missing before the match counts as lost. Launchers that
/// hand the game to a new process would otherwise lose a minute per restart.
const MATCH_GRACE_TICKS: u64 = 2;
/// How long a scanned candidate list is reused before walking the folders again.
const CANDIDATE_CACHE_TTL_SECS: u64 = 600;
/// At most one `tracker-auth-expired` event per minute.
const AUTH_EVENT_THROTTLE_MS: u64 = 60_000;
/// Event telling the frontend that the tracker's session was rejected.
const AUTH_EXPIRED_EVENT: &str = "tracker-auth-expired";

/// Event payload for [`AUTH_EXPIRED_EVENT`].
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrackerAuthExpiredEvent {
  pub at: u64,
  pub auth_rejected_count: u64,
  pub pending_offline_minutes: u64,
  pub retry_in_secs: u64,
}

/// A previously scanned candidate list, reused while the folder is unchanged.
#[derive(Clone)]
struct CachedCandidates {
  scan_dir: PathBuf,
  dir_modified_ms: u64,
  scanned_at_ms: u64,
  candidates: Vec<PathBuf>,
}

static CANDIDATE_CACHE: OnceLock<Mutex<HashMap<i64, CachedCandidates>>> = OnceLock::new();

fn candidate_cache() -> &'static Mutex<HashMap<i64, CachedCandidates>> {
  CANDIDATE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn dir_modified_ms(path: &Path) -> u64 {
  fs::metadata(path)
    .and_then(|metadata| metadata.modified())
    .ok()
    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
    .map(|duration| duration.as_millis() as u64)
    .unwrap_or(0)
}

fn is_shortcut(path: &Path) -> bool {
  path
    .extension()
    .and_then(|ext| ext.to_str())
    .map(|ext| ext.eq_ignore_ascii_case("lnk"))
    .unwrap_or(false)
}

#[tauri::command]
pub(crate) fn start_game_time_tracker(
  app: tauri::AppHandle,
  server_url: String,
  user_id: i64,
  access_token: String,
  download_path: Option<String>,
  download_paths: Option<Vec<String>>,
) -> Result<(), String> {
  let previous_running = tracker_stats()
    .lock()
    .map(|stats| stats.running)
    .unwrap_or(false);

  if let Ok(mut tx) = tracker_stop_tx().lock() {
    if let Some(sender) = tx.take() {
      let _ = sender.send(true);
      tracker_log::push(
        "info",
        "lifecycle",
        "restarting tracker: stopping the previous loop",
      );
    }
  }

  // Build paths list: prefer download_paths if provided and non-empty,
  // otherwise fall back to single download_path
  let paths: Vec<String> = match download_paths {
    Some(ref dps) if !dps.is_empty() => dps.clone(),
    _ => match download_path {
      Some(ref dp) if !dp.is_empty() => vec![dp.clone()],
      _ => Vec::new(),
    },
  };

  tracker_log::push_kv(
    "info",
    "lifecycle",
    &[
      ("event", "start".to_string()),
      ("server_url", server_url.clone()),
      ("user_id", user_id.to_string()),
      ("token", tracker_log::redact_token(&access_token)),
      ("roots", paths.len().to_string()),
      (
        "root_list",
        if paths.is_empty() {
          "none".to_string()
        } else {
          paths.join(", ")
        },
      ),
      ("previous_loop_running", previous_running.to_string()),
    ],
  );

  let config = TrackerConfig {
    server_url,
    user_id,
    access_token,
    download_paths: paths,
  };

  if let Ok(mut cfg) = tracker_config().lock() {
    *cfg = Some(config);
  }

  if let Ok(mut stats) = tracker_stats().lock() {
    stats.log_path = tracker_log::log_path();
  }
  reset_tracker_stats(tracker_log::now_ms(), TICK_INTERVAL_SECS);

  let (stop_tx, stop_rx) = watch::channel(false);
  if let Ok(mut tx) = tracker_stop_tx().lock() {
    *tx = Some(stop_tx);
  }

  tauri::async_runtime::spawn(game_time_tracker_loop(stop_rx, app));

  Ok(())
}

#[tauri::command]
pub(crate) fn stop_game_time_tracker(reason: Option<String>) -> Result<(), String> {
  let reason = reason.unwrap_or_else(|| "unspecified".to_string());

  if let Ok(mut tx) = tracker_stop_tx().lock() {
    if let Some(sender) = tx.take() {
      let _ = sender.send(true);
    }
  }
  if let Ok(mut cfg) = tracker_config().lock() {
    *cfg = None;
  }
  if let Ok(mut stats) = tracker_stats().lock() {
    stats.running = false;
    stats.stop_reason = Some(reason.clone());
  }

  tracker_log::push("info", "lifecycle", &format!("tracker stop requested (reason={reason})"));
  Ok(())
}

#[tauri::command]
pub(crate) fn update_tracker_auth(access_token: String) -> Result<(), String> {
  let mut updated = false;
  if let Ok(mut cfg) = tracker_config().lock() {
    if let Some(ref mut c) = *cfg {
      c.access_token = access_token.clone();
      updated = true;
    }
  }

  // A fresh token ends the rejection streak: retry immediately instead of
  // waiting out the backoff.
  let cleared_backoff = if let Ok(mut stats) = tracker_stats().lock() {
    let was_backing_off = stats.auth_backoff_until.is_some();
    stats.auth_backoff_until = None;
    stats.auth_streak = 0;
    was_backing_off
  } else {
    false
  };
  if cleared_backoff {
    tracker_log::push(
      "info",
      "http",
      "auth_backoff_cleared: fresh session token arrived, resuming requests",
    );
  }

  tracker_log::push_kv(
    "info",
    "lifecycle",
    &[
      ("event", "auth_updated".to_string()),
      ("applied_to_running_tracker", updated.to_string()),
      ("token", tracker_log::redact_token(&access_token)),
    ],
  );
  Ok(())
}

/// One entry of the per-game accounting ledger, used for log lines.
#[derive(Clone)]
struct SkipReason {
  game_id: i64,
  title: String,
  reason: String,
}

async fn game_time_tracker_loop(mut stop_rx: watch::Receiver<bool>, app: tauri::AppHandle) {
  let mut interval = tokio::time::interval(Duration::from_secs(TICK_INTERVAL_SECS));
  interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Burst);
  interval.tick().await;

  tracker_log::push(
    "info",
    "lifecycle",
    &format!("tracker loop started (interval={TICK_INTERVAL_SECS}s, missed_tick_behavior=burst)"),
  );

  let mut previous_tick_at: Option<Instant> = None;
  let mut in_catch_up_burst = false;
  let mut logged_skips: HashMap<i64, String> = HashMap::new();
  let mut logged_candidates: HashMap<i64, usize> = HashMap::new();
  let mut logged_backoff_until: Option<u64> = None;

  loop {
    tokio::select! {
      _ = interval.tick() => {},
      _ = stop_rx.changed() => {
        let reason = tracker_stats()
          .lock()
          .ok()
          .and_then(|stats| stats.stop_reason.clone())
          .unwrap_or_else(|| "stop signal (no reason recorded)".to_string());
        tracker_log::push("info", "lifecycle", &format!("tracker loop stopping: {reason}"));
        break;
      }
    }

    let tick_start = Instant::now();
    let now_ms = tracker_log::now_ms();
    let tick_number = match tracker_stats().lock() {
      Ok(mut stats) => {
        stats.tick_count += 1;
        stats.last_tick_at = Some(now_ms);
        stats.tick_count
      }
      Err(_) => 0,
    };

    // ── Tick timing: detect stalls, gaps and catch-up bursts ───────────────
    let mut dropped_ticks = 0u64;
    if let Some(previous) = previous_tick_at {
      let gap_secs = tick_start.duration_since(previous).as_secs();
      let catch_up = gap_secs + CATCH_UP_TOLERANCE_SECS < TICK_INTERVAL_SECS;
      if catch_up && !in_catch_up_burst {
        tracker_log::push(
          "warn",
          "tick",
          &format!(
            "catch-up burst started: the previous iteration was stalled (gap {gap_secs}s, previous gap {}s)",
            tracker_stats()
              .lock()
              .ok()
              .and_then(|stats| stats.last_tick_gap_secs.map(|value| value.to_string()))
              .unwrap_or_else(|| "unknown".to_string())
          ),
        );
      }
      in_catch_up_burst = catch_up;
      if catch_up {
        if let Ok(mut stats) = tracker_stats().lock() {
          stats.catch_up_ticks += 1;
        }
      } else if gap_secs > TICK_INTERVAL_SECS + CATCH_UP_TOLERANCE_SECS {
        dropped_ticks = dropped_ticks_for_gap(gap_secs);
        tracker_log::push_kv(
          "warn",
          "tick",
          &[
            ("event", "tick_gap".to_string()),
            ("tick", tick_number.to_string()),
            ("gap_secs", gap_secs.to_string()),
            ("dropped_ticks", dropped_ticks.to_string()),
            (
              "hint",
              "device sleep/hibernate, app freeze or tick starvation: playtime in this window may be lost"
                .to_string(),
            ),
          ],
        );
      }
      if let Ok(mut stats) = tracker_stats().lock() {
        stats.last_tick_gap_secs = Some(gap_secs);
        if dropped_ticks > 0 {
          stats.lost_ticks += dropped_ticks;
        }
      }
    }
    previous_tick_at = Some(tick_start);

    let config = match tracker_config().lock() {
      Ok(guard) => match guard.clone() {
        Some(c) => c,
        None => continue,
      },
      Err(_) => continue,
    };

    if config.download_paths.is_empty() || config.server_url.is_empty() {
      tracker_log::push_kv(
        "warn",
        "tick",
        &[
          ("event", "tick_skipped".to_string()),
          ("tick", tick_number.to_string()),
          ("reason", "tracker has no roots or no server url".to_string()),
        ],
      );
      continue;
    }

    // ── Library scan ───────────────────────────────────────────────────────
    let library_start = Instant::now();
    let mut installed = Vec::new();
    for path in &config.download_paths {
      match list_installed_games_blocking(path.clone()) {
        Ok(games) => {
          if games.is_empty() {
            tracker_log::push_kv(
              "warn",
              "scan",
              &[
                ("event", "root_no_games".to_string()),
                ("root", path.clone()),
              ],
            );
          }
          installed.extend(games);
        }
        Err(error) => tracker_log::push_kv(
          "error",
          "scan",
          &[
            ("event", "root_scan_failed".to_string()),
            ("root", path.clone()),
            ("error", error),
          ],
        ),
      }
    }
    let library_ms = library_start.elapsed().as_millis() as u64;

    if installed.is_empty() {
      mark_all_unmatched("no_installed_games");
      tracker_log::push_kv(
        "warn",
        "tick",
        &[
          ("event", "no_installed_games".to_string()),
          ("tick", tick_number.to_string()),
          ("roots", config.download_paths.len().to_string()),
          ("library_ms", library_ms.to_string()),
        ],
      );
      continue;
    }

    // ── Executable candidates per installed game ───────────────────────────
    let ignored = load_settings(&app).ignored_executables;
    let candidates_start = Instant::now();
    let mut game_exe_map: HashMap<i64, Vec<PathBuf>> = HashMap::new();
    let mut game_titles: HashMap<i64, String> = HashMap::new();
    let mut skips: HashMap<i64, SkipReason> = HashMap::new();
    let mut cache_hits = 0usize;
    let mut cache_misses = 0usize;

    for game in &installed {
      game_titles.insert(game.game_id, game.game_title.clone());

      // The configured installation dir may not exist (e.g. no "Installation"
      // subfolder); fall back to the version dir so the game is still tracked.
      let configured_install = PathBuf::from(&game.installation_directory);
      let mut scan_dir = configured_install.clone();
      if !scan_dir.exists() || !scan_dir.is_dir() {
        scan_dir = PathBuf::from(&game.version_directory);
      }
      if !scan_dir.exists() || !scan_dir.is_dir() {
        skips.insert(
          game.game_id,
          SkipReason {
            game_id: game.game_id,
            title: game.game_title.clone(),
            reason: format!(
              "version_dir_missing (install='{}', version='{}')",
              game.installation_directory, game.version_directory
            ),
          },
        );
        continue;
      }

      // Walking a game folder is expensive (large trees) and used to run on
      // every tick for every game. Reuse the last result while the folder is
      // unchanged and the cache is still fresh.
      let dir_modified = dir_modified_ms(&scan_dir);
      let cached = candidate_cache()
        .lock()
        .ok()
        .and_then(|cache| cache.get(&game.game_id).cloned());
      let mut scan_failed = false;
      let cache_hit = matches!(
        cached.as_ref(),
        Some(entry)
          if entry.scan_dir == scan_dir
            && entry.dir_modified_ms == dir_modified
            && now_ms.saturating_sub(entry.scanned_at_ms) < CANDIDATE_CACHE_TTL_SECS * 1000
      );
      let scanned: Vec<PathBuf> = if cache_hit {
        cache_hits += 1;
        cached.map(|entry| entry.candidates).unwrap_or_default()
      } else {
        cache_misses += 1;
        let mut rel_candidates = Vec::new();
        if collect_launch_candidates(&scan_dir, &scan_dir, &mut rel_candidates).is_err() {
          scan_failed = true;
        }
        let scanned: Vec<PathBuf> = rel_candidates
          .iter()
          .map(|rel| scan_dir.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR)))
          .collect();
        if let Ok(mut cache) = candidate_cache().lock() {
          cache.insert(
            game.game_id,
            CachedCandidates {
              scan_dir: scan_dir.clone(),
              dir_modified_ms: dir_modified,
              scanned_at_ms: now_ms,
              candidates: scanned.clone(),
            },
          );
        }
        scanned
      };

      // Always include the exact launcher the user runs (from the per-game
      // config), then the scanned executables, de-duplicated.
      let found = scanned.len();
      let mut abs_paths: Vec<PathBuf> = Vec::new();
      let mut seen: HashSet<String> = HashSet::new();
      let configured_launcher =
        read_configured_launch_executable(Path::new(&game.version_directory));
      if let Some(rel_exe) = configured_launcher.clone() {
        let abs = scan_dir.join(rel_exe);
        if abs.exists() && !is_ignored_executable(&abs, &ignored) && !is_shortcut(&abs) {
          seen.insert(abs.to_string_lossy().to_ascii_lowercase());
          abs_paths.push(abs);
        }
      }

      let mut ignored_count = 0usize;
      for abs in scanned {
        // A shortcut is never the process that runs the game.
        if is_shortcut(&abs) {
          continue;
        }
        if is_ignored_executable(&abs, &ignored) {
          ignored_count += 1;
          continue;
        }
        let key = abs.to_string_lossy().to_ascii_lowercase();
        if seen.insert(key) {
          abs_paths.push(abs);
        }
      }

      if abs_paths.is_empty() {
        let reason = if scan_failed {
          format!("launch_candidate_scan_failed in {}", scan_dir.to_string_lossy())
        } else if found > 0 && ignored_count > 0 {
          format!(
            "all_candidates_ignored ({found} candidates, {ignored_count} ignored by the ignore list)"
          )
        } else if configured_launcher.is_some() {
          "no_exe_candidates (configured launch executable is missing)".to_string()
        } else {
          format!("no_exe_candidates (found {found} candidates in {})", scan_dir.to_string_lossy())
        };
        skips.insert(
          game.game_id,
          SkipReason {
            game_id: game.game_id,
            title: game.game_title.clone(),
            reason,
          },
        );
        continue;
      }

      if logged_candidates.get(&game.game_id) != Some(&abs_paths.len()) {
        logged_candidates.insert(game.game_id, abs_paths.len());
        let mut listed = abs_paths
          .iter()
          .take(8)
          .map(|path| path.to_string_lossy().to_string())
          .collect::<Vec<_>>()
          .join(" | ");
        if abs_paths.len() > 8 {
          listed.push_str(&format!(" | … (+{} more)", abs_paths.len() - 8));
        }
        tracker_log::push_kv(
          "info",
          "game",
          &[
            ("event", "candidates".to_string()),
            ("game", game.game_id.to_string()),
            ("title", game.game_title.clone()),
            ("count", abs_paths.len().to_string()),
            ("cache", if cache_hit { "hit".to_string() } else { "miss".to_string() }),
            ("exes", listed),
          ],
        );
      }

      game_exe_map
        .entry(game.game_id)
        .or_default()
        .extend(abs_paths);
    }

    let candidates_ms = candidates_start.elapsed().as_millis() as u64;

    for skip in skips.values() {
      log_skip_once(&mut logged_skips, skip);
    }

    if game_exe_map.is_empty() {
      tracker_log::push_kv(
        "warn",
        "tick",
        &[
          ("event", "no_executable_candidates".to_string()),
          ("tick", tick_number.to_string()),
          ("installed", installed.len().to_string()),
        ],
      );
      continue;
    }

    // ── Process matching ───────────────────────────────────────────────────
    let process_start = Instant::now();
    let mut sys = System::new();
    // `refresh_processes` alone does not load `cmd()` in sysinfo 0.33 — the
    // process argv (which is what matches a running game) stays empty. Use
    // the explicit "everything" refresh kind so cmdlines are populated.
    sys.refresh_processes_specifics(
      ProcessesToUpdate::All,
      true,
      ProcessRefreshKind::everything(),
    );

    let processes: Vec<&sysinfo::Process> = sys.processes().values().collect();
    let process_ms = process_start.elapsed().as_millis() as u64;
    let match_start = Instant::now();

    let mut matched_game_ids: Vec<i64> = Vec::new();
    for (game_id, exe_paths) in &game_exe_map {
      let matching: Vec<String> = processes
        .iter()
        .filter(|process| exe_paths.iter().any(|game_exe| process_matches_game(process, game_exe)))
        .map(|process| describe_process(process))
        .collect();
      let title = game_titles.get(game_id).cloned().unwrap_or_default();
      let reason = if matching.is_empty() {
        // Distinguish "the game closed" from "the game is running but our
        // candidate paths do not match it" — the second one is a bug report.
        if candidate_name_seen(&processes, exe_paths) {
          Some("exe_seen_but_unmatched")
        } else {
          Some("process_gone")
        }
      } else {
        None
      };

      let state = update_ledger(
        *game_id,
        &title,
        !matching.is_empty(),
        &matching,
        reason,
        dropped_ticks,
        now_ms,
      );
      if !matches!(state, LedgerMatch::Lost) {
        matched_game_ids.push(*game_id);
      }
    }

    // Games without executable candidates can never match: record why.
    for skip in skips.values() {
      update_ledger(
        skip.game_id,
        &skip.title,
        false,
        &[],
        Some(skip.reason.as_str()),
        dropped_ticks,
        now_ms,
      );
    }

    let match_ms = match_start.elapsed().as_millis() as u64;

    if matched_game_ids.is_empty() {
      tracker_log::push_kv(
        "tick",
        "tick",
        &[
          ("event", "no_match".to_string()),
          ("tick", tick_number.to_string()),
          ("installed", installed.len().to_string()),
          ("games_with_exe", game_exe_map.len().to_string()),
          ("processes", processes.len().to_string()),
          ("match_ms", match_ms.to_string()),
        ],
      );
      continue;
    }

    // ── Credit time ────────────────────────────────────────────────────────
    let client = reqwest::Client::new();
    let http_start = Instant::now();
    let backoff_until = tracker_stats()
      .lock()
      .ok()
      .and_then(|stats| stats.auth_backoff_until);
    let backing_off = backoff_until.map(|until| until > now_ms).unwrap_or(false);

    if backing_off && logged_backoff_until != backoff_until {
      logged_backoff_until = backoff_until;
      tracker_log::push_kv(
        "warn",
        "http",
        &[
          ("event", "auth_backoff_active".to_string()),
          (
            "retry_in_secs",
            (backoff_until.unwrap_or(now_ms).saturating_sub(now_ms) / 1000).to_string(),
          ),
          (
            "message",
            "the session is still rejected: playtime keeps being stored offline, requests are paused"
              .to_string(),
          ),
        ],
      );
    } else if !backing_off {
      logged_backoff_until = None;
    }

    let mut credited = 0u64;
    let mut offline = 0u64;
    let mut lost = 0u64;
    for game_id in &matched_game_ids {
      let outcome = if backing_off {
        // Do not hammer a server that rejects our session: keep the minute,
        // store it offline and try again after the backoff.
        if let Ok(mut stats) = tracker_stats().lock() {
          stats.skipped_auth_ticks += 1;
        }
        save_offline_time(&installed, &config, *game_id);
        CreditOutcome::Offline {
          reason: "auth backoff (session rejected, request skipped)".to_string(),
        }
      } else {
        increment_game_time(&app, &client, &config, *game_id, &installed).await
      };

      match outcome {
        CreditOutcome::Credited { .. } => {
          credited += 1;
          bump_credit_stats(true, false);
        }
        CreditOutcome::Offline { ref reason } => {
          offline += 1;
          bump_credit_stats(false, false);
          record_failure(reason);
        }
        CreditOutcome::Lost { ref reason } => {
          lost += 1;
          bump_credit_stats(false, false);
          record_failure(reason);
        }
      }
      record_credit(*game_id, outcome);
    }
    let http_ms = http_start.elapsed().as_millis() as u64;

    let duration_ms = tick_start.elapsed().as_millis() as u64;
    let summary = format!(
      "tick {tick_number} | installed={} with_exe={} processes={} matched={} credited={credited} offline={offline} lost={lost} | library={library_ms}ms candidates={candidates_ms}ms cache={cache_hits}/{cache_misses} process={process_ms}ms match={match_ms}ms http={http_ms}ms total={duration_ms}ms",
      installed.len(),
      game_exe_map.len(),
      processes.len(),
      matched_game_ids.len(),
    );
    tracker_log::push("tick", "tick", &summary);
    if let Ok(mut stats) = tracker_stats().lock() {
      stats.last_tick_summary = Some(summary);
      stats.last_tick_duration_ms = Some(duration_ms);
    }

    for (phase, value) in [
      ("library", library_ms),
      ("candidates", candidates_ms),
      ("process", process_ms),
      ("match", match_ms),
      ("http", http_ms),
    ] {
      if value > 1000 {
        tracker_log::push_kv(
          "warn",
          "tick",
          &[
            ("event", "slow_phase".to_string()),
            ("tick", tick_number.to_string()),
            ("phase", phase.to_string()),
            ("phase_ms", value.to_string()),
            ("total_ms", duration_ms.to_string()),
          ],
        );
      }
    }

    if duration_ms > TICK_INTERVAL_SECS * 1000 {
      tracker_log::push_kv(
        "warn",
        "tick",
        &[
          ("event", "tick_starvation".to_string()),
          ("tick", tick_number.to_string()),
          ("duration_ms", duration_ms.to_string()),
          ("interval_ms", (TICK_INTERVAL_SECS * 1000).to_string()),
        ],
      );
    }
  }

  tracker_log::push("info", "lifecycle", "tracker loop exited");
  if let Ok(mut stats) = tracker_stats().lock() {
    stats.running = false;
  }
}

/// Records that no game could be matched this tick, e.g. an empty library scan.
fn mark_all_unmatched(reason: &str) {
  if let Ok(mut ledger) = tracker_ledger().lock() {
    for entry in ledger.values_mut() {
      if entry.matched {
        entry.matched = false;
      }
      entry.last_skip_reason = Some(reason.to_string());
    }
  }
}

/// Logs a missing-executable reason once per change instead of every tick.
fn log_skip_once(logged: &mut HashMap<i64, String>, skip: &SkipReason) {
  let changed = logged
    .get(&skip.game_id)
    .map(|previous| previous != &skip.reason)
    .unwrap_or(true);
  if !changed {
    return;
  }
  logged.insert(skip.game_id, skip.reason.clone());
  tracker_log::push_kv(
    "warn",
    "game",
    &[
      ("event", "unmatched".to_string()),
      ("game", skip.game_id.to_string()),
      ("title", skip.title.clone()),
      ("reason", skip.reason.clone()),
    ],
  );
}

/// What a ledger update means for the current tick.
enum LedgerMatch {
  /// Process still running — credit normally.
  Matched,
  /// Process vanished but the game may still be running (launcher hand-off) —
  /// still credit, for at most [`MATCH_GRACE_TICKS`] ticks.
  Grace { remaining: u64 },
  /// The game is not running (or never was) — do not credit.
  Lost,
}

/// Keeps the per-game ledger in sync and logs match transitions.
fn update_ledger(
  game_id: i64,
  title: &str,
  matched: bool,
  matching_processes: &[String],
  fallback_reason: Option<&str>,
  dropped_ticks: u64,
  now_ms: u64,
) -> LedgerMatch {
  let Ok(mut ledger) = tracker_ledger().lock() else {
    return if matched { LedgerMatch::Matched } else { LedgerMatch::Lost };
  };
  let entry = ledger.entry(game_id).or_default();
  entry.game_id = game_id;
  if !title.is_empty() {
    entry.game_title = title.to_string();
  }

  if dropped_ticks > 0 && (matched || entry.matched) {
    entry.lost_ticks += dropped_ticks;
    entry.dropped_ticks += dropped_ticks;
    tracker_log::push_kv(
      "warn",
      "game",
      &[
        ("event", "gap_undercount_risk".to_string()),
        ("game", game_id.to_string()),
        ("title", entry.game_title.clone()),
        ("dropped_ticks", dropped_ticks.to_string()),
        ("lost_ticks_total", entry.lost_ticks.to_string()),
        (
          "hint",
          "the game was matched around the gap, so this playtime was very likely never credited"
            .to_string(),
        ),
      ],
    );
  }

  if matched {
    if !entry.matched {
      if entry.first_matched_at.is_none() {
        entry.first_matched_at = Some(now_ms);
        tracker_log::push_kv(
          "info",
          "game",
          &[
            ("event", "match_started".to_string()),
            ("game", game_id.to_string()),
            ("title", entry.game_title.clone()),
            ("processes", matching_processes.join(" | ")),
          ],
        );
      } else {
        entry.match_flaps += 1;
        let away_secs = entry
          .last_matched_at
          .map(|last| now_ms.saturating_sub(last) / 1000)
          .unwrap_or(0);
        tracker_log::push_kv(
          "warn",
          "game",
          &[
            ("event", "match_resumed".to_string()),
            ("game", game_id.to_string()),
            ("title", entry.game_title.clone()),
            ("away_secs", away_secs.to_string()),
            ("flaps_total", entry.match_flaps.to_string()),
            ("processes", matching_processes.join(" | ")),
            (
              "hint",
              "playtime during this window was not credited (launcher exited, re-exec or missing candidate)"
                .to_string(),
            ),
          ],
        );
      }
      entry.matched = true;
    }
    entry.missing_ticks = 0;
    entry.matched_ticks += 1;
    entry.last_matched_at = Some(now_ms);
    entry.observed_seconds += TICK_INTERVAL_SECS;
    entry.last_skip_reason = None;
    return LedgerMatch::Matched;
  }

  // Not matched on this tick.
  let reason = fallback_reason.unwrap_or("no_matching_process");
  entry.last_skip_reason = Some(reason.to_string());

  if entry.matched {
    entry.missing_ticks += 1;

    // A game can briefly disappear from the process list while it keeps
    // running (launcher hand-off, protection re-exec). Keep crediting for a
    // couple of ticks instead of losing that playtime.
    if entry.missing_ticks <= MATCH_GRACE_TICKS {
      entry.matched_ticks += 1;
      entry.observed_seconds += TICK_INTERVAL_SECS;
      tracker_log::push_kv(
        "info",
        "game",
        &[
          ("event", "match_grace".to_string()),
          ("game", game_id.to_string()),
          ("title", entry.game_title.clone()),
          ("tick", entry.missing_ticks.to_string()),
          ("grace_ticks", MATCH_GRACE_TICKS.to_string()),
          ("reason", reason.to_string()),
        ],
      );
      return LedgerMatch::Grace {
        remaining: MATCH_GRACE_TICKS - entry.missing_ticks,
      };
    }

    entry.matched = false;
    entry.missing_ticks = 0;
    tracker_log::push_kv(
      "warn",
      "game",
      &[
        ("event", "match_lost".to_string()),
        ("game", game_id.to_string()),
        ("title", entry.game_title.clone()),
        ("reason", reason.to_string()),
        ("matched_ticks", entry.matched_ticks.to_string()),
        ("credited_minutes", entry.credited_minutes.to_string()),
        (
          "observed_minutes",
          (entry.observed_seconds / TICK_INTERVAL_SECS).to_string(),
        ),
      ],
    );
    log_session_summary(entry, pending_offline_minutes());
    return LedgerMatch::Lost;
  }

  LedgerMatch::Lost
}

/// One decisive line per game session: what was played, what was credited and
/// why the numbers differ.
fn log_session_summary(entry: &GamePlayLedger, pending_offline_minutes: u64) {
  let observed = entry.observed_seconds / TICK_INTERVAL_SECS;
  let accounted = entry.credited_minutes + entry.offline_minutes + entry.lost_ticks;

  let verdict = if entry.offline_minutes > 0 && entry.credited_minutes == 0 {
    format!(
      "{} of {} played minutes were stored offline because the server rejected the session; they are credited when the session works again",
      entry.offline_minutes, observed
    )
  } else if entry.offline_minutes > 0 {
    format!(
      "{} of {} played minutes were stored offline (rejected session), {} were credited",
      entry.offline_minutes, observed, entry.credited_minutes
    )
  } else if observed > accounted {
    format!(
      "{} of {} played minutes could not be credited ({} lost, {} dropped during a tick gap)",
      observed - accounted,
      observed,
      entry.lost_ticks,
      entry.dropped_ticks
    )
  } else {
    "all matched minutes were credited".to_string()
  };

  tracker_log::push_kv(
    "info",
    "session",
    &[
      ("event", "session_summary".to_string()),
      ("game", entry.game_id.to_string()),
      ("title", entry.game_title.clone()),
      ("observed_minutes", observed.to_string()),
      ("credited_minutes", entry.credited_minutes.to_string()),
      ("offline_minutes", entry.offline_minutes.to_string()),
      ("lost_minutes", entry.lost_ticks.to_string()),
      ("dropped_minutes", entry.dropped_ticks.to_string()),
      ("match_flaps", entry.match_flaps.to_string()),
      (
        "replayed_minutes",
        entry.replayed_minutes.to_string(),
      ),
      (
        "server_minutes",
        entry
          .last_server_minutes
          .map(|minutes| minutes.to_string())
          .unwrap_or_else(|| "unknown".to_string()),
      ),
      ("pending_offline_minutes", pending_offline_minutes.to_string()),
      ("verdict", verdict),
    ],
  );
}

/// True when a process runs with the same file name as one of the candidates:
/// the game is probably running, but the full paths did not match.
fn candidate_name_seen(processes: &[&sysinfo::Process], candidates: &[PathBuf]) -> bool {
  let names: HashSet<String> = candidates
    .iter()
    .filter_map(|path| path.file_name())
    .map(|name| name.to_string_lossy().to_ascii_lowercase())
    .collect();
  if names.is_empty() {
    return false;
  }

  processes.iter().any(|process| {
    process
      .exe()
      .and_then(|exe| exe.file_name())
      .map(|name| names.contains(&name.to_string_lossy().to_ascii_lowercase()))
      .unwrap_or(false)
  })
}

/// Ticks the interval expected but that never ran, from an observed gap.
///
/// Rounds to the nearest interval and never counts the tick that just ran, so a
/// 3 minute sleep reports 2 lost ticks and stays silent below the tolerance.
pub(crate) fn dropped_ticks_for_gap(gap_secs: u64) -> u64 {
  if gap_secs <= TICK_INTERVAL_SECS + CATCH_UP_TOLERANCE_SECS {
    0
  } else {
    (gap_secs + TICK_INTERVAL_SECS / 2) / TICK_INTERVAL_SECS - 1
  }
}

/// Why a single increment was credited, stored offline or dropped.
enum CreditOutcome {
  Credited { server_minutes: Option<i64> },
  Offline { reason: String },
  Lost { reason: String },
}

/// Applies one credit attempt to the per-game ledger.
fn record_credit(game_id: i64, outcome: CreditOutcome) {
  let Ok(mut ledger) = tracker_ledger().lock() else {
    return;
  };
  let entry = ledger.entry(game_id).or_default();
  entry.game_id = game_id;

  match outcome {
    CreditOutcome::Credited { server_minutes } => {
      entry.credited_ticks += 1;
      entry.credited_minutes += 1;
      if let Some(minutes) = server_minutes {
        let delta = entry.last_server_minutes.map(|previous| minutes - previous);
        entry.last_server_minutes = Some(minutes);
        tracker_log::push_kv(
          "info",
          "credit",
          &[
            ("event", "credited".to_string()),
            ("game", game_id.to_string()),
            ("title", entry.game_title.clone()),
            ("server_minutes", minutes.to_string()),
            (
              "server_delta",
              delta
                .map(|value| value.to_string())
                .unwrap_or_else(|| "unknown".to_string()),
            ),
            (
              "expected_delta",
              "1".to_string(),
            ),
            ("credited_minutes", entry.credited_minutes.to_string()),
            (
              "observed_minutes",
              (entry.observed_seconds / TICK_INTERVAL_SECS).to_string(),
            ),
          ],
        );
      }
    }
    CreditOutcome::Offline { reason } => {
      entry.offline_ticks += 1;
      entry.offline_minutes += 1;
      tracker_log::push_kv(
        "warn",
        "credit",
        &[
          ("event", "credited_offline".to_string()),
          ("game", game_id.to_string()),
          ("title", entry.game_title.clone()),
          ("reason", reason),
          ("offline_minutes", entry.offline_minutes.to_string()),
        ],
      );
    }
    CreditOutcome::Lost { reason } => {
      entry.lost_ticks += 1;
      tracker_log::push_kv(
        "error",
        "credit",
        &[
          ("event", "credit_lost".to_string()),
          ("game", game_id.to_string()),
          ("title", entry.game_title.clone()),
          ("reason", reason),
          ("lost_ticks_total", entry.lost_ticks.to_string()),
        ],
      );
    }
  }
}

/// Short, single-line process description for log lines.
fn describe_process(process: &sysinfo::Process) -> String {
  let exe = process
    .exe()
    .map(|path| path.to_string_lossy().to_string())
    .unwrap_or_else(|| {
      let cmd: Vec<String> = process
        .cmd()
        .iter()
        .map(|part| part.to_string_lossy().to_string())
        .collect();
      let joined = cmd.join(" ");
      if joined.is_empty() {
        "unknown".to_string()
      } else {
        joined
      }
    });
  format!("{exe} (pid {})", process.pid())
}

/// What the tracker should do with an increment response.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CreditDisposition {
  /// 2xx: the minute was counted by the server.
  Success,
  /// 401/403 (expired token), 408/429 (retry later) or 5xx: store offline.
  SaveOffline,
  /// Anything else (e.g. 404): do not count, do not store offline.
  Drop,
}

pub(crate) fn classify_status(status: u16) -> CreditDisposition {
  if (200..300).contains(&status) {
    CreditDisposition::Success
  } else if matches!(status, 401 | 403 | 408 | 429) || status >= 500 {
    CreditDisposition::SaveOffline
  } else {
    CreditDisposition::Drop
  }
}

/// Extracts `minutes_played` from an increment response, when the server sends it.
pub(crate) fn parse_server_minutes(body: &str) -> Option<i64> {
  let value: serde_json::Value = serde_json::from_str(body).ok()?;
  value.get("minutes_played").and_then(|minutes| minutes.as_i64())
}

fn excerpt(text: &str, max: usize) -> String {
  let cleaned = text.replace('\n', " ").replace('\r', " ").trim().to_string();
  if cleaned.chars().count() <= max {
    return cleaned;
  }
  let mut short: String = cleaned.chars().take(max).collect();
  short.push('…');
  short
}

fn bump_credit_stats(success: bool, auth_rejected: bool) {
  if let Ok(mut stats) = tracker_stats().lock() {
    if success {
      stats.consecutive_failures = 0;
      stats.last_error = None;
      // A working session ends the rejection streak and any backoff.
      stats.auth_streak = 0;
      stats.auth_backoff_until = None;
    } else {
      stats.consecutive_failures += 1;
    }
    if auth_rejected {
      stats.auth_rejected_count += 1;
    }
  }
}

fn record_failure(reason: &str) {
  if let Ok(mut stats) = tracker_stats().lock() {
    stats.last_error = Some(reason.to_string());
  }
}

/// The server rejected our session: stop asking for a while, keep storing the
/// minute offline, and (throttled) tell the frontend so it can refresh the
/// token instead of letting the tracker run on an expired one for an hour.
fn apply_auth_backoff(app: &tauri::AppHandle, status: u16) {
  let now = tracker_log::now_ms();
  let (streak, retry_in_secs, rejected_total, should_emit) = {
    let Ok(mut stats) = tracker_stats().lock() else {
      return;
    };
    stats.auth_streak += 1;
    stats.consecutive_failures += 1;
    stats.auth_rejected_count += 1;

    let index = (stats.auth_streak as usize - 1).min(AUTH_BACKOFF_SECS.len() - 1);
    let retry_in_secs = AUTH_BACKOFF_SECS[index];
    stats.auth_backoff_until = Some(now + retry_in_secs * 1000);

    let should_emit = stats
      .last_auth_event_at
      .map(|last| now.saturating_sub(last) >= AUTH_EVENT_THROTTLE_MS)
      .unwrap_or(true);
    if should_emit {
      stats.last_auth_event_at = Some(now);
    }

    (
      stats.auth_streak,
      retry_in_secs,
      stats.auth_rejected_count,
      should_emit,
    )
  };

  tracker_log::push_kv(
    "warn",
    "http",
    &[
      ("event", "auth_backoff".to_string()),
      ("status", status.to_string()),
      ("streak", streak.to_string()),
      ("retry_in_secs", retry_in_secs.to_string()),
      (
        "message",
        "the server rejected the session — playtime is stored offline and requests are paused"
          .to_string(),
      ),
    ],
  );

  if should_emit {
    let _ = app.emit(
      AUTH_EXPIRED_EVENT,
      TrackerAuthExpiredEvent {
        at: now,
        auth_rejected_count: rejected_total,
        pending_offline_minutes: pending_offline_minutes(),
        retry_in_secs,
      },
    );
  }
}

/// The access token the tracker is currently configured with.
fn current_access_token() -> Option<String> {
  tracker_config()
    .lock()
    .ok()
    .and_then(|config| config.as_ref().map(|config| config.access_token.clone()))
}

/// Sends one increment request with a given token.
async fn send_increment(
  client: &reqwest::Client,
  url: &str,
  access_token: &str,
) -> Result<reqwest::Response, reqwest::Error> {
  client
    .put(url)
    .header("Authorization", format!("Bearer {access_token}"))
    .header("Accept", "application/json")
    .send()
    .await
}

/// Sends one minute increment and reports what happened to it.
///
/// A rejected session is retried once with a newer token if the frontend
/// refreshed it in the meantime — the tracker's tick usually starts a moment
/// before the token refresh lands, so without this every refresh would waste a
/// minute into the offline file (and delete it again seconds later).
async fn increment_game_time(
  app: &tauri::AppHandle,
  client: &reqwest::Client,
  config: &TrackerConfig,
  game_id: i64,
  installed: &[InstalledGameInfo],
) -> CreditOutcome {
  let url = format!(
    "{}/api/progresses/user/{}/game/{}/increment",
    config.server_url, config.user_id, game_id
  );

  let response = match send_increment(client, &url, &config.access_token).await {
    Ok(response) => response,
    Err(error) => {
      let reason = format!("network error: {error}");
      save_offline_time(installed, config, game_id);
      return CreditOutcome::Offline { reason };
    }
  };

  let status = response.status();
  let body = response.text().await.unwrap_or_default();

  match classify_status(status.as_u16()) {
    CreditDisposition::Success => CreditOutcome::Credited {
      server_minutes: parse_server_minutes(&body),
    },
    CreditDisposition::SaveOffline => {
      if matches!(status.as_u16(), 401 | 403) {
        if let Some(fresh) = current_access_token() {
          if fresh != config.access_token {
            match send_increment(client, &url, &fresh).await {
              Ok(retry) if retry.status().is_success() => {
                let retry_body = retry.text().await.unwrap_or_default();
                tracker_log::push_kv(
                  "info",
                  "http",
                  &[
                    ("event", "auth_retried".to_string()),
                    ("game", game_id.to_string()),
                    ("outcome", "credited with the refreshed session".to_string()),
                  ],
                );
                return CreditOutcome::Credited {
                  server_minutes: parse_server_minutes(&retry_body),
                };
              }
              Ok(retry) => tracker_log::push_kv(
                "warn",
                "http",
                &[
                  ("event", "auth_retried".to_string()),
                  ("game", game_id.to_string()),
                  ("outcome", "still rejected".to_string()),
                  ("status", retry.status().as_u16().to_string()),
                ],
              ),
              Err(error) => tracker_log::push_kv(
                "warn",
                "http",
                &[
                  ("event", "auth_retried".to_string()),
                  ("game", game_id.to_string()),
                  ("outcome", format!("network error: {error}")),
                ],
              ),
            }
          }
        }
        apply_auth_backoff(app, status.as_u16());
      }
      save_offline_time(installed, config, game_id);
      CreditOutcome::Offline {
        reason: format!("http {} ({})", status.as_u16(), excerpt(&body, 160)),
      }
    }
    CreditDisposition::Drop => CreditOutcome::Lost {
      reason: format!("http {} ({})", status.as_u16(), excerpt(&body, 160)),
    },
  }
}

pub(crate) fn process_matches_game(process: &sysinfo::Process, game_exe: &Path) -> bool {
  // Direct binary: the process exe path resolves to the game executable.
  if let Some(exe) = process.exe() {
    if paths_match(game_exe, exe) {
      return true;
    }
  }
  // Script-launched games run via an interpreter (e.g. /bin/sh); its argv
  // references the actual script/binary, so also match the command line.
  process.cmd().iter().any(|arg| {
    let arg_path = Path::new(arg);
    if paths_match(game_exe, arg_path) {
      return true;
    }
    // Relative / basename args (e.g. "./game.sh") can't be canonicalized
    // against our CWD; fall back to comparing the file name.
    matches_game_file_name(game_exe, arg_path)
  })
}

pub(crate) fn matches_game_file_name(game_exe: &Path, arg: &Path) -> bool {
  match (game_exe.file_name(), arg.file_name()) {
    (Some(a), Some(b)) => a == b,
    _ => false,
  }
}

fn read_configured_launch_executable(version_dir: &Path) -> Option<PathBuf> {
  let config_path = version_dir.join(".gamevault.game.config.json");
  let content = fs::read_to_string(config_path).ok()?;
  let value: serde_json::Value = serde_json::from_str(&content).ok()?;
  let exe = value.get("launchexecutable")?.as_str()?;
  if exe.trim().is_empty() {
    return None;
  }
  Some(PathBuf::from(exe))
}

/// Builds the offline file content, keeping `accumulated_minutes` monotonic.
///
/// This is the safety net for every minute the server did not accept: the file
/// is only ever incremented and is replayed once a session works again. Older
/// files (written before `updated_at`/`server_url` existed) are still readable,
/// because only `accumulated_minutes` matters for the count.
fn offline_payload(
  existing: Option<&str>,
  user_id: i64,
  game_id: i64,
  server_url: &str,
  at_ms: u64,
) -> (i64, serde_json::Value) {
  let current_minutes = existing
    .and_then(|content| serde_json::from_str::<serde_json::Value>(content).ok())
    .and_then(|json| {
      json
        .get("accumulated_minutes")
        .and_then(|value| value.as_i64())
    })
    .unwrap_or(0)
    .max(0);

  let accumulated = current_minutes + 1;
  let data = serde_json::json!({
    "user_id": user_id,
    "game_id": game_id,
    "accumulated_minutes": accumulated,
    "updated_at": at_ms / 1000,
    "server_url": server_url,
  });
  (accumulated, data)
}

/// Stores one uncredited minute in the game's offline file. Returns the path it
/// wrote to, so the caller can log where the playtime went.
fn save_offline_time(
  installed: &[InstalledGameInfo],
  config: &TrackerConfig,
  game_id: i64,
) -> Option<PathBuf> {
  let target = match installed.iter().find(|game| game.game_id == game_id) {
    Some(game) => game,
    None => {
      tracker_log::push_kv(
        "error",
        "offline",
        &[
          ("event", "offline_save_failed".to_string()),
          ("game", game_id.to_string()),
          (
            "reason",
            "the game is no longer in the library, so the minute could not be stored offline"
              .to_string(),
          ),
        ],
      );
      return None;
    }
  };

  let offline_file = PathBuf::from(&target.version_directory).join(".gamevault.offline_time.json");
  let existing = fs::read_to_string(&offline_file).ok();
  let (accumulated, data) = offline_payload(
    existing.as_deref(),
    config.user_id,
    game_id,
    &config.server_url,
    tracker_log::now_ms(),
  );

  match fs::write(&offline_file, serde_json::to_string(&data).unwrap_or_default()) {
    Ok(()) => {
      tracker_log::push_kv(
        "info",
        "offline",
        &[
          ("event", "offline_saved".to_string()),
          ("game", game_id.to_string()),
          ("title", target.game_title.clone()),
          ("accumulated_minutes", accumulated.to_string()),
          ("path", offline_file.to_string_lossy().to_string()),
        ],
      );
      Some(offline_file)
    }
    Err(error) => {
      tracker_log::push_kv(
        "error",
        "offline",
        &[
          ("event", "offline_save_failed".to_string()),
          ("game", game_id.to_string()),
          ("error", error.to_string()),
          ("path", offline_file.to_string_lossy().to_string()),
        ],
      );
      None
    }
  }
}

// ── Offline time tracking commands ────────────────────────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OfflineTimeFile {
  path: String,
  user_id: i64,
  game_id: i64,
  accumulated_minutes: i64,
  /// Unix seconds of the last write (0 for files from older builds).
  updated_at: i64,
}

#[tauri::command]
pub(crate) async fn get_offline_time_files(
  selected_root: String,
) -> Result<Vec<OfflineTimeFile>, String> {
  // Walks the library for offline time files: off the UI thread.
  tauri::async_runtime::spawn_blocking(move || get_offline_time_files_blocking(selected_root))
    .await
    .map_err(|error| format!("Reading offline time files failed: {error}"))?
}

fn get_offline_time_files_blocking(
  selected_root: String,
) -> Result<Vec<OfflineTimeFile>, String> {
  let candidate = PathBuf::from(&selected_root).join("GameVault");
  let base = if candidate.exists() { candidate } else { PathBuf::from(&selected_root) };

  let mut results = Vec::new();
  walk_offline_time_files(&base, &mut results)
    .map_err(|e| format!("Failed to scan for offline time files: {e}"))?;
  Ok(results)
}

fn walk_offline_time_files(dir: &Path, results: &mut Vec<OfflineTimeFile>) -> std::io::Result<()> {
  if !dir.exists() || !dir.is_dir() {
    return Ok(());
  }
  for entry in fs::read_dir(dir)? {
    let entry = entry?;
    let path = entry.path();
    if path.is_dir() {
      let name = entry.file_name().to_string_lossy().to_string();
      if name == ".cache" || name == "Download" || name == "Extraction" {
        continue;
      }
      walk_offline_time_files(&path, results)?;
    } else if entry.file_name() == ".gamevault.offline_time.json" {
      if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
          let user_id = json.get("user_id").and_then(|v| v.as_i64()).unwrap_or(0);
          let game_id = json.get("game_id").and_then(|v| v.as_i64()).unwrap_or(0);
          let accumulated_minutes = json.get("accumulated_minutes").and_then(|v| v.as_i64()).unwrap_or(0);
          let updated_at = json.get("updated_at").and_then(|v| v.as_i64()).unwrap_or(0);
          results.push(OfflineTimeFile {
            path: path.to_string_lossy().to_string(),
            user_id,
            game_id,
            accumulated_minutes,
            updated_at,
          });
        }
      }
    }
  }
  Ok(())
}

#[tauri::command]
pub(crate) fn delete_offline_time_file(path: String) -> Result<(), String> {
  let p = Path::new(&path);
  if p.exists() {
    fs::remove_file(p).map_err(|e| format!("Failed to delete offline time file: {e}"))?;
    tracker_log::push_kv(
      "info",
      "offline",
      &[
        ("event", "offline_file_deleted".to_string()),
        ("path", path.clone()),
      ],
    );
  }
  Ok(())
}

#[tauri::command]
pub(crate) async fn sync_offline_time(
  server_url: String,
  access_token: String,
  user_id: i64,
  game_id: i64,
  minutes: i64,
  reason: Option<String>,
) -> Result<bool, String> {
  let reason = reason.unwrap_or_else(|| "unspecified".to_string());
  let url = format!(
    "{}/api/progresses/user/{}/game/{}/increment/{}",
    server_url, user_id, game_id, minutes
  );
  let client = reqwest::Client::new();
  let resp = match client
    .put(&url)
    .header("Authorization", format!("Bearer {}", access_token))
    .header("Accept", "application/json")
    .send()
    .await
  {
    Ok(resp) => resp,
    Err(error) => {
      tracker_log::push_kv(
        "warn",
        "offline",
        &[
          ("event", "offline_replay_failed".to_string()),
          ("game", game_id.to_string()),
          ("minutes", minutes.to_string()),
          ("reason", reason),
          ("error", error.to_string()),
        ],
      );
      return Err(format!("Sync request failed: {error}"));
    }
  };

  let status = resp.status();
  let success = status.is_success();
  let body = resp.text().await.unwrap_or_default();

  tracker_log::push_kv(
    if success { "info" } else { "warn" },
    "offline",
    &[
      ("event", "offline_replayed".to_string()),
      ("game", game_id.to_string()),
      ("minutes", minutes.to_string()),
      ("user_id", user_id.to_string()),
      ("reason", reason.clone()),
      ("status", status.as_u16().to_string()),
      ("success", success.to_string()),
      (
        "message",
        if success {
          "offline playtime was credited by the server".to_string()
        } else {
          "offline playtime was rejected and kept for the next attempt".to_string()
        },
      ),
    ],
  );

  // Keep the ledger in sync: those minutes are no longer waiting offline.
  if success {
    if let Ok(mut ledger) = tracker_ledger().lock() {
      let entry = ledger.entry(game_id).or_default();
      entry.game_id = game_id;
      entry.offline_minutes = entry
        .offline_minutes
        .saturating_sub(minutes.max(0) as u64);
      // Replayed minutes belong to an earlier session, so they are counted
      // separately and never inflate this session's credited total.
      entry.replayed_minutes += minutes.max(0) as u64;
      if let Some(server_minutes) = parse_server_minutes(&body) {
        entry.last_server_minutes = Some(server_minutes);
      }
    }
  }

  Ok(success)
}

// ── Debug diagnostics ────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DebugTrackerReport {
  pub tracker_running: bool,
  pub roots: Vec<String>,
  pub total_processes: usize,
  pub all_processes: Vec<DebugProcess>,
  pub games: Vec<DebugGameEntry>,
  pub process_matches: Vec<DebugProcessMatch>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DebugProcess {
  pub pid: u32,
  pub exe: Option<String>,
  pub cmd: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DebugGameEntry {
  pub game_id: i64,
  pub game_title: String,
  pub installation_directory: String,
  pub version_directory: String,
  pub exe_candidates: Vec<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DebugProcessMatch {
  pub game_id: i64,
  pub matched: bool,
  pub matching_processes: Vec<String>,
}

/// Debug helper: replays the exact scan the time tracker performs and reports
/// which installed games, executable candidates and process matches it finds.
#[tauri::command]
pub(crate) async fn debug_tracker_scan(
  app: tauri::AppHandle,
  selected_root: Option<String>,
) -> Result<DebugTrackerReport, String> {
  // Replays a full library + process scan: off the UI thread.
  tauri::async_runtime::spawn_blocking(move || debug_tracker_scan_blocking(app, selected_root))
    .await
    .map_err(|error| format!("Tracker scan failed: {error}"))?
}

fn debug_tracker_scan_blocking(
  _app: tauri::AppHandle,
  selected_root: Option<String>,
) -> Result<DebugTrackerReport, String> {
  let tracker_running = tracker_config().lock().map(|g| g.is_some()).unwrap_or(false);

  let mut roots: Vec<String> = Vec::new();
  if let Some(root) = selected_root.filter(|r| !r.trim().is_empty()) {
    roots.push(root);
  } else if let Ok(guard) = tracker_config().lock() {
    if let Some(config) = guard.as_ref() {
      roots = config.download_paths.clone();
    }
  }
  if roots.is_empty() {
    roots.push(std::env::current_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_default());
  }

  let mut installed = Vec::new();
  for root in &roots {
    if let Ok(games) = list_installed_games_blocking(root.clone()) {
      installed.extend(games);
    }
  }

  let mut system = System::new();
  system.refresh_processes_specifics(
    ProcessesToUpdate::All,
    true,
    ProcessRefreshKind::everything(),
  );
  let processes: Vec<&sysinfo::Process> = system.processes().values().collect();

  // Dump everything sysinfo sees so we can verify the wine/umu processes are
  // present at all (and with their cmdlines) when a game is running.
  let total_processes = processes.len();
  let mut all_processes: Vec<DebugProcess> = processes
    .iter()
    .take(400)
    .map(|p| {
      let cmd: Vec<String> = p.cmd().iter().map(|c| c.to_string_lossy().to_string()).collect();
      let mut joined = cmd.join(" ");
      if joined.len() > 160 {
        joined.truncate(160);
      }
      DebugProcess {
        pid: p.pid().as_u32(),
        exe: p.exe().map(|e| e.to_string_lossy().to_string()),
        cmd: joined,
      }
    })
    .collect();
  all_processes.sort_by(|a, b| a.pid.cmp(&b.pid));

  let mut games = Vec::new();
  let mut process_matches = Vec::new();

  for game in &installed {
    let configured_install = PathBuf::from(&game.installation_directory);
    let mut scan_dir = configured_install.clone();
    if !scan_dir.exists() || !scan_dir.is_dir() {
      scan_dir = PathBuf::from(&game.version_directory);
    }

    let mut abs_paths: Vec<PathBuf> = Vec::new();
    if let Some(rel_exe) = read_configured_launch_executable(Path::new(&game.version_directory)) {
      let abs = scan_dir.join(rel_exe);
      if abs.exists() {
        abs_paths.push(abs);
      }
    }
    let mut candidates = Vec::new();
    if collect_launch_candidates(&scan_dir, &scan_dir, &mut candidates).is_ok() {
      for rel in candidates {
        abs_paths.push(scan_dir.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR)));
      }
    }

    let matching: Vec<String> = processes
      .iter()
      .filter(|p| abs_paths.iter().any(|exe| process_matches_game(p, exe)))
      .map(|p| {
        let cmd: Vec<String> = p.cmd().iter().map(|c| c.to_string_lossy().to_string()).collect();
        format!("[{}] {}", p.pid(), cmd.join(" "))
      })
      .collect();

    process_matches.push(DebugProcessMatch {
      game_id: game.game_id,
      matched: !matching.is_empty(),
      matching_processes: matching,
    });
    games.push(DebugGameEntry {
      game_id: game.game_id,
      game_title: game.game_title.clone(),
      installation_directory: game.installation_directory.clone(),
      version_directory: game.version_directory.clone(),
      exe_candidates: abs_paths.iter().map(|p| p.to_string_lossy().to_string()).collect(),
    });
  }

  Ok(DebugTrackerReport {
    tracker_running,
    roots,
    total_processes,
    all_processes,
    games,
    process_matches,
  })
}

// ── Runtime status ───────────────────────────────────────────────────────────

/// Diagnostics snapshot: loop counters plus the per-game playtime ledger.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrackerStatus {
  pub tracker_running: bool,
  pub stats: TrackerRuntimeStats,
  pub games: Vec<GamePlayLedger>,
  pub log_path: Option<String>,
  /// Minutes stored offline that still need a successful sync.
  pub pending_offline_minutes: u64,
}

#[tauri::command]
pub(crate) fn get_tracker_status() -> TrackerStatus {
  let mut stats = tracker_stats().lock().map(|stats| stats.clone()).unwrap_or_default();
  stats.log_path = tracker_log::log_path();

  let running = tracker_config().lock().map(|config| config.is_some()).unwrap_or(false)
    || stats.running;
  stats.running = running;

  TrackerStatus {
    tracker_running: running,
    stats,
    games: tracker_ledger_snapshot(),
    log_path: tracker_log::log_path(),
    pending_offline_minutes: pending_offline_minutes(),
  }
}

/// Clears the playtime ledger so a fresh measurement can be taken.
#[tauri::command]
pub(crate) fn reset_tracker_ledger() -> Result<(), String> {
  if let Ok(mut ledger) = tracker_ledger().lock() {
    ledger.clear();
  }
  if let Ok(mut stats) = tracker_stats().lock() {
    let started_at = tracker_log::now_ms();
    let lost_ticks = stats.lost_ticks;
    stats.tick_count = 0;
    stats.lost_ticks = 0;
    stats.catch_up_ticks = 0;
    stats.consecutive_failures = 0;
    stats.auth_rejected_count = 0;
    stats.started_at = Some(started_at);
    tracker_log::push(
      "info",
      "lifecycle",
      &format!("tracker counters reset (previous lost_ticks={lost_ticks})"),
    );
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn classifies_increment_responses() {
    assert_eq!(classify_status(200), CreditDisposition::Success);
    assert_eq!(classify_status(204), CreditDisposition::Success);
    // Expired token / server problems: keep the minute offline.
    assert_eq!(classify_status(401), CreditDisposition::SaveOffline);
    assert_eq!(classify_status(403), CreditDisposition::SaveOffline);
    assert_eq!(classify_status(408), CreditDisposition::SaveOffline);
    assert_eq!(classify_status(429), CreditDisposition::SaveOffline);
    assert_eq!(classify_status(500), CreditDisposition::SaveOffline);
    assert_eq!(classify_status(503), CreditDisposition::SaveOffline);
    // Provider errors must not create offline time (game gone, bad request).
    assert_eq!(classify_status(400), CreditDisposition::Drop);
    assert_eq!(classify_status(404), CreditDisposition::Drop);
  }

  #[test]
  fn parses_server_reported_minutes() {
    assert_eq!(
      parse_server_minutes(r#"{"minutes_played": 61, "state": "playing"}"#),
      Some(61)
    );
    assert_eq!(parse_server_minutes(r#"{"minutes_played": null}"#), None);
    assert_eq!(parse_server_minutes(""), None);
    assert_eq!(parse_server_minutes("<html>"), None);
  }

  #[test]
  fn estimates_dropped_ticks_from_a_gap() {
    // Rounds to the nearest tick and never reports the tick that just ran.
    assert_eq!(dropped_ticks_for_gap(60), 0);
    assert_eq!(dropped_ticks_for_gap(65), 0);
    assert_eq!(dropped_ticks_for_gap(90), 1);
    assert_eq!(dropped_ticks_for_gap(180), 2);
    assert_eq!(dropped_ticks_for_gap(3_600), 59);
  }

  #[test]
  fn excerpts_long_bodies() {
    assert_eq!(excerpt("short", 20), "short");
    assert_eq!(excerpt("line\nbreak", 40), "line break");
    let trimmed = excerpt(&"x".repeat(30), 10);
    assert_eq!(trimmed.chars().count(), 11);
    assert!(trimmed.ends_with('…'));
  }

  #[test]
  fn offline_payload_counts_up_from_legacy_files() {
    // A file from an older build only has accumulated_minutes.
    let legacy = r#"{"user_id": 1, "game_id": 2341, "accumulated_minutes": 61}"#;
    let (accumulated, data) = offline_payload(Some(legacy), 1, 2341, "https://example.test", 1_700_000_000_000);
    assert_eq!(accumulated, 62);
    assert_eq!(data["accumulated_minutes"].as_i64(), Some(62));
    assert_eq!(data["game_id"].as_i64(), Some(2341));
    assert_eq!(data["user_id"].as_i64(), Some(1));
    assert_eq!(data["updated_at"].as_i64(), Some(1_700_000_000));
    assert_eq!(data["server_url"].as_str(), Some("https://example.test"));
  }

  #[test]
  fn offline_payload_starts_at_one_and_survives_damage() {
    let (first, _) = offline_payload(None, 1, 7, "https://example.test", 0);
    assert_eq!(first, 1);

    // Unreadable/garbage content must not reset the counter backwards.
    let (from_garbage, _) = offline_payload(Some("<html>"), 1, 7, "https://example.test", 0);
    assert_eq!(from_garbage, 1);

    // Negative values (hand-edited file) are clamped, never decreased further.
    let negative = r#"{"accumulated_minutes": -5}"#;
    let (clamped, _) = offline_payload(Some(negative), 1, 7, "https://example.test", 0);
    assert_eq!(clamped, 1);
  }

  #[test]
  fn auth_backoff_grows_and_caps() {
    let retry_for = |streak: usize| AUTH_BACKOFF_SECS[(streak - 1).min(AUTH_BACKOFF_SECS.len() - 1)];
    assert_eq!(retry_for(1), 60);
    assert_eq!(retry_for(2), 120);
    assert_eq!(retry_for(3), 300);
    assert_eq!(retry_for(4), 900);
    // Stays capped: an hour-long rejection streak must not grow unbounded.
    assert_eq!(retry_for(60), 900);
  }
}
