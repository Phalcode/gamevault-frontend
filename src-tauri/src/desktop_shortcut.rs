//! Desktop shortcuts that start a game through its `gamevault://` deep link.
//!
//! The shortcut is only a URL shortcut — double-clicking it goes through the
//! same protocol handler as any other deep link, so no launch logic is
//! duplicated here. What differs per platform is the file format:
//!
//! - **Windows**: an Internet Shortcut (`.url`), whose `IconFile` may point at
//!   an `.ico`.
//! - **Linux**: a freedesktop `.desktop` entry.
//! - **macOS**: a minimal `.app` bundle, for the sole reason that it is the
//!   only Finder item that can carry a custom icon.
//!
//! The icon comes from the selected executable's own resources (PE icons,
//! extracted on any platform). When there is nothing to extract — a shell
//! script, an AppImage, an ELF binary — the game cover is used instead.

use base64::Engine as _;
use serde::Serialize;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Square icon size used for extracted PNG/ICO shortcuts.
const ICON_SIZE: u32 = 256;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopShortcutResult {
  /// Absolute path of the created shortcut.
  pub path: String,
  /// Icon origin: `executable`, `cover` or `none`.
  pub icon: String,
}

/// Creates a desktop shortcut that launches the game via
/// `gamevault://start?gameid=<id>`.
#[tauri::command]
pub(crate) async fn create_desktop_shortcut(
  app: AppHandle,
  game_id: i64,
  title: String,
  executable_path: String,
  cover_base64: Option<String>,
) -> Result<DesktopShortcutResult, String> {
  if game_id <= 0 {
    return Err("Invalid game id.".to_string());
  }

  // Icon extraction and file IO must not run on the UI thread.
  tauri::async_runtime::spawn_blocking(move || {
    create_shortcut_blocking(
      &app,
      game_id,
      &title,
      Path::new(&executable_path),
      cover_base64.as_deref(),
    )
  })
  .await
  .map_err(|error| format!("Creating the desktop shortcut failed: {error}"))?
}

fn create_shortcut_blocking(
  app: &AppHandle,
  game_id: i64,
  title: &str,
  executable: &Path,
  cover_base64: Option<&str>,
) -> Result<DesktopShortcutResult, String> {
  create_shortcut_in(
    &desktop_dir(app)?,
    &icon_dir(app)?,
    game_id,
    title,
    executable,
    cover_base64,
  )
}

fn create_shortcut_in(
  desktop: &Path,
  icons_dir: &Path,
  game_id: i64,
  title: &str,
  executable: &Path,
  cover_base64: Option<&str>,
) -> Result<DesktopShortcutResult, String> {
  if !executable.is_file() {
    return Err("The selected executable does not exist anymore.".to_string());
  }

  let icons = prepare_icons(executable, icons_dir, game_id, cover_base64);
  let name = sanitize_shortcut_name(title);
  let url = start_url(game_id);

  #[cfg(windows)]
  {
    let target = desktop.join(format!("{name}.url"));
    remove_existing(&target)?;
    // Explorer can render an icon straight from the executable, so even when
    // extraction failed the shortcut does not have to look generic.
    let icon_file = icons
      .ico
      .clone()
      .unwrap_or_else(|| executable.to_path_buf());
    write_url_file(&target, &url, &icon_file.to_string_lossy())?;
    return Ok(DesktopShortcutResult {
      path: target.to_string_lossy().to_string(),
      icon: icons.kind.to_string(),
    });
  }

  #[cfg(target_os = "linux")]
  {
    let target = desktop.join(format!("{name}.desktop"));
    remove_existing(&target)?;
    let icon = icons
      .png
      .as_ref()
      .map(|path| path.to_string_lossy().to_string());
    fs::write(&target, desktop_entry_contents(&name, &url, icon.as_deref()))
      .map_err(|error| format!("Failed to write the shortcut: {error}"))?;
    set_executable(&target)?;
    trust_desktop_file(&target);
    return Ok(DesktopShortcutResult {
      path: target.to_string_lossy().to_string(),
      icon: icons.kind.to_string(),
    });
  }

  #[cfg(target_os = "macos")]
  {
    let target = desktop.join(format!("{name}.app"));
    write_app_bundle(&target, &name, &url, executable, &icons, game_id)?;
    return Ok(DesktopShortcutResult {
      path: target.to_string_lossy().to_string(),
      icon: icons.kind.to_string(),
    });
  }

  #[allow(unreachable_code)]
  Err("Desktop shortcuts are not supported on this platform.".to_string())
}

