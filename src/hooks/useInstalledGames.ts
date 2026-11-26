import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { isTauriApp } from "@/utils/tauri";
import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import { useServerStatus } from "@/hooks/useServerStatus";
import { getRootPaths } from "@/utils/rootPaths";
import { onGameUpdated } from "@/utils/gameUpdates";
import { getServerNamespace, resolveApiMediaBlob } from "@/utils/mediaCache";
import {
  normalizeServerIdentityUrl,
  serverIdentifiers,
  serverUrlForIdentifier,
} from "@/utils/serverIdentity";
import {
  normalizeInstalledGame,
  installedGameDisplayOwner,
  installedGameOwnerForServer,
  type InstalledGameOwner,
} from "@/utils/installedGames";

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
  /** Servers that own this installation, with each server's game id. */
  owners: InstalledGameOwner[];
  /** Unix timestamp (ms) when this version was installed; 0 if unknown. */
  installedAt: number;
  /** Unix timestamp (ms) of the last time the game was played; 0 if unknown. */
  lastPlayedAt: number;
}

/** What a scan needs from the React side, captured when it is requested. */
interface ScanConfig {
  isOnline: boolean;
  serverUrl: string;
  serverIdentifiers: string[];
  serverNamespace: string;
  /** Normalized server URL; changing it switches the visible library. */
  serverKey: string;
  /** Server identity including UUID; changing it forces a rescan. */
  identityKey: string;
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
let activeServerKey: string | null = null;
let activeIdentityKey: string | null = null;
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
// session, keyed per server so switching servers cannot reuse the wrong cache.
// Without this, every `isOnline` transition re-ran the whole cache for
// every installed game — a burst of multi-megabyte IPC transfers that kept the
// renderer and the Tauri event loop busy.
const cachedGameIds = new Set<string>();
const cacheInFlight = new Set<string>();

async function ensureGameCache(
  gameId: number,
  config: ScanConfig,
  force = false,
): Promise<void> {
  if (!isTauriApp() || !config.isOnline) return;
  if (activeConfig?.identityKey !== config.identityKey) return;

  const cacheKey = `${config.serverNamespace}:${gameId}`;
  if (cacheInFlight.has(cacheKey)) return;
  if (!force && cachedGameIds.has(cacheKey)) return;
  cacheInFlight.add(cacheKey);

  try {
    const base = config.serverUrl.replace(/\/+$/, "");
    const { invoke } = await import("@tauri-apps/api/core");
    const { blobToBase64 } = await import("@/utils/binary");
    const serverNamespace = config.serverNamespace;

    // Fetch full game object
    const gameRes = await config.authFetch(`${base}/api/games/${gameId}`);
    if (!gameRes.ok) return;
    const gameJson = await gameRes.json();

    // Cache game data
    await invoke("cache_game_data", {
      serverNamespace,
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
    cachedGameIds.add(cacheKey);
    if (activeConfig?.identityKey === config.identityKey) {
      publish({
        installedGames: state.installedGames.map((game) => {
          const owner = installedGameOwnerForServer(
            game,
            config.serverIdentifiers,
          );
          return owner?.gameId === gameId
            ? { ...game, cachedMetadata: gameJson }
            : game;
        }),
      });
    }
  } catch {
    // Best-effort: never block the user
  } finally {
    cacheInFlight.delete(cacheKey);
  }
}

/** Current user's last-played timestamps, reused across mounts. */
let lastPlayed = new Map<number, number>();
let lastPlayedAt = 0;
let lastPlayedServerNamespace: string | null = null;

function applyLastPlayed(
  games: InstalledGameInfo[],
  config: ScanConfig,
): InstalledGameInfo[] {
  if (
    lastPlayedServerNamespace !== config.serverNamespace ||
    lastPlayed.size === 0
  ) {
    return games;
  }
  return games.map((game) => {
    const owner = installedGameOwnerForServer(game, config.serverIdentifiers);
    return {
      ...game,
      lastPlayedAt: owner ? (lastPlayed.get(owner.gameId) ?? 0) : 0,
    };
  });
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
  if (
    !force &&
    lastPlayedServerNamespace === config.serverNamespace &&
    Date.now() - lastPlayedAt < LAST_PLAYED_TTL_MS
  ) {
    return;
  }

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

    if (activeConfig?.identityKey !== config.identityKey) return;
    lastPlayed = next;
    lastPlayedAt = Date.now();
    lastPlayedServerNamespace = config.serverNamespace;
    publish({
      installedGames: applyLastPlayed(state.installedGames, config),
    });
  } catch {
    // Best-effort; last-played enrichment is non-critical.
  }
}

function isActiveScan(config: ScanConfig): boolean {
  return (
    activeConfig?.identityKey === config.identityKey &&
    activeServerKey === config.serverKey
  );
}

/** Cache namespace and game id used to load an install's cached metadata. */
function cacheTargetForOwner(
  owner: InstalledGameOwner | undefined,
  config: ScanConfig,
): { serverNamespace: string; gameId: number } | null {
  if (!owner || owner.gameId <= 0) return null;

  const ownerUrl =
    owner.serverUrl ??
    owner.identifiers.map(serverUrlForIdentifier).find(Boolean) ??
    null;
  if (ownerUrl) {
    try {
      return {
        serverNamespace: getServerNamespace(ownerUrl),
        gameId: owner.gameId,
      };
    } catch {
      return null;
    }
  }

  if (
    installedGameOwnerForServer(
      { owners: [owner] },
      config.serverIdentifiers,
    ) &&
    config.serverNamespace
  ) {
    return { serverNamespace: config.serverNamespace, gameId: owner.gameId };
  }

  return null;
}

/** Cache namespace of the current server, for online metadata refreshes. */
function currentOwnerCacheTarget(
  game: InstalledGameInfo,
  config: ScanConfig,
): { serverNamespace: string; gameId: number } | null {
  const owner = installedGameOwnerForServer(game, config.serverIdentifiers);
  if (!owner || owner.gameId <= 0 || !config.serverNamespace) return null;
  return { serverNamespace: config.serverNamespace, gameId: owner.gameId };
}

async function scanInstalledGames(config: ScanConfig): Promise<void> {
  if (!config.serverUrl) {
    loadedAt = Date.now();
    stale = false;
    publish({ installedGames: [], loading: false, error: null });
    return;
  }

  const rootPaths = isTauriApp() ? getRootPaths() : [];
  if (!rootPaths.length) {
    loadedAt = Date.now();
    stale = false;
    if (isActiveScan(config)) {
      publish({ installedGames: [], loading: false, error: null });
    }
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

    // Load cached metadata from the cache of the server that owns each
    // installation, not from whichever server happens to be active.
    for (const game of allResults) {
      if (game.cachedMetadata) continue;
      const displayOwner = installedGameDisplayOwner(
        game,
        config.serverIdentifiers,
      );
      const target = cacheTargetForOwner(displayOwner, config);
      if (!target) continue;
      try {
        const cached = await invoke<string | null>("load_cached_game", {
          serverNamespace: target.serverNamespace,
          gameId: target.gameId,
        });
        if (cached) {
          game.cachedMetadata = JSON.parse(cached);
        }
      } catch {
        /* ignore */
      }
    }

    if (!isActiveScan(config)) return;

    loadedAt = Date.now();
    stale = false;
    publish({
      installedGames: applyLastPlayed(allResults, config),
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
        .reduce(
          (chain, game) =>
            chain.then(() => {
              if (!isActiveScan(config)) return;
              const target = currentOwnerCacheTarget(game, config);
              if (!target) return;
              return ensureGameCache(target.gameId, config);
            }),
          Promise.resolve() as Promise<void>,
        )
        .catch(() => undefined);
    }
  } catch (err: any) {
    if (!isActiveScan(config)) return;
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
  const { maxAgeMs = 0, force = false } = options;

  if (!config.serverUrl) {
    activeConfig = config;
    activeServerKey = config.serverKey;
    activeIdentityKey = config.identityKey;
    lastPlayed = new Map();
    lastPlayedAt = 0;
    lastPlayedServerNamespace = null;
    loadedAt = Date.now();
    stale = false;
    publish(EMPTY_STATE);
    return Promise.resolve();
  }

  const serverChanged =
    activeServerKey !== null && activeServerKey !== config.serverKey;
  const identityChanged =
    activeIdentityKey !== null && activeIdentityKey !== config.identityKey;
  const sameIdentity =
    activeServerKey === config.serverKey &&
    activeIdentityKey === config.identityKey;

  if (serverChanged) {
    lastPlayed = new Map();
    lastPlayedAt = 0;
    lastPlayedServerNamespace = null;
    stale = true;
  } else if (identityChanged) {
    stale = true;
  }

  // Always point future invalidations at the newest server before waiting for
  // an in-flight scan of the previous server.
  activeConfig = config;

  if (sameIdentity && !force && !stale && Date.now() - loadedAt < maxAgeMs) {
    return Promise.resolve();
  }

  if (loadPromise) {
    if (sameIdentity) return loadPromise;
    return loadPromise.then(() =>
      loadInstalledGames(config, { ...options, force: true }),
    );
  }

  activeServerKey = config.serverKey;
  activeIdentityKey = config.identityKey;
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
    const currentIdentifiers = activeConfig?.serverIdentifiers ?? [];
    publish({
      installedGames: state.installedGames.map((game) => {
        const owner = installedGameOwnerForServer(game, currentIdentifiers);
        return owner?.gameId === updatedGame.id
          ? {
              ...game,
              gameTitle:
                updatedGame.metadata?.title ||
                updatedGame.title ||
                game.gameTitle,
              cachedMetadata: updatedGame,
            }
          : game;
      }),
    });
    if (activeConfig?.isOnline) {
      void ensureGameCache(updatedGame.id, activeConfig, true);
    }
  });
}

export function useInstalledGames() {
  const { authFetch, serverUrl, user } = useAuth();
  const { isOnline } = useOnlineStatus();
  const { info: serverInfo } = useServerStatus();
  const currentUserId = (user as any)?.id ?? (user as any)?.ID ?? 0;

  const normalizedUrl = normalizeServerIdentityUrl(serverUrl);
  const serverNamespace = useMemo(() => {
    if (!normalizedUrl) return "";
    try {
      return getServerNamespace(normalizedUrl);
    } catch {
      return "";
    }
  }, [normalizedUrl]);
  const identities = useMemo(
    () => serverIdentifiers(serverUrl, serverInfo?.server_uuid),
    [serverUrl, serverInfo?.server_uuid],
  );
  const identityKey = identities.join("\n");

  const config = useMemo<ScanConfig>(
    () => ({
      isOnline,
      serverUrl: normalizedUrl,
      serverIdentifiers: identities,
      serverNamespace,
      serverKey: normalizedUrl,
      identityKey,
      currentUserId,
      authFetch,
    }),
    [
      isOnline,
      normalizedUrl,
      serverInfo?.server_uuid,
      identities,
      serverNamespace,
      identityKey,
      currentUserId,
      authFetch,
    ],
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
    serverIdentifiers: identities,
    serverNamespace,
    refetch,
  };
}
