use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub(crate) struct OsInfo {
  pub name: String,
  pub os_version: String,
  pub kernel_version: String,
  pub long_os_version: String,
  pub arch: String,
}

#[derive(Serialize)]
pub(crate) struct MonitorInfo {
  pub name: Option<String>,
  pub width: u32,
  pub height: u32,
  pub scale_factor: f64,
  pub position_x: i32,
  pub position_y: i32,
}

#[derive(Serialize, Clone)]
pub(crate) struct WebKitState {
  pub smooth_scroll: bool,
  pub hardware_acceleration_policy: String,
  pub webgl_enabled: bool,
}

#[derive(Serialize)]
pub(crate) struct RenderingDiagnostics {
  pub os: OsInfo,
  pub monitors: Vec<MonitorInfo>,
  pub webkit: Option<WebKitState>,
}

fn get_os_info() -> OsInfo {
  OsInfo {
    name: sysinfo::System::name().unwrap_or_else(|| "Unknown".into()),
    os_version: sysinfo::System::os_version().unwrap_or_else(|| "Unknown".into()),
    kernel_version: sysinfo::System::kernel_version().unwrap_or_else(|| "Unknown".into()),
    long_os_version: sysinfo::System::long_os_version().unwrap_or_else(|| "Unknown".into()),
    arch: std::env::consts::ARCH.to_string(),
  }
}

fn get_monitors(app: &AppHandle) -> Vec<MonitorInfo> {
  let mut monitors = Vec::new();
  if let Some(window) = app.get_webview_window("main") {
    if let Ok(available) = window.available_monitors() {
      for monitor in available {
        let size = monitor.size();
        let position = monitor.position();
        monitors.push(MonitorInfo {
          name: monitor.name().cloned(),
          width: size.width,
          height: size.height,
          scale_factor: monitor.scale_factor(),
          position_x: position.x,
          position_y: position.y,
        });
      }
    }
  }
  monitors
}

#[cfg(target_os = "linux")]
async fn read_webkit_state(app: &AppHandle) -> Option<WebKitState> {
  let window = app.get_webview_window("main")?;
  let (tx, rx) = tokio::sync::oneshot::channel::<WebKitState>();
  if window
    .with_webview(move |webview| {
      let _ = tx.send(webkit_settings_snapshot(&webview.inner()));
    })
    .is_err()
  {
    return None;
  }
  rx.await.ok()
}

#[cfg(target_os = "linux")]
fn webkit_settings_snapshot(webview: &webkit2gtk::WebView) -> WebKitState {
  use webkit2gtk::{SettingsExt, WebViewExt};
  match webview.settings() {
    Some(settings) => WebKitState {
      smooth_scroll: settings.enables_smooth_scrolling(),
      hardware_acceleration_policy: format!(
        "{:?}",
        settings.hardware_acceleration_policy()
      ),
      webgl_enabled: settings.enables_webgl(),
    },
    None => WebKitState {
      smooth_scroll: false,
      hardware_acceleration_policy: "Unknown".into(),
      webgl_enabled: false,
    },
  }
}

/// Applies persisted WebKit settings to the main webview at startup.
#[cfg(target_os = "linux")]
pub(crate) fn apply_webkit_settings(app: &AppHandle) {
  let persisted = crate::settings::load_settings(app);

  if let Some(smooth_scroll) = persisted.webkit_smooth_scroll {
    if let Some(window) = app.get_webview_window("main") {
      let _ = window.with_webview(move |webview| {
        use webkit2gtk::{SettingsExt, WebViewExt};
        if let Some(settings) = webview.inner().settings() {
          settings.set_enable_smooth_scrolling(smooth_scroll);
        }
      });
    }
  }

  if let Some(policy) = persisted.webkit_hw_accel_policy.as_ref() {
    if let Some(parsed) = parse_hw_accel_policy(policy) {
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.with_webview(move |webview| {
          use webkit2gtk::{SettingsExt, WebViewExt};
          if let Some(settings) = webview.inner().settings() {
            settings.set_hardware_acceleration_policy(parsed);
          }
        });
      }
    }
  }
}