fn start_url(game_id: i64) -> String {
  format!("gamevault://start?gameid={game_id}")
}

fn desktop_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .desktop_dir()
    .map_err(|error| format!("Could not locate the desktop folder: {error}"))?;
  fs::create_dir_all(&dir)
    .map_err(|error| format!("Could not create the desktop folder: {error}"))?;
  Ok(dir)
}

/// Icons live in the app data directory so the desktop only holds the shortcut
/// itself and several shortcuts can share one icon file per game.
fn icon_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_local_data_dir()
    .map_err(|error| format!("Could not locate the app data folder: {error}"))?
    .join("shortcut-icons");
  fs::create_dir_all(&dir)
    .map_err(|error| format!("Could not create the icon folder: {error}"))?;
  Ok(dir)
}

struct ShortcutIcons {
  /// ICO file for Windows shortcuts.
  #[allow(dead_code)]
  ico: Option<PathBuf>,
  /// PNG file for Linux and macOS shortcuts.
  #[allow(dead_code)]
  png: Option<PathBuf>,
  kind: &'static str,
}

fn prepare_icons(
  executable: &Path,
  dir: &Path,
  game_id: i64,
  cover_base64: Option<&str>,
) -> ShortcutIcons {
  let ico_path = dir.join(format!("{game_id}.ico"));
  let png_path = dir.join(format!("{game_id}.png"));

  if extract_pe_icons(executable, &ico_path, &png_path).is_ok() {
    return ShortcutIcons {
      ico: Some(ico_path),
      png: Some(png_path),
      kind: "executable",
    };
  }
  let _ = fs::remove_file(&ico_path);
  let _ = fs::remove_file(&png_path);

  if let Some(cover) = cover_base64 {
    if let Ok(png) = cover_to_png(cover) {
      if fs::write(&png_path, &png).is_ok() {
        let _ = fs::write(&ico_path, ico_from_png(&png));
        return ShortcutIcons {
          ico: Some(ico_path),
          png: Some(png_path),
          kind: "cover",
        };
      }
    }
  }

  ShortcutIcons {
    ico: None,
    png: None,
    kind: "none",
  }
}

/// Extracts the executable's group icon to `.ico`, plus a PNG version used by
/// Linux and macOS. Fails for anything that is not a Windows PE file.
fn extract_pe_icons(executable: &Path, ico: &Path, png: &Path) -> Result<(), String> {
  use icoextract_rs::thumbnail::{generate_thumbnail, ThumbnailOptions};
  use icoextract_rs::{IconExtractor, IconSelector};

  let extractor = IconExtractor::from_path(executable).map_err(|error| error.to_string())?;
  let icon = extractor
    .get_icon(IconSelector::Index(0))
    .map_err(|error| error.to_string())?;
  let bytes = icon.to_ico_bytes().map_err(|error| error.to_string())?;
  fs::write(ico, bytes)
    .map_err(|error| format!("Failed to write the shortcut icon: {error}"))?;
  generate_thumbnail(executable, png, ThumbnailOptions::default())
    .map_err(|error| error.to_string())?;
  Ok(())
}

/// Decodes a cover image of any supported type and re-encodes it as a square
/// PNG icon with transparent padding.
fn cover_to_png(cover_base64: &str) -> Result<Vec<u8>, String> {
  let bytes = base64::engine::general_purpose::STANDARD
    .decode(cover_base64.trim())
    .map_err(|error| format!("Invalid cover image data: {error}"))?;
  let cover = image::load_from_memory(&bytes)
    .map_err(|error| format!("Unsupported cover image: {error}"))?
    .to_rgba8();
  let canvas = square_canvas(&cover, ICON_SIZE);

  let mut png = Vec::new();
  image::DynamicImage::ImageRgba8(canvas)
    .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
    .map_err(|error| format!("Failed to encode the shortcut icon: {error}"))?;
  Ok(png)
}

