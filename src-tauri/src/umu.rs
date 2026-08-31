//! umu-launcher integration.
//!
//! On Linux, Windows executables cannot run natively. This module finds or
//! installs [umu-launcher](https://github.com/Open-Wine-Components/umu-launcher)
//! (`umu-run`) and runs Windows game/installer executables through it. Because
//! the first `umu-run` invocation performs a one-time setup (downloading
//! UMU-Proton and the steamrt3 runtime), the launch streams progress to the
//! frontend through `umu-status` events so the UI can show a
//! "Setting up umu launcher…" overlay until the game process actually appears.

use crate::events::{emit_game_launch_failed, emit_umu_status};
use crate::games::{hide_main_window, restore_main_window};
use crate::time_tracker::process_matches_game;
use serde::Serialize;
use std::collections::VecDeque;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use sysinfo::System;

/// Where a user-space install of umu-launcher lives (`$HOME/.local/share/umu-launcher`).
const UMU_INSTALL_DIR: &str = ".local/share/umu-launcher";

/// True when the file looks like a Windows executable that needs Proton/Wine
/// to run on Linux.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn is_windows_executable(path: &Path) -> bool {
  let ext = path
    .extension()
    .and_then(|v| v.to_str())
    .map(|v| v.to_ascii_lowercase())
    .unwrap_or_default();
  matches!(ext.as_str(), "exe" | "bat" | "cmd" | "com" | "msi")
}

#[cfg(target_os = "linux")]
fn home_dir() -> Option<PathBuf> {
  std::env::var_os("HOME").map(PathBuf::from)
}

/// Locate the `umu-run` executable on `PATH` plus the usual user install
/// locations. Only returns files that have the executable bit set.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn find_umu_run() -> Option<PathBuf> {
  #[cfg(not(target_os = "linux"))]
  {
    return None;
  }

  #[cfg(target_os = "linux")]
  {
    use std::os::unix::fs::PermissionsExt;

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(path_var) = std::env::var_os("PATH") {
      for dir in std::env::split_paths(&path_var) {
        candidates.push(dir.join("umu-run"));
      }
    }
    if let Some(home) = home_dir() {
      candidates.push(home.join(".local/bin/umu-run"));
      candidates.push(home.join(UMU_INSTALL_DIR).join("umu-run"));
    }
    candidates.push(PathBuf::from("/usr/bin/umu-run"));
    candidates.push(PathBuf::from("/usr/local/bin/umu-run"));

    for candidate in candidates {
      if candidate.is_file() {
        if let Ok(meta) = fs::metadata(&candidate) {
          if meta.permissions().mode() & 0o111 != 0 {
            return Some(candidate);
          }
        }
      }
    }
    None
  }
}