#[cfg(target_os = "linux")]
fn parse_hw_accel_policy(value: &str) -> Option<webkit2gtk::HardwareAccelerationPolicy> {
  match value {
    "Always" => Some(webkit2gtk::HardwareAccelerationPolicy::Always),
    "OnDemand" | "On-demand" => Some(webkit2gtk::HardwareAccelerationPolicy::OnDemand),
    "Never" => Some(webkit2gtk::HardwareAccelerationPolicy::Never),
    _ => None,
  }
}

#[tauri::command]
pub(crate) async fn get_rendering_diagnostics(
  app: AppHandle,
) -> RenderingDiagnostics {
  let os = get_os_info();
  let monitors = get_monitors(&app);
  #[cfg(target_os = "linux")]
  let webkit = read_webkit_state(&app).await;
  #[cfg(not(target_os = "linux"))]
  let webkit = None;
  RenderingDiagnostics {
    os,
    monitors,
    webkit,
  }
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub(crate) async fn get_webkit_settings(app: AppHandle) -> Result<WebKitState, String> {
  let window = app
    .get_webview_window("main")
    .ok_or_else(|| "main webview window not found".to_string())?;
  let (tx, rx) = tokio::sync::oneshot::channel::<WebKitState>();
  window
    .with_webview(move |webview| {
      let _ = tx.send(webkit_settings_snapshot(&webview.inner()));
    })
    .map_err(|error| format!("with_webview failed: {error}"))?;
  rx.await.map_err(|_| "main thread dropped the response".to_string())
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub(crate) async fn get_webkit_settings(
  _app: AppHandle,
) -> Result<WebKitState, String> {
  Err("WebKit settings are only configurable on Linux".to_string())
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub(crate) async fn set_webkit_smooth_scrolling(
  app: AppHandle,
  enabled: bool,
) -> Result<(), String> {
  let window = app
    .get_webview_window("main")
    .ok_or_else(|| "main webview window not found".to_string())?;
  let (tx, rx) = tokio::sync::oneshot::channel::<()>();
  window
    .with_webview(move |webview| {
      use webkit2gtk::{SettingsExt, WebViewExt};
      if let Some(settings) = webview.inner().settings() {
        settings.set_enable_smooth_scrolling(enabled);
      }
      let _ = tx.send(());
    })
    .map_err(|error| format!("with_webview failed: {error}"))?;
  let _ = rx.await;

  let mut settings = crate::settings::load_settings(&app);
  settings.webkit_smooth_scroll = Some(enabled);
  crate::settings::save_settings(&app, &settings)
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub(crate) async fn set_webkit_smooth_scrolling(
  _app: AppHandle,
  _enabled: bool,
) -> Result<(), String> {
  Err("WebKit settings are only configurable on Linux".to_string())
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub(crate) async fn set_webkit_hardware_acceleration_policy(
  app: AppHandle,
  policy: String,
) -> Result<(), String> {
  let parsed = parse_hw_accel_policy(&policy)
    .ok_or_else(|| format!("Unknown hardware acceleration policy: {policy}"))?;
  let window = app
    .get_webview_window("main")
    .ok_or_else(|| "main webview window not found".to_string())?;
  let (tx, rx) = tokio::sync::oneshot::channel::<()>();
  window
    .with_webview(move |webview| {
      use webkit2gtk::{SettingsExt, WebViewExt};
      if let Some(settings) = webview.inner().settings() {
        settings.set_hardware_acceleration_policy(parsed);
      }
      let _ = tx.send(());
    })
    .map_err(|error| format!("with_webview failed: {error}"))?;
  let _ = rx.await;

  let mut settings = crate::settings::load_settings(&app);
  settings.webkit_hw_accel_policy = Some(policy);
  crate::settings::save_settings(&app, &settings)
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub(crate) async fn set_webkit_hardware_acceleration_policy(
  _app: AppHandle,
  _policy: String,
) -> Result<(), String> {
  Err("WebKit settings are only configurable on Linux".to_string())
}
