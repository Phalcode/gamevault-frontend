import { getServerNamespace, normalizeServerUrl } from "@/utils/mediaCache";

/** localStorage key prefix for the last known UUID of a server URL. */
const SERVER_UUID_STORAGE_PREFIX = "gv_server_uuid:";
/** localStorage key prefix for the last known URL of a server UUID. */
const SERVER_URL_STORAGE_PREFIX = "gv_server_url:";

/**
 * Normalizes a server URL for comparisons and cache namespaces.
 *
 * Falls back to trimming the raw value when it is not a parseable URL, so
 * callers never crash on user-entered server addresses.
 */
export function normalizeServerIdentityUrl(serverUrl?: string | null): string {
  const raw = serverUrl?.trim();
  if (!raw) return "";

  try {
    return normalizeServerUrl(raw);
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

/** Stores the UUID of a server URL, so offline scans can still identify it. */
export function rememberServerUuid(
  serverUrl?: string | null,
  serverUuid?: string | null,
): void {
  const url = normalizeServerIdentityUrl(serverUrl);
  const uuid = serverUuid?.trim();
  if (!url || !uuid) return;

  try {
    localStorage.setItem(
      `${SERVER_UUID_STORAGE_PREFIX}${getServerNamespace(url)}`,
      uuid,
    );
    localStorage.setItem(`${SERVER_URL_STORAGE_PREFIX}${uuid}`, url);
  } catch {
    // Storage can be unavailable (privacy mode); identity still works online.
  }
}

/** Returns the last known URL for a remembered server UUID. */
export function getRememberedServerUrl(
  serverUuid?: string | null,
): string | null {
  const uuid = serverUuid?.trim();
  if (!uuid) return null;

  try {
    return (
      localStorage.getItem(`${SERVER_URL_STORAGE_PREFIX}${uuid}`)?.trim() ||
      null
    );
  } catch {
    return null;
  }
}

/** Resolves a URL from a URL identifier, or from a remembered UUID. */
export function serverUrlForIdentifier(
  identifier?: string | null,
): string | null {
  const value = identifier?.trim();
  if (!value) return null;

  const normalized = normalizeServerIdentityUrl(value);
  if (/^https?:\/\//i.test(normalized)) return normalized || null;
  return getRememberedServerUrl(value);
}

/** Returns the last UUID remembered for a server URL, if any. */
export function getRememberedServerUuid(
  serverUrl?: string | null,
): string | null {
  const url = normalizeServerIdentityUrl(serverUrl);
  if (!url) return null;

  try {
    return (
      localStorage
        .getItem(`${SERVER_UUID_STORAGE_PREFIX}${getServerNamespace(url)}`)
        ?.trim() || null
    );
  } catch {
    return null;
  }
}

/**
 * Identifiers the native side may match against a version's recorded server.
 *
 * Ordered by usefulness: the live UUID, the remembered UUID, then the URL.
 * Values are deduplicated so callers can pass this straight to Tauri.
 */
export function serverIdentifiers(
  serverUrl?: string | null,
  serverUuid?: string | null,
): string[] {
  const url = normalizeServerIdentityUrl(serverUrl);
  const uuid = serverUuid?.trim() || getRememberedServerUuid(url);

  return [...new Set([uuid, url].filter((value): value is string => !!value))];
}
