import { isTauriApp } from "./tauri";
import {
  getBergamotModelStatus,
  listBergamotLanguages,
  type BergamotModelStatus,
} from "./bergamotEngine";
import {
  startUiTranslation,
  stopUiTranslation,
  translatedUiLanguage,
} from "./domTranslation";

/**
 * Interface translation for the desktop app.
 *
 * GameVault's UI is English-only, and the desktop webviews (WebView2,
 * WKWebView, WebKitGTK) have no built-in translation. Instead of translating
 * every string by hand, the app runs Mozilla's Bergamot engine locally: the
 * model for the chosen language is downloaded once and then works offline.
 *
 * Only interface text is translated. Game titles, tags, descriptions, notes
 * and user names are marked `translate="no"` and stay as they are.
 *
 * The web build leaves this alone and relies on the browser's own translation.
 */

export const INTERFACE_TRANSLATION_OFF = "off";

export interface InterfaceTranslationLanguage {
  /** Mozilla model code, used as `<source>-<code>` in their registry. */
  code: string;
  /** Native name shown in the picker. */
  label: string;
}

/** Native name of a model code, e.g. `de` → `Deutsch`, `zh_hant` → `中文（繁體）`. */
export function interfaceTranslationLanguageLabel(code: string): string {
  try {
    const names = new Intl.DisplayNames([navigator.language || "en"], {
      type: "language",
    });
    // Registry codes use an underscore for script variants (`zh_hant`).
    return names.of(code.replace(/_/g, "-")) ?? code;
  } catch {
    return code;
  }
}

/**
 * The languages that can actually be installed: every language Mozilla
 * currently publishes a complete English→language model for, read from their
 * registry. Fetching the registry needs a connection once; afterwards it is
 * cached, so a downloaded model keeps working offline.
 */
export async function loadInterfaceTranslationLanguages(): Promise<
  InterfaceTranslationLanguage[]
> {
  const codes = await listBergamotLanguages();
  return codes
    .map((code) => ({ code, label: interfaceTranslationLanguageLabel(code) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Webview copy, kept in sync with `gamevault-settings.json`. */
const STORAGE_KEY = "gv_interface_translation_language";

/**
 * Registry codes look like `de`, `pt` or `zh_hant`. Anything else, including
 * an empty value, means "off". Whether Mozilla actually has a model for the
 * code is decided when the picker loads the registry.
 */
export function normalizeInterfaceTranslationLanguage(value: unknown): string {
  const code = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!code || code === INTERFACE_TRANSLATION_OFF) {
    return INTERFACE_TRANSLATION_OFF;
  }
  return /^[a-z]{2,3}(?:_[a-z]{2,8})?$/.test(code)
    ? code
    : INTERFACE_TRANSLATION_OFF;
}

function readWebviewCopy(): string | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? normalizeInterfaceTranslationLanguage(stored) : null;
  } catch {
    // Storage unavailable (private mode / blocked)
    return null;
  }
}

/**
 * The language the interface should be translated into. Desktop builds keep
 * the choice in `gamevault-settings.json` because the installer clears the
 * webview's storage on updates; the webview copy is the fallback.
 */
export async function readInterfaceTranslationLanguage(): Promise<string> {
  const webviewCopy = readWebviewCopy();
  if (!isTauriApp()) return webviewCopy ?? INTERFACE_TRANSLATION_OFF;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const stored = await invoke<string | null>(
      "get_interface_translation_language",
    );
    if (stored) return normalizeInterfaceTranslationLanguage(stored);
  } catch {
    // Native settings unavailable: fall back to the webview copy.
  }
  return webviewCopy ?? INTERFACE_TRANSLATION_OFF;
}

/** Persists the choice. The caller applies it via `applyInterfaceTranslation`. */
export async function writeInterfaceTranslationLanguage(
  language: string,
): Promise<void> {
  const normalized = normalizeInterfaceTranslationLanguage(language);
  try {
    localStorage.setItem(STORAGE_KEY, normalized);
  } catch {
    // Storage unavailable
  }
  if (!isTauriApp()) return;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_interface_translation_language", {
      language: normalized === INTERFACE_TRANSLATION_OFF ? null : normalized,
    });
  } catch {
    // Native settings unavailable: the webview copy still applies.
  }
}

/**
 * Switches the running interface to `language`, or back to English for
 * `INTERFACE_TRANSLATION_OFF`. Rejects when the model for the language is not
 * downloaded yet or the engine cannot be loaded.
 */
export async function applyInterfaceTranslation(
  language: string,
): Promise<void> {
  if (!isTauriApp()) return;
  const target = normalizeInterfaceTranslationLanguage(language);

  if (target === INTERFACE_TRANSLATION_OFF) {
    stopUiTranslation();
    document.documentElement.lang = "en";
    return;
  }

  await startUiTranslation(target);
  // Registry codes use an underscore for script variants (`zh_hant`).
  document.documentElement.lang = target.replace(/_/g, "-");
}

/** Language the interface is currently translated into, or null. */
export function activeInterfaceTranslation(): string | null {
  return isTauriApp() ? translatedUiLanguage() : null;
}

/** Whether translation is possible for `language` (model downloaded). */
export function isInterfaceTranslationAvailable(
  language: string,
): Promise<BergamotModelStatus> {
  return getBergamotModelStatus(language);
}

export { getBergamotModelStatus };
export type { BergamotModelStatus };
