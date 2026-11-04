import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { isTauriApp } from "@/utils/tauri";
import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import { getRootPaths } from "@/utils/rootPaths";
import { onGameUpdated } from "@/utils/gameUpdates";
import { getServerNamespace, resolveApiMediaBlob } from "@/utils/mediaCache";
import { normalizeInstalledGame } from "@/utils/installedGames";

export interface InstalledGameInfo {
  gameId: number;
  gameTitle: string;
  gameMetadata: Record<string, any> | null;
  cachedMetadata: Record<string, any> | null;
  gameType: string | null;
  versionId: number;
  versionName: string;
  installationDirectory: string;
  versionDirectory: string;
  /** Unix timestamp (ms) when this version was installed; 0 if unknown. */
  installedAt: number;
  /** Unix timestamp (ms) of the last time the game was played; 0 if unknown. */
  lastPlayedAt: number;
}

/** What a scan needs from the React side, captured when it is requested. */
interface ScanConfig {
  isOnline: boolean;
  serverUrl: string;
  currentUserId: unknown;
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
}

interface InstalledGamesState {
  installedGames: InstalledGameInfo[];
  loading: boolean;
  error: string | null;
}

// ── Shared store ─────────────────────────────────────────────────────────────
//
// The library page, the game page and the tray menu all need the installed-game
// list. Each of them used to own a copy, so every mount walked the library root
// again and re-fetched the user's played games. On a network or 9p mount that
// walk costs seconds, which is what made the Library slow to appear after
// coming back from a game. One scan now serves every consumer, and a recent
// scan is reused instead of repeated.

const EMPTY_STATE: InstalledGamesState = {
  installedGames: [],
  loading: false,
  error: null,
};

/** How long a completed scan is reused before a mount triggers a new one. */
const STALE_AFTER_MS = 60_000;
/** How long the server's last-played timestamps are reused. */
const LAST_PLAYED_TTL_MS = 120_000;

let state: InstalledGamesState = EMPTY_STATE;
let loadPromise: Promise<void> | null = null;
let loadedAt = 0;
let stale = true;
let activeConfig: ScanConfig | null = null;
const listeners = new Set<() => void>();

function publish(patch: Partial<InstalledGamesState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): InstalledGamesState {
  return state;
}

/**
 * Marks the cached list as outdated and reloads it. Call this after installing
 * or uninstalling a game.
 */
export function invalidateInstalledGames(): void {
  stale = true;
  if (activeConfig) void loadInstalledGames(activeConfig, { force: true });
}

// Games whose metadata + images have already been cached during this app
// session. Without this, every `isOnline` transition re-ran the whole cache for
// every installed game — a burst of multi-megabyte IPC transfers that kept the
// renderer and the Tauri event loop busy.
const cachedGameIds = new Set<number>();
const cacheInFlight = new Set<number>();

