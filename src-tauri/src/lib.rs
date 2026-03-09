use futures_util::StreamExt;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{
  atomic::{AtomicBool, Ordering},
  Arc, Mutex, OnceLock,
};
use std::time::{Duration, Instant};
use tauri::Emitter;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use unrar::Archive;

static DOWNLOAD_CANCEL_FLAGS: OnceLock<Mutex<HashMap<i64, Arc<AtomicBool>>>> = OnceLock::new();

fn cancel_flags() -> &'static Mutex<HashMap<i64, Arc<AtomicBool>>> {
  DOWNLOAD_CANCEL_FLAGS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DownloadProgressEvent {
  game_id: i64,
  status: String,
  received: u64,
  total: Option<u64>,
  error: Option<String>,
  filename: Option<String>,
  file_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtractArchiveResponse {
  success: bool,
  needs_password: bool,
  message: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RecoveredDownloadCard {
  game_id: i64,
  version_id: i64,
  game_title: String,
  game_metadata: Option<serde_json::Value>,
  version_name: String,
  filename: String,
  download_directory: String,
  extraction_directory: String,
  installation_directory: String,
  version_directory: String,
  downloaded_file_path: Option<String>,
  received: u64,
  total: Option<u64>,
  progress: f64,
  status: String,
  extraction_status: String,
  extraction_progress: Option<f64>,
}

fn parse_version_folder(folder_name: &str) -> (i64, String) {
  if let Some(rest) = folder_name.strip_prefix('(') {
    if let Some((id_part, name_part)) = rest.split_once(')') {
      let version_id = id_part.trim().parse::<i64>().unwrap_or(0);
      return (version_id, name_part.trim().to_string());
    }
  }
  (0, folder_name.to_string())
}

fn stable_id_from_path(path: &str) -> i64 {
  let mut hasher = std::collections::hash_map::DefaultHasher::new();
  path.hash(&mut hasher);
  (hasher.finish() & 0x7FFF_FFFF) as i64
}

#[tauri::command]
fn recover_download_cards(selected_root: String) -> Result<Vec<RecoveredDownloadCard>, String> {
  let candidate = PathBuf::from(&selected_root).join("GameVault");
  let root = if candidate.exists() {
    candidate
  } else {
    PathBuf::from(&selected_root)
  };

  if !root.exists() || !root.is_dir() {
    return Ok(Vec::new());
  }

  let mut cards: Vec<RecoveredDownloadCard> = Vec::new();

  let game_dirs = fs::read_dir(&root).map_err(|e| format!("Failed to read GameVault root: {e}"))?;
  for game_entry in game_dirs.flatten() {
    let game_path = game_entry.path();
    if !game_path.is_dir() {
      continue;
    }

    let game_name = game_entry.file_name().to_string_lossy().to_string();

    let metadata_path = game_path.join(".gamevault.metadata.json");
    let game_metadata: Option<serde_json::Value> = if metadata_path.exists() {
      fs::read_to_string(&metadata_path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
    } else {
      None
    };

    let resolved_game_title = game_metadata
      .as_ref()
      .and_then(|m| m.get("title"))
      .and_then(|v| v.as_str())
      .map(|s| s.trim().to_string())
      .filter(|s| !s.is_empty())
      .unwrap_or(game_name);

    let versions_root = game_path.join("Versions");
    if !versions_root.exists() || !versions_root.is_dir() {
      continue;
    }

    let version_dirs = fs::read_dir(&versions_root)
      .map_err(|e| format!("Failed to read versions folder: {e}"))?;
    for version_entry in version_dirs.flatten() {
      let version_path = version_entry.path();
      if !version_path.is_dir() {
        continue;
      }

      let version_folder_name = version_entry.file_name().to_string_lossy().to_string();
      let (version_id, version_name) = parse_version_folder(&version_folder_name);

      let config_path = version_path.join(".gamevault.game.config.json");
      if !config_path.exists() {
        continue;
      }

      let cfg_value = fs::read_to_string(&config_path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));

      let download_finished = cfg_value
        .get("downloadfinished")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
      let extraction_finished = cfg_value
        .get("extractionfinished")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

      let downloads_dir = version_path.join("Downloads");
      let extractions_dir = version_path.join("Extractions");
      let installations_dir = version_path.join("Installations");

      let mut filename = format!("{}.bin", resolved_game_title);
      let mut downloaded_file_path: Option<String> = None;
      let mut file_size = 0u64;

      if downloads_dir.exists() && downloads_dir.is_dir() {
        if let Ok(files) = fs::read_dir(&downloads_dir) {
          if let Some(file) = files
            .flatten()
            .map(|e| e.path())
            .find(|p| p.is_file())
          {
            if let Some(name) = file.file_name().and_then(|n| n.to_str()) {
              filename = name.to_string();
            }
            file_size = fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
            downloaded_file_path = Some(file.to_string_lossy().to_string());
          }
        }
      }

      let version_path_str = version_path.to_string_lossy().to_string();
      cards.push(RecoveredDownloadCard {
        game_id: stable_id_from_path(&version_path_str),
        version_id,
        game_title: resolved_game_title.clone(),
        game_metadata: game_metadata.clone(),
        version_name,
        filename,
        download_directory: downloads_dir.to_string_lossy().to_string(),
        extraction_directory: extractions_dir.to_string_lossy().to_string(),
        installation_directory: installations_dir.to_string_lossy().to_string(),
        version_directory: version_path_str,
        downloaded_file_path,
        received: if download_finished { file_size } else { 0 },
        total: if download_finished { Some(file_size) } else { None },
        progress: if download_finished { 100.0 } else { 0.0 },
        status: if download_finished {
          "completed".to_string()
        } else {
          "aborted".to_string()
        },
        extraction_status: if extraction_finished {
          "completed".to_string()
        } else {
          "idle".to_string()
        },
        extraction_progress: if extraction_finished { Some(100.0) } else { None },
      });
    }
  }

  Ok(cards)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExtractProgressEvent {
  game_id: i64,
  status: String,
  processed: u64,
  total: Option<u64>,
  progress: Option<f64>,
  current_file: Option<String>,
  error: Option<String>,
}

fn emit_extract_progress(
  app: &tauri::AppHandle,
  game_id: i64,
  status: &str,
  processed: u64,
  total: Option<u64>,
  current_file: Option<String>,
  error: Option<String>,
) {
  let progress = match total {
    Some(t) if t > 0 => Some((processed as f64 / t as f64) * 100.0),
    _ => None,
  };

  let _ = app.emit(
    "extract-progress",
    ExtractProgressEvent {
      game_id,
      status: status.to_string(),
      processed,
      total,
      progress,
      current_file,
      error,
    },
  );
}

fn extract_zip_archive(
  app: &tauri::AppHandle,
  game_id: i64,
  archive: &PathBuf,
  destination: &PathBuf,
  password: Option<&str>,
) -> Result<(), (bool, String)> {
  let file = fs::File::open(archive)
    .map_err(|e| (false, format!("Failed to open archive: {e}")))?;
  let mut zip = zip::ZipArchive::new(file)
    .map_err(|e| (false, format!("Invalid ZIP archive: {e}")))?;

  let total_entries = zip.len() as u64;
  emit_extract_progress(app, game_id, "extracting", 0, Some(total_entries), None, None);
  let mut processed = 0u64;

  for i in 0..zip.len() {
    let mut entry = if let Some(pw) = password.filter(|v| !v.trim().is_empty()) {
      zip.by_index_decrypt(i, pw.as_bytes()).map_err(|e| {
        let msg = e.to_string();
        let lower = msg.to_lowercase();
        (
          lower.contains("password") || lower.contains("encrypted"),
          format!("ZIP extraction failed: {msg}"),
        )
      })?
    } else {
      zip.by_index(i).map_err(|e| {
        let msg = e.to_string();
        let lower = msg.to_lowercase();
        (
          lower.contains("password") || lower.contains("encrypted"),
          format!("ZIP extraction failed: {msg}"),
        )
      })?
    };

    let out_rel = match entry.enclosed_name() {
      Some(path) => path.to_owned(),
      None => continue,
    };
    let current_file = out_rel.to_string_lossy().to_string();
    let out_path = destination.join(out_rel);

    if entry.name().ends_with('/') {
      fs::create_dir_all(&out_path)
        .map_err(|e| (false, format!("Failed to create directory: {e}")))?;
      continue;
    }

    if let Some(parent) = out_path.parent() {
      fs::create_dir_all(parent)
        .map_err(|e| (false, format!("Failed to create parent directory: {e}")))?;
    }

    let mut out_file = fs::File::create(&out_path)
      .map_err(|e| (false, format!("Failed to create output file: {e}")))?;
    std::io::copy(&mut entry, &mut out_file)
      .map_err(|e| (false, format!("Failed to write output file: {e}")))?;

    processed += 1;
    emit_extract_progress(
      app,
      game_id,
      "extracting",
      processed,
      Some(total_entries),
      Some(current_file),
      None,
    );
  }

  Ok(())
}

fn extract_rar_archive(
  app: &tauri::AppHandle,
  game_id: i64,
  archive: &PathBuf,
  destination: &PathBuf,
  password: Option<&str>,
) -> Result<(), (bool, String)> {
  let pw = password.filter(|v| !v.trim().is_empty());

  let total_entries = {
    let mut listing = if let Some(pw) = pw {
      Archive::with_password(archive, pw)
        .open_for_listing()
        .map_err(|e| (false, format!("Failed to read RAR archive: {e}")))?
    } else {
      Archive::new(archive)
        .open_for_listing()
        .map_err(|e| (false, format!("Failed to read RAR archive: {e}")))?
    };

    let mut count = 0u64;
    while let Some(entry) = listing.next() {
      entry.map_err(|e| {
        let msg = e.to_string();
        let lower = msg.to_lowercase();
        (
          lower.contains("password") || lower.contains("encrypted"),
          format!("RAR listing failed: {msg}"),
        )
      })?;
      count += 1;
    }
    count
  };

  emit_extract_progress(app, game_id, "extracting", 0, Some(total_entries), None, None);

  let mut processing = if let Some(pw) = pw {
    Archive::with_password(archive, pw)
      .open_for_processing()
      .map_err(|e| (false, format!("Failed to open RAR archive: {e}")))?
  } else {
    Archive::new(archive)
      .open_for_processing()
      .map_err(|e| (false, format!("Failed to open RAR archive: {e}")))?
  };

  let mut processed = 0u64;
  while let Some(header) = processing.read_header().map_err(|e| {
    let msg = e.to_string();
    let lower = msg.to_lowercase();
    (
      lower.contains("password") || lower.contains("encrypted"),
      format!("RAR header read failed: {msg}"),
    )
  })? {
    let current_file = header.entry().filename.to_string_lossy().to_string();
    processing = header.extract_with_base(destination).map_err(|e| {
      let msg = e.to_string();
      let lower = msg.to_lowercase();
      (
        lower.contains("password") || lower.contains("encrypted"),
        format!("RAR extraction failed: {msg}"),
      )
    })?;

    processed += 1;
    emit_extract_progress(
      app,
      game_id,
      "extracting",
      processed,
      Some(total_entries),
      Some(current_file),
      None,
    );
  }

  Ok(())
}

fn extract_7z_archive(
  app: &tauri::AppHandle,
  game_id: i64,
  archive: &PathBuf,
  destination: &PathBuf,
  password: Option<&str>,
) -> Result<(), (bool, String)> {
  let pw = password
    .filter(|v| !v.trim().is_empty())
    .map(sevenz_rust2::Password::from)
    .unwrap_or_else(sevenz_rust2::Password::empty);

  let mut reader = sevenz_rust2::ArchiveReader::open(archive, pw.clone()).map_err(|e| {
    let msg = e.to_string();
    let lower = msg.to_lowercase();
    (
      lower.contains("password") || lower.contains("aes") || lower.contains("crypto"),
      msg,
    )
  })?;

  let total_size: u64 = reader
    .archive()
    .files
    .iter()
    .filter(|e| e.has_stream())
    .map(|e| e.size())
    .sum();

  emit_extract_progress(app, game_id, "extracting", 0, Some(total_size), None, None);

  let mut written_size = 0u64;
  let mut buffer = [0u8; 8192];

  reader
    .for_each_entries(|entry, entry_reader| {
      let dest_path = destination.join(entry.name());
      if entry.is_directory() {
        fs::create_dir_all(&dest_path)?;
        emit_extract_progress(
          app,
          game_id,
          "extracting",
          written_size,
          Some(total_size),
          Some(entry.name().to_string()),
          None,
        );
        return Ok(true);
      }

      if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent)?;
      }

      let mut output = fs::File::create(&dest_path)?;
      loop {
        let read_size = entry_reader.read(&mut buffer)?;
        if read_size == 0 {
          break;
        }
        output.write_all(&buffer[..read_size])?;
        written_size += read_size as u64;
      }

      emit_extract_progress(
        app,
        game_id,
        "extracting",
        written_size,
        Some(total_size),
        Some(entry.name().to_string()),
        None,
      );

      Ok(true)
    })
    .map_err(|e| {
      let msg = e.to_string();
      let lower = msg.to_lowercase();
      (
        lower.contains("password") || lower.contains("aes") || lower.contains("crypto"),
        msg,
      )
    })?;

  Ok(())
}

fn archive_file_name_lowercase(path: &Path) -> String {
  path
    .file_name()
    .and_then(|name| name.to_str())
    .map(|name| name.to_ascii_lowercase())
    .unwrap_or_default()
}

fn is_tar_based_path(path: &Path) -> bool {
  let name = archive_file_name_lowercase(path);
  name.ends_with(".tar")
    || name.ends_with(".tar.gz")
    || name.ends_with(".tgz")
    || name.ends_with(".tar.bz2")
    || name.ends_with(".tbz")
    || name.ends_with(".tbz2")
    || name.ends_with(".tar.xz")
    || name.ends_with(".txz")
    || name.ends_with(".tar.zst")
    || name.ends_with(".tzst")
}

fn single_file_output_name(path: &Path) -> String {
  let file_name = path
    .file_name()
    .and_then(|name| name.to_str())
    .unwrap_or("extracted.bin");
  let lower = file_name.to_ascii_lowercase();

  let stripped = [".gz", ".bz2", ".xz", ".zst"]
    .iter()
    .find_map(|ext| lower.strip_suffix(ext).map(|_| &file_name[..file_name.len() - ext.len()]));

  stripped
    .filter(|name| !name.is_empty())
    .unwrap_or("extracted.bin")
    .to_string()
}

fn extract_tar_from_reader<R: Read>(
  app: &tauri::AppHandle,
  game_id: i64,
  reader: R,
  destination: &PathBuf,
) -> Result<(), (bool, String)> {
  emit_extract_progress(app, game_id, "extracting", 0, None, None, None);

  let mut archive = tar::Archive::new(reader);
  let entries = archive
    .entries()
    .map_err(|e| (false, format!("Failed to read TAR archive: {e}")))?;

  let mut processed = 0u64;
  for entry in entries {
    let mut entry = entry.map_err(|e| (false, format!("Failed to read TAR entry: {e}")))?;
    let current_file = entry
      .path()
      .ok()
      .map(|p| p.to_string_lossy().to_string());
    entry
      .unpack_in(destination)
      .map_err(|e| (false, format!("Failed to extract TAR entry: {e}")))?;
    processed += 1;
    emit_extract_progress(
      app,
      game_id,
      "extracting",
      processed,
      None,
      current_file,
      None,
    );
  }

  Ok(())
}

fn extract_single_file_from_reader<R: Read>(
  app: &tauri::AppHandle,
  game_id: i64,
  archive: &PathBuf,
  mut reader: R,
  destination: &PathBuf,
) -> Result<(), (bool, String)> {
  let output_name = single_file_output_name(archive);
  let output_path = destination.join(&output_name);
  let current_file = Some(output_name);

  if let Some(parent) = output_path.parent() {
    fs::create_dir_all(parent)
      .map_err(|e| (false, format!("Failed to create output directory: {e}")))?;
  }

  emit_extract_progress(app, game_id, "extracting", 0, None, current_file.clone(), None);

  let mut output = fs::File::create(&output_path)
    .map_err(|e| (false, format!("Failed to create output file: {e}")))?;
  std::io::copy(&mut reader, &mut output)
    .map_err(|e| (false, format!("Failed to extract compressed file: {e}")))?;

  emit_extract_progress(app, game_id, "extracting", 1, Some(1), current_file, None);
  Ok(())
}

fn extract_other_supported_archive(
  app: &tauri::AppHandle,
  game_id: i64,
  archive: &PathBuf,
  destination: &PathBuf,
) -> Option<Result<(), (bool, String)>> {
  let name = archive_file_name_lowercase(archive);

  if name.ends_with(".tar") {
    let file = match fs::File::open(archive) {
      Ok(file) => file,
      Err(e) => return Some(Err((false, format!("Failed to open archive: {e}")))),
    };
    return Some(extract_tar_from_reader(app, game_id, file, destination));
  }

  if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
    let file = match fs::File::open(archive) {
      Ok(file) => file,
      Err(e) => return Some(Err((false, format!("Failed to open archive: {e}")))),
    };
    let reader = flate2::read::GzDecoder::new(file);
    return Some(extract_tar_from_reader(app, game_id, reader, destination));
  }

  if name.ends_with(".tar.bz2") || name.ends_with(".tbz") || name.ends_with(".tbz2") {
    let file = match fs::File::open(archive) {
      Ok(file) => file,
      Err(e) => return Some(Err((false, format!("Failed to open archive: {e}")))),
    };
    let reader = bzip2::read::BzDecoder::new(file);
    return Some(extract_tar_from_reader(app, game_id, reader, destination));
  }

  if name.ends_with(".tar.xz") || name.ends_with(".txz") {
    let file = match fs::File::open(archive) {
      Ok(file) => file,
      Err(e) => return Some(Err((false, format!("Failed to open archive: {e}")))),
    };
    let reader = xz2::read::XzDecoder::new(file);
    return Some(extract_tar_from_reader(app, game_id, reader, destination));
  }

  if name.ends_with(".tar.zst") || name.ends_with(".tzst") {
    let file = match fs::File::open(archive) {
      Ok(file) => file,
      Err(e) => return Some(Err((false, format!("Failed to open archive: {e}")))),
    };
    let reader = match zstd::stream::read::Decoder::new(file) {
      Ok(reader) => reader,
      Err(e) => return Some(Err((false, format!("Failed to open Zstd stream: {e}")))),
    };
    return Some(extract_tar_from_reader(app, game_id, reader, destination));
  }

  if name.ends_with(".gz") && !is_tar_based_path(archive) {
    let file = match fs::File::open(archive) {
      Ok(file) => file,
      Err(e) => return Some(Err((false, format!("Failed to open archive: {e}")))),
    };
    let reader = flate2::read::GzDecoder::new(file);
    return Some(extract_single_file_from_reader(app, game_id, archive, reader, destination));
  }

  if name.ends_with(".bz2") && !is_tar_based_path(archive) {
    let file = match fs::File::open(archive) {
      Ok(file) => file,
      Err(e) => return Some(Err((false, format!("Failed to open archive: {e}")))),
    };
    let reader = bzip2::read::BzDecoder::new(file);
    return Some(extract_single_file_from_reader(app, game_id, archive, reader, destination));
  }

  if name.ends_with(".xz") && !is_tar_based_path(archive) {
    let file = match fs::File::open(archive) {
      Ok(file) => file,
      Err(e) => return Some(Err((false, format!("Failed to open archive: {e}")))),
    };
    let reader = xz2::read::XzDecoder::new(file);
    return Some(extract_single_file_from_reader(app, game_id, archive, reader, destination));
  }

  if name.ends_with(".zst") && !is_tar_based_path(archive) {
    let file = match fs::File::open(archive) {
      Ok(file) => file,
      Err(e) => return Some(Err((false, format!("Failed to open archive: {e}")))),
    };
    let reader = match zstd::stream::read::Decoder::new(file) {
      Ok(reader) => reader,
      Err(e) => return Some(Err((false, format!("Failed to open Zstd stream: {e}")))),
    };
    return Some(extract_single_file_from_reader(app, game_id, archive, reader, destination));
  }

  None
}

