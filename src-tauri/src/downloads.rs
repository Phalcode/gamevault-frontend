use crate::events::RecoveredDownloadCard;
use crate::games::directory_has_entries;
use crate::util::{parse_version_folder, stable_id_from_path, parse_i64_json, resolve_version_id, resolve_version_subdir};
use std::fs;
use std::path::PathBuf;

#[tauri::command]
pub(crate) fn recover_download_cards(selected_root: String) -> Result<Vec<RecoveredDownloadCard>, String> {
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
      let (folder_version_id, version_name) = parse_version_folder(&version_folder_name);

      let config_path = version_path.join(".gamevault.game.config.json");
      if !config_path.exists() {
        continue;
      }

      let cfg_value = fs::read_to_string(&config_path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
      let version_id = resolve_version_id(&cfg_value, folder_version_id);

      let download_finished = cfg_value
        .get("downloadfinished")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
      let extraction_finished = cfg_value
        .get("extractionfinished")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
      // The install may have completed without the `installationfinished` flag
      // ever being written (e.g. self-extracting installers). Fall back to
      // checking the installation directory has content, matching
      // `list_installed_games`, so a recovered card doesn't show as uninstalled.
      let installations_dir =
        resolve_version_subdir(&version_path, "Installation", "Installations");
      let installation_finished = cfg_value
        .get("installationfinished")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
        || directory_has_entries(&installations_dir);
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

use crate::events::DownloadProgressEvent;
use crate::state::{control_flags, DOWNLOAD_CONTROL_RUNNING, DOWNLOAD_CONTROL_PAUSE, DOWNLOAD_CONTROL_CANCEL};
use std::io::SeekFrom;
use std::sync::Arc;
use std::sync::atomic::{AtomicU8, Ordering};
use std::time::{Duration, Instant};
use tauri::Emitter;
use tokio::fs::{File, OpenOptions};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};
use futures_util::StreamExt;

#[tauri::command]
pub(crate) fn cancel_download_task(game_id: i64) -> Result<(), String> {
  let guard = control_flags()
    .lock()
    .map_err(|_| "Cancel map lock poisoned".to_string())?;
  if let Some(flag) = guard.get(&game_id) {
    flag.store(DOWNLOAD_CONTROL_CANCEL, Ordering::Relaxed);
  }
  Ok(())
}

#[tauri::command]
pub(crate) fn pause_download_task(game_id: i64) -> Result<(), String> {
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
  let mut sanitized = String::with_capacity(name.len());
  for c in name.chars() {
    match c {
      '<' | '>' | '"' | '/' | '\\' | '|' | '?' | '*' => sanitized.push('_'),
      // A colon becomes " - " so that "Game: Edition" -> "Game - Edition",
      // matching the folder-name sanitization used for the install path.
      ':' => sanitized.push_str(" - "),
      _ => sanitized.push(c),
    }
  }

  // Collapse whitespace runs and trim, so "Game: Edition" -> "Game - Edition"
  // rather than "Game -  Edition".
  let sanitized = sanitized
    .split_whitespace()
    .collect::<Vec<_>>()
    .join(" ");

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
pub(crate) fn download_game_version(
  app: tauri::AppHandle,
  game_id: i64,
  url: String,
  destination_dir: String,
  fallback_filename: Option<String>,
  auth_header: Option<String>,
  speed_limit_kb: Option<u64>,
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
    if let Some(limit) = speed_limit_kb.filter(|limit| *limit > 0) {
      req = req.header("X-Download-Speed-Limit", limit.to_string());
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

    // Don't let the user waste time downloading a file that will not fit on
    // the target disk. Compare the expected download size against the free
    // space on the destination volume (only when we know the size in advance).
    if let (Some(needed), Some(free)) = (total, crate::util::free_space_on(&file_path)) {
      if needed > free {
        let _ = app.emit(
          "download-progress",
          DownloadProgressEvent {
            game_id,
            status: "error".to_string(),
            received: 0,
            total,
            error: Some(format!(
              "Not enough disk space to download this file (needs about {} bytes, only {} bytes free).",
              needed, free
            )),
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
