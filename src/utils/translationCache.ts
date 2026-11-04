import { isTauriApp } from "@/utils/tauri";

/**
 * Persisted interface translations (English → target language).
 *
 * The DOM translator can only write a translation after the engine returned
 * it, which means the English text is painted first. With a cache, known
 * strings are replaced synchronously inside the MutationObserver callback,
 * before the browser paints. The cache is also what lets the first screen be
 * rendered translated instead of flashing English.
 *
 * Desktop builds keep the file next to the model, in the app data directory.
 * The installer clears the webview storage on updates, so localStorage is only
 * a fallback.
 */

const STORAGE_PREFIX = "gv_interface_translations";
const CACHE_VERSION = 1;
const PERSIST_DELAY_MS = 1500;
/** Upper bound so a long-running install cannot grow the file without limit. */
const MAX_ENTRIES = 20000;

interface StoredTranslationCache {
  version: number;
  translations: Record<string, string>;
}

const loaded = new Map<string, Map<string, string>>();
const loading = new Map<string, Promise<Map<string, string>>>();
const dirty = new Set<string>();
let persistTimer: number | null = null;

function storageKey(language: string): string {
  return `${STORAGE_PREFIX}:${language}`;
}

function parse(raw: string | null): Map<string, string> {
  const translations = new Map<string, string>();
  if (!raw) return translations;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredTranslationCache>;
    if (parsed.version !== CACHE_VERSION) return translations;
    if (!parsed.translations || typeof parsed.translations !== "object") {
      return translations;
    }
    for (const [source, target] of Object.entries(parsed.translations)) {
      if (typeof target === "string" && target.length > 0) {
        translations.set(source, target);
      }
    }
  } catch {
    // Corrupt cache: start empty instead of failing the translation.
  }
  return translations;
}

function serialize(language: string): string {
  const translations: Record<string, string> = {};
  for (const [source, target] of loaded.get(language) ?? []) {
    translations[source] = target;
  }
  const payload: StoredTranslationCache = {
    version: CACHE_VERSION,
    translations,
  };
  return JSON.stringify(payload);
}

async function readRaw(language: string): Promise<string | null> {
  if (isTauriApp()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const stored = await invoke<string | null>(
        "read_interface_translation_cache",
        { language },
      );
      if (stored) return stored;
    } catch {
      // Older build without the command: fall through to the webview copy.
    }
  }
  try {
    return localStorage.getItem(storageKey(language));
  } catch {
    return null;
  }
}

async function writeRaw(language: string, payload: string): Promise<void> {
  if (isTauriApp()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("write_interface_translation_cache", {
        language,
        json: payload,
      });
      return;
    } catch {
      // Fall through to localStorage so the session still benefits.
    }
  }
  try {
    localStorage.setItem(storageKey(language), payload);
  } catch {
    // Storage unavailable: the in-memory map keeps working for this session.
  }
}

/** Loads (once) the cache for `language` into memory. */
export function loadTranslationCache(
  language: string,
): Promise<Map<string, string>> {
  const inMemory = loaded.get(language);
  if (inMemory) return Promise.resolve(inMemory);

  const pending = loading.get(language);
  if (pending) return pending;

  const promise = (async () => {
    const translations = parse(await readRaw(language));
    loaded.set(language, translations);
    loading.delete(language);
    return translations;
  })();
  loading.set(language, promise);
  return promise;
}

/**
 * Synchronous lookup. Returns `undefined` when the cache for `language` has
 * not been loaded yet, so callers can fall back to the engine.
 */
export function getCachedTranslation(
  language: string,
  text: string,
): string | undefined {
  return loaded.get(language)?.get(text);
}

/** Whether the cache for `language` has already been loaded into memory. */
export function isTranslationCacheLoaded(language: string): boolean {
  return loaded.has(language);
}

/** Stores translations and schedules a debounced write to disk. */
export function rememberTranslations(
  language: string,
  pairs: readonly (readonly [string, string])[],
): void {
  let translations = loaded.get(language);
  if (!translations) {
    translations = new Map<string, string>();
    loaded.set(language, translations);
  }

  let changed = false;
  for (const [source, target] of pairs) {
    if (!source || !target || source === target) continue;
    if (translations.get(source) === target) continue;
    if (translations.size >= MAX_ENTRIES && !translations.has(source)) continue;
    translations.set(source, target);
    changed = true;
  }
  if (!changed) return;

  dirty.add(language);
  schedulePersist();
}

function schedulePersist(): void {
  if (typeof window === "undefined") return;
  if (persistTimer !== null) return;
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    void flushTranslationCache();
  }, PERSIST_DELAY_MS);
}

/** Writes pending changes to disk. Safe to call at any time. */
export async function flushTranslationCache(): Promise<void> {
  const languages = [...dirty];
  dirty.clear();
  for (const language of languages) {
    try {
      await writeRaw(language, serialize(language));
    } catch {
      // Keep the in-memory cache; the next change retries.
      dirty.add(language);
    }
  }
}

/** Drops the cache for `language`, in memory and on disk. */
export async function clearTranslationCache(language: string): Promise<void> {
  loaded.delete(language);
  loading.delete(language);
  dirty.delete(language);
  if (isTauriApp()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("clear_interface_translation_cache", { language });
    } catch {
      // Fall through to the webview copy.
    }
  }
  try {
    localStorage.removeItem(storageKey(language));
  } catch {
    // Storage unavailable.
  }
}

if (typeof window !== "undefined") {
  // Best effort: persist buffered translations when the window goes away.
  window.addEventListener("pagehide", () => {
    if (dirty.size > 0) void flushTranslationCache();
  });
}
