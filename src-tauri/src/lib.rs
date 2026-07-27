use futures_util::StreamExt;
use serde::{Serialize, Deserialize};
use std::collections::HashMap;
use std::fs;
use std::fs::File as StdFile;
use std::hash::{Hash, Hasher};
use std::io::{Read, Write};
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{
  atomic::{AtomicU8, Ordering},
  Arc, Mutex, OnceLock,
};
use std::time::{Duration, Instant};
use tauri::Emitter;
use tauri::Manager;
use tauri::tray::{TrayIconBuilder, MouseButton, MouseButtonState, TrayIconEvent};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tokio::fs::{File, OpenOptions};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};
use unrar::Archive;

use sysinfo::System;
use tokio::sync::watch;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const DOWNLOAD_CONTROL_RUNNING: u8 = 0;
const DOWNLOAD_CONTROL_PAUSE: u8 = 1;
const DOWNLOAD_CONTROL_CANCEL: u8 = 2;

static DOWNLOAD_CONTROL_FLAGS: OnceLock<Mutex<HashMap<i64, Arc<AtomicU8>>>> = OnceLock::new();

fn control_flags() -> &'static Mutex<HashMap<i64, Arc<AtomicU8>>> {
  DOWNLOAD_CONTROL_FLAGS.get_or_init(|| Mutex::new(HashMap::new()))
}

// ── GameTimeTracker shared state ──────────────────────────────────────────────

#[derive(Clone)]
struct TrackerConfig {
  server_url: String,
  user_id: i64,
  access_token: String,
  download_path: String,
}

static TRACKER_CONFIG: OnceLock<Mutex<Option<TrackerConfig>>> = OnceLock::new();
static TRACKER_STOP_TX: OnceLock<Mutex<Option<watch::Sender<bool>>>> = OnceLock::new();

fn tracker_config() -> &'static Mutex<Option<TrackerConfig>> {
  TRACKER_CONFIG.get_or_init(|| Mutex::new(None))
}
fn tracker_stop_tx() -> &'static Mutex<Option<watch::Sender<bool>>> {
  TRACKER_STOP_TX.get_or_init(|| Mutex::new(None))
}

// ── End GameTimeTracker shared state ──────────────────────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DownloadProgressEvent {
  game_id: i64,
  status: String,
  received: u64,
  total: Option<u64>,
  error: Option<String>,
  filename: Option<String>,
  file_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtractArchiveResponse {
  success: bool,
  needs_password: bool,
  message: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RecoveredDownloadCard {
  game_id: i64,
  version_id: i64,
  game_title: String,
  game_metadata: Option<serde_json::Value>,
  cached_metadata: Option<serde_json::Value>,
  game_type: Option<String>,
  version_name: String,
  filename: String,
  download_directory: String,
  extraction_directory: String,
  installation_directory: String,
  version_directory: String,
  downloaded_file_path: Option<String>,
  received: u64,
  total: Option<u64>,
  progress: f64,
  status: String,
  extraction_status: String,
  extraction_progress: Option<f64>,
  installation_finished: bool,
}

fn parse_version_folder(folder_name: &str) -> (i64, String) {
  if let Some(rest) = folder_name.strip_prefix('(') {
    if let Some((id_part, name_part)) = rest.split_once(')') {
      let version_id = id_part.trim().parse::<i64>().unwrap_or(0);
      return (version_id, name_part.trim().to_string());
    }
  }
  (0, folder_name.to_string())
}

fn stable_id_from_path(path: &str) -> i64 {
  let mut hasher = std::collections::hash_map::DefaultHasher::new();
  path.hash(&mut hasher);
  (hasher.finish() & 0x7FFF_FFFF) as i64
}

fn parse_i64_json(value: Option<&serde_json::Value>) -> Option<i64> {
  match value {
    Some(v) => v
      .as_i64()
      .or_else(|| v.as_u64().map(|n| n as i64))
      .or_else(|| v.as_str().and_then(|s| s.trim().parse::<i64>().ok())),
    None => None,
  }
}

fn resolve_version_subdir(version_path: &Path, preferred: &str, legacy: &str) -> PathBuf {
  let preferred_path = version_path.join(preferred);
  if preferred_path.exists() {
    return preferred_path;
  }

  let legacy_path = version_path.join(legacy);
  if legacy_path.exists() {
    return legacy_path;
  }

  preferred_path
}

fn read_saved_game_metadata(start_path: &Path) -> Option<serde_json::Value> {
  for ancestor in start_path.ancestors() {
    let metadata_path = ancestor.join(".gamevault.metadata.json");
    if !metadata_path.exists() {
      continue;
    }

    if let Ok(content) = fs::read_to_string(&metadata_path) {
      if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
        return Some(parsed);
      }
    }
  }

  None
}

fn read_saved_installer_preferences(start_path: &Path) -> (Option<String>, Option<String>) {
  let metadata = read_saved_game_metadata(start_path);
  let installer_executable = metadata
    .as_ref()
    .and_then(|value| value.get("installer_executable"))
    .and_then(|value| value.as_str())
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());
  let installer_parameters = metadata
    .as_ref()
    .and_then(|value| value.get("installer_parameters"))
    .and_then(|value| value.as_str())
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());

  (installer_executable, installer_parameters)
}

#[cfg(windows)]
fn escape_powershell_single_quoted(value: &str) -> String {
  value.replace('\'', "''")
}

#[cfg(windows)]
fn run_elevated_installer_and_wait(
  executable: &str,
  argument_list: Option<&str>,
  working_directory: Option<&str>,
) -> Result<Option<i32>, String> {
  let file_path = escape_powershell_single_quoted(executable);
  let working_directory_segment = working_directory
    .filter(|value| !value.trim().is_empty())
    .map(escape_powershell_single_quoted)
    .map(|value| format!(" -WorkingDirectory '{value}'"))
    .unwrap_or_default();
  let script = if let Some(arguments) = argument_list.filter(|value| !value.trim().is_empty()) {
    let escaped_arguments = escape_powershell_single_quoted(arguments);
    format!(
      "$process = Start-Process -FilePath '{file_path}' -ArgumentList '{escaped_arguments}'{working_directory_segment} -Verb RunAs -Wait -PassThru; exit $process.ExitCode"
    )
  } else {
    format!(
      "$process = Start-Process -FilePath '{file_path}'{working_directory_segment} -Verb RunAs -Wait -PassThru; exit $process.ExitCode"
    )
  };

  let output = Command::new("powershell")
    .arg("-NoProfile")
    .arg("-Command")
    .arg(script)
    .output()
    .map_err(|error| format!("Failed to start elevated installer: {error}"))?;

  if output.status.success() {
    return Ok(output.status.code());
  }

  let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
  let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
  let message = if !stderr.is_empty() {
    stderr
  } else if !stdout.is_empty() {
    stdout
  } else {
    format!(
      "Elevated installer exited with code {}.",
      output.status.code().unwrap_or(-1)
    )
  };

  Err(message)
}

