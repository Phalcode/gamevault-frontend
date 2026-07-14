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
          "group flex flex-col overflow-hidden rounded-3xl border border-gv-line bg-[linear-gradient(180deg,var(--color-gv-panel-strong)_0%,var(--color-gv-panel)_100%)] shadow-(--shadow-card) focus:outline-none focus:ring-2 focus:ring-gv-accent-cool",
          "cursor-pointer transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-1 hover:border-gv-line-strong hover:shadow-(--shadow-shell)",
        )}
      >
        <div className="relative flex aspect-3/4 w-full items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,rgba(100,89,223,0.14),transparent_52%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0))]">
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
              className="h-full w-full object-contain rounded-none transition-transform duration-300 ease-out group-hover:scale-[1.02]"
              square
              alt={localGame.title}
            />
          ) : (
            <div className="text-xs text-gv-muted">No Cover</div>
          )}
          {/* Top-right bookmark toggle */}
          <button
            type="button"
            onClick={toggleBookmark}
            aria-label={bookmarked ? "Remove bookmark" : "Add bookmark"}
            aria-pressed={bookmarked}
            disabled={!currentUserId || bookmarkBusy}
            className={clsx(
              "absolute top-2 right-2 flex h-9 w-9 items-center justify-center rounded-xl border backdrop-blur-xl transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              bookmarked
                ? "border-gv-warning bg-gv-warning/15"
                : "border-gv-line bg-gv-panel-soft hover:border-gv-line-strong hover:bg-gv-panel",
            )}
          >
            {bookmarked ? (
              <StarSolid className="h-5 w-5 text-gv-warning" />
            ) : (
              <StarOutline className="h-5 w-5 text-gv-text" />
            )}
          </button>
          {/* Top-left settings button */}
          <button
            type="button"
            onClick={handleOpenSettings}
            aria-label="Settings"
            className="absolute top-2 left-2 flex h-9 w-9 items-center justify-center rounded-xl border border-gv-line bg-gv-panel-soft text-gv-text backdrop-blur-xl transition-colors hover:border-gv-line-strong hover:bg-gv-panel"
            title="Settings"
          >
            <Cog8ToothIcon className="h-5 w-5 text-current" />
          </button>
          {/* Bottom-right download/play actions */}
          <div className="absolute bottom-0 right-0 z-10 flex justify-end p-2 opacity-90">
            {isInstalled ? (
              <button
                type="button"
                aria-label="Play"
                onClick={handlePlayGame}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-400/40 bg-emerald-500/85 shadow-md shadow-black/20 backdrop-blur-sm transition-colors hover:bg-emerald-400"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-5 h-5 fill-white">
                  <path d="M8 17.175V6.825q0-.425.3-.713t.7-.287q.125 0 .263.037t.262.113l8.15 5.175q.225.15.338.375t.112.475t-.112.475t-.338.375l-8.15 5.175q-.125.075-.262.113T9 18.175q-.4 0-.7-.288t-.3-.712"/>
                </svg>
              </button>
            ) : isTauri ? (
              <Button
                color="zinc"
                aria-label="Download"
                className="flex h-9 items-center justify-center gap-1 border-gv-line-strong text-sm shadow-md shadow-black/20 backdrop-blur-sm"
                onClick={handleTauriDownload}
              >
                <CloudArrowDownIcon className="h-5 w-5 fill-current" />
              </Button>
            ) : (
              <Dropdown>
                <DropdownButton
                  as={Button}
                  color="zinc"
                  aria-label="Download"
                  className="flex h-9 items-center justify-center gap-1 border-gv-line-strong text-sm shadow-md shadow-black/20 backdrop-blur-sm"
                  onClick={(e: React.MouseEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  <CloudArrowDownIcon className="h-5 w-5 fill-current" />
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
        <div className="p-3 pt-2.5">
          <h3 className="truncate text-sm font-semibold tracking-[-0.02em] text-gv-text" title={localGame.title}>
            {localGame.metadata?.title || localGame.title}
          </h3>
          {(localGame as any).sort_title &&
            (localGame as any).sort_title !== localGame.title && (
              <p
                className="mt-1 truncate text-xs text-gv-muted"
                title={localGame.title}
              >
                {localGame.title}
              </p>
            )}
          {formattedSize && (
            <p className="mt-1 text-xs text-gv-accent-cool" title={formattedSize}>
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
