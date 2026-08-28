//! Network + binary-file utility commands that bypass browser CORS and
//! plugin-fs scope restrictions. Used for cross-origin image downloads and
//! reading files dropped from external apps (e.g. dragging an image out of a
//! browser), which WebView2 does not expose through the DOM DataTransfer API.

use serde::Serialize;

#[derive(Serialize)]
pub(crate) struct FetchedBytes {
  bytes: Vec<u8>,
  content_type: String,
}

/// Fetch a URL natively (no CORS). Used to download images pasted/dropped as
/// URLs that the browser cannot `fetch` cross-origin (e.g. img.itch.zone).
#[tauri::command]
pub(crate) async fn fetch_url_bytes(url: String) -> Result<FetchedBytes, String> {
  let client = reqwest::Client::new();
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
    bytes,
    content_type,
  })
}

/// Read a file's raw bytes by absolute path. Bypasses plugin-fs scope so we
/// can read temp files handed to us by Tauri's native drag-drop handling.
#[tauri::command]
pub(crate) fn fs_read_binary_file(path: String) -> Result<Vec<u8>, String> {
  std::fs::read(&path)
    .map_err(|e| format!("fs_read_binary_file failed for '{}': {}", path, e))
}
