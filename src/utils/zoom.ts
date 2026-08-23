import { isTauriApp } from "./tauri";

const STORAGE_KEY = "gv_zoom_level";

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;
export const ZOOM_STEP = 0.1;
export const DEFAULT_ZOOM = 1;

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export function getStoredZoom(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) return clampZoom(parseFloat(raw));
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_ZOOM;
}

export function zoomPercent(zoom: number): number {
  return Math.round(clampZoom(zoom) * 100);
}

/**
 * Apply a zoom level (clamped + persisted) to the running shell.
 * In the Tauri desktop app we use the native webview zoom (crisp text and
 * works on Windows/macOS/Linux); on the web we fall back to the CSS `zoom`
 * property.
 */
export async function applyZoom(level: number): Promise<void> {
  const zoom = clampZoom(level);

  try {
    localStorage.setItem(STORAGE_KEY, String(zoom));
  } catch {
    // localStorage unavailable
  }

  if (isTauriApp()) {
    try {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      await getCurrentWebview().setZoom(zoom);
      return;
    } catch {
      // Permission missing or API unavailable — fall through to CSS zoom.
    }
  }

  document.documentElement.style.zoom = String(zoom);
}

/** Adjust zoom by a delta (e.g. +0.1 to zoom in) and return the new level. */
export function adjustZoom(delta: number): number {
  const next = clampZoom(getStoredZoom() + delta);
  void applyZoom(next);
  return next;
}

/** Reset zoom to 100% and return the (new) level. */
export function resetZoomLevel(): number {
  void applyZoom(DEFAULT_ZOOM);
  return DEFAULT_ZOOM;
}

/**
 * Register Ctrl/Cmd + '+' / '-' / '0' hotkeys for zooming.
 * Only wired up in the Tauri desktop app — regular browsers already handle
 * these hotkeys natively and would fight us over the keydown event.
 */
export function registerZoomHotkeys(): () => void {
  const handler = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.altKey || event.shiftKey) return;

    const key = event.key.toLowerCase();
    let delta = 0;
    let reset = false;

    if (key === "+" || key === "=") {
      delta = ZOOM_STEP;
    } else if (key === "-" || key === "_") {
      delta = -ZOOM_STEP;
    } else if (key === "0") {
      reset = true;
    } else {
      return;
    }

    event.preventDefault();
    if (reset) {
      resetZoomLevel();
    } else {
      adjustZoom(delta);
    }
  };

  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}
