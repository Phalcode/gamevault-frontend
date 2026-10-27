use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// This module manages the auto-unlock password for the Stronghold vault.
///
/// The Stronghold vault (see `tauri-plugin-stronghold`) stores the auth refresh
/// token encrypted at rest. To unlock it automatically across restarts (so the
/// user stays logged in without re-entering a password), we keep a random vault
/// password in the app's local data directory, restricted to the current user.
///
/// This is a pragmatic cross-platform trade-off: Stronghold is the official
/// Tauri secret-store plugin and works on Windows, macOS and Linux, but it
/// requires a password to derive the encryption key. Persisting that password
/// in an owner-only file moves the token out of the webview's `localStorage`
/// (immune to XSS / injected JS) and protects it from casual inspection. For
/// stronger hardening this password could instead be stored in the OS keychain
/// (Keychain / Credential Manager / Secret Service) — the structure here is
/// isolated so that can be swapped in without touching the frontend.
fn vault_password_path(app: &tauri::AppHandle) -> PathBuf {
  app.path()
    .app_local_data_dir()
    .unwrap_or_else(|_| app.path().app_data_dir().unwrap())
    .join("vault-password")
}

fn generate_random_password() -> String {
  let mut bytes = [0u8; 32];
  if getrandom::getrandom(&mut bytes).is_err() {
    // Extremely unlikely: fall back to a unique timestamp so the app can still
    // start rather than failing to produce a password.
    let now = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|d| d.as_nanos())
      .unwrap_or(0);
    return format!("gv-{:x}-{:x}", now, std::process::id());
  }
  bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Returns the Stronghold vault password, creating and persisting it on first
/// run so the vault can be unlocked automatically on subsequent launches.
/// On Unix the file is restricted to its owner (mode 0600).
#[tauri::command]
pub(crate) fn get_or_create_vault_password(app: tauri::AppHandle) -> Result<String, String> {
  let path = vault_password_path(&app);

  if let Ok(existing) = fs::read_to_string(&path) {
    let trimmed = existing.trim();
    if !trimmed.is_empty() {
      return Ok(trimmed.to_string());
    }
  }

  let password = generate_random_password();

  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("Failed to create data dir: {}", e))?;
  }
  fs::write(&path, &password).map_err(|e| format!("Failed to write vault password: {}", e))?;

  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    if let Err(e) = fs::set_permissions(&path, fs::Permissions::from_mode(0o600)) {
      eprintln!("Failed to set 0600 permissions on vault password: {}", e);
    }
  }

  Ok(password)
}
