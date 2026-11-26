import { normalizeServerIdentityUrl } from "@/utils/serverIdentity";

export interface OfflineTimeIdentity {
  userId: number;
  serverUrl?: string | null;
  serverIdentifiers?: string[] | null;
}

function normalizedIdentifier(value: string): string {
  const normalized = normalizeServerIdentityUrl(value);
  return normalized || value.trim();
}

/**
 * True when an offline playtime file belongs to the current server/account.
 *
 * Files written before server ownership was recorded have no server markers;
 * those keep the old behavior and are replayed against the current server.
 */
export function offlineTimeBelongsToServer(
  file: OfflineTimeIdentity,
  serverIdentifiers: string[],
  userId: number,
): boolean {
  if (file.userId > 0 && file.userId !== userId) return false;

  const fileIdentifiers = (
    file.serverIdentifiers?.length
      ? file.serverIdentifiers
      : file.serverUrl
        ? [file.serverUrl]
        : []
  )
    .map(normalizedIdentifier)
    .filter(Boolean);
  if (!fileIdentifiers.length) return true;
  if (!serverIdentifiers.length) return false;

  const current = new Set(
    serverIdentifiers.map(normalizedIdentifier).filter(Boolean),
  );
  return fileIdentifiers.some((identifier) => current.has(identifier));
}
