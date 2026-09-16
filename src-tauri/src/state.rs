use std::collections::HashMap;
use std::sync::atomic::AtomicU8;
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::watch;

pub(crate) const DOWNLOAD_CONTROL_RUNNING: u8 = 0;
pub(crate) const DOWNLOAD_CONTROL_PAUSE: u8 = 1;
pub(crate) const DOWNLOAD_CONTROL_CANCEL: u8 = 2;

static DOWNLOAD_CONTROL_FLAGS: OnceLock<Mutex<HashMap<i64, Arc<AtomicU8>>>> = OnceLock::new();

pub(crate) fn control_flags() -> &'static Mutex<HashMap<i64, Arc<AtomicU8>>> {
  DOWNLOAD_CONTROL_FLAGS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Clone)]
pub(crate) struct TrackerConfig {
  pub server_url: String,
  pub user_id: i64,
  pub access_token: String,
  pub download_paths: Vec<String>,
}

static TRACKER_CONFIG: OnceLock<Mutex<Option<TrackerConfig>>> = OnceLock::new();
static TRACKER_STOP_TX: OnceLock<Mutex<Option<watch::Sender<bool>>>> = OnceLock::new();

pub(crate) fn tracker_config() -> &'static Mutex<Option<TrackerConfig>> {
  TRACKER_CONFIG.get_or_init(|| Mutex::new(None))
}
pub(crate) fn tracker_stop_tx() -> &'static Mutex<Option<watch::Sender<bool>>> {
  TRACKER_STOP_TX.get_or_init(|| Mutex::new(None))
}

/// Latest known state of an extraction, per game.
///
/// Extraction runs on a detached blocking task that keeps going when the
/// webview is reloaded (F5) or navigated away. Without this registry the UI
/// would lose track of it and show the game as "not extracted" again, even
/// though files are still being written. The frontend queries the registry on
/// startup to re-attach to a running extraction and to pick up results that
/// finished while the page was away.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExtractionSnapshot {
  pub game_id: i64,
  /// `extracting` | `completed` | `needs-password` | `error`
  pub status: String,
  pub processed: u64,
  pub total: Option<u64>,
  pub progress: Option<f64>,
  pub current_file: Option<String>,
  pub error: Option<String>,
}

static EXTRACTION_STATES: OnceLock<Mutex<HashMap<i64, ExtractionSnapshot>>> = OnceLock::new();

fn extraction_states() -> &'static Mutex<HashMap<i64, ExtractionSnapshot>> {
  EXTRACTION_STATES.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn set_extraction_snapshot(snapshot: ExtractionSnapshot) {
  if let Ok(mut states) = extraction_states().lock() {
    states.insert(snapshot.game_id, snapshot);
  }
}

pub(crate) fn extraction_snapshots() -> Vec<ExtractionSnapshot> {
  extraction_states()
    .lock()
    .map(|states| states.values().cloned().collect())
    .unwrap_or_default()
}

/// Whether an extraction for this game is currently being processed.
pub(crate) fn is_extraction_running(game_id: i64) -> bool {
  extraction_states()
    .lock()
    .map(|states| {
      states
        .get(&game_id)
        .map(|snapshot| snapshot.status == "extracting")
        .unwrap_or(false)
    })
    .unwrap_or(false)
}

/// Latest known state of an installation (file copy or installer run), per game.
///
/// Like extractions, both install steps run on detached threads, so their state
/// must survive a webview reload for the UI to re-attach to them.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstallationSnapshot {
  pub game_id: i64,
  /// `copy` for the file copy, `installer` while a setup executable runs.
  pub step: String,
  /// `copying` | `launching` | `running` | `completed` | `error`
  pub status: String,
  pub processed: u64,
  pub total: Option<u64>,
  pub progress: Option<f64>,
  pub current_file: Option<String>,
  pub exit_code: Option<i32>,
  pub error: Option<String>,
}

