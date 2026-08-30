use crate::events::{emit_game_launch_failed, InstalledGameInfo};
use crate::settings::load_settings;
use crate::util::{is_ignored_executable, parse_version_folder, parse_i64_json, resolve_version_id, resolve_version_subdir, stable_id_from_path};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant};
use tauri::Manager;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[tauri::command]
pub(crate) fn list_installed_games(selected_root: String) -> Result<Vec<InstalledGameInfo>, String> {
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

#[tauri::command]
pub(crate) fn open_in_file_explorer(path: String) -> Result<(), String> {
  #[cfg(windows)]
  {
    Command::new("explorer.exe")
      .arg(&path)
      .spawn()
      .map(|_| ())
      .map_err(|e| format!("Failed to open folder: {e}"))?;
    return Ok(());
  }

  #[cfg(target_os = "macos")]
  {
    Command::new("open")
      .arg(&path)
      .spawn()
      .map(|_| ())
      .map_err(|e| format!("Failed to open folder: {e}"))?;
    return Ok(());
  }

  #[cfg(all(unix, not(target_os = "macos")))]
  {
    // Prefer Windows Explorer when the desktop app is running inside WSL.
    // `wslpath` converts Linux paths, including paths under /home, to a form
    // that Explorer can open.
    if std::env::var_os("WSL_INTEROP").is_some() {
      if let Ok(output) = Command::new("wslpath").args(["-w", &path]).output() {
        if output.status.success() {
          let windows_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
          if !windows_path.is_empty()
            && Command::new("explorer.exe")
              .arg(&windows_path)
              .spawn()
              .is_ok()
          {
            return Ok(());
          }
        }
      }
    }

    Command::new("xdg-open")
      .arg(&path)
      .spawn()
      .map(|_| ())
      .map_err(|e| format!("Failed to open folder: {e}"))?;
    return Ok(());
  }

  #[cfg(not(any(windows, unix)))]
  Err("Opening folders is unsupported on this platform".to_string())
}

fn validate_external_url(value: &str) -> Result<(), String> {
  let url = url::Url::parse(value).map_err(|e| format!("Invalid URL: {e}"))?;
  if matches!(url.scheme(), "http" | "https" | "mailto" | "tel") {
    Ok(())
  } else {
    Err("Only HTTP(S), mailto and tel URLs can be opened externally".to_string())
  }
}

#[tauri::command]
pub(crate) fn open_external_url(url: String) -> Result<(), String> {
  validate_external_url(&url)?;

  #[cfg(windows)]
  {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    let verb: Vec<u16> = OsStr::new("open")
      .encode_wide()
      .chain(std::iter::once(0))
      .collect();
    let target: Vec<u16> = OsStr::new(&url)
      .encode_wide()
      .chain(std::iter::once(0))
      .collect();
    let result = unsafe {
      winapi::um::shellapi::ShellExecuteW(
        std::ptr::null_mut(),
        verb.as_ptr(),
        target.as_ptr(),
        std::ptr::null(),
        std::ptr::null(),
        winapi::um::winuser::SW_SHOWNORMAL,
      )
    };
    if (result as isize) <= 32 {
      return Err(format!(
        "Failed to open URL (ShellExecute error code: {})",
        result as isize,
      ));
    }
    return Ok(());
  }

  #[cfg(target_os = "macos")]
  {
    Command::new("open")
      .arg(&url)
      .spawn()
      .map(|_| ())
      .map_err(|e| format!("Failed to open URL: {e}"))?;
    return Ok(());
  }

  #[cfg(all(unix, not(target_os = "macos")))]
  {
    Command::new("xdg-open")
      .arg(&url)
      .spawn()
      .map(|_| ())
      .map_err(|e| format!("Failed to open URL: {e}"))?;
    return Ok(());
  }

  #[cfg(not(any(windows, unix)))]
  Err("Opening external URLs is unsupported on this platform".to_string())
}

pub(crate) fn collect_launch_candidates(root: &Path, current: &Path, results: &mut Vec<String>) -> Result<(), String> {
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

#[derive(serde::Serialize)]
pub(crate) struct LaunchExecutables {
  pub executables: Vec<String>,
  #[serde(rename = "nonExecutableScripts")]
  pub non_executable_scripts: Vec<String>,
}

#[cfg(not(windows))]
fn collect_non_executable_scripts(
  root: &Path,
  current: &Path,
  results: &mut Vec<String>,
) -> Result<(), String> {
  use std::os::unix::fs::PermissionsExt;

  let entries = fs::read_dir(current)
    .map_err(|e| format!("Failed to read installation folder: {e}"))?;

  for entry in entries {
    let entry = entry.map_err(|e| format!("Failed to read installation folder entry: {e}"))?;
    let path = entry.path();

    if path.is_dir() {
      collect_non_executable_scripts(root, &path, results)?;
      continue;
    }

    let Ok(metadata) = fs::metadata(&path) else { continue };
    let mode = metadata.permissions().mode();
    // Only shell scripts that are missing the executable bit are interesting.
    if mode & 0o111 != 0 {
      continue;
    }
    let ext = path
      .extension()
      .and_then(|v| v.to_str())
      .map(|v| v.to_ascii_lowercase())
      .unwrap_or_default();
    if !matches!(ext.as_str(), "sh" | "bash" | "zsh" | "run" | "command") {
      continue;
    }
    if let Ok(relative) = path.strip_prefix(root) {
      results.push(relative.to_string_lossy().replace('\\', "/"));
    }
  }

  Ok(())
}

#[cfg(windows)]
fn collect_non_executable_scripts(
  _root: &Path,
  _current: &Path,
  _results: &mut Vec<String>,
) -> Result<(), String> {
  Ok(())
}

#[tauri::command]
pub(crate) fn list_launch_executables(
  app: tauri::AppHandle,
  installation_path: String,
) -> Result<LaunchExecutables, String> {
  let root = PathBuf::from(&installation_path);
  if !root.exists() || !root.is_dir() {
    return Ok(LaunchExecutables {
      executables: Vec::new(),
      non_executable_scripts: Vec::new(),
    });
  }

  let ignored = load_settings(&app).ignored_executables;

  let mut results = Vec::new();
  collect_launch_candidates(&root, &root, &mut results)?;
  results.retain(|rel| {
    let rel_path = PathBuf::from(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
    !is_ignored_executable(&rel_path, &ignored)
  });
  results.sort_by(|a, b| {
    a.to_ascii_lowercase().cmp(&b.to_ascii_lowercase())
  });

  let mut non_executable_scripts = Vec::new();
  collect_non_executable_scripts(&root, &root, &mut non_executable_scripts)?;

  Ok(LaunchExecutables {
    executables: results,
    non_executable_scripts,
  })
}

#[tauri::command]
pub(crate) fn make_script_executable(
  installation_path: String,
  relative_paths: Vec<String>,
) -> Result<(), String> {
  let root = PathBuf::from(&installation_path);
  for rel in relative_paths {
    let path = root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
    if !path.exists() || !path.is_file() {
      return Err(format!("Script does not exist: {rel}"));
    }

    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      let mut permissions = fs::metadata(&path)
        .map_err(|e| format!("Failed to read permissions: {e}"))?
        .permissions();
      permissions.set_mode(permissions.mode() | 0o111);
      fs::set_permissions(&path, permissions)
        .map_err(|e| format!("Failed to make script executable: {e}"))?;
    }

    #[cfg(not(unix))]
    {
      return Err("Making scripts executable is only supported on Unix-like systems".to_string());
    }
  }
  Ok(())
}

#[tauri::command]
#[cfg_attr(not(windows), allow(unused_variables))]
pub(crate) fn launch_game(
  app: tauri::AppHandle,
  game_title: String,
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
  let restore_on_exit = load_settings(&app).minimize_on_game_launch;

  #[cfg(windows)]
  if run_as_admin.unwrap_or(false) {
    let params_str = launch_parameters.as_deref().unwrap_or("");
    return launch_windows_admin(app, &exe_path, &working_dir, Some(params_str), restore_on_exit);
  }

  // Linux has no UAC equivalent; elevate via polkit's pkexec (graphical auth
  // prompt), falling back to sudo for environments like WSL where pkexec is
  // unavailable.
  #[cfg(target_os = "linux")]
  if run_as_admin.unwrap_or(false) {
    let mut args: Vec<std::ffi::OsString> = vec![exe_path.as_os_str().to_os_string()];
    if let Some(ref params) = launch_parameters {
      let params = params.trim();
      if !params.is_empty() {
        for arg in params.split_whitespace() {
          args.push(arg.into());
        }
      }
    }

    // Capture the child's console output (like the non-admin path) so an
    // immediate exit — e.g. a script refusing to run as root — is surfaced to
    // the user. Use a longer grace window to account for the auth prompt.
    let (out_path, err_path, out_file, err_file) = create_launch_logs()?;

    // Elevate via polkit's pkexec (graphical auth prompt), falling back to
    // sudo for environments like WSL where pkexec is unavailable.
    let mut pkexec = Command::new("pkexec");
    pkexec.args(&args).current_dir(working_dir);
    pkexec.stdout(Stdio::from(out_file)).stderr(Stdio::from(err_file));
    match pkexec.spawn() {
      Ok(child) => {
        spawn_launch_monitor(
          app,
          game_title,
          child,
          out_path,
          err_path,
          ADMIN_LAUNCH_GRACE,
          restore_on_exit,
        );
        return Ok(());
      }
      Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
        let _ = fs::remove_file(&out_path);
        let _ = fs::remove_file(&err_path);
      }
      Err(e) => {
        let _ = fs::remove_file(&out_path);
        let _ = fs::remove_file(&err_path);
        return Err(format!("Failed to launch game as root: {e}"));
      }
    }

    // pkexec isn't installed; try sudo.
    let (out_path, err_path, out_file, err_file) = create_launch_logs()?;
    let mut sudo = Command::new("sudo");
    sudo.arg("--").args(&args).current_dir(working_dir);
    sudo.stdout(Stdio::from(out_file)).stderr(Stdio::from(err_file));
    return match sudo.spawn() {
      Ok(child) => {
        spawn_launch_monitor(
          app,
          game_title,
          child,
          out_path,
          err_path,
          ADMIN_LAUNCH_GRACE,
          restore_on_exit,
        );
        Ok(())
      }
      Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
        let _ = fs::remove_file(&out_path);
        let _ = fs::remove_file(&err_path);
        Err(
          "Unable to run the game as root: neither 'pkexec' nor 'sudo' is installed on this system."
            .to_string(),
        )
      }
      Err(e) => {
        let _ = fs::remove_file(&out_path);
        let _ = fs::remove_file(&err_path);
        Err(format!("Failed to launch game as root via sudo: {e}"))
      }
    };
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
    command.creation_flags(0x00000200);
  }

  // Redirect the child's console output to temp files (not pipes) so a
  // long-running game can never block on a full pipe buffer, and so we can
  // read it back if the process exits immediately.
  let (out_path, err_path, out_file, err_file) = create_launch_logs()?;
  command.stdout(Stdio::from(out_file));
  command.stderr(Stdio::from(err_file));

  match command.spawn() {
    Ok(child) => {
      spawn_launch_monitor(
        app,
        game_title,
        child,
        out_path,
        err_path,
        LAUNCH_GRACE,
        restore_on_exit,
      );
      Ok(())
    }
    #[cfg(windows)]
    Err(ref e) if e.raw_os_error() == Some(740) => {
      let _ = fs::remove_file(&out_path);
      let _ = fs::remove_file(&err_path);
      let params_str = launch_parameters.as_deref().unwrap_or("");
      launch_windows_admin(app, &exe_path, &working_dir, Some(params_str), restore_on_exit)
    }
    Err(e) => {
      let _ = fs::remove_file(&out_path);
      let _ = fs::remove_file(&err_path);
      Err(format!("Failed to launch game: {e}"))
    }
  }
}

