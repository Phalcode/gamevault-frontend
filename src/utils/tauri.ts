const DEBUG_OVERRIDE_KEY = "gv_debug_tauri_mode";

/**
 * Check if the debug Tauri override is active (development-only).
 * When enabled, the app behaves as if running inside Tauri.
 */
export function isDebugTauriOverride(): boolean {
  try {
    return localStorage.getItem(DEBUG_OVERRIDE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setDebugTauriOverride(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(DEBUG_OVERRIDE_KEY, "true");
    } else {
      localStorage.removeItem(DEBUG_OVERRIDE_KEY);
    }
  } catch {
    // localStorage unavailable
  }
}

/**
 * Utility to check if the app is running as a Tauri desktop application
 */
export function isTauriApp(): boolean {
  if (isDebugTauriOverride()) return true;
  return (
    typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__)
  );
}

/**
 * Open an external URL in the user's default browser.
 * In Tauri, plain anchor links with `target="_blank"` are swallowed by the
 * router/webview, so we invoke the native `open_external_url` command instead.
 * On the web, fall back to `window.open`.
 */
export async function openExternalUrl(url: string): Promise<void> {
  try {
    if (isTauriApp()) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_external_url", { url });
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  } catch (error) {
    console.error("Failed to open external URL:", error);
  }
}