static INSTALLATION_STATES: OnceLock<Mutex<HashMap<i64, InstallationSnapshot>>> = OnceLock::new();

fn installation_states() -> &'static Mutex<HashMap<i64, InstallationSnapshot>> {
  INSTALLATION_STATES.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn set_installation_snapshot(snapshot: InstallationSnapshot) {
  if let Ok(mut states) = installation_states().lock() {
    states.insert(snapshot.game_id, snapshot);
  }
}

pub(crate) fn installation_snapshots() -> Vec<InstallationSnapshot> {
  installation_states()
    .lock()
    .map(|states| states.values().cloned().collect())
    .unwrap_or_default()
}

/// Whether a file copy for this game is currently running.
pub(crate) fn is_install_copy_running(game_id: i64) -> bool {
  installation_states()
    .lock()
    .map(|states| {
      states
        .get(&game_id)
        .map(|snapshot| snapshot.step == "copy" && snapshot.status == "copying")
        .unwrap_or(false)
    })
    .unwrap_or(false)
}

/// Whether an installer for this game is currently running.
pub(crate) fn is_installer_running(game_id: i64) -> bool {
  installation_states()
    .lock()
    .map(|states| {
      states
        .get(&game_id)
        .map(|snapshot| {
          snapshot.step == "installer"
            && (snapshot.status == "launching" || snapshot.status == "running")
        })
        .unwrap_or(false)
    })
    .unwrap_or(false)
}

/// State of the (single) umu-launcher setup task.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UmuSnapshot {
  /// `installing` | `setup` | `running` | `exit` | `error`
  pub status: String,
  pub message: Option<String>,
  pub game_title: Option<String>,
}

static UMU_STATE: OnceLock<Mutex<Option<UmuSnapshot>>> = OnceLock::new();

fn umu_state() -> &'static Mutex<Option<UmuSnapshot>> {
  UMU_STATE.get_or_init(|| Mutex::new(None))
}

pub(crate) fn set_umu_snapshot(snapshot: Option<UmuSnapshot>) {
  if let Ok(mut state) = umu_state().lock() {
    *state = snapshot;
  }
}

pub(crate) fn umu_snapshot() -> Option<UmuSnapshot> {
  umu_state().lock().ok().and_then(|state| state.clone())
}

/// Whether umu-launcher is currently being downloaded/extracted.
pub(crate) fn is_umu_install_running() -> bool {
  umu_snapshot()
    .map(|snapshot| snapshot.status == "installing")
    .unwrap_or(false)
}

/// State of the (single) app self-update task.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppUpdateSnapshot {
  /// `downloading` | `installing` | `finished` | `error`
  pub status: String,
  pub version: Option<String>,
  pub error: Option<String>,
}

static APP_UPDATE_STATE: OnceLock<Mutex<Option<AppUpdateSnapshot>>> = OnceLock::new();

fn app_update_state() -> &'static Mutex<Option<AppUpdateSnapshot>> {
  APP_UPDATE_STATE.get_or_init(|| Mutex::new(None))
}

pub(crate) fn set_app_update_snapshot(snapshot: Option<AppUpdateSnapshot>) {
  if let Ok(mut state) = app_update_state().lock() {
    *state = snapshot;
  }
}

pub(crate) fn app_update_snapshot() -> Option<AppUpdateSnapshot> {
  app_update_state().lock().ok().and_then(|state| state.clone())
}

/// Everything the frontend needs to re-attach to long-running work after a
/// reload or restart. Served by the `get_background_states` command.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackgroundStates {
  pub extractions: Vec<ExtractionSnapshot>,
  pub installations: Vec<InstallationSnapshot>,
  pub umu: Option<UmuSnapshot>,
  pub app_update: Option<AppUpdateSnapshot>,
}

pub(crate) fn background_states() -> BackgroundStates {
  BackgroundStates {
    extractions: extraction_snapshots(),
    installations: installation_snapshots(),
    umu: umu_snapshot(),
    app_update: app_update_snapshot(),
  }
}
