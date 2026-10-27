import { normalizeServerUrl } from "./authConfig";

/**
 * Resolve the origin that share links should point at.
 *
 * The Web UI is normally served by the GameVault backend itself, so
 * `window.location` is already a valid, externally reachable origin. Tauri
 * builds, however, load the bundled Web UI from `http://tauri.localhost`,
 * which only exists inside the desktop app. Links copied there must therefore
 * be anchored to the configured GameVault server instead.
 */
function resolveShareOrigin(serverUrl?: string | null): string {
  const normalized = normalizeServerUrl(serverUrl ?? "");
  if (normalized) return normalized;

  if (typeof window === "undefined") return "";
  try {
    return new URL(window.location.href).origin;
  } catch {
    return "";
  }
}

/**
 * Build an externally shareable link to a Web UI route (e.g. a game page).
 *
 * `route` is the app-internal path, typically
 * `${window.location.pathname}${window.location.search}${window.location.hash}`.
 * Combining it with the GameVault server origin avoids leaking the
 * `http://tauri.localhost` origin used by the bundled desktop Web UI.
 */
export function buildShareUrl(
  serverUrl: string | null | undefined,
  route: string,
): string {
  const origin = resolveShareOrigin(serverUrl);
  const suffix = route.startsWith("/") ? route : `/${route}`;
  return `${origin}${suffix}`;
}
