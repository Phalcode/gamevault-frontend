import { GamevaultGame } from "@/api/models/GamevaultGame";
import { Media } from "@/components/Media";
import { useAuth } from "@/context/AuthContext";
import { useDownloads } from "@/context/DownloadContext";
import { getGameCoverMediaId } from "@/hooks/useGames";
import { CloudArrowDownIcon } from "@heroicons/react/16/solid";
import { StarIcon as StarSolid } from "@heroicons/react/24/solid";
import { StarIcon as StarOutline } from "@heroicons/react/24/outline";
import { Button } from "@tw/button";
import {
  Dropdown,
  DropdownButton,
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
} from "@tw/dropdown";
import clsx from "clsx";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router";

export function GameCard({ game }: { game: GamevaultGame }) {
  const coverId = getGameCoverMediaId(game) as number | string | null;
  const { serverUrl, user, authFetch } = useAuth();
  // Derive initial bookmarked state from raw API shape (bookmarked_users or bookmarkedUsers)
  const currentUserId = (user as any)?.id ?? (user as any)?.ID;
  const initialBookmarked = useMemo(() => {
    if (!currentUserId) return false;
    const raw = (game as any).bookmarked_users || (game as any).bookmarkedUsers;
    if (!Array.isArray(raw)) return false;
    return raw.some((u: any) => (u?.id ?? u?.ID) === currentUserId);
  }, [game, currentUserId]);
  const [bookmarked, setBookmarked] = useState<boolean>(initialBookmarked);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);

  const toggleBookmark = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!serverUrl || !currentUserId || bookmarkBusy) return;
      const base = serverUrl.replace(/\/+$/, "");
      const url = `${base}/api/users/me/bookmark/${game.id}`;
      const next = !bookmarked;
      setBookmarked(next); // optimistic
      setBookmarkBusy(true);
      try {
        const res = await authFetch(url, { method: next ? "POST" : "DELETE" });
        if (!res.ok) throw new Error(`Bookmark toggle failed (${res.status})`);
      } catch (err) {
        // rollback on error
        setBookmarked(!next);
      } finally {
        setBookmarkBusy(false);
      }
    },
    [serverUrl, currentUserId, bookmarkBusy, authFetch, game.id, bookmarked],
  );
  const { startDownload } = useDownloads() as any;

  const filename = (() => {
    return `${game.title}.zip`;
  })();

  const rawSize = game.size;

  const formatBytes = useCallback((bytes?: number) => {
    if (bytes === undefined || bytes === null || isNaN(bytes)) return null;
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB", "PB"];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    return `${value.toFixed(value < 10 ? 2 : value < 100 ? 1 : 0)} ${units[unitIndex]}`;
  }, []);

  const formattedSize = formatBytes(
    typeof rawSize === "number" ? rawSize : Number(rawSize),
  );

  const handleDirectDownload = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!serverUrl) return;
      startDownload(game.id, filename);
    },
    [serverUrl, startDownload, game.id, filename],
  );

  const handleClientDownload = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const url = `gamevault://install?gameid=${game.id}`;
      window.location.href = url;
    },
    [game.id],
  );

  const navigate = useNavigate();

  const handleOpenGameView = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      navigate(`/library/${game.id}`);
    },
    [navigate, game.id],
  );

  return (
    <div
      className={clsx(
        "group flex flex-col rounded-xl bg-zinc-100 dark:bg-zinc-800 shadow-sm ring-1 ring-zinc-950/10 dark:ring-white/5 overflow-hidden focus:outline-none focus:ring-2 focus:ring-indigo-500",
        "transition-colors hover:bg-zinc-200/60 dark:hover:bg-zinc-700/70 cursor-pointer",
      )}
      tabIndex={0}
    >
      <div className="relative aspect-[3/4] w-full bg-bg-muted flex items-center justify-center overflow-hidden">
        {coverId ? (
          <Media
            media={{
              id: typeof coverId === 'number' ? coverId : Number(coverId) || 0,
              created_at: new Date(0),
              entity_version: 0,
            } as any}
            size={300}
            className="h-full w-full object-contain rounded-none"
            square
            alt={game.title}
            onClick={handleOpenGameView}
          />
        ) : (
          <div onClick={handleOpenGameView} className="text-xs text-fg-muted">
            No Cover
          </div>
        )}
        {/* Top-right bookmark toggle */}
        <button
          type="button"
          onClick={toggleBookmark}
            aria-label={bookmarked ? "Remove bookmark" : "Add bookmark"}
            aria-pressed={bookmarked}
          disabled={!currentUserId || bookmarkBusy}
          className={clsx(
            "absolute top-1 right-1 h-8 w-8 flex items-center justify-center rounded-md border shadow-sm backdrop-blur-sm transition-colors",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            bookmarked
              ? "bg-yellow-400/20 border-yellow-400"
              : "bg-zinc-900/40 dark:bg-zinc-700/50 border-white/20 hover:bg-zinc-800/60 dark:hover:bg-zinc-600/60",
          )}
        >
          {bookmarked ? (
            <StarSolid className="h-5 w-5 text-yellow-400" />
          ) : (
            <StarOutline className="h-5 w-5 text-white" />
          )}
        </button>
        {/* Bottom-right download actions */}
        <div className="absolute bottom-0 right-0 p-1 z-10 flex justify-end opacity-85">
          <Dropdown>
            <DropdownButton
              as={Button}
              color="zinc"
              aria-label="Download"
              className="flex justify-center h-8 text-md font-medium items-center gap-1 shadow-md shadow-black/20 backdrop-blur-sm"
            >
              <CloudArrowDownIcon className="w-6 h-6 fill-white" />
            </DropdownButton>
            <DropdownMenu className="min-w-48" anchor="top end">
              <DropdownItem onClick={handleDirectDownload}>
                <DropdownLabel>Direct Download</DropdownLabel>
              </DropdownItem>
              <DropdownItem onClick={handleClientDownload}>
                <DropdownLabel>Download via GameVault Client</DropdownLabel>
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
        </div>
      </div>
      <div className="p-2 pt-2">
        <h3 className="text-sm font-medium truncate" title={game.title}>
          {game.metadata?.title || game.title}
        </h3>
        {(game as any).sort_title && (game as any).sort_title !== game.title && (
          <p
            className="mt-0.5 text-xs text-fg-muted truncate"
            title={game.title}
          >
            {game.title}
          </p>
        )}
        {formattedSize && (
          <p className="mt-0.5 text-xs text-fg-muted" title={formattedSize}>
            {formattedSize}
          </p>
        )}
      </div>
    </div>
  );
}

export default GameCard;
