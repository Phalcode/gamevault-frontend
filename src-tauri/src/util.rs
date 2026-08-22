use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;

pub(crate) fn parse_version_folder(folder_name: &str) -> (i64, String) {
  if let Some(rest) = folder_name.strip_prefix('(') {
    if let Some((id_part, name_part)) = rest.split_once(')') {
      let version_id = id_part.trim().parse::<i64>().unwrap_or(0);
      return (version_id, name_part.trim().to_string());
    }
  }
  (0, folder_name.to_string())
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
  use super::{parse_version_folder, resolve_version_id};
  use serde_json::json;

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

#[cfg(windows)]
pub(crate) fn escape_powershell_single_quoted(value: &str) -> String {
  value.replace('\'', "''")
}

#[cfg(windows)]
pub(crate) fn run_elevated_installer_and_wait(
  executable: &str,
  argument_list: Option<&str>,
  working_directory: Option<&str>,
) -> Result<Option<i32>, String> {
  let file_path = escape_powershell_single_quoted(executable);
  let working_directory_segment = working_directory
    .filter(|value| !value.trim().is_empty())
    .map(escape_powershell_single_quoted)
    .map(|value| format!(" -WorkingDirectory '{value}'"))
    .unwrap_or_default();
  let script = if let Some(arguments) = argument_list.filter(|value| !value.trim().is_empty()) {
    let escaped_arguments = escape_powershell_single_quoted(arguments);
    format!(
      "$process = Start-Process -FilePath '{file_path}' -ArgumentList '{escaped_arguments}'{working_directory_segment} -Verb RunAs -Wait -PassThru; exit $process.ExitCode"
    )
  } else {
    format!(
      "$process = Start-Process -FilePath '{file_path}'{working_directory_segment} -Verb RunAs -Wait -PassThru; exit $process.ExitCode"
    )
  };

  let output = Command::new("powershell")
    .arg("-NoProfile")
    .arg("-Command")
    .arg(script)
    .output()
    .map_err(|error| format!("Failed to start elevated installer: {error}"))?;

  if output.status.success() {
    return Ok(output.status.code());
  }

  let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
  let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
  let message = if !stderr.is_empty() {
    stderr
  } else if !stdout.is_empty() {
    stdout
  } else {
    format!(
      "Elevated installer exited with code {}.",
      output.status.code().unwrap_or(-1)
    )
  };

  Err(message)
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
