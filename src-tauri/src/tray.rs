//! System tray icon: quick actions, recently played games and a live
//! "now playing" indicator.
//!
//! The tray menu is rebuilt from a [`MenuModel`] whenever the model changes,
//! which is the only shape that works across all three desktop platforms: the
//! number of recently played entries varies, and menu items cannot be added or
//! removed on every toolkit.
//!
//! Who fills the model:
//!
//! - **Now playing** is owned by the native time tracker
//!   (`time_tracker.rs`), because it is the only component that knows when a
//!   game actually runs and for how long.
//! - **Recently played** is owned by the frontend, which knows which installed
//!   games the user actually played (it has the progress data).
//!
//! Menus are native, so "highlighting the running game green" means giving its
//! row a green play glyph — native menus cannot colour text on any platform.

use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tauri::image::Image;
use tauri::menu::{IconMenuItemBuilder, MenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Theme};

/// Event telling the frontend that actions are waiting to be picked up.
const ACTIONS_PENDING_EVENT: &str = "tray-actions-pending";

/// Command-line flag a jump list entry uses to ask for a page.
pub(crate) const ARG_NAVIGATE: &str = "--gv-navigate";
/// Command-line flag a jump list entry uses to ask for a game launch.
pub(crate) const ARG_LAUNCH_GAME: &str = "--gv-launch-game";

/// Id under which the tray icon is registered, so updates can find it again.
const TRAY_ID: &str = "gamevault-tray";

/// Main window label.
const MAIN_WINDOW: &str = "main";

/// Edge length of the generated menu glyphs. Comfortably above the menu icon
/// size of every platform so HiDPI displays stay crisp.
const MENU_ICON_SIZE: u32 = 32;

/// At most this many recently played games are offered.
const RECENT_GAME_LIMIT: usize = 5;

/// Pages the tray menu and the jump list can jump to.
pub(crate) const PAGES: [&str; 4] = ["library", "downloads", "community", "settings"];

/// Human-readable name of a page, for menus that show text.
pub(crate) fn page_title(page: &str) -> String {
  let mut characters = page.chars();
  match characters.next() {
    Some(first) => first.to_uppercase().collect::<String>() + characters.as_str(),
    None => String::new(),
  }
}

/// Menu id and glyph for a page.
fn page_menu_entry(page: &str) -> (&'static str, Glyph) {
  match page {
    "library" => (ID_NAV_LIBRARY, Glyph::Library),
    "downloads" => (ID_NAV_DOWNLOADS, Glyph::Downloads),
    "community" => (ID_NAV_COMMUNITY, Glyph::Community),
    _ => (ID_NAV_SETTINGS, Glyph::Settings),
  }
}

/// Longest title shown in the menu before it is elided.
const TITLE_MAX_CHARS: usize = 44;

/// Menu item ids.
const ID_NOW_PLAYING: &str = "tray-now-playing";
const ID_SHOW: &str = "tray-show";
const ID_RESTART: &str = "tray-restart";
const ID_QUIT: &str = "tray-quit";
const ID_NAV_LIBRARY: &str = "tray-nav-library";
const ID_NAV_DOWNLOADS: &str = "tray-nav-downloads";
const ID_NAV_COMMUNITY: &str = "tray-nav-community";
const ID_NAV_SETTINGS: &str = "tray-nav-settings";
/// Prefix for the recently played entries; the game id follows.
const ID_GAME_PREFIX: &str = "tray-game:";

/// A game offered in the "recently played" section.
#[derive(Clone, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrayGame {
  pub game_id: i64,
  pub title: String,
}

/// The game that is currently running.
#[derive(Clone)]
pub(crate) struct NowPlaying {
  pub game_id: i64,
  pub title: String,
  /// Unix millis when the session started; 0 if unknown.
  pub started_at_ms: u64,
}

/// Everything the tray remembers between rebuilds.
#[derive(Default)]
struct TrayState {
  now_playing: Option<NowPlaying>,
  recent: Vec<TrayGame>,
  /// Actions the tray (or the Windows jump list) asked for that the frontend
  /// has not picked up yet. Queued rather than emitted because the sender may
  /// be a second process starting up while the webview is still loading.
  pending: Vec<TrayAction>,
  /// The model last pushed to the OS, used to skip redundant rebuilds (the
  /// tracker calls in once a minute, and rebuilding a native menu every minute
  /// would be wasteful).
  rendered: Option<MenuModel>,
}

/// Something the tray can ask the app to do.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
pub(crate) enum TrayAction {
  /// Switch to a page, e.g. `library`.
  Navigate(String),
  /// Launch the installed game with this id.
  LaunchGame(i64),
}