#[cfg(target_os = "linux")]
fn umu_version(path: &Path) -> Option<String> {
  let output = Command::new(path).arg("--version").output().ok()?;
  let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
  let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
  let version = if stdout.is_empty() { stderr } else { stdout };
  if version.is_empty() {
    None
  } else {
    Some(version)
  }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UmuStatus {
  pub installed: bool,
  pub version: Option<String>,
  pub path: Option<String>,
  pub supported_platform: bool,
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub(crate) fn umu_status() -> UmuStatus {
  match find_umu_run() {
    Some(path) => UmuStatus {
      installed: true,
      version: umu_version(&path),
      path: Some(path.to_string_lossy().to_string()),
      supported_platform: true,
    },
    None => UmuStatus {
      installed: false,
      version: None,
      path: None,
      supported_platform: true,
    },
  }
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub(crate) fn umu_status() -> UmuStatus {
  UmuStatus {
    installed: false,
    version: None,
    path: None,
    supported_platform: false,
  }
}

/// Recursively find a file with the given name inside `dir`.
#[cfg(target_os = "linux")]
fn find_named_file(dir: &Path, name: &str) -> Option<PathBuf> {
  let entries = fs::read_dir(dir).ok()?;
  for entry in entries.flatten() {
    let path = entry.path();
    if path.is_dir() {
      if let Some(found) = find_named_file(&path, name) {
        return Some(found);
      }
    } else if path.file_name().and_then(|n| n.to_str()) == Some(name) {
      return Some(path);
    }
  }
  None
}

#[cfg(target_os = "linux")]
fn make_executable(path: &Path) {
  use std::os::unix::fs::PermissionsExt;
  if let Ok(meta) = fs::metadata(path) {
    let mut permissions = meta.permissions();
    permissions.set_mode(permissions.mode() | 0o111);
    let _ = fs::set_permissions(path, permissions);
  }
}

/// Download and install umu-launcher into `$HOME/.local/share/umu-launcher`.
/// Uses the official `*-zipapp.tar` release asset, which is a self-contained
/// Python zipapp and needs no root privileges or build tools.
#[cfg(target_os = "linux")]
async fn install_umu_launcher_inner(app: &tauri::AppHandle, game_title: Option<&str>) -> Result<(), String> {
  if find_umu_run().is_some() {
    return Ok(());
  }

  let home = home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
  let install_dir = home.join(UMU_INSTALL_DIR);
  fs::create_dir_all(&install_dir).map_err(|e| format!("Failed to create umu-launcher directory: {e}"))?;

  emit_umu_status(
    app,
    game_title,
    "installing",
    Some("Checking latest umu-launcher release…".to_string()),
    None,
  );

  let client = reqwest::Client::new();
  let release_url = "https://api.github.com/repos/Open-Wine-Components/umu-launcher/releases/latest";
  let response = client
    .get(release_url)
    .header("User-Agent", "GameVault")
    .header("Accept", "application/vnd.github+json")
    .send()
    .await
    .map_err(|e| format!("Failed to query umu-launcher releases: {e}"))?;
  let release_text = response
    .text()
    .await
    .map_err(|e| format!("Failed to read umu-launcher release info: {e}"))?;
  let release: serde_json::Value = serde_json::from_str(&release_text)
    .map_err(|e| format!("Failed to parse umu-launcher release info: {e}"))?;
  let asset_url = release
    .get("assets")
    .and_then(|assets| assets.as_array())
    .and_then(|assets| {
      assets.iter().find_map(|asset| {
        let name = asset.get("name").and_then(|n| n.as_str()).unwrap_or("");
        if name.ends_with("-zipapp.tar") {
          asset
            .get("browser_download_url")
            .and_then(|url| url.as_str())
            .map(String::from)
        } else {
          None
        }
      })
    })
    .ok_or_else(|| "Could not find a umu-launcher zipapp release asset".to_string())?;

  emit_umu_status(app, game_title, "installing", Some("Downloading umu-launcher…".to_string()), None);

  let temp_dir = std::env::temp_dir().join(format!("gamevault-umu-{}", std::process::id()));
  fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temporary directory: {e}"))?;
  let tar_path = temp_dir.join("umu-launcher.zipapp.tar");

  let bytes = client
    .get(&asset_url)
    .header("User-Agent", "GameVault")
    .send()
    .await
    .map_err(|e| format!("Failed to download umu-launcher: {e}"))?
    .bytes()
    .await
    .map_err(|e| format!("Failed to read umu-launcher download: {e}"))?;
  fs::write(&tar_path, &bytes).map_err(|e| format!("Failed to write umu-launcher archive: {e}"))?;

  emit_umu_status(app, game_title, "installing", Some("Extracting umu-launcher…".to_string()), None);

  let tar_file = fs::File::open(&tar_path).map_err(|e| format!("Failed to open umu-launcher archive: {e}"))?;
  let mut archive = tar::Archive::new(tar_file);
  archive
    .unpack(&install_dir)
    .map_err(|e| format!("Failed to extract umu-launcher: {e}"))?;

  let _ = fs::remove_file(&tar_path);
  let _ = fs::remove_dir_all(&temp_dir);

  // The zipapp may land in a subdirectory; find it and restore the exec bit.
  if find_umu_run().is_none() {
    if let Some(found) = find_named_file(&install_dir, "umu-run") {
      make_executable(&found);
    }
  }

  match find_umu_run() {
    Some(path) => {
      emit_umu_status(
        app,
        game_title,
        "installing",
        Some(format!("umu-launcher installed at {}", path.display())),
        None,
      );
      Ok(())
    }
    None => Err(
      "umu-launcher was downloaded but umu-run could not be found after extraction. \
       Please install umu-launcher manually (see github.com/Open-Wine-Components/umu-launcher)."
        .to_string(),
    ),
  }
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub(crate) async fn install_umu_launcher(
  app: tauri::AppHandle,
  game_title: Option<String>,
) -> Result<(), String> {
  match install_umu_launcher_inner(&app, game_title.as_deref()).await {
    Ok(()) => Ok(()),
    Err(error) => {
      emit_umu_status(&app, game_title.as_deref(), "error", None, Some(error.clone()));
      Err(error)
    }
  }
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub(crate) async fn install_umu_launcher(
  _app: tauri::AppHandle,
  _game_title: Option<String>,
) -> Result<(), String> {
  Err("umu-launcher is only supported on Linux".to_string())
}

/// Ensure `umu-run` is available, installing it (with progress events) when
/// it is missing. Used by the sync launch commands. On failure an `umu-status`
/// `error` event is emitted so the frontend overlay closes.
pub(crate) fn ensure_umu_installed(app: &tauri::AppHandle, game_title: Option<&str>) -> Result<(), String> {
  #[cfg(not(target_os = "linux"))]
  {
    return Err("umu-launcher is only supported on Linux".to_string());
  }

  #[cfg(target_os = "linux")]
  {
    if find_umu_run().is_some() {
      return Ok(());
    }
    match tauri::async_runtime::block_on(install_umu_launcher_inner(app, game_title)) {
      Ok(()) => Ok(()),
      Err(error) => {
        emit_umu_status(app, game_title, "error", None, Some(error.clone()));
        Err(error)
      }
    }
  }
}

// ── Streaming umu-run output ────────────────────────────────────────────────

/// Shared state handed back after spawning the stdout/stderr reader threads.
#[cfg(target_os = "linux")]
pub(crate) struct UmuStreamHandle {
  /// Set once the game/installer is believed to have started.
  pub running: Arc<AtomicBool>,
  /// Last few output lines (capped), used for the failure log.
  pub lines: Arc<Mutex<VecDeque<String>>>,
}

#[cfg(target_os = "linux")]
const MAX_LOG_LINES: usize = 500;

/// Drains one output stream, forwarding each line as a `umu-status` `setup`
/// event and flagging "running" when a line indicates the game is starting.
#[cfg(target_os = "linux")]
fn stream_umu_lines<R: Read + Send + 'static>(
  stream: R,
  app: tauri::AppHandle,
  game_title: Option<String>,
  lines: Arc<Mutex<VecDeque<String>>>,
  running: Arc<AtomicBool>,
) {
  thread::spawn(move || {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    loop {
      line.clear();
      match reader.read_line(&mut line) {
        Ok(0) => break,
        Ok(_) => {
          let trimmed = line.trim_end().to_string();
          if trimmed.is_empty() {
            continue;
          }
          {
            let mut queue = lines.lock().unwrap();
            queue.push_back(trimmed.clone());
            while queue.len() > MAX_LOG_LINES {
              queue.pop_front();
            }
          }
          // umu prints these right before the game/installer window opens.
          if trimmed.contains("fsync") || trimmed.contains("Proton: Executable") {
            running.store(true, Ordering::SeqCst);
          }
          emit_umu_status(&app, game_title.as_deref(), "setup", Some(trimmed), None);
        }
        Err(_) => break,
      }
    }
  });
}

/// Spawn the reader threads for a `umu-run` child and return the shared state.
#[cfg(target_os = "linux")]
pub(crate) fn spawn_umu_streamers(
  app: &tauri::AppHandle,
  game_title: Option<&str>,
  stdout: Option<ChildStdout>,
  stderr: Option<ChildStderr>,
) -> UmuStreamHandle {
  let running = Arc::new(AtomicBool::new(false));
  let lines: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::new()));
  let game_title = game_title.map(String::from);
  let app_handle = app.clone();

  if let Some(out) = stdout {
    stream_umu_lines(
      out,
      app_handle.clone(),
      game_title.clone(),
      lines.clone(),
      running.clone(),
    );
  }
  if let Some(err) = stderr {
    stream_umu_lines(
      err,
      app_handle.clone(),
      game_title.clone(),
      lines.clone(),
      running.clone(),
    );
  }
  UmuStreamHandle { running, lines }
}

/// True when any running process matches the given (Windows) executable path
/// or its file name — how umu/wine processes surface in the process table.
/// The `umu-run` wrapper itself is excluded: its argv also contains the game
/// path, which would otherwise match immediately during setup.
#[cfg(target_os = "linux")]
pub(crate) fn detect_process_running(exe_path: &Path) -> bool {
  let mut system = System::new();
  // sysinfo 0.33 needs the explicit "everything" refresh kind for cmdlines.
  system.refresh_processes_specifics(
    sysinfo::ProcessesToUpdate::All,
    true,
    sysinfo::ProcessRefreshKind::everything(),
  );
  system.processes().values().any(|process| {
    let is_umu_wrapper = process
      .cmd()
      .first()
      .and_then(|program| Path::new(program).file_name())
      .and_then(|name| name.to_str())
      .map(|name| name == "umu-run")
      .unwrap_or(false);
    !is_umu_wrapper && process_matches_game(process, exe_path)
  })
}

// ── Launching through umu-run ───────────────────────────────────────────────

/// Spawn `umu-run <exe> [args]` and hand the child to the umu launch monitor.
/// Optional umu environment overrides (GAMEID/STORE/PROTONPATH/WINEPREFIX) are
/// forwarded when set; empty values are ignored so umu's defaults apply.
#[cfg(target_os = "linux")]
pub(crate) fn launch_with_umu(
  app: tauri::AppHandle,
  game_title: String,
  exe_path: &Path,
  launch_parameters: Option<&str>,
  umu_game_id: Option<&str>,
  umu_store: Option<&str>,
  umu_proton_path: Option<&str>,
  umu_wine_prefix: Option<&str>,
  restore_on_exit: bool,
) -> Result<(), String> {
  let umu_run = match find_umu_run() {
    Some(path) => path,
    None => {
      let error = "umu-run was not found. Unable to launch Windows game on Linux.".to_string();
      emit_umu_status(&app, Some(&game_title), "error", None, Some(error.clone()));
      return Err(error);
    }
  };
  let working_dir = exe_path
    .parent()
    .map(|parent| parent.to_path_buf())
    .unwrap_or_else(|| PathBuf::from("."));

  let mut command = Command::new(&umu_run);
  command.arg(exe_path).current_dir(&working_dir);

  if let Some(value) = umu_game_id.map(str::trim).filter(|v| !v.is_empty()) {
    command.env("GAMEID", value);
  }
  if let Some(value) = umu_store.map(str::trim).filter(|v| !v.is_empty()) {
    command.env("STORE", value);
  }
  if let Some(value) = umu_proton_path.map(str::trim).filter(|v| !v.is_empty()) {
    command.env("PROTONPATH", value);
  }
  if let Some(value) = umu_wine_prefix.map(str::trim).filter(|v| !v.is_empty()) {
    command.env("WINEPREFIX", value);
  }

  if let Some(params) = launch_parameters {
    let params = params.trim();
    if !params.is_empty() {
      for arg in params.split_whitespace() {
        command.arg(arg);
      }
    }
  }

  command.stdout(Stdio::piped()).stderr(Stdio::piped());

  match command.spawn() {
    Ok(child) => {
      spawn_umu_launch_monitor(app, game_title, exe_path.to_path_buf(), child, restore_on_exit);
      Ok(())
    }
    Err(error) => {
      let message = format!("Failed to launch game with umu-launcher: {error}");
      emit_umu_status(&app, Some(&game_title), "error", None, Some(message.clone()));
      Err(message)
    }
  }
}

/// Monitors a `umu-run` child: streams setup progress, hides the main window
/// while the game runs (when enabled), reports "running" once the game process
/// appears and surfaces a failure dialog when it never does.
#[cfg(target_os = "linux")]
pub(crate) fn spawn_umu_launch_monitor(
  app: tauri::AppHandle,
  game_title: String,
  exe_path: PathBuf,
  mut child: Child,
  restore_on_exit: bool,
) {
  thread::spawn(move || {
    if restore_on_exit {
      hide_main_window(&app);
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let handle = spawn_umu_streamers(&app, Some(&game_title), stdout, stderr);

    let start = Instant::now();
    let mut reported_running = false;
    let mut last_process_check = Instant::now();

    let status = loop {
      match child.try_wait() {
        Ok(Some(status)) => break Some(status),
        Ok(None) => {}
        Err(_) => break None,
      }

      if !reported_running {
        // Marker lines from umu/wine indicate the window is about to open.
        if handle.running.load(Ordering::SeqCst) {
          reported_running = true;
          emit_umu_status(&app, Some(&game_title), "running", None, None);
        } else if last_process_check.elapsed() >= Duration::from_secs(2) {
          last_process_check = Instant::now();
          if detect_process_running(&exe_path) {
            reported_running = true;
            emit_umu_status(&app, Some(&game_title), "running", None, None);
          }
        } else if start.elapsed() >= Duration::from_secs(600) {
          // Safety net: assume the game started even if undetected.
          reported_running = true;
          emit_umu_status(&app, Some(&game_title), "running", None, None);
        }
      }

      thread::sleep(Duration::from_millis(200));
    };

    let log = handle
      .lines
      .lock()
      .unwrap()
      .iter()
      .cloned()
      .collect::<Vec<_>>()
      .join("\n");

    // Restore the window regardless of the outcome so the user is never left
    // with a hidden gamevault window.
    restore_main_window(&app);

    let exit_code = status.and_then(|s| s.code());
    let message = if log.trim().is_empty() {
      "The game exited immediately without any output.".to_string()
    } else {
      log.clone()
    };

    if !reported_running {
      emit_umu_status(&app, Some(&game_title), "error", None, Some(message.clone()));
      emit_game_launch_failed(&app, game_title, exit_code, message);
    } else {
      emit_umu_status(&app, Some(&game_title), "exit", None, None);
    }
  });
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn detects_windows_executables() {
    assert!(is_windows_executable(Path::new("game/foo.exe")));
    assert!(is_windows_executable(Path::new("game/foo.EXE")));
    assert!(is_windows_executable(Path::new("setup/installer.msi")));
    assert!(is_windows_executable(Path::new("game/run.bat")));
    assert!(!is_windows_executable(Path::new("game/run.sh")));
    assert!(!is_windows_executable(Path::new("game/run")));
    assert!(!is_windows_executable(Path::new("game/run.appimage")));
  }
}