/// Scales the image down to fit and centers it on a transparent square.
fn square_canvas(image: &image::RgbaImage, size: u32) -> image::RgbaImage {
  let (width, height) = image.dimensions();
  let mut canvas = image::RgbaImage::new(size, size);
  if width == 0 || height == 0 {
    return canvas;
  }

  let scale = (size as f32 / width.max(height) as f32).min(1.0);
  let target_width = ((width as f32 * scale).round() as u32).max(1);
  let target_height = ((height as f32 * scale).round() as u32).max(1);
  let resized = image::imageops::resize(
    image,
    target_width,
    target_height,
    image::imageops::FilterType::Lanczos3,
  );

  let x = ((size - target_width) / 2) as i64;
  let y = ((size - target_height) / 2) as i64;
  image::imageops::overlay(&mut canvas, &resized, x, y);
  canvas
}

/// Wraps a PNG in a single-entry ICO container (PNG-compressed entry, Vista+).
fn ico_from_png(png: &[u8]) -> Vec<u8> {
  let dimension = if ICON_SIZE >= 256 {
    0u8
  } else {
    ICON_SIZE as u8
  };

  let mut ico = Vec::with_capacity(22 + png.len());
  ico.extend_from_slice(&0u16.to_le_bytes()); // reserved
  ico.extend_from_slice(&1u16.to_le_bytes()); // type: icon
  ico.extend_from_slice(&1u16.to_le_bytes()); // image count
  ico.push(dimension); // width (0 = 256)
  ico.push(dimension); // height (0 = 256)
  ico.push(0); // color count
  ico.push(0); // reserved
  ico.extend_from_slice(&1u16.to_le_bytes()); // color planes
  ico.extend_from_slice(&32u16.to_le_bytes()); // bits per pixel
  ico.extend_from_slice(&(png.len() as u32).to_le_bytes());
  ico.extend_from_slice(&22u32.to_le_bytes()); // image offset
  ico.extend_from_slice(png);
  ico
}

fn remove_existing(path: &Path) -> Result<(), String> {
  let Ok(metadata) = fs::symlink_metadata(path) else {
    return Ok(());
  };
  let result = if metadata.is_dir() {
    fs::remove_dir_all(path)
  } else {
    fs::remove_file(path)
  };
  result.map_err(|error| format!("Failed to replace the existing shortcut: {error}"))
}

// ── Removal ────────────────────────────────────────────────────────────────

/// Removes every desktop shortcut that starts `game_id`, plus the cached
/// shortcut icons.
///
/// Shortcuts are matched by what they launch rather than by their file name,
/// because the name is derived from the game title and may have changed (or
/// been renamed by the user) since the shortcut was created.
#[tauri::command]
pub(crate) async fn remove_desktop_shortcuts(
  app: AppHandle,
  game_id: i64,
) -> Result<usize, String> {
  if game_id <= 0 {
    return Ok(0);
  }

  tauri::async_runtime::spawn_blocking(move || {
    let removed = remove_shortcuts_in(&desktop_dir(&app)?, game_id);

    if let Ok(icons) = icon_dir(&app) {
      let _ = fs::remove_file(icons.join(format!("{game_id}.ico")));
      let _ = fs::remove_file(icons.join(format!("{game_id}.png")));
    }

    Ok(removed)
  })
  .await
  .map_err(|error| format!("Removing the desktop shortcut failed: {error}"))?
}

/// Removes matching shortcuts from one folder and reports how many went away.
fn remove_shortcuts_in(desktop: &Path, game_id: i64) -> usize {
  let Ok(entries) = fs::read_dir(desktop) else {
    return 0;
  };
  entries
    .flatten()
    .filter(|entry| shortcut_targets_game(&entry.path(), game_id))
    .filter(|entry| remove_existing(&entry.path()).is_ok())
    .count()
}