async function ensureGameCache(
  gameId: number,
  config: ScanConfig,
  force = false,
): Promise<void> {
  if (!isTauriApp() || !config.isOnline) return;
  if (cacheInFlight.has(gameId)) return;
  if (!force && cachedGameIds.has(gameId)) return;
  cacheInFlight.add(gameId);

  try {
    const base = config.serverUrl.replace(/\/+$/, "");
    const { invoke } = await import("@tauri-apps/api/core");
    const { blobToBase64 } = await import("@/utils/binary");
    const serverNamespace = getServerNamespace(config.serverUrl);

    // Fetch full game object
    const gameRes = await config.authFetch(`${base}/api/games/${gameId}`);
    if (!gameRes.ok) return;
    const gameJson = await gameRes.json();

    // Cache game data
    await invoke("cache_game_data", {
      gameId,
      json: JSON.stringify(gameJson),
    });

    // Cache cover image
    const coverId = gameJson?.metadata?.cover?.id;
    if (coverId) {
      try {
        const blob = await resolveApiMediaBlob({
          serverUrl: config.serverUrl,
          mediaId: coverId,
          authFetch: config.authFetch,
          owner: { gameId, slot: "cover" },
        });
        const bytes = await blobToBase64(blob);
        await invoke("cache_game_image", {
          serverNamespace,
          mediaId: Number(coverId),
          dataBase64: bytes,
          contentType: blob.type || "image/png",
        });
      } catch {
        /* ignore */
      }
    }

    // Cache background image
    const bgId = gameJson?.metadata?.background?.id;
    if (bgId) {
      try {
        const blob = await resolveApiMediaBlob({
          serverUrl: config.serverUrl,
          mediaId: bgId,
          authFetch: config.authFetch,
          owner: { gameId, slot: "background" },
        });
        const bytes = await blobToBase64(blob);
        await invoke("cache_game_image", {
          serverNamespace,
          mediaId: Number(bgId),
          dataBase64: bytes,
          contentType: blob.type || "image/png",
        });
      } catch {
        /* ignore */
      }
    }

    // Update the shared list with the freshly cached metadata
    cachedGameIds.add(gameId);
    publish({
      installedGames: state.installedGames.map((game) =>
        game.gameId === gameId ? { ...game, cachedMetadata: gameJson } : game,
      ),
    });
  } catch {
    // Best-effort: never block the user
  } finally {
    cacheInFlight.delete(gameId);
  }
}

/** Current user's last-played timestamps, reused across mounts. */
let lastPlayed = new Map<number, number>();
let lastPlayedAt = 0;

function applyLastPlayed(games: InstalledGameInfo[]): InstalledGameInfo[] {
  if (lastPlayed.size === 0) return games;
  return games.map((game) => ({
    ...game,
    lastPlayedAt: lastPlayed.get(game.gameId) ?? 0,
  }));
}

/**
 * Refreshes the current user's last-played timestamps from the server.
 *
 * Only used for recency ordering, so it never delays the list and is reused for
 * a couple of minutes: this is up to 10k progress records, and every library
 * visit used to request them again.
 */
async function refreshLastPlayed(
  config: ScanConfig,
  force = false,
): Promise<void> {
  if (!config.isOnline || !config.serverUrl || !config.currentUserId) return;
  if (!force && Date.now() - lastPlayedAt < LAST_PLAYED_TTL_MS) return;

  try {
    const base = config.serverUrl.replace(/\/+$/, "");
    const res = await config.authFetch(
      `${base}/api/progresses?filter[user.id]=${config.currentUserId}&sort[last_played_at]=desc&limit=10000`,
    );
    if (!res.ok) return;
    const json = await res.json();
    const items: any[] = Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json)
        ? json
        : [];
    const next = new Map<number, number>();
    for (const p of items) {
      const gid = Number(p?.game?.id ?? p?.game_id ?? 0);
      const ts = p?.last_played_at
        ? new Date(String(p.last_played_at)).getTime()
        : 0;
      if (gid > 0 && ts > 0) {
        next.set(gid, Math.max(next.get(gid) ?? 0, ts));
      }
    }
    lastPlayed = next;
    lastPlayedAt = Date.now();
    publish({ installedGames: applyLastPlayed(state.installedGames) });
  } catch {
    // Best-effort; last-played enrichment is non-critical.
  }
}

