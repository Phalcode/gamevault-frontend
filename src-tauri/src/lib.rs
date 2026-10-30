mod state;
mod events;
mod util;
mod executables;
mod downloads;
mod launch_mode;
mod user_agent;
mod analytics_forward;
mod extraction;
mod installation;
mod jumplist;
mod launch_log;
mod desktop_shortcut;
mod tracker_log;
mod games;
mod fs_commands;
mod time_tracker;
mod cache;
mod settings;
mod bergamot_models;
mod secure_store;
mod net;
mod youtube;
mod taskbar;
mod tray;
mod umu;
mod rendering;
mod frontend_watchdog;

use semver::Version;
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartManagerExt};
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

fn default_build_channel() -> UpdateChannel {
  match option_env!("GV_BUILD_CHANNEL") {
    Some("early-access") => UpdateChannel::EarlyAccess,
    Some("unstable") => UpdateChannel::Unstable,
    _ => UpdateChannel::Stable,
  }
}

fn build_version_comparator(
  channel: UpdateChannel,
  state: Option<UpdateState>,
) -> impl Fn(Version, tauri_plugin_updater::RemoteRelease) -> bool + Send + Sync + 'static {
  move |current, release| {
    // Determine the channel the running build came from. The persisted state is
    // written after every in-app install (channel + version), so it is the
    // authoritative source when its version matches the running one; otherwise
    // fall back to the channel this binary was built for (fresh installs).
    let current_channel = state
      .as_ref()
      .filter(|value| normalize_version_string(&value.version) == current.to_string())
      .map(|value| value.channel)
      .unwrap_or_else(default_build_channel);

    should_offer_release(&current, &release.version, channel, current_channel)
  }
}

/// Core decision for whether a release on the requested channel should be
/// offered to update to. Kept as a pure helper so the channel-switch and
/// downgrade rules are unit-testable.
fn should_offer_release(
  current: &Version,
  release: &Version,
  channel: UpdateChannel,
  current_channel: UpdateChannel,
) -> bool {
  // Switching to a different channel is intentional and always allowed, even
  // when the target release is older (a downgrade). The endpoint only lists
  // releases for the requested channel, so this surfaces that channel's latest
  // build. Skip only when it happens to equal the version currently running.
  if current_channel != channel {
    return release != current;
  }

  // Staying on the same channel: only surface genuinely newer releases.
  release > current
}

#[cfg(test)]
mod tests {
  use super::*;
  use semver::Version;

  fn v(value: &str) -> Version {
    Version::parse(value).unwrap()
  }

  #[test]
  fn same_channel_only_offers_newer() {
    assert!(should_offer_release(
      &v("17.1.0"),
      &v("17.2.0"),
      UpdateChannel::Stable,
      UpdateChannel::Stable,
    ));
    assert!(!should_offer_release(
      &v("17.1.0"),
      &v("17.1.0"),
      UpdateChannel::Stable,
      UpdateChannel::Stable,
    ));
    assert!(!should_offer_release(
      &v("17.2.0"),
      &v("17.1.0"),
      UpdateChannel::Stable,
      UpdateChannel::Stable,
    ));
  }

  #[test]
  fn switching_channels_allows_downgrade() {
    // From a newer unstable build back down to stable.
    assert!(should_offer_release(
      &v("18.0.0-alpha.1"),
      &v("17.1.0"),
      UpdateChannel::Stable,
      UpdateChannel::Unstable,
    ));
    // From a newer unstable build down to early-access.
    assert!(should_offer_release(
      &v("18.0.0-alpha.1"),
      &v("17.1.1-beta.1"),
      UpdateChannel::EarlyAccess,
      UpdateChannel::Unstable,
    ));
    // From stable up into a prerelease channel.
    assert!(should_offer_release(
      &v("17.1.0"),
      &v("17.1.1-beta.1"),
      UpdateChannel::EarlyAccess,
      UpdateChannel::Stable,
    ));
  }

