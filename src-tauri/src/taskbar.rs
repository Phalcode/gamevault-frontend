//! OS taskbar / dock progress and attention indicators.
//!
//! Mirrors the Windows taskbar progress behaviour of the legacy WPF
//! gamevault-app, but for the Tauri frontend and across all desktop platforms:
//!
//! - **Windows** – fills the taskbar button with a progress bar and flashes
//!   the button / window when the user needs to act.
//! - **macOS** – shows progress on the Dock icon and bounces the Dock icon
//!   when the user needs to act.
//! - **Linux** – app-wide progress on supporting desktops (e.g. GNOME with
//!   libunity) and sets an urgency hint when the user needs to act.

use tauri::window::{ProgressBarState, ProgressBarStatus};
use tauri::{AppHandle, Manager, UserAttentionType};

/// Statuses the frontend can request for the OS indicator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TaskbarStatus {
  /// Hide any progress / attention indicator.
  None,
  /// A download/extraction/installation is running normally.
  Normal,
  /// A download/extraction is paused.
  Paused,
  /// An operation has failed and the user needs to act.
  Error,
  /// Something requires the user's attention (e.g. password needed).
  Attention,
  /// A download is active but its total size is unknown, so no determinate
  /// percentage can be computed (e.g. the server sent no Content-Length).
  Indeterminate,
}

impl TaskbarStatus {
  fn to_progress_status(self) -> ProgressBarStatus {
    match self {
      Self::None => ProgressBarStatus::None,
      Self::Normal => ProgressBarStatus::Normal,
      Self::Paused => ProgressBarStatus::Paused,
      Self::Error | Self::Attention => ProgressBarStatus::Error,
      Self::Indeterminate => ProgressBarStatus::Indeterminate,
    }
  }

  fn needs_attention(self) -> bool {
    matches!(self, Self::Error | Self::Attention)
  }
}

/// The main window label used by the Tauri app.
const MAIN_WINDOW: &str = "main";

/// Convert a `0..=1` progress fraction into the `0..=100` integer the OS
/// progress API expects, clamping any out-of-range input.
fn progress_percent(progress: f64) -> u64 {
  (progress.clamp(0.0, 1.0) * 100.0).round() as u64
}

/// Set the taskbar / dock progress indicator.
///
/// `progress` is a value in `0..=1` (inclusive). Any value outside that range
/// is clamped. When `status` is `Error` or `Attention` the app also requests
/// the user's attention (taskbar flash on Windows, dock bounce on macOS,
/// urgency hint on Linux).
#[tauri::command]
pub(crate) fn set_taskbar_progress(app: AppHandle, status: TaskbarStatus, progress: f64) {
  let window = match app.get_webview_window(MAIN_WINDOW) {
    Some(window) => window,
    None => return,
  };

  let progress_status = status.to_progress_status();

  if matches!(progress_status, ProgressBarStatus::None) {
    let _ = window.set_progress_bar(ProgressBarState {
      status: Some(ProgressBarStatus::None),
      progress: None,
    });
    let _ = window.set_badge_count(None);
    let _ = window.request_user_attention(None);
    return;
  }

  let _ = window.set_progress_bar(ProgressBarState {
    status: Some(progress_status),
    progress: if matches!(progress_status, ProgressBarStatus::Indeterminate) {
      None
    } else {
      Some(progress_percent(progress))
    },
  });

  // macOS only: surface a dock badge as an extra "you need to look" signal.
  #[cfg(target_os = "macos")]
  if status.needs_attention() {
    let _ = window.set_badge_count(Some(1));
  }

  // Request attention (flash / bounce / urgency) only when something needs the
  // user to act. This has no effect if the app is already focused.
  if status.needs_attention() {
    let _ = window.request_user_attention(Some(UserAttentionType::Critical));
  }
}

/// Clear the taskbar / dock progress indicator and any attention request.
#[tauri::command]
pub(crate) fn clear_taskbar_progress(app: AppHandle) {
  if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
    let _ = window.set_progress_bar(ProgressBarState {
      status: Some(ProgressBarStatus::None),
      progress: None,
    });
    let _ = window.set_badge_count(None);
    let _ = window.request_user_attention(None);
  }
}
