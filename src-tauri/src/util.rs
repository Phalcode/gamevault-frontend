use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

/// Returns the free (available) disk space, in bytes, on the volume that
/// contains the given path. Returns `None` if the free space could not be
/// determined.
pub(crate) fn free_space_on(path: &Path) -> Option<u64> {
  use sysinfo::Disks;

  let disks = Disks::new_with_refreshed_list();
  let mut best: Option<(usize, &sysinfo::Disk)> = None;
  for disk in disks.list() {
    let mount = disk.mount_point();
    if path.starts_with(mount) {
      let depth = mount.components().count();
      if best.map(|(d, _)| depth > d).unwrap_or(true) {
        best = Some((depth, disk));
      }
    }
  }
  best.map(|(_, disk)| disk.available_space() as u64)
}

/// Returns `(total, available)` bytes on the volume that contains `path`.
/// Returns `None` if the disk could not be determined.
pub(crate) fn disk_space(path: &Path) -> Option<(u64, u64)> {
  use sysinfo::Disks;

  let disks = Disks::new_with_refreshed_list();
  let mut best: Option<(usize, &sysinfo::Disk)> = None;
  for disk in disks.list() {
    let mount = disk.mount_point();
    if path.starts_with(mount) {
      let depth = mount.components().count();
      if best.map(|(d, _)| depth > d).unwrap_or(true) {
        best = Some((depth, disk));
      }
    }
  }
  best.map(|(_, disk)| (disk.total_space(), disk.available_space()))
}

/// Recursively sums the size (in bytes) of every regular file under `path`.
/// Symlinks are skipped (to avoid following cycles) and unreadable entries are
/// ignored, so this is best-effort.
pub(crate) fn dir_size(path: &Path) -> u64 {
  let mut total = 0u64;
  if let Ok(entries) = fs::read_dir(path) {
    for entry in entries.flatten() {
      let entry_path = entry.path();
      let file_type = match entry.file_type() {
        Ok(ft) => ft,
        Err(_) => continue,
      };
      if file_type.is_symlink() {
        continue;
      }
      if file_type.is_dir() {
        total = total.saturating_add(dir_size(&entry_path));
      } else if file_type.is_file() {
        if let Ok(metadata) = entry.metadata() {
          total = total.saturating_add(metadata.len());
        }
      }
    }
  }
  total
}

pub(crate) fn parse_version_folder(folder_name: &str) -> (i64, String) {
  if let Some(rest) = folder_name.strip_prefix('(') {
    if let Some((id_part, name_part)) = rest.split_once(')') {
      let version_id = id_part.trim().parse::<i64>().unwrap_or(0);
      return (version_id, name_part.trim().to_string());
    }
  }
  (0, folder_name.to_string())
}

/// Opens the browser DevTools for the main window. Only meaningful in builds
/// compiled with the tauri `devtools` feature (enabled in Cargo.toml).
#[tauri::command]
pub(crate) fn open_devtools(app: tauri::AppHandle) {
  use tauri::Manager;
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.open_devtools();
  }
}


pub(crate) fn stable_id_from_path(path: &str) -> i64 {
  let mut hasher = std::collections::hash_map::DefaultHasher::new();
  path.hash(&mut hasher);
  (hasher.finish() & 0x7FFF_FFFF) as i64
}

pub(crate) fn parse_i64_json(value: Option<&serde_json::Value>) -> Option<i64> {
  match value {
    Some(v) => v
      .as_i64()
      .or_else(|| v.as_u64().map(|n| n as i64))
      .or_else(|| v.as_str().and_then(|s| s.trim().parse::<i64>().ok())),
    None => None,
  }
}

pub(crate) fn resolve_version_id(config: &serde_json::Value, folder_version_id: i64) -> i64 {
  parse_i64_json(config.get("versionid"))
    .filter(|id| *id > 0)
    .unwrap_or(folder_version_id)
}

