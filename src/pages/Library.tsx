import GameCard from "@/components/GameCard";
import { useAuth } from "@/context/AuthContext";
import { BookmarkFilter, EarlyAccessFilter, useGames } from "@/hooks/useGames";
import { Divider } from "@tw/divider";
import { Heading } from "@tw/heading";
import { Input } from "@tw/input";
import { Listbox, ListboxLabel, ListboxOption } from "@tw/listbox";
import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
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
import { ProgressStateEnum } from "@/api/models/Progress";
import MultiSelectFilterDialog, {
  FilterItem,
} from "@/components/MultiSelectFilterDialog";

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

const RETAIN_KEY = "app_retain_library_prefs";
const LIB_SORT_KEY = "app_library_sort";
const LIB_ORDER_KEY = "app_library_order";

export default function Library() {
  const { serverUrl, user } = useAuth();

  const CONTROL_HEIGHT_CLASS = "min-h-11 sm:min-h-9";
  const INPUT_CONTROL_HEIGHT_CLASS =
    "[&_input]:min-h-11 sm:[&_input]:min-h-9";
  const [search, setSearch] = useState("");
  // Initialize sort/order from localStorage if retention is enabled
  const [sortBy, setSortBy] = useState(() => {
    try {
      if (
        typeof window !== "undefined" &&
        localStorage.getItem(RETAIN_KEY) === "1"
      ) {
        const saved = localStorage.getItem(LIB_SORT_KEY);
        if (saved && SORT_BY.some((o) => o.value === saved)) return saved;
      }
    } catch {}
    return "sort_title";
  });
  const [order, setOrder] = useState<"ASC" | "DESC">(() => {
    try {
      if (
        typeof window !== "undefined" &&
        localStorage.getItem(RETAIN_KEY) === "1"
      ) {
        const saved = localStorage.getItem(LIB_ORDER_KEY) as
          | "ASC"
          | "DESC"
          | null;
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

  // Defer search to avoid spamming requests while user types quickly
  const deferredSearch = useDeferredValue(search);

  // Convert selected game type FilterItems to GamevaultGameTypeEnum values for API
  const gameTypeValues = useMemo(() => {
    return selectedGameTypes
      .map((item) => {
        const found = GAME_TYPES.find((t) => t.label === item.name);
        return found?.value;
      })
      .filter((v): v is GamevaultGameTypeEnum => v !== undefined);
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

  // Persist sort/order if retention enabled
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(RETAIN_KEY) === "1") {
      try {
        localStorage.setItem(LIB_SORT_KEY, sortBy);
        localStorage.setItem(LIB_ORDER_KEY, order);
      } catch {}
    }
  }, [sortBy, order]);

  // Sync bookmark filter in URL search params for shareable links
  useEffect(() => {
    const url = new URL(window.location.href);
    if (bookmarkFilter !== "all") {
      url.searchParams.set("bookmarked", bookmarkFilter);
    } else {
      url.searchParams.delete("bookmarked");
    }
    // We intentionally do not push to history each keystroke of search for cleanliness
    window.history.replaceState({}, "", url.toString());
  }, [bookmarkFilter]);

  // Initialize from URL (first render)
  useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    const bookmarked = params.get("bookmarked");
    if (
      bookmarked === "mine" ||
      bookmarked === "others" ||
      bookmarked === "1"
    ) {
      setBookmarkFilter(
        bookmarked === "1" ? "mine" : (bookmarked as BookmarkFilter),
      );
    }
  }, []);

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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Heading className="flex items-center">
        Library {count && <Badge className="ml-2">{count}</Badge>}
      </Heading>
      <Divider />
      <div className="pb-4 flex flex-col gap-3">
        {/* Search - Full width */}
        <div className="w-full">
          <label className="block text-xs font-medium text-fg-muted mb-1">
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
        {/* Sort, Order, and Filters Button - Same row */}
        <div className="flex gap-3 items-end">
          <div className="flex-1 min-w-0">
            <label className="block text-xs font-medium text-fg-muted mb-1">
              Sort & Filter
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
          <div className="flex-none">
            <Button
              outline
              className={`${CONTROL_HEIGHT_CLASS} px-3 gap-1.5`}
              aria-label="Toggle sorting direction"
              onClick={() => setOrder((o) => (o === "ASC" ? "DESC" : "ASC"))}
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
          <div className="flex-none">
            <Button
              outline
              className={`${CONTROL_HEIGHT_CLASS} px-3`}
              aria-label={showFilters ? "Hide filters" : "Show filters"}
              onClick={() => setShowFilters((s) => !s)}
            >
              <FunnelIcon className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">
                {showFilters ? "Hide" : "Filters"}
              </span>
            </Button>
          </div>
        </div>
      </div>
      {showFilters && (
        <div className="overflow-hidden rounded-lg dark:bg-zinc-800 bg-zinc-100 shadow-sm mb-4 shrink-0">
          <div className="px-4 pt-4 pb-4 sm:px-6 sm:pt-5 sm:pb-5">
            {/* Header with Clear All Filters Button */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FunnelIcon className="h-4 w-4 text-fg-muted" />
                <span className="text-xs text-fg-muted">
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
              {/* Game Types */}
              <div className="col-span-1">
                <label className="block text-xs font-medium text-fg-muted mb-1">
                  Type
                </label>
                <Button
                  outline
                  onClick={() => setGameTypesDialogOpen(true)}
                  className={`w-full justify-start ${CONTROL_HEIGHT_CLASS} px-3`}
                >
                  <span
                    className={`truncate ${selectedGameTypes.length > 0 ? "text-pink-600 dark:text-pink-400" : ""}`}
                  >
                    {selectedGameTypes.length > 0
                      ? `${selectedGameTypes.length} selected`
                      : "All types"}
                  </span>
                </Button>
              </div>

              {/* Tags */}
              <div className="col-span-1">
                <label className="block text-xs font-medium text-fg-muted mb-1">
                  Tags
                </label>
                <Button
                  outline
                  onClick={() => setTagsDialogOpen(true)}
                  className={`w-full justify-start ${CONTROL_HEIGHT_CLASS} px-3`}
                >
                  <span
                    className={`truncate ${selectedTags.length > 0 ? "text-blue-600 dark:text-blue-400" : ""}`}
                  >
                    {selectedTags.length > 0
                      ? `${selectedTags.length} selected`
                      : "All tags"}
                  </span>
                </Button>
              </div>

              {/* Genres */}
              <div className="col-span-1">
                <label className="block text-xs font-medium text-fg-muted mb-1">
                  Genres
                </label>
                <Button
                  outline
                  onClick={() => setGenresDialogOpen(true)}
                  className={`w-full justify-start ${CONTROL_HEIGHT_CLASS} px-3`}
                >
                  <span
                    className={`truncate ${selectedGenres.length > 0 ? "text-green-600 dark:text-green-400" : ""}`}
                  >
                    {selectedGenres.length > 0
                      ? `${selectedGenres.length} selected`
                      : "All genres"}
                  </span>
                </Button>
              </div>

              {/* Developers */}
              <div className="col-span-1">
                <label className="block text-xs font-medium text-fg-muted mb-1">
                  Developers
                </label>
                <Button
                  outline
                  onClick={() => setDevelopersDialogOpen(true)}
                  className={`w-full justify-start ${CONTROL_HEIGHT_CLASS} px-3`}
                >
                  <span
                    className={`truncate ${selectedDevelopers.length > 0 ? "text-purple-600 dark:text-purple-400" : ""}`}
                  >
                    {selectedDevelopers.length > 0
                      ? `${selectedDevelopers.length} selected`
                      : "All developers"}
                  </span>
                </Button>
              </div>

              {/* Publishers */}
              <div className="col-span-1">
                <label className="block text-xs font-medium text-fg-muted mb-1">
                  Publishers
                </label>
                <Button
                  outline
                  onClick={() => setPublishersDialogOpen(true)}
                  className={`w-full justify-start ${CONTROL_HEIGHT_CLASS} px-3`}
                >
                  <span
                    className={`truncate ${selectedPublishers.length > 0 ? "text-orange-600 dark:text-orange-400" : ""}`}
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
                <label className="block text-xs font-medium text-fg-muted mb-1">
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
                <label className="block text-xs font-medium text-fg-muted mb-1">
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
                <label className="block text-xs font-medium text-fg-muted mb-1">
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
                <label className="block text-xs font-medium text-fg-muted mb-1">
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
                <label className="block text-xs font-medium text-fg-muted mb-1">
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
              <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
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
      <div className="flex-1 overflow-y-scroll overflow-x-hidden">
        {!serverUrl && (
          <div className="p-8 text-sm text-fg-muted">
            Connect to a server to load games.
          </div>
        )}
        {serverUrl && error && (
          <div className="p-4 mb-4 rounded-md bg-red-500/10 text-red-500 text-sm">
            {error}
          </div>
        )}
        {serverUrl && loading && (
          <div className="p-8 text-sm text-fg-muted">Loading games…</div>
        )}
        {serverUrl && !loading && games.length === 0 && !error && (
          <div className="p-8 text-sm text-fg-muted">No games found.</div>
        )}
        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(140px,1fr))] pb-8">
          {games.map((g) => (
            <GameCard key={g.id} game={g} />
          ))}
        </div>
        {hasMore && <div ref={sentinelRef} className="h-10 -mt-10" />}
        {loading && games.length > 0 && (
          <div className="p-4 text-center text-xs text-fg-muted">
            Loading more…
          </div>
        )}
      </div>

      {/* Filter Dialogs */}
      <MultiSelectFilterDialog
        open={gameTypesDialogOpen}
        onClose={() => setGameTypesDialogOpen(false)}
        title="Game Types"
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
