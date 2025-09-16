import { useState, useDeferredValue, useEffect, useRef } from "react";
import { Divider } from "@tw/divider";
import { Heading } from "@tw/heading";
import { Input } from "@tw/input";
import { Listbox, ListboxLabel, ListboxOption } from "@tw/listbox";
import GameCard from "@/components/GameCard";
import { useGames } from "@/hooks/useGames";
import { useAuth } from "@/context/AuthContext";

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

export default function Library() {
  const { serverUrl } = useAuth();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("sort_title");
  const [order, setOrder] = useState<"ASC" | "DESC">("ASC");
  // Defer search to avoid spamming requests while user types quickly
  const deferredSearch = useDeferredValue(search);
  const { games, loading, error, loadMore, hasMore, refetch } = useGames({
    search: deferredSearch,
    sortBy,
    order,
    limit: 50,
  });

  // Reset to first page when filters change (search, sortBy, order)
  useEffect(() => { refetch(); }, [deferredSearch, sortBy, order, refetch]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          loadMore();
        }
      });
    }, { root: null, rootMargin: '200px', threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore, games.length]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Heading>Library</Heading>
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
      </div>
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
        {hasMore && (
          <div ref={sentinelRef} className="h-10 -mt-10" />
        )}
        {loading && games.length > 0 && (
          <div className="p-4 text-center text-xs text-fg-muted">Loading more…</div>
        )}
      </div>
    </div>
  );
}