#[tauri::command]
fn recover_download_cards(selected_root: String) -> Result<Vec<RecoveredDownloadCard>, String> {
  let candidate = PathBuf::from(&selected_root).join("GameVault");
  let root = if candidate.exists() {
    candidate
  } else {
    PathBuf::from(&selected_root)
  };

  if !root.exists() || !root.is_dir() {
    return Ok(Vec::new());
  }

  let mut cards: Vec<RecoveredDownloadCard> = Vec::new();

  let game_dirs = fs::read_dir(&root).map_err(|e| format!("Failed to read GameVault root: {e}"))?;
  for game_entry in game_dirs.flatten() {
    let game_path = game_entry.path();
    if !game_path.is_dir() {
      continue;
    }

    let game_name = game_entry.file_name().to_string_lossy().to_string();

    let metadata_path = game_path.join(".gamevault.metadata.json");
    let game_metadata: Option<serde_json::Value> = if metadata_path.exists() {
      fs::read_to_string(&metadata_path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
    } else {
      None
    };

    let resolved_game_title = game_name;

    let versions_root = game_path.join("Versions");
    if !versions_root.exists() || !versions_root.is_dir() {
      continue;
    }

    let version_dirs = fs::read_dir(&versions_root)
      .map_err(|e| format!("Failed to read versions folder: {e}"))?;
    for version_entry in version_dirs.flatten() {
      let version_path = version_entry.path();
      if !version_path.is_dir() {
        continue;
      }

      let version_folder_name = version_entry.file_name().to_string_lossy().to_string();
      let (version_id, version_name) = parse_version_folder(&version_folder_name);

      let config_path = version_path.join(".gamevault.game.config.json");
      if !config_path.exists() {
        continue;
      }

      let cfg_value = fs::read_to_string(&config_path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));

      let download_finished = cfg_value
        .get("downloadfinished")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
      let extraction_finished = cfg_value
        .get("extractionfinished")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
      let installation_finished = cfg_value
        .get("installationfinished")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
      let game_type = cfg_value
        .get("gametype")
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
      let download_progress = cfg_value
        .get("downloadprogress")
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .unwrap_or_default();
      let config_game_id = parse_i64_json(cfg_value.get("gameid"));
      let metadata_game_id = game_metadata
        .as_ref()
        .and_then(|m| m.as_object())
        .and_then(|obj| obj.values().find_map(|v| parse_i64_json(Some(v))));

      if !download_finished && !extraction_finished && download_progress.is_empty() {
        continue;
      }

      let downloads_dir = resolve_version_subdir(&version_path, "Download", "Downloads");
      let extractions_dir = resolve_version_subdir(&version_path, "Extraction", "Extractions");
      let installations_dir = resolve_version_subdir(&version_path, "Installation", "Installations");

      let mut filename = format!("{}.bin", resolved_game_title);
      let mut downloaded_file_path: Option<String> = None;
      let mut file_size = 0u64;

      if downloads_dir.exists() && downloads_dir.is_dir() {
        if let Ok(files) = fs::read_dir(&downloads_dir) {
          if let Some(file) = files
            .flatten()
            .map(|e| e.path())
            .find(|p| p.is_file())
          {
            if let Some(name) = file.file_name().and_then(|n| n.to_str()) {
              filename = name.to_string();
            }
            file_size = fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
            downloaded_file_path = Some(file.to_string_lossy().to_string());
          }
        }
      }

      let version_path_str = version_path.to_string_lossy().to_string();
      let recovered_game_id = config_game_id
        .or(metadata_game_id)
        .filter(|id| *id > 0)
        .unwrap_or_else(|| stable_id_from_path(&version_path_str));

      let cache_dir = root.join(".cache").join("games");
      let cache_file = cache_dir.join(format!("{}.json", recovered_game_id));
      let cached_metadata: Option<serde_json::Value> = if cache_file.exists() {
        fs::read_to_string(&cache_file)
          .ok()
          .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
      } else {
        None
      };

      let (progress_received, progress_total) = if let Some((left, right)) = download_progress.split_once('/') {
        (
          left.trim().parse::<u64>().unwrap_or(0),
          right.trim().parse::<u64>().ok().filter(|v| *v > 0),
        )
      } else {
        (0, None)
      };
      let recovered_received = if download_finished {
        file_size
      } else if progress_received > 0 {
        progress_received
      } else {
        file_size
      };
      let recovered_total = if download_finished {
        Some(file_size)
      } else {
        progress_total
      };
      let recovered_progress = match recovered_total {
        Some(total) if total > 0 => (recovered_received as f64 / total as f64) * 100.0,
        _ => 0.0,
      };
      let has_resume_progress = !download_progress.is_empty() || recovered_received > 0;
      cards.push(RecoveredDownloadCard {
        game_id: recovered_game_id,
        version_id,
        game_title: resolved_game_title.clone(),
        game_metadata: game_metadata.clone(),
        game_type,
        version_name,
        filename,
        download_directory: downloads_dir.to_string_lossy().to_string(),
        extraction_directory: extractions_dir.to_string_lossy().to_string(),
        installation_directory: installations_dir.to_string_lossy().to_string(),
        version_directory: version_path_str,
        downloaded_file_path,
        received: recovered_received,
        total: recovered_total,
        progress: if download_finished { 100.0 } else { recovered_progress },
        status: if download_finished {
          "completed".to_string()
        } else if has_resume_progress {
          "paused".to_string()
        } else {
          "aborted".to_string()
        },
        extraction_status: if extraction_finished {
          "completed".to_string()
        } else {
          "idle".to_string()
        },
        extraction_progress: if extraction_finished { Some(100.0) } else { None },
        installation_finished,
        cached_metadata,
      });
    }
  }

  Ok(cards)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InstalledGameInfo {
  game_id: i64,
  game_title: String,
  game_metadata: Option<serde_json::Value>,
  cached_metadata: Option<serde_json::Value>,
  game_type: Option<String>,
  version_id: i64,
  version_name: String,
  installation_directory: String,
  version_directory: String,
}

#[tauri::command]
fn list_installed_games(selected_root: String) -> Result<Vec<InstalledGameInfo>, String> {
  let candidate = PathBuf::from(&selected_root).join("GameVault");
  let root = if candidate.exists() {
    candidate
  } else {
    PathBuf::from(&selected_root)
  };

  if !root.exists() || !root.is_dir() {
    return Ok(Vec::new());
  }

  let mut results: Vec<InstalledGameInfo> = Vec::new();

  let game_dirs = fs::read_dir(&root).map_err(|e| format!("Failed to read GameVault root: {e}"))?;
  for game_entry in game_dirs.flatten() {
    let game_path = game_entry.path();
    if !game_path.is_dir() {
      continue;
    }

    let game_name = game_entry.file_name().to_string_lossy().to_string();

    let metadata_path = game_path.join(".gamevault.metadata.json");
    let game_metadata: Option<serde_json::Value> = if metadata_path.exists() {
      fs::read_to_string(&metadata_path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
    } else {
      None
    };

    let resolved_game_title = game_name.clone();

    let versions_root = game_path.join("Versions");
    if !versions_root.exists() || !versions_root.is_dir() {
      continue;
    }

    let version_dirs = fs::read_dir(&versions_root)
      .map_err(|e| format!("Failed to read versions folder: {e}"))?;
    for version_entry in version_dirs.flatten() {
      let version_path = version_entry.path();
      if !version_path.is_dir() {
        continue;
      }

      let version_folder_name = version_entry.file_name().to_string_lossy().to_string();
      let (version_id, version_name) = parse_version_folder(&version_folder_name);

      let config_path = version_path.join(".gamevault.game.config.json");
      if !config_path.exists() {
        continue;
      }

      let cfg_value = fs::read_to_string(&config_path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));

      let installation_finished = cfg_value
        .get("installationfinished")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

      if !installation_finished {
        continue;
      }

      let game_type = cfg_value
        .get("gametype")
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

      let config_game_id = parse_i64_json(cfg_value.get("gameid"));
      let metadata_game_id = game_metadata
        .as_ref()
        .and_then(|m| m.as_object())
        .and_then(|obj| obj.values().find_map(|v| parse_i64_json(Some(v))));

      let version_path_str = version_path.to_string_lossy().to_string();
      let resolved_game_id = config_game_id
        .or(metadata_game_id)
        .filter(|id| *id > 0)
        .unwrap_or_else(|| stable_id_from_path(&version_path_str));

      let installations_dir = resolve_version_subdir(&version_path, "Installation", "Installations");

      // Try to read cached game data from .cache/games/{game_id}.json
      let cache_dir = root.join(".cache").join("games");
      let cache_file = cache_dir.join(format!("{}.json", resolved_game_id));
      let cached_metadata: Option<serde_json::Value> = if cache_file.exists() {
        fs::read_to_string(&cache_file)
          .ok()
          .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
      } else {
        None
      };

      results.push(InstalledGameInfo {
        game_id: resolved_game_id,
        game_title: resolved_game_title.clone(),
        game_metadata: game_metadata.clone(),
        cached_metadata,
        game_type,
        version_id,
        version_name,
        installation_directory: installations_dir.to_string_lossy().to_string(),
        version_directory: version_path_str,
      });
    }
  }

  Ok(results)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExtractProgressEvent {
  game_id: i64,
  status: String,
  processed: u64,
  total: Option<u64>,
  progress: Option<f64>,
  current_file: Option<String>,
  error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InstallCopyProgressEvent {
  game_id: i64,
  status: String,
  processed: u64,
  total: Option<u64>,
  progress: Option<f64>,
  current_file: Option<String>,
  error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InstallerStatusEvent {
  game_id: i64,
  status: String,
  current_file: Option<String>,
  exit_code: Option<i32>,
  error: Option<String>,
}

fn emit_extract_progress(
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

fn emit_install_copy_progress(
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

fn emit_installer_status(
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

fn collect_install_candidates(root: &Path, current: &Path, results: &mut Vec<String>) -> Result<(), String> {
  let entries = fs::read_dir(current)
    .map_err(|e| format!("Failed to read extraction folder: {e}"))?;

  for entry in entries {
    let entry = entry.map_err(|e| format!("Failed to read extraction folder entry: {e}"))?;
    let path = entry.path();

    if path.is_dir() {
      collect_install_candidates(root, &path, results)?;
      continue;
    }

    let ext = path
      .extension()
      .and_then(|v| v.to_str())
      .map(|v| v.to_ascii_lowercase())
      .unwrap_or_default();

    if !matches!(
      ext.as_str(),
      "exe" | "msi" | "bat" | "cmd" | "com" | "sh" | "run" | "appimage"
    ) {
      continue;
    }

    if let Ok(relative) = path.strip_prefix(root) {
      results.push(relative.to_string_lossy().replace('\\', "/"));
    }
  }

  Ok(())
}

fn compute_directory_size(path: &Path) -> Result<u64, String> {
  if !path.exists() {
    return Ok(0);
  }
  if path.is_file() {
    return fs::metadata(path)
      .map(|m| m.len())
      .map_err(|e| format!("Failed to read file metadata: {e}"));
  }

  let mut total = 0u64;
  let entries = fs::read_dir(path).map_err(|e| format!("Failed to read directory: {e}"))?;
  for entry in entries {
    let entry = entry.map_err(|e| format!("Failed to read directory entry: {e}"))?;
    total = total.saturating_add(compute_directory_size(&entry.path())?);
  }
  Ok(total)
}

fn copy_path_with_progress(
  app: &tauri::AppHandle,
  game_id: i64,
  source_root: &Path,
  current_source: &Path,
  destination_root: &Path,
  processed: &mut u64,
  total: u64,
) -> Result<(), String> {
  let relative = current_source
    .strip_prefix(source_root)
    .map_err(|e| format!("Failed to resolve relative path: {e}"))?;
  let destination = destination_root.join(relative);

  if current_source.is_dir() {
    fs::create_dir_all(&destination)
      .map_err(|e| format!("Failed to create installation directory: {e}"))?;
    let entries = fs::read_dir(current_source)
      .map_err(|e| format!("Failed to read extraction directory: {e}"))?;
    for entry in entries {
      let entry = entry.map_err(|e| format!("Failed to read extraction entry: {e}"))?;
      copy_path_with_progress(
        app,
        game_id,
        source_root,
        &entry.path(),
        destination_root,
        processed,
        total,
      )?;
    }
    return Ok(());
  }

  if let Some(parent) = destination.parent() {
    fs::create_dir_all(parent)
      .map_err(|e| format!("Failed to create installation directory: {e}"))?;
  }

  let mut source_file = StdFile::open(current_source)
    .map_err(|e| format!("Failed to open extracted file: {e}"))?;
  let mut destination_file = StdFile::create(&destination)
    .map_err(|e| format!("Failed to create installation file: {e}"))?;
  let mut buffer = vec![0u8; 1024 * 1024];

  loop {
    let read = source_file
      .read(&mut buffer)
      .map_err(|e| format!("Failed to read extracted file: {e}"))?;
    if read == 0 {
      break;
    }

    destination_file
      .write_all(&buffer[..read])
      .map_err(|e| format!("Failed to write installation file: {e}"))?;

    *processed = processed.saturating_add(read as u64);
    emit_install_copy_progress(
      app,
      game_id,
      "copying",
      *processed,
      Some(total),
      Some(relative.to_string_lossy().replace('\\', "/")),
      None,
    );
  }

  Ok(())
}

fn extract_zip_archive(
  app: &tauri::AppHandle,
  game_id: i64,
  archive: &PathBuf,
  destination: &PathBuf,
  password: Option<&str>,
) -> Result<(), (bool, String)> {
  let file = fs::File::open(archive)
    .map_err(|e| (false, format!("Failed to open archive: {e}")))?;
  let mut zip = zip::ZipArchive::new(file)
    .map_err(|e| (false, format!("Invalid ZIP archive: {e}")))?;

  let total_entries = zip.len() as u64;
  emit_extract_progress(app, game_id, "extracting", 0, Some(total_entries), None, None);
  let mut processed = 0u64;

  for i in 0..zip.len() {
    let mut entry = if let Some(pw) = password.filter(|v| !v.trim().is_empty()) {
      zip.by_index_decrypt(i, pw.as_bytes()).map_err(|e| {
        let msg = e.to_string();
        let lower = msg.to_lowercase();
        (
          lower.contains("password") || lower.contains("encrypted"),
          format!("ZIP extraction failed: {msg}"),
        )
      })?
    } else {
      zip.by_index(i).map_err(|e| {
        let msg = e.to_string();
        let lower = msg.to_lowercase();
        (
          lower.contains("password") || lower.contains("encrypted"),
          format!("ZIP extraction failed: {msg}"),
        )
      })?
    };

    let out_rel = match entry.enclosed_name() {
      Some(path) => path.to_owned(),
      None => continue,
    };
    let current_file = out_rel.to_string_lossy().to_string();
    let out_path = destination.join(out_rel);

    if entry.name().ends_with('/') {
      fs::create_dir_all(&out_path)
        .map_err(|e| (false, format!("Failed to create directory: {e}")))?;
      continue;
    }

    if let Some(parent) = out_path.parent() {
      fs::create_dir_all(parent)
        .map_err(|e| (false, format!("Failed to create parent directory: {e}")))?;
    }

    let mut out_file = fs::File::create(&out_path)
      .map_err(|e| (false, format!("Failed to create output file: {e}")))?;
    std::io::copy(&mut entry, &mut out_file)
      .map_err(|e| (false, format!("Failed to write output file: {e}")))?;

    processed += 1;
    emit_extract_progress(
      app,
      game_id,
      "extracting",
      processed,
      Some(total_entries),
      Some(current_file),
      None,
    );
  }

  Ok(())
}

fn extract_rar_archive(
  app: &tauri::AppHandle,
  game_id: i64,
  archive: &PathBuf,
  destination: &PathBuf,
  password: Option<&str>,
) -> Result<(), (bool, String)> {
  let pw = password.filter(|v| !v.trim().is_empty());

  let total_entries = {
    let mut listing = if let Some(pw) = pw {
      Archive::with_password(archive, pw)
        .open_for_listing()
        .map_err(|e| (false, format!("Failed to read RAR archive: {e}")))?
    } else {
      Archive::new(archive)
        .open_for_listing()
        .map_err(|e| (false, format!("Failed to read RAR archive: {e}")))?
    };

    let mut count = 0u64;
    while let Some(entry) = listing.next() {
      entry.map_err(|e| {
        let msg = e.to_string();
        let lower = msg.to_lowercase();
        (
          lower.contains("password") || lower.contains("encrypted"),
          format!("RAR listing failed: {msg}"),
        )
      })?;
      count += 1;
    }
    count
  };

  emit_extract_progress(app, game_id, "extracting", 0, Some(total_entries), None, None);

  let mut processing = if let Some(pw) = pw {
    Archive::with_password(archive, pw)
      .open_for_processing()
      .map_err(|e| (false, format!("Failed to open RAR archive: {e}")))?
  } else {
    Archive::new(archive)
      .open_for_processing()
      .map_err(|e| (false, format!("Failed to open RAR archive: {e}")))?
  };

  let mut processed = 0u64;
  while let Some(header) = processing.read_header().map_err(|e| {
    let msg = e.to_string();
    let lower = msg.to_lowercase();
    (
      lower.contains("password") || lower.contains("encrypted"),
      format!("RAR header read failed: {msg}"),
    )
  })? {
    let current_file = header.entry().filename.to_string_lossy().to_string();
    processing = header.extract_with_base(destination).map_err(|e| {
      let msg = e.to_string();
      let lower = msg.to_lowercase();
      (
        lower.contains("password") || lower.contains("encrypted"),
        format!("RAR extraction failed: {msg}"),
      )
    })?;

    processed += 1;
    emit_extract_progress(
      app,
      game_id,
      "extracting",
      processed,
      Some(total_entries),
      Some(current_file),
      None,
    );
  }

  Ok(())
}

fn extract_7z_archive(
  app: &tauri::AppHandle,
  game_id: i64,
  archive: &PathBuf,
  destination: &PathBuf,
  password: Option<&str>,
) -> Result<(), (bool, String)> {
  let pw = password
    .filter(|v| !v.trim().is_empty())
    .map(sevenz_rust2::Password::from)
    .unwrap_or_else(sevenz_rust2::Password::empty);

  let mut reader = sevenz_rust2::ArchiveReader::open(archive, pw.clone()).map_err(|e| {
    let msg = e.to_string();
    let lower = msg.to_lowercase();
    (
      lower.contains("password") || lower.contains("aes") || lower.contains("crypto"),
      msg,
    )
  })?;

  let total_size: u64 = reader
    .archive()
    .files
    .iter()
    .filter(|e| e.has_stream())
    .map(|e| e.size())
    .sum();

  emit_extract_progress(app, game_id, "extracting", 0, Some(total_size), None, None);

  let mut written_size = 0u64;
  let mut buffer = [0u8; 8192];

  reader
    .for_each_entries(|entry, entry_reader| {
      let dest_path = destination.join(entry.name());
      if entry.is_directory() {
        fs::create_dir_all(&dest_path)?;
        emit_extract_progress(
          app,
          game_id,
          "extracting",
          written_size,
          Some(total_size),
          Some(entry.name().to_string()),
          None,
        );
        return Ok(true);
      }

      if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent)?;
      }

      let mut output = fs::File::create(&dest_path)?;
      loop {
        let read_size = entry_reader.read(&mut buffer)?;
        if read_size == 0 {
          break;
        }
        output.write_all(&buffer[..read_size])?;
        written_size += read_size as u64;
      }

      emit_extract_progress(
        app,
        game_id,
        "extracting",
        written_size,
        Some(total_size),
        Some(entry.name().to_string()),
        None,
      );

      Ok(true)
    })
    .map_err(|e| {
      let msg = e.to_string();
      let lower = msg.to_lowercase();
      (
        lower.contains("password") || lower.contains("aes") || lower.contains("crypto"),
        msg,
      )
    })?;

  Ok(())
}

// ── ISO 9660 extraction support ──────────────────────────────────────────────

struct IsoFileDevice {
  file: std::fs::File,
}

impl iso9660_simple::Read for IsoFileDevice {
  fn read(&mut self, position: usize, buffer: &mut [u8]) -> Option<()> {
    use std::io::Seek;
    if self
      .file
      .seek(std::io::SeekFrom::Start(position as u64))
      .is_err()
    {
      return None;
    }
    self.file.read_exact(buffer).ok()
  }
}

fn is_iso_archive(path: &PathBuf) -> bool {
  use std::io::{Read, Seek};
  let mut file = match std::fs::File::open(path) {
    Ok(f) => f,
    Err(_) => return false,
  };
  // ISO 9660 Primary Volume Descriptor starts at sector 16 (offset 0x8000).
  // The standard identifier "CD001" sits at bytes 1–5 of the descriptor.
  if file.seek(std::io::SeekFrom::Start(0x8001)).is_err() {
    return false;
  }
  let mut sig = [0u8; 5];
  if file.read_exact(&mut sig).is_err() {
    return false;
  }
  &sig == b"CD001"
}

fn count_iso_entries(iso: &mut iso9660_simple::ISO9660, lba: usize) -> u64 {
  let mut count = 0u64;
  let entries: Vec<_> = iso.read_directory(lba).collect();
  for entry in &entries {
    if entry.name == "." || entry.name == ".." {
      continue;
    }
    count += 1;
    if entry.is_folder() {
      count += count_iso_entries(iso, entry.record.lba.get() as usize);
    }
  }
  count
}

fn extract_iso_directory(
  iso: &mut iso9660_simple::ISO9660,
  lba: usize,
  dest: &Path,
  processed: &mut u64,
  total: u64,
  app: &tauri::AppHandle,
  game_id: i64,
) -> Result<(), (bool, String)> {
  let entries: Vec<_> = iso.read_directory(lba).collect();
  for entry in &entries {
    if entry.name == "." || entry.name == ".." {
      continue;
    }

    let dest_path = dest.join(&entry.name);

    if entry.is_folder() {
      fs::create_dir_all(&dest_path)
        .map_err(|e| (false, format!("Failed to create directory: {e}")))?;

      *processed += 1;
      emit_extract_progress(
        app,
        game_id,
        "extracting",
        *processed,
        Some(total),
        Some(entry.name.clone()),
        None,
      );

      extract_iso_directory(
        iso,
        entry.record.lba.get() as usize,
        &dest_path,
        processed,
        total,
        app,
        game_id,
      )?;
    } else {
      if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent)
          .map_err(|e| (false, format!("Failed to create parent directory: {e}")))?;
      }

      let file_size = entry.file_size() as usize;
      let mut output = std::fs::File::create(&dest_path)
        .map_err(|e| (false, format!("Failed to create output file: {e}")))?;

      let mut offset = 0usize;
      let mut buffer = vec![0u8; 8192];

      while offset < file_size {
        let remaining = file_size - offset;
        let to_read = std::cmp::min(remaining, buffer.len());
        let buf_slice = &mut buffer[..to_read];

        if iso.read_file(entry, offset, buf_slice).is_none() {
          return Err((
            false,
            format!("Failed to read ISO file data at offset {}", offset),
          ));
        }

        output
          .write_all(buf_slice)
          .map_err(|e| (false, format!("Failed to write output file: {e}")))?;

        offset += to_read;
      }

      *processed += 1;
      emit_extract_progress(
        app,
        game_id,
        "extracting",
        *processed,
        Some(total),
        Some(entry.name.clone()),
        None,
      );
    }
  }
  Ok(())
}

fn extract_iso_archive(
  app: &tauri::AppHandle,
  game_id: i64,
  archive: &PathBuf,
  destination: &PathBuf,
) -> Result<(), (bool, String)> {
  let file = std::fs::File::open(archive)
    .map_err(|e| (false, format!("Failed to open ISO archive: {e}")))?;

  let device = IsoFileDevice { file };
  let mut iso = iso9660_simple::ISO9660::from_device(device)
    .ok_or_else(|| (false, "Failed to parse ISO 9660 filesystem".to_string()))?;

  let root_lba = iso.root().lba.get() as usize;
  let total = count_iso_entries(&mut iso, root_lba);

  emit_extract_progress(app, game_id, "extracting", 0, Some(total), None, None);

  let mut processed = 0u64;
  extract_iso_directory(
    &mut iso,
    root_lba,
    destination,
    &mut processed,
    total,
    app,
    game_id,
  )
}

// ── End ISO 9660 extraction support ──────────────────────────────────────────

fn archive_file_name_lowercase(path: &Path) -> String {
  path
    .file_name()
    .and_then(|name| name.to_str())
    .map(|name| name.to_ascii_lowercase())
    .unwrap_or_default()
}

fn is_tar_based_path(path: &Path) -> bool {
  let name = archive_file_name_lowercase(path);
  name.ends_with(".tar")
    || name.ends_with(".tar.gz")
    || name.ends_with(".tgz")
    || name.ends_with(".tar.bz2")
    || name.ends_with(".tbz")
    || name.ends_with(".tbz2")
    || name.ends_with(".tar.xz")
    || name.ends_with(".txz")
    || name.ends_with(".tar.zst")
    || name.ends_with(".tzst")
}

fn single_file_output_name(path: &Path) -> String {
  let file_name = path
    .file_name()
    .and_then(|name| name.to_str())
    .unwrap_or("extracted.bin");
  let lower = file_name.to_ascii_lowercase();

  let stripped = [".gz", ".bz2", ".xz", ".zst"]
    .iter()
    .find_map(|ext| lower.strip_suffix(ext).map(|_| &file_name[..file_name.len() - ext.len()]));

  stripped
    .filter(|name| !name.is_empty())
    .unwrap_or("extracted.bin")
    .to_string()
}

fn extract_tar_from_reader<R: Read>(
  app: &tauri::AppHandle,
  game_id: i64,
  reader: R,
  destination: &PathBuf,
) -> Result<(), (bool, String)> {
  emit_extract_progress(app, game_id, "extracting", 0, None, None, None);

  let mut archive = tar::Archive::new(reader);
  let entries = archive
    .entries()
    .map_err(|e| (false, format!("Failed to read TAR archive: {e}")))?;

  let mut processed = 0u64;
  for entry in entries {
    let mut entry = entry.map_err(|e| (false, format!("Failed to read TAR entry: {e}")))?;
    let current_file = entry
      .path()
      .ok()
      .map(|p| p.to_string_lossy().to_string());
    entry
      .unpack_in(destination)
      .map_err(|e| (false, format!("Failed to extract TAR entry: {e}")))?;
    processed += 1;
    emit_extract_progress(
      app,
      game_id,
      "extracting",
      processed,
      None,
      current_file,
      None,
    );
  }

  Ok(())
}

fn extract_single_file_from_reader<R: Read>(
  app: &tauri::AppHandle,
  game_id: i64,
  archive: &PathBuf,
  mut reader: R,
  destination: &PathBuf,
) -> Result<(), (bool, String)> {
  let output_name = single_file_output_name(archive);
  let output_path = destination.join(&output_name);
  let current_file = Some(output_name);

  if let Some(parent) = output_path.parent() {
    fs::create_dir_all(parent)
      .map_err(|e| (false, format!("Failed to create output directory: {e}")))?;
  }

  emit_extract_progress(app, game_id, "extracting", 0, None, current_file.clone(), None);

  let mut output = fs::File::create(&output_path)
    .map_err(|e| (false, format!("Failed to create output file: {e}")))?;
  std::io::copy(&mut reader, &mut output)
    .map_err(|e| (false, format!("Failed to extract compressed file: {e}")))?;

  emit_extract_progress(app, game_id, "extracting", 1, Some(1), current_file, None);
  Ok(())
}

fn extract_other_supported_archive(
  app: &tauri::AppHandle,
  game_id: i64,
  archive: &PathBuf,
  destination: &PathBuf,
) -> Option<Result<(), (bool, String)>> {
  let name = archive_file_name_lowercase(archive);

  if name.ends_with(".tar") {
    let file = match fs::File::open(archive) {
      Ok(file) => file,
      Err(e) => return Some(Err((false, format!("Failed to open archive: {e}")))),
    };
    return Some(extract_tar_from_reader(app, game_id, file, destination));
  }

  if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
    let file = match fs::File::open(archive) {
      Ok(file) => file,
      Err(e) => return Some(Err((false, format!("Failed to open archive: {e}")))),
    };
    let reader = flate2::read::GzDecoder::new(file);
    return Some(extract_tar_from_reader(app, game_id, reader, destination));
  }

  if name.ends_with(".tar.bz2") || name.ends_with(".tbz") || name.ends_with(".tbz2") {
    let file = match fs::File::open(archive) {
      Ok(file) => file,
      Err(e) => return Some(Err((false, format!("Failed to open archive: {e}")))),
    };
    let reader = bzip2::read::BzDecoder::new(file);
    return Some(extract_tar_from_reader(app, game_id, reader, destination));
  }

  if name.ends_with(".tar.xz") || name.ends_with(".txz") {
    let file = match fs::File::open(archive) {
      Ok(file) => file,
      Err(e) => return Some(Err((false, format!("Failed to open archive: {e}")))),
    };
    let reader = xz2::read::XzDecoder::new(file);
    return Some(extract_tar_from_reader(app, game_id, reader, destination));
  }

  if name.ends_with(".tar.zst") || name.ends_with(".tzst") {
    let file = match fs::File::open(archive) {
      Ok(file) => file,
      Err(e) => return Some(Err((false, format!("Failed to open archive: {e}")))),
    };
    let reader = match zstd::stream::read::Decoder::new(file) {
      Ok(reader) => reader,
      Err(e) => return Some(Err((false, format!("Failed to open Zstd stream: {e}")))),
    };
    return Some(extract_tar_from_reader(app, game_id, reader, destination));
  }

  if name.ends_with(".gz") && !is_tar_based_path(archive) {
    let file = match fs::File::open(archive) {
      Ok(file) => file,
      Err(e) => return Some(Err((false, format!("Failed to open archive: {e}")))),
    };
    let reader = flate2::read::GzDecoder::new(file);
    return Some(extract_single_file_from_reader(app, game_id, archive, reader, destination));
  }

  if name.ends_with(".bz2") && !is_tar_based_path(archive) {
    let file = match fs::File::open(archive) {
      Ok(file) => file,
      Err(e) => return Some(Err((false, format!("Failed to open archive: {e}")))),
    };
    let reader = bzip2::read::BzDecoder::new(file);
    return Some(extract_single_file_from_reader(app, game_id, archive, reader, destination));
  }

  if name.ends_with(".xz") && !is_tar_based_path(archive) {
    let file = match fs::File::open(archive) {
      Ok(file) => file,
      Err(e) => return Some(Err((false, format!("Failed to open archive: {e}")))),
    };
    let reader = xz2::read::XzDecoder::new(file);
    return Some(extract_single_file_from_reader(app, game_id, archive, reader, destination));
  }

  if name.ends_with(".zst") && !is_tar_based_path(archive) {
    let file = match fs::File::open(archive) {
      Ok(file) => file,
      Err(e) => return Some(Err((false, format!("Failed to open archive: {e}")))),
    };
    let reader = match zstd::stream::read::Decoder::new(file) {
      Ok(reader) => reader,
      Err(e) => return Some(Err((false, format!("Failed to open Zstd stream: {e}")))),
    };
    return Some(extract_single_file_from_reader(app, game_id, archive, reader, destination));
  }

  None
}

fn read_magic(path: &PathBuf) -> Result<[u8; 8], String> {
  let mut file = fs::File::open(path).map_err(|e| format!("Failed to open archive: {e}"))?;
  let mut magic = [0u8; 8];
  let read = file
    .read(&mut magic)
    .map_err(|e| format!("Failed to read archive signature: {e}"))?;
  if read < 4 {
    return Err("Archive file is too small.".to_string());
  }
  Ok(magic)
}

#[tauri::command]
fn cancel_download_task(game_id: i64) -> Result<(), String> {
  let guard = control_flags()
    .lock()
    .map_err(|_| "Cancel map lock poisoned".to_string())?;
  if let Some(flag) = guard.get(&game_id) {
    flag.store(DOWNLOAD_CONTROL_CANCEL, Ordering::Relaxed);
  }
  Ok(())
}

#[tauri::command]
fn pause_download_task(game_id: i64) -> Result<(), String> {
  let guard = control_flags()
    .lock()
    .map_err(|_| "Control map lock poisoned".to_string())?;
  if let Some(flag) = guard.get(&game_id) {
    flag.store(DOWNLOAD_CONTROL_PAUSE, Ordering::Relaxed);
  }
  Ok(())
}

fn parse_total_from_content_range(
  header: Option<&reqwest::header::HeaderValue>,
) -> Option<u64> {
  let value = header?.to_str().ok()?;
  let (_, total_part) = value.split_once('/')?;
  total_part.trim().parse::<u64>().ok().filter(|v| *v > 0)
}

fn sanitize_filename(name: &str) -> String {
  let sanitized = name
    .chars()
    .map(|c| match c {
      '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
      _ => c,
    })
    .collect::<String>()
    .trim()
    .to_string();

  if sanitized.is_empty() {
    "download.bin".to_string()
  } else {
    sanitized
  }
}

fn filename_from_content_disposition(header: Option<&reqwest::header::HeaderValue>) -> Option<String> {
  let value = header?.to_str().ok()?;

  for part in value.split(';').map(|s| s.trim()) {
    if let Some(rest) = part.strip_prefix("filename*=UTF-8''") {
      let decoded = rest.replace('%', "%25");
      let maybe = urlencoding::decode(&decoded).ok()?.to_string();
      if !maybe.trim().is_empty() {
        return Some(maybe);
      }
    }
  }

  for part in value.split(';').map(|s| s.trim()) {
    if let Some(rest) = part.strip_prefix("filename=") {
      let unquoted = rest.trim_matches('"').to_string();
      if !unquoted.trim().is_empty() {
        return Some(unquoted);
      }
    }
  }

  None
}

#[tauri::command]
fn download_game_version(
  app: tauri::AppHandle,
  game_id: i64,
  url: String,
  destination_dir: String,
  fallback_filename: Option<String>,
  auth_header: Option<String>,
  resume_position: Option<u64>,
) -> Result<(), String> {
  let control_flag = Arc::new(AtomicU8::new(DOWNLOAD_CONTROL_RUNNING));
  {
    let mut guard = control_flags()
      .lock()
      .map_err(|_| "Cancel map lock poisoned".to_string())?;
    guard.insert(game_id, control_flag.clone());
  }

  tauri::async_runtime::spawn(async move {
    let client = reqwest::Client::new();
    let mut req = client.get(&url).header("Accept", "*/*");
    if let Some(auth) = auth_header.as_ref() {
      if !auth.trim().is_empty() {
        req = req.header("Authorization", auth);
      }
    }
    let resume_position = resume_position.unwrap_or(0);
    if resume_position > 0 {
      req = req.header("Range", format!("bytes={resume_position}-"));
    }

    let response = match req.send().await {
      Ok(res) => res,
      Err(err) => {
        let _ = app.emit(
          "download-progress",
          DownloadProgressEvent {
            game_id,
            status: "error".to_string(),
            received: 0,
            total: None,
            error: Some(format!("Request failed: {err}")),
            filename: None,
            file_path: None,
          },
        );
        return;
      }
    };

    if !response.status().is_success() {
      let _ = app.emit(
        "download-progress",
        DownloadProgressEvent {
          game_id,
          status: "error".to_string(),
          received: 0,
          total: None,
          error: Some(format!("HTTP {}", response.status())),
          filename: None,
          file_path: None,
        },
      );
      return;
    }

    let chosen_filename = filename_from_content_disposition(
      response
        .headers()
        .get(reqwest::header::CONTENT_DISPOSITION),
    )
    .or_else(|| fallback_filename.clone())
    .unwrap_or_else(|| "download.bin".to_string());

    let sanitized_filename = sanitize_filename(&chosen_filename);
    let file_path = PathBuf::from(&destination_dir).join(&sanitized_filename);
    let file_path_string = file_path.to_string_lossy().to_string();

    let mut total = parse_total_from_content_range(
      response
        .headers()
        .get(reqwest::header::CONTENT_RANGE),
    );
    if total.is_none() {
      total = response.content_length().map(|remaining| remaining + resume_position);
    }

    let mut file = match if resume_position > 0 {
      OpenOptions::new()
        .create(true)
        .write(true)
        .open(&file_path)
        .await
    } else {
      File::create(&file_path).await
    } {
      Ok(file) => file,
      Err(err) => {
        let _ = app.emit(
          "download-progress",
          DownloadProgressEvent {
            game_id,
            status: "error".to_string(),
            received: 0,
            total,
            error: Some(format!("File create failed: {err}")),
            filename: Some(sanitized_filename.clone()),
            file_path: Some(file_path_string.clone()),
          },
        );
        return;
      }
    };

    if resume_position > 0 {
      match file.metadata().await {
        Ok(meta) => {
          let current_len = meta.len();
          if current_len < resume_position {
            let _ = app.emit(
              "download-progress",
              DownloadProgressEvent {
                game_id,
                status: "error".to_string(),
                received: current_len,
                total,
                error: Some(
                  "Cannot resume: local file is smaller than the resume position."
                    .to_string(),
                ),
                filename: Some(sanitized_filename.clone()),
                file_path: Some(file_path_string.clone()),
              },
            );
            let mut guard = control_flags().lock().ok();
            if let Some(ref mut map) = guard {
              map.remove(&game_id);
            }
            return;
          }
          if current_len > resume_position {
            if let Err(err) = file.set_len(resume_position).await {
              let _ = app.emit(
                "download-progress",
                DownloadProgressEvent {
                  game_id,
                  status: "error".to_string(),
                  received: 0,
                  total,
                  error: Some(format!("Failed to trim local file: {err}")),
                  filename: Some(sanitized_filename.clone()),
                  file_path: Some(file_path_string.clone()),
                },
              );
              let mut guard = control_flags().lock().ok();
              if let Some(ref mut map) = guard {
                map.remove(&game_id);
              }
              return;
            }
          }
        }
        Err(err) => {
          let _ = app.emit(
            "download-progress",
            DownloadProgressEvent {
              game_id,
              status: "error".to_string(),
              received: 0,
              total,
              error: Some(format!("Failed to read local file metadata: {err}")),
              filename: Some(sanitized_filename.clone()),
              file_path: Some(file_path_string.clone()),
            },
          );
          let mut guard = control_flags().lock().ok();
          if let Some(ref mut map) = guard {
            map.remove(&game_id);
          }
          return;
        }
      }
      if let Err(err) = file.seek(SeekFrom::Start(resume_position)).await {
        let _ = app.emit(
          "download-progress",
          DownloadProgressEvent {
            game_id,
            status: "error".to_string(),
            received: 0,
            total,
            error: Some(format!("Failed to seek local file: {err}")),
            filename: Some(sanitized_filename.clone()),
            file_path: Some(file_path_string.clone()),
          },
        );
        let mut guard = control_flags().lock().ok();
        if let Some(ref mut map) = guard {
          map.remove(&game_id);
        }
        return;
      }
    }

    let mut stream = response.bytes_stream();
    let mut received: u64 = resume_position;
    let mut last_emit = Instant::now();
    let emit_every = Duration::from_millis(250);

    while let Some(next) = stream.next().await {
      let control_state = control_flag.load(Ordering::Relaxed);
      if control_state == DOWNLOAD_CONTROL_PAUSE {
        let _ = app.emit(
          "download-progress",
          DownloadProgressEvent {
            game_id,
            status: "paused".to_string(),
            received,
            total,
            error: None,
            filename: Some(sanitized_filename.clone()),
            file_path: Some(file_path_string.clone()),
          },
        );
        let mut guard = control_flags().lock().ok();
        if let Some(ref mut map) = guard {
          map.remove(&game_id);
        }
        return;
      }
      if control_state == DOWNLOAD_CONTROL_CANCEL {
        let _ = app.emit(
          "download-progress",
          DownloadProgressEvent {
            game_id,
            status: "aborted".to_string(),
            received: 0,
            total: None,
            error: None,
            filename: Some(sanitized_filename.clone()),
            file_path: Some(file_path_string.clone()),
          },
        );
        let _ = tokio::fs::remove_file(&file_path).await;
        let mut guard = control_flags().lock().ok();
        if let Some(ref mut map) = guard {
          map.remove(&game_id);
        }
        return;
      }

      let chunk = match next {
        Ok(bytes) => bytes,
        Err(err) => {
          let _ = app.emit(
            "download-progress",
            DownloadProgressEvent {
              game_id,
              status: "error".to_string(),
              received,
              total,
              error: Some(format!("Stream failed: {err}")),
              filename: Some(sanitized_filename.clone()),
              file_path: Some(file_path_string.clone()),
            },
          );
          let mut guard = control_flags().lock().ok();
          if let Some(ref mut map) = guard {
            map.remove(&game_id);
          }
          return;
        }
      };

      if let Err(err) = file.write_all(&chunk).await {
        let _ = app.emit(
          "download-progress",
          DownloadProgressEvent {
            game_id,
            status: "error".to_string(),
            received,
            total,
            error: Some(format!("Write failed: {err}")),
            filename: Some(sanitized_filename.clone()),
            file_path: Some(file_path_string.clone()),
          },
        );
        let mut guard = control_flags().lock().ok();
        if let Some(ref mut map) = guard {
          map.remove(&game_id);
        }
        return;
      }

      received += chunk.len() as u64;

      if last_emit.elapsed() >= emit_every {
        let _ = app.emit(
          "download-progress",
          DownloadProgressEvent {
            game_id,
            status: "downloading".to_string(),
            received,
            total,
            error: None,
            filename: Some(sanitized_filename.clone()),
            file_path: Some(file_path_string.clone()),
          },
        );
        last_emit = Instant::now();
      }
    }

    let _ = file.flush().await;
    let _ = app.emit(
      "download-progress",
      DownloadProgressEvent {
        game_id,
        status: "completed".to_string(),
        received,
        total,
        error: None,
        filename: Some(sanitized_filename.clone()),
        file_path: Some(file_path_string.clone()),
      },
    );

    let mut guard = control_flags().lock().ok();
    if let Some(ref mut map) = guard {
      map.remove(&game_id);
    }
  });

  Ok(())
}

#[tauri::command]
fn open_in_file_explorer(path: String) -> Result<(), String> {
  Command::new("explorer")
    .arg(path)
    .spawn()
    .map(|_| ())
    .map_err(|e| format!("Failed to open folder: {e}"))
}

#[tauri::command]
fn list_install_executables(extraction_path: String) -> Result<Vec<String>, String> {
  let root = PathBuf::from(extraction_path);
  if !root.exists() || !root.is_dir() {
    return Ok(Vec::new());
  }

  let mut results = Vec::new();
  collect_install_candidates(&root, &root, &mut results)?;
  let (preferred_installer, _) = read_saved_installer_preferences(&root);
  let normalized_preferred = preferred_installer
    .as_ref()
    .map(|value| value.replace('\\', "/").to_ascii_lowercase());

  results.sort_by(|left, right| {
    let left_normalized = left.replace('\\', "/").to_ascii_lowercase();
    let right_normalized = right.replace('\\', "/").to_ascii_lowercase();
    let left_is_preferred = normalized_preferred
      .as_ref()
      .map(|preferred| {
        left_normalized == *preferred || left_normalized.ends_with(preferred)
      })
      .unwrap_or(false);
    let right_is_preferred = normalized_preferred
      .as_ref()
      .map(|preferred| {
        right_normalized == *preferred || right_normalized.ends_with(preferred)
      })
      .unwrap_or(false);

    right_is_preferred
      .cmp(&left_is_preferred)
      .then_with(|| left_normalized.cmp(&right_normalized))
  });
  Ok(results)
}

#[tauri::command]
fn copy_installation_files(
  app: tauri::AppHandle,
  game_id: i64,
  source_path: String,
  destination_path: String,
) -> Result<(), String> {
  let source = PathBuf::from(source_path);
  let destination = PathBuf::from(destination_path);

  if !source.exists() || !source.is_dir() {
    return Err("Extraction folder does not exist".to_string());
  }

  fs::create_dir_all(&destination)
    .map_err(|e| format!("Failed to create installation directory: {e}"))?;

  std::thread::spawn(move || {
    let total = match compute_directory_size(&source) {
      Ok(total) => total,
      Err(error) => {
        emit_install_copy_progress(&app, game_id, "error", 0, None, None, Some(error));
        return;
      }
    };

    emit_install_copy_progress(&app, game_id, "copying", 0, Some(total), None, None);

    let mut processed = 0u64;
    let result = copy_path_with_progress(
      &app,
      game_id,
      &source,
      &source,
      &destination,
      &mut processed,
      total,
    );

    match result {
      Ok(_) => emit_install_copy_progress(
        &app,
        game_id,
        "completed",
        total,
        Some(total),
        None,
        None,
      ),
      Err(error) => emit_install_copy_progress(
        &app,
        game_id,
        "error",
        processed,
        Some(total),
        None,
        Some(error),
      ),
    }
  });

  Ok(())
}

#[tauri::command]
fn launch_installation_executable(
  app: tauri::AppHandle,
  game_id: i64,
  extraction_path: String,
  installer_relative_path: String,
  installation_path: String,
) -> Result<(), String> {
  let extraction_root = PathBuf::from(extraction_path);
  let installer_path = extraction_root.join(installer_relative_path.replace('/', "\\"));
  if !installer_path.exists() || !installer_path.is_file() {
    return Err("Selected installer does not exist".to_string());
  }

  let installation_path_resolved = installation_path.clone();
  let installer_relative = installer_relative_path.clone();
  let (_, installer_parameters) = read_saved_installer_preferences(&extraction_root);
  let is_msi = installer_path
    .extension()
    .and_then(|v| v.to_str())
    .map(|v| v.eq_ignore_ascii_case("msi"))
    .unwrap_or(false);

  std::thread::spawn(move || {
    emit_installer_status(
      &app,
      game_id,
      "launching",
      Some(installer_relative.clone()),
      None,
      None,
    );

    let mut command = if is_msi {
      let mut cmd = Command::new("msiexec");
      cmd.arg("/i").arg(&installer_path);
      cmd
    } else {
      Command::new(&installer_path)
    };

    let resolved_parameters = installer_parameters
      .map(|value| value.replace("%INSTALLDIR%", &installation_path_resolved))
      .filter(|value| !value.trim().is_empty());
    let fallback_argument_list = if is_msi {
      let base = format!("/i \"{}\"", installer_path.display());
      match resolved_parameters.as_deref() {
        Some(parameters) => format!("{base} {parameters}"),
        None => base,
      }
    } else {
      resolved_parameters.clone().unwrap_or_default()
    };

    if let Some(parameters) = resolved_parameters {
      #[cfg(windows)]
      {
        command.raw_arg(parameters);
      }

      #[cfg(not(windows))]
      {
        for arg in parameters.split_whitespace() {
          command.arg(arg);
        }
      }
    }

    let child = match command.spawn() {
      Ok(child) => child,
      Err(error) => {
        #[cfg(windows)]
        {
          if error.raw_os_error() == Some(740) {
            emit_installer_status(
              &app,
              game_id,
              "running",
              Some(installer_relative.clone()),
              None,
              None,
            );

            match run_elevated_installer_and_wait(
              command.get_program().to_string_lossy().as_ref(),
              if fallback_argument_list.trim().is_empty() {
                None
              } else {
                Some(fallback_argument_list.as_str())
              },
              installer_path.parent().and_then(|value| value.to_str()),
            ) {
              Ok(exit_code) => {
                emit_installer_status(
                  &app,
                  game_id,
                  "completed",
                  Some(installer_relative.clone()),
                  exit_code,
                  None,
                );
              }
              Err(message) => {
                emit_installer_status(
                  &app,
                  game_id,
                  "error",
                  Some(installer_relative.clone()),
                  None,
                  Some(message),
                );
              }
            }
            return;
          }
        }

        emit_installer_status(
          &app,
          game_id,
          "error",
          Some(installer_relative.clone()),
          None,
          Some(format!("Failed to start installer: {error}")),
        );
        return;
      }
    };

    emit_installer_status(
      &app,
      game_id,
      "running",
      Some(installer_relative.clone()),
      None,
      None,
    );

    match child.wait_with_output() {
      Ok(output) => {
        let exit_code = output.status.code();
        if output.status.success() {
          emit_installer_status(
            &app,
            game_id,
            "completed",
            Some(installer_relative),
            exit_code,
            None,
          );
        } else {
          emit_installer_status(
            &app,
            game_id,
            "error",
            Some(installer_relative),
            exit_code,
            Some(format!(
              "Installer exited with code {}.",
              exit_code.unwrap_or(-1)
            )),
          );
        }
      }
      Err(error) => emit_installer_status(
        &app,
        game_id,
        "error",
        Some(installer_relative),
        None,
        Some(format!("Failed while waiting for installer: {error}")),
      ),
    }
  });

  Ok(())
}

#[tauri::command]
fn launch_uninstall_executable(
  executable_path: String,
  working_directory: Option<String>,
  argument_list: Option<String>,
) -> Result<Option<i32>, String> {
  let executable = PathBuf::from(&executable_path);
  if !executable.exists() || !executable.is_file() {
    return Err("Selected uninstall executable does not exist".to_string());
  }

  let is_msi = executable
    .extension()
    .and_then(|value| value.to_str())
    .map(|value| value.eq_ignore_ascii_case("msi"))
    .unwrap_or(false);

  let mut command = if is_msi {
    let mut cmd = Command::new("msiexec");
    cmd.arg("/x").arg(&executable);
    cmd
  } else {
    Command::new(&executable)
  };

  if let Some(directory) = working_directory.as_deref().filter(|value| !value.trim().is_empty()) {
    command.current_dir(directory);
  }

  let resolved_arguments = argument_list
    .as_deref()
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .map(str::to_string);
  let fallback_argument_list = if is_msi {
    let base = format!("/x \"{}\"", executable.display());
    match resolved_arguments.as_deref() {
      Some(arguments) => format!("{base} {arguments}"),
      None => base,
    }
  } else {
    resolved_arguments.clone().unwrap_or_default()
  };

  if let Some(arguments) = resolved_arguments {
    #[cfg(windows)]
    {
      command.raw_arg(arguments);
    }

    #[cfg(not(windows))]
    {
      for arg in arguments.split_whitespace() {
        command.arg(arg);
      }
    }
  }

  let child = match command.spawn() {
    Ok(child) => child,
    Err(error) => {
      #[cfg(windows)]
      {
        if error.raw_os_error() == Some(740) {
          return run_elevated_installer_and_wait(
            command.get_program().to_string_lossy().as_ref(),
            if fallback_argument_list.trim().is_empty() {
              None
            } else {
              Some(fallback_argument_list.as_str())
            },
            working_directory.as_deref(),
          );
        }
      }

      return Err(format!("Failed to start uninstall executable: {error}"));
    }
  };

  match child.wait_with_output() {
    Ok(output) => {
      let exit_code = output.status.code();
      if output.status.success() {
        Ok(exit_code)
      } else {
        Err(format!(
          "Uninstall executable exited with code {}.",
          exit_code.unwrap_or(-1)
        ))
      }
    }
    Err(error) => Err(format!("Failed while waiting for uninstall executable: {error}")),
  }
}

#[tauri::command]
fn extract_archive(
  app: tauri::AppHandle,
  game_id: i64,
  archive_path: String,
  destination_path: String,
  password: Option<String>,
) -> Result<ExtractArchiveResponse, String> {
  let archive = PathBuf::from(archive_path);
  let destination = PathBuf::from(destination_path);

  if !archive.exists() {
    return Err("Archive does not exist".to_string());
  }

  if !destination.exists() {
    fs::create_dir_all(&destination)
      .map_err(|e| format!("Failed to create extraction directory: {e}"))?;
  }

  let magic = read_magic(&archive)?;
  let is_zip = magic[0] == 0x50 && magic[1] == 0x4B;
  let is_rar = magic[0] == 0x52
    && magic[1] == 0x61
    && magic[2] == 0x72
    && magic[3] == 0x21
    && magic[4] == 0x1A
    && magic[5] == 0x07;
  let is_7z = magic[0] == 0x37
    && magic[1] == 0x7A
    && magic[2] == 0xBC
    && magic[3] == 0xAF
    && magic[4] == 0x27
    && magic[5] == 0x1C;

  if is_zip {
    return match extract_zip_archive(&app, game_id, &archive, &destination, password.as_deref()) {
      Ok(_) => Ok(ExtractArchiveResponse {
        success: true,
        needs_password: false,
        message: None,
      }),
      Err((needs_password, msg)) => Ok(ExtractArchiveResponse {
        success: false,
        needs_password,
        message: Some(msg),
      }),
    };
  }

  if is_rar {
    return match extract_rar_archive(&app, game_id, &archive, &destination, password.as_deref()) {
      Ok(_) => Ok(ExtractArchiveResponse {
        success: true,
        needs_password: false,
        message: None,
      }),
      Err((needs_password, msg)) => Ok(ExtractArchiveResponse {
        success: false,
        needs_password,
        message: Some(msg),
      }),
    };
  }

  if is_iso_archive(&archive) {
    return match extract_iso_archive(&app, game_id, &archive, &destination) {
      Ok(_) => Ok(ExtractArchiveResponse {
        success: true,
        needs_password: false,
        message: None,
      }),
      Err((needs_password, msg)) => Ok(ExtractArchiveResponse {
        success: false,
        needs_password,
        message: Some(msg),
      }),
    };
  }

  if let Some(result) = extract_other_supported_archive(&app, game_id, &archive, &destination) {
    return match result {
      Ok(_) => Ok(ExtractArchiveResponse {
        success: true,
        needs_password: false,
        message: None,
      }),
      Err((needs_password, msg)) => Ok(ExtractArchiveResponse {
        success: false,
        needs_password,
        message: Some(msg),
      }),
    };
  }

  if !is_7z {
    return Ok(ExtractArchiveResponse {
      success: false,
      needs_password: false,
      message: Some(
        "Unsupported archive format for built-in extractor. Supported formats include ZIP, RAR, 7z, ISO, TAR, TAR.GZ/TGZ, TAR.BZ2/TBZ2, TAR.XZ/TXZ, TAR.ZST/TZST, and single-file GZ/BZ2/XZ/ZST."
          .to_string(),
      ),
    });
  }

  let run_result = extract_7z_archive(&app, game_id, &archive, &destination, password.as_deref());

  match run_result {
    Ok(_) => Ok(ExtractArchiveResponse {
      success: true,
      needs_password: false,
      message: None,
    }),
    Err((needs_password, msg)) => {
      if needs_password {
        Ok(ExtractArchiveResponse {
          success: false,
          needs_password: true,
          message: Some("Archive is password protected.".to_string()),
        })
      } else {
        Ok(ExtractArchiveResponse {
          success: false,
          needs_password: false,
          message: Some(msg),
        })
      }
    }
  }
}

fn collect_launch_candidates(root: &Path, current: &Path, results: &mut Vec<String>) -> Result<(), String> {
  let entries = fs::read_dir(current)
    .map_err(|e| format!("Failed to read installation folder: {e}"))?;

  for entry in entries {
    let entry = entry.map_err(|e| format!("Failed to read installation folder entry: {e}"))?;
    let path = entry.path();

    if path.is_dir() {
      collect_launch_candidates(root, &path, results)?;
      continue;
    }

    #[cfg(windows)]
    {
      let ext = path
        .extension()
        .and_then(|v| v.to_str())
        .map(|v| v.to_ascii_lowercase())
        .unwrap_or_default();

      if !matches!(ext.as_str(), "exe" | "bat" | "cmd" | "com" | "ps1" | "lnk") {
        continue;
      }
    }

    #[cfg(not(windows))]
    {
      use std::os::unix::fs::PermissionsExt;
      let Ok(metadata) = fs::metadata(&path) else { continue };
      let mode = metadata.permissions().mode();
      if mode & 0o111 == 0 {
        continue;
      }
    }

    if let Ok(relative) = path.strip_prefix(root) {
      results.push(relative.to_string_lossy().replace('\\', "/"));
    }
  }

  Ok(())
}

#[tauri::command]
fn list_launch_executables(installation_path: String) -> Result<Vec<String>, String> {
  let root = PathBuf::from(&installation_path);
  if !root.exists() || !root.is_dir() {
    return Ok(Vec::new());
  }

  let mut results = Vec::new();
  collect_launch_candidates(&root, &root, &mut results)?;
  results.sort_by(|a, b| {
    a.to_ascii_lowercase().cmp(&b.to_ascii_lowercase())
  });
  Ok(results)
}

#[tauri::command]
fn launch_game(
  installation_path: String,
  executable_relative_path: String,
  launch_parameters: Option<String>,
  run_as_admin: Option<bool>,
) -> Result<(), String> {
  let root = PathBuf::from(&installation_path);
  let exe_path = root.join(executable_relative_path.replace('/', std::path::MAIN_SEPARATOR_STR));
  if !exe_path.exists() || !exe_path.is_file() {
    return Err("Selected executable does not exist".to_string());
  }

  let working_dir = exe_path.parent().unwrap_or(&root);

  #[cfg(windows)]
  if run_as_admin.unwrap_or(false) {
    use std::os::windows::ffi::OsStrExt;
    use std::ffi::OsStr;

    // Use ShellExecuteW with "runas" verb to trigger UAC elevation
    let verb: Vec<u16> = OsStr::new("runas").encode_wide().chain(std::iter::once(0)).collect();
    let file: Vec<u16> = exe_path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let params_str = launch_parameters.as_deref().unwrap_or("");
    let params_w: Vec<u16> = OsStr::new(params_str).encode_wide().chain(std::iter::once(0)).collect();
    let dir_str = working_dir.as_os_str();
    let dir_w: Vec<u16> = dir_str.encode_wide().chain(std::iter::once(0)).collect();

    let result = unsafe {
      winapi::um::shellapi::ShellExecuteW(
        std::ptr::null_mut(),
        verb.as_ptr(),
        file.as_ptr(),
        params_w.as_ptr(),
        dir_w.as_ptr(),
        winapi::um::winuser::SW_SHOWNORMAL,
      )
    };

    if (result as isize) <= 32 {
      return Err(format!("Failed to launch game as admin (ShellExecute error code: {})", result as isize));
    }
    return Ok(());
  }

  let mut command = Command::new(&exe_path);
  command.current_dir(working_dir);

  if let Some(ref params) = launch_parameters {
    let params = params.trim();
    if !params.is_empty() {
      #[cfg(windows)]
      {
        command.raw_arg(params);
      }
      #[cfg(not(windows))]
      {
        for arg in params.split_whitespace() {
          command.arg(arg);
        }
      }
    }
  }

  #[cfg(windows)]
  {
    // CREATE_NEW_PROCESS_GROUP so the game doesn't die when we close
    command.creation_flags(0x00000200);
  }

  match command.spawn() {
    Ok(_) => Ok(()),
    #[cfg(windows)]
    Err(ref e) if e.raw_os_error() == Some(740) => {
      // ERROR_ELEVATION_REQUIRED — automatically retry with UAC elevation
      use std::os::windows::ffi::OsStrExt;
      use std::ffi::OsStr;

      let verb: Vec<u16> = OsStr::new("runas").encode_wide().chain(std::iter::once(0)).collect();
      let file: Vec<u16> = exe_path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
      let params_str = launch_parameters.as_deref().unwrap_or("");
      let params_w: Vec<u16> = OsStr::new(params_str).encode_wide().chain(std::iter::once(0)).collect();
      let dir_str = working_dir.as_os_str();
      let dir_w: Vec<u16> = dir_str.encode_wide().chain(std::iter::once(0)).collect();

      let result = unsafe {
        winapi::um::shellapi::ShellExecuteW(
          std::ptr::null_mut(),
          verb.as_ptr(),
          file.as_ptr(),
          params_w.as_ptr(),
          dir_w.as_ptr(),
          winapi::um::winuser::SW_SHOWNORMAL,
        )
      };

      if (result as isize) <= 32 {
        return Err(format!("Failed to launch game as admin (ShellExecute error code: {})", result as isize));
      }
      Ok(())
    }
    Err(e) => Err(format!("Failed to launch game: {e}")),
  }
}

// ── GameTimeTracker ───────────────────────────────────────────────────────────

#[tauri::command]
fn start_game_time_tracker(
  server_url: String,
  user_id: i64,
  access_token: String,
  download_path: String,
) -> Result<(), String> {
  // Stop any existing tracker first
  if let Ok(mut tx) = tracker_stop_tx().lock() {
    if let Some(sender) = tx.take() {
      let _ = sender.send(true);
    }
  }

  let config = TrackerConfig {
    server_url,
    user_id,
    access_token,
    download_path,
  };

  if let Ok(mut cfg) = tracker_config().lock() {
    *cfg = Some(config);
  }

  let (stop_tx, stop_rx) = watch::channel(false);
  if let Ok(mut tx) = tracker_stop_tx().lock() {
    *tx = Some(stop_tx);
  }

  tauri::async_runtime::spawn(game_time_tracker_loop(stop_rx));

  Ok(())
}

#[tauri::command]
fn stop_game_time_tracker() -> Result<(), String> {
  if let Ok(mut tx) = tracker_stop_tx().lock() {
    if let Some(sender) = tx.take() {
      let _ = sender.send(true);
    }
  }
  if let Ok(mut cfg) = tracker_config().lock() {
    *cfg = None;
  }
  Ok(())
}

#[tauri::command]
fn update_tracker_auth(access_token: String) -> Result<(), String> {
  if let Ok(mut cfg) = tracker_config().lock() {
    if let Some(ref mut c) = *cfg {
      c.access_token = access_token;
    }
  }
  Ok(())
}

async fn game_time_tracker_loop(mut stop_rx: watch::Receiver<bool>) {
  let mut interval = tokio::time::interval(Duration::from_secs(60));
  // Skip the immediate first tick
  interval.tick().await;

  loop {
    tokio::select! {
      _ = interval.tick() => {},
      _ = stop_rx.changed() => {
        break;
      }
    }

    // Read current config snapshot
    let config = match tracker_config().lock() {
      Ok(guard) => match guard.clone() {
        Some(c) => c,
        None => continue,
      },
      Err(_) => continue,
    };

    if config.download_path.is_empty() || config.server_url.is_empty() {
      continue;
    }

    // Get all installed games
    let installed = match list_installed_games(config.download_path.clone()) {
      Ok(games) => games,
      Err(_) => continue,
    };

    if installed.is_empty() {
      continue;
    }

    // Deduplicate by game_id — collect all exe paths per unique game
    let mut game_exe_map: HashMap<i64, Vec<PathBuf>> = HashMap::new();

    for game in &installed {
      let install_dir = PathBuf::from(&game.installation_directory);
      if !install_dir.exists() || !install_dir.is_dir() {
        continue;
      }

      let mut candidates = Vec::new();
      if collect_launch_candidates(&install_dir, &install_dir, &mut candidates).is_err() {
        continue;
      }

      let abs_paths: Vec<PathBuf> = candidates
        .iter()
        .map(|rel| {
          // collect_launch_candidates returns forward-slash relative paths
          install_dir.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR))
        })
        .collect();

      game_exe_map
        .entry(game.game_id)
        .or_default()
        .extend(abs_paths);
    }

    if game_exe_map.is_empty() {
      continue;
    }

    // Scan running processes
    let mut sys = System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    // Collect all running process exe paths
    let running_paths: Vec<PathBuf> = sys
      .processes()
      .values()
      .filter_map(|p| {
        let exe = p.exe()?;
        if exe.as_os_str().is_empty() {
          None
        } else {
          Some(exe.to_path_buf())
        }
      })
      .collect();

    // Find which games are running
    let mut matched_game_ids: Vec<i64> = Vec::new();

    for (game_id, exe_paths) in &game_exe_map {
      let is_running = exe_paths.iter().any(|game_exe| {
        running_paths.iter().any(|proc_exe| {
          paths_match(game_exe, proc_exe)
        })
      });
      if is_running {
        matched_game_ids.push(*game_id);
      }
    }

    if matched_game_ids.is_empty() {
      continue;
    }

    // Send increment requests — track failures for offline storage
    let client = reqwest::Client::new();
    for game_id in matched_game_ids {
      let url = format!(
        "{}/api/progresses/user/{}/game/{}/increment",
        config.server_url, config.user_id, game_id
      );
      let result = client
        .put(&url)
        .header("Authorization", format!("Bearer {}", config.access_token))
        .header("Accept", "application/json")
        .send()
        .await;

      // If network error (not HTTP error), save offline time
      if result.is_err() {
        save_offline_time(&config.download_path, config.user_id, game_id);
      }
    }
  }
}