/// True when the desktop entry is a GameVault shortcut for `game_id`.
///
/// Not platform-gated: every format is recognized on every platform, so the
/// matching logic is compiled and tested by all builds (and a copied shortcut
/// is still recognized).
fn shortcut_targets_game(path: &Path, game_id: i64) -> bool {
  match path.extension().and_then(|extension| extension.to_str()) {
    Some("url") => fs::read(path)
      .map(|bytes| references_game(&decode_url_bytes(&bytes), game_id))
      .unwrap_or(false),
    Some("desktop") => fs::read_to_string(path)
      .map(|contents| references_game(&contents, game_id))
      .unwrap_or(false),
    Some("app") => fs::read_to_string(path.join("Contents").join("Info.plist"))
      .map(|plist| bundle_identifier_game_id(&plist) == Some(game_id))
      .unwrap_or(false),
    _ => false,
  }
}

/// True when the text contains a `gameid=<game_id>` query value.
///
/// The digits are parsed instead of compared as text, so `gameid=42` does not
/// match a shortcut for game 420.
fn references_game(text: &str, game_id: i64) -> bool {
  let marker = "gameid=";
  let mut rest = text;
  while let Some(position) = rest.find(marker) {
    let after = &rest[position + marker.len()..];
    let digits: String = after.chars().take_while(char::is_ascii_digit).collect();
    if let Ok(parsed) = digits.parse::<i64>() {
      if parsed == game_id {
        return true;
      }
    }
    rest = after;
  }
  false
}

/// Reads the game id from a shortcut bundle's identifier
/// (`com.phalcode.gamevault.shortcut.<id>`).
fn bundle_identifier_game_id(plist: &str) -> Option<i64> {
  let marker = "com.phalcode.gamevault.shortcut.";
  let position = plist.find(marker)?;
  plist[position + marker.len()..]
    .chars()
    .take_while(char::is_ascii_digit)
    .collect::<String>()
    .parse()
    .ok()
}

/// Decodes an Internet Shortcut file. GameVault writes UTF-16LE with a BOM;
/// hand-edited or third-party files may be UTF-8.
fn decode_url_bytes(bytes: &[u8]) -> String {
  if bytes.starts_with(&[0xFF, 0xFE]) {
    let units: Vec<u16> = bytes[2..]
      .chunks_exact(2)
      .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
      .collect();
    String::from_utf16_lossy(&units)
  } else {
    String::from_utf8_lossy(bytes).into_owned()
  }
}

