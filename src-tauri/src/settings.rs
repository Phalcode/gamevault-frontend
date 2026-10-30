use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;
use tauri::Manager;

#[derive(Serialize, Deserialize, Default, Clone)]
pub(crate) struct AppSettings {
  /// Keep the window in the tray when the login autostart entry starts the
  /// app (`--minimized`). Manual launches always open the window.
  #[serde(default)]
  pub start_minimized: bool,
  /// Set once the login autostart entry has been rewritten with the arguments
  /// this build registers (`--minimized`). Entries written by older builds
  /// carried none, so they would open the window at login.
  #[serde(default)]
  pub autostart_args_synced: bool,
  #[serde(default)]
  pub minimize_on_game_launch: bool,
  #[serde(default)]
  pub ignored_executables: Vec<String>,
  #[serde(default)]
  pub ignore_list_initialized: bool,
  /// Base directory for Wine/Proton prefixes. When set, GameVault creates an
  /// isolated `<base>/<slug>` prefix per game/installer so the OS root drive
  /// stays clean. Empty/None falls back to umu's built-in default location.
  #[serde(default)]
  pub default_wine_prefix: Option<String>,
  /// WebKitGTK smooth-scrolling override (Linux). `None` = leave WebKit default.
  #[serde(default)]
  pub webkit_smooth_scroll: Option<bool>,
  /// WebKitGTK hardware-acceleration policy (Linux): "Always" / "OnDemand" / "Never".
  /// `None` = leave WebKit default.
  #[serde(default)]
  pub webkit_hw_accel_policy: Option<String>,
  /// Whether the launch log window opens automatically when a game starts.
  /// Logs are always recorded; this only controls the window.
  #[serde(default)]
  pub always_show_launch_logs: bool,
  /// Pre-release channel ("unstable" or "early-access") whose one-time launch
  /// warning has already been acknowledged on this installation.
  ///
  /// This is kept in the app settings file instead of the webview's
  /// localStorage, because the webview data folder is cleared by the
  /// installer on updates - which made the warning reappear after each one.
  #[serde(default)]
  pub prerelease_notice_channel: Option<String>,
  /// Verbose diagnostics logging (Developer Tools).
  ///
  /// When off (the default), the diagnostics watchdog does not write its
  /// periodic interface snapshot to the app log. Hang detection and the
  /// automatic recovery reload stay active either way.
  #[serde(default)]
  pub diagnostics_verbose: bool,
  /// Anonymous usage analytics consent. `None` means the user never chose, which
  /// defaults to enabled (opt-out).
  ///
  /// Lives here instead of the webview's localStorage because the installer
  /// clears that folder on updates, which would silently opt users back in.
  #[serde(default)]
  pub analytics_enabled: Option<bool>,
  /// Unix timestamp of the last watchdog reload. Written before the webview is
  /// reloaded (the frozen UI cannot report it) and read once on the next boot.
  #[serde(default)]
  pub watchdog_recovery_at: Option<u64>,
  /// Language the desktop interface is machine-translated into (`None` = off,
  /// English). Kept here instead of the webview's localStorage because the
  /// installer clears that folder on updates.
  #[serde(default)]
  pub interface_translation_language: Option<String>,
}

#[derive(Serialize, Clone)]
pub(crate) struct IgnoreListState {
  pub ignored: Vec<String>,
  pub initialized: bool,
}

pub(crate) fn settings_path(app: &tauri::AppHandle) -> PathBuf {
  app.path().app_data_dir().unwrap().join("gamevault-settings.json")
}

/// Last parsed settings, keyed by the file's modification time.
///
/// The time tracker reads the ignore list every 60 s tick; re-reading and
/// parsing the JSON from disk every time is pure overhead.
static SETTINGS_CACHE: OnceLock<Mutex<Option<(u64, AppSettings)>>> = OnceLock::new();

fn settings_cache() -> &'static Mutex<Option<(u64, AppSettings)>> {
  SETTINGS_CACHE.get_or_init(|| Mutex::new(None))
}