static TRAY_STATE: OnceLock<Mutex<TrayState>> = OnceLock::new();

fn tray_state() -> &'static Mutex<TrayState> {
  TRAY_STATE.get_or_init(|| Mutex::new(TrayState::default()))
}

/// Stores an action for the frontend to pick up.
///
/// Used for actions arriving before the app is up (jump list entries, a second
/// instance forwarding its command line), where there is nothing to emit to
/// yet: the frontend drains the queue when it mounts.
pub(crate) fn queue(action: TrayAction) {
  if let Ok(mut state) = tray_state().lock() {
    state.pending.push(action);
  }
}

/// Stores an action and wakes a frontend that is already running.
pub(crate) fn queue_and_notify(app: &AppHandle, action: TrayAction) {
  queue(action);
  let _ = app.emit(ACTIONS_PENDING_EVENT, ());
}

/// Hands every queued action to the frontend and empties the queue.
#[tauri::command]
pub(crate) fn take_tray_actions() -> Vec<TrayAction> {
  tray_state()
    .lock()
    .map(|mut state| std::mem::take(&mut state.pending))
    .unwrap_or_default()
}

/// Reads the tray actions out of a command line, ignoring everything else.
///
/// The Windows jump list cannot talk to a running app, so it starts the app
/// again with a flag and lets single-instance forwarding deliver it here.
pub(crate) fn actions_from_args<I, S>(args: I) -> Vec<TrayAction>
where
  I: IntoIterator<Item = S>,
  S: AsRef<str>,
{
  let args: Vec<String> = args
    .into_iter()
    .map(|arg| arg.as_ref().to_string())
    .collect();

  let mut actions = Vec::new();
  let mut index = 0;
  while index < args.len() {
    let flag = args[index].as_str();
    let value = args.get(index + 1);
    match (flag, value) {
      (ARG_NAVIGATE, Some(page)) if PAGES.contains(&page.as_str()) => {
        actions.push(TrayAction::Navigate(page.clone()));
        index += 2;
      }
      (ARG_LAUNCH_GAME, Some(game_id)) => {
        if let Ok(game_id) = game_id.parse::<i64>() {
          if game_id > 0 {
            actions.push(TrayAction::LaunchGame(game_id));
          }
        }
        index += 2;
      }
      _ => index += 1,
    }
  }
  actions
}

/// Which background the tray icon sits on, so the glyphs stay legible.
#[derive(Clone, Copy, PartialEq, Eq, Default)]
enum IconTone {
  /// Light glyphs for a dark menu.
  #[default]
  OnDark,
  /// Dark glyphs for a light menu.
  OnLight,
  /// Mid grey, legible on either — used when the theme is unknown.
  Neutral,
}

impl IconTone {
  fn foreground(self) -> [u8; 4] {
    match self {
      Self::OnDark => [230, 232, 236, 255],
      Self::OnLight => [58, 60, 66, 255],
      Self::Neutral => [148, 152, 160, 255],
    }
  }

  /// Green used for the running game. Darker on light menus so it keeps its
  /// contrast against white.
  fn accent(self) -> [u8; 4] {
    match self {
      Self::OnLight => [26, 127, 55, 255],
      _ => [63, 185, 80, 255],
    }
  }
}

/// Row of the "recently played" section.
#[derive(Clone, PartialEq)]
struct RecentEntry {
  game_id: i64,
  text: String,
  /// Whether this is the game that is running right now.
  playing: bool,
}

/// Header row describing the running game.
#[derive(Clone, PartialEq)]
struct NowPlayingHeader {
  text: String,
}

/// The complete menu contents. Two models are equal when the rendered menu
/// would look identical, which is what makes rebuild skipping safe.
#[derive(Clone, PartialEq, Default)]
struct MenuModel {
  now_playing: Option<NowPlayingHeader>,
  recent: Vec<RecentEntry>,
  tone: IconTone,
}

fn now_ms() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_millis() as u64)
    .unwrap_or(0)
}

/// Minutes the running game has been running for, based on wall clock so the
/// header keeps counting even if a tick was skipped.
fn elapsed_minutes(now_playing: &NowPlaying, at_ms: u64) -> u64 {
  if now_playing.started_at_ms == 0 || at_ms < now_playing.started_at_ms {
    return 0;
  }
  (at_ms - now_playing.started_at_ms) / 60_000
}

