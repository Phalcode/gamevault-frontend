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
export function getParamValues(params: URLSearchParams, key: string): string[] {
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
  /** Bookmark filter; ignored when no user id is known (mirrors the API). */
  bookmarkFilter?: BookmarkFilter;
  /** Progress state filter; ignored when no user id is known (mirrors the API). */
  gameState?: ProgressStateEnum | "";
  releaseDateFrom?: string;
  releaseDateTo?: string;
  earlyAccess?: EarlyAccessFilter;
  /** Library sort key, e.g. `sort_title` or `metadata.rating`. */
  sortBy?: string;
  order?: "ASC" | "DESC";
  userId?: unknown;
}

/** Name-only metadata collections that can be filtered by name. */
export type NamedMetadataField =
  "tags" | "genres" | "developers" | "publishers";

export interface NamedFilterOption {
  id: string;
  name: string;
}

function matchesAnyName(metaList: any, names: string[]): boolean {
  if (!Array.isArray(metaList)) return false;
  return names.some((name) =>
    metaList.some(
      (entry: any) =>
        (entry.name ?? entry)?.toString().toLowerCase() === name.toLowerCase(),
    ),
  );
}

function entryName(entry: any): string | null {
  const name = (entry?.name ?? entry)?.toString().trim();
  return name ? name : null;
}

