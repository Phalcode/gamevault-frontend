use serde::{Serialize, Deserialize};
use std::path::PathBuf;
use tauri::Manager;

#[derive(Serialize, Deserialize, Default)]
pub(crate) struct AppSettings {
  #[serde(default)]
  pub start_minimized: bool,
}

pub(crate) fn settings_path(app: &tauri::AppHandle) -> PathBuf {
  app.path().app_data_dir().unwrap().join("gamevault-settings.json")
}

#[tauri::command]
pub(crate) fn get_start_minimized(app: tauri::AppHandle) -> bool {
  let path = settings_path(&app);
  if path.exists() {
    if let Ok(data) = std::fs::read_to_string(&path) {
      if let Ok(settings) = serde_json::from_str::<AppSettings>(&data) {
        return settings.start_minimized;
      }
    }
  }
  false
}

#[tauri::command]
pub(crate) fn set_start_minimized(app: tauri::AppHandle, minimized: bool) -> Result<(), String> {
  let path = settings_path(&app);
  if let Some(parent) = path.parent() {
    std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create config dir: {}", e))?;
  }
  let settings = AppSettings { start_minimized: minimized };
  let data = serde_json::to_string_pretty(&settings).map_err(|e| format!("Failed to serialize: {}", e))?;
  std::fs::write(&path, &data).map_err(|e| format!("Failed to write config: {}", e))
}