/// Save accumulated offline play time for a game.
/// Reads existing .gamevault.offline_time.json in the version directory
/// and increments accumulated_minutes by 1.
fn save_offline_time(download_path: &str, user_id: i64, game_id: i64) {
  // Find the installed game's version directory
  let installed = match list_installed_games(download_path.to_string()) {
    Ok(games) => games,
    Err(_) => return,
  };

  let target = match installed.iter().find(|g| g.game_id == game_id) {
    Some(g) => g,
    None => return,
  };

  let offline_file = PathBuf::from(&target.version_directory).join(".gamevault.offline_time.json");

  let mut current_minutes: i64 = 0;
  if offline_file.exists() {
    if let Ok(content) = fs::read_to_string(&offline_file) {
      if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
        current_minutes = json.get("accumulated_minutes").and_then(|v| v.as_i64()).unwrap_or(0);
      }
    }
  }

  let data = serde_json::json!({
    "user_id": user_id,
    "game_id": game_id,
    "accumulated_minutes": current_minutes + 1
  });

  let _ = fs::write(&offline_file, serde_json::to_string(&data).unwrap_or_default());
}

/// Compare two paths for equality.
/// Windows: case-insensitive with canonicalized separators.
/// Linux: exact match.
fn paths_match(a: &Path, b: &Path) -> bool {
  #[cfg(windows)]
  {
    let a_str = a.to_string_lossy().to_lowercase().replace('/', "\\");
    let b_str = b.to_string_lossy().to_lowercase().replace('/', "\\");
    a_str == b_str
  }
  #[cfg(not(windows))]
  {
    a == b
  }
}