const LAUNCH_GRACE: Duration = Duration::from_secs(5);
const ADMIN_LAUNCH_GRACE: Duration = Duration::from_secs(30);

fn create_launch_logs() -> Result<(PathBuf, PathBuf, fs::File, fs::File), String> {
  let log_token = next_launch_log_token();
  let out_path = std::env::temp_dir().join(format!(
    "gamevault-launch-{}-{log_token}.out",
    std::process::id()
  ));
  let err_path = std::env::temp_dir().join(format!(
    "gamevault-launch-{}-{log_token}.err",
    std::process::id()
  ));

  let out_file = fs::File::create(&out_path)
    .map_err(|e| format!("Failed to create launch log: {e}"))?;
  let err_file = fs::File::create(&err_path)
    .map_err(|e| format!("Failed to create launch log: {e}"))?;

  Ok((out_path, err_path, out_file, err_file))
}

fn next_launch_log_token() -> u64 {
  static COUNTER: AtomicU64 = AtomicU64::new(0);
  COUNTER.fetch_add(1, Ordering::Relaxed)
}

fn clean_up_launch_logs(out_path: &Path, err_path: &Path) {
  let _ = fs::remove_file(out_path);
  let _ = fs::remove_file(err_path);
}

fn format_launch_output(stderr: &str, stdout: &str) -> String {
  let stderr = stderr.trim();
  let stdout = stdout.trim();
  match (stderr.is_empty(), stdout.is_empty()) {
    (false, false) => format!("{stderr}\n{stdout}"),
    (false, true) => stderr.to_string(),
    (true, false) => stdout.to_string(),
    (true, true) => "The game exited immediately without any output.".to_string(),
  }
}

