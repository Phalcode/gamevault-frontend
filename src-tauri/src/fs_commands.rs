/// Filesystem utility commands that bypass plugin-fs scope restrictions.

#[tauri::command]
pub(crate) fn fs_read_text_file(path: String) -> Result<String, String> {
  std::fs::read_to_string(&path).map_err(|e| format!("fs_read_text_file failed for '{}': {}", path, e))
}

#[tauri::command]
pub(crate) fn fs_write_text_file(path: String, content: String) -> Result<(), String> {
  std::fs::write(&path, content).map_err(|e| format!("fs_write_text_file failed for '{}': {}", path, e))
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