// ── End GameTimeTracker ───────────────────────────────────────────────────────

// ── Filesystem utility commands (bypasses plugin-fs scope restrictions) ───────

#[tauri::command]
fn fs_read_text_file(path: String) -> Result<String, String> {
  std::fs::read_to_string(&path).map_err(|e| format!("fs_read_text_file failed for '{}': {}", path, e))
}

#[tauri::command]
fn fs_write_text_file(path: String, content: String) -> Result<(), String> {
  std::fs::write(&path, content).map_err(|e| format!("fs_write_text_file failed for '{}': {}", path, e))
}

#[tauri::command]
fn fs_create_dir_all(path: String) -> Result<(), String> {
  std::fs::create_dir_all(&path).map_err(|e| format!("fs_create_dir_all failed for '{}': {}", path, e))
}

#[tauri::command]
fn fs_path_exists(path: String) -> Result<bool, String> {
  Ok(std::path::Path::new(&path).exists())
}

#[tauri::command]
fn fs_remove(path: String, recursive: bool) -> Result<(), String> {
  let p = std::path::Path::new(&path);
  if !p.exists() {
    return Ok(());
  }
  if recursive && p.is_dir() {
    std::fs::remove_dir_all(&path).map_err(|e| format!("fs_remove (recursive) failed for '{}': {}", path, e))
  } else if p.is_dir() {
    std::fs::remove_dir(&path).map_err(|e| format!("fs_remove (dir) failed for '{}': {}", path, e))
  } else {
    std::fs::remove_file(&path).map_err(|e| format!("fs_remove (file) failed for '{}': {}", path, e))
  }
}

