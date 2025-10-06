import GameCard from "@/components/GameCard";
import { useAuth } from "@/context/AuthContext";
import { useGames } from "@/hooks/useGames";
import { Divider } from "@tw/divider";
import { Heading } from "@tw/heading";
import { Input } from "@tw/input";
import { Listbox, ListboxLabel, ListboxOption } from "@tw/listbox";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { StarIcon } from "@heroicons/react/24/solid";
import { StarIcon as StarOutlineIcon } from "@heroicons/react/24/outline";
import Card from "@/components/Card";
import { Button } from "@/components/tailwind/button";
import { Badge } from "../components/tailwind/badge";

const SORT_BY: { label: string; value: string }[] = [
  { label: "Title", value: "sort_title" },
  { label: "Size", value: "size" },
  { label: "Date Added", value: "created_at" },
  { label: "Release Date", value: "metadata.release_date" },
  { label: "Rating", value: "metadata.rating" },
  { label: "Download Count", value: "download_count" },
  { label: "Average Playtime", value: "metadata.average_playtime" },
];

const ORDER_BY: { label: string; value: "ASC" | "DESC" }[] = [
  { label: "Descending", value: "DESC" },
  { label: "Ascending", value: "ASC" },
];

const RETAIN_KEY = 'app_retain_library_prefs';
const LIB_SORT_KEY = 'app_library_sort';
const LIB_ORDER_KEY = 'app_library_order';

export default function Library() {
  const { serverUrl, user } = useAuth();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("sort_title");
  const [order, setOrder] = useState<"ASC" | "DESC">("ASC");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);
  // Defer search to avoid spamming requests while user types quickly
  const deferredSearch = useDeferredValue(search);
  const { count, games, loading, error, loadMore, hasMore, refetch } = useGames(
    {
      search: deferredSearch,
      sortBy,
      order,
      limit: 50,
      bookmarkedOnly,
    },
  );

  // Reset to first page when filters change (search, sortBy, order)
  useEffect(() => {
    refetch();
  }, [deferredSearch, sortBy, order, bookmarkedOnly, refetch]);

  // Sync bookmark filter in URL search params for shareable links
  useEffect(() => {
    const url = new URL(window.location.href);
    if (bookmarkedOnly) {
      url.searchParams.set("bookmarked", "1");
    } else {
      url.searchParams.delete("bookmarked");
    }
    // We intentionally do not push to history each keystroke of search for cleanliness
    window.history.replaceState({}, "", url.toString());
  }, [bookmarkedOnly]);

  // Initialize from URL (first render)
  useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    if (params.get("bookmarked") === "1") setBookmarkedOnly(true);
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
      <div className="pb-4 flex flex-col gap-4 md:flex-row md:items-end">
        <div className="flex-1 min-w-[220px]">
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
        <div className="w-56">
          <label className="block text-xs font-medium text-fg-muted mb-1">
            Sort By
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
        <div className="w-40">
          <label className="block text-xs font-medium text-fg-muted mb-1">
            Order
          </label>
          <Listbox
            name="order"
            value={order}
            onChange={(v: any) => setOrder(v as "ASC" | "DESC")}
          >
            {ORDER_BY.map((opt) => (
              <ListboxOption key={opt.value} value={opt.value}>
                <ListboxLabel>{opt.label}</ListboxLabel>
              </ListboxOption>
            ))}
          </Listbox>
        </div>
        <div className="flex flex-col w-40">
          <label className="block text-xs font-medium text-fg-muted mb-1 invisible">
            Advanced Filters
          </label>
          <Button
            outline
            className="w-full justify-center h-9 text-sm items-center"
            onClick={() => setShowAdvanced((s) => !s)}
          >
            {showAdvanced ? "Hide Filters" : "Advanced Filters"}
          </Button>
        </div>
      </div>
      {showAdvanced && (
        <Card title="Advanced Filters" className="gap-4 !mb-6">
          <div className="flex items-center gap-3 flex-wrap text-xs">
            <Button
              aria-pressed={bookmarkedOnly}
              disabled={!user}
              onClick={() => user && setBookmarkedOnly((v) => !v)}
              {...(bookmarkedOnly ? { color: "yellow" } : { outline: true })}
              className="text-sm h-9 px-3 flex items-center gap-1"
            >
              {bookmarkedOnly ? (
                <StarIcon data-slot="icon" className="h-4 w-4" />
              ) : (
                <StarOutlineIcon data-slot="icon" className="h-4 w-4" />
              )}
              Bookmarked
            </Button>
          </div>
          {/* Placeholder for future filters */}
        </Card>
      )}
      <div className="flex-1 overflow-auto">
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
    </div>
  );
}
