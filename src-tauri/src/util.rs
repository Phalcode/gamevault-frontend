use serde::Serialize;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

/// Returns the free (available) disk space, in bytes, on the volume that
/// contains the given path. Returns `None` if the free space could not be
/// determined.
pub(crate) fn free_space_on(path: &Path) -> Option<u64> {
  use sysinfo::Disks;

  let disks = Disks::new_with_refreshed_list();
  let mut best: Option<(usize, &sysinfo::Disk)> = None;
  for disk in disks.list() {
    let mount = disk.mount_point();
    if path.starts_with(mount) {
      let depth = mount.components().count();
      if best.map(|(d, _)| depth > d).unwrap_or(true) {
        best = Some((depth, disk));
      }
    }
  }
  best.map(|(_, disk)| disk.available_space() as u64)
}

/// Returns `(total, available)` bytes on the volume that contains `path`.
/// Returns `None` if the disk could not be determined.
pub(crate) fn disk_space(path: &Path) -> Option<(u64, u64)> {
  use sysinfo::Disks;

  let disks = Disks::new_with_refreshed_list();
  let mut best: Option<(usize, &sysinfo::Disk)> = None;
  for disk in disks.list() {
    let mount = disk.mount_point();
    if path.starts_with(mount) {
      let depth = mount.components().count();
      if best.map(|(d, _)| depth > d).unwrap_or(true) {
        best = Some((depth, disk));
      }
    }
  }
  best.map(|(_, disk)| (disk.total_space(), disk.available_space()))
}

/// Recursively sums the size (in bytes) of every regular file under `path`.
/// Symlinks are skipped (to avoid following cycles) and unreadable entries are
/// ignored, so this is best-effort.
pub(crate) fn dir_size(path: &Path) -> u64 {
  let mut total = 0u64;
  if let Ok(entries) = fs::read_dir(path) {
    for entry in entries.flatten() {
      let entry_path = entry.path();
      let file_type = match entry.file_type() {
        Ok(ft) => ft,
        Err(_) => continue,
      };
      if file_type.is_symlink() {
        continue;
      }
      if file_type.is_dir() {
        total = total.saturating_add(dir_size(&entry_path));
      } else if file_type.is_file() {
        if let Ok(metadata) = entry.metadata() {
          total = total.saturating_add(metadata.len());
        }
      }
    }
  }
  total
}

/// Gives `file` the execute bits of `mode`, a Unix file mode, on top of the
/// permissions it already has.
///
/// Extraction and the install copy write files byte by byte, which creates
/// them without execute bits, so a game binary (like the one inside a macOS
/// app bundle) could not be started. Only the execute bits are taken: the
/// `zip` crate derives a mode for entries packed on Windows as well, and its
/// read-only flag must not reach installed files that games write to.
#[cfg(unix)]
pub(crate) fn add_execute_bits(file: &fs::File, mode: u32) -> std::io::Result<()> {
  use std::os::unix::fs::PermissionsExt;

  let execute = mode & 0o111;
  if execute == 0 {
    return Ok(());
  }
  let mut permissions = file.metadata()?.permissions();
  permissions.set_mode(permissions.mode() | execute);
  file.set_permissions(permissions)
}

/// POSIX file mode stored by 7-Zip on Unix in the high 16 bits of the Windows
/// attributes field. The `FILE_ATTRIBUTE_UNIX_EXTENSION` marker (0x8000) tells
/// it apart from plain Windows attributes, which carry no mode.
#[cfg(any(unix, test))]
pub(crate) fn unix_mode_from_7z_attributes(attributes: u32) -> Option<u32> {
  if attributes & 0x8000 == 0 {
    return None;
  }
  Some(attributes >> 16)
}

/// Whether the first bytes of a file look like a program the OS can run
/// directly: an ELF or Mach-O binary, or a script with a shebang.
#[cfg(any(unix, test))]
pub(crate) fn looks_like_executable(prefix: &[u8]) -> bool {
  const MAGIC: [&[u8]; 10] = [
    b"#!",
    b"\x7fELF",
    b"\xfe\xed\xfa\xce",
    b"\xce\xfa\xed\xfe",
    b"\xfe\xed\xfa\xcf",
    b"\xcf\xfa\xed\xfe",
    b"\xca\xfe\xba\xbe",
    b"\xbe\xba\xfe\xca",
    b"\xca\xfe\xba\xbf",
    b"\xbf\xba\xfe\xca",
  ];

  MAGIC.iter().any(|magic| prefix.starts_with(*magic))
}