// ── End filesystem utility commands ──────────────────────────────────────────

// ── Offline cache commands ────────────────────────────────────────────────────

fn cache_root(app: &tauri::AppHandle) -> PathBuf {
  app.path()
    .app_data_dir()
    .unwrap_or_else(|_| PathBuf::from("."))
    .join("offline-cache")
}

#[tauri::command]
fn cache_game_data(app: tauri::AppHandle, game_id: i64, json: String) -> Result<(), String> {
  let dir = cache_root(&app).join("games");
  fs::create_dir_all(&dir)
    .map_err(|e| format!("Failed to create cache dir: {e}"))?;
  let path = dir.join(format!("{game_id}.json"));
  fs::write(&path, json.as_bytes())
    .map_err(|e| format!("Failed to cache game data: {e}"))?;
  Ok(())
}

#[tauri::command]
fn cache_game_image(
  app: tauri::AppHandle,
  media_id: i64,
  bytes: Vec<u8>,
  content_type: String,
) -> Result<(), String> {
  let dir = cache_root(&app).join("images");
  fs::create_dir_all(&dir)
    .map_err(|e| format!("Failed to create images cache dir: {e}"))?;
  let ext = content_type
    .split('/')
    .nth(1)
    .unwrap_or("bin");
  let path = dir.join(format!("{media_id}.{ext}"));
  fs::write(&path, &bytes)
    .map_err(|e| format!("Failed to cache image: {e}"))?;
  Ok(())
}