/// Elides a title so one long game name cannot stretch the whole menu.
fn elide(text: &str, max_chars: usize) -> String {
  // Titles arrive from the server and the filesystem; keep them on one line.
  let flattened: String = text
    .chars()
    .map(|c| if c.is_control() { ' ' } else { c })
    .collect();
  let trimmed = flattened.trim();
  if trimmed.chars().count() <= max_chars {
    return trimmed.to_string();
  }
  let mut out: String = trimmed.chars().take(max_chars.saturating_sub(1)).collect();
  out.push('…');
  out
}

fn icon_tone(app: &AppHandle) -> IconTone {
  match app
    .get_webview_window(MAIN_WINDOW)
    .and_then(|window| window.theme().ok())
  {
    Some(Theme::Dark) => IconTone::OnDark,
    Some(Theme::Light) => IconTone::OnLight,
    // `Theme` is non-exhaustive upstream, and a missing window (still starting
    // up, or hidden) leaves us without an answer: fall back to mid grey.
    _ => IconTone::Neutral,
  }
}

/// Builds the menu model from the current state.
///
/// `tone` is passed in rather than looked up here so the whole model can be
/// assembled off the main thread (see [`refresh`]).
fn menu_model(tone: IconTone) -> MenuModel {
  let (now_playing, recent) = match tray_state().lock() {
    Ok(state) => (state.now_playing.clone(), state.recent.clone()),
    Err(_) => (None, Vec::new()),
  };

  let mut entries: Vec<RecentEntry> = Vec::new();
  if let Some(now_playing) = &now_playing {
    if now_playing.game_id > 0 && !now_playing.title.trim().is_empty() {
      entries.push(RecentEntry {
        game_id: now_playing.game_id,
        text: elide(&now_playing.title, TITLE_MAX_CHARS),
        playing: true,
      });
    }
  }
  for game in &recent {
    if entries.len() >= RECENT_GAME_LIMIT {
      break;
    }
    if game.game_id <= 0 || game.title.trim().is_empty() {
      continue;
    }
    if entries.iter().any(|entry| entry.game_id == game.game_id) {
      continue;
    }
    entries.push(RecentEntry {
      game_id: game.game_id,
      text: elide(&game.title, TITLE_MAX_CHARS),
      playing: false,
    });
  }

  let now_playing = now_playing.map(|now_playing| {
    let minutes = elapsed_minutes(&now_playing, now_ms());
    NowPlayingHeader {
      text: format!(
        "Now playing: {} · {} min",
        elide(&now_playing.title, TITLE_MAX_CHARS - 8),
        minutes
      ),
    }
  });

  MenuModel {
    now_playing,
    recent: entries,
    tone,
  }
}

/// Registers the tray icon. Called once, from the app setup hook.
pub(crate) fn create(app: &AppHandle) -> tauri::Result<()> {
  let mut builder = TrayIconBuilder::with_id(TRAY_ID)
    .show_menu_on_left_click(false)
    .on_menu_event(|app, event| handle_menu_event(app, event.id.as_ref()))
    .on_tray_icon_event(|tray, event| {
      if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
      } = event
      {
        toggle_main_window(tray.app_handle());
      }
    });

  if let Some(icon) = app.default_window_icon() {
    builder = builder.icon(icon.clone());
  }

  let tray = builder.build(app)?;
  // A menu has to be set for the icon to show up on some Linux desktops. This
  // runs in the setup hook, i.e. already on the main thread.
  let model = menu_model(icon_tone(app));
  tray.set_menu(Some(build_menu(app, &model)?))?;
  tray.set_tooltip(Some(tooltip(&model)))?;
  apply_tray_icon(app, &tray, &model);

  if let Ok(mut state) = tray_state().lock() {
    state.rendered = Some(model);
  }

  Ok(())
}

fn handle_menu_event(app: &AppHandle, id: &str) {
  match id {
    ID_SHOW => toggle_main_window(app),
    // `request_restart` goes through the normal exit path instead of killing
    // the process outright, so in-flight work (e.g. the last playtime tick)
    // still gets its shutdown handling.
    ID_RESTART => app.request_restart(),
    ID_QUIT => app.exit(0),
    ID_NAV_LIBRARY => emit_navigate(app, "library"),
    ID_NAV_DOWNLOADS => emit_navigate(app, "downloads"),
    ID_NAV_COMMUNITY => emit_navigate(app, "community"),
    ID_NAV_SETTINGS => emit_navigate(app, "settings"),
    other => {
      if let Some(game_id) = other
        .strip_prefix(ID_GAME_PREFIX)
        .and_then(|value| value.parse::<i64>().ok())
      {
        queue_and_notify(app, TrayAction::LaunchGame(game_id));
      }
    }
  }
}

