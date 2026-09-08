import {
  GamevaultGame,
  GamevaultGameTypeEnum,
} from "@/api/models/GamevaultGame";
import { ProgressStateEnum } from "@/api/models/Progress";
import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import { isTauriApp } from "@/utils/tauri";
import {
  buildCacheKey,
  buildGamesQueryParams,
  BookmarkFilter,
  EarlyAccessFilter,
} from "@/utils/gamesQuery";
export type { BookmarkFilter, EarlyAccessFilter } from "@/utils/gamesQuery";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface PaginatedData<T> {
  data: T[];
  meta: { totalItems: number };
  links: { next?: string | null };
}

export interface UseGamesOptions {
  search: string;
  sortBy: string; // e.g. sort_title, size
  order: "ASC" | "DESC";
  limit?: number;
  // Bookmark filter: "all", "mine" (my bookmarks), "others" (bookmarked by others)
  bookmarkFilter?: BookmarkFilter;
  // Game type filter (e.g. WINDOWS_SETUP, WINDOWS_PORTABLE, LINUX_PORTABLE)
  gameTypes?: GamevaultGameTypeEnum[];
  // Tag names to filter by
  tags?: string[];
  // Genre names to filter by
  genres?: string[];
  // Developer names to filter by
  developers?: string[];
  // Publisher names to filter by
  publishers?: string[];
  // Game state filter (requires user id)
  gameState?: ProgressStateEnum;
  // Release date range filter
  releaseDateFrom?: string;
  releaseDateTo?: string;
  // Early access filter
  earlyAccess?: EarlyAccessFilter;
}

interface CachedGamesState {
  count: number;
  games: GamevaultGame[];
  next: string | null;
  loadedPages: number;
}

// Module-level cache that survives component unmount/remount cycles.
// Keyed by a serialization of all filter/sort/search params + user ID.
// This prevents losing infinite-scroll pages when navigating away and back
// (e.g. Library → GameView → back).
const gamesCache = new Map<string, CachedGamesState>();

