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