/// Brings the window forward and asks the frontend to switch pages.
fn emit_navigate(app: &AppHandle, route: &str) {
  show_main_window(app);
  queue_and_notify(app, TrayAction::Navigate(route.to_string()));
}

fn main_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
  app.get_webview_window(MAIN_WINDOW)
}

fn show_main_window(app: &AppHandle) {
  if let Some(window) = main_window(app) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
}

/// Left-clicking the tray icon toggles the window, like most desktop apps.
fn toggle_main_window(app: &AppHandle) {
  let Some(window) = main_window(app) else {
    return;
  };
  if window.is_visible().unwrap_or(false) {
    let _ = window.hide();
  } else {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
}

fn build_menu(app: &AppHandle, model: &MenuModel) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
  let foreground = model.tone.foreground();
  let mut builder = MenuBuilder::new(app);

  if let Some(header) = &model.now_playing {
    // Disabled: it is a status line, not an action.
    builder = builder.item(
      &IconMenuItemBuilder::with_id(ID_NOW_PLAYING, &header.text)
        .icon(glyph_image(Glyph::Play, model.tone.accent()))
        .enabled(false)
        .build(app)?,
    );
    builder = builder.separator();
  }

  for entry in &model.recent {
    let (glyph, color) = if entry.playing {
      (Glyph::Play, model.tone.accent())
    } else {
      (Glyph::Clock, foreground)
    };
    builder = builder.item(
      &IconMenuItemBuilder::with_id(format!("{ID_GAME_PREFIX}{}", entry.game_id), &entry.text)
        .icon(glyph_image(glyph, color))
        .build(app)?,
    );
  }

  if !model.recent.is_empty() {
    builder = builder.separator();
  }

  for page in PAGES {
    let (id, glyph) = page_menu_entry(page);
    builder = builder.item(
      &IconMenuItemBuilder::with_id(id, page_title(page))
        .icon(glyph_image(glyph, foreground))
        .build(app)?,
    );
  }

  builder = builder.separator();
  builder = builder.item(
    &IconMenuItemBuilder::with_id(ID_SHOW, "Show GameVault")
      .icon(glyph_image(Glyph::Show, foreground))
      .build(app)?,
  );
  builder = builder.item(
    &IconMenuItemBuilder::with_id(ID_RESTART, "Restart")
      .icon(glyph_image(Glyph::Restart, foreground))
      .build(app)?,
  );
  builder = builder.item(
    &IconMenuItemBuilder::with_id(ID_QUIT, "Quit")
      .icon(glyph_image(Glyph::Quit, foreground))
      .build(app)?,
  );

  builder.build()
}

fn tooltip(model: &MenuModel) -> String {
  match &model.now_playing {
    Some(header) => format!("GameVault — {}", header.text),
    None => "GameVault".to_string(),
  }
}

/// Rebuilds the menu, tooltip and icon if the model changed.
///
/// The tracker calls this from its own async task and the frontend from a
/// command thread, so the native menu work is handed to the main thread —
/// native menus and tray icons may only be touched from there.
fn refresh(app: &AppHandle) {
  let tone = icon_tone(app);
  // The closure owns a handle (`run_on_main_thread` requires `'static`), so
  // borrowing `app` from it is not possible.
  let main_thread_app = app.clone();
  let _ = main_thread_app.clone().run_on_main_thread(move || {
    let model = menu_model(tone);
    {
      let Ok(mut state) = tray_state().lock() else {
        return;
      };
      if state.rendered.as_ref() == Some(&model) {
        return;
      }
      state.rendered = Some(model.clone());
    }
    apply_model(&main_thread_app, &model);
  });
}

/// Pushes a model to the OS. Must run on the main thread.
fn apply_model(app: &AppHandle, model: &MenuModel) {
  let Some(tray) = app.tray_by_id(TRAY_ID) else {
    return;
  };
  if let Ok(menu) = build_menu(app, model) {
    let _ = tray.set_menu(Some(menu));
  }
  let _ = tray.set_tooltip(Some(tooltip(model)));
  apply_tray_icon(app, &tray, model);
}

/// Draws a play badge over the app icon while a game is running.
fn apply_tray_icon(app: &AppHandle, tray: &TrayIcon<tauri::Wry>, model: &MenuModel) {
  let Some(base) = app.default_window_icon() else {
    return;
  };
  let icon = if model.now_playing.is_some() {
    play_badge(base, model.tone.accent())
  } else {
    base.clone()
  };
  let _ = tray.set_icon(Some(icon));
}

