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
  /// Unix timestamp (millis) of when this version was installed, 0 if unknown.
  pub installed_at: i64,
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

  // Remember the state in-process as well: the webview that started the
  // extraction may be reloaded (F5) while the task keeps running, and it needs
  // to be able to re-attach to it afterwards.
  crate::state::set_extraction_snapshot(crate::state::ExtractionSnapshot {
    game_id,
    status: status.to_string(),
    processed,
    total,
    progress,
    current_file: current_file.clone(),
    error: error.clone(),
  });

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

  // Also record it in-process: the install copy runs on a detached thread, so
  // the UI must be able to re-attach to it after a webview reload (F5).
  crate::state::set_installation_snapshot(crate::state::InstallationSnapshot {
    game_id,
    step: "copy".to_string(),
    status: status.to_string(),
    processed,
    total,
    progress,
    current_file: current_file.clone(),
    exit_code: None,
    error: error.clone(),
  });

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
  // Mirror the installer state in-process so a reloaded UI can re-attach to a
  // running installer (which keeps running as a detached thread).
  crate::state::set_installation_snapshot(crate::state::InstallationSnapshot {
    game_id,
    step: "installer".to_string(),
    status: status.to_string(),
    processed: 0,
    total: None,
    progress: None,
    current_file: current_file.clone(),
    exit_code,
    error: error.clone(),
  });

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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GameLaunchFailedEvent {
  pub game_title: String,
  pub exit_code: Option<i32>,
  pub message: String,
}

pub(crate) fn emit_game_launch_failed(
  app: &tauri::AppHandle,
  game_title: String,
  exit_code: Option<i32>,
  message: String,
) {
  let _ = app.emit(
    "game-launch-failed",
    GameLaunchFailedEvent {
      game_title,
      exit_code,
      message,
    },
  );
}

/// Phases streamed while a Windows executable runs through umu-launcher:
/// `installing` (umu-launcher itself is being installed), `setup` (umu's
/// first-run setup: downloading UMU-Proton / steamrt3), `running` (the
/// game/installer process was detected), `error` and `exit`.
#[cfg(target_os = "linux")]
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UmuStatusEvent {
  pub game_title: Option<String>,
  pub phase: String,
  pub line: Option<String>,
  pub message: Option<String>,
}

#[cfg(target_os = "linux")]
pub(crate) fn emit_umu_status(
  app: &tauri::AppHandle,
  game_title: Option<&str>,
  phase: &str,
  line: Option<String>,
  message: Option<String>,
) {
  // Keep the phase in-process too: umu setup keeps running when the webview is
  // reloaded, and the overlay must be able to re-attach to it.
  crate::state::set_umu_snapshot(Some(crate::state::UmuSnapshot {
    status: phase.to_string(),
    message: message.clone().or_else(|| line.clone()),
    game_title: game_title.map(String::from),
  }));

  let _ = app.emit(
    "umu-status",
    UmuStatusEvent {
      game_title: game_title.map(String::from),
      phase: phase.to_string(),
      line,
      message,
    },
  );
}

/// The exact program + arguments GameVault hands to an installer (used for
/// debugging installer launches on Linux via umu-launcher).
#[cfg(target_os = "linux")]
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstallerCommandEvent {
  pub program: String,
  pub args: Vec<String>,
}

#[cfg(target_os = "linux")]
pub(crate) fn emit_installer_command(app: &tauri::AppHandle, program: &str, args: &[String]) {
  let _ = app.emit(
    "installer-command",
    InstallerCommandEvent {
      program: program.to_string(),
      args: args.to_vec(),
    },
  );
}