function toTime(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const time =
    value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(time) ? time : null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function installedTitle(game: any): string {
  return String(
    game?.sort_title ?? game?.title ?? game?.metadata?.title ?? "",
  ).toLowerCase();
}

/** Lowercased haystack for search, mirroring the API's searchable columns. */
function installedSearchText(game: any): string {
  return [
    game?.title,
    game?.sort_title,
    game?.metadata?.title,
    game?.metadata?.description,
  ]
    .filter((value) => value !== null && value !== undefined)
    .map((value) => String(value).toLowerCase())
    .join("\n");
}

/** Size of the game (or its installed version) in bytes, if known. */
export function installedGameSizeBytes(game: any): number | null {
  const legacy = toNumber(game?.size);
  if (legacy !== null) return legacy;
  const versions = Array.isArray(game?.versions) ? game.versions : [];
  if (versions.length === 0) return null;
  const installedVersionId = game?._installedInfo?.versionId;
  const version =
    versions.find((v: any) => v?.id === installedVersionId) ?? versions[0];
  return toNumber(version?.size);
}

function installedReleaseDate(game: any): number | null {
  return toTime(game?.metadata?.release_date ?? game?.release_date);
}

function installedEarlyAccess(game: any): boolean | null {
  if (typeof game?.metadata?.early_access === "boolean") {
    return game.metadata.early_access;
  }
  if (typeof game?.early_access === "boolean") return game.early_access;
  const versions = Array.isArray(game?.versions) ? game.versions : [];
  if (versions.length === 0) return null;
  const installedVersionId = game?._installedInfo?.versionId;
  const version =
    versions.find((v: any) => v?.id === installedVersionId) ?? versions[0];
  return typeof version?.early_access === "boolean"
    ? version.early_access
    : null;
}

/** The current user's progress record for a game, if it is known locally. */
function progressForUser(game: any, userId: unknown): any | undefined {
  if (userId === null || userId === undefined) return undefined;
  const progresses = game?.progresses;
  if (!Array.isArray(progresses)) return undefined;
  const id = String(userId);
  return progresses.find(
    (progress: any) =>
      progress?.user != null &&
      String(progress.user.id ?? progress.user.ID) === id,
  );
}

function bookmarkedUserIds(game: any): string[] {
  const users = game?.bookmarked_users ?? game?.bookmarkedUsers;
  if (!Array.isArray(users)) return [];
  return users
    .map((user: any) => user?.id ?? user?.ID)
    .filter((id: unknown) => id !== null && id !== undefined)
    .map((id: unknown) => String(id));
}

/** Day-granular key (`YYYY-MM-DD`) so date filters match `<input type="date">`. */
function dayKey(value: number | null): string | null {
  if (value === null) return null;
  return new Date(value).toISOString().slice(0, 10);
}

/** Sort metric for the installed list, mirroring the server's sort columns. */
function installedSortValue(game: any, sortBy: string): string | number | null {
  switch (sortBy) {
    case "size":
      return installedGameSizeBytes(game);
    case "created_at":
      return toTime(game?.created_at);
    case "metadata.release_date":
      return installedReleaseDate(game);
    case "metadata.rating":
      return toNumber(game?.metadata?.rating);
    case "download_count":
      return toNumber(game?.download_count);
    case "metadata.average_playtime":
      return toNumber(game?.metadata?.average_playtime);
    case "sort_title":
      return installedTitle(game) || null;
    default:
      return installedTitle(game) || null;
  }
}

function recencyValue(game: any): number {
  const info = game?._installedInfo;
  return Math.max(
    Number(info?.installedAt) || 0,
    Number(info?.lastPlayedAt) || 0,
  );
}

/**
 * Client-side filter + sort of locally-installed games using the same Library
 * criteria as the server game list. Every filter and sort works from the cached
 * `GamevaultGame` object, so it behaves identically online and offline.
 *
 * Without a `sortBy` the list keeps the historic behaviour: most recently
 * installed/played first, with a title tie-break.
 */
export function filterAndSortInstalledGames(
  games: any[],
  filters: InstalledGamesFilters,
): any[] {
  let filtered = games;

  if (filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    filtered = filtered.filter((g) => installedSearchText(g).includes(q));
  }

  if (filters.gameTypes.length > 0) {
    filtered = filtered.filter(
      (g) => g.type && filters.gameTypes.includes(g.type),
    );
  }

  if (filters.tags.length > 0) {
    filtered = filtered.filter((g) =>
      matchesAnyName(g.metadata?.tags, filters.tags),
    );
  }
  if (filters.genres.length > 0) {
    filtered = filtered.filter((g) =>
      matchesAnyName(g.metadata?.genres, filters.genres),
    );
  }
  if (filters.developers.length > 0) {
    filtered = filtered.filter((g) =>
      matchesAnyName(g.metadata?.developers, filters.developers),
    );
  }
  if (filters.publishers.length > 0) {
    filtered = filtered.filter((g) =>
      matchesAnyName(g.metadata?.publishers, filters.publishers),
    );
  }

  const bookmarkFilter = filters.bookmarkFilter ?? "all";
  if (bookmarkFilter !== "all" && filters.userId != null) {
    const userId = String(filters.userId);
    filtered = filtered.filter((g) => {
      const ids = bookmarkedUserIds(g);
      return bookmarkFilter === "mine"
        ? ids.includes(userId)
        : ids.some((id) => id !== userId);
    });
  }

  const gameState = filters.gameState ?? "";
  if (gameState && filters.userId != null) {
    filtered = filtered.filter((g) => {
      const state = progressForUser(g, filters.userId)?.state as
        string | undefined;
      // The server treats "UNPLAYED" as "no progress record OR unplayed".
      if (gameState === ProgressStateEnum.unplayed) {
        return state === undefined || state === ProgressStateEnum.unplayed;
      }
      return state === gameState;
    });
  }

  const releaseDateFrom = filters.releaseDateFrom ?? "";
  const releaseDateTo = filters.releaseDateTo ?? "";
  if (releaseDateFrom || releaseDateTo) {
    filtered = filtered.filter((g) => {
      const day = dayKey(installedReleaseDate(g));
      if (day === null) return false;
      if (releaseDateFrom && day < releaseDateFrom) return false;
      if (releaseDateTo && day > releaseDateTo) return false;
      return true;
    });
  }

  const earlyAccess = filters.earlyAccess ?? "all";
  if (earlyAccess !== "all") {
    const wanted = earlyAccess === "true";
    filtered = filtered.filter((g) => installedEarlyAccess(g) === wanted);
  }

  const sortBy = filters.sortBy ?? "";
  const order = filters.order ?? "ASC";

  return [...filtered].sort((a, b) => {
    if (sortBy) {
      const ka = installedSortValue(a, sortBy);
      const kb = installedSortValue(b, sortBy);
      // Missing values always sink to the end, like the API's `nullSort: last`.
      if (ka === null && kb !== null) return 1;
      if (kb === null && ka !== null) return -1;
      if (ka !== null && kb !== null && ka !== kb) {
        const cmp =
          typeof ka === "number" && typeof kb === "number"
            ? ka - kb
            : String(ka).localeCompare(String(kb));
        return order === "DESC" ? -cmp : cmp;
      }
    } else {
      const diff = recencyValue(b) - recencyValue(a);
      if (diff !== 0) return diff;
    }
    return installedTitle(a).localeCompare(installedTitle(b));
  });
}

/**
 * Collect the distinct tag/genre/developer/publisher names present in the
 * locally installed games. Used as the offline source of truth for the filter
 * dialogs, which otherwise query the (unreachable) server endpoints.
 */
export function collectInstalledMetadataNames(
  games: any[],
  field: NamedMetadataField,
): NamedFilterOption[] {
  const names = new Map<string, string>();
  for (const game of games) {
    const list = game?.metadata?.[field];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const name = entryName(entry);
      if (!name) continue;
      const key = name.toLowerCase();
      if (!names.has(key)) names.set(key, name);
    }
  }
  return [...names.values()]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ id: name, name }));
}
