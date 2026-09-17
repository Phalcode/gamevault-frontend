//! umu-launcher integration.
//!
//! On Linux, Windows executables cannot run natively. This module finds or
//! installs [umu-launcher](https://github.com/Open-Wine-Components/umu-launcher)
//! (`umu-run`) and runs Windows game/installer executables through it. Because
//! the first `umu-run` invocation performs a one-time setup (downloading
//! UMU-Proton and the steamrt3 runtime), the launch streams progress to the
//! frontend through `umu-status` events so the UI can show a
//! "Setting up umu launcher…" overlay until the game process actually appears.

#[cfg(target_os = "linux")]
use crate::events::{emit_game_launch_failed, emit_umu_status};
#[cfg(target_os = "linux")]
use crate::games::{hide_main_window, restore_main_window};
#[cfg(target_os = "linux")]
use crate::time_tracker::process_matches_game;
use serde::Serialize;
#[cfg(target_os = "linux")]
use std::collections::VecDeque;
#[cfg(target_os = "linux")]
use std::fs;
#[cfg(target_os = "linux")]
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
#[cfg(target_os = "linux")]
use std::process::{Child, ChildStderr, ChildStdout, Command, Stdio};
#[cfg(target_os = "linux")]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "linux")]
use std::sync::{Arc, Mutex};
#[cfg(target_os = "linux")]
use std::thread;
#[cfg(target_os = "linux")]
use std::time::{Duration, Instant};
#[cfg(target_os = "linux")]
use sysinfo::System;

/// Where a user-space install of umu-launcher lives (`$HOME/.local/share/umu-launcher`).
#[cfg(target_os = "linux")]
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

/// Moves the contents of `src` into `dest`, preserving directory structure.
/// Uses `rename` where possible and falls back to copy+remove when the two
/// locations are on different filesystems (the extraction temp dir is usually
/// `/tmp` while the install dir lives under `$HOME`).
#[cfg(target_os = "linux")]
fn move_contents(src: &Path, dest: &Path) -> Result<(), String> {
  fs::create_dir_all(dest).map_err(|e| format!("Failed to create destination directory: {e}"))?;
  let entries = fs::read_dir(src).map_err(|e| format!("Failed to read extracted directory: {e}"))?;
  for entry in entries {
    let entry = entry.map_err(|e| format!("Failed to read extracted entry: {e}"))?;
    let from = entry.path();
    let to = dest.join(entry.file_name());
    if from.is_dir() {
      move_contents(&from, &to)?;
    } else if fs::rename(&from, &to).is_err() {
      // Cross-device move: copy the file (following any symlink) and drop the
      // original. Files are small, so this is cheap.
      fs::copy(&from, &to).map_err(|e| format!("Failed to copy umu-launcher file: {e}"))?;
      let _ = fs::remove_file(&from);
    }
  }
  Ok(())
}

/// Clear `PYTHONHOME`/`PYTHONPATH` before running the umu-run zipapp.
///
/// `umu-run` is a self-contained Python zipapp launched through its
/// `#!/usr/bin/env python3` shebang. If the caller's environment exports
/// `PYTHONHOME` (e.g. from a conda/venv/pyenv shell), the system Python tries
/// to load its stdlib from that path and dies at startup with
/// "Fatal Python error: Failed to import encodings module". Removing the
/// variable lets the zipapp use the system interpreter's own stdlib.
#[cfg(target_os = "linux")]
pub(crate) fn prepare_umu_run_env(command: &mut Command) {
  command.env_remove("PYTHONHOME");
  command.env_remove("PYTHONPATH");
}

