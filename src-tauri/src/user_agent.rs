//! User agent of the desktop webview.
//!
//! Without this the client identifies as the underlying browser engine plus the
//! OS, which is exactly what a server log or an analytics dashboard cannot use
//! to tell the desktop app apart from the Web UI.
//!
//! The platform part uses the tokens browsers put in their own user agent
//! (`Windows NT 10.0; Win64; x64`, `Macintosh; Intel Mac OS X 10_15_7`,
//! `X11; Linux x86_64`), because the parsers behind analytics dashboards and
//! server logs are written against those.

/// Platform token for a given OS and architecture, in browser order.
fn platform_token_for(os: &str, arch: &str) -> String {
  match os {
    "windows" => {
      let architecture = match arch {
        "x86_64" => "Win64; x64",
        "aarch64" => "ARM64",
        "x86" => "Win32",
        other => other,
      };
      format!("Windows NT 10.0; {architecture}")
    }
    // Browsers froze this string, so Apple Silicon reports the same token as
    // Intel.
    "macos" => "Macintosh; Intel Mac OS X 10_15_7".to_string(),
    "linux" => {
      let architecture = match arch {
        "x86" => "i686",
        "arm" => "armv7l",
        other => other,
      };
      format!("X11; Linux {architecture}")
    }
    other => other.to_string(),
  }
}

/// Platform token of the running system.
///
/// Browsers put "Linux" in the platform token, and the settings pages use that
/// to show Linux-only options, so the token keeps it.
pub(crate) fn platform_token() -> String {
  platform_token_for(std::env::consts::OS, std::env::consts::ARCH)
}

/// `GameVault/2.<version> (<platform>)`, e.g.
/// `GameVault/2.17.1.0 (Windows NT 10.0; Win64; x64)`.
pub(crate) fn frontend_user_agent(version: &str, platform: &str) -> String {
  format!("GameVault/2.{version} ({platform})")
}

#[cfg(test)]
mod tests {
  use super::{frontend_user_agent, platform_token, platform_token_for};

  #[test]
  fn builds_the_product_agent() {
    assert_eq!(
      frontend_user_agent("17.1.0", "Windows NT 10.0; Win64; x64"),
      "GameVault/2.17.1.0 (Windows NT 10.0; Win64; x64)"
    );
    assert_eq!(
      frontend_user_agent("17.1.0", "X11; Linux x86_64"),
      "GameVault/2.17.1.0 (X11; Linux x86_64)"
    );
  }

  #[test]
  fn uses_the_browser_tokens_analytics_parsers_expect() {
    assert_eq!(
      platform_token_for("windows", "x86_64"),
      "Windows NT 10.0; Win64; x64"
    );
    assert_eq!(
      platform_token_for("windows", "aarch64"),
      "Windows NT 10.0; ARM64"
    );
    assert_eq!(
      platform_token_for("macos", "aarch64"),
      "Macintosh; Intel Mac OS X 10_15_7"
    );
    assert_eq!(platform_token_for("linux", "x86_64"), "X11; Linux x86_64");
    assert_eq!(platform_token_for("linux", "aarch64"), "X11; Linux aarch64");
  }

  #[test]
  fn keeps_the_linux_token_the_settings_pages_look_for() {
    // Settings, GameSettings and InstallFlow check
    // `navigator.userAgent.includes("Linux")`.
    assert!(platform_token_for("linux", "x86_64").contains("Linux"));
    if std::env::consts::OS == "linux" {
      assert!(frontend_user_agent("1.0.0", &platform_token()).contains("Linux"));
    }
  }
}
