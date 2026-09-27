//! Time tracker diagnostics log.
//!
//! The game time tracker credits exactly one minute per matched tick, so a
//! playtime that ends up lower than what was actually played is always caused
//! by lost ticks (sleep/resume, freeze, starvation), lost matches (launcher
//! exits, protection re-exec, missing executables) or dropped requests (expired
//! token, server errors, offline). Everything that can lose a minute is
//! recorded here, always on — also in release builds — so a bug report can show
//! the expected-versus-credited timeline per game.
//!
//! The log is written to a rotating file in the app log directory
//! (`tracker-logs/tracker.log`) and kept in a bounded in-memory tail that the
//! settings dump reads. Secrets are never logged: tokens are reduced to a
//! fingerprint via [`redact_token`].

use serde::Serialize;
use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

/// Maximum number of lines kept in memory (oldest are dropped).
const MAX_TAIL_LINES: usize = 3_000;
/// Rotate the active file once it grows past this size.
const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;
/// Number of rotated log files kept on disk (oldest are deleted).
const MAX_LOG_FILES: usize = 10;
/// Active log file name inside the tracker log directory.
const ACTIVE_FILE_NAME: &str = "tracker.log";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TrackerLogLine {
  pub seq: u64,
  /// Milliseconds since the unix epoch.
  pub at: u64,
  /// `info`, `warn`, `error` or `tick`.
  pub level: String,
  /// Coarse origin, e.g. `lifecycle`, `tick`, `game`, `http`, `ledger`, `app`.
  pub category: String,
  pub text: String,
}

pub(crate) struct TrackerLog {
  seq: AtomicU64,
  written: AtomicU64,
  lines: Mutex<VecDeque<TrackerLogLine>>,
  file: Mutex<Option<BufWriter<File>>>,
  path: Mutex<Option<PathBuf>>,
}

static LOG: OnceLock<Mutex<Option<Arc<TrackerLog>>>> = OnceLock::new();

fn store() -> &'static Mutex<Option<Arc<TrackerLog>>> {
  LOG.get_or_init(|| Mutex::new(None))
}

/// Milliseconds since the unix epoch.
pub(crate) fn now_ms() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_millis() as u64)
    .unwrap_or(0)
}

/// Absolute path of the directory holding the tracker logs.
pub(crate) fn log_directory(app: &AppHandle) -> Option<PathBuf> {
  let dir = app.path().app_log_dir().ok()?.join("tracker-logs");
  fs::create_dir_all(&dir).ok()?;
  Some(dir)
}

/// Starts (or restarts) the tracker log. Safe to call more than once.
pub(crate) fn init(app: &AppHandle) {
  let Some(dir) = log_directory(app) else {
    return;
  };

  let path = dir.join(ACTIVE_FILE_NAME);
  let file = OpenOptions::new()
    .create(true)
    .append(true)
    .open(&path)
    .ok()
    .map(BufWriter::new);

  let written = file
    .as_ref()
    .and_then(|_| fs::metadata(&path).ok())
    .map(|metadata| metadata.len())
    .unwrap_or(0);

  let log = Arc::new(TrackerLog {
    seq: AtomicU64::new(0),
    written: AtomicU64::new(written),
    lines: Mutex::new(VecDeque::new()),
    file: Mutex::new(file),
    path: Mutex::new(Some(path)),
  });

  match store().lock() {
    Ok(mut guard) => *guard = Some(log.clone()),
    Err(_) => return,
  }

  prune_old_files(&dir);
  push(
    "info",
    "lifecycle",
    &format!("=== tracker log started (v{}) ===", env!("CARGO_PKG_VERSION")),
  );
}

/// Returns the active log file path, if the logger has been initialized.
pub(crate) fn log_path() -> Option<String> {
  store()
    .lock()
    .ok()
    .and_then(|guard| guard.as_ref().cloned())
    .and_then(|log| {
      log
        .path
        .lock()
        .ok()
        .and_then(|value| value.as_ref().map(|p| p.to_string_lossy().to_string()))
    })
}

/// Appends one line to the in-memory tail and the log file.
pub(crate) fn push(level: &str, category: &str, text: &str) {
  match level {
    "error" => log::error!("[tracker:{category}] {text}"),
    "warn" => log::warn!("[tracker:{category}] {text}"),
    _ => log::info!("[tracker:{category}] {text}"),
  }

  let log = match store().lock() {
    Ok(guard) => guard.as_ref().cloned(),
    Err(_) => None,
  };
  let Some(log) = log else {
    return;
  };

  let seq = log.seq.fetch_add(1, Ordering::SeqCst);
  let at = now_ms();
  let line = TrackerLogLine {
    seq,
    at,
    level: level.to_string(),
    category: category.to_string(),
    text: text.to_string(),
  };

  if let Ok(mut lines) = log.lines.lock() {
    lines.push_back(line.clone());
    while lines.len() > MAX_TAIL_LINES {
      lines.pop_front();
    }
  }

  let rendered = format_line(&line) + "\n";
  let mut rotate = false;
  if let Ok(mut guard) = log.file.lock() {
    if let Some(writer) = guard.as_mut() {
      if writer.write_all(rendered.as_bytes()).is_ok() && writer.flush().is_ok() {
        let total = log
          .written
          .fetch_add(rendered.len() as u64, Ordering::SeqCst)
          + rendered.len() as u64;
        rotate = total >= MAX_FILE_BYTES;
      }
    }
  }
  if rotate {
    rotate_active_file(&log);
  }
}

