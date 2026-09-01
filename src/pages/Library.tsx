import GameCard from "@/components/GameCard";
import { useAuth } from "@/context/AuthContext";
import { BookmarkFilter, EarlyAccessFilter, useGames } from "@/hooks/useGames";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Divider } from "@tw/divider";
import { Heading } from "@tw/heading";
import { Input } from "@tw/input";
import { Listbox, ListboxLabel, ListboxOption } from "@tw/listbox";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { XMarkIcon } from "@heroicons/react/24/solid";
import {
  TrashIcon,
  FunnelIcon,
  ArrowUpIcon,
  ArrowDownIcon,
} from "@heroicons/react/24/outline";
import { Button } from "@/components/tailwind/button";
import { Badge } from "../components/tailwind/badge";
import { GamevaultGameTypeEnum } from "@/api/models/GamevaultGame";
import type { GamevaultGame } from "@/api/models/GamevaultGame";
import { ProgressStateEnum } from "@/api/models/Progress";
import MultiSelectFilterDialog, {
  FilterItem,
} from "@/components/MultiSelectFilterDialog";
import { Strong, Text, TextLink } from "@/components/tailwind/text";
import { isTauriApp } from "@/utils/tauri";
import {
  useInstalledGames,
  type InstalledGameInfo,
} from "@/hooks/useInstalledGames";
import { useOnlineStatus } from "@/context/OfflineContext";
import { SectionExpander } from "@/components/SectionExpander";
import { RowCountControl } from "@/components/RowCountControl";
import { motion } from "motion/react";
import { DURATION_SLOW, EASE_OUT } from "@/lib/motion";

const SORT_BY: { label: string; value: string }[] = [
  { label: "Title", value: "sort_title" },
  { label: "Size", value: "size" },
  { label: "Date Added", value: "created_at" },
  { label: "Release Date", value: "metadata.release_date" },
  { label: "Rating", value: "metadata.rating" },
  { label: "Download Count", value: "download_count" },
  { label: "Average Playtime", value: "metadata.average_playtime" },
];

const GAME_TYPES: { label: string; value: GamevaultGameTypeEnum }[] = [
  { label: "Windows Setup", value: GamevaultGameTypeEnum.windows_setup },
  { label: "Windows Portable", value: GamevaultGameTypeEnum.windows_portable },
  { label: "Linux Portable", value: GamevaultGameTypeEnum.linux_portable },
];

// Static items for game type filter (used in MultiSelectFilterDialog)
const GAME_TYPE_FILTER_ITEMS: FilterItem[] = GAME_TYPES.map((t) => ({
  id: t.value,
  name: t.label,
}));

const GAME_STATES: { label: string; value: ProgressStateEnum }[] = [
  { label: "Unplayed", value: ProgressStateEnum.unplayed },
  { label: "Infinite", value: ProgressStateEnum.infinite },
  { label: "Playing", value: ProgressStateEnum.playing },
  { label: "Completed", value: ProgressStateEnum.completed },
  { label: "Aborted (Temporary)", value: ProgressStateEnum.aborted_temporary },
  { label: "Aborted (Permanent)", value: ProgressStateEnum.aborted_permanent },
];

const EARLY_ACCESS_OPTIONS: { label: string; value: EarlyAccessFilter }[] = [
  { label: "All", value: "all" },
  { label: "Early Access Only", value: "true" },
  { label: "No Early Access", value: "false" },
];

const BOOKMARK_OPTIONS: { label: string; value: BookmarkFilter }[] = [
  { label: "All", value: "all" },
  { label: "Bookmarked by Me", value: "mine" },
  { label: "Bookmarked by Others", value: "others" },
];

const LIB_SORT_KEY = "app_library_sort";
const LIB_ORDER_KEY = "app_library_order";