/// Marks the game the tracker currently sees running.
///
/// Called from every tracker tick, so it also refreshes the elapsed minutes.
pub(crate) fn set_now_playing(app: &AppHandle, game_id: i64, title: &str, started_at_ms: u64) {
  {
    let Ok(mut state) = tray_state().lock() else {
      return;
    };
    state.now_playing = Some(NowPlaying {
      game_id,
      title: title.to_string(),
      started_at_ms,
    });
  }
  refresh(app);
}

/// Clears the running game (tick without a match, tracker stopped, logout).
pub(crate) fn clear_now_playing(app: &AppHandle) {
  {
    let Ok(mut state) = tray_state().lock() else {
      return;
    };
    if state.now_playing.is_none() {
      return;
    }
    state.now_playing = None;
  }
  refresh(app);
}

/// Replaces the recently played list. Sent by the frontend.
#[tauri::command]
pub(crate) fn set_tray_recent_games(app: AppHandle, games: Vec<TrayGame>) {
  {
    let Ok(mut state) = tray_state().lock() else {
      return;
    };
    if state.recent == games {
      return;
    }
    state.recent = games;
  }
  refresh(&app);
  update_jump_list(&app);
}

/// Mirrors the recent games onto the Windows taskbar jump list.
///
/// Off Windows this only runs the (empty) shared setup, so the call site does
/// not need to be platform-gated.
fn update_jump_list(app: &AppHandle) {
  let app_id = app.config().identifier.clone();
  let recent: Vec<(i64, String)> = match tray_state().lock() {
    Ok(state) => state
      .recent
      .iter()
      .map(|game| (game.game_id, elide(&game.title, TITLE_MAX_CHARS)))
      .collect(),
    Err(_) => Vec::new(),
  };

  // The shell APIs need the main thread's COM apartment.
  let _ = app.run_on_main_thread(move || {
    crate::jumplist::update(&app_id, &recent);
  });
}

// ── Menu glyph rasteriser ────────────────────────────────────────────────
//
// The icons are drawn as code instead of shipping binary assets: they have to
// be recoloured per theme (light / dark menu), which a fixed PNG cannot do.
// Shapes are defined on a 24×24 grid and rasterised with 4×4 supersampling.

/// A shape defined as "is this point inside?", in 24×24 grid units.
type Mask = Box<dyn Fn(f32, f32) -> bool>;

/// The glyphs the tray menu can show.
#[derive(Clone, Copy)]
enum Glyph {
  Play,
  Clock,
  Library,
  Downloads,
  Community,
  Settings,
  Show,
  Restart,
  Quit,
}

fn glyph_mask(glyph: Glyph) -> Mask {
  match glyph {
    Glyph::Play => triangle((8.6, 4.6), (19.6, 12.0), (8.6, 19.4)),
    Glyph::Clock => union(
      ring(12.0, 12.0, 9.0, 2.1),
      union(
        segment(12.0, 12.0, 12.0, 6.4, 2.1),
        segment(12.0, 12.0, 16.6, 14.2, 2.1),
      ),
    ),
    // A 2×2 grid of tiles reads as a collection at menu-icon size.
    Glyph::Library => union(
      union(
        rounded_rect(3.8, 3.8, 10.8, 10.8, 2.0),
        rounded_rect(13.2, 3.8, 20.2, 10.8, 2.0),
      ),
      union(
        rounded_rect(3.8, 13.2, 10.8, 20.2, 2.0),
        rounded_rect(13.2, 13.2, 20.2, 20.2, 2.0),
      ),
    ),
    Glyph::Downloads => union(
      segment(12.0, 3.2, 12.0, 13.4, 2.6),
      union(
        triangle((6.5, 12.0), (17.5, 12.0), (12.0, 19.8)),
        rounded_rect(4.8, 20.6, 19.2, 22.6, 1.0),
      ),
    ),
    // Speech bubble with three dots punched out of it.
    Glyph::Community => subtract(
      union(
        rounded_rect(3.0, 3.4, 21.0, 17.4, 4.5),
        triangle((6.2, 15.5), (12.4, 15.5), (6.2, 22.0)),
      ),
      union(
        circle(8.2, 10.4, 1.35),
        union(circle(12.0, 10.4, 1.35), circle(15.8, 10.4, 1.35)),
      ),
    ),
    // Gear: a toothed ring, which is what every platform uses for "settings".
    Glyph::Settings => {
      let mut gear = ring(12.0, 12.0, 6.2, 3.6);
      for tooth in 0..8 {
        let angle = tooth as f32 * std::f32::consts::PI / 4.0;
        let (sin, cos) = angle.sin_cos();
        gear = union(
          gear,
          segment(
            12.0 + 6.0 * cos,
            12.0 + 6.0 * sin,
            12.0 + 9.6 * cos,
            12.0 + 9.6 * sin,
            3.2,
          ),
        );
      }
      gear
    }
    // Application window with a title bar.
    Glyph::Show => union(
      rounded_rect_outline(3.0, 4.0, 21.0, 19.0, 3.5, 2.0),
      segment(5.0, 8.8, 19.0, 8.8, 1.8),
    ),
    Glyph::Restart => union(
      subtract(
        ring(12.0, 12.4, 7.4, 2.4),
        segment(12.0, 12.4, 19.6, 5.4, 4.8),
      ),
      triangle((15.2, 2.4), (21.6, 6.6), (15.0, 9.0)),
    ),
    Glyph::Quit => union(
      subtract(
        ring(12.0, 12.4, 7.2, 2.4),
        rounded_rect(9.2, 0.4, 14.8, 6.2, 0.0),
      ),
      rounded_rect(10.85, 4.2, 13.15, 13.4, 1.15),
    ),
  }
}

