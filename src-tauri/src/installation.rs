use crate::events::{emit_install_copy_progress, emit_installer_status};
use crate::util::read_saved_installer_preferences;
#[cfg(windows)]
use crate::util::run_elevated_installer_and_wait;
use std::fs;
use std::fs::File as StdFile;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::Ordering;
use std::thread;
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub(crate) fn collect_install_candidates(root: &Path, current: &Path, results: &mut Vec<String>) -> Result<(), String> {
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

// Recursively applies `chmod +x` to `.sh` shell scripts in the installation
// directory. Copying files does not preserve the original executable bit, so
// on Linux we restore it automatically for extracted shell scripts.
#[cfg(unix)]
fn make_sh_scripts_executable(root: &Path) -> Result<(), String> {
  use std::os::unix::fs::PermissionsExt;

  let entries = fs::read_dir(root).map_err(|e| format!("Failed to read installation folder: {e}"))?;

  for entry in entries {
    let entry = entry.map_err(|e| format!("Failed to read installation folder entry: {e}"))?;
    let path = entry.path();

    if path.is_dir() {
      make_sh_scripts_executable(&path)?;
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

    let mut permissions = fs::metadata(&path)
      .map_err(|e| format!("Failed to read permissions: {e}"))?
      .permissions();
    permissions.set_mode(permissions.mode() | 0o111);
    fs::set_permissions(&path, permissions)
      .map_err(|e| format!("Failed to make script executable: {e}"))?;
  }

  Ok(())
}

#[cfg(not(unix))]
fn make_sh_scripts_executable(_root: &Path) -> Result<(), String> {
  Ok(())
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

#[tauri::command]
pub(crate) fn list_install_executables(extraction_path: String) -> Result<Vec<String>, String> {
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

  // Lower rank = more likely to be the real installer. Common setup names
  // (setup.exe, install.exe, …) are preferred so the correct executable ends
  // up at the top of the list when no preferred installer is configured.
  fn installer_name_rank(relative: &str) -> u8 {
    let normalized = relative.replace('\\', "/").to_ascii_lowercase();
    let basename = normalized.rsplit('/').next().unwrap_or(&normalized);
    let stem = basename
      .rsplit_once('.')
      .map(|(stem, _)| stem)
      .unwrap_or(basename);
    const COMMON: &[&str] = &[
      "setup", "install", "installer", "autorun", "autoplay", "start",
      "launcher", "setup64", "install64", "setup32", "install32",
    ];
    if COMMON.contains(&stem) {
      0
    } else if stem.contains("setup") || stem.contains("install") {
      1
    } else {
      2
    }
  }

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
      .then_with(|| installer_name_rank(left).cmp(&installer_name_rank(right)))
      .then_with(|| left_normalized.cmp(&right_normalized))
  });
  Ok(results)
}

#[tauri::command]
pub(crate) fn copy_installation_files(
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

    // Avoid wasting the user's time copying onto an obviously-full disk.
    if let Some(free) = crate::util::free_space_on(&destination) {
      if total > free {
        emit_install_copy_progress(
          &app,
          game_id,
          "error",
          0,
          Some(total),
          None,
          Some(format!(
            "Not enough disk space to install (needs about {} bytes, only {} bytes free).",
            total, free
          )),
        );
        return;
      }
    }

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
      Ok(_) => {
        // On Linux, restore the executable bit on copied shell scripts so
        // portable games can be launched right after auto-install.
        if let Err(error) = make_sh_scripts_executable(&destination) {
          emit_install_copy_progress(
            &app,
            game_id,
            "error",
            processed,
            Some(total),
            None,
            Some(error),
          );
          return;
        }
        emit_install_copy_progress(&app, game_id, "completed", total, Some(total), None, None)
      }
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

/// How long to keep polling the installation directory after the installer
/// process exits before deciding the install actually failed. Some
/// self-extracting installers (notably GOG/NSIS wrappers) spawn a child
/// installer and their wrapper exits immediately with a non-zero code — e.g.
/// `0xC000041D` / `-1073740771` — even though the real installation continues
/// in the detached child and succeeds. Rather than trusting the exit code,
/// verify the install directory actually got populated.
const INSTALLER_VERIFY_GRACE: Duration = Duration::from_secs(90);

/// Returns true once the installation directory contains at least one entry,
/// meaning the installer (or its detached child) has written into it.
fn installation_directory_populated(path: &Path) -> bool {
  fs::read_dir(path)
    .map(|mut entries| entries.next().is_some())
    .unwrap_or(false)
}

/// Polls the installation directory for `INSTALLER_VERIFY_GRACE`, returning
/// true as soon as it is populated (or immediately if it already is).
fn wait_for_installation_populated(path: &Path) -> bool {
  let start = Instant::now();
  while start.elapsed() < INSTALLER_VERIFY_GRACE {
    if installation_directory_populated(path) {
      return true;
    }
    thread::sleep(Duration::from_millis(500));
  }
  installation_directory_populated(path)
}

/// Runs a Windows installer through `umu-run` on Linux. Auto-installs
/// umu-launcher when missing, streams its setup output via `umu-status`
/// events (drives the "Setting up umu launcher…" overlay) and keeps the
/// regular `installer-status` protocol so the download card stays in sync.
#[cfg(target_os = "linux")]
fn run_installer_via_umu(
  app: tauri::AppHandle,
  game_id: i64,
  installer_path: &Path,
  installer_relative: &str,
  installation_path_resolved: &str,
  installer_parameters: Option<String>,
  is_msi: bool,
) {
  if let Err(error) = crate::umu::ensure_umu_installed(&app, None) {
    emit_installer_status(
      &app,
      game_id,
      "error",
      Some(installer_relative.to_string()),
      None,
      Some(error),
    );
    return;
  }

  let Some(umu_run) = crate::umu::find_umu_run() else {
    let message = "umu-run was not found. Unable to launch Windows installer on Linux.".to_string();
    crate::events::emit_umu_status(&app, None, "error", None, Some(message.clone()));
    emit_installer_status(
      &app,
      game_id,
      "error",
      Some(installer_relative.to_string()),
      None,
      Some(message),
    );
    return;
  };

  let working_dir = installer_path
    .parent()
    .map(|parent| parent.to_path_buf())
    .unwrap_or_default();

  let mut command = Command::new(&umu_run);
  if is_msi {
    command.arg("msiexec").arg("/i");
  }
  command.arg(installer_path).current_dir(&working_dir);

  if let Some(parameters) = installer_parameters {
    let parameters = parameters.replace("%INSTALLDIR%", installation_path_resolved);
    let parameters = parameters.trim();
    if !parameters.is_empty() {
      for arg in parameters.split_whitespace() {
        command.arg(arg);
      }
    }
  }

  command.stdout(Stdio::piped()).stderr(Stdio::piped());

  let mut child = match command.spawn() {
    Ok(child) => child,
    Err(error) => {
      let message = format!("Failed to start installer: {error}");
      crate::events::emit_umu_status(&app, None, "error", None, Some(message.clone()));
      emit_installer_status(
        &app,
        game_id,
        "error",
        Some(installer_relative.to_string()),
        None,
        Some(message),
      );
      return;
    }
  };

  let stdout = child.stdout.take();
  let stderr = child.stderr.take();
  let handle = crate::umu::spawn_umu_streamers(&app, None, stdout, stderr);

  emit_installer_status(
    &app,
    game_id,
    "running",
    Some(installer_relative.to_string()),
    None,
    None,
  );

  // Let the umu overlay know once the installer window actually appears (umu
  // emits "running" right when the wine container finishes setting up).
  {
    let exe_path = installer_path.to_path_buf();
    let running_flag = handle.running.clone();
    let overlay_app = app.clone();
    thread::spawn(move || {
      let started = Instant::now();
      loop {
        if running_flag.load(Ordering::SeqCst) || crate::umu::detect_process_running(&exe_path) {
          crate::events::emit_umu_status(&overlay_app, None, "running", None, None);
          break;
        }
        // Safety net: assume the installer started even if undetected.
        if started.elapsed() >= Duration::from_secs(600) {
          crate::events::emit_umu_status(&overlay_app, None, "running", None, None);
          break;
        }
        thread::sleep(Duration::from_millis(500));
      }
    });
  }

  let status = child.wait();
  let exit_code = status.as_ref().ok().and_then(|s| s.code());

  if status.map(|s| s.success()).unwrap_or(false) {
    emit_installer_status(
      &app,
      game_id,
      "completed",
      Some(installer_relative.to_string()),
      exit_code,
      None,
    );
  } else if wait_for_installation_populated(Path::new(installation_path_resolved)) {
    // Non-zero exit is not a reliable failure (GOG/NSIS wrappers detach a
    // child that keeps installing); verify the install dir got populated.
    emit_installer_status(
      &app,
      game_id,
      "completed",
      Some(installer_relative.to_string()),
      exit_code,
      None,
    );
  } else {
    emit_installer_status(
      &app,
      game_id,
      "error",
      Some(installer_relative.to_string()),
      exit_code,
      Some(format!(
        "Installer exited with code {}.",
        exit_code.unwrap_or(-1)
      )),
    );
  }
}

#[tauri::command]
pub(crate) fn launch_installation_executable(
  app: tauri::AppHandle,
  game_id: i64,
  extraction_path: String,
  installer_relative_path: String,
  installation_path: String,
  installer_parameters: Option<String>,
) -> Result<(), String> {
  let extraction_root = PathBuf::from(extraction_path);
  let installer_path = extraction_root.join(installer_relative_path.replace('/', "\\"));
  if !installer_path.exists() || !installer_path.is_file() {
    return Err("Selected installer does not exist".to_string());
  }

  let installation_path_resolved = installation_path.clone();
  let installer_relative = installer_relative_path.clone();
  let (_, saved_installer_parameters) = read_saved_installer_preferences(&extraction_root);
  let installer_parameters = installer_parameters
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
    .or(saved_installer_parameters);
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

    // On Linux, Windows installers run through umu-launcher (Proton/Wine).
    #[cfg(target_os = "linux")]
    if crate::umu::is_windows_executable(&installer_path) {
      run_installer_via_umu(
        app,
        game_id,
        &installer_path,
        &installer_relative,
        &installation_path_resolved,
        installer_parameters.clone(),
        is_msi,
      );
      return;
    }

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
    let _fallback_argument_list = if is_msi {
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
              if _fallback_argument_list.trim().is_empty() {
                None
              } else {
                Some(_fallback_argument_list.as_str())
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
          // A non-zero exit code is not a reliable failure signal. Some
          // self-extracting installers (GOG/NSIS wrappers) spawn a child and
          // their wrapper exits right away (e.g. -1073740771 / 0xC000041D)
          // while the real install continues and succeeds. Verify the install
          // directory actually got populated before reporting an error.
          if wait_for_installation_populated(Path::new(&installation_path_resolved)) {
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
pub(crate) fn launch_uninstall_executable(
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
  let _fallback_argument_list = if is_msi {
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
            if _fallback_argument_list.trim().is_empty() {
              None
            } else {
              Some(_fallback_argument_list.as_str())
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