pub(crate) fn resolve_version_subdir(version_path: &Path, preferred: &str, legacy: &str) -> PathBuf {
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

#[cfg(test)]
mod tests {
  use super::{parse_version_folder, resolve_version_id};
  use serde_json::json;

  #[test]
  fn parses_legacy_version_folder() {
    assert_eq!(
      parse_version_folder("(775) v1.0.61"),
      (775, "v1.0.61".to_string()),
    );
  }

  #[test]
  fn uses_config_version_id_for_name_only_folder() {
    assert_eq!(resolve_version_id(&json!({ "versionid": 775 }), 0), 775);
  }

  #[test]
  fn falls_back_to_legacy_folder_version_id() {
    assert_eq!(resolve_version_id(&json!({}), 775), 775);
  }
}

pub(crate) fn read_saved_game_metadata(start_path: &Path) -> Option<serde_json::Value> {
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

pub(crate) fn read_saved_installer_preferences(start_path: &Path) -> (Option<String>, Option<String>) {
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

/// Launches the installer elevated (UAC) via `ShellExecuteExW` directly.
///
/// This bypasses PowerShell entirely. `Start-Process -FilePath` performs
/// PowerShell wildcard resolution, so folder/file names containing wildcard
/// metacharacters (`[`, `]`, `*`, `?` — e.g. repack folder names like
/// "… [Vanya Repack]") make it fail with "wildcard path … did not resolve to
/// a file". `ShellExecuteExW` passes `lpFile`/`lpDirectory` literally — no
/// globbing, no quoting layer — so bracket- and space-containing paths work.
#[cfg(windows)]
pub(crate) fn run_elevated_installer_and_wait(
  executable: &str,
  argument_list: Option<&str>,
  working_directory: Option<&str>,
) -> Result<Option<i32>, String> {
  use std::ffi::OsStr;
  use std::iter::once;
  use std::os::windows::ffi::OsStrExt;
  use winapi::um::handleapi::CloseHandle;
  use winapi::um::processthreadsapi::GetExitCodeProcess;
  use winapi::um::shellapi::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
  use winapi::um::synchapi::WaitForSingleObject;
  use winapi::um::winbase::INFINITE;
  use winapi::um::winuser::SW_SHOWNORMAL;

  fn to_wide(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(once(0)).collect()
  }

  let executable = to_wide(executable);
  let verb = to_wide("runas");
  let arguments = argument_list
    .filter(|value| !value.trim().is_empty())
    .map(|value| to_wide(value));
  let directory = working_directory
    .filter(|value| !value.trim().is_empty())
    .map(|value| to_wide(value));

  let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
  info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
  // NOCLOSEPROCESS gives us a handle we can wait on and read the exit code
  // from. All paths are passed literally — no PowerShell, no wildcard
  // resolution, so bracket paths just work.
  info.fMask = SEE_MASK_NOCLOSEPROCESS;
  info.lpVerb = verb.as_ptr();
  info.lpFile = executable.as_ptr();
  info.lpParameters = arguments
    .as_ref()
    .map_or(std::ptr::null(), |value| value.as_ptr());
  info.lpDirectory = directory
    .as_ref()
    .map_or(std::ptr::null(), |value| value.as_ptr());
  info.nShow = SW_SHOWNORMAL;

  let launched = unsafe { ShellExecuteExW(&mut info) };
  if launched == 0 {
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(1223) {
      return Err("Installation canceled by user (UAC prompt declined).".to_string());
    }
    return Err(format!("Failed to launch elevated installer: {error}"));
  }

  if info.hProcess.is_null() {
    return Ok(None);
  }

  unsafe {
    WaitForSingleObject(info.hProcess, INFINITE);
    let mut exit_code: u32 = 0;
    let valid = GetExitCodeProcess(info.hProcess, &mut exit_code);
    CloseHandle(info.hProcess);
    if valid == 0 {
      return Ok(None);
    }
    Ok(Some(exit_code as i32))
  }
}

/// Compare two paths for equality.
/// Windows: case-insensitive with canonicalized separators.
/// Linux: exact match.
pub(crate) fn paths_match(a: &Path, b: &Path) -> bool {
  #[cfg(windows)]
  {
    let a_str = a.to_string_lossy().to_lowercase().replace('/', "\\");
    let b_str = b.to_string_lossy().to_lowercase().replace('/', "\\");
    a_str == b_str
  }
  #[cfg(not(windows))]
  {
    // The process exe reported by /proc/<pid>/exe is canonicalized (symlinks
    // resolved), while the game exe path is built from the configured install
    // directory which may itself contain symlinks. Canonicalize before
    // comparing so a game launched through a symlinked path still matches.
    let a = fs::canonicalize(a).unwrap_or_else(|_| a.to_path_buf());
    let b = fs::canonicalize(b).unwrap_or_else(|_| b.to_path_buf());
    a == b
  }
}

/// True when the executable's base name (without extension) is in `ignored`.
/// Matching is case-insensitive; ignore-list entries have no extension.
pub(crate) fn is_ignored_executable(path: &Path, ignored: &[String]) -> bool {
  let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
    return false;
  };
  let stem_lower = stem.to_lowercase();
  ignored
    .iter()
    .any(|name| name.to_lowercase() == stem_lower)
}