pub(crate) fn parse_version_folder(folder_name: &str) -> (i64, String) {
  if let Some(rest) = folder_name.strip_prefix('(') {
    if let Some((id_part, name_part)) = rest.split_once(')') {
      let version_id = id_part.trim().parse::<i64>().unwrap_or(0);
      return (version_id, name_part.trim().to_string());
    }
  }
  (0, folder_name.to_string())
}

/// Opens the browser DevTools for the main window. Only meaningful in builds
/// compiled with the tauri `devtools` feature (enabled in Cargo.toml).
#[tauri::command]
pub(crate) fn open_devtools(app: tauri::AppHandle) {
  use tauri::Manager;
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.open_devtools();
  }
}


pub(crate) fn stable_id_from_path(path: &str) -> i64 {
  let mut hasher = std::collections::hash_map::DefaultHasher::new();
  path.hash(&mut hasher);
  (hasher.finish() & 0x7FFF_FFFF) as i64
}

pub(crate) fn parse_i64_json(value: Option<&serde_json::Value>) -> Option<i64> {
  match value {
    Some(v) => v
      .as_i64()
      .or_else(|| v.as_u64().map(|n| n as i64))
      .or_else(|| v.as_str().and_then(|s| s.trim().parse::<i64>().ok())),
    None => None,
  }
}

pub(crate) fn resolve_version_id(config: &serde_json::Value, folder_version_id: i64) -> i64 {
  parse_i64_json(config.get("versionid"))
    .filter(|id| *id > 0)
    .unwrap_or(folder_version_id)
}

/// Which server an installed version belongs to, resolved from its config or
/// the game folder's `.gamevault.metadata.json` discriminator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GameIdResolution {
  /// The version belongs to the current server and has this game id.
  GameId(i64),
  /// The version belongs to another server and must be hidden.
  NotThisServer,
  /// Ownership is acceptable, but no game id was recorded.
  Unknown,
}

/// One server that owns an installed version.
///
/// A version can be listed under several servers only for legacy installs whose
/// game-folder metadata map has no per-version ownership information.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstalledGameOwner {
  /// Canonical server URL when known. Used for labels and cache namespaces.
  pub server_url: Option<String>,
  /// URLs/UUIDs that identify this server.
  pub identifiers: Vec<String>,
  /// Game id on this server; 0 when it could not be resolved.
  pub game_id: i64,
}

/// Metadata keys that are preferences, not server identifiers.
const NON_SERVER_METADATA_KEYS: [&str; 4] = [
  "installer_executable",
  "installer_parameters",
  "uninstaller_executable",
  "uninstaller_parameters",
];

fn normalized_server_url(value: &str) -> Option<String> {
  let mut parsed = url::Url::parse(value.trim()).ok()?;
  let _ = parsed.set_username("");
  let _ = parsed.set_password(None);
  parsed.set_query(None);
  parsed.set_fragment(None);
  let path = parsed.path().trim_end_matches('/');
  Some(format!(
    "{}{}",
    parsed.origin().ascii_serialization().to_lowercase(),
    if path == "/" { "" } else { path }
  ))
}

fn normalize_server_key(value: &str) -> String {
  normalized_server_url(value)
    .unwrap_or_else(|| value.trim().trim_end_matches('/').to_string())
}

#[derive(Clone)]
struct MetadataServerEntry {
  /// Normalized key used for matching (`https://…` or a UUID).
  identifier: String,
  /// Normalized URL when the key is a URL.
  url: Option<String>,
  game_id: i64,
}

fn metadata_server_entries(
  metadata: Option<&serde_json::Value>,
) -> Vec<MetadataServerEntry> {
  metadata
    .and_then(|value| value.as_object())
    .map(|object| {
      object
        .iter()
        .filter(|(key, _)| {
          !NON_SERVER_METADATA_KEYS
            .iter()
            .any(|known| known.eq_ignore_ascii_case(key.as_str()))
        })
        .filter_map(|(key, value)| {
          let game_id = parse_i64_json(Some(value)).filter(|id| *id > 0)?;
          let url = normalized_server_url(key);
          Some(MetadataServerEntry {
            identifier: url
              .clone()
              .unwrap_or_else(|| normalize_server_key(key)),
            url,
            game_id,
          })
        })
        .collect()
    })
    .unwrap_or_default()
}

