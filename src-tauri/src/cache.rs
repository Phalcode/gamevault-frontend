use std::fs;
use std::path::PathBuf;
use tauri::Manager;

fn cache_root(app: &tauri::AppHandle) -> PathBuf {
  app.path()
    .app_data_dir()
    .unwrap_or_else(|_| PathBuf::from("."))
    .join("offline-cache")
}

#[tauri::command]
pub(crate) fn cache_game_data(app: tauri::AppHandle, game_id: i64, json: String) -> Result<(), String> {
  let dir = cache_root(&app).join("games");
  fs::create_dir_all(&dir)
    .map_err(|e| format!("Failed to create cache dir: {e}"))?;
  let path = dir.join(format!("{game_id}.json"));
  fs::write(&path, json.as_bytes())
    .map_err(|e| format!("Failed to cache game data: {e}"))?;
  Ok(())
}

#[tauri::command]
pub(crate) fn cache_game_image(
  app: tauri::AppHandle,
  media_id: i64,
  bytes: Vec<u8>,
  content_type: String,
) -> Result<(), String> {
  let dir = cache_root(&app).join("images");
  fs::create_dir_all(&dir)
    .map_err(|e| format!("Failed to create images cache dir: {e}"))?;
  let ext = content_type
    .split('/')
    .nth(1)
    .unwrap_or("bin");
  let path = dir.join(format!("{media_id}.{ext}"));
  fs::write(&path, &bytes)
    .map_err(|e| format!("Failed to cache image: {e}"))?;
  Ok(())
}

#[tauri::command]
pub(crate) fn load_cached_game(app: tauri::AppHandle, game_id: i64) -> Result<Option<String>, String> {
  let path = cache_root(&app)
    .join("games")
    .join(format!("{game_id}.json"));
  if !path.exists() {
    return Ok(None);
  }
  fs::read_to_string(&path)
    .map(Some)
    .map_err(|e| format!("Failed to read cached game: {e}"))
}

#[tauri::command]
pub(crate) fn load_cached_image(app: tauri::AppHandle, media_id: i64) -> Result<Option<Vec<u8>>, String> {
  let images_dir = cache_root(&app).join("images");
  if !images_dir.exists() {
    return Ok(None);
  }
  let entries = fs::read_dir(&images_dir)
    .map_err(|e| format!("Failed to read images dir: {e}"))?;
  let prefix = format!("{media_id}.");
  for entry in entries.flatten() {
    let name = entry.file_name().to_string_lossy().to_string();
    if name.starts_with(&prefix) {
      return fs::read(entry.path())
        .map(Some)
        .map_err(|e| format!("Failed to read cached image: {e}"));
    }
  }
  Ok(None)
}

#[tauri::command]
pub(crate) fn list_cached_game_ids(app: tauri::AppHandle) -> Result<Vec<i64>, String> {
  let dir = cache_root(&app).join("games");
  if !dir.exists() {
    return Ok(Vec::new());
  }
  let mut ids = Vec::new();
  for entry in fs::read_dir(&dir).map_err(|e| format!("Failed to read cache dir: {e}"))?.flatten() {
    let name = entry.file_name().to_string_lossy().to_string();
    if let Some(stem) = name.strip_suffix(".json") {
      if let Ok(id) = stem.parse::<i64>() {
        ids.push(id);
      }
    }
  }
  Ok(ids)
}

#[tauri::command]
pub(crate) fn delete_cached_game(app: tauri::AppHandle, game_id: i64) -> Result<(), String> {
  let path = cache_root(&app).join("games").join(format!("{game_id}.json"));
  if path.exists() {
    fs::remove_file(&path).map_err(|e| format!("Failed to delete cached game: {e}"))?;
  }
  Ok(())
}

#[tauri::command]
pub(crate) fn delete_cached_image(app: tauri::AppHandle, media_id: i64) -> Result<(), String> {
  let images_dir = cache_root(&app).join("images");
  if !images_dir.exists() {
    return Ok(());
  }
  let prefix = format!("{media_id}.");
  for entry in fs::read_dir(&images_dir).map_err(|e| format!("Failed to read images dir: {e}"))?.flatten() {
    let name = entry.file_name().to_string_lossy().to_string();
    if name.starts_with(&prefix) {
      fs::remove_file(entry.path()).map_err(|e| format!("Failed to delete cached image: {e}"))?;
    }
  }
  Ok(())
}
