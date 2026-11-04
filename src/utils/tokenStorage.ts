import { isTauriApp } from "@/utils/tauri";
import { AUTH_REFRESH_STORAGE_KEY } from "@/utils/authConfig";
import {
  readVaultSecret,
  removeVaultSecret,
  writeVaultSecret,
} from "@/utils/secretVault";

/**
 * Token storage abstraction.
 *
 * In the Tauri desktop app the refresh token is kept in a Stronghold vault —
 * an encrypted, cross-platform secret store (official Tauri plugin) that works
 * on Windows, macOS and Linux. This removes the token from the webview's
 * `localStorage`, which is readable by any JS running in the page (XSS).
 *
 * On the plain web build we fall back to `localStorage`, which is the norm for
 * browser-delivered SPAs.
 *
 * We keep an in-memory cache so AuthContext can read the token synchronously;
 * writes update the cache immediately and persist in the background (still
 * awaited by callers so a close right after login doesn't lose the token).
 */
let cachedRefreshToken: string | null = null;
let cacheLoaded = false;
let initPromise: Promise<void> | null = null;

function readLocal() {
  try {
    return localStorage.getItem(AUTH_REFRESH_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeLocal(token: string) {
  try {
    localStorage.setItem(AUTH_REFRESH_STORAGE_KEY, token);
  } catch {
    /* storage unavailable */
  }
}

function clearLocal() {
  try {
    localStorage.removeItem(AUTH_REFRESH_STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Loads the refresh token into memory. Call once before reading it. */
export function initTokenStorage(): Promise<void> {
  // Deduplicate concurrent initialisations (e.g. bootstrap vs a component's
  // first authenticated request racing at startup).
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (cacheLoaded) return;
    try {
      if (isTauriApp()) {
        cachedRefreshToken =
          (await readVaultSecret(AUTH_REFRESH_STORAGE_KEY)) ?? readLocal();
      } else {
        cachedRefreshToken = readLocal();
      }
    } catch (e) {
      console.warn("[tokenStorage] init failed, using localStorage", e);
      cachedRefreshToken = readLocal();
    }
    cacheLoaded = true;
  })();
  return initPromise;
}

/** Synchronous read of the cached refresh token. */
export function getRefreshToken(): string | null {
  return cachedRefreshToken;
}

/** Updates the cache and persists the token to secure storage. */
export async function setRefreshToken(token: string): Promise<void> {
  cachedRefreshToken = token;
  try {
    if (isTauriApp()) {
      await writeVaultSecret(AUTH_REFRESH_STORAGE_KEY, token);
    } else {
      writeLocal(token);
    }
  } catch (e) {
    console.warn(
      "[tokenStorage] persist failed, falling back to localStorage",
      e,
    );
    // Keep the session working even if secure storage is unavailable.
    writeLocal(token);
  }
}

/** Clears the cache and removes the token from secure storage. */
export async function removeRefreshToken(): Promise<void> {
  cachedRefreshToken = null;
  try {
    if (isTauriApp()) {
      await removeVaultSecret(AUTH_REFRESH_STORAGE_KEY);
    } else {
      clearLocal();
    }
  } catch (e) {
    console.warn("[tokenStorage] remove failed", e);
    clearLocal();
  }
}
