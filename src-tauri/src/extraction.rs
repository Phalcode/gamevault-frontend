use crate::events::{emit_extract_progress, ExtractArchiveResponse};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

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
  use unrar::Archive;
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

// ── ISO 9660 extraction support ──────────────────────────────────────────────

struct IsoFileDevice {
  file: std::fs::File,
}

impl iso9660_simple::Read for IsoFileDevice {
  fn read(&mut self, position: usize, buffer: &mut [u8]) -> Option<()> {
    use std::io::Seek;
    if self
      .file
      .seek(std::io::SeekFrom::Start(position as u64))
      .is_err()
    {
      return None;
    }
    self.file.read_exact(buffer).ok()
  }
}

fn is_iso_archive(path: &PathBuf) -> bool {
  use std::io::{Read, Seek};
  let mut file = match std::fs::File::open(path) {
    Ok(f) => f,
    Err(_) => return false,
  };
  if file.seek(std::io::SeekFrom::Start(0x8001)).is_err() {
    return false;
  }
  let mut sig = [0u8; 5];
  if file.read_exact(&mut sig).is_err() {
    return false;
  }
  &sig == b"CD001"
}

fn count_iso_entries(iso: &mut iso9660_simple::ISO9660, lba: usize) -> u64 {
  let mut count = 0u64;
  let entries: Vec<_> = iso.read_directory(lba).collect();
  for entry in &entries {
    if entry.name == "." || entry.name == ".." {
      continue;
    }
    count += 1;
    if entry.is_folder() {
      count += count_iso_entries(iso, entry.record.lba.get() as usize);
    }
  }
  count
}

fn extract_iso_directory(
  iso: &mut iso9660_simple::ISO9660,
  lba: usize,
  dest: &Path,
  processed: &mut u64,
  total: u64,
  app: &tauri::AppHandle,
  game_id: i64,
) -> Result<(), (bool, String)> {
  let entries: Vec<_> = iso.read_directory(lba).collect();
  for entry in &entries {
    if entry.name == "." || entry.name == ".." {
      continue;
    }

    let dest_path = dest.join(&entry.name);

    if entry.is_folder() {
      fs::create_dir_all(&dest_path)
        .map_err(|e| (false, format!("Failed to create directory: {e}")))?;

      *processed += 1;
      emit_extract_progress(
        app,
        game_id,
        "extracting",
        *processed,
        Some(total),
        Some(entry.name.clone()),
        None,
      );

      extract_iso_directory(
        iso,
        entry.record.lba.get() as usize,
        &dest_path,
        processed,
        total,
        app,
        game_id,
      )?;
    } else {
      if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent)
          .map_err(|e| (false, format!("Failed to create parent directory: {e}")))?;
      }

      let file_size = entry.file_size() as usize;
      let mut output = std::fs::File::create(&dest_path)
        .map_err(|e| (false, format!("Failed to create output file: {e}")))?;

      let mut offset = 0usize;
      let mut buffer = vec![0u8; 8192];

      while offset < file_size {
        let remaining = file_size - offset;
        let to_read = std::cmp::min(remaining, buffer.len());
        let buf_slice = &mut buffer[..to_read];

        if iso.read_file(entry, offset, buf_slice).is_none() {
          return Err((
            false,
            format!("Failed to read ISO file data at offset {}", offset),
          ));
        }

        output
          .write_all(buf_slice)
          .map_err(|e| (false, format!("Failed to write output file: {e}")))?;

        offset += to_read;
      }

      *processed += 1;
      emit_extract_progress(
        app,
        game_id,
        "extracting",
        *processed,
        Some(total),
        Some(entry.name.clone()),
        None,
      );
    }
  }
  Ok(())
}

fn extract_iso_archive(
  app: &tauri::AppHandle,
  game_id: i64,
  archive: &PathBuf,
  destination: &PathBuf,
) -> Result<(), (bool, String)> {
  let file = std::fs::File::open(archive)
    .map_err(|e| (false, format!("Failed to open ISO archive: {e}")))?;

  let device = IsoFileDevice { file };
  let mut iso = iso9660_simple::ISO9660::from_device(device)
    .ok_or_else(|| (false, "Failed to parse ISO 9660 filesystem".to_string()))?;

  let root_lba = iso.root().lba.get() as usize;
  let total = count_iso_entries(&mut iso, root_lba);

  emit_extract_progress(app, game_id, "extracting", 0, Some(total), None, None);

  let mut processed = 0u64;
  extract_iso_directory(
    &mut iso,
    root_lba,
    destination,
    &mut processed,
    total,
    app,
    game_id,
  )
}

// ── TAR & single-file compressed extraction ──────────────────────────────────

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
pub(crate) fn extract_archive(
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

  if is_iso_archive(&archive) {
    return match extract_iso_archive(&app, game_id, &archive, &destination) {
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
        "Unsupported archive format for built-in extractor. Supported formats include ZIP, RAR, 7z, ISO, TAR, TAR.GZ/TGZ, TAR.BZ2/TBZ2, TAR.XZ/TXZ, TAR.ZST/TZST, and single-file GZ/BZ2/XZ/ZST."
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
