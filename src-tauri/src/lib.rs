mod state;
mod events;
mod util;
mod downloads;
mod extraction;
mod installation;
mod games;
mod fs_commands;
mod time_tracker;
mod cache;
mod settings;
mod net;
mod youtube;
mod taskbar;
mod umu;

use crate::settings::AppSettings;
use semver::Version;
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::path::BaseDirectory;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;
use url::Url;

const STABLE_UPDATER_ENDPOINT: &str = "https://github.com/Phalcode/gamevault-frontend/releases/latest/download/latest.json";
const UNSTABLE_UPDATER_ENDPOINT: &str = "https://github.com/Phalcode/gamevault-frontend/releases/download/unstable/unstable.json";
const EARLY_ACCESS_UPDATER_ENDPOINT: &str = "https://github.com/Phalcode/gamevault-frontend/releases/download/early-access/early-access.json";
const APP_UPDATER_EVENT: &str = "app-updater-progress";
const UPDATER_STATE_PATH: &str = "updater-state.json";

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum UpdateChannel {
  Stable,
  EarlyAccess,
  Unstable,
}

impl UpdateChannel {
  fn endpoint(self) -> &'static str {
    match self {
      Self::Stable => STABLE_UPDATER_ENDPOINT,
      Self::EarlyAccess => EARLY_ACCESS_UPDATER_ENDPOINT,
      Self::Unstable => UNSTABLE_UPDATER_ENDPOINT,
    }
  }
}

#[derive(Debug, Deserialize, Serialize, Clone)]
struct UpdateState {
  channel: UpdateChannel,
  version: String,
}

#[derive(Debug, Serialize)]
struct AvailableUpdate {
  version: String,
  body: Option<String>,
  current_version: String,
  channel: UpdateChannel,
}

#[derive(Debug, Serialize, Clone)]
struct AppUpdaterProgressEvent {
  event: String,
  content_length: Option<u64>,
  chunk_length: Option<usize>,
}

fn updater_public_key() -> Option<String> {
  option_env!("GV_TAURI_UPDATER_PUBKEY").and_then(|value| {
    let trimmed = value.trim();
    if trimmed.is_empty() {
      None
    } else {
      Some(trimmed.to_string())
    }
  })
}

#[tauri::command]
fn is_updater_enabled() -> bool {
  updater_public_key().is_some()
}

fn update_state_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
  app.path()
    .resolve(UPDATER_STATE_PATH, BaseDirectory::AppData)
    .map_err(|error| format!("Failed to resolve updater state path: {error}"))
}

fn read_update_state(app: &AppHandle) -> Option<UpdateState> {
  let path = update_state_path(app).ok()?;
  let data = fs::read_to_string(path).ok()?;
  serde_json::from_str::<UpdateState>(&data).ok()
}

fn write_update_state(app: &AppHandle, state: &UpdateState) -> Result<(), String> {
  let path = update_state_path(app)?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent)
      .map_err(|error| format!("Failed to create updater state directory: {error}"))?;
  }

  let data = serde_json::to_string_pretty(state)
    .map_err(|error| format!("Failed to serialize updater state: {error}"))?;
  fs::write(path, data).map_err(|error| format!("Failed to write updater state: {error}"))
}

fn delete_update_state(app: &AppHandle) -> Result<(), String> {
  let path = update_state_path(app)?;
  match fs::remove_file(path) {
    Ok(()) => Ok(()),
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
    Err(error) => Err(format!("Failed to delete updater state: {error}")),
  }
}

fn normalize_version_string(value: &str) -> String {
  value.trim().trim_start_matches(['v', 'V']).to_string()
}

