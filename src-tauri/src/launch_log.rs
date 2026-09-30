//! Launch logs.
//!
//! Every game launch (and umu installer run) is recorded here: the full output
//! is written to a rotating log file in the app log directory and kept in a
//! bounded in-memory tail, which the "Launch log" window streams live. The logs
//! are always written, so a crash can be reported with a complete log even when
//! the user never opened the window.

use serde::Serialize;
use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// Maximum number of lines kept in memory (oldest are dropped).
const MAX_TAIL_LINES: usize = 5_000;
/// Stop writing to the log file after this many bytes.
const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;
/// Number of log files kept on disk (oldest are deleted).
const MAX_LOG_FILES: usize = 20;
/// Batching interval for the live stream to the log window.
const FLUSH_INTERVAL: Duration = Duration::from_millis(150);

pub const WINDOW_LABEL: &str = "launch-log";
pub const LINES_EVENT: &str = "launch-log-lines";
pub const STATE_EVENT: &str = "launch-log-state";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LaunchLogLine {
  pub seq: u64,
  /// "out", "err" or "info".
  pub stream: String,
  pub text: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LaunchLogSnapshot {
  pub id: u64,
  pub title: String,
  pub kind: String,
  pub status: String,
  pub exit_code: Option<i32>,
  pub path: Option<String>,
  pub truncated: bool,
  pub next_seq: u64,
  pub lines: Vec<LaunchLogLine>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LaunchLogEntry {
  pub id: u64,
  pub title: String,
  pub kind: String,
  pub status: String,
  pub path: Option<String>,
  pub started_at: u64,
  pub lines: usize,
}

pub(crate) struct LaunchLog {
  id: u64,
  title: String,
  kind: String,
  started_at: u64,
  status: Mutex<String>,
  exit_code: AtomicI64,
  seq: AtomicU64,
  truncated: AtomicBool,
  finished: AtomicBool,
  /// Bytes written to the file so far.
  written: AtomicU64,
  file: Mutex<Option<BufWriter<File>>>,
  path: Mutex<Option<PathBuf>>,
  lines: Mutex<VecDeque<LaunchLogLine>>,
  pending: Mutex<Vec<LaunchLogLine>>,
}

static CURRENT: OnceLock<Mutex<Option<Arc<LaunchLog>>>> = OnceLock::new();
static HISTORY: OnceLock<Mutex<VecDeque<LaunchLogEntry>>> = OnceLock::new();
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn current_store() -> &'static Mutex<Option<Arc<LaunchLog>>> {
  CURRENT.get_or_init(|| Mutex::new(None))
}

fn history_store() -> &'static Mutex<VecDeque<LaunchLogEntry>> {
  HISTORY.get_or_init(|| Mutex::new(VecDeque::new()))
}

/// Directory that holds the rotating launch log files.
pub(crate) fn log_directory(app: &AppHandle) -> Option<PathBuf> {
  let dir = app.path().app_log_dir().ok()?.join("launch-logs");
  fs::create_dir_all(&dir).ok()?;
  Some(dir)
}

fn slugify(value: &str) -> String {
  let mut slug: String = value
    .chars()
    .map(|c| {
      if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' {
        c
      } else {
        '-'
      }
    })
    .collect();
  slug = slug.trim_matches('-').to_string();
  if slug.is_empty() {
    "launch".to_string()
  } else {
    slug.truncate(60);
    slug
  }
}

fn unix_now() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|value| value.as_secs())
    .unwrap_or(0)
}

/// Deletes the oldest log files so only the newest `MAX_LOG_FILES` remain.
fn rotate_log_files(dir: &Path) {
  let Ok(entries) = fs::read_dir(dir) else {
    return;
  };
  let mut files: Vec<PathBuf> = entries
    .flatten()
    .filter(|entry| entry.path().extension().and_then(|e| e.to_str()) == Some("log"))
    .map(|entry| entry.path())
    .collect();
  files.sort();
  while files.len() >= MAX_LOG_FILES {
    let oldest = files.remove(0);
    let _ = fs::remove_file(oldest);
  }
}