export default function Library() {
  const { serverUrl, user } = useAuth();
  const { isOnline } = useOnlineStatus();
  const isTauri = isTauriApp();

  const CONTROL_HEIGHT_CLASS = "min-h-11 sm:min-h-9";
  const INPUT_CONTROL_HEIGHT_CLASS = "[&_input]:min-h-11 sm:[&_input]:min-h-9";

  const urlInitializedRef = useRef(false);
  const [search, setSearch] = useState("");
  // Sort/order preferences are always retained (they're the default behaviour).
  const [sortBy, setSortBy] = useState(() => {
    try {
      if (typeof window !== "undefined") {
        const saved = localStorage.getItem(LIB_SORT_KEY);
        if (saved && SORT_BY.some((o) => o.value === saved)) return saved;
      }
    } catch {}
    return "sort_title";
  });
  const [order, setOrder] = useState<"ASC" | "DESC">(() => {
    try {
      if (typeof window !== "undefined") {
        const saved = localStorage.getItem(LIB_ORDER_KEY) as
          "ASC" | "DESC" | null;
        if (saved === "ASC" || saved === "DESC") return saved;
      }
    } catch {}
    return "ASC";
  });
  const [showFilters, setShowFilters] = useState(false);
  const [bookmarkFilter, setBookmarkFilter] = useState<BookmarkFilter>("all");

  // New filter states
  const [selectedGameTypes, setSelectedGameTypes] = useState<FilterItem[]>([]);
  const [selectedTags, setSelectedTags] = useState<FilterItem[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<FilterItem[]>([]);
  const [selectedDevelopers, setSelectedDevelopers] = useState<FilterItem[]>(
    [],
  );
  const [selectedPublishers, setSelectedPublishers] = useState<FilterItem[]>(
    [],
  );
  const [selectedGameState, setSelectedGameState] = useState<
    ProgressStateEnum | ""
  >("");
  const [releaseDateFrom, setReleaseDateFrom] = useState("");
  const [releaseDateTo, setReleaseDateTo] = useState("");
  const [earlyAccess, setEarlyAccess] = useState<EarlyAccessFilter>("all");

  // Dialog states
  const [gameTypesDialogOpen, setGameTypesDialogOpen] = useState(false);
  const [tagsDialogOpen, setTagsDialogOpen] = useState(false);
  const [genresDialogOpen, setGenresDialogOpen] = useState(false);
  const [developersDialogOpen, setDevelopersDialogOpen] = useState(false);
  const [publishersDialogOpen, setPublishersDialogOpen] = useState(false);

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return (
      bookmarkFilter !== "all" ||
      selectedGameTypes.length > 0 ||
      selectedTags.length > 0 ||
      selectedGenres.length > 0 ||
      selectedDevelopers.length > 0 ||
      selectedPublishers.length > 0 ||
      selectedGameState !== "" ||
      releaseDateFrom !== "" ||
      releaseDateTo !== "" ||
      earlyAccess !== "all"
    );
  }, [
    bookmarkFilter,
    selectedGameTypes,
    selectedTags,
    selectedGenres,
    selectedDevelopers,
    selectedPublishers,
    selectedGameState,
    releaseDateFrom,
    releaseDateTo,
    earlyAccess,
  ]);

  // Number of active filter selections (for the badge on the Filters toggle)
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (bookmarkFilter !== "all") count++;
    if (earlyAccess !== "all") count++;
    if (selectedGameState !== "") count++;
    if (releaseDateFrom !== "") count++;
    if (releaseDateTo !== "") count++;
    count +=
      selectedGameTypes.length +
      selectedTags.length +
      selectedGenres.length +
      selectedDevelopers.length +
      selectedPublishers.length;
    return count;
  }, [
    bookmarkFilter,
    selectedGameTypes,
    selectedTags,
    selectedGenres,
    selectedDevelopers,
    selectedPublishers,
    selectedGameState,
    releaseDateFrom,
    releaseDateTo,
    earlyAccess,
  ]);

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setBookmarkFilter("all");
    setSelectedGameTypes([]);
    setSelectedTags([]);
    setSelectedGenres([]);
    setSelectedDevelopers([]);
    setSelectedPublishers([]);
    setSelectedGameState("");
    setReleaseDateFrom("");
    setReleaseDateTo("");
    setEarlyAccess("all");
  }, []);

  // Debounce search so we only fire the API request once the user pauses
  const deferredSearch = useDebouncedValue(search, 300);

  // Convert selected type FilterItems to GamevaultGameTypeEnum values for API
  const gameTypeValues = useMemo(() => {
    return selectedGameTypes
      .map((item) => String(item.id))
      .filter((v): v is GamevaultGameTypeEnum =>
        Object.values(GamevaultGameTypeEnum).includes(
          v as GamevaultGameTypeEnum,
        ),
      );
  }, [selectedGameTypes]);

  // Memoize array values to prevent unnecessary re-renders
  const tagNames = useMemo(
    () => selectedTags.map((t) => t.name),
    [selectedTags],
  );
  const genreNames = useMemo(
    () => selectedGenres.map((g) => g.name),
    [selectedGenres],
  );
  const developerNames = useMemo(
    () => selectedDevelopers.map((d) => d.name),
    [selectedDevelopers],
  );
  const publisherNames = useMemo(
    () => selectedPublishers.map((p) => p.name),
    [selectedPublishers],
  );

  const { count, games, loading, error, loadMore, hasMore } = useGames({
    search: deferredSearch,
    sortBy,
    order,
    limit: 50,
    bookmarkFilter,
    gameTypes: gameTypeValues,
    tags: tagNames,
    genres: genreNames,
    developers: developerNames,
    publishers: publisherNames,
    gameState: selectedGameState || undefined,
    releaseDateFrom: releaseDateFrom || undefined,
    releaseDateTo: releaseDateTo || undefined,
    earlyAccess,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(LIB_SORT_KEY, sortBy);
      localStorage.setItem(LIB_ORDER_KEY, order);
    } catch {}
  }, [sortBy, order]);

  const getParamValues = useCallback((params: URLSearchParams, key: string) => {
    const repeated = params.getAll(key).filter(Boolean);
    if (repeated.length > 0) return repeated;
    const single = params.get(key);
    if (!single) return [];
    return single
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }, []);

  const setParamValues = useCallback(
    (params: URLSearchParams, key: string, values: string[]) => {
      params.delete(key);
      values.forEach((v) => params.append(key, v));
    },
    [],
  );

  const isProgressState = useCallback(
    (value: string): value is ProgressStateEnum =>
      Object.values(ProgressStateEnum).includes(value as ProgressStateEnum),
    [],
  );

  const isGameType = useCallback(
    (value: string): value is GamevaultGameTypeEnum =>
      Object.values(GamevaultGameTypeEnum).includes(
        value as GamevaultGameTypeEnum,
      ),
    [],
  );

  const isEarlyAccess = useCallback(
    (value: string): value is EarlyAccessFilter =>
      value === "all" || value === "true" || value === "false",
    [],
  );

  const isBookmark = useCallback(
    (value: string): value is BookmarkFilter | "1" =>
      value === "all" ||
      value === "mine" ||
      value === "others" ||
      value === "1",
    [],
  );

  // Initialize from URL (first render)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URL(window.location.href).searchParams;

    const q = params.get("q");
    if (q) setSearch(q);

    const sort = params.get("sort");
    if (sort && SORT_BY.some((o) => o.value === sort)) setSortBy(sort);

    const ord = params.get("order");
    if (ord === "ASC" || ord === "DESC") setOrder(ord);

    const bookmarked = params.get("bookmarked");
    if (bookmarked && isBookmark(bookmarked)) {
      setBookmarkFilter(bookmarked === "1" ? "mine" : bookmarked);
    }

    const types = getParamValues(params, "types").filter(isGameType);
    if (types.length > 0) {
      setSelectedGameTypes(
        types
          .map((t): FilterItem | null => {
            const match = GAME_TYPES.find((gt) => gt.value === t);
            return match ? { id: t, name: match.label } : null;
          })
          .filter((x): x is FilterItem => x !== null),
      );
    }

    const tags = getParamValues(params, "tags");
    if (tags.length > 0) setSelectedTags(tags.map((t) => ({ id: t, name: t })));

    const genres = getParamValues(params, "genres");
    if (genres.length > 0)
      setSelectedGenres(genres.map((g) => ({ id: g, name: g })));

    const developers = getParamValues(params, "developers");
    if (developers.length > 0)
      setSelectedDevelopers(developers.map((d) => ({ id: d, name: d })));

    const publishers = getParamValues(params, "publishers");
    if (publishers.length > 0)
      setSelectedPublishers(publishers.map((p) => ({ id: p, name: p })));

    const state = params.get("state");
    if (state && isProgressState(state)) setSelectedGameState(state);

    const after = params.get("releasedAfter");
    if (after) setReleaseDateFrom(after);

    const before = params.get("releasedBefore");
    if (before) setReleaseDateTo(before);

    const ea = params.get("earlyAccess");
    if (ea && isEarlyAccess(ea)) setEarlyAccess(ea);

    urlInitializedRef.current = true;
  }, [getParamValues, isBookmark, isEarlyAccess, isGameType, isProgressState]);

  // Sync all filters into URL search params for shareable links (debounced)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!urlInitializedRef.current) return;

    const timeoutId = setTimeout(() => {
      const url = new URL(window.location.href);
      const params = url.searchParams;

      if (search.trim().length > 0) params.set("q", search.trim());
      else params.delete("q");

      if (sortBy !== "sort_title") params.set("sort", sortBy);
      else params.delete("sort");

      if (order !== "ASC") params.set("order", order);
      else params.delete("order");

      if (bookmarkFilter !== "all") params.set("bookmarked", bookmarkFilter);
      else params.delete("bookmarked");

      setParamValues(
        params,
        "types",
        selectedGameTypes
          .map((i) => String(i.id))
          .filter((v): v is GamevaultGameTypeEnum => isGameType(v)),
      );
      setParamValues(
        params,
        "tags",
        selectedTags.map((t) => t.name),
      );
      setParamValues(
        params,
        "genres",
        selectedGenres.map((g) => g.name),
      );
      setParamValues(
        params,
        "developers",
        selectedDevelopers.map((d) => d.name),
      );
      setParamValues(
        params,
        "publishers",
        selectedPublishers.map((p) => p.name),
      );

      if (selectedGameState) params.set("state", selectedGameState);
      else params.delete("state");

      if (releaseDateFrom) params.set("releasedAfter", releaseDateFrom);
      else params.delete("releasedAfter");

      if (releaseDateTo) params.set("releasedBefore", releaseDateTo);
      else params.delete("releasedBefore");

      if (earlyAccess !== "all") params.set("earlyAccess", earlyAccess);
      else params.delete("earlyAccess");

      // Only update URL if it actually changed to avoid rate-limiting errors
      const newUrl = url.toString();
      if (newUrl !== window.location.href) {
        window.history.replaceState({}, "", newUrl);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [
    bookmarkFilter,
    earlyAccess,
    isGameType,
    order,
    releaseDateFrom,
    releaseDateTo,
    search,
    selectedDevelopers,
    selectedGameState,
    selectedGameTypes,
    selectedGenres,
    selectedPublishers,
    selectedTags,
    setParamValues,
    sortBy,
  ]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            loadMore();
          }
        });
      },
      { root: null, rootMargin: "200px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore, games.length]);

  // Persist and restore scroll position across navigation.
  // Saves on scroll events; restores once games are in the DOM.
  useScrollRestoration("library_scroll_position", games.length > 0);

  // --- Installed games (Tauri only) ---
  const { installedGames, refetch: refetchInstalledGames } =
    useInstalledGames();

  const INSTALLED_ROWS_KEY = "installed_games_rows";
  const [installedRows, setInstalledRows] = useState(() => {
    try {
      const saved = localStorage.getItem(INSTALLED_ROWS_KEY);
      if (saved) {
        const n = parseInt(saved, 10);
        if (n >= 1 && n <= 5) return n;
      }
    } catch {
      console.warn("Failed to read installed rows from localStorage");
    }
    return 1;
  });
  const handleRowsChange = useCallback((n: number) => {
    setInstalledRows(n);
    try {
      localStorage.setItem(INSTALLED_ROWS_KEY, String(n));
    } catch {
      console.warn("Failed to persist installed rows to localStorage");
    }
  }, []);

  // Map installed games to a GamevaultGame-compatible shape for GameCard
  const installedAsGames: GamevaultGame[] = useMemo(() => {
    return installedGames.map((ig) => {
      const meta = (ig.cachedMetadata || ig.gameMetadata) as any;
      const g = {
        id: ig.gameId,
        created_at: new Date(),
        entity_version: 0,
        title: ig.gameTitle,
        sort_title: ig.gameTitle?.toLowerCase(),
        type: ig.gameType as any,
        metadata: meta
          ? {
              title: meta.title,
              cover: meta.cover ?? meta.metadata?.cover,
              rating: meta.rating ?? meta.metadata?.rating,
              release_date: meta.release_date ?? meta.metadata?.release_date,
              tags: meta.tags ?? meta.metadata?.tags,
              genres: meta.genres ?? meta.metadata?.genres,
              developers: meta.developers ?? meta.metadata?.developers,
              publishers: meta.publishers ?? meta.metadata?.publishers,
            }
          : undefined,
      } as GamevaultGame;
      // Attach installation info for GameCard play button
      (g as any)._installedInfo = {
        installationDirectory: ig.installationDirectory,
        versionDirectory: ig.versionDirectory,
        versionId: ig.versionId,
        versionName: ig.versionName,
        installedAt: ig.installedAt ?? 0,
        lastPlayedAt: ig.lastPlayedAt ?? 0,
      };
      (g as any)._onUninstalled = refetchInstalledGames;
      return g;
    });
  }, [installedGames]);

  // Map installed game id -> installation info so server games that are
  // already installed locally can be marked (e.g. a small "Installed" badge).
  const installedByGameId = useMemo(() => {
    const map = new Map<number, InstalledGameInfo>();
    for (const ig of installedGames) {
      if (ig.gameId > 0) {
        map.set(ig.gameId, ig);
      }
    }
    return map;
  }, [installedGames]);

  // Client-side filter + sort installed games with the same Library criteria
  const filteredInstalledGames = useMemo(() => {
    let filtered = installedAsGames;

    // Search filter
    if (deferredSearch.trim()) {
      const q = deferredSearch.trim().toLowerCase();
      filtered = filtered.filter((g) =>
        (g.title ?? g.sort_title ?? "").toLowerCase().includes(q),
      );
    }

    // Game type filter
    if (gameTypeValues.length > 0) {
      filtered = filtered.filter(
        (g) => g.type && gameTypeValues.includes(g.type),
      );
    }

    // Tag filter
    if (tagNames.length > 0) {
      filtered = filtered.filter((g) => {
        const gameTags = (g.metadata as any)?.tags;
        if (!Array.isArray(gameTags)) return false;
        return tagNames.some((t) =>
          gameTags.some(
            (gt: any) =>
              (gt.name ?? gt)?.toString().toLowerCase() === t.toLowerCase(),
          ),
        );
      });
    }

    // Genre filter
    if (genreNames.length > 0) {
      filtered = filtered.filter((g) => {
        const gameGenres = (g.metadata as any)?.genres;
        if (!Array.isArray(gameGenres)) return false;
        return genreNames.some((gn) =>
          gameGenres.some(
            (gg: any) =>
              (gg.name ?? gg)?.toString().toLowerCase() === gn.toLowerCase(),
          ),
        );
      });
    }

    // Developer filter
    if (developerNames.length > 0) {
      filtered = filtered.filter((g) => {
        const gameDevs = (g.metadata as any)?.developers;
        if (!Array.isArray(gameDevs)) return false;
        return developerNames.some((d) =>
          gameDevs.some(
            (gd: any) =>
              (gd.name ?? gd)?.toString().toLowerCase() === d.toLowerCase(),
          ),
        );
      });
    }

    // Publisher filter
    if (publisherNames.length > 0) {
      filtered = filtered.filter((g) => {
        const gamePubs = (g.metadata as any)?.publishers;
        if (!Array.isArray(gamePubs)) return false;
        return publisherNames.some((p) =>
          gamePubs.some(
            (gp: any) =>
              (gp.name ?? gp)?.toString().toLowerCase() === p.toLowerCase(),
          ),
        );
      });
    }

    // Sort: most recently installed or played games first (leftmost in the
    // installed carousel). Ties are broken by title for a stable order.
    const sorted = [...filtered].sort((a, b) => {
      const ia = (a as any)._installedInfo;
      const ib = (b as any)._installedInfo;
      const ra = Math.max(
        Number(ia?.installedAt) || 0,
        Number(ia?.lastPlayedAt) || 0,
      );
      const rb = Math.max(
        Number(ib?.installedAt) || 0,
        Number(ib?.lastPlayedAt) || 0,
      );
      if (rb !== ra) return rb - ra;
      return (a.sort_title ?? a.title ?? "").localeCompare(
        b.sort_title ?? b.title ?? "",
      );
    });

    return sorted;
  }, [
    installedAsGames,
    deferredSearch,
    gameTypeValues,
    tagNames,
    genreNames,
    developerNames,
    publisherNames,
  ]);

  return (
    <div className="flex min-h-full flex-col gap-5">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <Heading className="flex items-center gap-3">
              Library {count && <Badge className="ml-1">{count}</Badge>}
            </Heading>
            <Text className="max-w-2xl">
              Browse, search, and manage your entire game collection.
            </Text>
          </div>
        </div>
        <Divider className="border-gv-line/80" />
      </div>

      <section className="surface-panel rounded-3xl p-5 sm:p-6">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_auto_auto] lg:items-end">
          <div className="w-full lg:col-span-1">
            <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-gv-muted">
              Search
            </label>
            <Input
              name="search"
              value={search}
              onChange={(e: any) => setSearch(e.target.value)}
              clearable
              onClear={() => setSearch("")}
              placeholder="Search games..."
              disabled={!serverUrl}
            />
          </div>

          {/* On mobile: [Sort By + Direction | Filters] in one flex row.
              On lg+: lg:contents dissolves the wrapper so each child is a direct grid cell. */}
          <div className="flex items-end gap-2 lg:contents">
            <div className="flex min-w-0 flex-1 items-end gap-2 lg:contents">
              <div className="min-w-0 flex-1">
                <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-gv-muted">
                  Sort by
                </label>
                <Listbox
                  name="sortBy"
                  value={sortBy}
                  onChange={(v: any) => setSortBy(String(v))}
                >
                  {SORT_BY.map((opt) => (
                    <ListboxOption key={opt.value} value={opt.value}>
                      <ListboxLabel>{opt.label}</ListboxLabel>
                    </ListboxOption>
                  ))}
                </Listbox>
              </div>

              <div className="shrink-0">
                <Button
                  outline
                  className={`${CONTROL_HEIGHT_CLASS} px-3 gap-1.5`}
                  aria-label="Toggle sorting direction"
                  onClick={() =>
                    setOrder((o) => (o === "ASC" ? "DESC" : "ASC"))
                  }
                >
                  {order === "ASC" ? (
                    <ArrowUpIcon className="h-4 w-4" />
                  ) : (
                    <ArrowDownIcon className="h-4 w-4" />
                  )}
                  <span className="hidden sm:inline">
                    {order === "ASC" ? "Ascending" : "Descending"}
                  </span>
                </Button>
              </div>
            </div>

            <div className="shrink-0">
              <Button
                outline
                className={`${CONTROL_HEIGHT_CLASS} px-3 ${hasActiveFilters ? "text-gv-accent" : ""}`}
                aria-label={
                  showFilters
                    ? "Hide filters"
                    : `Show filters${activeFilterCount > 0 ? ` (${activeFilterCount} active)` : ""}`
                }
                onClick={() => setShowFilters((s) => !s)}
              >
                <FunnelIcon className="h-4 w-4 sm:mr-1" />
                <span>{showFilters ? "Hide filters" : "Filters"}</span>
                {activeFilterCount > 0 && (
                  <span
                    className="ml-1 inline-flex h-[1.125rem] min-w-[1.25rem] items-center justify-center rounded-full bg-gv-accent px-1 text-[0.65rem] font-bold leading-none text-white"
                    aria-label={`${activeFilterCount} active filters`}
                  >
                    <span className="translate-y-[0.2em]">
                      {activeFilterCount}
                    </span>
                  </span>
                )}
              </Button>
            </div>
          </div>
        </div>
      </section>
      {showFilters && (
        <div className="surface-panel mb-2 shrink-0 rounded-3xl animate-[panel-in_0.18s_ease-out]">
          <div className="px-4 pt-4 pb-4 sm:px-6 sm:pt-5 sm:pb-5">
            {/* Header with Clear All Filters Button */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FunnelIcon className="h-4 w-4 text-gv-muted" />
                <span className="text-xs text-gv-muted">
                  {hasActiveFilters ? "Filters active" : "No filters active"}
                </span>
              </div>
              {hasActiveFilters && (
                <Button
                  outline
                  onClick={clearAllFilters}
                  className={`${CONTROL_HEIGHT_CLASS} px-3 flex items-center gap-1`}
                >
                  <TrashIcon className="h-4 w-4" />
                  Clear All
                </Button>
              )}
            </div>

            {/* Section 1: Multi-Select Filter Buttons */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {/* Types */}
              <div className="col-span-1">
                <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-gv-muted">
                  Type
                </label>
                <Button
                  outline
                  onClick={() => setGameTypesDialogOpen(true)}
                  className={`w-full justify-start ${CONTROL_HEIGHT_CLASS} px-3`}
                >
                  <span
                    className={`truncate ${selectedGameTypes.length > 0 ? "text-gv-accent-cool" : ""}`}
                  >
                    {selectedGameTypes.length > 0
                      ? `${selectedGameTypes.length} selected`
                      : "All types"}
                  </span>
                </Button>
              </div>

              {/* Tags */}
              <div className="col-span-1">
                <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-gv-muted">
                  Tags
                </label>
                <Button
                  outline
                  onClick={() => setTagsDialogOpen(true)}
                  className={`w-full justify-start ${CONTROL_HEIGHT_CLASS} px-3`}
                >
                  <span
                    className={`truncate ${selectedTags.length > 0 ? "text-gv-accent-cool" : ""}`}
                  >
                    {selectedTags.length > 0
                      ? `${selectedTags.length} selected`
                      : "All tags"}
                  </span>
                </Button>
              </div>

              {/* Genres */}
              <div className="col-span-1">
                <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-gv-muted">
                  Genres
                </label>
                <Button
                  outline
                  onClick={() => setGenresDialogOpen(true)}
                  className={`w-full justify-start ${CONTROL_HEIGHT_CLASS} px-3`}
                >
                  <span
                    className={`truncate ${selectedGenres.length > 0 ? "text-gv-accent-cool" : ""}`}
                  >
                    {selectedGenres.length > 0
                      ? `${selectedGenres.length} selected`
                      : "All genres"}
                  </span>
                </Button>
              </div>

              {/* Developers */}
              <div className="col-span-1">
                <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-gv-muted">
                  Developers
                </label>
                <Button
                  outline
                  onClick={() => setDevelopersDialogOpen(true)}
                  className={`w-full justify-start ${CONTROL_HEIGHT_CLASS} px-3`}
                >
                  <span
                    className={`truncate ${selectedDevelopers.length > 0 ? "text-gv-accent-cool" : ""}`}
                  >
                    {selectedDevelopers.length > 0
                      ? `${selectedDevelopers.length} selected`
                      : "All developers"}
                  </span>
                </Button>
              </div>

              {/* Publishers */}
              <div className="col-span-1">
                <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-gv-muted">
                  Publishers
                </label>
                <Button
                  outline
                  onClick={() => setPublishersDialogOpen(true)}
                  className={`w-full justify-start ${CONTROL_HEIGHT_CLASS} px-3`}
                >
                  <span
                    className={`truncate ${selectedPublishers.length > 0 ? "text-gv-accent-cool" : ""}`}
                  >
                    {selectedPublishers.length > 0
                      ? `${selectedPublishers.length} selected`
                      : "All publishers"}
                  </span>
                </Button>
              </div>
            </div>

            {/* Section 2: Dropdown Controls & Date Pickers */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-4">
              {/* Game State */}
              <div className="col-span-1">
                <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-gv-muted">
                  State
                </label>
                <Listbox
                  name="gameState"
                  value={selectedGameState}
                  onChange={(v: any) =>
                    setSelectedGameState(v as ProgressStateEnum | "")
                  }
                  disabled={!user}
                >
                  <ListboxOption value="">
                    <ListboxLabel>All</ListboxLabel>
                  </ListboxOption>
                  {GAME_STATES.map((state) => (
                    <ListboxOption key={state.value} value={state.value}>
                      <ListboxLabel>{state.label}</ListboxLabel>
                    </ListboxOption>
                  ))}
                </Listbox>
              </div>

              {/* Release Date From */}
              <div className="col-span-1">
                <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-gv-muted">
                  Released After
                </label>
                <Input
                  type="date"
                  className={INPUT_CONTROL_HEIGHT_CLASS}
                  value={releaseDateFrom}
                  onChange={(e: any) => setReleaseDateFrom(e.target.value)}
                />
              </div>

              {/* Release Date To */}
              <div className="col-span-1">
                <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-gv-muted">
                  Released Before
                </label>
                <Input
                  type="date"
                  className={INPUT_CONTROL_HEIGHT_CLASS}
                  value={releaseDateTo}
                  onChange={(e: any) => setReleaseDateTo(e.target.value)}
                />
              </div>

              {/* Early Access */}
              <div className="col-span-1">
                <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-gv-muted">
                  Early Access
                </label>
                <Listbox
                  name="earlyAccess"
                  value={earlyAccess}
                  onChange={(v: any) => setEarlyAccess(v as EarlyAccessFilter)}
                >
                  {EARLY_ACCESS_OPTIONS.map((opt) => (
                    <ListboxOption key={opt.value} value={opt.value}>
                      <ListboxLabel>{opt.label}</ListboxLabel>
                    </ListboxOption>
                  ))}
                </Listbox>
              </div>

              {/* Bookmarks */}
              <div className="col-span-1">
                <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-gv-muted">
                  Bookmarked
                </label>
                <Listbox
                  name="bookmarkFilter"
                  value={bookmarkFilter}
                  onChange={(v: any) => setBookmarkFilter(v as BookmarkFilter)}
                  disabled={!user}
                >
                  {BOOKMARK_OPTIONS.map((opt) => (
                    <ListboxOption key={opt.value} value={opt.value}>
                      <ListboxLabel>{opt.label}</ListboxLabel>
                    </ListboxOption>
                  ))}
                </Listbox>
              </div>
            </div>

            {/* Selected Items Display */}
            {(selectedGameTypes.length > 0 ||
              selectedTags.length > 0 ||
              selectedGenres.length > 0 ||
              selectedDevelopers.length > 0 ||
              selectedPublishers.length > 0) && (
              <div className="mt-4 border-t border-gv-line pt-4">
                <div className="flex flex-wrap gap-1.5">
                  {selectedGameTypes.map((item) => (
                    <Badge
                      key={item.name}
                      color="pink"
                      className="text-xs flex items-center gap-1"
                    >
                      {item.name}
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedGameTypes((prev) =>
                            prev.filter((t) => t.name !== item.name),
                          )
                        }
                        className="hover:text-red-400 ml-0.5"
                      >
                        <XMarkIcon className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  {selectedTags.map((tag) => (
                    <Badge
                      key={tag.name}
                      color="blue"
                      className="text-xs flex items-center gap-1"
                    >
                      {tag.name}
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedTags((prev) =>
                            prev.filter((t) => t.name !== tag.name),
                          )
                        }
                        className="hover:text-red-400 ml-0.5"
                      >
                        <XMarkIcon className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  {selectedGenres.map((genre) => (
                    <Badge
                      key={genre.name}
                      color="green"
                      className="text-xs flex items-center gap-1"
                    >
                      {genre.name}
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedGenres((prev) =>
                            prev.filter((g) => g.name !== genre.name),
                          )
                        }
                        className="hover:text-red-400 ml-0.5"
                      >
                        <XMarkIcon className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  {selectedDevelopers.map((dev) => (
                    <Badge
                      key={dev.name}
                      color="purple"
                      className="text-xs flex items-center gap-1"
                    >
                      {dev.name}
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedDevelopers((prev) =>
                            prev.filter((d) => d.name !== dev.name),
                          )
                        }
                        className="hover:text-red-400 ml-0.5"
                      >
                        <XMarkIcon className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  {selectedPublishers.map((pub) => (
                    <Badge
                      key={pub.name}
                      color="orange"
                      className="text-xs flex items-center gap-1"
                    >
                      {pub.name}
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedPublishers((prev) =>
                            prev.filter((p) => p.name !== pub.name),
                          )
                        }
                        className="hover:text-red-400 ml-0.5"
                      >
                        <XMarkIcon className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto overflow-x-hidden text-center">
        {!serverUrl && (
          <div className="surface-panel-soft rounded-3xl p-8 text-sm text-gv-muted">
            Connect to a server to load games.
          </div>
        )}
        {serverUrl && error && (
          <div className="mb-4 rounded-2xl bg-red-500/10 p-4 text-sm text-red-500">
            {error}
          </div>
        )}

        {/* Installed Games Section (Tauri only) */}
        {isTauri && (
          <SectionExpander
            title={`Installed Games (${filteredInstalledGames.length})`}
            defaultOpen={true}
            headerRight={
              <RowCountControl
                value={installedRows}
                onChange={handleRowsChange}
              />
            }
          >
            {filteredInstalledGames.length === 0 ? (
              <div className="surface-panel-soft rounded-2xl p-4 text-sm text-gv-muted">
                No installed games found.
              </div>
            ) : (
              <div className="overflow-x-auto overflow-y-hidden pb-3">
                <div
                  className="grid gap-5 py-2"
                  style={{
                    gridTemplateRows: `repeat(${Math.min(installedRows, filteredInstalledGames.length)}, auto)`,
                    gridAutoFlow: "column",
                    gridAutoColumns: "160px",
                  }}
                >
                  {filteredInstalledGames.map((g) => (
                    <GameCard
                      key={`installed-${g.id}`}
                      game={g}
                      sortBy={sortBy}
                      hideInstalledBadge
                    />
                  ))}
                </div>
              </div>
            )}
          </SectionExpander>
        )}

        {/* Server Games Section */}
        {isTauri && !isOnline ? (
          <div className="surface-panel-soft rounded-3xl p-8 text-sm text-gv-muted text-center">
            <p className="font-semibold text-gv-text mb-2">Offline Mode</p>
            <p>Server games are unavailable while offline.</p>
            <p className="mt-1">Installed games remain fully playable above.</p>
          </div>
        ) : isTauri ? (
          <SectionExpander
            title={`Server Games (${games.length} of ${count ?? 0})`}
            defaultOpen={true}
          >
            {serverUrl && loading && games.length === 0 && (
              <div className="grid gap-4 sm:gap-6 grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(12rem,1fr))]">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="aspect-3/4 rounded-3xl bg-gv-panel-strong motion-safe:animate-pulse"
                    aria-hidden="true"
                  />
                ))}
              </div>
            )}
            {serverUrl && !loading && games.length === 0 && !error && (
              <div className="surface-panel-soft rounded-3xl p-8 text-sm text-gv-muted">
                No games found.
                {(search.trim() || hasActiveFilters) && (
                  <div className="mt-2">
                    <TextLink
                      href="#"
                      onClick={() => {
                        clearAllFilters();
                        setShowFilters(false);
                        setSearch("");
                      }}
                    >
                      <Strong>Try clearing all filters and search</Strong>
                    </TextLink>
                  </div>
                )}
              </div>
            )}
            <div className="min-w-0 grid gap-5 grid-cols-[repeat(auto-fill,minmax(140px,1fr))] py-2 pb-8">
              {games.map((g, i) => {
                const installed = installedByGameId.get(g.id);
                const cardGame = installed
                  ? {
                      ...g,
                      _installedInfo: {
                        installationDirectory: installed.installationDirectory,
                        versionDirectory: installed.versionDirectory,
                        versionId: installed.versionId,
                        versionName: installed.versionName,
                      },
                      _onUninstalled: refetchInstalledGames,
                    }
                  : g;
                return (
                  <motion.div
                    key={g.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      delay: Math.min(i * 0.03, 0.3),
                      duration: DURATION_SLOW,
                      ease: EASE_OUT,
                    }}
                    className="min-w-0"
                  >
                    <GameCard game={cardGame} sortBy={sortBy} />
                  </motion.div>
                );
              })}
            </div>
            {hasMore && <div ref={sentinelRef} className="h-10 -mt-10" />}
            {loading && games.length > 0 && (
              <div className="flex items-center justify-center gap-2 p-4 text-xs text-gv-muted">
                <svg
                  className="h-3.5 w-3.5 motion-safe:animate-spin"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Loading more…
              </div>
            )}
          </SectionExpander>
        ) : (
          <>
            {serverUrl && loading && games.length === 0 && (
              <div className="grid gap-4 sm:gap-6 grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(12rem,1fr))]">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="aspect-3/4 rounded-3xl bg-gv-panel-strong motion-safe:animate-pulse"
                    aria-hidden="true"
                  />
                ))}
              </div>
            )}
            {serverUrl && !loading && games.length === 0 && !error && (
              <div className="surface-panel-soft rounded-3xl p-8 text-sm text-gv-muted">
                No games found.
                {(search.trim() || hasActiveFilters) && (
                  <div className="mt-2">
                    <TextLink
                      href="#"
                      onClick={() => {
                        clearAllFilters();
                        setShowFilters(false);
                        setSearch("");
                      }}
                    >
                      <Strong>Try clearing all filters and search</Strong>
                    </TextLink>
                  </div>
                )}
              </div>
            )}
            <div className="min-w-0 grid gap-5 grid-cols-[repeat(auto-fill,minmax(140px,1fr))] py-2 pb-8">
              {games.map((g, i) => {
                const installed = installedByGameId.get(g.id);
                const cardGame = installed
                  ? {
                      ...g,
                      _installedInfo: {
                        installationDirectory: installed.installationDirectory,
                        versionDirectory: installed.versionDirectory,
                        versionId: installed.versionId,
                        versionName: installed.versionName,
                      },
                      _onUninstalled: refetchInstalledGames,
                    }
                  : g;
                return (
                  <motion.div
                    key={g.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      delay: Math.min(i * 0.03, 0.3),
                      duration: DURATION_SLOW,
                      ease: EASE_OUT,
                    }}
                    className="min-w-0"
                  >
                    <GameCard game={cardGame} sortBy={sortBy} />
                  </motion.div>
                );
              })}
            </div>
            {hasMore && <div ref={sentinelRef} className="h-10 -mt-10" />}
            {loading && games.length > 0 && (
              <div className="flex items-center justify-center gap-2 p-4 text-xs text-gv-muted">
                <svg
                  className="h-3.5 w-3.5 motion-safe:animate-spin"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Loading more…
              </div>
            )}
          </>
        )}
      </div>

      {/* Filter Dialogs */}
      <MultiSelectFilterDialog
        open={gameTypesDialogOpen}
        onClose={() => setGameTypesDialogOpen(false)}
        title="Types"
        staticItems={GAME_TYPE_FILTER_ITEMS}
        selectedItems={selectedGameTypes}
        onSelectionChange={setSelectedGameTypes}
        badgeColor="pink"
      />
      <MultiSelectFilterDialog
        open={tagsDialogOpen}
        onClose={() => setTagsDialogOpen(false)}
        title="Tags"
        endpoint="/api/tags"
        selectedItems={selectedTags}
        onSelectionChange={setSelectedTags}
        badgeColor="blue"
      />
      <MultiSelectFilterDialog
        open={genresDialogOpen}
        onClose={() => setGenresDialogOpen(false)}
        title="Genres"
        endpoint="/api/genres"
        selectedItems={selectedGenres}
        onSelectionChange={setSelectedGenres}
        badgeColor="green"
      />
      <MultiSelectFilterDialog
        open={developersDialogOpen}
        onClose={() => setDevelopersDialogOpen(false)}
        title="Developers"
        endpoint="/api/developers"
        selectedItems={selectedDevelopers}
        onSelectionChange={setSelectedDevelopers}
        badgeColor="purple"
      />
      <MultiSelectFilterDialog
        open={publishersDialogOpen}
        onClose={() => setPublishersDialogOpen(false)}
        title="Publishers"
        endpoint="/api/publishers"
        selectedItems={selectedPublishers}
        onSelectionChange={setSelectedPublishers}
        badgeColor="orange"
      />
    </div>
  );
}