#[tauri::command]
fn load_cached_game(app: tauri::AppHandle, game_id: i64) -> Result<Option<String>, String> {
  let path = cache_root(&app)
    .join("games")
    .join(format!("{game_id}.json"));
  if !path.exists() {
    return Ok(None);
  }
  fs::read_to_string(&path)
    .map(Some)
    .map_err(|e| format!("Failed to read cached game: {e}"))
}

#[tauri::command]
fn load_cached_image(app: tauri::AppHandle, media_id: i64) -> Result<Option<Vec<u8>>, String> {
  let images_dir = cache_root(&app).join("images");
  if !images_dir.exists() {
    return Ok(None);
  }
  // Search for any file starting with {media_id}.
  let entries = fs::read_dir(&images_dir)
    .map_err(|e| format!("Failed to read images dir: {e}"))?;
  let prefix = format!("{media_id}.");
  for entry in entries.flatten() {
    let name = entry.file_name().to_string_lossy().to_string();
    if name.starts_with(&prefix) {
      return fs::read(entry.path())
        .map(Some)
        .map_err(|e| format!("Failed to read cached image: {e}"));
    }
  }
  Ok(None)
}

#[tauri::command]
fn list_cached_game_ids(app: tauri::AppHandle) -> Result<Vec<i64>, String> {
  let dir = cache_root(&app).join("games");
  if !dir.exists() {
    return Ok(Vec::new());
  }
  let mut ids = Vec::new();
  for entry in fs::read_dir(&dir).map_err(|e| format!("Failed to read cache dir: {e}"))?.flatten() {
    let name = entry.file_name().to_string_lossy().to_string();
    if let Some(stem) = name.strip_suffix(".json") {
      if let Ok(id) = stem.parse::<i64>() {
        ids.push(id);
      }
    }
  }
  Ok(ids)
}