/// Appends a `key=value` line. Values are quoted when they contain a space.
pub(crate) fn push_kv(level: &str, category: &str, fields: &[(&str, String)]) {
  push(level, category, &format_kv(fields));
}

/// Renders fields as `key=value` pairs, quoting values that need it.
pub(crate) fn format_kv(fields: &[(&str, String)]) -> String {
  fields
    .iter()
    .map(|(key, value)| {
      if value.contains(' ') || value.is_empty() {
        format!("{key}=\"{value}\"")
      } else {
        format!("{key}={value}")
      }
    })
    .collect::<Vec<_>>()
    .join(" ")
}

fn rotate_active_file(log: &Arc<TrackerLog>) {
  let path = match log.path.lock() {
    Ok(guard) => guard.clone(),
    Err(_) => None,
  };
  let Some(path) = path else {
    return;
  };
  let directory = match path.parent() {
    Some(directory) => directory.to_path_buf(),
    None => return,
  };

  // Drop the writer first so the file handle is closed before renaming.
  if let Ok(mut guard) = log.file.lock() {
    *guard = None;
  }

  let rotated = directory.join(format!("tracker-{}.log", now_ms() / 1000));
  let renamed = fs::rename(&path, &rotated).is_ok();

  if let Ok(mut guard) = log.file.lock() {
    *guard = OpenOptions::new()
      .create(true)
      .append(true)
      .open(&path)
      .ok()
      .map(BufWriter::new);
  }
  log.written.store(0, Ordering::SeqCst);

  if renamed {
    push(
      "info",
      "lifecycle",
      &format!(
        "rotated tracker log to {}",
        rotated.file_name().unwrap_or_default().to_string_lossy()
      ),
    );
    prune_old_files(&directory);
  }
}

fn prune_old_files(directory: &Path) {
  let Ok(entries) = fs::read_dir(directory) else {
    return;
  };
  let mut files: Vec<PathBuf> = entries
    .flatten()
    .map(|entry| entry.path())
    .filter(|path| {
      path
        .file_name()
        .map(|name| name.to_string_lossy().starts_with("tracker-"))
        .unwrap_or(false)
    })
    .collect();
  files.sort();
  while files.len() > MAX_LOG_FILES {
    let oldest = files.remove(0);
    let _ = fs::remove_file(oldest);
  }
}

/// Formats one line: `2026-09-26 10:15:23.123 [tick] text`.
fn format_line(line: &TrackerLogLine) -> String {
  format!(
    "{} [{}] {}",
    format_timestamp(line.at),
    line.level,
    line.text
  )
}

/// Formats unix milliseconds as `YYYY-MM-DD HH:MM:SS.mmm` (UTC).
pub(crate) fn format_timestamp(unix_ms: u64) -> String {
  let secs = (unix_ms / 1000) as i64;
  let millis = (unix_ms % 1000) as u32;
  let days = secs.div_euclid(86_400);
  let rest = secs.rem_euclid(86_400);
  let (year, month, day) = civil_from_days(days);
  format!(
    "{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02}.{millis:03}",
    rest / 3600,
    (rest % 3600) / 60,
    rest % 60
  )
}

/// Howard Hinnant's civil-from-days algorithm (days since 1970-01-01 → Y/M/D).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
  let z = days + 719_468;
  let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
  let doe = (z - era * 146_097) as i64;
  let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
  let year = yoe + era * 400;
  let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  let mp = (5 * doy + 2) / 153;
  let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
  let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
  (if month <= 2 { year + 1 } else { year }, month, day)
}

/// Never log a raw token: returns a fingerprint with length and last 6 chars.
pub(crate) fn redact_token(token: &str) -> String {
  if token.is_empty() {
    return "none".to_string();
  }
  let tail: String = token
    .chars()
    .rev()
    .take(6)
    .collect::<Vec<_>>()
    .into_iter()
    .rev()
    .collect();
  format!("<len {} tail …{}>", token.chars().count(), tail)
}

