//! How the current process was started.
//!
//! The login autostart entry registers GameVault with `--minimized`, so a
//! start from the OS can be told apart from a manual launch - the same
//! argument reaches the binary on all three platforms:
//!
//! - Windows: `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` value
//! - macOS: `~/Library/LaunchAgents/<app>.plist` `ProgramArguments`
//! - Linux: `~/.config/autostart/<app>.desktop` `Exec` line
//!
//! See `tauri_plugin_autostart::init` in `lib.rs` for the registration.

/// Passed by the autostart entry, never by a normal launch.
pub(crate) const MINIMIZED_FLAG: &str = "--minimized";

/// Whether the process was started by the login autostart entry.
///
/// Only says *how* we were started; whether the window actually stays hidden
/// is decided by the `start_minimized` setting on top of this.
pub(crate) fn requested_start_minimized<I, S>(args: I) -> bool
where
  I: IntoIterator<Item = S>,
  S: AsRef<str>,
{
  args
    .into_iter()
    .any(|arg| arg.as_ref() == MINIMIZED_FLAG)
}

#[cfg(test)]
mod tests {
  use super::requested_start_minimized;

  #[test]
  fn detects_the_autostart_flag() {
    assert!(requested_start_minimized([
      "gamevault",
      "--minimized"
    ]));
    assert!(requested_start_minimized([
      "gamevault",
      "--gv-navigate",
      "downloads",
      "--minimized"
    ]));
  }

  #[test]
  fn normal_launches_are_not_minimized() {
    assert!(!requested_start_minimized(["gamevault"]));
    assert!(!requested_start_minimized([
      "gamevault",
      "--gv-launch-game",
      "42"
    ]));
    // Similar looking flags must not count.
    assert!(!requested_start_minimized([
      "gamevault",
      "--minimized=false"
    ]));
  }
}
