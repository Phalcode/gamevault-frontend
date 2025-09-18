import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useRef, useState } from "react";

export interface GameMediaRef {
  id: number | string;
}
export interface GameMetadata {
  cover?: GameMediaRef | { ID?: number | string };
  title?: string;
}
export interface Game {
  id: number;
  title: string;
  sort_title?: string;
  metadata?: GameMetadata | null;
  // Optional file system path provided by backend (used for deriving download filename)
  path?: string;
  Path?: string; // legacy / PascalCase variant just in case
  // Size of the game in bytes (optional, provided by backend if available)
  size?: number;
  Size?: number; // legacy / alternate casing safeguard
}

interface PaginatedData<T> {
  data: T[];
  meta: any;
  links: { next?: string | null };
}

export interface UseGamesOptions {
  search: string;
  sortBy: string; // e.g. sort_title, size
  order: "ASC" | "DESC";
  limit?: number;
}

export function useGames({
  search,
  sortBy,
  order,
  limit = 50,
}: UseGamesOptions) {
  const { serverUrl, authFetch } = useAuth();
  const [games, setGames] = useState<Game[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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
      const url = `${base}/api/games?${params.toString()}`;
      const res = await authFetch(url, { method: "GET", signal: ac.signal });
      if (!res.ok) throw new Error(`Games fetch failed (${res.status})`);
      const json: PaginatedData<Game> = await res.json();
      setGames(json.data || []);
      setNext(json.links?.next || null);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [serverUrl, authFetch, search, sortBy, order, limit]);

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
      const json: PaginatedData<Game> = await res.json();
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
    games,
    loading,
    error,
    refetch: fetchGames,
    loadMore,
    hasMore: !!next,
  };
}

export function getGameCoverMediaId(game: Game): number | string | null {
  const id =
    (game.metadata as any)?.cover?.id ?? (game.metadata as any)?.cover?.ID;
  return id ?? null;
}