  #[test]
  fn switching_to_identical_version_is_skipped() {
    assert!(!should_offer_release(
      &v("17.1.0"),
      &v("17.1.0"),
      UpdateChannel::Stable,
      UpdateChannel::Unstable,
    ));
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
  // A reloaded page can ask again while the update task started earlier keeps
  // running. Downloading the update twice (and installing it twice) would be a
  // mess, so refuse while one is already in flight.
  if crate::state::app_update_snapshot()
    .map(|snapshot| snapshot.status == "downloading" || snapshot.status == "installing")
    .unwrap_or(false)
  {
    return Err("An update is already being downloaded or installed.".to_string());
  }

  crate::state::set_app_update_snapshot(Some(crate::state::AppUpdateSnapshot {
    status: "downloading".to_string(),
    version: None,
    error: None,
  }));

  match run_app_update(app, channel).await {
    Ok(version) => {
      crate::state::set_app_update_snapshot(Some(crate::state::AppUpdateSnapshot {
        status: "finished".to_string(),
        version: version.clone(),
        error: None,
      }));
      Ok(version)
    }
    Err(error) => {
      crate::state::set_app_update_snapshot(Some(crate::state::AppUpdateSnapshot {
        status: "error".to_string(),
        version: None,
        error: Some(error.clone()),
      }));
      Err(error)
    }
  }
}

/// State of everything that keeps running in the background (downloads,
/// extractions, installations, umu setup, app updates).
///
/// The frontend calls this right after loading so it can re-attach to work that
/// is still in flight, and pick up results that finished while its page was
/// reloaded or the app was restarted.
#[tauri::command]
fn get_background_states() -> crate::state::BackgroundStates {
  crate::state::background_states()
}

async fn run_app_update(app: AppHandle, channel: UpdateChannel) -> Result<Option<String>, String> {
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

/// Replaces the webview's browser user agent with the product one, so API
/// requests, server logs and analytics can identify the desktop client.
fn apply_webview_user_agent<R: tauri::Runtime>(context: &mut tauri::Context<R>) {
  let agent = user_agent::frontend_user_agent(
    &context.package_info().version.to_string(),
    &user_agent::platform_token(),
  );
  for window in &mut context.config_mut().app.windows {
    window.user_agent = Some(agent.clone());
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut context = tauri::generate_context!();
  apply_webview_user_agent(&mut context);

  // The Windows taskbar jump list is keyed on this id, so it has to be set
  // before the first window appears.
  jumplist::set_process_app_id(&context.config().identifier);

  // Jump list and "open with" entries start the app again with a flag.
  // Queue them before the frontend asks for work, so a cold start still
  // launches the requested game / opens the requested page.
  for action in tray::actions_from_args(std::env::args()) {
    tray::queue(action);
  }

  let mut builder = tauri::Builder::default()
    // Must be the first plugin: when a second instance is launched it is
    // killed here and only the existing instance receives this callback,
    // which brings its window back to the foreground.
    .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
      // The second instance was very likely a jump list entry: hand its
      // request to the running app instead of dropping it.
      for action in tray::actions_from_args(args) {
        tray::queue_and_notify(app, action);
      }
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
      }
    }))
    // Registered after single-instance so a second instance's URL is forwarded
    // to this process (see the plugin's `deep-link` feature).
    .plugin(tauri_plugin_deep_link::init())
    // Visibility is owned by the launch logic in `setup`: restoring it from the
    // last session would show the window again on autostart, and a close-to-tray
    // exit would persist a hidden window that then never appears on launch.
    .plugin(
      tauri_plugin_window_state::Builder::default()
        .with_state_flags(
          tauri_plugin_window_state::StateFlags::all()
            & !tauri_plugin_window_state::StateFlags::VISIBLE,
        )
        .build(),
    )
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_opener::init())
    // The login entry carries `--minimized`, which is how a start from the OS is
    // told apart from a manual launch. Launch Agents (the default) keep the
    // argument; only the AppleScript mode would drop it.
    .plugin(tauri_plugin_autostart::init(
      MacosLauncher::LaunchAgent,
      Some(vec![launch_mode::MINIMIZED_FLAG]),
    ));

  if let Some(pubkey) = updater_public_key() {
    builder = builder.plugin(
      tauri_plugin_updater::Builder::new()
        .pubkey(pubkey)
        .build(),
    );
  }

  builder
    .setup(|app| {
      // ── Deep links ─────────────────────────────────────────────────────
      // Installers register `gamevault://` for packaged builds. Development
      // builds and AppImages (which are not integrated into the desktop
      // environment) need the scheme registered at runtime instead.
      #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
      {
        use tauri_plugin_deep_link::DeepLinkExt;
        if let Err(error) = app.deep_link().register_all() {
          log::warn!("failed to register deep link schemes: {error}");
        }
      }

      // Serve YouTube embed pages over a loopback HTTP origin so they keep
      // working in packaged builds (tauri-apps/tauri#14422).
      youtube::start_embed_server();

      // Stronghold: the official Tauri secret-store plugin. It keeps secrets
      // (the auth refresh token) encrypted at rest in a vault that works on
      // Windows, macOS and Linux. The salt file lives in the app data dir.
      let salt_path = app
        .path()
        .app_local_data_dir()
        .expect("could not resolve app local data path")
        .join("salt.txt");
      app.handle().plugin(
        tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build(),
      )?;

      // ── Persistent logging ─────────────────────────────────────────────
      // Always write a rotating log file into the OS log directory. Release
      // builds previously installed no logger at all, so a freeze or crash left
      // no trace to inspect. Debug builds also mirror everything to stdout.
      let mut log_targets = vec![tauri_plugin_log::Target::new(
        tauri_plugin_log::TargetKind::LogDir {
          file_name: Some(frontend_watchdog::LOG_FILE_NAME.to_string()),
        },
      )];
      if cfg!(debug_assertions) {
        log_targets.push(tauri_plugin_log::Target::new(
          tauri_plugin_log::TargetKind::Stdout,
        ));
      }
      app.handle().plugin(
        tauri_plugin_log::Builder::default()
          .level(log::LevelFilter::Info)
          .max_file_size(4 * 1024 * 1024)
          .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(3))
          .targets(log_targets)
          .build(),
      )?;

      if let Ok(log_dir) = app.path().app_log_dir() {
        log::info!(
          "logging to {}.log in {}",
          frontend_watchdog::LOG_FILE_NAME,
          log_dir.display()
        );
      }

      // ── Frontend responsiveness watchdog ───────────────────────────────
      // Records webview hangs from the Rust side, because a frozen webview
      // cannot log its own freeze. See `frontend_watchdog`.
      frontend_watchdog::set_verbose(settings::load_settings(app.handle()).diagnostics_verbose);
      frontend_watchdog::start_watchdog(app.handle().clone());

      // ── Time tracker diagnostics log ───────────────────────────────────
      // Records every tracker tick, match transition and credit outcome.
      // Disabled for now via `tracker_log::ENABLED`; the tracker keeps its
      // counters in memory either way.
      tracker_log::init(app.handle());

      // ── System tray: quick actions, recents, now-playing indicator ─────

      tray::create(app.handle())?;

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

      // ── Window visibility on launch ───────────────────────────────────
      //
      // The window is created hidden (`visible: false` in tauri.conf.json), so
      // the autostart path never flashes a window. It only stays hidden when
      // the login entry started us *and* the user enabled "start minimized";
      // a manual launch always opens the window.
      if let Some(window) = app.get_webview_window("main") {
        let start_in_tray = launch_mode::requested_start_minimized(std::env::args())
          && settings::load_settings(app.handle()).start_minimized;

        if !start_in_tray {
          let _ = window.show();
          let _ = window.set_focus();
        }
      }

      // ── One-time autostart entry migration ─────────────────────────────
      //
      // Builds before `--minimized` registered the entry without arguments, so
      // an already enabled autostart would now open the window at login.
      // Rewrite it once; doing this on every launch would also re-enable an
      // entry the user switched off in the OS' own startup settings.
      if !settings::autostart_args_synced(app.handle()) {
        let autolaunch = app.autolaunch();
        if autolaunch.is_enabled().unwrap_or(false) {
          let _ = autolaunch.enable();
        }
        let _ = settings::mark_autostart_args_synced(app.handle());
      }

      // ── Apply persisted WebKitGTK rendering settings (Linux) ──────────
      #[cfg(target_os = "linux")]
      rendering::apply_webkit_settings(app.handle());

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      games::open_in_file_explorer,
      games::open_external_url,
      util::open_devtools,
      youtube::youtube_embed_base,
      extraction::extract_archive,
      get_background_states,
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
      fs_commands::fs_has_leftover_content,
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
      time_tracker::get_tracker_status,
      time_tracker::reset_tracker_ledger,
      tracker_log::get_tracker_log,
      tracker_log::clear_tracker_log,
      tracker_log::open_tracker_log_folder,
      tracker_log::read_tracker_log_file,
      tracker_log::tracker_log_line,
      settings::get_start_minimized,
      settings::set_start_minimized,
      settings::get_analytics_enabled,
      settings::set_analytics_enabled,
      settings::take_watchdog_recovery,
      analytics_forward::analytics_post,
      settings::get_minimize_on_game_launch,
      settings::set_minimize_on_game_launch,
      settings::get_ignore_list,
      settings::set_ignore_list,
      settings::get_default_wine_prefix,
      settings::set_default_wine_prefix,
      settings::get_prerelease_notice_channel,
      settings::set_prerelease_notice_channel,
      settings::get_interface_translation_language,
      settings::set_interface_translation_language,
      bergamot_models::bergamot_model_status,
      bergamot_models::bergamot_model_registry,
      bergamot_models::read_bergamot_model_plan,
      bergamot_models::read_bergamot_model_file,
      bergamot_models::download_bergamot_model,
      bergamot_models::delete_bergamot_model,
      settings::get_always_show_launch_logs,
      settings::set_always_show_launch_logs,
      settings::get_diagnostics_verbose,
      settings::set_diagnostics_verbose,
      rendering::get_rendering_diagnostics,
      rendering::get_webkit_settings,
      rendering::set_webkit_smooth_scrolling,
      rendering::set_webkit_hardware_acceleration_policy,
      frontend_watchdog::frontend_heartbeat,
      frontend_watchdog::get_diagnostics_log_path,
      secure_store::get_or_create_vault_password,
      taskbar::set_taskbar_progress,
      taskbar::clear_taskbar_progress,
      tray::set_tray_recent_games,
      tray::take_tray_actions,
      umu::umu_status,
      umu::install_umu_launcher,
      umu::resolve_windows_install_path,
      umu::resolve_game_wine_prefix,
      umu::delete_game_wine_prefix,
      umu::list_proton_builds,
      launch_log::get_launch_log,
      launch_log::list_launch_logs,
      launch_log::open_launch_log_window,
      launch_log::open_launch_log_folder,
      desktop_shortcut::create_desktop_shortcut,
      desktop_shortcut::remove_desktop_shortcuts,
      launch_log::clear_launch_logs,
      launch_log::read_launch_log_file,
      is_updater_enabled,
      check_for_app_update,
      download_and_install_app_update
    ])
    .run(context)
    .expect("error while running tauri application");
}
