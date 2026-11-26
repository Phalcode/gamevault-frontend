import type { InstalledGameInfo } from "@/hooks/useInstalledGames";
import { getRootPaths } from "@/utils/rootPaths";
import { serverUrlForIdentifier } from "@/utils/serverIdentity";

/** One server that owns a local installation, with its game id there. */
export interface InstalledGameOwner {
  /** Canonical server URL when known. */
  serverUrl: string | null;
  /** URL/UUID identifiers that refer to this server. */
  identifiers: string[];
  gameId: number;
}

function normalizeOwner(raw: any): InstalledGameOwner {
  return {
    serverUrl: raw?.serverUrl ?? raw?.server_url ?? null,
    identifiers: Array.isArray(raw?.identifiers)
      ? raw.identifiers.map((value: unknown) => String(value))
      : [],
    gameId: Number(raw?.gameId ?? raw?.game_id ?? 0),
  };
}

/**
 * Normalize a raw `list_installed_games` result (which may use either
 * camelCase or snake_case keys) into a consistent `InstalledGameInfo`.
 */
export function normalizeInstalledGame(raw: any): InstalledGameInfo {
  return {
    gameId: raw.gameId ?? raw.game_id ?? 0,
    gameTitle: raw.gameTitle ?? raw.game_title ?? "",
    gameMetadata: raw.gameMetadata ?? raw.game_metadata ?? null,
    cachedMetadata: raw.cachedMetadata ?? raw.cached_metadata ?? null,
    gameType: raw.gameType ?? raw.game_type ?? null,
    versionId: raw.versionId ?? raw.version_id ?? 0,
    versionName: raw.versionName ?? raw.version_name ?? "",
    installationDirectory:
      raw.installationDirectory ?? raw.installation_directory ?? "",
    versionDirectory: raw.versionDirectory ?? raw.version_directory ?? "",
    owners: Array.isArray(raw.owners) ? raw.owners.map(normalizeOwner) : [],
    installedAt: Number(raw.installedAt ?? raw.installed_at ?? 0),
    lastPlayedAt: 0,
  };
}

function ownerMatchesServer(
  owner: InstalledGameOwner,
  serverIdentifiers: string[],
): boolean {
  return serverIdentifiers.some((identifier) =>
    owner.identifiers.includes(identifier),
  );
}

/** The ownership record of an install on the current server, if any. */
export function installedGameOwnerForServer(
  game: Pick<InstalledGameInfo, "owners">,
  serverIdentifiers: string[],
): InstalledGameOwner | undefined {
  if (!serverIdentifiers.length) return undefined;
  return (game.owners ?? []).find((owner) =>
    ownerMatchesServer(owner, serverIdentifiers),
  );
}

/** The best ownership record for display when the current server has none. */
export function installedGamePrimaryOwner(
  game: Pick<InstalledGameInfo, "owners">,
): InstalledGameOwner | undefined {
  const owners = game.owners ?? [];
  return owners.find((owner) => !!owner.serverUrl) ?? owners[0];
}

/** Ownership record used to display an installed game on this server. */
export function installedGameDisplayOwner(
  game: Pick<InstalledGameInfo, "owners">,
  serverIdentifiers: string[],
): InstalledGameOwner | undefined {
  return (
    installedGameOwnerForServer(game, serverIdentifiers) ??
    installedGamePrimaryOwner(game)
  );
}

/** Real URL of the server that owns an installation, when it can be resolved. */
export function installedGameOriginServerUrl(
  game: Pick<InstalledGameInfo, "owners">,
  serverIdentifiers: string[],
): string | null {
  const owner = installedGameDisplayOwner(game, serverIdentifiers);
  if (!owner) return null;
  return (
    owner.serverUrl ??
    owner.identifiers.map(serverUrlForIdentifier).find(Boolean) ??
    null
  );
}

/** Stable React/filter key for an install, independent of the current server. */
export function installedGameKey(
  game: Pick<InstalledGameInfo, "owners" | "gameId" | "versionDirectory">,
): string {
  const owner = installedGamePrimaryOwner(game);
  const gameId = owner && owner.gameId > 0 ? owner.gameId : game.gameId;
  return `${owner?.serverUrl ?? owner?.identifiers[0] ?? "unknown"}:${gameId}:${
    game.versionDirectory
  }`;
}

/** Normalize raw results and deduplicate by `gameId:versionDirectory`. */
export function normalizeAndDedupeInstalledGames(
  rawResults: any[],
): InstalledGameInfo[] {
  const seen = new Set<string>();
  const out: InstalledGameInfo[] = [];
  for (const raw of rawResults) {
    const info = normalizeInstalledGame(raw);
    const key = `${info.gameId}:${info.versionDirectory}`;
    if (info.gameId > 0 && !seen.has(key)) {
      seen.add(key);
      out.push(info);
    }
  }
  return out;
}

/**
 * Finds an installed game by id across all configured root paths, restricted
 * to the current server.
 *
 * Used by deep links, which have no library state to look the game up in.
 * Roots are scanned in order and the first match wins; an unreadable root is
 * skipped rather than failing the whole lookup.
 */
export async function findInstalledGameById(
  gameId: number,
  serverIdentifiers: string[],
): Promise<InstalledGameInfo | null> {
  if (!Number.isSafeInteger(gameId) || gameId <= 0) return null;

  const roots = getRootPaths();
  if (roots.length === 0) return null;

  const { invoke } = await import("@tauri-apps/api/core");

  for (const root of roots) {
    const rawResults = await invoke<any[]>("list_installed_games", {
      selectedRoot: root.path,
    }).catch(() => [] as any[]);

    if (!Array.isArray(rawResults)) continue;

    for (const raw of rawResults) {
      const info = normalizeInstalledGame(raw);
      const owner = installedGameOwnerForServer(info, serverIdentifiers);
      if (!owner || owner.gameId !== gameId) continue;
      if (!info.installationDirectory || !info.versionDirectory) continue;
      return { ...info, gameId: owner.gameId };
    }
  }

  return null;
}
