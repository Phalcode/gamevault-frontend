import { GamevaultGame } from "@/api/models/GamevaultGame";
import { Progress, ProgressStateEnum } from "@/api/models/Progress";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import { UserAvatar } from "@/components/UserAvatar";
import { Media } from "@/components/Media";
import MediaSlider from "@/components/MediaSlider";
import MarkdownContent from "@/components/MarkdownContent";
import { Spinner } from "@/components/Spinner";
import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { Button } from "@tw/button";
import { Listbox, ListboxOption, ListboxLabel } from "@tw/listbox";
import Card from "@/components/Card";
import { useDownloads } from "@/context/DownloadContext";
import { GameVersion } from "@/api/models/GameVersion";
import { VersionSelectDialog } from "@/components/VersionSelectDialog";
import { RootPathSelectDialog } from "@/components/RootPathSelectDialog";
import { getRootPaths } from "@/utils/rootPaths";
import {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  useLayoutEffect,
} from "react";
import { useParams, useNavigate } from "react-router";
import {
  CloudArrowDownIcon,
  Cog8ToothIcon,
  ShareIcon,
  StarIcon as StarSolid,
  WrenchScrewdriverIcon,
  BuildingOffice2Icon,
  ShieldCheckIcon,
} from "@heroicons/react/24/solid";
import {
  StarIcon as StarOutline,
  CalendarDaysIcon,
  GlobeAltIcon,
  HashtagIcon,
  ChevronLeftIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import {
  Dropdown,
  DropdownButton,
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
} from "@tw/dropdown";
import { Alert, AlertTitle } from "@tw/alert";
import { GameSettings } from "@/components/admin/GameSettings";
import { useAuthMediaUrl } from "@/hooks/useAuthMediaUrl";
import { isTauriApp } from "@/utils/tauri";
import { LayoutGroup, motion } from "motion/react";
import { EASE_OUT } from "@/lib/motion";

export default function GameView() {
  const { id } = useParams<{ id: string }>();
  const numericId = Number(id);
  const navigate = useNavigate();
  const { serverUrl, authFetch, user } = useAuth();
  const [game, setGame] = useState<GamevaultGame | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const { startDownload } = useDownloads() as any;
  const { showAlert } = useAlertDialog();
  const [progressState, setProgressState] = useState<
    keyof typeof ProgressStateEnum | null
  >(null);
  const [progressUpdating, setProgressUpdating] = useState(false);
  const insertedPlaceholderRef = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [versionDialogOpen, setVersionDialogOpen] = useState(false);
  const [pendingDownloadAction, setPendingDownloadAction] = useState<
    "direct" | "tauri" | "client" | null
  >(null);
  const [selectableVersions, setSelectableVersions] = useState<GameVersion[]>(
    [],
  );
  const [rootSelectOpen, setRootSelectOpen] = useState(false);
  const [pendingRootPath, setPendingRootPath] = useState<string | null>(null);
  const isTauri = isTauriApp();
  const { isOnline } = useOnlineStatus();
  const backgroundMediaId = game?.metadata?.background?.id;
  const { url: backgroundUrl } = useAuthMediaUrl(
    backgroundMediaId,
    game?.id ? { gameId: game.id, slot: "background" } : undefined,
  );

  useEffect(() => {
    if (!serverUrl || !numericId || Number.isNaN(numericId)) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const base = serverUrl.replace(/\/+$/, "");
        const res = await authFetch(`${base}/api/games/${numericId}`, {
          method: "GET",
        });
        if (!res.ok) throw new Error(`Failed to load game (${res.status})`);
        const json = await res.json();
        if (!cancelled) setGame(json);
      } catch (e: any) {
        // Offline fallback: try loading from local cache
        if (isTauriApp() && !isOnline) {
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            const cached = await invoke<string | null>("load_cached_game", {
              gameId: Number(numericId),
            });
            if (cached && !cancelled) {
              const json = JSON.parse(cached);
              setGame(json as GamevaultGame);
              return;
            }
          } catch {
            /* cache not available */
          }
        }
        if (!cancelled) setError(e?.message || "Failed to load game");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverUrl, authFetch, numericId, isOnline]);

  const coverId = game?.metadata?.cover?.id;
  const trailers = [
    ...(game?.metadata?.url_trailers || []),
    ...((game as any)?.metadata?.url_gameplays || []),
  ];
  const screenshots = game?.metadata?.url_screenshots || [];
  const title = game?.metadata?.title || game?.title;
  const description = game?.metadata?.description || null;
  const notes = (game as any)?.metadata?.notes || "";
  // Tags now sourced from metadata.tags (array of objects with name)
  const tags: string[] = ((game as any)?.metadata?.tags || [])
    .map((t: any) => t?.name)
    .filter((n: any) => typeof n === "string" && n.trim());
  const [detailsTab, setDetailsTab] = useState<
    "description" | "notes" | "tags"
  >("description");
  const mediaSliderRef = useRef<HTMLDivElement | null>(null);
  const detailsCardRef = useRef<HTMLDivElement | null>(null);
  const [mediaHeight, setMediaHeight] = useState<number | null>(null);
  const [detailsHeight, setDetailsHeight] = useState<number | null>(null);
  const [isXL, setIsXL] = useState<boolean>(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(min-width: 1280px)").matches
      : false,
  );

  const recomputeHeights = useCallback(() => {
    // Only sync heights on xl and above; on smaller screens allow natural height flow to avoid overlap
    const xl =
      typeof window !== "undefined"
        ? window.matchMedia("(min-width: 1280px)").matches
        : false;
    setIsXL(xl);
    if (xl) {
      if (mediaSliderRef.current)
        setMediaHeight(mediaSliderRef.current.offsetHeight);
      if (detailsCardRef.current)
        setDetailsHeight(detailsCardRef.current.offsetHeight);
    } else {
      setMediaHeight(null);
      setDetailsHeight(null);
    }
  }, []);

  useLayoutEffect(() => {
    recomputeHeights();
  }, [
    game,
    trailers.length,
    screenshots.length,
    description,
    notes,
    tags,
    detailsTab,
    recomputeHeights,
  ]);

  useEffect(() => {
    window.addEventListener("resize", recomputeHeights);
    // Initial measure
    recomputeHeights();
    return () => window.removeEventListener("resize", recomputeHeights);
  }, [recomputeHeights]);
  const rawGenres = (game as any)?.metadata?.genres || [];
  const genres: string[] = Array.isArray(rawGenres)
    ? rawGenres
        .map((g: any) => (typeof g === "string" ? g : g?.name))
        .filter((g: any) => typeof g === "string" && g.trim())
    : [];

  const currentUserId = (user as any)?.id ?? (user as any)?.ID;

  // Derive current user's progress among progresses
  const userProgress: Progress | null = useMemo(() => {
    if (!game || !Array.isArray((game as any).progresses) || !currentUserId)
      return null;
    return (
      (game as any).progresses.find(
        (p: any) => (p.user?.id ?? p.user?.ID) === currentUserId,
      ) || null
    );
  }, [game, currentUserId]);

  // Inject placeholder progress if none exists for the current user
  useEffect(() => {
    if (!game || !currentUserId || insertedPlaceholderRef.current) return;
    const progresses: Progress[] | undefined = (game as any).progresses;
    const exists =
      Array.isArray(progresses) &&
      progresses.some(
        (p) =>
          (p.user as any)?.id === currentUserId ||
          (p.user as any)?.ID === currentUserId,
      );
    if (!exists) {
      const placeholder: Progress = {
        id: -currentUserId, // temporary local id
        created_at: new Date(),
        updated_at: undefined,
        deleted_at: undefined,
        entity_version: 0,
        user: { id: currentUserId } as any,
        game: { id: game.id } as any,
        minutes_played: 0,
        state: ProgressStateEnum.unplayed,
        last_played_at: undefined,
      } as any;
      setGame((prev) =>
        prev
          ? {
              ...prev,
              progresses: [...((prev as any).progresses || []), placeholder],
            }
          : prev,
      );
      if (!progressState) setProgressState("unplayed");
      insertedPlaceholderRef.current = true;
    }
  }, [game, currentUserId, progressState]);

  useEffect(() => {
    if (userProgress?.state) {
      // Map to key form matching ProgressStateEnum keys
      const val = Object.entries(ProgressStateEnum).find(
        ([, v]) => v === userProgress.state,
      )?.[0] as keyof typeof ProgressStateEnum | undefined;
      if (val) setProgressState(val);
    }
  }, [userProgress]);

  // Bookmark detection
  useEffect(() => {
    if (!game || !currentUserId) return;
    const arr =
      (game as any).bookmarked_users || (game as any).bookmarkedUsers || [];
    setBookmarked(
      Array.isArray(arr) &&
        arr.some((u: any) => (u?.id ?? u?.ID) === currentUserId),
    );
  }, [game, currentUserId]);

  const toggleBookmark = useCallback(async () => {
    if (!serverUrl || !game || !currentUserId || bookmarkBusy) return;
    setBookmarkBusy(true);
    const base = serverUrl.replace(/\/+$/, "");
    const next = !bookmarked;
    setBookmarked(next);
    try {
      const url = `${base}/api/users/me/bookmark/${game.id}`;
      const res = await authFetch(url, { method: next ? "POST" : "DELETE" });
      if (!res.ok) throw new Error("Bookmark toggle failed");
    } catch {
      setBookmarked(!next);
    } finally {
      setBookmarkBusy(false);
    }
  }, [serverUrl, game, currentUserId, bookmarked, authFetch, bookmarkBusy]);

  const handleShare = useCallback(() => {
    try {
      navigator.clipboard.writeText(window.location.href);
    } catch {}
    // Show global alert notification
    showAlert({
      title: "Link copied",
    });
  }, [showAlert]);

  const resolveVersions = useCallback(async (): Promise<GameVersion[]> => {
    if (game && Array.isArray(game.versions) && game.versions.length > 0) {
      return game.versions;
    }
    if (!serverUrl || !numericId || Number.isNaN(numericId)) return [];
    const base = serverUrl.replace(/\/+$/, "");
    const res = await authFetch(`${base}/api/games/${numericId}`, {
      method: "GET",
    });
    if (!res.ok) return [];
    const fullGame = (await res.json()) as GamevaultGame;
    const fullVersions = Array.isArray(fullGame.versions)
      ? fullGame.versions
      : [];
    if (fullVersions.length > 0) {
      setGame((prev) => (prev ? { ...prev, versions: fullVersions } : prev));
    }
    return fullVersions;
  }, [game, serverUrl, numericId, authFetch]);

  const executeDownloadAction = useCallback(
    (
      action: "direct" | "tauri" | "client",
      selectedVersion: GameVersion,
      rootPath?: string,
    ) => {
      if (!game) return;
      const resolvedTitle = title || game.title;
      const filePathFallback = selectedVersion.file_path
        ? selectedVersion.file_path.split(/[/\\]/).pop()
        : undefined;
      const selectedFilename =
        filePathFallback && filePathFallback.trim().length > 0
          ? filePathFallback
          : `${resolvedTitle}.zip`;

      if (action === "client") {
        window.location.href = `gamevault://install?gameid=${game.id}&versionid=${selectedVersion.id}`;
        return;
      }

      startDownload({
        gameId: game.id,
        versionId: selectedVersion.id,
        versionName: selectedVersion.version,
        gameTitle: resolvedTitle,
        gameMetadata: game.metadata,
        gameType: (selectedVersion.type || game.type) as any,
        filename: selectedFilename,
        downloadRootPath: rootPath,
      });

      showAlert({
        title: `Added ${resolvedTitle} to the download queue`,
      });
    },
    [game, title, startDownload, showAlert],
  );

  const selectVersionAndRun = useCallback(
    async (action: "direct" | "tauri" | "client", rootPath?: string) => {
      const versions = await resolveVersions();

      if (!versions.length) {
        showAlert({
          title: "No downloadable version found",
          description:
            "This game currently has no available version to download.",
        });
        return;
      }

      if (versions.length === 1) {
        executeDownloadAction(action, versions[0], rootPath);
        return;
      }

      setSelectableVersions(versions);
      setPendingDownloadAction(action);
      setPendingRootPath(rootPath ?? null);
      setVersionDialogOpen(true);
    },
    [resolveVersions, showAlert, executeDownloadAction],
  );

  const handleDirectDownload = useCallback(() => {
    if (!game) return;
    void selectVersionAndRun("direct");
  }, [game, selectVersionAndRun]);

  const handleTauriDownload = useCallback(async () => {
    if (!game) return;

    try {
      const rootPaths = getRootPaths();
      if (rootPaths.length === 0) {
        alert("Please configure a download location in Settings first.");
        return;
      }

      if (rootPaths.length === 1) {
        await selectVersionAndRun("tauri", rootPaths[0].path);
        return;
      }

      // Multiple roots — show selection dialog
      setRootSelectOpen(true);
    } catch (error) {
      console.error("Error starting Tauri download:", error);
    }
  }, [game, selectVersionAndRun]);

  const handleRootPathSelect = useCallback(
    (rootPath: string) => {
      setRootSelectOpen(false);
      void selectVersionAndRun("tauri", rootPath);
    },
    [selectVersionAndRun],
  );

  const handleGoToSettingsFromRootSelect = useCallback(() => {
    setRootSelectOpen(false);
    navigate("/settings");
  }, [navigate]);

  const handleClientDownload = useCallback(() => {
    if (!game) return;
    void selectVersionAndRun("client");
  }, [game, selectVersionAndRun]);

  const handleVersionSelect = useCallback(
    (selectedVersion: GameVersion) => {
      if (!pendingDownloadAction) return;
      executeDownloadAction(
        pendingDownloadAction,
        selectedVersion,
        pendingRootPath ?? undefined,
      );
      setVersionDialogOpen(false);
      setPendingDownloadAction(null);
      setPendingRootPath(null);
      setSelectableVersions([]);
    },
    [pendingDownloadAction, pendingRootPath, executeDownloadAction],
  );

  const PROGRESS_LABEL: Record<string, string> = {
    UNPLAYED: "Unplayed",
    INFINITE: "Infinite",
    PLAYING: "Playing",
    COMPLETED: "Completed",
    ABORTED_TEMPORARY: "Temporarily Aborted",
    ABORTED_PERMANENT: "Permanently Aborted",
  };

  const progressStateOptions = Object.entries(ProgressStateEnum).map(
    ([k, v]) => ({ key: k, value: v, label: PROGRESS_LABEL[v] || v }),
  );

  const updateProgressState = useCallback(
    async (nextKey: string) => {
      if (!serverUrl || !game || !currentUserId) return;
      const enumVal = (ProgressStateEnum as any)[nextKey];
      if (!enumVal) return;
      setProgressUpdating(true);
      const base = serverUrl.replace(/\/+$/, "");
      try {
        const payload = { state: enumVal };
        const res = await authFetch(
          `${base}/api/progresses/user/${currentUserId}/game/${game.id}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(payload),
          },
        );
        if (res.ok) {
          // Refresh game data to reflect progress changes
          const updated = await res.json().catch(() => null);
          if (updated && updated.state) {
            // mutate local userProgress optimistic
            setProgressState(nextKey as any);
          }
        }
      } finally {
        setProgressUpdating(false);
      }
    },
    [serverUrl, game, currentUserId, authFetch],
  );

  const playtimeMinutes = userProgress?.minutes_played || 0;
  const playtimeHours = playtimeMinutes / 60;
  const lastPlayed = userProgress?.last_played_at
    ? new Date(userProgress.last_played_at).toLocaleString()
    : "—";
  const avgPlaytime =
    game?.metadata?.average_playtime ||
    (game as any)?.metadata?.average_playtime ||
    null;
  const floatingIconButtonClassName =
    "size-11 p-0 flex items-center justify-center border-white/35 bg-white/60 shadow-sm backdrop-blur-md hover:bg-white/78 dark:border-white/20 dark:bg-gv-panel/80 dark:hover:bg-gv-panel-strong";

  const gameSizeBytes = useMemo(() => {
    const sizeStr =
      (game as any)?.size ??
      (Array.isArray(game?.versions) ? game.versions[0]?.size : undefined);
    if (sizeStr === undefined || sizeStr === null) return null;
    const n = Number(sizeStr);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [game]);

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB", "PB"];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    return `${value.toFixed(value < 10 ? 2 : value < 100 ? 1 : 0)} ${units[unitIndex]}`;
  };

  const formattedSize = useMemo(
    () => (gameSizeBytes !== null ? formatBytes(gameSizeBytes) : null),
    [gameSizeBytes],
  );

  const glassPanelClassName =
    "border border-white/35 bg-white/[0.42] backdrop-blur-md dark:border-white/10 dark:bg-gv-panel/80 dark:backdrop-blur-md";
  const darkGlassInsetClassName =
    "dark:border dark:border-white/10 dark:bg-gv-panel/80 dark:backdrop-blur-md";
  const progressSelectClassName = clsx(
    "rounded-lg before:bg-white/60 before:backdrop-blur-md before:shadow-sm",
    "dark:before:hidden",
    darkGlassInsetClassName,
  );

  // Derive additional metadata fields
  const releaseYear = game?.release_date
    ? new Date(game.release_date).getFullYear()
    : (game as any)?.metadata?.release_year || null;
  const versionTag = game?.version || (game as any)?.metadata?.version || null;
  const websites: string[] = (game as any)?.metadata?.url_websites || [];
  const primaryWebsite = websites.length > 0 ? websites[0] : null;
  const devNames: string[] = ((game as any)?.metadata?.developers || [])
    .map((d: any) => d?.name || d)
    .filter(Boolean);
  const publisherNames: string[] = ((game as any)?.metadata?.publishers || [])
    .map((p: any) => p?.name || p)
    .filter(Boolean);
  const ageRating = (game as any)?.metadata?.age_rating ?? null;
  let rating = (game as any)?.metadata?.rating ?? null; // numeric rating
  const formattedRating =
    typeof rating === "number"
      ? (() => {
          const val =
            rating <= 1 ? Math.round(rating * 100) : Math.round(rating);
          return `${val}%`;
        })()
      : null;
  const backgroundMaskImage =
    "linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)";

  // Removed h-full overflow-auto to prevent nested scroll area causing double vertical scrollbar; letting parent layout manage vertical scrolling.

  return (
    <div className="relative isolate flex min-h-full flex-col overflow-hidden px-4 pb-4 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-y-0 left-1/2 z-0 w-screen -translate-x-1/2 animate-[media-fade-in_0.25s_ease-out] motion-reduce:animate-none">
        <div className="absolute inset-0 bg-gv-bg" />

        {backgroundUrl ? (
          <>
            <div
              className="absolute inset-0 opacity-30"
              style={{
                backgroundImage: `url(${backgroundUrl})`,
                backgroundPosition: "center center",
                backgroundRepeat: "no-repeat",
                backgroundSize: "cover",
                WebkitMaskImage: backgroundMaskImage,
                maskImage: backgroundMaskImage,
                WebkitMaskComposite: "source-in",
              }}
            />
            <div
              className="absolute inset-[-6%] opacity-32 blur-3xl"
              style={{
                backgroundImage: `url(${backgroundUrl})`,
                backgroundPosition: "center center",
                backgroundRepeat: "no-repeat",
                backgroundSize: "cover",
                WebkitMaskImage: backgroundMaskImage,
                maskImage: backgroundMaskImage,
                WebkitMaskComposite: "source-in",
              }}
            />
          </>
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(99,102,241,0.14),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0.02)_38%,rgba(255,255,255,0)_100%)] dark:bg-[radial-gradient(circle_at_50%_0%,rgba(99,102,241,0.18),transparent_42%),linear-gradient(180deg,rgba(24,24,27,0.24)_0%,rgba(24,24,27,0.1)_36%,rgba(24,24,27,0)_100%)]" />
        )}

        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.09),transparent_40%)] dark:bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.04),transparent_40%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.14)_0%,rgba(255,255,255,0.06)_18%,rgba(255,255,255,0)_42%,rgba(255,255,255,0)_100%)] dark:bg-[linear-gradient(180deg,rgba(9,9,11,0.16)_0%,rgba(9,9,11,0.08)_18%,rgba(9,9,11,0)_42%,rgba(9,9,11,0)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(244,244,245,0.12)_0%,rgba(244,244,245,0.04)_24%,rgba(244,244,245,0)_45%,rgba(99,102,241,0.03)_100%)] dark:bg-[linear-gradient(135deg,rgba(24,24,27,0.12)_0%,rgba(24,24,27,0.05)_24%,rgba(24,24,27,0)_45%,rgba(99,102,241,0.05)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-white/10 to-transparent dark:from-gv-panel/10 dark:to-transparent sm:h-20 xl:h-24" />
      </div>

      <div className="relative z-10 flex w-full flex-1 flex-col">
        {/* Back button — always visible so users can leave at any state */}
        <div className="px-2 pt-4 pb-1">
          <button
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="group flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm/5 text-gv-muted transition-colors hover:text-gv-text"
          >
            <ChevronLeftIcon className="size-4 shrink-0 transition-transform group-hover:-translate-x-0.5" />
            Back
          </button>
        </div>
        {loading && (
          <div className="flex flex-1 items-center justify-center py-20">
            <Spinner label="Loading game…" />
          </div>
        )}
        {error && (
          <div className="p-6 text-sm text-red-500 bg-red-500/10 rounded-md max-w-xl">
            {error}
          </div>
        )}
        {!loading && !error && game && (
          <div className="mx-auto grid w-full max-w-350 gap-10 px-2 pt-4 xl:grid-cols-[1fr_20rem]">
            {/* Row 1: Cover/Title/Actions spans both columns on mobile but only left column on xl */}
            <div className="flex flex-row gap-4 items-start xl:col-span-1 xl:row-span-1 min-w-0">
              <div className="w-32 aspect-3/4 rounded-2xl overflow-hidden bg-gv-panel-strong flex items-center justify-center text-[10px] text-gv-muted">
                {coverId ? (
                  <Media
                    media={game.metadata?.cover}
                    size={180}
                    className="w-full h-full object-contain"
                    square
                    alt={title}
                    gameId={game.id}
                    mediaSlot="cover"
                    fallback={
                      <CoverPlaceholder
                        title={title || game.title || "Game"}
                        size="large"
                        className="h-full w-full"
                      />
                    }
                  />
                ) : (
                  <CoverPlaceholder
                    title={title || game.title || "Game"}
                    size="large"
                    className="h-full w-full"
                  />
                )}
              </div>
              <div className="flex-1 min-w-0 flex flex-col gap-3">
                <div className="text-xl font-semibold leading-tight truncate pr-2">
                  {title}
                </div>
                {/* Added flex-wrap to allow buttons to wrap on extremely narrow viewports, preventing horizontal overflow that could push the media slider and cause cutoff */}
                <div className="flex flex-row flex-wrap gap-2">
                  {isTauri ? (
                    <Button
                      color="indigo"
                      aria-label={`Download${formattedSize ? ` (${formattedSize})` : ""}`}
                      className="h-9 px-3 gap-2 flex items-center justify-center"
                      title={`Download${formattedSize ? ` (${formattedSize})` : ""}`}
                      onClick={handleTauriDownload}
                      disabled={isTauri && !isOnline}
                    >
                      <CloudArrowDownIcon className="w-5 h-5 shrink-0" />
                      {formattedSize && (
                        <span className="text-xs font-medium whitespace-nowrap">
                          {formattedSize}
                        </span>
                      )}
                    </Button>
                  ) : (
                    <Dropdown>
                      <DropdownButton
                        as={Button}
                        color="indigo"
                        aria-label={`Download${formattedSize ? ` (${formattedSize})` : ""}`}
                        className="h-9 px-3 gap-2 flex items-center justify-center"
                        title={`Download${formattedSize ? ` (${formattedSize})` : ""}`}
                        disabled={isTauri && !isOnline}
                        onClick={(e: React.MouseEvent) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                      >
                        <CloudArrowDownIcon className="w-5 h-5 shrink-0" />
                        {formattedSize && (
                          <span className="text-xs font-medium whitespace-nowrap">
                            {formattedSize}
                          </span>
                        )}
                      </DropdownButton>
                      <DropdownMenu className="min-w-48" anchor="bottom start">
                        <DropdownItem onClick={handleDirectDownload}>
                          <DropdownLabel>Direct Download</DropdownLabel>
                        </DropdownItem>
                        <DropdownItem onClick={handleClientDownload}>
                          <DropdownLabel>
                            Download via GameVault Client
                          </DropdownLabel>
                        </DropdownItem>
                      </DropdownMenu>
                    </Dropdown>
                  )}
                  <Button
                    outline
                    onClick={() => setSettingsOpen(true)}
                    className={floatingIconButtonClassName}
                    title="Settings"
                  >
                    <Cog8ToothIcon className="w-5 h-5" />
                  </Button>
                  <Button
                    outline
                    onClick={toggleBookmark}
                    disabled={!user || bookmarkBusy || (isTauri && !isOnline)}
                    className={clsx(
                      bookmarked
                        ? "size-11 p-0 flex items-center justify-center bg-yellow-400/20! border-yellow-400! text-yellow-400! backdrop-blur-md shadow-sm dark:bg-yellow-400/20! dark:border-yellow-400! dark:text-yellow-400!"
                        : floatingIconButtonClassName,
                    )}
                    title={bookmarked ? "Remove bookmark" : "Add bookmark"}
                    aria-pressed={bookmarked}
                  >
                    {bookmarked ? (
                      <StarSolid className="w-5 h-5" />
                    ) : (
                      <StarOutline className="w-5 h-5" />
                    )}
                  </Button>
                  <Button
                    outline
                    onClick={handleShare}
                    className={floatingIconButtonClassName}
                    title="Copy link"
                  >
                    <ShareIcon className="w-5 h-5" />
                  </Button>
                </div>
                {(genres && genres.length > 0) ||
                game?.type ||
                game?.early_access ||
                (game as any)?.metadata?.early_access ? (
                  <div className="flex flex-wrap gap-1 pt-1 items-center">
                    {game?.type && game.type !== "UNDETECTABLE" && (
                      <span className="px-2 py-0.5 rounded-full bg-gv-accent/15 text-gv-accent-strong text-[10px] font-medium">
                        {game.type
                          .replace(/_/g, " ")
                          .toLowerCase()
                          .replace(/\b\w/g, (c) => c.toUpperCase())}
                      </span>
                    )}
                    {(game as any)?.early_access ||
                    (game as any)?.metadata?.early_access ? (
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-300 text-[10px] font-medium">
                        Early Access
                      </span>
                    ) : null}
                    {genres.map((g: string) => (
                      <span
                        key={g}
                        className="px-2 py-0.5 rounded-full bg-gv-panel-strong text-[10px] font-medium text-gv-muted"
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            {/* Spacer so grid second column first row stays empty - ensures metadata card aligns with media slider start */}
            {/* Right Column Row 1: Stats + Progress State */}
            <div className="flex flex-col gap-6 xl:col-start-2 xl:row-start-1 min-w-0">
              <div className="grid grid-cols-3 gap-2 text-center text-xs animate-[panel-in_0.18s_ease-out] motion-reduce:animate-none">
                <div className="surface-panel rounded-2xl p-3">
                  <div className="text-[10px] uppercase tracking-wide text-gv-muted">
                    Playtime
                  </div>
                  <div className="font-semibold text-sm mt-1 text-gv-text">
                    {playtimeHours >= 1
                      ? `${playtimeHours.toFixed(playtimeHours < 10 ? 1 : 0)} h`
                      : `${playtimeMinutes} m`}
                  </div>
                </div>
                <div className="surface-panel rounded-2xl p-3">
                  <div className="text-[10px] uppercase tracking-wide text-gv-muted">
                    Last Played
                  </div>
                  <div
                    className="font-semibold text-sm mt-1 text-gv-text truncate"
                    title={lastPlayed}
                  >
                    {lastPlayed}
                  </div>
                </div>
                <div className="surface-panel rounded-2xl p-3">
                  <div className="text-[10px] uppercase tracking-wide text-gv-muted">
                    Avg Playtime
                  </div>
                  <div className="font-semibold text-sm mt-1 text-gv-text">
                    {avgPlaytime
                      ? `${(avgPlaytime / 60).toFixed(avgPlaytime / 60 < 10 ? 1 : 0)} h`
                      : "—"}
                  </div>
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-gv-muted mb-1">
                  Progress State
                </div>
                <Listbox
                  name="progressState"
                  value={progressState || "UNPLAYED"}
                  onChange={(v: any) => updateProgressState(v)}
                  disabled={!user || progressUpdating || (isTauri && !isOnline)}
                  className={progressSelectClassName}
                >
                  {progressStateOptions.map((o) => (
                    <ListboxOption key={o.key} value={o.key}>
                      <ListboxLabel>{o.label}</ListboxLabel>
                    </ListboxOption>
                  ))}
                </Listbox>
              </div>
            </div>

            {/* Row 2 Left: Media Slider + Details */}
            {/* min-w-0 ensures the slider can shrink below intrinsic content width inside CSS grid to avoid right-side cutoff on very small screens */}
            <div className="flex flex-col gap-6 xl:col-start-1 xl:row-start-2 min-w-0">
              {(trailers.length > 0 || screenshots.length > 0) && (
                <div className="w-full min-w-0" ref={mediaSliderRef}>
                  <MediaSlider
                    trailers={trailers}
                    screenshots={screenshots}
                    autoPlay={true}
                    loop={false}
                    className="w-full"
                    aspect="aspect-[16/9]"
                  />
                </div>
              )}
              <div ref={detailsCardRef} className="contents">
                <Card
                  title="Details"
                  className="mb-0!"
                  surfaceClassName="surface-panel"
                >
                  <LayoutGroup id="details-tabs">
                    <div className="flex border-b border-gv-line mb-4 gap-6 text-sm">
                      <button
                        onClick={() => setDetailsTab("description")}
                        className={clsx(
                          "relative pb-2 -mb-px border-b-2 font-medium",
                          detailsTab === "description"
                            ? "border-transparent text-gv-accent-strong"
                            : "border-transparent text-gv-muted hover:text-gv-text",
                        )}
                      >
                        Description
                        {detailsTab === "description" && (
                          <motion.span
                            layoutId="details-tab-underline"
                            className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-gv-accent"
                            transition={{ duration: 0.18, ease: EASE_OUT }}
                          />
                        )}
                      </button>
                      <button
                        onClick={() => setDetailsTab("notes")}
                        className={clsx(
                          "relative pb-2 -mb-px border-b-2 font-medium",
                          detailsTab === "notes"
                            ? "border-transparent text-gv-accent-strong"
                            : "border-transparent text-gv-muted hover:text-gv-text",
                        )}
                      >
                        Notes
                        {detailsTab === "notes" && (
                          <motion.span
                            layoutId="details-tab-underline"
                            className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-gv-accent"
                            transition={{ duration: 0.18, ease: EASE_OUT }}
                          />
                        )}
                      </button>
                      <button
                        onClick={() => setDetailsTab("tags")}
                        className={clsx(
                          "relative pb-2 -mb-px border-b-2 font-medium",
                          detailsTab === "tags"
                            ? "border-transparent text-gv-accent-strong"
                            : "border-transparent text-gv-muted hover:text-gv-text",
                        )}
                      >
                        Tags
                        {detailsTab === "tags" && (
                          <motion.span
                            layoutId="details-tab-underline"
                            className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-gv-accent"
                            transition={{ duration: 0.18, ease: EASE_OUT }}
                          />
                        )}
                      </button>
                    </div>
                  </LayoutGroup>
                  <motion.div
                    key={detailsTab}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.12, ease: EASE_OUT }}
                    className="text-sm leading-relaxed space-y-4 min-h-45 text-gv-text"
                  >
                    {detailsTab === "description" &&
                      (description ? (
                        <MarkdownContent content={description} />
                      ) : (
                        <p className="italic text-gv-muted">
                          No description available.
                        </p>
                      ))}
                    {detailsTab === "notes" &&
                      (notes ? (
                        <MarkdownContent content={notes} />
                      ) : (
                        <p className="italic text-gv-muted">No notes.</p>
                      ))}
                    {detailsTab === "tags" &&
                      (tags && tags.length ? (
                        <div className="flex flex-wrap gap-2">
                          {tags.map((t) => (
                            <span
                              key={t}
                              className="px-2 py-1 rounded-md bg-gv-panel-strong text-xs font-medium text-gv-muted"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="italic text-gv-muted">No tags.</p>
                      ))}
                  </motion.div>
                </Card>
              </div>
            </div>

            {/* Row 2 Right: Additional Metadata + Activity */}
            <div className="flex flex-col gap-6 xl:col-start-2 xl:row-start-2 min-w-0">
              <Card
                title="Additional Metadata"
                className="min-h-40"
                surfaceClassName="surface-panel"
              >
                <ul className="space-y-4 text-sm text-gv-text">
                  <li className="flex items-start gap-3">
                    <CalendarDaysIcon className="w-5 h-5 mt-0.5 text-gv-muted" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] uppercase tracking-wide text-gv-muted whitespace-nowrap">
                        Release Year
                      </div>
                      <div
                        className="font-medium whitespace-nowrap truncate"
                        title={(releaseYear || "—") + ""}
                      >
                        {releaseYear || "—"}
                      </div>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <StarOutline className="w-5 h-5 mt-0.5 text-gv-muted" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] uppercase tracking-wide text-gv-muted whitespace-nowrap">
                        Rating
                      </div>
                      <div
                        className="font-medium whitespace-nowrap"
                        title={formattedRating || "—"}
                      >
                        {formattedRating ?? "—"}
                      </div>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <HashtagIcon className="w-5 h-5 mt-0.5 text-gv-muted" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] uppercase tracking-wide text-gv-muted whitespace-nowrap">
                        Version
                      </div>
                      <div
                        className="font-medium whitespace-nowrap truncate"
                        title={versionTag || "—"}
                      >
                        {versionTag || "—"}
                      </div>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <GlobeAltIcon className="w-5 h-5 mt-0.5 text-gv-muted" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] uppercase tracking-wide text-gv-muted whitespace-nowrap">
                        Website
                      </div>
                      <div
                        className="font-medium whitespace-nowrap truncate"
                        title={primaryWebsite || "—"}
                      >
                        {primaryWebsite ? (
                          <a
                            href={primaryWebsite}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:text-gv-accent-cool"
                          >
                            {primaryWebsite.replace(/^https?:\/\//, "")}
                          </a>
                        ) : (
                          "—"
                        )}
                      </div>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <WrenchScrewdriverIcon className="w-5 h-5 mt-0.5 text-gv-muted" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] uppercase tracking-wide text-gv-muted whitespace-nowrap">
                        Developer{devNames.length > 1 ? "s" : ""}
                      </div>
                      <div
                        className="font-medium whitespace-nowrap truncate"
                        title={devNames.length ? devNames.join(", ") : "—"}
                      >
                        {devNames.length ? devNames.join(", ") : "—"}
                      </div>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <BuildingOffice2Icon className="w-5 h-5 mt-0.5 text-gv-muted" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] uppercase tracking-wide text-gv-muted whitespace-nowrap">
                        Publisher{publisherNames.length > 1 ? "s" : ""}
                      </div>
                      <div
                        className="font-medium whitespace-nowrap truncate"
                        title={
                          publisherNames.length
                            ? publisherNames.join(", ")
                            : "—"
                        }
                      >
                        {publisherNames.length
                          ? publisherNames.join(", ")
                          : "—"}
                      </div>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <ShieldCheckIcon className="w-5 h-5 mt-0.5 text-gv-muted" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] uppercase tracking-wide text-gv-muted whitespace-nowrap">
                        Age Rating
                      </div>
                      <div
                        className="font-medium whitespace-nowrap"
                        title={ageRating ?? "—"}
                      >
                        {ageRating ?? "—"}
                      </div>
                    </div>
                  </li>
                </ul>
              </Card>
              <Card
                title="Activity"
                className="min-h-40"
                surfaceClassName="surface-panel"
              >
                {(() => {
                  const progresses: Progress[] =
                    (game as any)?.progresses || [];
                  // Exclude placeholder negative IDs and optionally current user (we show others)
                  const others = progresses.filter(
                    (p) =>
                      p.id > 0 &&
                      (p.user?.id ?? (p.user as any)?.ID) !== currentUserId,
                  );
                  if (!others.length) {
                    return (
                      <div className="text-xs text-gv-muted italic">
                        No activity from other users.
                      </div>
                    );
                  }
                  const formatState = (s: string) =>
                    s
                      .replace(/_/g, " ")
                      .toLowerCase()
                      .replace(/\b\w/g, (c) => c.toUpperCase());
                  return (
                    <ul className="flex flex-col gap-3 text-sm">
                      {others.map((p) => {
                        const uid = p.user?.id ?? (p.user as any)?.ID;
                        const uname =
                          (p.user as any)?.username || `User #${uid}`;
                        const avatarMedia = (p.user as any)?.avatar;
                        const lastPlayedStr = p.last_played_at
                          ? new Date(p.last_played_at).toLocaleDateString()
                          : "—";
                        const minutes = p.minutes_played || 0;
                        const hours = minutes / 60;
                        return (
                          <li key={p.id} className="flex items-center gap-3">
                            <UserAvatar
                              media={avatarMedia}
                              size={32}
                              alt={uname}
                              fallback={
                                <div className="flex h-full w-full items-center justify-center rounded-[20%] bg-gv-panel-soft text-[10px] font-semibold text-gv-text">
                                  {uname.slice(0, 2).toUpperCase()}
                                </div>
                              }
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium truncate text-gv-text">
                                  {uname}
                                </span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gv-panel-soft text-gv-muted font-medium">
                                  {formatState(p.state)}
                                </span>
                              </div>
                              <div className="text-[11px] text-gv-muted mt-0.5 flex items-center justify-between gap-4">
                                <span className="truncate">
                                  Played:{" "}
                                  {hours >= 1
                                    ? `${hours.toFixed(hours < 10 ? 1 : 0)} h`
                                    : `${minutes} m`}
                                </span>
                                <span className="shrink-0 text-right">
                                  Last: {lastPlayedStr}
                                </span>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  );
                })()}
              </Card>
            </div>
          </div>
        )}

        {/* Game Settings Modal */}
        {settingsOpen && game && (
          <GameSettings
            game={game}
            onClose={() => setSettingsOpen(false)}
            onGameUpdated={(updatedGame) => setGame(updatedGame)}
          />
        )}
        <RootPathSelectDialog
          open={rootSelectOpen}
          gameTitle={title || game?.title || "Game"}
          rootPaths={(() => {
            try {
              return getRootPaths();
            } catch {
              return [];
            }
          })()}
          onSelect={handleRootPathSelect}
          onClose={() => setRootSelectOpen(false)}
          onGoToSettings={handleGoToSettingsFromRootSelect}
        />
        <VersionSelectDialog
          open={versionDialogOpen}
          gameTitle={title || game?.title || "Game"}
          versions={selectableVersions}
          onClose={() => {
            setVersionDialogOpen(false);
            setPendingDownloadAction(null);
            setPendingRootPath(null);
            setSelectableVersions([]);
          }}
          onSelect={handleVersionSelect}
        />
      </div>
    </div>
  );
}