/// Returns the in-memory tail, oldest first.
pub(crate) fn tail(limit: usize) -> Vec<TrackerLogLine> {
  let log = match store().lock() {
    Ok(guard) => guard.as_ref().cloned(),
    Err(_) => None,
  };
  let Some(log) = log else {
    return Vec::new();
  };
  let lines = match log.lines.lock() {
    Ok(lines) => lines,
    Err(_) => return Vec::new(),
  };
  let skip = lines.len().saturating_sub(limit);
  lines.iter().skip(skip).cloned().collect()
}

fn clear(app: &AppHandle) {
  let log = match store().lock() {
    Ok(guard) => guard.as_ref().cloned(),
    Err(_) => None,
  };
  if let Some(log) = log.as_ref() {
    if let Ok(mut lines) = log.lines.lock() {
      lines.clear();
    }
    // Close the writer before the file is deleted below.
    if let Ok(mut guard) = log.file.lock() {
      *guard = None;
    }
  }

  let Some(directory) = log_directory(app) else {
    return;
  };
  if let Ok(entries) = fs::read_dir(&directory) {
    for entry in entries.flatten() {
      let _ = fs::remove_file(entry.path());
    }
  }

  if let Some(log) = log {
    let path = directory.join(ACTIVE_FILE_NAME);
    if let Ok(mut guard) = log.file.lock() {
      *guard = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .ok()
        .map(BufWriter::new);
    }
    if let Ok(mut guard) = log.path.lock() {
      *guard = Some(path);
    }
    log.written.store(0, Ordering::SeqCst);
  }
  push("info", "lifecycle", "tracker log cleared");
}

// ── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
pub(crate) fn get_tracker_log(limit: Option<usize>) -> Vec<TrackerLogLine> {
  tail(limit.unwrap_or(MAX_TAIL_LINES).min(MAX_TAIL_LINES))
}

#[tauri::command]
pub(crate) fn clear_tracker_log(app: AppHandle) -> Result<(), String> {
  clear(&app);
  Ok(())
}

#[tauri::command]
pub(crate) fn open_tracker_log_folder(app: AppHandle) -> Result<(), String> {
  let dir = log_directory(&app).ok_or_else(|| "Log directory unavailable".to_string())?;
  crate::games::open_in_file_explorer(dir.to_string_lossy().to_string())
}

/// Reads the tail of a tracker log file (for rotated files).
#[tauri::command]
pub(crate) fn read_tracker_log_file(path: String, max_bytes: Option<u64>) -> Result<String, String> {
  let mut file =
    File::open(&path).map_err(|error| format!("Failed to open tracker log: {error}"))?;
  let length = file
    .metadata()
    .map_err(|error| format!("Failed to read tracker log: {error}"))?
    .len();
  let max_bytes = max_bytes.unwrap_or(512 * 1024);
  let start = length.saturating_sub(max_bytes);
  if start > 0 {
    file.seek(SeekFrom::Start(start))
      .map_err(|error| format!("Failed to read tracker log: {error}"))?;
  }
  let mut buffer = String::new();
  file
    .read_to_string(&mut buffer)
    .map_err(|error| format!("Failed to read tracker log: {error}"))?;
  if start > 0 {
    if let Some(index) = buffer.find('\n') {
      buffer.drain(..=index);
    }
  }
  Ok(buffer)
}

/// Lets the frontend record lifecycle decisions in the same log.
#[tauri::command]
pub(crate) fn tracker_log_line(level: String, category: String, message: String) {
  push(&level, &format!("app:{category}"), &message);
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn formats_unix_millis_as_utc_timestamp() {
    assert_eq!(format_timestamp(0), "1970-01-01 00:00:00.000");
    assert_eq!(format_timestamp(1_000), "1970-01-01 00:00:01.000");
    // Well-known epoch: 2020-09-13 12:26:40 UTC
    assert_eq!(format_timestamp(1_600_000_000_000), "2020-09-13 12:26:40.000");
    // Leap-day sanity check: 2024-02-29 00:00:00 UTC
    assert_eq!(format_timestamp(1_709_164_800_000), "2024-02-29 00:00:00.000");
  }

  #[test]
  fn redacts_tokens() {
    assert_eq!(redact_token(""), "none");
    let redacted = redact_token("abcdefghijklmnop");
    assert!(!redacted.contains("abcdefghij"));
    assert!(redacted.contains("klmnop"));
    assert!(redacted.contains("16"));
  }

  #[test]
  fn formats_key_value_lines() {
    let text = format_kv(&[
      ("tick", "7".to_string()),
      ("game", "42".to_string()),
      ("title", "My Game".to_string()),
    ]);
    assert_eq!(text, "tick=7 game=42 title=\"My Game\"");
  }

  #[test]
  fn tail_is_empty_without_logger() {
    assert!(tail(10).is_empty());
  }
}
