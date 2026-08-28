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

#[cfg(test)]
mod tests {
  use super::{fs_write_text_file, is_gamevault_metadata_file};
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
}