/// File name for the shortcut. Windows forbids a handful of characters in
/// names; strip them everywhere so the same title produces the same file on
/// every platform.
fn sanitize_shortcut_name(title: &str) -> String {
  let mut cleaned = String::with_capacity(title.len());
  for character in title.chars() {
    if character.is_control()
      || matches!(character, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
    {
      cleaned.push(' ');
    } else {
      cleaned.push(character);
    }
  }

  let cleaned = cleaned.trim();
  let cleaned = cleaned.trim_end_matches(['.', ' ']);
  let mut name: String = cleaned.chars().take(80).collect();
  name = name.trim().to_string();
  if name.is_empty() || name == "." || name == ".." {
    name = "Game".to_string();
  }
  name
}

// ── Windows ────────────────────────────────────────────────────────────────

#[allow(dead_code)]
fn url_file_contents(url: &str, icon_file: &str) -> String {
  format!(
    "[InternetShortcut]\r\nURL={url}\r\nIconFile={icon_file}\r\nIconIndex=0\r\n"
  )
}

#[cfg(windows)]
fn write_url_file(path: &Path, url: &str, icon_file: &str) -> Result<(), String> {
  // UTF-16LE with BOM so non-ASCII paths survive every Windows version.
  let contents = url_file_contents(url, icon_file);
  let mut bytes = vec![0xFF, 0xFE];
  for unit in contents.encode_utf16() {
    bytes.extend_from_slice(&unit.to_le_bytes());
  }
  fs::write(path, bytes).map_err(|error| format!("Failed to write the shortcut: {error}"))
}

// ── Linux ──────────────────────────────────────────────────────────────────

#[allow(dead_code)]
fn desktop_entry_contents(name: &str, url: &str, icon: Option<&str>) -> String {
  let name = desktop_value(name);
  let mut contents = String::new();
  contents.push_str("[Desktop Entry]\n");
  contents.push_str("Type=Application\n");
  contents.push_str(&format!("Name={name}\n"));
  contents.push_str(&format!("Comment=Start {name} in GameVault\n"));
  contents.push_str(&format!("Exec=xdg-open \"{url}\"\n"));
  if let Some(icon) = icon {
    contents.push_str(&format!("Icon={icon}\n"));
  }
  contents.push_str("Terminal=false\n");
  contents.push_str("Categories=Game;\n");
  contents.push_str("StartupNotify=false\n");
  contents
}

/// Escapes a value for a desktop entry string.
#[allow(dead_code)]
fn desktop_value(value: &str) -> String {
  value
    .replace('\\', "\\\\")
    .replace('\n', " ")
    .replace('\r', " ")
}

#[cfg(unix)]
fn set_executable(path: &Path) -> Result<(), String> {
  use std::os::unix::fs::PermissionsExt;
  fs::set_permissions(path, fs::Permissions::from_mode(0o755))
    .map_err(|error| format!("Failed to make the shortcut executable: {error}"))
}

/// GNOME shows untrusted launchers as text files until they are marked
/// trusted. Best effort: other desktops ignore the metadata.
#[cfg(target_os = "linux")]
fn trust_desktop_file(path: &Path) {
  let _ = std::process::Command::new("gio")
    .arg("set")
    .arg(path)
    .arg("metadata::trusted")
    .arg("true")
    .status();
}

// ── macOS ──────────────────────────────────────────────────────────────────

#[allow(dead_code)]
fn macos_launcher_script(url: &str) -> String {
  format!("#!/bin/sh\nexec /usr/bin/open \"{url}\"\n")
}

#[allow(dead_code)]
fn macos_info_plist(bundle_name: &str, game_id: i64) -> String {
  format!(
    r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>CFBundleIdentifier</key><string>com.phalcode.gamevault.shortcut.{game_id}</string>
  <key>CFBundleName</key><string>{name}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
"#,
    name = xml_escape(bundle_name)
  )
}

#[allow(dead_code)]
fn xml_escape(value: &str) -> String {
  value
    .replace('&', "&amp;")
    .replace('<', "&lt;")
    .replace('>', "&gt;")
    .replace('"', "&quot;")
    .replace('\'', "&apos;")
}

#[cfg(target_os = "macos")]
fn write_app_bundle(
  target: &Path,
  name: &str,
  url: &str,
  executable: &Path,
  icons: &ShortcutIcons,
  game_id: i64,
) -> Result<(), String> {
  remove_existing(target)?;

  let contents = target.join("Contents");
  let macos = contents.join("MacOS");
  let resources = contents.join("Resources");
  fs::create_dir_all(&macos)
    .map_err(|error| format!("Failed to create the shortcut bundle: {error}"))?;
  fs::create_dir_all(&resources)
    .map_err(|error| format!("Failed to create the shortcut bundle: {error}"))?;

  fs::write(contents.join("Info.plist"), macos_info_plist(name, game_id))
    .map_err(|error| format!("Failed to write the shortcut bundle: {error}"))?;

  let launcher = macos.join("launch");
  fs::write(&launcher, macos_launcher_script(url))
    .map_err(|error| format!("Failed to write the shortcut bundle: {error}"))?;
  set_executable(&launcher)?;

  if let Some(icns) = macos_icon(executable, icons) {
    fs::write(resources.join("icon.icns"), icns)
      .map_err(|error| format!("Failed to write the shortcut icon: {error}"))?;
  }

  Ok(())
}

/// Prefers the game bundle's own `.icns` (best quality), then converts the
/// extracted PNG.
///
/// Only the bundle writing below is macOS-gated, so this icon selection keeps
/// compiling (and is exercised by tests) on every platform.
#[allow(dead_code)]
fn macos_icon(executable: &Path, icons: &ShortcutIcons) -> Option<Vec<u8>> {
  if let Some(bundle) = app_bundle_ancestor(executable) {
    if let Some(icns) = first_icns(&bundle) {
      if let Ok(bytes) = fs::read(icns) {
        return Some(bytes);
      }
    }
  }

  png_to_icns(icons.png.as_deref()?)
}

/// Converts one PNG icon into an ICNS container holding a single image.
///
/// Deliberately not `#[cfg]`-gated: keeping this compiled on every platform
/// means the macOS icon path is type-checked and tested by the Windows and
/// Linux builds too.
#[allow(dead_code)]
fn png_to_icns(png: &Path) -> Option<Vec<u8>> {
  // `read_png` needs `BufRead + Seek`; a file only offers `Read + Seek`, and
  // an in-memory cursor handles both without a second import.
  let image = icns::Image::read_png(Cursor::new(fs::read(png).ok()?)).ok()?;
  let mut family = icns::IconFamily::new();
  family.add_icon(&image).ok()?;
  let mut out = Cursor::new(Vec::new());
  family.write(&mut out).ok()?;
  Some(out.into_inner())
}

#[allow(dead_code)]
fn app_bundle_ancestor(executable: &Path) -> Option<PathBuf> {
  executable
    .ancestors()
    .find(|path| path.extension().and_then(|ext| ext.to_str()) == Some("app"))
    .map(PathBuf::from)
}

#[allow(dead_code)]
fn first_icns(bundle: &Path) -> Option<PathBuf> {
  let resources = bundle.join("Contents").join("Resources");
  let mut files: Vec<PathBuf> = fs::read_dir(resources)
    .ok()?
    .flatten()
    .map(|entry| entry.path())
    .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("icns"))
    .collect();
  files.sort();
  files.into_iter().next()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn sanitizes_windows_invalid_characters() {
    let name =
      sanitize_shortcut_name(r#"Half-Life: Blue Shift / "test"?"#);
    assert!(name.starts_with("Half-Life  Blue Shift"));
    assert!(!name.contains(['<', '>', ':', '"', '/', '\\', '|', '?', '*']));
  }

  #[test]
  fn sanitizes_empty_and_relative_names() {
    assert_eq!(sanitize_shortcut_name("   "), "Game");
    assert_eq!(sanitize_shortcut_name(".."), "Game");
    assert_eq!(sanitize_shortcut_name("Trailing dots..."), "Trailing dots");
  }

  #[test]
  fn url_file_contains_url_and_icon() {
    let contents = url_file_contents(
      "gamevault://start?gameid=42",
      r"C:\Games\Icon file.ico",
    );
    assert!(contents.contains("URL=gamevault://start?gameid=42"));
    assert!(contents.contains(r"IconFile=C:\Games\Icon file.ico"));
    assert!(contents.contains("IconIndex=0"));
  }

  #[test]
  fn desktop_entry_quotes_the_url_and_uses_the_icon() {
    let contents = desktop_entry_contents(
      "Portal 2",
      "gamevault://start?gameid=7",
      Some("/home/u/.local/share/icons/7.png"),
    );
    assert!(contents.contains(r#"Exec=xdg-open "gamevault://start?gameid=7""#));
    assert!(contents.contains("Icon=/home/u/.local/share/icons/7.png"));
    assert!(contents.contains("Name=Portal 2"));
  }

  #[test]
  fn desktop_entry_omits_missing_icon() {
    let contents =
      desktop_entry_contents("Game", "gamevault://start?gameid=1", None);
    assert!(!contents.contains("Icon="));
  }

  #[test]
  fn plist_escapes_the_bundle_name() {
    let plist = macos_info_plist("Tom & Jerry <Deluxe>", 7);
    assert!(plist.contains("Tom &amp; Jerry &lt;Deluxe&gt;"));
    assert!(!plist.contains("<Deluxe>"));
    assert!(plist.contains("com.phalcode.gamevault.shortcut.7"));
  }

  #[test]
  fn launcher_script_calls_open_with_the_url() {
    let script = macos_launcher_script("gamevault://start?gameid=9");
    assert!(script.starts_with("#!/bin/sh"));
    assert!(script.contains(r#"/usr/bin/open "gamevault://start?gameid=9""#));
  }

  #[test]
  fn ico_wraps_png_in_a_single_entry_container() {
    let png = [1u8, 2, 3, 4];
    let ico = ico_from_png(&png);
    assert_eq!(&ico[..4], &[0, 0, 1, 0]);
    assert_eq!(ico.len(), 22 + png.len());
    assert_eq!(&ico[18..22], &22u32.to_le_bytes());
  }

  /// The macOS shortcut converts the extracted PNG into its `.icns` bundle
  /// icon. The helper is compiled on every platform, so this runs in the
  /// regular test suite instead of only on macOS runners.
  #[test]
  fn converts_a_png_into_an_icns_icon_family() {
    let root = std::env::temp_dir().join(format!(
      "gv-shortcut-icns-{}",
      std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    let png = root.join("icon.png");

    // Same size `prepare_icons` writes, so the conversion sees exactly the
    // input it gets at runtime.
    let mut encoded = Vec::new();
    image::DynamicImage::ImageRgba8(image::RgbaImage::new(ICON_SIZE, ICON_SIZE))
      .write_to(&mut Cursor::new(&mut encoded), image::ImageFormat::Png)
      .unwrap();
    fs::write(&png, encoded).unwrap();

    let icns =
      png_to_icns(&png).expect("a PNG icon should convert into an ICNS family");
    assert_eq!(&icns[..4], b"icns");
    let declared =
      u32::from_be_bytes([icns[4], icns[5], icns[6], icns[7]]) as usize;
    assert_eq!(declared, icns.len(), "ICNS header length matches the file");

    let family = icns::IconFamily::read(Cursor::new(icns)).unwrap();
    assert_eq!(family.available_icons().len(), 1);

    let _ = fs::remove_dir_all(&root);
  }

  #[test]
  fn matches_only_the_exact_game_id() {
    let url =
      "[InternetShortcut]\r\nURL=gamevault://start?gameid=42\r\nIconIndex=0\r\n";
    assert!(references_game(url, 42));
    assert!(!references_game(url, 4));
    assert!(!references_game(url, 420));

    let entry = "Exec=xdg-open \"gamevault://start?gameid=7\"\nName=Game\n";
    assert!(references_game(entry, 7));
    assert!(!references_game(entry, 70));
    assert!(!references_game("Name=Game\n", 7));
  }

  #[test]
  fn decodes_utf16_and_utf8_url_files() {
    let text = "[InternetShortcut]\r\nURL=gamevault://start?gameid=9\r\n";

    let mut utf16 = vec![0xFF, 0xFE];
    for unit in text.encode_utf16() {
      utf16.extend_from_slice(&unit.to_le_bytes());
    }

    assert_eq!(decode_url_bytes(&utf16), text);
    assert_eq!(decode_url_bytes(text.as_bytes()), text);
  }

  #[test]
  fn removes_only_shortcuts_for_the_game() {
    let root = std::env::temp_dir().join(format!(
      "gv-shortcut-remove-{}",
      std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();

    let mine = root.join("Mine.url");
    let mut utf16 = vec![0xFF, 0xFE];
    for unit in url_file_contents("gamevault://start?gameid=42", "icon.ico")
      .encode_utf16()
    {
      utf16.extend_from_slice(&unit.to_le_bytes());
    }
    fs::write(&mine, utf16).unwrap();

    let other = root.join("Other.url");
    fs::write(
      &other,
      "[InternetShortcut]\r\nURL=gamevault://start?gameid=7\r\n",
    )
    .unwrap();
    // Same payload, but not a shortcut extension: must be left alone.
    let notes = root.join("notes.txt");
    fs::write(&notes, "gamevault://start?gameid=42").unwrap();

    assert_eq!(remove_shortcuts_in(&root, 42), 1);
    assert!(!mine.exists());
    assert!(other.is_file());
    assert!(notes.is_file());

    let _ = fs::remove_dir_all(&root);
  }

  #[test]
  fn removes_app_bundles_by_identifier() {
    let root = std::env::temp_dir().join(format!(
      "gv-shortcut-bundle-{}",
      std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    let bundle = root.join("Game.app");
    fs::create_dir_all(bundle.join("Contents")).unwrap();
    fs::write(
      bundle.join("Contents").join("Info.plist"),
      macos_info_plist("Game", 42),
    )
    .unwrap();

    assert!(shortcut_targets_game(&bundle, 42));
    assert!(!shortcut_targets_game(&bundle, 4));
    assert_eq!(remove_shortcuts_in(&root, 42), 1);
    assert!(!bundle.exists());

    let _ = fs::remove_dir_all(&root);
  }

  /// Smoke test against a real PE file available on every Windows install.
  #[cfg(windows)]
  #[test]
  fn extracts_icons_from_a_real_pe_file() {
    let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".to_string());
    let executable = PathBuf::from(windir).join("explorer.exe");
    if !executable.is_file() {
      return;
    }

    let dir = std::env::temp_dir().join(format!(
      "gv-shortcut-icons-{}",
      std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let ico = dir.join("test.ico");
    let png = dir.join("test.png");

    extract_pe_icons(&executable, &ico, &png)
      .expect("icon extraction should work for a Windows executable");

    let ico_bytes = fs::read(&ico).unwrap();
    assert_eq!(&ico_bytes[..4], &[0, 0, 1, 0], "valid ICO header");
    assert!(
      fs::metadata(&png).unwrap().len() > 0,
      "PNG thumbnail was written"
    );

    let _ = fs::remove_dir_all(&dir);
  }

  #[cfg(windows)]
  fn windows_temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
      "gv-shortcut-{tag}-{}",
      std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  #[cfg(windows)]
  fn windows_explorer() -> Option<PathBuf> {
    let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".to_string());
    let executable = PathBuf::from(windir).join("explorer.exe");
    executable.is_file().then_some(executable)
  }

  #[cfg(windows)]
  #[test]
  fn writes_a_url_shortcut_with_the_extracted_icon() {
    let Some(executable) = windows_explorer() else {
      return;
    };
    let root = windows_temp_dir("url");
    let desktop = root.join("Desktop");
    let icons = root.join("icons");
    fs::create_dir_all(&desktop).unwrap();
    fs::create_dir_all(&icons).unwrap();

    let result = create_shortcut_in(
      &desktop,
      &icons,
      42,
      "Test: Game / 2",
      &executable,
      None,
    )
    .unwrap();

    assert_eq!(result.icon, "executable");
    let shortcut = PathBuf::from(&result.path);
    assert!(shortcut.is_file());
    assert_eq!(
      shortcut.file_name().unwrap().to_string_lossy(),
      "Test  Game   2.url"
    );

    // UTF-16LE with BOM, readable by Explorer on every Windows version.
    let bytes = fs::read(&shortcut).unwrap();
    assert_eq!(&bytes[..2], &[0xFF, 0xFE]);
    let units: Vec<u16> = bytes[2..]
      .chunks_exact(2)
      .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
      .collect();
    let text = String::from_utf16(&units).unwrap();
    assert!(text.contains("URL=gamevault://start?gameid=42"));
    assert!(text.contains("IconFile="));
    assert!(text.contains("IconIndex=0"));

    let _ = fs::remove_dir_all(&root);
  }

  /// A script has no PE icon, so the supplied cover image must be converted
  /// into both the PNG and the ICO the shortcut references.
  #[cfg(windows)]
  #[test]
  fn falls_back_to_the_cover_icon_for_non_pe_executables() {
    const TINY_PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    let root = windows_temp_dir("cover");
    let desktop = root.join("Desktop");
    let icons = root.join("icons");
    fs::create_dir_all(&desktop).unwrap();
    fs::create_dir_all(&icons).unwrap();

    let script = root.join("launch.bat");
    fs::write(&script, "echo hi").unwrap();

    let result = create_shortcut_in(
      &desktop,
      &icons,
      7,
      "Cover Game",
      &script,
      Some(TINY_PNG),
    )
    .unwrap();

    assert_eq!(result.icon, "cover");
    assert!(icons.join("7.png").is_file());
    assert!(icons.join("7.ico").is_file());
    assert!(PathBuf::from(&result.path).is_file());

    let _ = fs::remove_dir_all(&root);
  }

  #[test]
  fn rejects_a_missing_executable() {
    let root = std::env::temp_dir().join(format!(
      "gv-shortcut-missing-{}",
      std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();

    let error = create_shortcut_in(
      &root,
      &root,
      1,
      "Game",
      &root.join("missing.exe"),
      None,
    )
    .unwrap_err();
    assert!(error.contains("does not exist"));

    let _ = fs::remove_dir_all(&root);
  }
}
