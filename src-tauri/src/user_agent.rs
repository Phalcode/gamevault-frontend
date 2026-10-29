//! User agent of the desktop webview.
//!
//! Without this the client identifies as the underlying browser engine plus the
//! OS, which is exactly what a server log or an analytics dashboard cannot use
//! to tell the desktop app apart from the Web UI.

/// Browsers put "Linux" in the platform token, and the settings pages use that
/// to show Linux-only options, so the token stays capitalised.
pub(crate) fn platform_token() -> &'static str {
  match std::env::consts::OS {
    "linux" => "Linux",
    "macos" => "macOS",
    "windows" => "Windows",
    other => other,
  }
}

/// `GameVault/2.<version> (<platform>)`, e.g. `GameVault/2.17.1.0 (Linux)`.
pub(crate) fn frontend_user_agent(version: &str, platform: &str) -> String {
  format!("GameVault/2.{version} ({platform})")
}

#[cfg(test)]
mod tests {
  use super::frontend_user_agent;

  #[test]
  fn builds_the_product_agent() {
    assert_eq!(
      frontend_user_agent("17.1.0", "Linux"),
      "GameVault/2.17.1.0 (Linux)"
    );
    assert_eq!(
      frontend_user_agent("17.1.0", "Windows"),
      "GameVault/2.17.1.0 (Windows)"
    );
  }

  #[test]
  fn keeps_the_linux_token_the_settings_pages_look_for() {
    // Settings, GameSettings and InstallFlow check
    // `navigator.userAgent.includes("Linux")`.
    assert!(frontend_user_agent("1.0.0", "Linux").contains("Linux"));
  }
}
