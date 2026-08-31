/// Filesystem utility commands that bypass plugin-fs scope restrictions.

use std::path::Path;

fn is_gamevault_metadata_file(path: &Path) -> bool {
  matches!(
    path.file_name().and_then(|name| name.to_str()),
    Some(".gamevault.game.config.json" | ".gamevault.metadata.json")
  )
}

#[cfg(windows)]
fn mark_hidden(path: &Path) -> Result<(), String> {
  use std::iter::once;
  use std::os::windows::ffi::OsStrExt;
  use winapi::um::fileapi::{GetFileAttributesW, SetFileAttributesW};
  use winapi::um::winnt::FILE_ATTRIBUTE_HIDDEN;

  let wide_path = path
    .as_os_str()
    .encode_wide()
    .chain(once(0))
    .collect::<Vec<_>>();
  let attributes = unsafe { GetFileAttributesW(wide_path.as_ptr()) };
  if attributes == u32::MAX {
    return Err(format!(
      "Failed to read attributes for '{}': {}",
      path.display(),
      std::io::Error::last_os_error(),
    ));
  }
  if unsafe { SetFileAttributesW(wide_path.as_ptr(), attributes | FILE_ATTRIBUTE_HIDDEN) } == 0 {
    return Err(format!(
      "Failed to hide '{}': {}",
      path.display(),
      std::io::Error::last_os_error(),
    ));
  }

  Ok(())
}

#[cfg(not(windows))]
fn mark_hidden(_path: &Path) -> Result<(), String> {
  Ok(())
}

#[tauri::command]
pub(crate) fn fs_read_text_file(path: String) -> Result<String, String> {
  std::fs::read_to_string(&path).map_err(|e| format!("fs_read_text_file failed for '{}': {}", path, e))
}

#[tauri::command]
pub(crate) fn fs_write_text_file(path: String, content: String) -> Result<(), String> {
  let file_path = Path::new(&path);
  std::fs::write(file_path, content)
    .map_err(|e| format!("fs_write_text_file failed for '{}': {}", path, e))?;

  if is_gamevault_metadata_file(file_path) {
    mark_hidden(file_path)?;
  }

  Ok(())
}

#[tauri::command]
pub(crate) fn fs_create_dir_all(path: String) -> Result<(), String> {
  std::fs::create_dir_all(&path).map_err(|e| format!("fs_create_dir_all failed for '{}': {}", path, e))
}

#[tauri::command]
pub(crate) fn fs_path_exists(path: String) -> Result<bool, String> {
  Ok(std::path::Path::new(&path).exists())
}