fn settings_modified_ms(path: &std::path::Path) -> u64 {
  std::fs::metadata(path)
    .and_then(|metadata| metadata.modified())
    .ok()
    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
    .map(|duration| duration.as_millis() as u64)
    .unwrap_or(0)
}

pub(crate) fn load_settings(app: &tauri::AppHandle) -> AppSettings {
  let path = settings_path(app);
  let modified = settings_modified_ms(&path);

  if modified != 0 {
    if let Ok(cache) = settings_cache().lock() {
      if let Some((cached_modified, settings)) = cache.as_ref() {
        if *cached_modified == modified {
          return settings.clone();
        }
      }
    }
  }

  let settings = if path.exists() {
    std::fs::read_to_string(&path)
      .ok()
      .and_then(|data| serde_json::from_str::<AppSettings>(&data).ok())
      .unwrap_or_default()
  } else {
    AppSettings::default()
  };

  if modified != 0 {
    if let Ok(mut cache) = settings_cache().lock() {
      *cache = Some((modified, settings.clone()));
    }
  }

  settings
}

pub(crate) fn save_settings(app: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
  let path = settings_path(app);
  if let Some(parent) = path.parent() {
    std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create config dir: {}", e))?;
  }
  let data = serde_json::to_string_pretty(settings).map_err(|e| format!("Failed to serialize: {}", e))?;
  std::fs::write(&path, &data).map_err(|e| format!("Failed to write config: {}", e))?;

  // Update the cache in place so the next reader does not re-parse the file.
  if let Ok(mut cache) = settings_cache().lock() {
    *cache = Some((settings_modified_ms(&path), settings.clone()));
  }
  Ok(())
}

#[tauri::command]
pub(crate) async fn get_start_minimized(app: tauri::AppHandle) -> bool {
  load_settings(&app).start_minimized
}
#[tauri::command]
pub(crate) async fn set_start_minimized(app: tauri::AppHandle, minimized: bool) -> Result<(), String> {
  let mut settings = load_settings(&app);
  settings.start_minimized = minimized;
  save_settings(&app, &settings)
}

/// Whether the login autostart entry already carries `--minimized`.
pub(crate) fn autostart_args_synced(app: &tauri::AppHandle) -> bool {
  load_settings(app).autostart_args_synced
}

pub(crate) fn mark_autostart_args_synced(app: &tauri::AppHandle) -> Result<(), String> {
  let mut settings = load_settings(app);
  settings.autostart_args_synced = true;
  save_settings(app, &settings)
}

/// Whether the user opted out of anonymous usage analytics. `None` until they
/// chose for the first time, which counts as enabled.
#[tauri::command]
pub(crate) async fn get_analytics_enabled(app: tauri::AppHandle) -> Option<bool> {
  load_settings(&app).analytics_enabled
}

#[tauri::command]
pub(crate) async fn set_analytics_enabled(
  app: tauri::AppHandle,
  enabled: bool,
) -> Result<(), String> {
  let mut settings = load_settings(&app);
  settings.analytics_enabled = Some(enabled);
  save_settings(&app, &settings)
}

/// Records that the watchdog had to reload the webview to recover it.
///
/// The frozen UI cannot send this itself, so the marker is written before the
/// reload and reported by the next frontend boot.
pub(crate) fn mark_watchdog_recovery(app: &tauri::AppHandle) {
  let mut settings = load_settings(app);
  settings.watchdog_recovery_at = std::time::SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .ok()
    .map(|duration| duration.as_secs());
  let _ = save_settings(app, &settings);
}

/// Returns the timestamp of the last watchdog reload and clears the marker, so
/// every recovery is reported exactly once.
#[tauri::command]
pub(crate) async fn take_watchdog_recovery(app: tauri::AppHandle) -> Option<u64> {
  let mut settings = load_settings(&app);
  let value = settings.watchdog_recovery_at.take();
  if value.is_some() {
    let _ = save_settings(&app, &settings);
  }
  value
}

