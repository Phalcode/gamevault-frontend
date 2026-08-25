use crate::games::{list_installed_games, collect_launch_candidates};
use crate::settings::load_settings;
use crate::state::{tracker_config, tracker_stop_tx, TrackerConfig};
use crate::util::{is_ignored_executable, paths_match};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use sysinfo::System;
use tokio::sync::watch;

#[tauri::command]
pub(crate) fn start_game_time_tracker(
  app: tauri::AppHandle,
  server_url: String,
  user_id: i64,
  access_token: String,
  download_path: Option<String>,
  download_paths: Option<Vec<String>>,
) -> Result<(), String> {
  if let Ok(mut tx) = tracker_stop_tx().lock() {
    if let Some(sender) = tx.take() {
      let _ = sender.send(true);
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

  let config = TrackerConfig {
    server_url,
    user_id,
    access_token,
    download_paths: paths,
  };

  if let Ok(mut cfg) = tracker_config().lock() {
    *cfg = Some(config);
  }

  let (stop_tx, stop_rx) = watch::channel(false);
  if let Ok(mut tx) = tracker_stop_tx().lock() {
    *tx = Some(stop_tx);
  }

  tauri::async_runtime::spawn(game_time_tracker_loop(stop_rx, app));

  Ok(())
}

#[tauri::command]
pub(crate) fn stop_game_time_tracker() -> Result<(), String> {
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
pub(crate) fn update_tracker_auth(access_token: String) -> Result<(), String> {
  if let Ok(mut cfg) = tracker_config().lock() {
    if let Some(ref mut c) = *cfg {
      c.access_token = access_token;
    }
  }
  Ok(())
}

async fn game_time_tracker_loop(mut stop_rx: watch::Receiver<bool>, app: tauri::AppHandle) {
  let mut interval = tokio::time::interval(Duration::from_secs(60));
  interval.tick().await;

  loop {
    tokio::select! {
      _ = interval.tick() => {},
      _ = stop_rx.changed() => {
        break;
      }
    }

    let config = match tracker_config().lock() {
      Ok(guard) => match guard.clone() {
        Some(c) => c,
        None => continue,
      },
      Err(_) => continue,
    };

    if config.download_paths.is_empty() || config.server_url.is_empty() {
      continue;
    }

    // Collect installed games from all root paths
    let mut installed = Vec::new();
    for path in &config.download_paths {
      if let Ok(games) = list_installed_games(path.clone()) {
        installed.extend(games);
      }
    }

    if installed.is_empty() {
      continue;
    }

    let mut game_exe_map: HashMap<i64, Vec<PathBuf>> = HashMap::new();

    for game in &installed {
      // The configured installation dir may not exist (e.g. no "Installation"
      // subfolder); fall back to the version dir so the game is still tracked.
      let configured_install = PathBuf::from(&game.installation_directory);
      let mut scan_dir = configured_install.clone();
      if !scan_dir.exists() || !scan_dir.is_dir() {
        scan_dir = PathBuf::from(&game.version_directory);
      }
      if !scan_dir.exists() || !scan_dir.is_dir() {
        continue;
      }

      let ignored = load_settings(&app).ignored_executables;

      // Always include the exact launcher the user runs (from the per-game
      // config), then any executables found by scanning the install dir.
      let mut abs_paths: Vec<PathBuf> = Vec::new();
      if let Some(rel_exe) = read_configured_launch_executable(Path::new(&game.version_directory)) {
        let abs = scan_dir.join(rel_exe);
        if abs.exists() && !is_ignored_executable(&abs, &ignored) {
          abs_paths.push(abs);
        }
      }

      let mut candidates = Vec::new();
      if collect_launch_candidates(&scan_dir, &scan_dir, &mut candidates).is_ok() {
        for rel in candidates {
          let abs = scan_dir.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
          if !is_ignored_executable(&abs, &ignored) {
            abs_paths.push(abs);
          }
        }
      }

      if !abs_paths.is_empty() {
        game_exe_map.entry(game.game_id).or_default().extend(abs_paths);
      }
    }

    if game_exe_map.is_empty() {
      continue;
    }

    let mut sys = System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    let processes: Vec<&sysinfo::Process> = sys.processes().values().collect();

    let mut matched_game_ids: Vec<i64> = Vec::new();

    for (game_id, exe_paths) in &game_exe_map {
      let is_running = exe_paths.iter().any(|game_exe| {
        processes
          .iter()
          .any(|process| process_matches_game(process, game_exe))
      });
      if is_running {
        matched_game_ids.push(*game_id);
      }
    }

    if matched_game_ids.is_empty() {
      continue;
    }

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

      if result.is_err() {
        save_offline_time(&config.download_paths, config.user_id, game_id);
      }
    }
  }
}

fn process_matches_game(process: &sysinfo::Process, game_exe: &Path) -> bool {
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

fn matches_game_file_name(game_exe: &Path, arg: &Path) -> bool {
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

fn save_offline_time(download_paths: &[String], user_id: i64, game_id: i64) {
  let mut installed = Vec::new();
  for path in download_paths {
    if let Ok(games) = list_installed_games(path.to_string()) {
      installed.extend(games);
    }
  }

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

// ── Offline time tracking commands ────────────────────────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OfflineTimeFile {
  path: String,
  user_id: i64,
  game_id: i64,
  accumulated_minutes: i64,
}

#[tauri::command]
pub(crate) fn get_offline_time_files(selected_root: String) -> Result<Vec<OfflineTimeFile>, String> {
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
pub(crate) fn delete_offline_time_file(path: String) -> Result<(), String> {
  let p = Path::new(&path);
  if p.exists() {
    fs::remove_file(p).map_err(|e| format!("Failed to delete offline time file: {e}"))?;
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
