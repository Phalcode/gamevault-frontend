import { useCallback, useEffect, useRef, useState } from "react";
import { isTauriApp } from "@/utils/tauri";
import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import { getRootPaths } from "@/utils/rootPaths";
import { onGameUpdated } from "@/utils/gameUpdates";
import { getServerNamespace, resolveApiMediaBlob } from "@/utils/mediaCache";

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

export function useInstalledGames() {
  const [installedGames, setInstalledGames] = useState<InstalledGameInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { authFetch, serverUrl, user } = useAuth();
  const { isOnline } = useOnlineStatus();
  const currentUserId = (user as any)?.id ?? (user as any)?.ID ?? 0;
  const cacheInFlightRef = useRef<Set<number>>(new Set());

  const ensureGameCache = useCallback(
    async (gameId: number) => {
      if (!isTauriApp() || !isOnline) return;
      if (cacheInFlightRef.current.has(gameId)) return;
      cacheInFlightRef.current.add(gameId);

      try {
        const base = serverUrl.replace(/\/+$/, "");
        const { invoke } = await import("@tauri-apps/api/core");
        const serverNamespace = getServerNamespace(serverUrl);

        // Fetch full game object
        const gameRes = await authFetch(`${base}/api/games/${gameId}`);
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
              serverUrl,
              mediaId: coverId,
              authFetch,
              owner: { gameId, slot: "cover" },
            });
            const bytes = new Uint8Array(await blob.arrayBuffer());
            await invoke("cache_game_image", {
              serverNamespace,
              mediaId: Number(coverId),
              bytes: Array.from(bytes),
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
              serverUrl,
              mediaId: bgId,
              authFetch,
              owner: { gameId, slot: "background" },
            });
            const bytes = new Uint8Array(await blob.arrayBuffer());
            await invoke("cache_game_image", {
              serverNamespace,
              mediaId: Number(bgId),
              bytes: Array.from(bytes),
              contentType: blob.type || "image/png",
            });
          } catch {
            /* ignore */
          }
        }

        // Update local state to include the new cached metadata
        setInstalledGames((prev) =>
          prev.map((g) =>
            g.gameId === gameId ? { ...g, cachedMetadata: gameJson } : g,
          ),
        );
      } catch {
        // Best-effort: never block the user
      } finally {
        cacheInFlightRef.current.delete(gameId);
      }
    },
    [serverUrl, authFetch, isOnline],
  );

  // Fetch the current user's last-played timestamps and merge them into the
  // installed-games list (used for recency sorting in the library carousel).
  const loadLastPlayed = useCallback(async () => {
    if (!isOnline || !serverUrl || !currentUserId) return;
    try {
      const base = serverUrl.replace(/\/+$/, "");
      const res = await authFetch(
        `${base}/api/progresses?filter[user.id]=${currentUserId}&sort[last_played_at]=desc&limit=10000`,
      );
      if (!res.ok) return;
      const json = await res.json();
      const items: any[] = Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json)
          ? json
          : [];
      const lastPlayed = new Map<number, number>();
      for (const p of items) {
        const gid = Number(p?.game?.id ?? p?.game_id ?? 0);
        const ts = p?.last_played_at
          ? new Date(String(p.last_played_at)).getTime()
          : 0;
        if (gid > 0 && ts > 0) {
          lastPlayed.set(gid, Math.max(lastPlayed.get(gid) ?? 0, ts));
        }
      }
      setInstalledGames((prev) =>
        prev.map((g) => ({
          ...g,
          lastPlayedAt: lastPlayed.get(g.gameId) ?? 0,
        })),
      );
    } catch {
      // Best-effort; last-played enrichment is non-critical.
    }
  }, [serverUrl, authFetch, isOnline, currentUserId]);

  const fetchInstalledGames = useCallback(async () => {
    if (!isTauriApp()) return;

    const rootPaths = getRootPaths();
    if (!rootPaths.length) {
      setInstalledGames([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const allResults: InstalledGameInfo[] = [];
      const seen = new Set<string>(); // deduplicate by gameId+versionDirectory combo

      for (const root of rootPaths) {
        const rawResults = await invoke<any[]>("list_installed_games", {
          selectedRoot: root.path,
        }).catch(() => [] as any[]);

        for (const r of rawResults) {
          const info: InstalledGameInfo = {
            gameId: r.gameId ?? r.game_id ?? 0,
            gameTitle: r.gameTitle ?? r.game_title ?? "",
            gameMetadata: r.gameMetadata ?? r.game_metadata ?? null,
            cachedMetadata: r.cachedMetadata ?? r.cached_metadata ?? null,
            gameType: r.gameType ?? r.game_type ?? null,
            versionId: r.versionId ?? r.version_id ?? 0,
            versionName: r.versionName ?? r.version_name ?? "",
            installationDirectory:
              r.installationDirectory ?? r.installation_directory ?? "",
            versionDirectory: r.versionDirectory ?? r.version_directory ?? "",
            installedAt: Number(r.installedAt ?? r.installed_at ?? 0),
            lastPlayedAt: 0,
          };
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
      if (isTauriApp()) {
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
      }

      setInstalledGames(allResults);

      // While online, enrich installed games with the last-played timestamp
      // from the server so the installed carousel can sort by recency.
      void loadLastPlayed();

      // Refresh server metadata while online so changed media IDs replace stale cache bindings.
      if (isOnline) {
        for (const game of allResults) {
          if (game.gameId <= 0) continue;
          void ensureGameCache(game.gameId);
        }
      }
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setInstalledGames([]);
    } finally {
      setLoading(false);
    }
  }, [ensureGameCache, isOnline, loadLastPlayed]);

  useEffect(() => {
    fetchInstalledGames();
  }, [fetchInstalledGames]);

  useEffect(() => {
    if (isOnline && currentUserId) void loadLastPlayed();
  }, [isOnline, currentUserId, loadLastPlayed]);

  useEffect(
    () =>
      onGameUpdated((updatedGame) => {
        setInstalledGames((previous) =>
          previous.map((game) =>
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
        );
        if (isOnline) void ensureGameCache(updatedGame.id);
      }),
    [ensureGameCache, isOnline],
  );

  return { installedGames, loading, error, refetch: fetchInstalledGames };
}
