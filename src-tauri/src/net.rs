//! Network + binary-file utility commands that bypass browser CORS and
//! plugin-fs scope restrictions. Used for cross-origin image downloads and
//! reading files dropped from external apps (e.g. dragging an image out of a
//! browser), which WebView2 does not expose through the DOM DataTransfer API.

use base64::Engine as _;
use serde::Serialize;
use std::sync::OnceLock;

#[derive(Serialize)]
pub(crate) struct FetchedBytes {
  /// Base64 so the bytes never become a JSON array of numbers over IPC.
  bytes_base64: String,
  content_type: String,
}

static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

/// Windows keeps roots installed for every user (an internal CA pushed by an IT
/// agent, a TLS-inspecting proxy) in `LocalMachine\Root`, which
/// `rustls-native-certs` does not read: it only loads the current user's store.
/// Without them a certificate everyone else on the machine trusts stays unknown
/// to native requests.
#[cfg(windows)]
fn windows_machine_root_certificates() -> Vec<reqwest::Certificate> {
  use schannel::cert_store::CertStore;

  let store = match CertStore::open_local_machine("ROOT") {
    Ok(store) => store,
    Err(error) => {
      log::warn!("Could not open the machine certificate store: {error}");
      return Vec::new();
    }
  };

  store
    .certs()
    // System stores often hold roots without X.509 extensions, which rustls
    // cannot parse. Skipping them is fine: they were never usable for TLS.
    .filter_map(|cert| reqwest::Certificate::from_der(cert.to_der()).ok())
    .collect()
}

/// Builder for native HTTP clients, so every request trusts the same
/// certificates as the rest of the app.
pub(crate) fn http_client_builder() -> reqwest::ClientBuilder {
  #[allow(unused_mut)]
  let mut builder = reqwest::Client::builder();
  #[cfg(windows)]
  for certificate in windows_machine_root_certificates() {
    builder = builder.add_root_certificate(certificate);
  }
  builder
}

/// HTTP client shared by every native request.
///
/// Building a client loads the platform root certificate store
/// (`rustls-tls-native-roots`), which is a blocking syscall-heavy operation on
/// Windows and macOS. Downloads, image fetches and the playtime sync would
/// otherwise re-read it on every single request.
pub(crate) fn http_client() -> reqwest::Client {
  HTTP_CLIENT
    .get_or_init(|| match http_client_builder().build() {
      Ok(client) => client,
      Err(error) => {
        // An unreadable native store can make building fail: keep the bundled
        // Mozilla roots in that case instead of taking the app down.
        log::error!("Falling back to bundled root certificates: {error}");
        http_client_builder()
          .tls_built_in_native_certs(false)
          .build()
          .unwrap_or_else(|fallback_error| {
            log::error!("Falling back to the default HTTP client: {fallback_error}");
            reqwest::Client::new()
          })
      }
    })
    .clone()
}

/// `reqwest::Error`'s own message stops at "error sending request for url
/// (...)", hiding the actual reason: a certificate the store does not trust, a
/// refused connection, DNS. That reason is what a user needs to fix it, so the
/// source chain is appended.
pub(crate) fn reqwest_error_chain(error: &reqwest::Error) -> String {
  let mut message = error.to_string();
  let mut source = std::error::Error::source(error);
  for _ in 0..3 {
    let Some(cause) = source else {
      break;
    };
    let cause_message = cause.to_string();
    if !cause_message.is_empty() && !message.contains(&cause_message) {
      message.push_str(": ");
      message.push_str(&cause_message);
    }
    source = cause.source();
  }
  message
}

fn encode_base64(bytes: &[u8]) -> String {
  base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// Fetch a URL natively (no CORS). Used to download images pasted/dropped as
/// URLs that the browser cannot `fetch` cross-origin (e.g. img.itch.zone).
#[tauri::command]
pub(crate) async fn fetch_url_bytes(url: String) -> Result<FetchedBytes, String> {
  let client = http_client();
  let resp = client
    .get(&url)
    .header("Accept", "image/*,*/*;q=0.8")
    .send()
    .await
    .map_err(|e| format!("fetch_url_bytes request failed: {e}"))?;
  if !resp.status().is_success() {
    return Err(format!("fetch_url_bytes HTTP {}", resp.status()));
  }
  let content_type = resp
    .headers()
    .get(reqwest::header::CONTENT_TYPE)
    .and_then(|v| v.to_str().ok())
    .unwrap_or("application/octet-stream")
    .to_string();
  let bytes = resp
    .bytes()
    .await
    .map_err(|e| format!("fetch_url_bytes read failed: {e}"))?
    .to_vec();
  Ok(FetchedBytes {
    bytes_base64: encode_base64(&bytes),
    content_type,
  })
}

/// Read a file's raw bytes by absolute path. Bypasses plugin-fs scope so we
/// can read temp files handed to us by Tauri's native drag-drop handling.
///
/// Returns Base64: the previous `Vec<u8>` was serialised as a JSON array of
/// numbers, which made a multi-MB image a multi-million-entry array on the
/// renderer's main thread.
#[tauri::command]
pub(crate) async fn fs_read_binary_file(path: String) -> Result<String, String> {
  let bytes = std::fs::read(&path)
    .map_err(|e| format!("fs_read_binary_file failed for '{}': {}", path, e))?;
  Ok(encode_base64(&bytes))
}