export function useGames({
  search,
  sortBy,
  order,
  limit = 50,
  bookmarkFilter = "all",
  gameTypes = [],
  tags = [],
  genres = [],
  developers = [],
  publishers = [],
  gameState,
  releaseDateFrom,
  releaseDateTo,
  earlyAccess = "all",
}: UseGamesOptions) {
  const { serverUrl, authFetch, user } = useAuth();
  const { isOnline } = useOnlineStatus();

  // Build a cache key from all filter/sort/search params so we can restore
  // game data after component remount (e.g. navigating back from detail page).
  const cacheKey = buildCacheKey(
    {
      search,
      sortBy,
      order,
      limit,
      bookmarkFilter,
      gameTypes,
      tags,
      genres,
      developers,
      publishers,
      gameState,
      releaseDateFrom,
      releaseDateTo,
      earlyAccess,
    },
    serverUrl || "",
    (user as any)?.id ?? (user as any)?.ID ?? null,
  );
  const cached = gamesCache.get(cacheKey);

  const [count, setCount] = useState(cached?.count ?? 0);
  const [games, setGames] = useState<GamevaultGame[]>(cached?.games ?? []);
  const [next, setNext] = useState<string | null>(cached?.next ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadedPagesRef = useRef(cached?.loadedPages ?? 0);
  const cacheKeyRef = useRef(cacheKey);
  cacheKeyRef.current = cacheKey;

  // Serialize arrays to stable strings to use as dependencies (prevent re-fetching when array reference changes but contents are same)
  const gameTypesKey = useMemo(
    () => JSON.stringify(gameTypes.slice().sort()),
    [gameTypes],
  );
  const tagsKey = useMemo(() => JSON.stringify(tags.slice().sort()), [tags]);
  const genresKey = useMemo(
    () => JSON.stringify(genres.slice().sort()),
    [genres],
  );
  const developersKey = useMemo(
    () => JSON.stringify(developers.slice().sort()),
    [developers],
  );
  const publishersKey = useMemo(
    () => JSON.stringify(publishers.slice().sort()),
    [publishers],
  );

  // Store current array values in refs so callback doesn't depend on array references
  const gameTypesRef = useRef(gameTypes);
  const tagsRef = useRef(tags);
  const genresRef = useRef(genres);
  const developersRef = useRef(developers);
  const publishersRef = useRef(publishers);

  // Update refs synchronously when arrays change (before any effects run)
  gameTypesRef.current = gameTypes;
  tagsRef.current = tags;
  genresRef.current = genres;
  developersRef.current = developers;
  publishersRef.current = publishers;

  const fetchGames = useCallback(async () => {
    if (!serverUrl) return;
    // Skip fetch when offline in Tauri mode — installed games handle themselves
    if (isTauriApp() && !isOnline) {
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const base = serverUrl.replace(/\/+$/, "");
      const userId = (user as any)?.id ?? (user as any)?.ID;
      const params = buildGamesQueryParams({
        search,
        sortBy,
        order,
        limit,
        bookmarkFilter,
        userId,
        gameTypes: gameTypesRef.current,
        tags: tagsRef.current,
        genres: genresRef.current,
        developers: developersRef.current,
        publishers: publishersRef.current,
        gameState,
        releaseDateFrom,
        releaseDateTo,
        earlyAccess,
      });
      const url = `${base}/api/games?${params.toString()}`;
      const res = await authFetch(url, { method: "GET", signal: ac.signal });
      if (!res.ok) throw new Error(`Games fetch failed (${res.status})`);
      const json: PaginatedData<GamevaultGame> = await res.json();
      setCount(json.meta.totalItems);
      setGames(json.data || []);
      setNext(json.links?.next || null);
      loadedPagesRef.current = 1;
      // Persist page 1 results to the module-level cache so that navigating
      // away and back (e.g. Library → GameView → back) restores instantly.
      gamesCache.set(cacheKeyRef.current, {
        count: json.meta.totalItems,
        games: json.data || [],
        next: json.links?.next || null,
        loadedPages: 1,
      });
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [
    serverUrl,
    authFetch,
    search,
    sortBy,
    order,
    limit,
    bookmarkFilter,
    user,
    gameTypesKey,
    tagsKey,
    genresKey,
    developersKey,
    publishersKey,
    gameState,
    releaseDateFrom,
    releaseDateTo,
    earlyAccess,
    isOnline,
  ]);

  const loadMore = useCallback(async () => {
    if (!serverUrl || !next || loading) return;
    try {
      setLoading(true);
      // If next is an absolute URL use it directly; otherwise treat as path or query starting at /api/games
      let url: string;
      if (/^https?:\/\//i.test(next)) {
        url = next;
      } else {
        const base = serverUrl.replace(/\/+$/, "");
        if (next.startsWith("/")) url = `${base}${next}`;
        else if (next.startsWith("api/")) url = `${base}/${next}`;
        else url = `${base}/api/games?${next}`;
      }
      const res = await authFetch(url, { method: "GET" });
      if (!res.ok) throw new Error(`Games fetch failed (${res.status})`);
      const json: PaginatedData<GamevaultGame> = await res.json();
      setGames((prev) => {
        const merged = [...prev, ...(json.data || [])];
        loadedPagesRef.current += 1;
        // Persist all loaded pages so infinite-scroll position is preserved
        // when navigating back to the library.
        gamesCache.set(cacheKeyRef.current, {
          count,
          games: merged,
          next: json.links?.next || null,
          loadedPages: loadedPagesRef.current,
        });
        return merged;
      });
      setNext(json.links?.next || null);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [serverUrl, authFetch, next, loading]);

  useEffect(() => {
    fetchGames();
    return () => abortRef.current?.abort();
  }, [fetchGames]);

  return {
    count,
    games,
    loading,
    error,
    refetch: fetchGames,
    loadMore,
    hasMore: !!next,
  };
}

export function getGameCoverMediaId(
  game: GamevaultGame,
): number | string | null {
  const id = game.metadata?.cover?.id;
  return id ?? null;
}
