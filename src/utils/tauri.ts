/**
 * Utility to check if the app is running as a Tauri desktop application
 */
export function isTauriApp(): boolean {
  return Boolean((window as any).__TAURI_INTERNALS__);
}