#[tauri::command]
pub(crate) fn fs_remove(path: String, recursive: bool) -> Result<(), String> {
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

/// Returns true if `path` is a directory whose only contents are GameVault
/// metadata files (`.gamevault.game.config.json` / `.gamevault.metadata.json`).
/// Such directories should be treated as empty for cleanup purposes.
fn dir_only_has_metadata_files(path: &Path) -> bool {
  let entries = match std::fs::read_dir(path) {
    Ok(entries) => entries,
    Err(_) => return false,
  };

  let mut any = false;
  for entry in entries.flatten() {
    any = true;
    let entry_path = entry.path();
    if entry_path.is_dir() || !is_gamevault_metadata_file(&entry_path) {
      return false;
    }
  }
  any
}

/// Removes empty directories starting at `path` and walking up toward
/// `stop_at` (which is never removed). Used to clean up the empty per-version
/// and per-game folders left behind after a download is deleted or a game is
/// uninstalled.
///
/// A directory is considered removable when it is empty OR only contains
/// GameVault metadata files, so the hidden `.gamevault.game.config.json` /
/// `.gamevault.metadata.json` files don't block cleanup when nothing else is
/// left. Pruning stops at the first directory that still has real content.
#[tauri::command]
pub(crate) fn remove_empty_directories(path: String, stop_at: String) -> Result<(), String> {
  let mut current = std::path::PathBuf::from(&path);
  let stop = std::path::PathBuf::from(&stop_at);

  while current != stop && current.starts_with(&stop) {
    if std::fs::remove_dir(&current).is_ok() {
      // Directory was truly empty; keep pruning upward.
    } else if dir_only_has_metadata_files(&current) {
      // Only metadata files remain — remove them, then the directory itself.
      if let Ok(entries) = std::fs::read_dir(&current) {
        for entry in entries.flatten() {
          let _ = std::fs::remove_file(entry.path());
        }
      }
      if std::fs::remove_dir(&current).is_err() {
        return Ok(());
      }
    } else {
      // Directory still has real content; stop pruning.
      return Ok(());
    }

    match current.parent() {
      Some(parent) => current = parent.to_path_buf(),
      None => break,
    }
  }

  Ok(())
}

/// Returns true when any currently-running process has its executable located
/// underneath `root`. Used to detect post-install helper processes (e.g.
/// quicksfv.exe) that the installer spawned and that still reference the
/// source files, so we don't delete them out from under a running process.
fn process_running_under(root: &Path) -> bool {
  use sysinfo::{ProcessesToUpdate, System};

  let mut system = System::new_all();
  system.refresh_processes(ProcessesToUpdate::All, true);

  let root_str = root.to_string_lossy().to_lowercase();
  // Ensure the match is at a path boundary so "Extraction" doesn't match a
  // sibling like "Extraction2\other.exe".
  let root_prefix = if root_str.ends_with('\\') || root_str.ends_with('/') {
    root_str
  } else {
    let separator = if root_str.contains('\\') { '\\' } else { '/' };
    format!("{root_str}{separator}")
  };

  system.processes().values().any(|process| {
    process
      .exe()
      .map(|exe| exe.to_string_lossy().to_lowercase().starts_with(&root_prefix))
      .unwrap_or(false)
  })
}

/// Safely deletes the download and extraction folders after a successful
/// install, returning `true` once both are gone.
///
/// The delete is refused (returns `false`) while a process is still running
/// from inside these folders or while any file within is open, so it never
/// removes files out from under a post-install helper (e.g. quicksfv.exe) or
/// partially deletes a directory. Callers should poll until it returns true.
#[tauri::command]
pub(crate) fn delete_pending_directories(
  download_directory: String,
  extraction_directory: String,
) -> Result<bool, String> {
  for dir in [&download_directory, &extraction_directory] {
    let path = Path::new(dir);
    if !path.exists() {
      continue;
    }

    // Don't delete while a post-install helper process is still running from
    // inside these folders.
    if process_running_under(path) {
      return Ok(false);
    }

    // Rename as a lock test: on Windows renaming a directory fails when any
    // file inside it is still open, so we never partially delete out from
    // under a process.
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path.file_name().and_then(|name| name.to_str()).unwrap_or("dir");
    let temp_path = parent.join(format!(
      "{file_name}.gamevault-deleting-{}",
      std::process::id(),
    ));

    if std::fs::rename(path, &temp_path).is_err() {
      return Ok(false);
    }

    let remove_result = if temp_path.is_dir() {
      std::fs::remove_dir_all(&temp_path)
    } else {
      std::fs::remove_file(&temp_path)
    };
    if remove_result.is_err() {
      // Restore the original name rather than leaving a stale temp folder.
      let _ = std::fs::rename(&temp_path, path);
      return Ok(false);
    }
  }

  Ok(true)
}

#[cfg(test)]
mod tests {
  use super::{dir_only_has_metadata_files, fs_write_text_file, is_gamevault_metadata_file, remove_empty_directories};
  use std::fs;
  use std::path::{Path, PathBuf};
  use std::time::{SystemTime, UNIX_EPOCH};

  fn test_directory() -> PathBuf {
    let unique_name = format!(
      "gamevault-fs-command-test-{}",
      SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before Unix epoch")
        .as_nanos(),
    );
    std::env::temp_dir().join(unique_name)
  }

  #[cfg(windows)]
  fn is_hidden(path: &Path) -> bool {
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::fileapi::GetFileAttributesW;
    use winapi::um::winnt::FILE_ATTRIBUTE_HIDDEN;

    let wide_path = path
      .as_os_str()
      .encode_wide()
      .chain(once(0))
      .collect::<Vec<_>>();
    unsafe { GetFileAttributesW(wide_path.as_ptr()) & FILE_ATTRIBUTE_HIDDEN != 0 }
  }

  #[test]
  fn identifies_only_gamevault_metadata_files() {
    assert!(is_gamevault_metadata_file(Path::new(
      ".gamevault.game.config.json"
    )));
    assert!(is_gamevault_metadata_file(Path::new(
      ".gamevault.metadata.json"
    )));
    assert!(!is_gamevault_metadata_file(Path::new("config.json")));
  }

  #[test]
  fn writes_gamevault_metadata_files() {
    let directory = test_directory();
    fs::create_dir_all(&directory).expect("create test directory");

    for file_name in [
      ".gamevault.game.config.json",
      ".gamevault.metadata.json",
    ] {
      let path = directory.join(file_name);
      fs_write_text_file(path.to_string_lossy().into_owned(), "{}".to_string())
        .expect("write metadata file");
      assert_eq!(fs::read_to_string(&path).expect("read metadata file"), "{}");
      #[cfg(windows)]
      assert!(is_hidden(&path));
    }

    fs::remove_dir_all(directory).expect("remove test directory");
  }

  #[test]
  fn dir_with_only_metadata_files_counts_as_empty() {
    let directory = test_directory();
    let stop = directory.parent().expect("parent").to_path_buf();
    let version_dir = directory.join("Versions").join("v1");
    fs::create_dir_all(&version_dir).expect("create version dir");

    // Only GameVault metadata files remain.
    fs_write_text_file(
      version_dir
        .join(".gamevault.game.config.json")
        .to_string_lossy()
        .into_owned(),
      "{}".to_string(),
    )
    .expect("write version config");

    assert!(dir_only_has_metadata_files(&version_dir));

    remove_empty_directories(
      version_dir.to_string_lossy().into_owned(),
      stop.to_string_lossy().into_owned(),
    )
    .expect("prune empty dirs");

    // The version and (empty) Versions directory should be gone.
    assert!(!version_dir.exists());
    assert!(!directory.join("Versions").exists());
    assert!(stop.exists());

    fs::remove_dir_all(directory).ok();
  }

  #[test]
  fn dir_with_real_content_is_not_pruned() {
    let directory = test_directory();
    let stop = directory.parent().expect("parent").to_path_buf();
    let version_dir = directory.join("Versions").join("v1");
    fs::create_dir_all(&version_dir).expect("create version dir");

    // A real file should block pruning of this directory.
    fs::write(version_dir.join("game.exe"), b"data").expect("write real file");
    fs_write_text_file(
      version_dir
        .join(".gamevault.game.config.json")
        .to_string_lossy()
        .into_owned(),
      "{}".to_string(),
    )
    .expect("write version config");

    remove_empty_directories(
      version_dir.to_string_lossy().into_owned(),
      stop.to_string_lossy().into_owned(),
    )
    .expect("prune empty dirs");

    assert!(version_dir.exists());
    assert!(version_dir.join("game.exe").exists());

    fs::remove_dir_all(directory).ok();
  }
}
