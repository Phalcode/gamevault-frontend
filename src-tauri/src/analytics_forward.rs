//! Forwards the desktop webview's analytics requests through Rust.
//!
//! The webview runs on a custom origin (`http://tauri.localhost` on Windows,
//! `tauri://localhost` elsewhere). Requests from that origin reach the
//! collector as third-party traffic: the pageview is not stored as a session,
//! so every following heartbeat is answered with 403 "no session for this
//! request". Posting from Rust removes the browser from the path entirely, and
//! pageview and heartbeat then share one connection identity, which is what the
//! collector keys sessions on.

use reqwest::Client;
use std::sync::OnceLock;
use std::time::Duration;
use url::Url;

/// Hosts the command may call, in the order the client tries them.
pub(crate) const ANALYTICS_HOSTS: [&str; 5] = [
  "api.swetrix.com",
  "analytics.platform.phalco.de",
  "anal.phalco.de",
  "track.phalco.de",
  "your-dns-provider-is-pissing-me-off.phalco.de",
];

fn client() -> &'static Client {
  static CLIENT: OnceLock<Client> = OnceLock::new();
  CLIENT.get_or_init(|| {
    Client::builder()
      .timeout(Duration::from_secs(10))
      // The desktop app identifies as GameVault, not as the webview engine.
      .user_agent(crate::user_agent::frontend_user_agent(
        env!("CARGO_PKG_VERSION"),
        crate::user_agent::platform_token(),
      ))
      .build()
      .expect("analytics http client")
  })
}

/// Guards the command: injected script must not be able to use it as an open
/// proxy.
pub(crate) fn is_allowed_endpoint(url: &Url) -> bool {
  url.scheme() == "https"
    && url
      .host_str()
      .is_some_and(|host| ANALYTICS_HOSTS.contains(&host))
}

/// POSTs a JSON body to the collector and returns the HTTP status. The body is
/// ignored: the analytics SDK only looks at the status.
#[tauri::command]
pub(crate) async fn analytics_post(url: String, body: String) -> Result<u16, String> {
  let parsed = Url::parse(&url).map_err(|error| error.to_string())?;
  if !is_allowed_endpoint(&parsed) {
    return Err("refused: not the analytics endpoint".to_string());
  }

  let response = client()
    .post(parsed)
    .header("Content-Type", "application/json")
    .body(body)
    .send()
    .await
    .map_err(|error| error.to_string())?;

  Ok(response.status().as_u16())
}

#[cfg(test)]
mod tests {
  use super::{is_allowed_endpoint, ANALYTICS_HOSTS};
  use url::Url;

  #[test]
  fn allows_every_collector() {
    for host in ANALYTICS_HOSTS {
      for path in ["/log", "/log/hb", "/log/custom", "/log/error"] {
        let url = Url::parse(&format!("https://{host}{path}")).expect("valid url");
        assert!(is_allowed_endpoint(&url), "{host}{path} should be allowed");
      }
    }
  }

  #[test]
  fn refuses_other_hosts_and_schemes() {
    assert!(!is_allowed_endpoint(
      &Url::parse("https://example.com/log").expect("valid url")
    ));
    assert!(!is_allowed_endpoint(
      &Url::parse("http://api.swetrix.com/log").expect("valid url")
    ));
  }
}
