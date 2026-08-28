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
