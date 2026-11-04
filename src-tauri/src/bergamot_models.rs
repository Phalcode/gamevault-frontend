//! Local storage for the Bergamot translation models.
//!
//! The interface translation downloads Mozilla's model archives (two to four
//! gzip files per language) once. They live in the app data directory rather
//! than the webview's storage, because the installer clears the latter on
//! updates and that would force a re-download after every release.
//!
//! Next to the archives, `plan.json` records which files belong to the model.
//! That way a downloaded model keeps working offline, long after Mozilla's
//! registry became unreachable.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct ModelFile {
  pub name: String,
  pub url: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct ModelPlan {
  pub files: Vec<ModelFile>,
  /// Archive names that hold the vocabularies, in engine order.
  #[serde(default)]
  pub vocabularies: Vec<String>,
}

#[derive(Serialize, Clone)]
pub(crate) struct ModelStatus {
  pub ready: bool,
  pub bytes: u64,
}

#[derive(Serialize, Clone)]
struct DownloadProgress {
  language: String,
  received: u64,
  total: u64,
}

const PLAN_FILE: &str = "plan.json";
const REGISTRY_FILE: &str = "registry.json";
const TRANSLATIONS_FILE: &str = "translations.json";
/// Upper bound for the persisted translation cache (JSON, UTF-8 bytes).
const MAX_TRANSLATIONS_BYTES: usize = 32 * 1024 * 1024;
const REGISTRY_URL: &str =
  "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/db/models.json";

fn models_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  app
    .path()
    .app_data_dir()
    .map(|dir| dir.join("bergamot-models"))
    .map_err(|error| error.to_string())
}

/// Language codes become directory names, so only accept what Mozilla uses.
fn language_dir(app: &tauri::AppHandle, language: &str) -> Result<PathBuf, String> {
  let code = language.trim();
  let valid = !code.is_empty()
    && code.len() <= 12
    && code
      .chars()
      .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
  if !valid {
    return Err(format!("Invalid language code: {language}"));
  }
  Ok(models_root(app)?.join(code))
}

/// Archive names are plain lower-case file names; never trust a path.
fn archive_name(name: &str) -> Result<&str, String> {
  let valid = name.ends_with(".gz")
    && name.len() <= 24
    && name
      .chars()
      .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.');
  if valid {
    Ok(name)
  } else {
    Err(format!("Invalid model file: {name}"))
  }
}

fn read_plan(dir: &Path) -> Option<ModelPlan> {
  let raw = std::fs::read_to_string(dir.join(PLAN_FILE)).ok()?;
  serde_json::from_str(&raw).ok()
}

/// Mozilla's model registry as JSON.
///
/// Fetched here instead of in the webview: Google's bucket only allows CORS
/// for some origins, and `http://tauri.localhost` is not one of them. The
/// response is cached on disk so the language picker also works offline.
#[tauri::command]
pub(crate) async fn bergamot_model_registry(app: tauri::AppHandle) -> Result<String, String> {
  let root = models_root(&app)?;
  let cache = root.join(REGISTRY_FILE);

  // Serve the cached copy immediately so the picker never waits on the
  // network, and refresh it in the background for the next launch.
  if let Ok(cached) = std::fs::read_to_string(&cache) {
    if !cached.trim().is_empty() {
      let cache_path = cache.clone();
      tauri::async_runtime::spawn(async move {
        if let Ok(fresh) = fetch_model_registry().await {
          let _ = std::fs::write(&cache_path, fresh);
        }
      });
      return Ok(cached);
    }
  }

  let text = fetch_model_registry().await?;
  std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
  // A failed cache write must not break the picker for this session.
  let _ = std::fs::write(&cache, &text);
  Ok(text)
}

async fn fetch_model_registry() -> Result<String, String> {
  let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(20))
    .build()
    .map_err(|error| error.to_string())?;

  let response = client
    .get(REGISTRY_URL)
    .send()
    .await
    .map_err(|error| format!("Model registry unavailable: {error}"))?;
  if !response.status().is_success() {
    return Err(format!(
      "Model registry unavailable ({})",
      response.status()
    ));
  }
  let text = response.text().await.map_err(|error| error.to_string())?;
  if text.trim().is_empty() {
    return Err("The model registry response was empty".to_string());
  }
  Ok(text)
}

#[tauri::command]
pub(crate) async fn bergamot_model_status(
  app: tauri::AppHandle,
  language: String,
) -> Result<ModelStatus, String> {
  let dir = language_dir(&app, &language)?;
  let Some(plan) = read_plan(&dir) else {
    return Ok(ModelStatus {
      ready: false,
      bytes: 0,
    });
  };

  let mut bytes = 0;
  for file in &plan.files {
    match std::fs::metadata(dir.join(&file.name)) {
      Ok(metadata) => bytes += metadata.len(),
      Err(_) => {
        return Ok(ModelStatus {
          ready: false,
          bytes,
        })
      }
    }
  }
  Ok(ModelStatus { ready: true, bytes })
}

