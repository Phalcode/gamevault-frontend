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

use tauri::Manager;
use tauri::tray::{TrayIconBuilder, MouseButton, MouseButtonState, TrayIconEvent};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use crate::settings::AppSettings;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_autostart::init(Default::default(), None))
    .setup(|app| {
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
      games::list_launch_executables,
      games::launch_game,
      time_tracker::start_game_time_tracker,
      time_tracker::stop_game_time_tracker,
      time_tracker::update_tracker_auth,
      fs_commands::fs_read_text_file,
      fs_commands::fs_write_text_file,
      fs_commands::fs_create_dir_all,
      fs_commands::fs_path_exists,
      fs_commands::fs_remove,
      cache::cache_game_data,
      cache::cache_game_image,
      cache::load_cached_game,
      cache::load_cached_image,
      cache::list_cached_game_ids,
      cache::delete_cached_game,
      cache::delete_cached_image,
      time_tracker::get_offline_time_files,
      time_tracker::delete_offline_time_file,
      time_tracker::sync_offline_time,
      settings::get_start_minimized,
      settings::set_start_minimized
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