fn metadata_id_for_identifiers(
  entries: &[MetadataServerEntry],
  identifiers: &[String],
) -> Option<i64> {
  identifiers.iter().find_map(|identifier| {
    let candidate = normalize_server_key(identifier);
    entries
      .iter()
      .find(|entry| entry.identifier == candidate)
      .map(|entry| entry.game_id)
  })
}

/// Resolves every server a version can belong to.
///
/// New installs record exact ownership in the version config. Legacy installs
/// fall back to the game-folder metadata map; URL keys are preferred over bare
/// UUID keys so a modern URL+UUID pair is only reported once.
pub(crate) fn resolve_installed_owners(
  config: &serde_json::Value,
  folder_metadata: Option<&serde_json::Value>,
) -> Vec<InstalledGameOwner> {
  let config_game_id =
    parse_i64_json(config.get("gameid")).filter(|id| *id > 0);
  let entries = metadata_server_entries(folder_metadata);

  let config_uuid = config
    .get("serveruuid")
    .and_then(|value| value.as_str())
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());
  let config_url = config
    .get("serverurl")
    .and_then(|value| value.as_str())
    .map(|value| normalize_server_key(value))
    .filter(|value| !value.is_empty());

  if config_uuid.is_some() || config_url.is_some() {
    let mut identifiers: Vec<String> = Vec::new();
    if let Some(url) = &config_url {
      identifiers.push(url.clone());
    }
    if let Some(uuid) = &config_uuid {
      if !identifiers.contains(uuid) {
        identifiers.push(uuid.clone());
      }
    }
    let game_id = config_game_id
      .or_else(|| metadata_id_for_identifiers(&entries, &identifiers))
      .or_else(|| entries.first().map(|entry| entry.game_id))
      .unwrap_or(0);
    return vec![InstalledGameOwner {
      server_url: config_url,
      identifiers,
      game_id,
    }];
  }

  if entries.is_empty() {
    return Vec::new();
  }

  let url_entries: Vec<&MetadataServerEntry> =
    entries.iter().filter(|entry| entry.url.is_some()).collect();
  let owners = if url_entries.is_empty() {
    entries
      .iter()
      .map(|entry| InstalledGameOwner {
        server_url: None,
        identifiers: vec![entry.identifier.clone()],
        game_id: entry.game_id,
      })
      .collect()
  } else {
    url_entries
      .iter()
      .map(|entry| InstalledGameOwner {
        server_url: entry.url.clone(),
        identifiers: vec![entry.identifier.clone()],
        game_id: entry.game_id,
      })
      .collect()
  };

  owners
}

/// Returns the owner matching one of the current server identifiers.
pub(crate) fn owner_for_server<'a>(
  owners: &'a [InstalledGameOwner],
  server_identifiers: &[String],
) -> Option<&'a InstalledGameOwner> {
  if server_identifiers.is_empty() {
    return owners.first();
  }

  owners.iter().find(|owner| {
    server_identifiers.iter().any(|identifier| {
      let candidate = normalize_server_key(identifier);
      owner.identifiers.iter().any(|known| known == &candidate)
    })
  })
}

/// Resolves an installed version's game id for the current server.
///
/// `server_identifiers` empty preserves the old "first owner" behavior for
/// diagnostics. A version without any ownership marker keeps the legacy
/// fallback based on its configured game id.
pub(crate) fn resolve_installed_game_id(
  config: &serde_json::Value,
  folder_metadata: Option<&serde_json::Value>,
  server_identifiers: &[String],
) -> GameIdResolution {
  let config_game_id =
    parse_i64_json(config.get("gameid")).filter(|id| *id > 0);
  let owners = resolve_installed_owners(config, folder_metadata);

  if owners.is_empty() {
    return config_game_id
      .map(GameIdResolution::GameId)
      .unwrap_or(GameIdResolution::Unknown);
  }

  if server_identifiers.is_empty() {
    return config_game_id
      .or_else(|| owners.first().map(|owner| owner.game_id))
      .filter(|id| *id > 0)
      .map(GameIdResolution::GameId)
      .unwrap_or(GameIdResolution::Unknown);
  }

  match owner_for_server(&owners, server_identifiers) {
    Some(owner) if owner.game_id > 0 => GameIdResolution::GameId(owner.game_id),
    Some(_) => GameIdResolution::Unknown,
    None => GameIdResolution::NotThisServer,
  }
}

pub(crate) fn resolve_version_subdir(version_path: &Path, preferred: &str, legacy: &str) -> PathBuf {
  let preferred_path = version_path.join(preferred);
  if preferred_path.exists() {
    return preferred_path;
  }

  let legacy_path = version_path.join(legacy);
  if legacy_path.exists() {
    return legacy_path;
  }

  preferred_path
}

