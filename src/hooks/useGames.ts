import { GamevaultGame, GamevaultGameTypeEnum } from "@/api/models/GamevaultGame";
import { ProgressStateEnum } from "@/api/models/Progress";
import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface PaginatedData<T> {
  data: T[];
  meta: { totalItems: number };
  links: { next?: string | null };
}

export type EarlyAccessFilter = "all" | "true" | "false";
export type BookmarkFilter = "all" | "mine" | "others";

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
  const [count, setCount] = useState(0);
  const [games, setGames] = useState<GamevaultGame[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Serialize arrays to stable strings to use as dependencies (prevent re-fetching when array reference changes but contents are same)
  const gameTypesKey = useMemo(() => JSON.stringify(gameTypes.slice().sort()), [gameTypes]);
  const tagsKey = useMemo(() => JSON.stringify(tags.slice().sort()), [tags]);
  const genresKey = useMemo(() => JSON.stringify(genres.slice().sort()), [genres]);
  const developersKey = useMemo(() => JSON.stringify(developers.slice().sort()), [developers]);
  const publishersKey = useMemo(() => JSON.stringify(publishers.slice().sort()), [publishers]);

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
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const base = serverUrl.replace(/\/+$/, "");
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (sortBy) params.set("sortBy", `${sortBy}:${order}`);
      if (limit) params.set("limit", String(limit));
      // Bookmark filter
      const userId = (user as any)?.id ?? (user as any)?.ID;
      if (bookmarkFilter === "mine" && userId != null) {
        // My bookmarks: games bookmarked by me
        params.set("filter.bookmarked_users.id", `$eq:${userId}`);
      } else if (bookmarkFilter === "others" && userId != null) {
        // Bookmarked by others: games that have bookmarks but NOT by me
        // Use $not:$eq to exclude my bookmarks, combined with $not:$null to ensure it has some bookmarks
        params.set("filter.bookmarked_users.id", `$not:$eq:${userId}`);
      }
      // Game type filter (use ref for current value)
      const currentGameTypes = gameTypesRef.current;
      if (currentGameTypes.length > 0) {
        params.set("filter.type", `$in:${currentGameTypes.join(",")}`);
      }
      // Tag filter (use ref for current value)
      const currentTags = tagsRef.current;
      if (currentTags.length > 0) {
        params.set("filter.metadata.tags.name", `$in:${currentTags.join(",")}`);
      }
      // Genre filter (use ref for current value)
      const currentGenres = genresRef.current;
      if (currentGenres.length > 0) {
        params.set("filter.metadata.genres.name", `$in:${currentGenres.join(",")}`);
      }
      // Developer filter (use ref for current value)
      const currentDevelopers = developersRef.current;
      if (currentDevelopers.length > 0) {
        params.set("filter.metadata.developers.name", `$in:${currentDevelopers.join(",")}`);
      }
      // Publisher filter (use ref for current value)
      const currentPublishers = publishersRef.current;
      if (currentPublishers.length > 0) {
        params.set("filter.metadata.publishers.name", `$in:${currentPublishers.join(",")}`);
      }
      // Game state filter
      if (gameState && userId != null) {
        params.set("filter.progresses.state", `$eq:${gameState}`);
        params.set("filter.progresses.user.id", `$eq:${userId}`);
      }
      // Release date range filter
      if (releaseDateFrom && releaseDateTo) {
        params.set("filter.metadata.release_date", `$btw:${releaseDateFrom},${releaseDateTo}`);
      } else if (releaseDateFrom) {
        params.set("filter.metadata.release_date", `$gte:${releaseDateFrom}`);
      } else if (releaseDateTo) {
        params.set("filter.metadata.release_date", `$lte:${releaseDateTo}`);
      }
      // Early access filter
      if (earlyAccess === "true") {
        params.set("filter.metadata.early_access", "$eq:true");
      } else if (earlyAccess === "false") {
        params.set("filter.metadata.early_access", "$eq:false");
      }
      const url = `${base}/api/games?${params.toString()}`;
      const res = await authFetch(url, { method: "GET", signal: ac.signal });
      if (!res.ok) throw new Error(`Games fetch failed (${res.status})`);
      const json: PaginatedData<GamevaultGame> = await res.json();
      setCount(json.meta.totalItems);
      setGames(json.data || []);
      setNext(json.links?.next || null);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [serverUrl, authFetch, search, sortBy, order, limit, bookmarkFilter, user, gameTypesKey, tagsKey, genresKey, developersKey, publishersKey, gameState, releaseDateFrom, releaseDateTo, earlyAccess]);

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
      setGames((prev) => [...prev, ...(json.data || [])]);
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
