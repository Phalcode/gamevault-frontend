/**
 * Register the F5 hotkey to reload the app.
 * Only wired up in the Tauri desktop app — regular browsers already handle
 * F5 natively, and the packaged webview does not.
 *
 * `window.location.reload()` reloads the current page of the Tauri webview
 * exactly like F5 in a browser, so no extra Tauri permission is required.
 */
export function registerReloadHotkey(): () => void {
  const handler = (event: KeyboardEvent) => {
    if (event.key !== "F5") return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
      return;
    }
    event.preventDefault();
    window.location.reload();
  };

  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}
