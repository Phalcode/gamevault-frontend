use serde::Serialize;
use tauri::Emitter;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DownloadProgressEvent {
  pub game_id: i64,
  pub status: String,
  pub received: u64,
  pub total: Option<u64>,
  pub error: Option<String>,
  pub filename: Option<String>,
  pub file_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExtractArchiveResponse {
  pub success: bool,
  pub needs_password: bool,
  pub message: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoveredDownloadCard {
  pub game_id: i64,
  pub version_id: i64,
  pub game_title: String,
  pub game_metadata: Option<serde_json::Value>,
  pub cached_metadata: Option<serde_json::Value>,
  pub game_type: Option<String>,
  pub version_name: String,
  pub filename: String,
  pub download_directory: String,
  pub extraction_directory: String,
  pub installation_directory: String,
  pub version_directory: String,
  pub downloaded_file_path: Option<String>,
  pub received: u64,
  pub total: Option<u64>,
  pub progress: f64,
  pub status: String,
  pub extraction_status: String,
  pub extraction_progress: Option<f64>,
  pub installation_finished: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstalledGameInfo {
  pub game_id: i64,
  pub game_title: String,
  pub game_metadata: Option<serde_json::Value>,
  pub cached_metadata: Option<serde_json::Value>,
  pub game_type: Option<String>,
  pub version_id: i64,
  pub version_name: String,
  pub installation_directory: String,
  pub version_directory: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExtractProgressEvent {
  pub game_id: i64,
  pub status: String,
  pub processed: u64,
  pub total: Option<u64>,
  pub progress: Option<f64>,
  pub current_file: Option<String>,
  pub error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstallCopyProgressEvent {
  pub game_id: i64,
  pub status: String,
  pub processed: u64,
  pub total: Option<u64>,
  pub progress: Option<f64>,
  pub current_file: Option<String>,
  pub error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstallerStatusEvent {
  pub game_id: i64,
  pub status: String,
  pub current_file: Option<String>,
  pub exit_code: Option<i32>,
  pub error: Option<String>,
}

pub(crate) fn emit_extract_progress(
  app: &tauri::AppHandle,
  game_id: i64,
  status: &str,
  processed: u64,
  total: Option<u64>,
  current_file: Option<String>,
  error: Option<String>,
) {
  let progress = match total {
    Some(t) if t > 0 => Some((processed as f64 / t as f64) * 100.0),
    _ => None,
  };

  let _ = app.emit(
    "extract-progress",
    ExtractProgressEvent {
      game_id,
      status: status.to_string(),
      processed,
      total,
      progress,
      current_file,
      error,
    },
  );
}

pub(crate) fn emit_install_copy_progress(
  app: &tauri::AppHandle,
  game_id: i64,
  status: &str,
  processed: u64,
  total: Option<u64>,
  current_file: Option<String>,
  error: Option<String>,
) {
  let progress = match total {
    Some(t) if t > 0 => Some((processed as f64 / t as f64) * 100.0),
    _ => None,
  };

  let _ = app.emit(
    "install-copy-progress",
    InstallCopyProgressEvent {
      game_id,
      status: status.to_string(),
      processed,
      total,
      progress,
      current_file,
      error,
    },
  );
}

pub(crate) fn emit_installer_status(
  app: &tauri::AppHandle,
  game_id: i64,
  status: &str,
  current_file: Option<String>,
  exit_code: Option<i32>,
  error: Option<String>,
) {
  let _ = app.emit(
    "installer-status",
    InstallerStatusEvent {
      game_id,
      status: status.to_string(),
      current_file,
      exit_code,
      error,
    },
  );
}