#[cfg(test)]
mod tests {
  use super::{
    looks_like_executable, parse_version_folder, resolve_installed_game_id,
    resolve_installed_owners, resolve_version_id,
    unix_mode_from_7z_attributes, GameIdResolution,
  };
  use serde_json::json;

  fn identifiers(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
  }

  #[test]
  fn parses_legacy_version_folder() {
    assert_eq!(
      parse_version_folder("(775) v1.0.61"),
      (775, "v1.0.61".to_string()),
    );
  }

  #[test]
  fn uses_config_version_id_for_name_only_folder() {
    assert_eq!(resolve_version_id(&json!({ "versionid": 775 }), 0), 775);
  }

  #[test]
  fn falls_back_to_legacy_folder_version_id() {
    assert_eq!(resolve_version_id(&json!({}), 775), 775);
  }

  #[test]
  fn matches_new_version_config_by_server_uuid() {
    let config = json!({
      "gameid": 42,
      "serveruuid": "uuid-a",
      "serverurl": "https://a.example",
    });
    let metadata = json!({ "uuid-b": 7, "uuid-a": 42 });

    assert_eq!(
      resolve_installed_game_id(&config, Some(&metadata), &identifiers(&["uuid-a"])),
      GameIdResolution::GameId(42),
    );
  }

  #[test]
  fn matches_new_version_config_by_normalized_url() {
    let config = json!({
      "gameid": 42,
      "serverurl": "https://a.example/",
    });

    assert_eq!(
      resolve_installed_game_id(
        &config,
        None,
        &identifiers(&["https://a.example"]),
      ),
      GameIdResolution::GameId(42),
    );
  }

  #[test]
  fn hides_new_version_config_for_another_server() {
    let config = json!({
      "gameid": 42,
      "serverurl": "https://a.example",
    });

    assert_eq!(
      resolve_installed_game_id(
        &config,
        None,
        &identifiers(&["https://b.example", "uuid-b"]),
      ),
      GameIdResolution::NotThisServer,
    );
  }

  #[test]
  fn resolves_legacy_install_from_folder_metadata() {
    let metadata = json!({
      "uuid-b": 7,
      "uuid-a": 42,
      "installer_executable": "setup.exe",
      "installer_parameters": "/S",
    });

    assert_eq!(
      resolve_installed_game_id(
        &json!({}),
        Some(&metadata),
        &identifiers(&["uuid-a", "https://a.example"]),
      ),
      GameIdResolution::GameId(42),
    );
  }

  #[test]
  fn hides_legacy_install_of_another_server() {
    let metadata = json!({ "uuid-a": 42, "installer_executable": "setup.exe" });

    assert_eq!(
      resolve_installed_game_id(
        &json!({}),
        Some(&metadata),
        &identifiers(&["uuid-b", "https://b.example"]),
      ),
      GameIdResolution::NotThisServer,
    );
  }

  #[test]
  fn normalizes_legacy_metadata_urls() {
    let metadata = json!({ "https://A.Example/GameVault/": 42 });

    assert_eq!(
      resolve_installed_game_id(
        &json!({}),
        Some(&metadata),
        &identifiers(&["https://a.example/GameVault"]),
      ),
      GameIdResolution::GameId(42),
    );
  }

  #[test]
  fn keeps_legacy_install_without_server_marker() {
    let metadata = json!({ "installer_executable": "setup.exe" });

    assert_eq!(
      resolve_installed_game_id(
        &json!({ "gameid": 42 }),
        Some(&metadata),
        &identifiers(&["https://b.example"]),
      ),
      GameIdResolution::GameId(42),
    );
  }

  #[test]
  fn returns_unknown_without_any_game_id() {
    assert_eq!(
      resolve_installed_game_id(
        &json!({ "serverurl": "https://a.example" }),
        None,
        &identifiers(&["https://a.example"]),
      ),
      GameIdResolution::Unknown,
    );
  }

  #[test]
  fn ignores_preference_keys_that_look_numeric() {
    let metadata = json!({
      "installer_parameters": "7",
      "uninstaller_parameters": "8",
    });

    assert_eq!(
      resolve_installed_game_id(
        &json!({}),
        Some(&metadata),
        &identifiers(&["https://a.example"]),
      ),
      GameIdResolution::Unknown,
    );
  }