/// Starts a new launch log. Any log that is still running is finished first.
pub(crate) fn begin_launch(app: &AppHandle, title: &str, kind: &str) -> Arc<LaunchLog> {
  if let Ok(guard) = current_store().lock() {
    if let Some(previous) = guard.as_ref() {
      if !previous.finished.load(Ordering::SeqCst) {
        previous.finish(app, "finished", None);
      }
    }
  }

  let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
  let path = log_directory(app).map(|dir| {
    rotate_log_files(&dir);
    dir.join(format!("{}-{}-{}.log", unix_now(), id, slugify(title)))
  });

  let file = path.as_ref().and_then(|path| {
    OpenOptions::new()
      .create(true)
      .append(true)
      .open(path)
      .ok()
      .map(BufWriter::new)
  });

  let log = Arc::new(LaunchLog {
    id,
    title: title.to_string(),
    kind: kind.to_string(),
    started_at: unix_now(),
    status: Mutex::new("running".to_string()),
    exit_code: AtomicI64::new(i64::MIN),
    seq: AtomicU64::new(0),
    truncated: AtomicBool::new(false),
    finished: AtomicBool::new(false),
    written: AtomicU64::new(0),
    file: Mutex::new(file),
    path: Mutex::new(path),
    lines: Mutex::new(VecDeque::new()),
    pending: Mutex::new(Vec::new()),
  });

  if let Ok(mut guard) = current_store().lock() {
    *guard = Some(log.clone());
  }
  if let Ok(mut history) = history_store().lock() {
    history.push_front(entry_of(&log));
    while history.len() > MAX_LOG_FILES {
      history.pop_back();
    }
  }

  log.push("info", &format!("=== Launching {} ===", title));
  emit_state(app, &log);
  spawn_flusher(app.clone(), log.clone());
  log
}

fn entry_of(log: &LaunchLog) -> LaunchLogEntry {
  LaunchLogEntry {
    id: log.id,
    title: log.title.clone(),
    kind: log.kind.clone(),
    status: log
      .status
      .lock()
      .map(|value| value.clone())
      .unwrap_or_else(|_| "running".to_string()),
    path: log
      .path
      .lock()
      .ok()
      .and_then(|value| value.as_ref().map(|p| p.to_string_lossy().to_string())),
    started_at: log.started_at,
    lines: log.lines.lock().map(|value| value.len()).unwrap_or(0),
  }
}

fn emit_state(app: &AppHandle, log: &LaunchLog) {
  if let Some(snapshot) = snapshot_of(log, MAX_TAIL_LINES) {
    let _ = app.emit_to(WINDOW_LABEL, STATE_EVENT, snapshot);
  }
}

/// Emits pending lines in batches while the launch is running.
fn spawn_flusher(app: AppHandle, log: Arc<LaunchLog>) {
  std::thread::spawn(move || {
    while !log.finished.load(Ordering::SeqCst) {
      std::thread::sleep(FLUSH_INTERVAL);
      flush_pending(&app, &log);
    }
    flush_pending(&app, &log);
  });
}

fn flush_pending(app: &AppHandle, log: &LaunchLog) {
  let batch: Vec<LaunchLogLine> = match log.pending.lock() {
    Ok(mut pending) => pending.drain(..).collect(),
    Err(_) => return,
  };
  if batch.is_empty() {
    return;
  }
  let start_seq = batch.first().map(|line| line.seq).unwrap_or(0);
  let _ = app.emit_to(
    WINDOW_LABEL,
    LINES_EVENT,
    serde_json::json!({
      "logId": log.id,
      "startSeq": start_seq,
      "lines": batch,
    }),
  );
}

