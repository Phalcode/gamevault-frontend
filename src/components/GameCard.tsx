import { Media } from "@/components/Media";
import { useAuth } from "@/context/AuthContext";
import { useDownloads } from "@/context/DownloadContext";
import { Game, getGameCoverMediaId } from "@/hooks/useGames";
import { ArrowDownTrayIcon } from "@heroicons/react/16/solid";
import { Button } from "@tw/button";
import {
  Dropdown,
  DropdownButton,
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
} from "@tw/dropdown";
import clsx from "clsx";
import { useCallback } from "react";

export function GameCard({ game }: { game: Game }) {
  const coverId = getGameCoverMediaId(game);
  const { serverUrl } = useAuth();
  const { startDownload } = useDownloads() as any;

  const filename = (() => {
    const p = game.path || (game as any).Path;
    if (!p) return `${game.title}.zip`;
    // Derive filename similar to Path.GetFileName
    try {
      const parts = p.split(/\\|\//);
      const last = parts[parts.length - 1];
      return last || `${game.title}.zip`;
    } catch {
      return `${game.title}.zip`;
    }
  })();

  const rawSize = (game as any).size;

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

  const handleClientOpen = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const url = `gamevault://show?gameid=${game.id}`;
      window.location.href = url;
    },
    [game.id],
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
            media={{ id: coverId } as any}
            size={300}
            className="h-full w-full object-contain rounded-none"
            square
            alt={game.title}
            onClick={handleClientOpen}
          />
        ) : (
          <div onClick={handleClientOpen} className="text-xs text-fg-muted">
            No Cover
          </div>
        )}
        {/* Top overlay with download actions */}
        <div className="absolute inset-x-0 top-0 flex justify-end p-1 gap-1 bg-gradient-to-b from-black/60 via-black/30 to-transparent z-10">
          <Dropdown>
            <DropdownButton
              as={Button}
              color="indigo"
              className="!px-2 !py-1 h-8 text-xs font-medium flex items-center gap-1"
            >
              <ArrowDownTrayIcon className="size-4" />
              <span className="hidden xs:inline">Download</span>
            </DropdownButton>
            <DropdownMenu className="min-w-48" anchor="bottom end">
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
        <h3 className="text-xs font-medium truncate" title={game.title}>
          {game.title}
        </h3>
        {game.sort_title && game.sort_title !== game.title && (
          <p
            className="mt-0.5 text-[10px] text-fg-muted truncate"
            title={game.sort_title}
          >
            {game.sort_title}
          </p>
        )}
        {formattedSize && (
          <p className="mt-0.5 text-[10px] text-fg-muted" title={formattedSize}>
            {formattedSize}
          </p>
        )}
      </div>
    </div>
  );
}

export default GameCard;