#[tauri::command]
pub(crate) async fn get_minimize_on_game_launch(app: tauri::AppHandle) -> bool {
  load_settings(&app).minimize_on_game_launch
}

#[tauri::command]
pub(crate) async fn set_minimize_on_game_launch(
  app: tauri::AppHandle,
  minimize_on_launch: bool,
) -> Result<(), String> {
  let mut settings = load_settings(&app);
  settings.minimize_on_game_launch = minimize_on_launch;
  save_settings(&app, &settings)
}

#[tauri::command]
pub(crate) async fn get_ignore_list(app: tauri::AppHandle) -> IgnoreListState {
  let settings = load_settings(&app);
  IgnoreListState {
    ignored: settings.ignored_executables,
    initialized: settings.ignore_list_initialized,
  }
}

#[tauri::command]
pub(crate) async fn set_ignore_list(app: tauri::AppHandle, ignored: Vec<String>) -> Result<(), String> {
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

#[tauri::command]
pub(crate) async fn get_prerelease_notice_channel(app: tauri::AppHandle) -> Option<String> {
  load_settings(&app).prerelease_notice_channel
}
/// Records the pre-release channel whose warning was acknowledged. `None`
/// clears it, which makes the warning show up again on the next launch.
#[tauri::command]
pub(crate) async fn set_prerelease_notice_channel(
  app: tauri::AppHandle,
  channel: Option<String>,
) -> Result<(), String> {
  let mut settings = load_settings(&app);
  settings.prerelease_notice_channel = channel
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());
  save_settings(&app, &settings)
}

/// Language the desktop interface is translated into, or `None` when the
/// translation is off.
#[tauri::command]
pub(crate) async fn get_interface_translation_language(app: tauri::AppHandle) -> Option<String> {
  load_settings(&app).interface_translation_language
}
/// Stores the interface translation language. `None` and `"off"` both disable
/// the translation and are stored as `None`.
#[tauri::command]
pub(crate) async fn set_interface_translation_language(
  app: tauri::AppHandle,
  language: Option<String>,
) -> Result<(), String> {
  let mut settings = load_settings(&app);
  settings.interface_translation_language = language
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty() && value != "off");
  save_settings(&app, &settings)
}

#[tauri::command]
pub(crate) async fn get_default_wine_prefix(app: tauri::AppHandle) -> Option<String> {
  load_settings(&app).default_wine_prefix
}

#[tauri::command]
pub(crate) async fn set_default_wine_prefix(
  app: tauri::AppHandle,
  prefix: Option<String>,
) -> Result<(), String> {
  let mut settings = load_settings(&app);
  let trimmed = prefix
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());
  settings.default_wine_prefix = trimmed;
  save_settings(&app, &settings)
}

/// Whether the launch log window should open automatically on game start.
#[tauri::command]
pub(crate) async fn get_always_show_launch_logs(app: tauri::AppHandle) -> bool {
  load_settings(&app).always_show_launch_logs
}

#[tauri::command]
pub(crate) async fn set_always_show_launch_logs(
  app: tauri::AppHandle,
  enabled: bool,
) -> Result<(), String> {
  let mut settings = load_settings(&app);
  settings.always_show_launch_logs = enabled;
  save_settings(&app, &settings)
}

/// Whether the verbose diagnostics logging is enabled (Developer Tools).
#[tauri::command]
pub(crate) async fn get_diagnostics_verbose(app: tauri::AppHandle) -> bool {
  load_settings(&app).diagnostics_verbose
}

#[tauri::command]
pub(crate) async fn set_diagnostics_verbose(
  app: tauri::AppHandle,
  enabled: bool,
) -> Result<(), String> {
  crate::frontend_watchdog::set_verbose(enabled);
  let mut settings = load_settings(&app);
  settings.diagnostics_verbose = enabled;
  save_settings(&app, &settings)
}