  #[test]
  fn reports_new_install_ownership_once() {
    let config = json!({
      "gameid": 42,
      "serveruuid": "uuid-a",
      "serverurl": "https://a.example/",
    });

    let owners = resolve_installed_owners(&config, None);

    assert_eq!(owners.len(), 1);
    assert_eq!(owners[0].server_url.as_deref(), Some("https://a.example"));
    assert_eq!(owners[0].game_id, 42);
    assert_eq!(
      owners[0].identifiers,
      vec!["https://a.example", "uuid-a"]
    );
  }

  #[test]
  fn prefers_legacy_url_keys_over_uuid_aliases() {
    let metadata = json!({
      "https://a.example": 42,
      "uuid-a": 42,
    });

    let owners = resolve_installed_owners(&json!({}), Some(&metadata));

    assert_eq!(owners.len(), 1);
    assert_eq!(owners[0].server_url.as_deref(), Some("https://a.example"));
    assert_eq!(owners[0].identifiers, vec!["https://a.example"]);
  }

  #[test]
  fn reports_two_legacy_server_owners() {
    let metadata = json!({
      "https://a.example": 42,
      "https://b.example": 7,
    });

    let owners = resolve_installed_owners(&json!({}), Some(&metadata));

    assert_eq!(owners.len(), 2);
    assert_eq!(
      owners
        .iter()
        .map(|owner| owner.game_id)
        .collect::<Vec<_>>(),
      vec![42, 7]
    );
  }

  #[cfg(unix)]
  #[test]
  fn adds_only_the_execute_bits_of_a_unix_mode() {
    use super::add_execute_bits;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    let path = std::env::temp_dir().join(format!(
      "gamevault-execute-bits-{}",
      std::process::id()
    ));
    let file = fs::File::create(&path).expect("create file");
    let set = |mode: u32| {
      file
        .set_permissions(fs::Permissions::from_mode(mode))
        .expect("set permissions")
    };
    let mode = || file.metadata().expect("read permissions").permissions().mode() & 0o777;

    // A program in a ZIP archive made on macOS or Linux.
    set(0o644);
    add_execute_bits(&file, 0o100755).expect("add execute bits");
    assert_eq!(mode(), 0o755);

    // Only its owner may run it. The other permissions stay as they are.
    set(0o644);
    add_execute_bits(&file, 0o100700).expect("add execute bits");
    assert_eq!(mode(), 0o744);

    // The modes the zip crate derives for entries packed on Windows, plain
    // and read-only, leave the file as it is.
    set(0o644);
    add_execute_bits(&file, 0o100664).expect("add execute bits");
    add_execute_bits(&file, 0o100444).expect("add execute bits");
    assert_eq!(mode(), 0o644);

    drop(file);
    let _ = fs::remove_file(&path);
  }

  #[test]
  fn reads_posix_modes_from_7z_attributes() {
    assert_eq!(
      unix_mode_from_7z_attributes(0x8000 | (0o100755 << 16)),
      Some(0o100755),
    );
    assert_eq!(
      unix_mode_from_7z_attributes(0x8000 | (0o100644 << 16)),
      Some(0o100644),
    );
    // Plain Windows attributes, like the DOS archive bit, carry no mode.
    assert_eq!(unix_mode_from_7z_attributes(0x20), None);
    assert_eq!(unix_mode_from_7z_attributes(0), None);
  }

  #[test]
  fn recognizes_executables_by_their_magic() {
    assert!(looks_like_executable(b"\x7fELF\x02\x01\x01"));
    assert!(looks_like_executable(b"\xcf\xfa\xed\xfe"));
    assert!(looks_like_executable(b"\xca\xfe\xba\xbe"));
    assert!(looks_like_executable(b"#!/bin/sh\n"));
    assert!(!looks_like_executable(b"PK\x03\x04"));
    assert!(!looks_like_executable(b"MZ\x90\x00"));
    assert!(!looks_like_executable(b""));
  }
}

pub(crate) fn read_saved_game_metadata(start_path: &Path) -> Option<serde_json::Value> {
  for ancestor in start_path.ancestors() {
    let metadata_path = ancestor.join(".gamevault.metadata.json");
    if !metadata_path.exists() {
      continue;
    }

    if let Ok(content) = fs::read_to_string(&metadata_path) {
      if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
        return Some(parsed);
      }
    }
  }

  None
}

pub(crate) fn read_saved_installer_preferences(start_path: &Path) -> (Option<String>, Option<String>) {
  let metadata = read_saved_game_metadata(start_path);
  let installer_executable = metadata
    .as_ref()
    .and_then(|value| value.get("installer_executable"))
    .and_then(|value| value.as_str())
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());
  let installer_parameters = metadata
    .as_ref()
    .and_then(|value| value.get("installer_parameters"))
    .and_then(|value| value.as_str())
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());

  (installer_executable, installer_parameters)
}