fn build_version_comparator(
  channel: UpdateChannel,
  state: Option<UpdateState>,
) -> impl Fn(Version, tauri_plugin_updater::RemoteRelease) -> bool + Send + Sync + 'static {
  move |current, release| {
    let current_version = current.to_string();
    let matching_state = state
      .as_ref()
      .filter(|value| normalize_version_string(&value.version) == current_version);

    if release.version > current {
      return true;
    }

    let same_core = current.major == release.version.major
      && current.minor == release.version.minor
      && current.patch == release.version.patch;

    match channel {
      // Switching back to a less-experimental channel stays allowed even when
      // it is not semver-newer (e.g. the app was previously installed from a
      // prerelease channel).
      UpdateChannel::Stable => matching_state
        .is_some_and(|value| value.channel != UpdateChannel::Stable),
      // Prerelease channels (early-access and unstable) are offered when the
      // running build is the plain release of the same core, i.e. switching
      // from stable up into a prerelease channel. Otherwise semver decides.
      UpdateChannel::EarlyAccess | UpdateChannel::Unstable => {
        current.pre.is_empty() && !release.version.pre.is_empty() && same_core
      }
    }
  }
}

async fn resolve_update_for_channel(
  app: &AppHandle,
  channel: UpdateChannel,
) -> Result<Option<tauri_plugin_updater::Update>, String> {
  if updater_public_key().is_none() {
    return Err("This desktop build does not have a Tauri updater public key configured yet.".to_string());
  }

  let endpoint = Url::parse(channel.endpoint())
    .map_err(|error| format!("Failed to parse updater endpoint: {error}"))?;
  let state = read_update_state(app);

  let updater = app
    .updater_builder()
    .version_comparator(build_version_comparator(channel, state))
    .endpoints(vec![endpoint])
    .map_err(|error| format!("Failed to configure updater endpoint: {error}"))?
    .build()
    .map_err(|error| format!("Failed to build updater: {error}"))?;

  updater
    .check()
    .await
    .map_err(|error| format!("Failed to check for updates: {error}"))
}

#[tauri::command]
async fn check_for_app_update(
  app: AppHandle,
  channel: UpdateChannel,
) -> Result<Option<AvailableUpdate>, String> {
  let update = resolve_update_for_channel(&app, channel).await?;

  Ok(update.map(|value| AvailableUpdate {
    version: value.version.clone(),
    body: value.body.clone(),
    current_version: value.current_version.clone(),
    channel,
  }))
}