fn hide_main_window(app: &tauri::AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.hide();
  }
}

fn restore_main_window(app: &tauri::AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
}

/// Watches an elevated Windows game process (launched via UAC) so we can
/// restore the gamevault window once the game quits. `ShellExecuteExW` with
/// `SEE_MASK_NOCLOSEPROCESS` hands us a handle to the elevated process that we
/// can wait on even across the UAC elevation boundary.
#[cfg(windows)]
fn spawn_admin_launch_monitor(app: tauri::AppHandle, handle: winapi::um::winnt::HANDLE) {
  use std::os::windows::io::FromRawHandle;

  thread::spawn(move || {
    // Own the handle so it is closed when the thread is done watching.
    let _owned =
      unsafe { std::os::windows::io::OwnedHandle::from_raw_handle(handle as std::os::windows::io::RawHandle) };

    // This monitor is only spawned when "minimize on launch" is enabled, so
    // hide the window up front and restore it once the game quits.
    hide_main_window(&app);

    // Poll until the elevated process exits.
    loop {
      let wait = unsafe { winapi::um::synchapi::WaitForSingleObject(handle, 200) };
      if wait != winapi::shared::winerror::WAIT_TIMEOUT {
        break;
      }
    }

    restore_main_window(&app);
  });
}

/// Launches a game elevated on Windows via UAC and, when the "minimize on
/// launch" setting is enabled, keeps a handle to the process so the gamevault
/// window can be restored when the game quits.
#[cfg(windows)]
fn launch_windows_admin(
  app: tauri::AppHandle,
  exe_path: &Path,
  working_dir: &Path,
  launch_parameters: Option<&str>,
  restore_on_exit: bool,
) -> Result<(), String> {
  use std::ffi::OsStr;
  use std::os::windows::ffi::OsStrExt;
  use winapi::um::shellapi::{ShellExecuteExW, SHELLEXECUTEINFOW, SEE_MASK_NOCLOSEPROCESS};

  let verb: Vec<u16> = OsStr::new("runas").encode_wide().chain(std::iter::once(0)).collect();
  let file: Vec<u16> = exe_path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
  let params_str = launch_parameters.unwrap_or("");
  let params_w: Vec<u16> = OsStr::new(params_str).encode_wide().chain(std::iter::once(0)).collect();
  let dir_w: Vec<u16> = working_dir.as_os_str().encode_wide().chain(std::iter::once(0)).collect();

  let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
  info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
  info.fMask = SEE_MASK_NOCLOSEPROCESS;
  info.lpVerb = verb.as_ptr();
  info.lpFile = file.as_ptr();
  info.lpParameters = params_w.as_ptr();
  info.lpDirectory = dir_w.as_ptr();
  info.nShow = winapi::um::winuser::SW_SHOWNORMAL;

  let ok = unsafe { ShellExecuteExW(&mut info) };
  if ok == 0 {
    // `hInstApp` holds the error code when the call fails.
    return Err(format!(
      "Failed to launch game as admin (ShellExecute error code: {})",
      info.hInstApp as isize
    ));
  }

  if restore_on_exit {
    spawn_admin_launch_monitor(app, info.hProcess);
  } else {
    unsafe { winapi::um::handleapi::CloseHandle(info.hProcess) };
  }
  Ok(())
}