/// Download and install umu-launcher into `$HOME/.local/share/umu-launcher`.
/// Uses the official `*-zipapp.tar` release asset, which is a self-contained
/// Python zipapp and needs no root privileges or build tools.
#[cfg(target_os = "linux")]
async fn install_umu_launcher_inner(app: &tauri::AppHandle, game_title: Option<&str>) -> Result<(), String> {
  if find_umu_run().is_some() {
    return Ok(());
  }

  // Another run may already be installing umu-launcher (e.g. it was started
  // before the page was reloaded, or by a launch that is still waiting). Wait
  // for that one instead of downloading a second copy over it.
  if crate::state::is_umu_install_running() {
    for _ in 0..2_400 {
      tokio::time::sleep(std::time::Duration::from_millis(250)).await;
      if find_umu_run().is_some() {
        return Ok(());
      }
      if !crate::state::is_umu_install_running() {
        break;
      }
    }
    if find_umu_run().is_some() {
      return Ok(());
    }
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
    .unpack(&temp_dir)
    .map_err(|e| format!("Failed to extract umu-launcher: {e}"))?;

  let _ = fs::remove_file(&tar_path);

  // The `*-zipapp.tar` release asset wraps its files in a `umu/` directory
  // (`umu-run` plus an `umu_run.py` symlink). Normalize it so `umu-run` sits
  // directly in the install dir, where `find_umu_run()` looks for it. Fall
  // back to the whole extraction if upstream ever changes the archive layout.
  let extracted = temp_dir.join("umu");
  let source: &Path = if extracted.is_dir() { &extracted } else { &temp_dir };
  move_contents(source, &install_dir)?;

  let _ = fs::remove_dir_all(&temp_dir);

  // The move may have dropped the exec bit (cross-device copy fallback);
  // restore it so `find_umu_run()` accepts the file.
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
  let result = install_umu_launcher_inner(&app, game_title.as_deref()).await;
  match result {
    Ok(()) => {
      // Clear the "installing" marker so a reloaded UI knows there is nothing
      // left to re-attach to.
      crate::state::set_umu_snapshot(None);
      Ok(())
    }
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
#[cfg(target_os = "linux")]
pub(crate) fn ensure_umu_installed(app: &tauri::AppHandle, game_title: Option<&str>) -> Result<(), String> {
  #[cfg(not(target_os = "linux"))]
  {
    return Err("umu-launcher is only supported on Linux".to_string());
  }

  #[cfg(target_os = "linux")]
  {
    if find_umu_run().is_some() {
      crate::state::set_umu_snapshot(None);
      return Ok(());
    }
    match tauri::async_runtime::block_on(install_umu_launcher_inner(app, game_title)) {
      Ok(()) => {
        crate::state::set_umu_snapshot(None);
        Ok(())
      }
      Err(error) => {
        emit_umu_status(app, game_title, "error", None, Some(error.clone()));
        Err(error)
      }
    }
  }
}

// ── Host → Windows path conversion ──────────────────────────────────────────

/// Converts a host path into the Windows path umu/wine exposes it as: umu maps
/// `$HOME` to drive `X:` (the root `/` is `Z:`). Every `/` becomes `\`.
#[cfg(target_os = "linux")]
fn to_windows_install_path_with_home(host_path: &str, home: Option<&Path>) -> String {
  let host_path = host_path.trim_end_matches(['/', '\\']);
  if let Some(home) = home {
    let home = home.to_string_lossy().trim_end_matches('/').to_string();
    if let Some(rest) = host_path.strip_prefix(&format!("{home}/")) {
      let rest = rest.trim_start_matches('/');
      return if rest.is_empty() {
        "X:\\".to_string()
      } else {
        format!("X:\\{}", rest.replace('/', "\\"))
      };
    }
  }
  let rest = host_path.trim_start_matches('/');
  if rest.is_empty() {
    "Z:\\".to_string()
  } else {
    format!("Z:\\{}", rest.replace('/', "\\"))
  }
}

#[cfg(target_os = "linux")]
pub(crate) fn to_windows_install_path(host_path: &str) -> String {
  to_windows_install_path_with_home(host_path, home_dir().as_deref())
}

/// Returns the umu/Wine-visible path for an install directory (drive `X:` for
/// paths under `$HOME`, `Z:` otherwise). Non-Linux returns the input unchanged.
#[cfg(target_os = "linux")]
#[tauri::command]
pub(crate) fn resolve_windows_install_path(installation_path: String) -> String {
  to_windows_install_path(&installation_path)
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub(crate) fn resolve_windows_install_path(installation_path: String) -> String {
  installation_path
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
  stream_kind: &'static str,
  lines: Arc<Mutex<VecDeque<String>>>,
  running: Arc<AtomicBool>,
  log: Option<Arc<crate::launch_log::LaunchLog>>,
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
          if let Some(log) = log.as_ref() {
            log.push(stream_kind, &trimmed);
          }
          // umu prints these right before the game/installer window opens.
          if trimmed.contains("fsync") || trimmed.contains("Proton: Executable") {
            running.store(true, Ordering::SeqCst);
          }
          // Once the game runs, Proton's output belongs in the log window only
          // (otherwise it would re-open the setup overlay).
          if !running.load(Ordering::SeqCst) {
            emit_umu_status(&app, game_title.as_deref(), "setup", Some(trimmed), None);
          }
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
  log: Option<Arc<crate::launch_log::LaunchLog>>,
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
      "out",
      lines.clone(),
      running.clone(),
      log.clone(),
    );
  }
  if let Some(err) = stderr {
    stream_umu_lines(
      err,
      app_handle.clone(),
      game_title.clone(),
      "err",
      lines.clone(),
      running.clone(),
      log.clone(),
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

/// Converts a game title/identifier into a filesystem-safe slug for use as a
/// per-game prefix subfolder (uppercase/lowercase preserved but unsafe chars
/// replaced). Falls back to a deterministic placeholder when nothing is left.
#[cfg(target_os = "linux")]
pub(crate) fn slugify_prefix_name(name: &str) -> String {
  let mut slug: String = name
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
    "game-prefix".to_string()
  } else {
    slug
  }
}

/// A Proton build that is already installed on the machine.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProtonBuild {
  /// Folder name inside `compatibilitytools.d`, e.g. `GE-Proton9-5`.
  pub name: String,
  pub path: String,
  /// Directory the build was found in.
  pub source: String,
}

/// Directories that can contain Proton builds. umu resolves `PROTONPATH` by
/// name inside `compatibilitytools.d`, so we list what is already installed
/// instead of downloading and managing Proton builds ourselves.
#[cfg(target_os = "linux")]
fn proton_search_dirs() -> Vec<PathBuf> {
  let Some(home) = home_dir() else {
    return Vec::new();
  };
  vec![
    home.join(".local/share/Steam/compatibilitytools.d"),
    home.join(".steam/steam/compatibilitytools.d"),
    home.join(".steam/root/compatibilitytools.d"),
    home.join(".var/app/com.valvesoftware.Steam/data/Steam/compatibilitytools.d"),
    home.join(".local/share/umu/compatibilitytools.d"),
  ]
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub(crate) fn list_proton_builds() -> Vec<ProtonBuild> {
  let mut builds: Vec<ProtonBuild> = Vec::new();

  for dir in proton_search_dirs() {
    let Ok(entries) = fs::read_dir(&dir) else {
      continue;
    };
    for entry in entries.flatten() {
      let path = entry.path();
      if !path.is_dir() {
        continue;
      }
      let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        continue;
      };
      if name.starts_with('.') || builds.iter().any(|build| build.name == name) {
        continue;
      }
      builds.push(ProtonBuild {
        name: name.to_string(),
        path: path.to_string_lossy().to_string(),
        source: dir.to_string_lossy().to_string(),
      });
    }
  }

  builds.sort_by_key(|build| build.name.to_lowercase());
  builds
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub(crate) fn list_proton_builds() -> Vec<ProtonBuild> {
  Vec::new()
}

/// Everything needed to locate the Wine/Proton prefix of one game.
#[cfg(target_os = "linux")]
pub(crate) struct PrefixContext<'a> {
  /// Per-game override from the game settings dialog (wins verbatim).
  pub per_game_prefix: Option<&'a str>,
  /// Version directory (`<root>/GameVault/<Game Title>/Versions/<Version>`),
  /// used to derive the per-game prefix folder name.
  pub version_directory: Option<&'a str>,
  /// Numeric GameVault game id, used to adopt the legacy `game-<id>` prefix.
  pub game_id: Option<i64>,
  /// umu GAMEID, used to adopt umu's own default prefix location.
  pub umu_game_id: Option<&'a str>,
}

/// Folder name of the game inside the install tree
/// (`.../<Game Title>/Versions/<Version>`). Falls back to the version folder
/// name when the tree has an unexpected shape.
#[cfg(target_os = "linux")]
pub(crate) fn game_folder_name(version_directory: &Path) -> Option<String> {
  let parent = version_directory.parent();
  let versions_folder = parent
    .and_then(|p| p.file_name())
    .and_then(|n| n.to_str())
    .map(|n| n.eq_ignore_ascii_case("versions"))
    .unwrap_or(false);

  let folder = if versions_folder {
    parent.and_then(|p| p.parent()).and_then(|p| p.file_name())?
  } else {
    version_directory.file_name()?
  };

  let name = folder.to_string_lossy().trim().to_string();
  if name.is_empty() {
    None
  } else {
    Some(name)
  }
}

/// Base directory for GameVault-managed prefixes: the configured setting, or
/// `$XDG_DATA_HOME/GameVault/prefixes` when it is empty.
#[cfg(target_os = "linux")]
pub(crate) fn prefix_base_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
  use tauri::Manager;

  let configured = crate::settings::load_settings(app)
    .default_wine_prefix
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());
  if let Some(configured) = configured {
    return Some(PathBuf::from(configured));
  }

  app
    .path()
    .data_dir()
    .ok()
    .map(|dir| dir.join("GameVault").join("prefixes"))
}

/// The prefix candidate paths of a game, most preferred first.
#[cfg(target_os = "linux")]
fn prefix_candidates(base: &Path, context: &PrefixContext<'_>) -> Vec<PathBuf> {
  let folder = context
    .version_directory
    .map(Path::new)
    .and_then(game_folder_name);

  let mut candidates: Vec<PathBuf> = Vec::new();
  if let Some(folder) = folder.as_deref() {
    candidates.push(base.join(folder));
  }
  if let Some(game_id) = context.game_id {
    candidates.push(base.join(format!("game-{game_id}")));
  }
  if let Some(folder) = folder.as_deref() {
    let slug_path = base.join(slugify_prefix_name(folder));
    if !candidates.contains(&slug_path) {
      candidates.push(slug_path);
    }
  }
  // umu's own default location, only when a GAMEID is known (without one umu
  // would have used its shared `umu-default` prefix, which we do not adopt).
  if let Some(umu_game_id) = context
    .umu_game_id
    .map(str::trim)
    .filter(|value| !value.is_empty())
  {
    if let Some(home) = home_dir() {
      candidates.push(home.join("Games").join("umu").join(umu_game_id));
    }
  }
  candidates
}

/// Resolves the `WINEPREFIX` for installing, launching and uninstalling one
/// game. All three flows use this, so a game always runs in the prefix it was
/// installed into.
///
/// Precedence: per-game override > an existing prefix of a legacy layout (so
/// nothing has to be migrated and no save games are lost) > GameVault's
/// canonical `<base>/<game folder name>`. Returns `None` only when no base
/// directory can be resolved at all (then umu's own default applies).
#[cfg(target_os = "linux")]
pub(crate) fn resolve_wine_prefix(
  app: &tauri::AppHandle,
  context: &PrefixContext<'_>,
) -> Option<String> {
  if let Some(value) = context
    .per_game_prefix
    .map(str::trim)
    .filter(|value| !value.is_empty())
  {
    return Some(value.to_string());
  }

  let base = prefix_base_dir(app)?;
  let candidates = prefix_candidates(&base, context);

  if let Some(existing) = candidates.iter().find(|path| path.exists()) {
    return Some(existing.to_string_lossy().to_string());
  }

  candidates
    .into_iter()
    .next()
    .map(|path| path.to_string_lossy().to_string())
}

/// True when the directory looks like a Wine/Proton prefix.
#[cfg(target_os = "linux")]
pub(crate) fn is_wine_prefix_dir(path: &Path) -> bool {
  path.join("drive_c").is_dir()
}

/// Info about the Wine/Proton prefix a game would use.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WinePrefixInfo {
  pub path: Option<String>,
  pub exists: bool,
  pub is_prefix: bool,
  /// True when the prefix lives inside GameVault's prefix base directory.
  pub managed: bool,
  /// Size on disk in bytes (only computed for existing prefixes).
  pub size_bytes: Option<u64>,
}

