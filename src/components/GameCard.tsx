import { GamevaultGame } from "@/api/models/GamevaultGame";
import { Media } from "@/components/Media";
import { useAuth } from "@/context/AuthContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useDownloads } from "@/context/DownloadContext";
import { getGameCoverMediaId } from "@/hooks/useGames";
import { CloudArrowDownIcon } from "@heroicons/react/16/solid";
import {
  StarIcon as StarSolid,
  Cog8ToothIcon,
} from "@heroicons/react/24/solid";
import { StarIcon as StarOutline } from "@heroicons/react/24/outline";
import { Button } from "@tw/button";
import { GameSettings } from "@/components/admin/GameSettings";
import { VersionSelectDialog } from "@/components/VersionSelectDialog";
import { isTauriApp } from "@/utils/tauri";
import { Alert, AlertTitle } from "@tw/alert";
import {
  Dropdown,
  DropdownButton,
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
} from "@tw/dropdown";
import clsx from "clsx";
import { useCallback, useMemo, useState, useEffect } from "react";
import { Link } from "react-router";
import { GameVersion } from "@/api/models/GameVersion";

export function GameCard({ game }: { game: GamevaultGame }) {
  const { serverUrl, user, authFetch } = useAuth();
  const { showAlert } = useAlertDialog();
  // Detect if this is a locally installed game (set by Library for installed games)
  const installedInfo = (game as any)?._installedInfo as
    | { installationDirectory: string; versionDirectory: string; versionId: number; versionName: string }
    | undefined;
  const onUninstalledCallback = (game as any)?._onUninstalled as
    | (() => void)
    | undefined;
  const isInstalled = !!installedInfo;
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [localGame, setLocalGame] = useState<GamevaultGame>(game);
  const [versionDialogOpen, setVersionDialogOpen] = useState(false);
  const [selectableVersions, setSelectableVersions] = useState<GameVersion[]>([]);
  const [pendingDownloadAction, setPendingDownloadAction] = useState<
    "direct" | "tauri" | "client" | null
  >(null);

  const coverId = getGameCoverMediaId(localGame) as number | string | null;

  useEffect(() => {
    setLocalGame(game);
  }, [game]);

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

  const isTauri = isTauriApp();

  const rawSize = localGame.size;

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

  const resolveVersions = useCallback(async (): Promise<GameVersion[]> => {
    if (Array.isArray(localGame.versions) && localGame.versions.length > 0) {
      return localGame.versions;
    }
    if (!serverUrl) return [];

    const base = serverUrl.replace(/\/+$/, "");
    const res = await authFetch(`${base}/api/games/${game.id}`, {
      method: "GET",
    });
    if (!res.ok) return [];
    const fullGame = (await res.json()) as GamevaultGame;
    const fullVersions = Array.isArray(fullGame.versions) ? fullGame.versions : [];
    if (fullVersions.length > 0) {
      setLocalGame((prev) => ({ ...prev, versions: fullVersions }));
    }
    return fullVersions;
  }, [localGame.versions, serverUrl, authFetch, game.id]);

  const executeDownloadAction = useCallback(
    (action: "direct" | "tauri" | "client", selectedVersion: GameVersion) => {
      const resolvedTitle = localGame.metadata?.title || localGame.title;
      const filePathFallback = selectedVersion.file_path
        ? selectedVersion.file_path.split(/[/\\]/).pop()
        : undefined;
      const selectedFilename =
        filePathFallback && filePathFallback.trim().length > 0
          ? filePathFallback
          : `${resolvedTitle}.zip`;

      if (action === "client") {
        const url = `gamevault://install?gameid=${game.id}&versionid=${selectedVersion.id}`;
        window.location.href = url;
        return;
      }

      startDownload({
        gameId: game.id,
        versionId: selectedVersion.id,
        versionName: selectedVersion.version,
        gameTitle: resolvedTitle,
        gameMetadata: localGame.metadata,
        gameType: (selectedVersion.type || localGame.type) as any,
        filename: selectedFilename,
      });

      showAlert({
        title: `Added ${resolvedTitle} to the download queue`,
      });
    },
    [game.id, localGame, showAlert, startDownload],
  );

  const selectVersionAndRun = useCallback(
    async (action: "direct" | "tauri" | "client") => {
      const versions = await resolveVersions();

      if (!versions.length) {
        showAlert({
          title: "No downloadable version found",
          description: "This game currently has no available version to download.",
        });
        return;
      }

      if (versions.length === 1) {
        executeDownloadAction(action, versions[0]);
        return;
      }

      setSelectableVersions(versions);
      setPendingDownloadAction(action);
      setVersionDialogOpen(true);
    },
    [resolveVersions, showAlert, executeDownloadAction],
  );

  const handleDirectDownload = useCallback(
    async () => {
      if (!serverUrl) return;
      await selectVersionAndRun("direct");
    },
    [serverUrl, selectVersionAndRun],
  );

  const handleTauriDownload = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!serverUrl) return;

      console.log("=== handleTauriDownload called ===");
      console.log("Game ID:", game.id);

      try {
        // Get download path from localStorage
        const downloadPath = localStorage.getItem("tauri_download_path");
        console.log("Download path check:", downloadPath);
        if (!downloadPath) {
          alert("Please select a download location in Settings first.");
          return;
        }

        console.log("Starting download...");
        await selectVersionAndRun("tauri");
      } catch (error) {
        console.error("Error starting Tauri download:", error);
      }
    },
    [serverUrl, selectVersionAndRun],
  );

  const handlePlayGame = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!installedInfo) return;

      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const { join } = await import("@tauri-apps/api/path");

        const configPath = await join(
          installedInfo.versionDirectory,
          ".gamevault.game.config.json",
        );

        let launchExe: string | undefined;
        let launchParams: string | undefined;
        let launchAsAdmin = false;

        if (await invoke<boolean>("fs_path_exists", { path: configPath })) {
          try {
            const raw = JSON.parse(await invoke<string>("fs_read_text_file", { path: configPath }));
            launchExe = raw.launchexecutable;
            launchParams = raw.launchparameters;
            launchAsAdmin = !!raw.launchasadmin;
          } catch {}
        }

        if (!launchExe) {
          showAlert({
            title: "No launch executable configured",
            description:
              "Open Game Settings → Launch Options to select an executable first.",
          });
          return;
        }

        await invoke("launch_game", {
          installationPath: installedInfo.installationDirectory,
          executableRelativePath: launchExe,
          launchParameters: launchParams || null,
          runAsAdmin: launchAsAdmin,
        });
      } catch (err: any) {
        showAlert({
          title: "Failed to launch game",
          description: err?.message || String(err),
        });
      }
    },
    [installedInfo, showAlert],
  );

  const handleClientDownload = useCallback(
    async () => {
      await selectVersionAndRun("client");
    },
    [selectVersionAndRun],
  );

  const handleVersionSelect = useCallback(
    (selectedVersion: GameVersion) => {
      if (!pendingDownloadAction) return;
      executeDownloadAction(pendingDownloadAction, selectedVersion);
      setVersionDialogOpen(false);
      setPendingDownloadAction(null);
      setSelectableVersions([]);
    },
    [pendingDownloadAction, executeDownloadAction],
  );

  const gameViewUrl = `/library/${game.id}`;

  const handleOpenSettings = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSettingsOpen(true);
  }, []);

  return (
    <>
      <Link
        to={gameViewUrl}
        className={clsx(
          "group flex flex-col rounded-xl bg-zinc-100 dark:bg-zinc-800 shadow-sm ring-1 ring-zinc-950/10 dark:ring-white/5 overflow-hidden focus:outline-none focus:ring-2 focus:ring-indigo-500",
          "transition-colors hover:bg-zinc-200/60 dark:hover:bg-zinc-700/70 cursor-pointer",
        )}
      >
        <div className="relative aspect-[3/4] w-full bg-bg-muted flex items-center justify-center overflow-hidden">
          {coverId ? (
            <Media
              media={
                {
                  id:
                    typeof coverId === "number"
                      ? coverId
                      : Number(coverId) || 0,
                  created_at: new Date(0),
                  entity_version: 0,
                } as any
              }
              size={300}
              className="h-full w-full object-contain rounded-none"
              square
              alt={localGame.title}
            />
          ) : (
            <div className="text-xs text-fg-muted">No Cover</div>
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
          {/* Top-left settings button */}
          <button
            type="button"
            onClick={handleOpenSettings}
            aria-label="Settings"
            className="absolute top-1 left-1 h-8 w-8 flex items-center justify-center rounded-md border shadow-sm backdrop-blur-sm transition-colors bg-zinc-900/40 dark:bg-zinc-700/50 border-white/20 hover:bg-zinc-800/60 dark:hover:bg-zinc-600/60"
            title="Settings"
          >
            <Cog8ToothIcon className="h-5 w-5 text-white" />
          </button>
          {/* Bottom-right download/play actions */}
          <div className="absolute bottom-0 right-0 p-1 z-10 flex justify-end opacity-85">
            {isInstalled ? (
              <button
                type="button"
                aria-label="Play"
                onClick={handlePlayGame}
                className="h-8 w-8 flex items-center justify-center rounded-md border shadow-md backdrop-blur-sm transition-colors bg-emerald-600/90 border-emerald-500/60 hover:bg-emerald-500 shadow-black/20"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-5 h-5 fill-white">
                  <path d="M8 17.175V6.825q0-.425.3-.713t.7-.287q.125 0 .263.037t.262.113l8.15 5.175q.225.15.338.375t.112.475t-.112.475t-.338.375l-8.15 5.175q-.125.075-.262.113T9 18.175q-.4 0-.7-.288t-.3-.712"/>
                </svg>
              </button>
            ) : isTauri ? (
              <Button
                color="zinc"
                aria-label="Download"
                className="flex justify-center h-8 text-md font-medium items-center gap-1 shadow-md shadow-black/20 backdrop-blur-sm"
                onClick={handleTauriDownload}
              >
                <CloudArrowDownIcon className="w-6 h-6 fill-white" />
              </Button>
            ) : (
              <Dropdown>
                <DropdownButton
                  as={Button}
                  color="zinc"
                  aria-label="Download"
                  className="flex justify-center h-8 text-md font-medium items-center gap-1 shadow-md shadow-black/20 backdrop-blur-sm"
                  onClick={(e: React.MouseEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  <CloudArrowDownIcon className="w-6 h-6 fill-white" />
                </DropdownButton>
                <DropdownMenu className="min-w-48" anchor="top end">
                  <DropdownItem
                    onClick={(e: React.MouseEvent) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void handleDirectDownload();
                    }}
                  >
                    <DropdownLabel>Direct Download</DropdownLabel>
                  </DropdownItem>
                  <DropdownItem
                    onClick={(e: React.MouseEvent) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void handleClientDownload();
                    }}
                  >
                    <DropdownLabel>Download via GameVault Client</DropdownLabel>
                  </DropdownItem>
                </DropdownMenu>
              </Dropdown>
            )}
          </div>
        </div>
        <div className="p-2 pt-2">
          <h3 className="text-sm font-medium truncate" title={localGame.title}>
            {localGame.metadata?.title || localGame.title}
          </h3>
          {(localGame as any).sort_title &&
            (localGame as any).sort_title !== localGame.title && (
              <p
                className="mt-0.5 text-xs text-fg-muted truncate"
                title={localGame.title}
              >
                {localGame.title}
              </p>
            )}
          {formattedSize && (
            <p className="mt-0.5 text-xs text-fg-muted" title={formattedSize}>
              {formattedSize}
            </p>
          )}
        </div>
      </Link>
      {settingsOpen && (
        <GameSettings
          game={game}
          onClose={() => setSettingsOpen(false)}
          onGameUpdated={(updatedGame) => setLocalGame(updatedGame)}
          onUninstalled={onUninstalledCallback}
        />
      )}
      <VersionSelectDialog
        open={versionDialogOpen}
        gameTitle={localGame.metadata?.title || localGame.title || "Game"}
        versions={selectableVersions}
        onClose={() => {
          setVersionDialogOpen(false);
          setPendingDownloadAction(null);
          setSelectableVersions([]);
        }}
        onSelect={handleVersionSelect}
      />
    </>
  );
}

export default GameCard;