#[tauri::command]
async fn download_and_install_app_update(
  app: AppHandle,
  channel: UpdateChannel,
) -> Result<Option<String>, String> {
  let Some(update) = resolve_update_for_channel(&app, channel).await? else {
    return Ok(None);
  };

  let progress_app = app.clone();
  let mut emitted_start = false;
  let bytes = update
    .download(
      move |chunk_length, content_length| {
        if !emitted_start {
          emitted_start = true;
          let _ = progress_app.emit(
            APP_UPDATER_EVENT,
            AppUpdaterProgressEvent {
              event: "Started".to_string(),
              content_length,
              chunk_length: None,
            },
          );
        }

        let _ = progress_app.emit(
          APP_UPDATER_EVENT,
          AppUpdaterProgressEvent {
            event: "Progress".to_string(),
            content_length,
            chunk_length: Some(chunk_length),
          },
        );
      },
      || {},
    )
    .await
    .map_err(|error| format!("Failed to download update: {error}"))?;

  let _ = app.emit(
    APP_UPDATER_EVENT,
    AppUpdaterProgressEvent {
      event: "Installing".to_string(),
      content_length: None,
      chunk_length: None,
    },
  );

  let previous_state = read_update_state(&app);
  let next_state = UpdateState {
    channel,
    version: update.version.clone(),
  };
  write_update_state(&app, &next_state)?;

  if let Err(error) = update.install(bytes) {
    if let Some(state) = previous_state.as_ref() {
      let _ = write_update_state(&app, state);
    } else {
      let _ = delete_update_state(&app);
    }

    return Err(format!("Failed to install update: {error}"));
  }

  let _ = app.emit(
    APP_UPDATER_EVENT,
    AppUpdaterProgressEvent {
      event: "Finished".to_string(),
      content_length: None,
      chunk_length: None,
    },
  );

  Ok(Some(update.version.clone()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default()
    // Must be the first plugin: when a second instance is launched it is
    // killed here and only the existing instance receives this callback,
    // which brings its window back to the foreground.
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
      }
    }))
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_autostart::init(Default::default(), None));

  if let Some(pubkey) = updater_public_key() {
    builder = builder.plugin(
      tauri_plugin_updater::Builder::new()
        .pubkey(pubkey)
        .build(),
    );
  }

  builder
    .setup(|app| {
      // Serve YouTube embed pages over a loopback HTTP origin so they keep
      // working in packaged builds (tauri-apps/tauri#14422).
      youtube::start_embed_server();

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // ── System tray with Show / Quit menu ──────────────────────────────

      let show_item = MenuItemBuilder::with_id("show", "Show").build(app)?;
      let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
      let menu = MenuBuilder::new(app)
        .item(&show_item)
        .item(&quit_item)
        .build()?;

      let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .on_menu_event(|app, event| {
          match event.id.as_ref() {
            "show" => {
              if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
              }
            }
            "quit" => {
              app.exit(0);
            }
            _ => {}
          }
        })
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
          } = event
          {
            let app = tray.app_handle();
            if let Some(window) = app.get_webview_window("main") {
              if window.is_visible().unwrap_or(false) {
                let _ = window.hide();
              } else {
                let _ = window.show();
                let _ = window.set_focus();
              }
            }
          }
        })
        .build(app)?;

      // ── Close-to-tray: intercept window close, hide instead of quit ────

      if let Some(window) = app.get_webview_window("main") {
        let window_handle = window.clone();
        window.on_window_event(move |event| {
          if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window_handle.hide();
          }
        });
      }

      // ── Conditionally hide window at startup ───────────────────────────

      {
        let path = app.path().app_data_dir().unwrap().join("gamevault-settings.json");
        let start_minimized = if path.exists() {
          std::fs::read_to_string(&path)
            .ok()
            .and_then(|data| serde_json::from_str::<AppSettings>(&data).ok())
            .map(|s| s.start_minimized)
            .unwrap_or(false)
        } else {
          false
        };

        if start_minimized {
          if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
          }
        }
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      games::open_in_file_explorer,
      games::open_external_url,
      youtube::youtube_embed_base,
      extraction::extract_archive,
      installation::list_install_executables,
      installation::copy_installation_files,
      installation::launch_installation_executable,
      installation::launch_uninstall_executable,
      downloads::download_game_version,
      downloads::cancel_download_task,
      downloads::pause_download_task,
      downloads::recover_download_cards,
      games::list_installed_games,
      games::get_disk_usage,
      games::list_launch_executables,
      games::make_script_executable,
      games::launch_game,
      time_tracker::start_game_time_tracker,
      time_tracker::stop_game_time_tracker,
      time_tracker::update_tracker_auth,
      fs_commands::fs_read_text_file,
      fs_commands::fs_write_text_file,
      fs_commands::fs_create_dir_all,
      fs_commands::fs_path_exists,
      fs_commands::fs_remove,
      fs_commands::remove_empty_directories,
      net::fetch_url_bytes,
      net::fs_read_binary_file,
      cache::cache_game_data,
      cache::cache_game_image,
      cache::load_cached_game,
      cache::load_cached_image,
      cache::cleanup_cached_images,
      cache::list_cached_game_ids,
      cache::delete_cached_game,
      cache::delete_cached_image,
      cache::clear_all_cached_images,
      time_tracker::get_offline_time_files,
      time_tracker::delete_offline_time_file,
      time_tracker::sync_offline_time,
      time_tracker::debug_tracker_scan,
      settings::get_start_minimized,
      settings::set_start_minimized,
      settings::get_minimize_on_game_launch,
      settings::set_minimize_on_game_launch,
      settings::get_ignore_list,
      settings::set_ignore_list,
      taskbar::set_taskbar_progress,
      taskbar::clear_taskbar_progress,
      umu::umu_status,
      umu::install_umu_launcher,
      is_updater_enabled,
      check_for_app_update,
      download_and_install_app_update
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
