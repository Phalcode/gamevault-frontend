use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};
use tauri::Manager;

fn cache_root(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("offline-cache")
}

fn validate_server_namespace(server_namespace: &str) -> Result<(), String> {
    if server_namespace.is_empty()
        || server_namespace.len() > 64
        || !server_namespace.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        return Err("Invalid server cache namespace".to_string());
    }
    Ok(())
}

fn images_cache_dir(app: &tauri::AppHandle, server_namespace: &str) -> Result<PathBuf, String> {
    validate_server_namespace(server_namespace)?;
    Ok(cache_root(app).join("images").join(server_namespace))
}

#[tauri::command]
pub(crate) fn cache_game_data(
    app: tauri::AppHandle,
    game_id: i64,
    json: String,
) -> Result<(), String> {
    let dir = cache_root(&app).join("games");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create cache dir: {e}"))?;
    let path = dir.join(format!("{game_id}.json"));
    fs::write(&path, json.as_bytes()).map_err(|e| format!("Failed to cache game data: {e}"))?;
    Ok(())
}

#[tauri::command]
pub(crate) fn cache_game_image(
    app: tauri::AppHandle,
    server_namespace: String,
    media_id: i64,
    bytes: Vec<u8>,
    content_type: String,
) -> Result<(), String> {
    let dir = images_cache_dir(&app, &server_namespace)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create images cache dir: {e}"))?;
    let ext = content_type
        .split('/')
        .nth(1)
        .unwrap_or("bin")
        .chars()
        .take(16)
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>();
    let ext = if ext.is_empty() { "bin" } else { &ext };
    let path = dir.join(format!("{media_id}.{ext}"));
    fs::write(&path, &bytes).map_err(|e| format!("Failed to cache image: {e}"))?;
    Ok(())
}

#[tauri::command]
pub(crate) fn load_cached_game(
    app: tauri::AppHandle,
    game_id: i64,
) -> Result<Option<String>, String> {
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
pub(crate) fn load_cached_image(
    app: tauri::AppHandle,
    server_namespace: String,
    media_id: i64,
) -> Result<Option<Vec<u8>>, String> {
    let images_dir = images_cache_dir(&app, &server_namespace)?;
    if !images_dir.exists() {
        return Ok(None);
    }
    let entries =
        fs::read_dir(&images_dir).map_err(|e| format!("Failed to read images dir: {e}"))?;
    let prefix = format!("{media_id}.");
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(&prefix) {
            let path = entry.path();
            let bytes = fs::read(&path).map_err(|e| format!("Failed to read cached image: {e}"))?;
            let _ = fs::write(&path, &bytes);
            return Ok(Some(bytes));
        }
    }
    Ok(None)
}

#[tauri::command]
pub(crate) fn cleanup_cached_images(
    app: tauri::AppHandle,
    server_namespace: String,
    max_age_seconds: u64,
) -> Result<(), String> {
    let images_dir = images_cache_dir(&app, &server_namespace)?;
    if !images_dir.exists() {
        return Ok(());
    }

    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(max_age_seconds))
        .unwrap_or(SystemTime::UNIX_EPOCH);
    for entry in fs::read_dir(&images_dir)
        .map_err(|e| format!("Failed to read images dir: {e}"))?
        .flatten()
    {
        let is_expired = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .map(|modified| modified < cutoff)
            .unwrap_or(false);
        if is_expired {
            fs::remove_file(entry.path())
                .map_err(|e| format!("Failed to delete stale cached image: {e}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn list_cached_game_ids(app: tauri::AppHandle) -> Result<Vec<i64>, String> {
    let dir = cache_root(&app).join("games");
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut ids = Vec::new();
    for entry in fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read cache dir: {e}"))?
        .flatten()
    {
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
    let path = cache_root(&app)
        .join("games")
        .join(format!("{game_id}.json"));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete cached game: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn delete_cached_image(
    app: tauri::AppHandle,
    server_namespace: String,
    media_id: i64,
) -> Result<(), String> {
    let images_dir = images_cache_dir(&app, &server_namespace)?;
    if !images_dir.exists() {
        return Ok(());
    }
    let prefix = format!("{media_id}.");
    for entry in fs::read_dir(&images_dir)
        .map_err(|e| format!("Failed to read images dir: {e}"))?
        .flatten()
    {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(&prefix) {
            fs::remove_file(entry.path())
                .map_err(|e| format!("Failed to delete cached image: {e}"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_server_namespace;

    #[test]
    fn accepts_generated_server_namespace() {
        assert!(validate_server_namespace("server-0123456789abcdef").is_ok());
    }

    #[test]
    fn rejects_path_traversal_namespace() {
        assert!(validate_server_namespace("../other-server").is_err());
        assert!(validate_server_namespace("server\\other").is_err());
    }
}