/// The stored plan for a language, so the app can load a model offline.
#[tauri::command]
pub(crate) async fn read_bergamot_model_plan(
  app: tauri::AppHandle,
  language: String,
) -> Result<Option<ModelPlan>, String> {
  let dir = language_dir(&app, &language)?;
  Ok(read_plan(&dir))
}

/// Returns the stored archive as raw bytes (no JSON encoding of the payload).
#[tauri::command]
pub(crate) async fn read_bergamot_model_file(
  app: tauri::AppHandle,
  language: String,
  name: String,
) -> Result<tauri::ipc::Response, String> {
  let dir = language_dir(&app, &language)?;
  let file = archive_name(&name)?;
  let bytes = std::fs::read(dir.join(file)).map_err(|error| error.to_string())?;
  Ok(tauri::ipc::Response::new(bytes))
}

/// Cached English→target translations for the interface, as JSON.
///
/// Stored next to the model so the DOM translator can apply known strings
/// synchronously, before the browser paints.
#[tauri::command]
pub(crate) async fn read_interface_translation_cache(
  app: tauri::AppHandle,
  language: String,
) -> Result<Option<String>, String> {
  let dir = language_dir(&app, &language)?;
  match std::fs::read_to_string(dir.join(TRANSLATIONS_FILE)) {
    Ok(text) if !text.trim().is_empty() => Ok(Some(text)),
    _ => Ok(None),
  }
}

#[tauri::command]
pub(crate) async fn write_interface_translation_cache(
  app: tauri::AppHandle,
  language: String,
  json: String,
) -> Result<(), String> {
  if json.len() > MAX_TRANSLATIONS_BYTES {
    return Err("Translation cache is too large".to_string());
  }
  let dir = language_dir(&app, &language)?;
  std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
  std::fs::write(dir.join(TRANSLATIONS_FILE), json.as_bytes())
    .map_err(|error| format!("Failed to write translation cache: {error}"))
}

#[tauri::command]
pub(crate) async fn clear_interface_translation_cache(
  app: tauri::AppHandle,
  language: String,
) -> Result<(), String> {
  let dir = language_dir(&app, &language)?;
  match std::fs::remove_file(dir.join(TRANSLATIONS_FILE)) {
    Ok(()) => Ok(()),
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
    Err(error) => Err(format!("Failed to remove translation cache: {error}")),
  }
}

#[tauri::command]
pub(crate) async fn delete_bergamot_model(
  app: tauri::AppHandle,
  language: String,
) -> Result<bool, String> {
  let dir = language_dir(&app, &language)?;
  if !dir.exists() {
    return Ok(false);
  }
  std::fs::remove_dir_all(&dir).map_err(|error| error.to_string())?;
  Ok(true)
}

/// Downloads the archives of a model and reports progress through the
/// `bergamot-model-progress` event. The plan is written last, so an
/// interrupted download never counts as complete.
#[tauri::command]
pub(crate) async fn download_bergamot_model(
  app: tauri::AppHandle,
  language: String,
  plan: ModelPlan,
) -> Result<u64, String> {
  let dir = language_dir(&app, &language)?;
  std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;

  let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(600))
    .build()
    .map_err(|error| error.to_string())?;

  let mut total = 0u64;
  let mut received = 0u64;

  for file in &plan.files {
    let name = archive_name(&file.name)?;
    let response = client
      .get(&file.url)
      .send()
      .await
      .map_err(|error| format!("Download of {} failed: {error}", file.name))?;
    if !response.status().is_success() {
      return Err(format!(
        "Download of {} failed ({})",
        file.name,
        response.status()
      ));
    }

    total += response.content_length().unwrap_or(0);
    let mut stream = response.bytes_stream();
    let mut buffer: Vec<u8> = Vec::with_capacity(total as usize);
    while let Some(chunk) = stream.next().await {
      let chunk = chunk.map_err(|error| format!("Download of {} failed: {error}", file.name))?;
      buffer.extend_from_slice(&chunk);
      received += chunk.len() as u64;
      let _ = app.emit(
        "bergamot-model-progress",
        DownloadProgress {
          language: language.clone(),
          received,
          total,
        },
      );
    }

    let target = dir.join(name);
    let temporary = target.with_extension("part");
    std::fs::write(&temporary, &buffer).map_err(|error| error.to_string())?;
    std::fs::rename(&temporary, &target).map_err(|error| error.to_string())?;
  }

  let serialized = serde_json::to_vec_pretty(&plan).map_err(|error| error.to_string())?;
  std::fs::write(dir.join(PLAN_FILE), serialized).map_err(|error| error.to_string())?;

  Ok(received)
}