fn circle(cx: f32, cy: f32, r: f32) -> Mask {
  Box::new(move |x, y| (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r)
}

fn ring(cx: f32, cy: f32, r: f32, thickness: f32) -> Mask {
  let (inner, outer) = (r - thickness / 2.0, r + thickness / 2.0);
  Box::new(move |x, y| {
    let distance = ((x - cx) * (x - cx) + (y - cy) * (y - cy)).sqrt();
    distance >= inner && distance <= outer
  })
}

fn rounded_rect(x0: f32, y0: f32, x1: f32, y1: f32, radius: f32) -> Mask {
  Box::new(move |x, y| {
    let dx = (x0 + radius - x).max(x - (x1 - radius)).max(0.0);
    let dy = (y0 + radius - y).max(y - (y1 - radius)).max(0.0);
    dx * dx + dy * dy <= radius * radius
  })
}

fn rounded_rect_outline(x0: f32, y0: f32, x1: f32, y1: f32, radius: f32, thickness: f32) -> Mask {
  subtract(
    rounded_rect(x0, y0, x1, y1, radius),
    rounded_rect(
      x0 + thickness,
      y0 + thickness,
      x1 - thickness,
      y1 - thickness,
      (radius - thickness).max(0.4),
    ),
  )
}

fn segment(x0: f32, y0: f32, x1: f32, y1: f32, width: f32) -> Mask {
  Box::new(move |x, y| {
    let (dx, dy) = (x1 - x0, y1 - y0);
    let length_squared = dx * dx + dy * dy;
    let t = if length_squared <= 0.0 {
      0.0
    } else {
      (((x - x0) * dx + (y - y0) * dy) / length_squared).clamp(0.0, 1.0)
    };
    let (px, py) = (x0 + t * dx, y0 + t * dy);
    let distance_squared = (x - px) * (x - px) + (y - py) * (y - py);
    distance_squared <= (width / 2.0) * (width / 2.0)
  })
}

fn triangle(a: (f32, f32), b: (f32, f32), c: (f32, f32)) -> Mask {
  Box::new(move |x, y| {
    // Point-in-triangle via three consistent edge signs.
    let cross = |p: (f32, f32), q: (f32, f32), r: (f32, f32)| {
      (p.0 - r.0) * (q.1 - r.1) - (q.0 - r.0) * (p.1 - r.1)
    };
    let d1 = cross((x, y), a, b);
    let d2 = cross((x, y), b, c);
    let d3 = cross((x, y), c, a);
    let has_negative = d1 < 0.0 || d2 < 0.0 || d3 < 0.0;
    let has_positive = d1 > 0.0 || d2 > 0.0 || d3 > 0.0;
    !(has_negative && has_positive)
  })
}

fn union(a: Mask, b: Mask) -> Mask {
  Box::new(move |x, y| a(x, y) || b(x, y))
}

fn subtract(a: Mask, b: Mask) -> Mask {
  Box::new(move |x, y| a(x, y) && !b(x, y))
}

/// Composites a shape onto an RGBA buffer with 4×4 supersampling.
///
/// `rect` bounds the work to the area the shape can reach, which keeps the
/// tray-icon overlay cheap on large source icons.
fn paint(
  rgba: &mut [u8],
  width: u32,
  height: u32,
  color: [u8; 4],
  rect: (f32, f32, f32, f32),
  inside: &dyn Fn(f32, f32) -> bool,
) {
  const SUBSAMPLES: u32 = 4;
  let samples = (SUBSAMPLES * SUBSAMPLES) as f32;

  let x_start = rect.0.max(0.0).floor() as u32;
  let y_start = rect.1.max(0.0).floor() as u32;
  let x_end = (rect.2.ceil().max(0.0) as u32).min(width);
  let y_end = (rect.3.ceil().max(0.0) as u32).min(height);

  for y in y_start..y_end {
    for x in x_start..x_end {
      let mut hits = 0u32;
      for sy in 0..SUBSAMPLES {
        for sx in 0..SUBSAMPLES {
          let fx = x as f32 + (sx as f32 + 0.5) / SUBSAMPLES as f32;
          let fy = y as f32 + (sy as f32 + 0.5) / SUBSAMPLES as f32;
          if inside(fx, fy) {
            hits += 1;
          }
        }
      }
      if hits == 0 {
        continue;
      }

      let coverage = hits as f32 / samples;
      let source_alpha = color[3] as f32 / 255.0 * coverage;
      let index = ((y * width + x) * 4) as usize;
      let destination_alpha = rgba[index + 3] as f32 / 255.0;
      let out_alpha = source_alpha + destination_alpha * (1.0 - source_alpha);
      if out_alpha <= 0.0 {
        continue;
      }

      for channel in 0..3 {
        let source = color[channel] as f32;
        let destination = rgba[index + channel] as f32;
        let blended =
          (source * source_alpha + destination * destination_alpha * (1.0 - source_alpha))
            / out_alpha;
        rgba[index + channel] = blended.round().clamp(0.0, 255.0) as u8;
      }
      rgba[index + 3] = (out_alpha * 255.0).round().clamp(0.0, 255.0) as u8;
    }
  }
}

/// Rasterises a glyph into a menu-sized image.
fn glyph_image(glyph: Glyph, color: [u8; 4]) -> Image<'static> {
  let size = MENU_ICON_SIZE;
  let scale = size as f32 / 24.0;
  let mask = glyph_mask(glyph);
  let mut rgba = vec![0u8; (size * size * 4) as usize];
  paint(
    &mut rgba,
    size,
    size,
    color,
    (0.0, 0.0, size as f32, size as f32),
    &|x, y| mask(x / scale, y / scale),
  );
  Image::new_owned(rgba, size, size)
}