/// Launches the installer elevated (UAC) via `ShellExecuteExW` directly.
///
/// This bypasses PowerShell entirely. `Start-Process -FilePath` performs
/// PowerShell wildcard resolution, so folder/file names containing wildcard
/// metacharacters (`[`, `]`, `*`, `?` — e.g. repack folder names like
/// "… [Vanya Repack]") make it fail with "wildcard path … did not resolve to
/// a file". `ShellExecuteExW` passes `lpFile`/`lpDirectory` literally — no
/// globbing, no quoting layer — so bracket- and space-containing paths work.
#[cfg(windows)]
pub(crate) fn run_elevated_installer_and_wait(
  executable: &str,
  argument_list: Option<&str>,
  working_directory: Option<&str>,
) -> Result<Option<i32>, String> {
  use std::ffi::OsStr;
  use std::iter::once;
  use std::os::windows::ffi::OsStrExt;
  use winapi::um::handleapi::CloseHandle;
  use winapi::um::processthreadsapi::GetExitCodeProcess;
  use winapi::um::shellapi::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
  use winapi::um::synchapi::WaitForSingleObject;
  use winapi::um::winbase::INFINITE;
  use winapi::um::winuser::SW_SHOWNORMAL;

  fn to_wide(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(once(0)).collect()
  }

  let executable = to_wide(executable);
  let verb = to_wide("runas");
  let arguments = argument_list
    .filter(|value| !value.trim().is_empty())
    .map(|value| to_wide(value));
  let directory = working_directory
    .filter(|value| !value.trim().is_empty())
    .map(|value| to_wide(value));

  let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
  info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
  // NOCLOSEPROCESS gives us a handle we can wait on and read the exit code
  // from. All paths are passed literally — no PowerShell, no wildcard
  // resolution, so bracket paths just work.
  info.fMask = SEE_MASK_NOCLOSEPROCESS;
  info.lpVerb = verb.as_ptr();
  info.lpFile = executable.as_ptr();
  info.lpParameters = arguments
    .as_ref()
    .map_or(std::ptr::null(), |value| value.as_ptr());
  info.lpDirectory = directory
    .as_ref()
    .map_or(std::ptr::null(), |value| value.as_ptr());
  info.nShow = SW_SHOWNORMAL;

  let launched = unsafe { ShellExecuteExW(&mut info) };
  if launched == 0 {
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(1223) {
      return Err("Installation canceled by user (UAC prompt declined).".to_string());
    }
    return Err(format!("Failed to launch elevated installer: {error}"));
  }

  if info.hProcess.is_null() {
    return Ok(None);
  }

  unsafe {
    WaitForSingleObject(info.hProcess, INFINITE);
    let mut exit_code: u32 = 0;
    let valid = GetExitCodeProcess(info.hProcess, &mut exit_code);
    CloseHandle(info.hProcess);
    if valid == 0 {
      return Ok(None);
    }
    Ok(Some(exit_code as i32))
  }
}

/// Compare two paths for equality.
/// Windows: case-insensitive with canonicalized separators.
/// Linux: exact match.
pub(crate) fn paths_match(a: &Path, b: &Path) -> bool {
  #[cfg(windows)]
  {
    let a_str = a.to_string_lossy().to_lowercase().replace('/', "\\");
    let b_str = b.to_string_lossy().to_lowercase().replace('/', "\\");
    a_str == b_str
  }
  #[cfg(not(windows))]
  {
    // The process exe reported by /proc/<pid>/exe is canonicalized (symlinks
    // resolved), while the game exe path is built from the configured install
    // directory which may itself contain symlinks. Canonicalize before
    // comparing so a game launched through a symlinked path still matches.
    let a = fs::canonicalize(a).unwrap_or_else(|_| a.to_path_buf());
    let b = fs::canonicalize(b).unwrap_or_else(|_| b.to_path_buf());
    a == b
  }
}

/// True when the executable's base name (without extension) is in `ignored`.
/// Matching is case-insensitive; ignore-list entries have no extension.
pub(crate) fn is_ignored_executable(path: &Path, ignored: &[String]) -> bool {
  let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
    return false;
  };
  let stem_lower = stem.to_lowercase();
  ignored
    .iter()
    .any(|name| name.to_lowercase() == stem_lower)
}
