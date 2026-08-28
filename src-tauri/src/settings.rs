use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Serialize, Deserialize, Default)]
pub(crate) struct AppSettings {
  #[serde(default)]
  pub start_minimized: bool,
  #[serde(default)]
  pub ignored_executables: Vec<String>,
  #[serde(default)]
  pub ignore_list_initialized: bool,
}

#[derive(Serialize, Clone)]
pub(crate) struct IgnoreListState {
  pub ignored: Vec<String>,
  pub initialized: bool,
}

pub(crate) fn settings_path(app: &tauri::AppHandle) -> PathBuf {
  app.path().app_data_dir().unwrap().join("gamevault-settings.json")
}

pub(crate) fn load_settings(app: &tauri::AppHandle) -> AppSettings {
  let path = settings_path(app);
  if path.exists() {
    if let Ok(data) = std::fs::read_to_string(&path) {
      if let Ok(settings) = serde_json::from_str::<AppSettings>(&data) {
        return settings;
      }
    }
  }
  AppSettings::default()
}

pub(crate) fn save_settings(app: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
  let path = settings_path(app);
  if let Some(parent) = path.parent() {
    std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create config dir: {}", e))?;
  }
  let data = serde_json::to_string_pretty(settings).map_err(|e| format!("Failed to serialize: {}", e))?;
  std::fs::write(&path, &data).map_err(|e| format!("Failed to write config: {}", e))
}

#[tauri::command]
pub(crate) fn get_start_minimized(app: tauri::AppHandle) -> bool {
  load_settings(&app).start_minimized
}

#[tauri::command]
pub(crate) fn set_start_minimized(app: tauri::AppHandle, minimized: bool) -> Result<(), String> {
  let mut settings = load_settings(&app);
  settings.start_minimized = minimized;
  save_settings(&app, &settings)
}

#[tauri::command]
pub(crate) fn get_ignore_list(app: tauri::AppHandle) -> IgnoreListState {
  let settings = load_settings(&app);
  IgnoreListState {
    ignored: settings.ignored_executables,
    initialized: settings.ignore_list_initialized,
  }
}

#[tauri::command]
pub(crate) fn set_ignore_list(app: tauri::AppHandle, ignored: Vec<String>) -> Result<(), String> {
  let mut settings = load_settings(&app);

  let mut seen = HashSet::new();
  let mut clean = Vec::new();
  for name in ignored {
    let trimmed = name.trim();
    if trimmed.is_empty() {
      continue;
    }
    let key = trimmed.to_lowercase();
    if seen.insert(key) {
      clean.push(trimmed.to_string());
    }
  }

  settings.ignored_executables = clean;
  settings.ignore_list_initialized = true;
  save_settings(&app, &settings)
}