impl LaunchLog {
  /// Appends one line to the in-memory tail, the log file and the live stream.
  pub fn push(&self, stream: &str, text: &str) {
    if self.finished.load(Ordering::SeqCst) {
      return;
    }

    let line = LaunchLogLine {
      seq: self.seq.fetch_add(1, Ordering::SeqCst),
      stream: stream.to_string(),
      text: text.to_string(),
    };

    if let Ok(mut lines) = self.lines.lock() {
      lines.push_back(line.clone());
      while lines.len() > MAX_TAIL_LINES {
        lines.pop_front();
        self.truncated.store(true, Ordering::SeqCst);
      }
    }
    if let Ok(mut pending) = self.pending.lock() {
      pending.push(line);
    }

    if self.written.load(Ordering::SeqCst) >= MAX_FILE_BYTES {
      self.truncated.store(true, Ordering::SeqCst);
      return;
    }
    if let Ok(mut guard) = self.file.lock() {
      if let Some(writer) = guard.as_mut() {
        let line = format!("[{}] {}\n", stream, text);
        if writer.write_all(line.as_bytes()).is_ok() {
          self
            .written
            .fetch_add(line.len() as u64, Ordering::SeqCst);
          let _ = writer.flush();
        }
      }
    }
  }

  fn finish(&self, app: &AppHandle, status: &str, exit_code: Option<i32>) {
    if self.finished.swap(true, Ordering::SeqCst) {
      return;
    }

    match exit_code {
      Some(code) => self.exit_code.store(code as i64, Ordering::SeqCst),
      None => self.exit_code.store(i64::MIN, Ordering::SeqCst),
    }
    if let Ok(mut value) = self.status.lock() {
      *value = status.to_string();
    }

    let summary = match exit_code {
      Some(code) => format!("=== {} (exit code {}) ===", status, code),
      None => format!("=== {} ===", status),
    };
    self.push("info", &summary);

    if let Ok(mut guard) = self.file.lock() {
      guard.take();
    }

    flush_pending(app, self);
    emit_state(app, self);
    if let Ok(mut history) = history_store().lock() {
      if let Some(entry) = history.iter_mut().find(|entry| entry.id == self.id) {
        *entry = entry_of(self);
      }
    }
  }

  pub fn finish_success(&self, app: &AppHandle, exit_code: Option<i32>) {
    self.finish(app, "finished", exit_code);
  }

  pub fn finish_failed(&self, app: &AppHandle, exit_code: Option<i32>) {
    self.finish(app, "failed", exit_code);
  }
}

fn snapshot_of(log: &LaunchLog, limit: usize) -> Option<LaunchLogSnapshot> {
  let lines: Vec<LaunchLogLine> = log
    .lines
    .lock()
    .ok()?
    .iter()
    .rev()
    .take(limit)
    .rev()
    .cloned()
    .collect();
  let exit_code = match log.exit_code.load(Ordering::SeqCst) {
    value if value == i64::MIN => None,
    value => Some(value as i32),
  };

  Some(LaunchLogSnapshot {
    id: log.id,
    title: log.title.clone(),
    kind: log.kind.clone(),
    status: log
      .status
      .lock()
      .map(|value| value.clone())
      .unwrap_or_else(|_| "running".to_string()),
    exit_code,
    path: log
      .path
      .lock()
      .ok()
      .and_then(|value| value.as_ref().map(|p| p.to_string_lossy().to_string())),
    truncated: log.truncated.load(Ordering::SeqCst),
    next_seq: log.seq.load(Ordering::SeqCst),
    lines,
  })
}

// ── Window ─────────────────────────────────────────────────────────────────

/// Opens (or focuses) the launch log window.
pub(crate) fn open_or_focus_log_window(app: &AppHandle) -> Result<(), String> {
  if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    return Ok(());
  }

  WebviewWindowBuilder::new(
    app,
    WINDOW_LABEL,
    WebviewUrl::App("index.html#launch-log".into()),
  )
  .title("GameVault — Launch log")
  .inner_size(1100.0, 700.0)
  .min_inner_size(600.0, 400.0)
  .build()
  .map(|_| ())
  .map_err(|error| format!("Failed to open the launch log window: {error}"))
}

// ── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
pub(crate) fn get_launch_log(log_id: Option<u64>) -> Option<LaunchLogSnapshot> {
  let log = current_store().lock().ok().and_then(|guard| guard.clone())?;
  if let Some(requested) = log_id {
    if requested != log.id {
      return None;
    }
  }
  snapshot_of(&log, MAX_TAIL_LINES)
}

#[tauri::command]
pub(crate) fn list_launch_logs() -> Vec<LaunchLogEntry> {
  history_store()
    .lock()
    .map(|guard| guard.iter().cloned().collect())
    .unwrap_or_default()
}

#[tauri::command]
pub(crate) fn open_launch_log_window(app: AppHandle) -> Result<(), String> {
  open_or_focus_log_window(&app)
}

#[tauri::command]
pub(crate) fn open_launch_log_folder(app: AppHandle) -> Result<(), String> {
  let dir = log_directory(&app).ok_or_else(|| "Log directory unavailable".to_string())?;
  crate::games::open_in_file_explorer(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) fn clear_launch_logs(app: AppHandle) -> Result<(), String> {
  if let Some(dir) = log_directory(&app) {
    if let Ok(entries) = fs::read_dir(&dir) {
      for entry in entries.flatten() {
        let _ = fs::remove_file(entry.path());
      }
    }
  }
  if let Ok(mut history) = history_store().lock() {
    history.clear();
  }
  Ok(())
}

/// Reads the tail of a log file (for logs that are no longer in memory).
#[tauri::command]
pub(crate) fn read_launch_log_file(path: String, max_bytes: Option<u64>) -> Result<String, String> {
  read_log_tail(Path::new(&path), max_bytes.unwrap_or(256 * 1024))
}

/// Reads at most `max_bytes` from the end of a log file, dropping a partial
/// first line (that is what the window shows for older logs).
fn read_log_tail(path: &Path, max_bytes: u64) -> Result<String, String> {
  let mut file = File::open(path).map_err(|error| format!("Failed to open log file: {error}"))?;
  let length = file
    .metadata()
    .map_err(|error| format!("Failed to read log file: {error}"))?
    .len();
  let start = length.saturating_sub(max_bytes);
  if start > 0 {
    file.seek(SeekFrom::Start(start))
      .map_err(|error| format!("Failed to read log file: {error}"))?;
  }
  let mut buffer = String::new();
  file
    .read_to_string(&mut buffer)
    .map_err(|error| format!("Failed to read log file: {error}"))?;
  if start > 0 {
    // Drop the partial first line.
    if let Some(index) = buffer.find('\n') {
      buffer = buffer[index + 1..].to_string();
    }
  }
  Ok(buffer)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn slugifies_log_file_names() {
    assert_eq!(slugify("ReStory - Chill Repairs"), "ReStory---Chill-Repairs");
    assert_eq!(slugify("  "), "launch");
    assert!(slugify(&"x".repeat(200)).len() <= 60);
  }

  #[test]
  fn rotates_log_files_to_the_newest_ones() {
    let dir = std::env::temp_dir().join(format!("gv-log-rotation-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    for index in 0..MAX_LOG_FILES + 5 {
      fs::write(dir.join(format!("{:04}-launch.log", index)), "x").unwrap();
    }
    rotate_log_files(&dir);

    let remaining = fs::read_dir(&dir).unwrap().count();
    assert_eq!(remaining, MAX_LOG_FILES - 1);
    assert!(!dir.join("0000-launch.log").exists());

    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn reads_the_tail_of_a_log_file() {
    let path = std::env::temp_dir().join(format!("gv-log-tail-{}", std::process::id()));
    fs::write(&path, "first\nsecond\nthird\n").unwrap();

    assert_eq!(read_log_tail(&path, 1024).unwrap(), "first\nsecond\nthird\n");
    // A byte limit that cuts into the first line drops that partial line.
    assert_eq!(read_log_tail(&path, 8).unwrap(), "third\n");

    let _ = fs::remove_file(&path);
  }
}
