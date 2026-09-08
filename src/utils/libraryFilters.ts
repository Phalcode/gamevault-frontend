import { GamevaultGameTypeEnum } from "@/api/models/GamevaultGame";
import { ProgressStateEnum } from "@/api/models/Progress";
import { BookmarkFilter, EarlyAccessFilter } from "@/utils/gamesQuery";

export interface LibraryFilterState {
  bookmarkFilter: BookmarkFilter;
  earlyAccess: EarlyAccessFilter;
  gameState: ProgressStateEnum | "";
  releaseDateFrom: string;
  releaseDateTo: string;
  gameTypes: unknown[];
  tags: unknown[];
  genres: unknown[];
  developers: unknown[];
  publishers: unknown[];
}

/** True when any filter differs from its default value. */
export function hasActiveFilters(state: LibraryFilterState): boolean {
  return (
    state.bookmarkFilter !== "all" ||
    state.gameTypes.length > 0 ||
    state.tags.length > 0 ||
    state.genres.length > 0 ||
    state.developers.length > 0 ||
    state.publishers.length > 0 ||
    state.gameState !== "" ||
    state.releaseDateFrom !== "" ||
    state.releaseDateTo !== "" ||
    state.earlyAccess !== "all"
  );
}

/** Number of active filter selections (for the Filters toggle badge). */
export function activeFilterCount(state: LibraryFilterState): number {
  let count = 0;
  if (state.bookmarkFilter !== "all") count++;
  if (state.earlyAccess !== "all") count++;
  if (state.gameState !== "") count++;
  if (state.releaseDateFrom !== "") count++;
  if (state.releaseDateTo !== "") count++;
  count +=
    state.gameTypes.length +
    state.tags.length +
    state.genres.length +
    state.developers.length +
    state.publishers.length;
  return count;
}

/**
 * Read a repeated-or-comma-separated URL param into a trimmed non-empty list.
 */
export function getParamValues(
  params: URLSearchParams,
  key: string,
): string[] {
  const repeated = params.getAll(key).filter(Boolean);
  if (repeated.length > 0) return repeated;
  const single = params.get(key);
  if (!single) return [];
  return single
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Replace a URL param with a list of values (deleting it when empty). */
export function setParamValues(
  params: URLSearchParams,
  key: string,
  values: string[],
): void {
  params.delete(key);
  values.forEach((v) => params.append(key, v));
}

export function isProgressState(value: string): value is ProgressStateEnum {
  return Object.values(ProgressStateEnum).includes(value as ProgressStateEnum);
}

export function isGameType(value: string): value is GamevaultGameTypeEnum {
  return Object.values(GamevaultGameTypeEnum).includes(
    value as GamevaultGameTypeEnum,
  );
}

export function isEarlyAccess(value: string): value is EarlyAccessFilter {
  return value === "all" || value === "true" || value === "false";
}

export function isBookmark(value: string): value is BookmarkFilter | "1" {
  return (
    value === "all" || value === "mine" || value === "others" || value === "1"
  );
}

/** Map installed game id → installation info, skipping non-positive ids. */
export function buildInstalledGameMap<T extends { gameId: number }>(
  installedGames: T[],
): Map<number, T> {
  const map = new Map<number, T>();
  for (const ig of installedGames) {
    if (ig.gameId > 0) map.set(ig.gameId, ig);
  }
  return map;
}

export interface InstalledGamesFilters {
  search: string;
  gameTypes: string[];
  tags: string[];
  genres: string[];
  developers: string[];
  publishers: string[];
}

function matchesAnyName(
  metaList: any,
  names: string[],
): boolean {
  if (!Array.isArray(metaList)) return false;
  return names.some((name) =>
    metaList.some(
      (entry: any) =>
        (entry.name ?? entry)?.toString().toLowerCase() === name.toLowerCase(),
    ),
  );
}

/**
 * Client-side filter + sort of locally-installed games using the same Library
 * criteria. Search (case-insensitive), game-type, tag/genre/developer/publisher
 * filters, then sort by most-recently installed/played (desc) with a title
 * tie-break for a stable carousel order.
 */
export function filterAndSortInstalledGames(
  games: any[],
  filters: InstalledGamesFilters,
): any[] {
  let filtered = games;

  if (filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    filtered = filtered.filter((g) =>
      (g.title ?? g.sort_title ?? "").toLowerCase().includes(q),
    );
  }

  if (filters.gameTypes.length > 0) {
    filtered = filtered.filter(
      (g) => g.type && filters.gameTypes.includes(g.type),
    );
  }

  if (filters.tags.length > 0) {
    filtered = filtered.filter((g) => matchesAnyName(g.metadata?.tags, filters.tags));
  }
  if (filters.genres.length > 0) {
    filtered = filtered.filter((g) => matchesAnyName(g.metadata?.genres, filters.genres));
  }
  if (filters.developers.length > 0) {
    filtered = filtered.filter((g) => matchesAnyName(g.metadata?.developers, filters.developers));
  }
  if (filters.publishers.length > 0) {
    filtered = filtered.filter((g) => matchesAnyName(g.metadata?.publishers, filters.publishers));
  }

  return [...filtered].sort((a, b) => {
    const ia = a._installedInfo;
    const ib = b._installedInfo;
    const ra = Math.max(Number(ia?.installedAt) || 0, Number(ia?.lastPlayedAt) || 0);
    const rb = Math.max(Number(ib?.installedAt) || 0, Number(ib?.lastPlayedAt) || 0);
    if (rb !== ra) return rb - ra;
    return (a.sort_title ?? a.title ?? "").localeCompare(
      b.sort_title ?? b.title ?? "",
    );
  });
}
