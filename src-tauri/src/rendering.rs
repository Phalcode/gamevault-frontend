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
pub(crate) struct CpuInfo {
  pub brand: Option<String>,
  pub physical_cores: Option<usize>,
  pub logical_cores: Option<usize>,
}

#[derive(Serialize)]
pub(crate) struct MemoryInfo {
  pub total_bytes: Option<u64>,
}

/// Real CPU / RAM facts straight from the OS.
///
/// The browser APIs the frontend can reach are privacy-clipped
/// (`hardwareConcurrency` counts logical CPUs, `deviceMemory` rounds the
/// installed RAM down to a power of two), so the desktop build reports what the
/// machine actually has instead.
#[derive(Serialize)]
pub(crate) struct SystemSpecs {
  pub cpu: CpuInfo,
  pub memory: MemoryInfo,
}

#[derive(Serialize)]
pub(crate) struct RenderingDiagnostics {
  pub os: OsInfo,
  pub monitors: Vec<MonitorInfo>,
  pub webkit: Option<WebKitState>,
  pub system: SystemSpecs,
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

/**
 * Total installed RAM in bytes.
 *
 * On Windows `sysinfo` mirrors `GlobalMemoryStatusEx`, i.e. the memory the OS
 * can actually address — which is lower than the amount of RAM that is
 * physically installed (hardware reserves a slice). Ask Windows directly so the
 * value matches the "Installed RAM" figure users see in their system settings.
 */
fn get_total_memory(system: &sysinfo::System) -> Option<u64> {
  #[cfg(target_os = "windows")]
  {
    use winapi::um::sysinfoapi::GetPhysicallyInstalledSystemMemory;
    let mut kilobytes: u64 = 0;
    // SAFETY: the call only writes to the provided out-parameter.
    if unsafe { GetPhysicallyInstalledSystemMemory(&mut kilobytes) } != 0 {
      return Some(kilobytes * 1024).filter(|bytes| *bytes > 0);
    }
  }
  Some(system.total_memory()).filter(|bytes| *bytes > 0)
}

/// Reads the CPU model, core counts and installed RAM from the OS. Anything the
/// platform refuses to report stays `None` so the UI can drop that part.
fn get_system_specs() -> SystemSpecs {
  let system = sysinfo::System::new_with_specifics(
    sysinfo::RefreshKind::nothing()
      .with_cpu(sysinfo::CpuRefreshKind::everything())
      .with_memory(sysinfo::MemoryRefreshKind::everything()),
  );

  // All entries describe the same package; `cpus()` has one per logical CPU.
  let brand = system
    .cpus()
    .first()
    .map(|cpu| cpu.brand().trim().to_string())
    .filter(|brand| !brand.is_empty());
  let logical_cores = system.cpus().len();

  SystemSpecs {
    cpu: CpuInfo {
      brand,
      physical_cores: system.physical_core_count(),
      logical_cores: (logical_cores > 0).then_some(logical_cores),
    },
    memory: MemoryInfo {
      total_bytes: get_total_memory(&system),
    },
  }
}

#[cfg(target_os = "linux")]
async fn read_webkit_state(app: &AppHandle) -> Option<WebKitState> {
  let window = app.get_webview_window("main")?;
  let persisted = crate::settings::load_settings(app);
  let (tx, rx) = tokio::sync::oneshot::channel::<WebKitState>();
  if window
    .with_webview(move |webview| {
      let state = webkit_settings_snapshot(&webview.inner(), &persisted);
      let _ = tx.send(state);
    })
    .is_err()
  {
    return None;
  }
  rx.await.ok()
}

#[cfg(target_os = "linux")]
fn webkit_settings_snapshot(
  webview: &webkit2gtk::WebView,
  persisted: &crate::settings::AppSettings,
) -> WebKitState {
  use webkit2gtk::{SettingsExt, WebViewExt};
  let mut state = match webview.settings() {
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
  };
  // WebKitGTK only honours the hardware-acceleration policy when it is set
  // *before* the web process starts, so the live getter may not reflect the
  // configured value after launch (it tends to report the effective default,
  // e.g. "Never"). Prefer the persisted preference as the source of truth so
  // the setting sticks across navigation and restarts.
  if let Some(policy) = persisted.webkit_hw_accel_policy.as_ref() {
    state.hardware_acceleration_policy = policy.clone();
  }
  state
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
  let system = get_system_specs();
  #[cfg(target_os = "linux")]
  let webkit = read_webkit_state(&app).await;
  #[cfg(not(target_os = "linux"))]
  let webkit = None;
  RenderingDiagnostics {
    os,
    monitors,
    webkit,
    system,
  }
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub(crate) async fn get_webkit_settings(app: AppHandle) -> Result<WebKitState, String> {
  let window = app
    .get_webview_window("main")
    .ok_or_else(|| "main webview window not found".to_string())?;
  let persisted = crate::settings::load_settings(&app);
  let (tx, rx) = tokio::sync::oneshot::channel::<WebKitState>();
  window
    .with_webview(move |webview| {
      let state = webkit_settings_snapshot(&webview.inner(), &persisted);
      let _ = tx.send(state);
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