#[tauri::command]
fn delete_cached_game(app: tauri::AppHandle, game_id: i64) -> Result<(), String> {
  let path = cache_root(&app).join("games").join(format!("{game_id}.json"));
  if path.exists() {
    fs::remove_file(&path).map_err(|e| format!("Failed to delete cached game: {e}"))?;
  }
  Ok(())
}

#[tauri::command]
fn delete_cached_image(app: tauri::AppHandle, media_id: i64) -> Result<(), String> {
  let images_dir = cache_root(&app).join("images");
  if !images_dir.exists() {
    return Ok(());
  }
  let prefix = format!("{media_id}.");
  for entry in fs::read_dir(&images_dir).map_err(|e| format!("Failed to read images dir: {e}"))?.flatten() {
    let name = entry.file_name().to_string_lossy().to_string();
    if name.starts_with(&prefix) {
      fs::remove_file(entry.path()).map_err(|e| format!("Failed to delete cached image: {e}"))?;
    }
  }
  Ok(())
}

// ── Offline time tracking commands ────────────────────────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OfflineTimeFile {
  path: String,
  user_id: i64,
  game_id: i64,
  accumulated_minutes: i64,
}

#[tauri::command]
fn get_offline_time_files(selected_root: String) -> Result<Vec<OfflineTimeFile>, String> {
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
      // Don't recurse into .cache or Download/Extraction folders
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
          results.push(OfflineTimeFile {
            path: path.to_string_lossy().to_string(),
            user_id,
            game_id,
            accumulated_minutes,
          });
        }
      }
    }
  }
  Ok(())
}