fn read_magic(path: &PathBuf) -> Result<[u8; 8], String> {
  let mut file = fs::File::open(path).map_err(|e| format!("Failed to open archive: {e}"))?;
  let mut magic = [0u8; 8];
  let read = file
    .read(&mut magic)
    .map_err(|e| format!("Failed to read archive signature: {e}"))?;
  if read < 4 {
    return Err("Archive file is too small.".to_string());
  }
  Ok(magic)
}

#[tauri::command]
fn cancel_download_task(game_id: i64) -> Result<(), String> {
  let guard = cancel_flags()
    .lock()
    .map_err(|_| "Cancel map lock poisoned".to_string())?;
  if let Some(flag) = guard.get(&game_id) {
    flag.store(true, Ordering::Relaxed);
  }
  Ok(())
}

fn sanitize_filename(name: &str) -> String {
  let sanitized = name
    .chars()
    .map(|c| match c {
      '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
      _ => c,
    })
    .collect::<String>()
    .trim()
    .to_string();

  if sanitized.is_empty() {
    "download.bin".to_string()
  } else {
    sanitized
  }
}

fn filename_from_content_disposition(header: Option<&reqwest::header::HeaderValue>) -> Option<String> {
  let value = header?.to_str().ok()?;

  for part in value.split(';').map(|s| s.trim()) {
    if let Some(rest) = part.strip_prefix("filename*=UTF-8''") {
      let decoded = rest.replace('%', "%25");
      let maybe = urlencoding::decode(&decoded).ok()?.to_string();
      if !maybe.trim().is_empty() {
        return Some(maybe);
      }
    }
  }

  for part in value.split(';').map(|s| s.trim()) {
    if let Some(rest) = part.strip_prefix("filename=") {
      let unquoted = rest.trim_matches('"').to_string();
      if !unquoted.trim().is_empty() {
        return Some(unquoted);
      }
    }
  }

  None
}