/// Draws a green play badge into the bottom-right corner of the app icon, so
/// the tray shows at a glance that a game is running.
fn play_badge(base: &Image<'_>, accent: [u8; 4]) -> Image<'static> {
  let (width, height) = (base.width(), base.height());
  if width == 0 || height == 0 {
    return Image::new_owned(base.rgba().to_vec(), width, height);
  }

  let mut rgba = base.rgba().to_vec();
  let shortest = width.min(height) as f32;
  let radius = shortest * 0.34;
  let (cx, cy) = (
    width as f32 - radius - shortest * 0.02,
    height as f32 - radius - shortest * 0.02,
  );
  let bounds = (cx - radius - 1.0, cy - radius - 1.0, cx + radius + 1.0, cy + radius + 1.0);

  // A dark ring separates the badge from whatever the icon shows underneath.
  paint(
    &mut rgba,
    width,
    height,
    [12, 14, 18, 235],
    bounds,
    &|x, y| circle(cx, cy, radius + shortest * 0.045)(x, y),
  );
  paint(
    &mut rgba,
    width,
    height,
    accent,
    bounds,
    &|x, y| circle(cx, cy, radius)(x, y),
  );
  paint(
    &mut rgba,
    width,
    height,
    [255, 255, 255, 255],
    bounds,
    &|x, y| {
      triangle(
        (cx - radius * 0.34, cy - radius * 0.54),
        (cx + radius * 0.58, cy),
        (cx - radius * 0.34, cy + radius * 0.54),
      )(x, y)
    },
  );

  Image::new_owned(rgba, width, height)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn alpha_at(image: &Image<'_>, x: u32, y: u32) -> u8 {
    image.rgba()[((y * image.width() + x) * 4 + 3) as usize]
  }

  #[test]
  fn glyphs_are_drawn_inside_their_box() {
    for glyph in [
      Glyph::Play,
      Glyph::Clock,
      Glyph::Library,
      Glyph::Downloads,
      Glyph::Community,
      Glyph::Settings,
      Glyph::Show,
      Glyph::Restart,
      Glyph::Quit,
    ] {
      let image = glyph_image(glyph, [255, 255, 255, 255]);
      assert_eq!(image.width(), MENU_ICON_SIZE);
      assert_eq!(image.height(), MENU_ICON_SIZE);

      // Something must be drawn, and nothing may touch the outer edge.
      let mut opaque = 0;
      for y in 0..MENU_ICON_SIZE {
        for x in 0..MENU_ICON_SIZE {
          let alpha = alpha_at(&image, x, y);
          if alpha > 0 {
            opaque += 1;
            assert!(
              x > 0 && y > 0 && x < MENU_ICON_SIZE - 1 && y < MENU_ICON_SIZE - 1,
              "glyph {opaque} pixel at ({x},{y}) touches the border"
            );
          }
        }
      }
      assert!(opaque > 20, "glyph rendered (almost) empty");
    }
  }

  #[test]
  fn badge_only_marks_the_bottom_right_corner() {
    let size = 64u32;
    let mut base = vec![0u8; (size * size * 4) as usize];
    for pixel in base.chunks_exact_mut(4) {
      pixel.copy_from_slice(&[20, 20, 20, 255]);
    }
    let base = Image::new_owned(base, size, size);

    let badged = play_badge(&base, [63, 185, 80, 255]);
    // Top-left is untouched, bottom-right is re-painted with the accent.
    assert_eq!(badged.rgba()[0..4], [20, 20, 20, 255]);
    let accent_pixels = badged
      .rgba()
      .chunks_exact(4)
      .filter(|pixel| pixel[1] > pixel[0] && pixel[1] > 120)
      .count();
    assert!(accent_pixels > 50, "no accent pixels drawn");
  }

  #[test]
  fn now_playing_text_counts_minutes() {
    let model_header = |started_at_ms: u64, at_ms: u64| {
      let now_playing = NowPlaying {
        game_id: 7,
        title: "Hollow Knight".to_string(),
        started_at_ms,
      };
      elapsed_minutes(&now_playing, at_ms)
    };

    assert_eq!(model_header(1_000, 1_000), 0);
    assert_eq!(model_header(1_000, 61_000), 1);
    assert_eq!(model_header(1_000, 600_000), 9);
    // A clock that went backwards must not produce a huge number.
    assert_eq!(model_header(600_000, 1_000), 0);
  }

  #[test]
  fn long_titles_are_elided_and_kept_on_one_line() {
    let title = "A".repeat(200);
    let elided = elide(&title, 20);
    assert_eq!(elided.chars().count(), 20);
    assert!(elided.ends_with('…'));

    assert_eq!(elide("Line\nBreak", 40), "Line Break");
    assert_eq!(elide("  Padded  ", 40), "Padded");
  }

  #[test]
  fn command_line_flags_become_actions() {
    let actions = actions_from_args([
      "GameVault.exe",
      "--gv-navigate",
      "downloads",
      "--gv-launch-game",
      "42",
    ]);
    assert_eq!(
      actions,
      vec![
        TrayAction::Navigate("downloads".to_string()),
        TrayAction::LaunchGame(42)
      ]
    );
  }

  #[test]
  fn unknown_or_malformed_flags_are_ignored() {
    assert!(actions_from_args(["GameVault.exe"]).is_empty());
    // Unknown page: no action, and the value must not be re-read as a flag.
    assert!(actions_from_args(["--gv-navigate", "nowhere"]).is_empty());
    // Missing value / not a number / non-positive id.
    assert!(actions_from_args(["--gv-launch-game"]).is_empty());
    assert!(actions_from_args(["--gv-launch-game", "abc"]).is_empty());
    assert!(actions_from_args(["--gv-launch-game", "0"]).is_empty());
    // A real flag directly after a rejected one is still picked up.
    assert_eq!(
      actions_from_args(["--gv-navigate", "nowhere", "--gv-launch-game", "7"]),
      vec![TrayAction::LaunchGame(7)]
    );
  }

  #[test]
  fn queued_actions_are_drained_once() {
    // The queue is process-wide; make sure this test starts and ends empty.
    let _ = take_tray_actions();

    queue(TrayAction::Navigate("library".to_string()));
    queue(TrayAction::LaunchGame(9));

    assert_eq!(
      take_tray_actions(),
      vec![
        TrayAction::Navigate("library".to_string()),
        TrayAction::LaunchGame(9)
      ]
    );
    assert!(take_tray_actions().is_empty());
  }

  #[test]
  fn actions_serialise_for_the_frontend() {
    let json = serde_json::to_string(&TrayAction::LaunchGame(3)).expect("serialises");
    assert_eq!(json, r#"{"kind":"launchGame","value":3}"#);

    let json = serde_json::to_string(&TrayAction::Navigate("library".to_string()))
      .expect("serialises");
    assert_eq!(json, r#"{"kind":"navigate","value":"library"}"#);
  }
}