async function scanInstalledGames(config: ScanConfig): Promise<void> {
  const rootPaths = isTauriApp() ? getRootPaths() : [];
  if (!rootPaths.length) {
    loadedAt = Date.now();
    stale = false;
    publish({ installedGames: [], loading: false, error: null });
    return;
  }

  publish({ loading: true, error: null });
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const allResults: InstalledGameInfo[] = [];
    const seen = new Set<string>(); // deduplicate by gameId+versionDirectory combo

    for (const root of rootPaths) {
      const rawResults = await invoke<any[]>("list_installed_games", {
        selectedRoot: root.path,
      }).catch(() => [] as any[]);

      for (const r of rawResults) {
        const info = normalizeInstalledGame(r);
        const key = `${info.gameId}:${info.versionDirectory}`;
        if (info.gameId > 0 && !seen.has(key)) {
          seen.add(key);
          allResults.push(info);
        }
      }
    }

    // Load cached metadata from offline-cache for games missing it.
    // list_installed_games reads from {root}/.cache/games/ but
    // cache_game_data writes to {app_data}/offline-cache/games/ —
    // two different paths. load_cached_game bridges the gap.
    for (const game of allResults) {
      if (game.gameId <= 0) continue;
      if (game.cachedMetadata) continue;
      try {
        const cached = await invoke<string | null>("load_cached_game", {
          gameId: game.gameId,
        });
        if (cached) {
          game.cachedMetadata = JSON.parse(cached);
        }
      } catch {
        /* ignore */
      }
    }

    loadedAt = Date.now();
    stale = false;
    publish({
      installedGames: applyLastPlayed(allResults),
      loading: false,
      error: null,
    });

    // Enrichment below is best-effort and must never delay the list.
    if (config.isOnline) {
      void refreshLastPlayed(config);

      // Refresh server metadata while online so changed media IDs replace stale
      // cache bindings. Run these strictly one at a time: each call transfers a
      // cover and a background over IPC, and firing them for every installed
      // game at once is what produced the multi-megabyte IPC burst (and the
      // ~140MB JS heap spike) that stalled the webview in the field log.
      void allResults
        .filter((game) => game.gameId > 0)
        .reduce(
          (chain, game) =>
            chain.then(() => ensureGameCache(game.gameId, config)),
          Promise.resolve() as Promise<void>,
        )
        .catch(() => undefined);
    }
  } catch (err: any) {
    loadedAt = Date.now();
    stale = false;
    publish({
      error: err?.message ?? String(err),
      installedGames: [],
      loading: false,
    });
  }
}

/**
 * Loads the installed games, sharing one scan between concurrent callers.
 *
 * @param maxAgeMs reuse a scan younger than this
 * @param force    ignore a recent scan and rescan now
 */
function loadInstalledGames(
  config: ScanConfig,
  options: { maxAgeMs?: number; force?: boolean } = {},
): Promise<void> {
  activeConfig = config;
  const { maxAgeMs = 0, force = false } = options;

  if (!force && !stale && Date.now() - loadedAt < maxAgeMs) {
    return Promise.resolve();
  }
  if (loadPromise) return loadPromise;

  loadPromise = scanInstalledGames(config).finally(() => {
    loadPromise = null;
  });
  return loadPromise;
}

// One listener for the whole app: a game update patches the shared list.
let gameUpdatedBound = false;
function bindGameUpdated(): void {
  if (gameUpdatedBound) return;
  gameUpdatedBound = true;
  onGameUpdated((updatedGame) => {
    publish({
      installedGames: state.installedGames.map((game) =>
        game.gameId === updatedGame.id
          ? {
              ...game,
              gameTitle:
                updatedGame.metadata?.title ||
                updatedGame.title ||
                game.gameTitle,
              cachedMetadata: updatedGame,
            }
          : game,
      ),
    });
    if (activeConfig?.isOnline) {
      void ensureGameCache(updatedGame.id, activeConfig, true);
    }
  });
}

export function useInstalledGames() {
  const { authFetch, serverUrl, user } = useAuth();
  const { isOnline } = useOnlineStatus();
  const currentUserId = (user as any)?.id ?? (user as any)?.ID ?? 0;

  const config = useMemo<ScanConfig>(
    () => ({ isOnline, serverUrl, currentUserId, authFetch }),
    [isOnline, serverUrl, currentUserId, authFetch],
  );

  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    bindGameUpdated();
  }, []);

  // A recent scan is reused, so switching between the library and a game does
  // not walk the library root again.
  useEffect(() => {
    void loadInstalledGames(config, { maxAgeMs: STALE_AFTER_MS });
  }, [config]);

  const refetch = useCallback(
    () => loadInstalledGames(config, { force: true }),
    [config],
  );

  return {
    installedGames: snapshot.installedGames,
    loading: snapshot.loading,
    error: snapshot.error,
    refetch,
  };
}