#[tauri::command]
fn download_game_version(
  app: tauri::AppHandle,
  game_id: i64,
  url: String,
  destination_dir: String,
  fallback_filename: Option<String>,
  auth_header: Option<String>,
) -> Result<(), String> {
  let cancel_flag = Arc::new(AtomicBool::new(false));
  {
    let mut guard = cancel_flags()
      .lock()
      .map_err(|_| "Cancel map lock poisoned".to_string())?;
    guard.insert(game_id, cancel_flag.clone());
  }

  tauri::async_runtime::spawn(async move {
    let client = reqwest::Client::new();
    let mut req = client.get(&url).header("Accept", "*/*");
    if let Some(auth) = auth_header.as_ref() {
      if !auth.trim().is_empty() {
        req = req.header("Authorization", auth);
      }
    }

    let response = match req.send().await {
      Ok(res) => res,
      Err(err) => {
        let _ = app.emit(
          "download-progress",
          DownloadProgressEvent {
            game_id,
            status: "error".to_string(),
            received: 0,
            total: None,
            error: Some(format!("Request failed: {err}")),
            filename: None,
            file_path: None,
          },
        );
        return;
      }
    };

    if !response.status().is_success() {
      let _ = app.emit(
        "download-progress",
        DownloadProgressEvent {
          game_id,
          status: "error".to_string(),
          received: 0,
          total: None,
          error: Some(format!("HTTP {}", response.status())),
          filename: None,
          file_path: None,
        },
      );
      return;
    }

    let chosen_filename = filename_from_content_disposition(
      response
        .headers()
        .get(reqwest::header::CONTENT_DISPOSITION),
    )
    .or_else(|| fallback_filename.clone())
    .unwrap_or_else(|| "download.bin".to_string());

    let sanitized_filename = sanitize_filename(&chosen_filename);
    let file_path = PathBuf::from(&destination_dir).join(&sanitized_filename);
    let file_path_string = file_path.to_string_lossy().to_string();

    let total = response.content_length();

    let mut file = match File::create(&file_path).await {
      Ok(file) => file,
      Err(err) => {
        let _ = app.emit(
          "download-progress",
          DownloadProgressEvent {
            game_id,
            status: "error".to_string(),
            received: 0,
            total,
            error: Some(format!("File create failed: {err}")),
            filename: Some(sanitized_filename.clone()),
            file_path: Some(file_path_string.clone()),
          },
        );
        return;
      }
    };

    let mut stream = response.bytes_stream();
    let mut received: u64 = 0;
    let mut last_emit = Instant::now();
    let emit_every = Duration::from_millis(250);

    while let Some(next) = stream.next().await {
      if cancel_flag.load(Ordering::Relaxed) {
        let _ = app.emit(
          "download-progress",
          DownloadProgressEvent {
            game_id,
            status: "aborted".to_string(),
            received: 0,
            total: None,
            error: None,
            filename: Some(sanitized_filename.clone()),
            file_path: Some(file_path_string.clone()),
          },
        );
        let _ = tokio::fs::remove_file(&file_path).await;
        let mut guard = cancel_flags().lock().ok();
        if let Some(ref mut map) = guard {
          map.remove(&game_id);
        }
        return;
      }

      let chunk = match next {
        Ok(bytes) => bytes,
        Err(err) => {
          let _ = app.emit(
            "download-progress",
            DownloadProgressEvent {
              game_id,
              status: "error".to_string(),
              received: 0,
              total: None,
              error: Some(format!("Stream failed: {err}")),
              filename: Some(sanitized_filename.clone()),
              file_path: Some(file_path_string.clone()),
            },
          );
          let _ = tokio::fs::remove_file(&file_path).await;
          let mut guard = cancel_flags().lock().ok();
          if let Some(ref mut map) = guard {
            map.remove(&game_id);
          }
          return;
        }
      };

      if let Err(err) = file.write_all(&chunk).await {
        let _ = app.emit(
          "download-progress",
          DownloadProgressEvent {
            game_id,
            status: "error".to_string(),
            received: 0,
            total: None,
            error: Some(format!("Write failed: {err}")),
            filename: Some(sanitized_filename.clone()),
            file_path: Some(file_path_string.clone()),
          },
        );
        let _ = tokio::fs::remove_file(&file_path).await;
        let mut guard = cancel_flags().lock().ok();
        if let Some(ref mut map) = guard {
          map.remove(&game_id);
        }
        return;
      }

      received += chunk.len() as u64;

      if last_emit.elapsed() >= emit_every {
        let _ = app.emit(
          "download-progress",
          DownloadProgressEvent {
            game_id,
            status: "downloading".to_string(),
            received,
            total,
            error: None,
            filename: Some(sanitized_filename.clone()),
            file_path: Some(file_path_string.clone()),
          },
        );
        last_emit = Instant::now();
      }
    }

    let _ = file.flush().await;
    let _ = app.emit(
      "download-progress",
      DownloadProgressEvent {
        game_id,
        status: "completed".to_string(),
        received,
        total,
        error: None,
        filename: Some(sanitized_filename.clone()),
        file_path: Some(file_path_string.clone()),
      },
    );

    let mut guard = cancel_flags().lock().ok();
    if let Some(ref mut map) = guard {
      map.remove(&game_id);
    }
  });

  Ok(())
}

