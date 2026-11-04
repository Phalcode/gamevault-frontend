import type { InstalledGameInfo } from "@/hooks/useInstalledGames";
import { getRootPaths } from "@/utils/rootPaths";

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
    installedAt: Number(raw.installedAt ?? raw.installed_at ?? 0),
    lastPlayedAt: 0,
  };
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
 * Finds an installed game by id across all configured root paths.
 *
 * Used by deep links, which have no library state to look the game up in.
 * Roots are scanned in order and the first match wins; an unreadable root is
 * skipped rather than failing the whole lookup.
 */
export async function findInstalledGameById(
  gameId: number,
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
      if (info.gameId !== gameId) continue;
      if (!info.installationDirectory || !info.versionDirectory) continue;
      return info;
    }
  }

  return null;
}