#[tauri::command]
fn delete_offline_time_file(path: String) -> Result<(), String> {
  let p = Path::new(&path);
  if p.exists() {
    fs::remove_file(p).map_err(|e| format!("Failed to delete offline time file: {e}"))?;
  }
  Ok(())
}

#[tauri::command]
async fn sync_offline_time(
  server_url: String,
  access_token: String,
  user_id: i64,
  game_id: i64,
  minutes: i64,
) -> Result<bool, String> {
  let url = format!(
    "{}/api/progresses/user/{}/game/{}/increment/{}",
    server_url, user_id, game_id, minutes
  );
  let client = reqwest::Client::new();
  let resp = client
    .put(&url)
    .header("Authorization", format!("Bearer {}", access_token))
    .header("Accept", "application/json")
    .send()
    .await
    .map_err(|e| format!("Sync request failed: {e}"))?;
  Ok(resp.status().is_success())
}

// ── End offline cache & time tracking commands ────────────────────────────────
// ── App Settings (start-minimized config persisted to app data dir) ──────────

#[derive(Serialize, Deserialize, Default)]
struct AppSettings {
  #[serde(default)]
  start_minimized: bool,
}

fn settings_path(app: &tauri::AppHandle) -> PathBuf {
  app.path().app_data_dir().unwrap().join("gamevault-settings.json")
}

#[tauri::command]
fn get_start_minimized(app: tauri::AppHandle) -> bool {
  let path = settings_path(&app);
  if path.exists() {
    if let Ok(data) = std::fs::read_to_string(&path) {
      if let Ok(settings) = serde_json::from_str::<AppSettings>(&data) {
        return settings.start_minimized;
      }
    }
  }
  false
}

#[tauri::command]
fn set_start_minimized(app: tauri::AppHandle, minimized: bool) -> Result<(), String> {
  let path = settings_path(&app);
  if let Some(parent) = path.parent() {
    std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create config dir: {}", e))?;
  }
  let settings = AppSettings { start_minimized: minimized };
  let data = serde_json::to_string_pretty(&settings).map_err(|e| format!("Failed to serialize: {}", e))?;
  std::fs::write(&path, &data).map_err(|e| format!("Failed to write config: {}", e))
}

// ── End App Settings ─────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_autostart::init(Default::default(), None))
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // ── System tray with Show / Quit menu ──────────────────────────────

      let show_item = MenuItemBuilder::with_id("show", "Show").build(app)?;
      let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
      let menu = MenuBuilder::new(app)
        .item(&show_item)
        .item(&quit_item)
        .build()?;

      let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .on_menu_event(|app, event| {
          match event.id.as_ref() {
            "show" => {
              if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
              }
            }
            "quit" => {
              app.exit(0);
            }
            _ => {}
          }
        })
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
          } = event
          {
            let app = tray.app_handle();
            if let Some(window) = app.get_webview_window("main") {
              if window.is_visible().unwrap_or(false) {
                let _ = window.hide();
              } else {
                let _ = window.show();
                let _ = window.set_focus();
              }
            }
          }
        })
        .build(app)?;

      // ── Close-to-tray: intercept window close, hide instead of quit ────

      if let Some(window) = app.get_webview_window("main") {
        let window_handle = window.clone();
        window.on_window_event(move |event| {
          if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window_handle.hide();
          }
        });
      }

      // ── Conditionally hide window at startup ───────────────────────────

      {
        let path = app.path().app_data_dir().unwrap().join("gamevault-settings.json");
        let start_minimized = if path.exists() {
          std::fs::read_to_string(&path)
            .ok()
            .and_then(|data| serde_json::from_str::<AppSettings>(&data).ok())
            .map(|s| s.start_minimized)
            .unwrap_or(false)
        } else {
          false
        };

        if start_minimized {
          if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
          }
        }
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      open_in_file_explorer,
      extract_archive,
      list_install_executables,
      copy_installation_files,
      launch_installation_executable,
      launch_uninstall_executable,
      download_game_version,
      cancel_download_task,
      pause_download_task,
      recover_download_cards,
      list_installed_games,
      list_launch_executables,
      launch_game,
      start_game_time_tracker,
      stop_game_time_tracker,
      update_tracker_auth,
      fs_read_text_file,
      fs_write_text_file,
      fs_create_dir_all,
      fs_path_exists,
      fs_remove,
      cache_game_data,
      cache_game_image,
      load_cached_game,
      load_cached_image,
      list_cached_game_ids,
      delete_cached_game,
      delete_cached_image,
      get_offline_time_files,
      delete_offline_time_file,
      sync_offline_time,
      get_start_minimized,
      set_start_minimized
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