fn spawn_launch_monitor(
  app: tauri::AppHandle,
  game_title: String,
  mut child: Child,
  out_path: PathBuf,
  err_path: PathBuf,
  grace: Duration,
  restore_on_exit: bool,
) {
  thread::spawn(move || {
    // When the user has enabled "minimize on launch", tuck the gamevault
    // window away while the game runs and bring it back once it quits.
    if restore_on_exit {
      hide_main_window(&app);
    }

    let start = Instant::now();

    let status = loop {
      match child.try_wait() {
        Ok(Some(status)) => break status,
        Ok(None) => {
          if start.elapsed() >= grace {
            // Still running after the grace window — treat the launch as
            // successful. If we are restoring on exit, keep watching until
            // the process actually quits so we can bring the window back;
            // otherwise stop watching (the process is already detached).
            if !restore_on_exit {
              clean_up_launch_logs(&out_path, &err_path);
              return;
            }
          }
          thread::sleep(Duration::from_millis(50));
        }
        Err(_) => {
          clean_up_launch_logs(&out_path, &err_path);
          restore_main_window(&app);
          return;
        }
      }
    };

    let stdout = fs::read_to_string(&out_path).unwrap_or_default();
    let stderr = fs::read_to_string(&err_path).unwrap_or_default();
    clean_up_launch_logs(&out_path, &err_path);

    let exit_code = status.code();
    let message = format_launch_output(&stderr, &stdout);

    // Restore the window regardless of whether the game exited cleanly, so
    // the user is never left with a hidden gamevault window.
    restore_main_window(&app);

    // An immediate exit with console output (or a non-zero exit code) almost
    // always means the game failed to start (e.g. a missing prerequisite).
    // Surface it to the user instead of silently doing nothing.
    if !status.success() || !stderr.trim().is_empty() || !stdout.trim().is_empty() {
      emit_game_launch_failed(&app, game_title, exit_code, message);
    }
  });
}

#[cfg(test)]
mod tests {
  use super::validate_external_url;

  #[test]
  fn accepts_http_and_https_urls() {
    assert!(validate_external_url("https://www.google.com/search?q=Game").is_ok());
    assert!(validate_external_url("http://example.test/").is_ok());
  }

  #[test]
  fn rejects_non_web_urls() {
    assert!(validate_external_url("file:///C:/games/image.png").is_err());
    assert!(validate_external_url("javascript:alert(1)").is_err());
  }
}