/// Total size of a directory tree in bytes (best effort).
#[cfg(target_os = "linux")]
pub(crate) fn directory_size(path: &Path) -> u64 {
  let Ok(entries) = fs::read_dir(path) else {
    return 0;
  };
  let mut total = 0;
  for entry in entries.flatten() {
    let Ok(metadata) = entry.metadata() else {
      continue;
    };
    if metadata.is_dir() {
      total += directory_size(&entry.path());
    } else {
      total += metadata.len();
    }
  }
  total
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub(crate) fn resolve_game_wine_prefix(
  app: tauri::AppHandle,
  version_directory: Option<String>,
  game_id: Option<i64>,
  umu_game_id: Option<String>,
  per_game_prefix: Option<String>,
) -> WinePrefixInfo {
  let context = PrefixContext {
    per_game_prefix: per_game_prefix.as_deref(),
    version_directory: version_directory.as_deref(),
    game_id,
    umu_game_id: umu_game_id.as_deref(),
  };
  let path = resolve_wine_prefix(&app, &context);
  let target = path.as_deref().map(PathBuf::from);
  let exists = target.as_deref().map(|p| p.is_dir()).unwrap_or(false);

  WinePrefixInfo {
    exists,
    is_prefix: target
      .as_deref()
      .map(is_wine_prefix_dir)
      .unwrap_or(false),
    managed: target
      .as_deref()
      .map(|p| is_managed_prefix_path(&app, p))
      .unwrap_or(false),
    size_bytes: target.as_deref().filter(|_| exists).map(directory_size),
    path,
  }
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub(crate) fn resolve_game_wine_prefix(
  _version_directory: Option<String>,
  _game_id: Option<i64>,
  _umu_game_id: Option<String>,
  _per_game_prefix: Option<String>,
) -> WinePrefixInfo {
  WinePrefixInfo {
    path: None,
    exists: false,
    is_prefix: false,
    managed: false,
    size_bytes: None,
  }
}

/// True when `path` is a prefix GameVault manages, i.e. it lives inside the
/// configured prefix base directory (or is exactly the per-game override).
#[cfg(target_os = "linux")]
fn is_managed_prefix_path(app: &tauri::AppHandle, path: &Path) -> bool {
  prefix_base_dir(app)
    .map(|base| path != base && path.starts_with(&base))
    .unwrap_or(false)
}

/// Validates that a Wine/Proton prefix may be deleted: the path must be
/// absolute, must be inside GameVault's prefix base directory (never the base
/// itself) or exactly the per-game override, and must look like a prefix.
#[cfg(target_os = "linux")]
pub(crate) fn check_deletable_prefix(
  base: Option<&Path>,
  per_game_override: Option<&Path>,
  target: &Path,
) -> Result<(), String> {
  if !target.is_absolute() {
    return Err("Refusing to delete a relative path.".to_string());
  }

  let inside_base = base
    .map(|base| target != base && target.starts_with(base))
    .unwrap_or(false);
  let is_override = per_game_override == Some(target);
  if !inside_base && !is_override {
    return Err(format!(
      "Refusing to delete '{}': it is not managed by GameVault.",
      target.display()
    ));
  }

  if !is_wine_prefix_dir(target) {
    return Err(format!(
      "Refusing to delete '{}': it does not look like a Wine/Proton prefix.",
      target.display()
    ));
  }

  Ok(())
}

/// Deletes a Wine/Proton prefix. Only prefixes GameVault manages are accepted:
/// the path must live inside the prefix base directory or be exactly the
/// per-game override, and it must actually look like a Wine prefix.
#[cfg(target_os = "linux")]
#[tauri::command]
pub(crate) fn delete_game_wine_prefix(
  app: tauri::AppHandle,
  path: String,
  per_game_prefix: Option<String>,
) -> Result<(), String> {
  let target = PathBuf::from(path.trim());
  let override_path = per_game_prefix
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
    .map(PathBuf::from);
  let base = prefix_base_dir(&app);

  check_deletable_prefix(base.as_deref(), override_path.as_deref(), &target)?;

  if !target.is_dir() {
    return Ok(());
  }

  fs::remove_dir_all(&target)
    .map_err(|error| format!("Failed to delete the Wine/Proton prefix: {error}"))
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub(crate) fn delete_game_wine_prefix(
  _path: String,
  _per_game_prefix: Option<String>,
) -> Result<(), String> {
  Err("Wine/Proton prefixes are only managed on Linux".to_string())
}

/// Spawn `umu-run <exe> [args]` and hand the child to the umu launch monitor.
/// Optional umu environment overrides (GAMEID/STORE/PROTONPATH/WINEPREFIX) are
/// forwarded when set; empty values are ignored so umu's defaults apply.
#[cfg(target_os = "linux")]
pub(crate) fn launch_with_umu(
  app: tauri::AppHandle,
  game_title: String,
  game_version_directory: Option<String>,
  game_id: Option<i64>,
  exe_path: &Path,
  launch_parameters: Option<&str>,
  umu_game_id: Option<&str>,
  umu_store: Option<&str>,
  umu_proton_path: Option<&str>,
  umu_wine_prefix: Option<&str>,
  restore_on_exit: bool,
  log: Option<Arc<crate::launch_log::LaunchLog>>,
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
  prepare_umu_run_env(&mut command);
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
  if let Some(prefix) = resolve_wine_prefix(
    &app,
    &PrefixContext {
      per_game_prefix: umu_wine_prefix,
      version_directory: game_version_directory.as_deref(),
      game_id,
      umu_game_id,
    },
  ) {
    command.env("WINEPREFIX", &prefix);
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
      spawn_umu_launch_monitor(
        app,
        game_title,
        exe_path.to_path_buf(),
        child,
        restore_on_exit,
        log,
      );
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
  launch_log: Option<Arc<crate::launch_log::LaunchLog>>,
) {
  thread::spawn(move || {
    if restore_on_exit {
      hide_main_window(&app);
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let handle = spawn_umu_streamers(
      &app,
      Some(&game_title),
      stdout,
      stderr,
      launch_log.clone(),
    );

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
      if let Some(launch_log) = launch_log.as_ref() {
        launch_log.finish_failed(&app, exit_code);
      }
      emit_umu_status(&app, Some(&game_title), "error", None, Some(message.clone()));
      emit_game_launch_failed(&app, game_title, exit_code, message);
    } else {
      if let Some(launch_log) = launch_log.as_ref() {
        launch_log.finish_success(&app, exit_code);
      }
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

  #[cfg(target_os = "linux")]
  #[test]
  fn maps_home_paths_to_x_drive() {
    let home = Path::new("/home/yelo");
    assert_eq!(
      to_windows_install_path_with_home(
        "/home/yelo/Games/GameVault/ReStory - Chill Electronics Repairs/Versions/Unspecified/Installation",
        Some(home),
      ),
      "X:\\Games\\GameVault\\ReStory - Chill Electronics Repairs\\Versions\\Unspecified\\Installation"
    );
    assert_eq!(
      to_windows_install_path_with_home("/home/yelo/foo/bar.exe", Some(home)),
      "X:\\foo\\bar.exe"
    );
  }

  #[cfg(target_os = "linux")]
  #[test]
  fn maps_other_paths_to_z_drive() {    let home = Path::new("/home/yelo");
    assert_eq!(
      to_windows_install_path_with_home("/media/data/game/Setup.exe", Some(home)),
      "Z:\\media\\data\\game\\Setup.exe"
    );
    // A different user's home is not drive X:.
    assert_eq!(
      to_windows_install_path_with_home("/home/other/game/Setup.exe", Some(home)),
      "Z:\\home\\other\\game\\Setup.exe"
    );
  }

  #[cfg(target_os = "linux")]
  #[test]
  fn derives_the_game_folder_name_from_the_install_tree() {
    assert_eq!(
      game_folder_name(Path::new(
        "/games/GameVault/ReStory - Chill Electronics Repairs/Versions/1.0"
      )),
      Some("ReStory - Chill Electronics Repairs".to_string())
    );
    // Unknown layout: fall back to the folder name itself.
    assert_eq!(
      game_folder_name(Path::new("/games/SomeGame")),
      Some("SomeGame".to_string())
    );
  }

  #[cfg(target_os = "linux")]
  #[test]
  fn prefers_the_game_folder_then_legacy_prefixes() {
    let base = Path::new("/prefixes");
    let context = PrefixContext {
      per_game_prefix: None,
      version_directory: Some("/root/GameVault/Foo/Versions/1.0"),
      game_id: Some(42),
      umu_game_id: Some("umu-9000"),
    };

    let candidates = prefix_candidates(base, &context);
    assert_eq!(candidates[0], base.join("Foo"));
    assert_eq!(candidates[1], base.join("game-42"));
    assert!(candidates
      .iter()
      .any(|path| path.ends_with("Games/umu/umu-9000")));
    assert_eq!(
      candidates
        .iter()
        .filter(|path| *path == &base.join("Foo"))
        .count(),
      1
    );
  }

  #[cfg(target_os = "linux")]
  #[test]
  fn does_not_adopt_umus_shared_default_prefix() {
    let context = PrefixContext {
      per_game_prefix: None,
      version_directory: Some("/root/GameVault/Foo/Versions/1.0"),
      game_id: None,
      umu_game_id: None,
    };

    assert_eq!(
      prefix_candidates(Path::new("/prefixes"), &context),
      vec![PathBuf::from("/prefixes/Foo")]
    );
  }

  #[cfg(target_os = "linux")]
  #[test]
  fn guards_prefix_deletion() {
    let base = std::env::temp_dir().join(format!("gv-test-base-{}", std::process::id()));
    let prefix = base.join("Foo");
    let outside = std::env::temp_dir().join(format!("gv-test-outside-{}", std::process::id()));
    let _ = fs::remove_dir_all(&base);
    let _ = fs::remove_dir_all(&outside);
    fs::create_dir_all(prefix.join("drive_c")).unwrap();
    fs::create_dir_all(outside.join("drive_c")).unwrap();

    // A prefix inside the base may be deleted.
    assert!(check_deletable_prefix(Some(&base), None, &prefix).is_ok());
    // The base directory itself may not.
    assert!(check_deletable_prefix(Some(&base), None, &base).is_err());
    // Anything outside the base needs to be the exact per-game override.
    assert!(check_deletable_prefix(Some(&base), None, &outside).is_err());
    assert!(check_deletable_prefix(Some(&base), Some(&outside), &outside).is_ok());
    // Relative paths are always refused.
    assert!(check_deletable_prefix(Some(&base), None, Path::new("Foo")).is_err());
    // Folders without drive_c are not prefixes.
    let not_a_prefix = base.join("NotAPrefix");
    fs::create_dir_all(&not_a_prefix).unwrap();
    assert!(check_deletable_prefix(Some(&base), None, &not_a_prefix).is_err());

    let _ = fs::remove_dir_all(&base);
    let _ = fs::remove_dir_all(&outside);
  }
}