#[tauri::command]
fn open_in_file_explorer(path: String) -> Result<(), String> {
  Command::new("explorer")
    .arg(path)
    .spawn()
    .map(|_| ())
    .map_err(|e| format!("Failed to open folder: {e}"))
}

#[tauri::command]
fn extract_archive(
  app: tauri::AppHandle,
  game_id: i64,
  archive_path: String,
  destination_path: String,
  password: Option<String>,
) -> Result<ExtractArchiveResponse, String> {
  let archive = PathBuf::from(archive_path);
  let destination = PathBuf::from(destination_path);

  if !archive.exists() {
    return Err("Archive does not exist".to_string());
  }

  if !destination.exists() {
    fs::create_dir_all(&destination)
      .map_err(|e| format!("Failed to create extraction directory: {e}"))?;
  }

  let magic = read_magic(&archive)?;
  let is_zip = magic[0] == 0x50 && magic[1] == 0x4B;
  let is_rar = magic[0] == 0x52
    && magic[1] == 0x61
    && magic[2] == 0x72
    && magic[3] == 0x21
    && magic[4] == 0x1A
    && magic[5] == 0x07;
  let is_7z = magic[0] == 0x37
    && magic[1] == 0x7A
    && magic[2] == 0xBC
    && magic[3] == 0xAF
    && magic[4] == 0x27
    && magic[5] == 0x1C;

  if is_zip {
    return match extract_zip_archive(&app, game_id, &archive, &destination, password.as_deref()) {
      Ok(_) => Ok(ExtractArchiveResponse {
        success: true,
        needs_password: false,
        message: None,
      }),
      Err((needs_password, msg)) => Ok(ExtractArchiveResponse {
        success: false,
        needs_password,
        message: Some(msg),
      }),
    };
  }

  if is_rar {
    return match extract_rar_archive(&app, game_id, &archive, &destination, password.as_deref()) {
      Ok(_) => Ok(ExtractArchiveResponse {
        success: true,
        needs_password: false,
        message: None,
      }),
      Err((needs_password, msg)) => Ok(ExtractArchiveResponse {
        success: false,
        needs_password,
        message: Some(msg),
      }),
    };
  }

  if let Some(result) = extract_other_supported_archive(&app, game_id, &archive, &destination) {
    return match result {
      Ok(_) => Ok(ExtractArchiveResponse {
        success: true,
        needs_password: false,
        message: None,
      }),
      Err((needs_password, msg)) => Ok(ExtractArchiveResponse {
        success: false,
        needs_password,
        message: Some(msg),
      }),
    };
  }

  if !is_7z {
    return Ok(ExtractArchiveResponse {
      success: false,
      needs_password: false,
      message: Some(
        "Unsupported archive format for built-in extractor. Supported formats include ZIP, RAR, 7z, TAR, TAR.GZ/TGZ, TAR.BZ2/TBZ2, TAR.XZ/TXZ, TAR.ZST/TZST, and single-file GZ/BZ2/XZ/ZST."
          .to_string(),
      ),
    });
  }

  let run_result = extract_7z_archive(&app, game_id, &archive, &destination, password.as_deref());

  match run_result {
    Ok(_) => Ok(ExtractArchiveResponse {
      success: true,
      needs_password: false,
      message: None,
    }),
    Err((needs_password, msg)) => {
      if needs_password {
        Ok(ExtractArchiveResponse {
          success: false,
          needs_password: true,
          message: Some("Archive is password protected.".to_string()),
        })
      } else {
        Ok(ExtractArchiveResponse {
          success: false,
          needs_password: false,
          message: Some(msg),
        })
      }
    }
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      open_in_file_explorer,
      extract_archive,
      download_game_version,
      cancel_download_task,
      recover_download_cards
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
