import { Button } from "@/components/tailwind/button";
import { Dialog, DialogBody, DialogTitle } from "@/components/tailwind/dialog";
import { Input } from "@/components/tailwind/input";
import { Text } from "@/components/tailwind/text";
import {
  Listbox,
  ListboxOption,
  ListboxLabel,
} from "@/components/tailwind/listbox";
import {
  GamevaultGame,
  GamevaultGameTypeEnum,
} from "@/api/models/GamevaultGame";
import { UpdateGameDto } from "@/api/models/UpdateGameDto";
import { MetadataProviderDto } from "@/api/models/MetadataProviderDto";
import { GameMetadata } from "@/api/models/GameMetadata";
import { MapGameDto } from "@/api/models/MapGameDto";
import type { GameVaultConfig } from "@/models/gamevaultconfig";
import { useAuth } from "@/context/AuthContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useUmu, type UmuStatusInfo } from "@/context/UmuContext";
import { isWindowsExecutablePath } from "@/components/downloads/install-utils";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { isTauriApp } from "@/utils/tauri";
import { formatDate, formatYear } from "@/utils/date";
import {
  applyDroppedSources,
  isProbablyImageUrl,
  extractImageCandidatesFromDataTransfer,
  pickBestImageUrl,
} from "@/utils/droppedImage";
import { useOnlineStatus } from "@/context/OfflineContext";
import { emitGameUpdated } from "@/utils/gameUpdates";
import {
  GameMediaSlot,
  resolveApiMediaBlob,
} from "@/utils/mediaCache";
import {
  PhotoIcon,
  CircleStackIcon,
  PencilIcon,
  MagnifyingGlassIcon,
  SparklesIcon,
  ArrowUturnLeftIcon,
  ArrowPathIcon,
  FolderOpenIcon,
  LinkSlashIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { PaintBrushIcon } from "@heroicons/react/16/solid";
import { Switch, SwitchField } from "../tailwind/switch";
import { Label } from "../tailwind/fieldset";

interface Props {
  game: GamevaultGame;
  onClose: () => void;
  onGameUpdated?: (g: GamevaultGame) => void;
  onUninstalled?: () => void;
}

// No cool object binding in react, so we manually pick fields for custom metadata. But at least this is type save
type CustomMetadataForm = {
  [K in keyof Pick<
    GameMetadata,
    | "title"
    | "description"
    | "notes"
    | "average_playtime"
    | "age_rating"
    | "release_date"
    | "rating"
    | "early_access"
    | "launch_executable"
    | "launch_parameters"
    | "installer_executable"
    | "installer_parameters"
    | "uninstaller_executable"
    | "uninstaller_parameters"
    | "url_websites"
    | "url_trailers"
    | "url_gameplays"
    | "url_screenshots"
  >]: string;
} & {
  sort_title: string;
  genres: string;
  tags: string;
  publishers: string;
  developers: string;
};

type InstalledGameInfo = {
  gameId: number;
  gameTitle: string;
  gameType?: string;
  versionId: number;
  versionName: string;
  installationDirectory: string;
  versionDirectory: string;
};

import { getRootPaths } from "@/utils/rootPaths";
import { useDiskUsage } from "@/hooks/useDiskUsage";
import DiskUsageChart from "@/components/DiskUsageChart";

function isSetupInstallType(gameType?: string) {
  return gameType === GamevaultGameTypeEnum.windows_setup;
}

function isPortableInstallType(gameType?: string) {
  return (
    gameType === GamevaultGameTypeEnum.windows_portable ||
    gameType === GamevaultGameTypeEnum.linux_portable ||
    gameType === GamevaultGameTypeEnum.windows_software ||
    gameType === GamevaultGameTypeEnum.linux_software
  );
}

/**
 * Removes now-empty per-version and per-game folders after an uninstall,
 * walking up from the version directory to the configured root location.
 */
async function pruneEmptyVersionFolders(versionDirectory: string) {
  if (!versionDirectory) return;
  for (const root of getRootPaths()) {
    const rootPath = root.path;
    if (
      rootPath &&
      (versionDirectory === rootPath ||
        versionDirectory.startsWith(`${rootPath}/`) ||
        versionDirectory.startsWith(`${rootPath}\\`))
    ) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("remove_empty_directories", {
          path: versionDirectory,
          stopAt: rootPath,
        });
      } catch {
        // Best-effort cleanup; never block the uninstall.
      }
      return;
    }
  }
}

interface ImageState {
  file: File | null;
  via: "none" | "file" | "url" | "paste" | "drag";
  preview: string | null;
  urlInput: string;
  original: string | null;
  loadedId?: number | null;
}

type TabKey =
  | "images"
  | "metadata"
  | "custom-metadata"
  | "installation"
  | "launch-options";

export function GameSettings({ game, onClose, onGameUpdated, onUninstalled }: Props) {
  const { serverUrl, authFetch } = useAuth() as any;
  const { showAlert } = useAlertDialog();
  const [activeTab, setActiveTab] = useState<TabKey>("images");
  const [saving, setSaving] = useState(false);
  const [fullGame, setFullGame] = useState<GamevaultGame | null>(null);
  const [loadingFullGame, setLoadingFullGame] = useState(true);
  const [installedGame, setInstalledGame] = useState<InstalledGameInfo | null>(
    null,
  );
  const [uninstalling, setUninstalling] = useState(false);
  const isTauri = isTauriApp();
  const { isOnline } = useOnlineStatus();

  // Image state & logic
  const [coverImg, setCoverImg] = useState<ImageState>({
    file: null,
    via: "none",
    preview: null,
    urlInput: "",
    original: null,
    loadedId: undefined,
  });
  const [bgImg, setBgImg] = useState<ImageState>({
    file: null,
    via: "none",
    preview: null,
    urlInput: "",
    original: null,
    loadedId: undefined,
  });
  const [savingImages, setSavingImages] = useState(false);
  const [imagesMsg, setImagesMsg] = useState<string | null>(null);
  const revokeRef = useRef<string[]>([]);
  const dragTargetRef = useRef<"cover" | "bg" | null>(null);
  const nativeDragHandledRef = useRef(false);
  const coverZoneRef = useRef<HTMLDivElement | null>(null);
  const bgZoneRef = useRef<HTMLDivElement | null>(null);

  // Custom metadata state - initialize empty object with all editable GameMetadata fields
  const getEmptyCustomMetadata = (): CustomMetadataForm => ({
    title: "",
    sort_title: "",
    description: "",
    notes: "",
    average_playtime: "",
    age_rating: "",
    release_date: "",
    rating: "",
    early_access: "",
    launch_executable: "",
    launch_parameters: "",
    installer_executable: "",
    installer_parameters: "",
    uninstaller_executable: "",
    uninstaller_parameters: "",
    url_websites: "",
    genres: "",
    tags: "",
    publishers: "",
    developers: "",
    url_trailers: "",
    url_gameplays: "",
    url_screenshots: "",
  });

  const [customMetadata, setCustomMetadata] = useState<CustomMetadataForm>(
    getEmptyCustomMetadata(),
  );
  const [savingCustomMetadata, setSavingCustomMetadata] = useState(false);

  // Metadata providers state
  const [metadataProviders, setMetadataProviders] = useState<
    MetadataProviderDto[]
  >([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [selectedMetadataProviderIndex, setSelectedMetadataProviderIndex] =
    useState<number>(0);
  const [remapSearchResults, setRemapSearchResults] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [customPriority, setCustomPriority] = useState<string>("");
  const [remapping, setRemapping] = useState(false);
  const searchTimeoutRef = useRef<number | null>(null);
  const [gameCoverUrl, setGameCoverUrl] = useState<string | null>(null);
  const [mappedGameCoverUrl, setMappedGameCoverUrl] = useState<string | null>(
    null,
  );

  // Launch options state
  const [launchExecutables, setLaunchExecutables] = useState<string[]>([]);
  const [selectedLaunchExe, setSelectedLaunchExe] = useState<string>("");
  const [nonExecutableScripts, setNonExecutableScripts] = useState<string[]>([]);
  const [makingExecutable, setMakingExecutable] = useState(false);
  const [launchParams, setLaunchParams] = useState<string>("");
  const [launchAsAdmin, setLaunchAsAdmin] = useState<boolean>(false);
  const [umuGameId, setUmuGameId] = useState<string>("");
  const [umuStore, setUmuStore] = useState<string>("");
  const [umuProtonPath, setUmuProtonPath] = useState<string>("");
  const [umuWinePrefix, setUmuWinePrefix] = useState<string>("");
  const [loadingLaunchOptions, setLoadingLaunchOptions] = useState(false);
  const launchOptionsLoadedRef = useRef(false);

  // umu-launcher (Wine/Proton) status for Windows executables on Linux.
  const [umuStatus, setUmuStatus] = useState<UmuStatusInfo | null>(null);
  const [installingUmu, setInstallingUmu] = useState(false);
  const { checkUmuStatus, installUmu } = useUmu();
  const isLinux =
    isTauri &&
    typeof navigator !== "undefined" &&
    navigator.userAgent.includes("Linux");
  const isWindowsLaunchExe =
    isLinux && isWindowsExecutablePath(selectedLaunchExe);

  // Fetch full game object on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingFullGame(true);
        const base = serverUrl.replace(/\/+$/, "");
        const res = await authFetch(`${base}/api/games/${game.id}`, {
          method: "GET",
        });
        if (!res.ok) throw new Error(`Failed to load game (${res.status})`);
        const json = await res.json();
        if (!cancelled) setFullGame(json);
      } catch (e: any) {
        console.error("Failed to fetch full game:", e);
        if (!cancelled) setFullGame(game); // fallback to slim version
      } finally {
        if (!cancelled) setLoadingFullGame(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverUrl, authFetch, game]);

  // Use fullGame if available, otherwise fallback to game prop
  const workingGame = fullGame || game;
  const installationTabsVisible = isTauri && !!installedGame;

  // Resolve the download location (root path) that contains this installed
  // game, so the disk-usage donut can show how much of that volume it uses.
  const diskUsageRoot = useMemo(() => {
    if (!installedGame?.versionDirectory) return null;
    for (const root of getRootPaths()) {
      const rootPath = root.path;
      if (
        rootPath &&
        (installedGame.versionDirectory === rootPath ||
          installedGame.versionDirectory.startsWith(`${rootPath}/`) ||
          installedGame.versionDirectory.startsWith(`${rootPath}\\`))
      ) {
        return root;
      }
    }
    return null;
  }, [installedGame]);
  const { data: diskUsageData, loading: diskUsageLoading } = useDiskUsage(
    diskUsageRoot?.path,
    installedGame?.versionDirectory,
  );

  const openImageSearch = useCallback(
    async (searchTerms: string) => {
      const gameTitle =
        workingGame.metadata?.title || workingGame.title || "Game";
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(
        `${gameTitle} ${searchTerms}`,
      )}&tbm=isch`;

      try {
        if (isTauri) {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("open_external_url", { url: searchUrl });
          return;
        }

        window.open(searchUrl, "_blank", "noopener,noreferrer");
      } catch (error) {
        console.error("Failed to open image search:", error);
        await showAlert({
          title: "Unable to open image search",
          description: error instanceof Error ? error.message : String(error),
          affirmativeText: "OK",
        });
      }
    },
    [isTauri, showAlert, workingGame.metadata?.title, workingGame.title],
  );

  const findInstalledGame = useCallback(async (): Promise<InstalledGameInfo | null> => {
    if (!isTauri) return null;
    const rootPaths = getRootPaths();
    if (!rootPaths.length) return null;

    const { invoke } = await import("@tauri-apps/api/core");

    const allResults: any[] = [];
    const seen = new Set<string>();

    for (const root of rootPaths) {
      const rawResults = await invoke<any[]>("list_installed_games", {
        selectedRoot: root.path,
      }).catch(() => [] as any[]);

      for (const r of rawResults) {
        const id = r.gameId ?? r.game_id ?? 0;
        const vd = r.versionDirectory ?? r.version_directory ?? "";
        const key = `${id}:${vd}`;
        if (id > 0 && !seen.has(key)) {
          seen.add(key);
          allResults.push(r);
        }
      }
    }

    const match = allResults
      .filter(
        (r) =>
          Number(r.gameId ?? r.game_id ?? 0) === workingGame.id &&
          typeof (r.installationDirectory ?? r.installation_directory) === "string" &&
          (r.installationDirectory ?? r.installation_directory ?? "").trim().length > 0 &&
          typeof (r.versionDirectory ?? r.version_directory) === "string" &&
          (r.versionDirectory ?? r.version_directory ?? "").trim().length > 0,
      )
      .sort(
        (a, b) =>
          Number(b.versionId ?? b.version_id ?? 0) -
          Number(a.versionId ?? a.version_id ?? 0),
      )[0];

    if (!match) return null;

    return {
      gameId: Number(match.gameId ?? match.game_id ?? workingGame.id),
      gameTitle:
        String(match.gameTitle ?? match.game_title ?? "").trim() ||
        workingGame.metadata?.title ||
        workingGame.title ||
        "Game",
      gameType:
        typeof (match.gameType ?? match.game_type) === "string" &&
        (match.gameType ?? match.game_type ?? "").trim().length > 0
          ? (match.gameType ?? match.game_type)
          : undefined,
      versionId: Number(match.versionId ?? match.version_id ?? 0),
      versionName: String(match.versionName ?? match.version_name ?? "").trim(),
      installationDirectory: String(
        match.installationDirectory ?? match.installation_directory ?? "",
      ),
      versionDirectory: String(
        match.versionDirectory ?? match.version_directory ?? "",
      ),
    };
  }, [isTauri, workingGame.id, workingGame.metadata?.title, workingGame.title]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const nextInstalledGame = await findInstalledGame();
        if (!cancelled) {
          setInstalledGame(nextInstalledGame);
        }
      } catch (error) {
        console.warn("Failed to detect installed game state:", error);
        if (!cancelled) {
          setInstalledGame(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [findInstalledGame]);

  useEffect(() => {
    if (
      !installationTabsVisible &&
      (activeTab === "installation" || activeTab === "launch-options")
    ) {
      setActiveTab("images");
    }
  }, [activeTab, installationTabsVisible]);

  // If offline, redirect away from server-dependent tabs
  useEffect(() => {
    const serverTabs: TabKey[] = ["images", "metadata", "custom-metadata"];
    if (isTauri && !isOnline && serverTabs.includes(activeTab)) {
      if (installationTabsVisible) {
        setActiveTab("installation");
      } else {
        setActiveTab("launch-options");
      }
    }
  }, [isTauri, isOnline, activeTab, installationTabsVisible]);

  // Load launch options when tab is opened
  useEffect(() => {
    if (activeTab !== "launch-options" || !installedGame) return;
    let cancelled = false;

    (async () => {
      setLoadingLaunchOptions(true);
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const { join } = await import("@tauri-apps/api/path");

        const status = await checkUmuStatus();
        if (!cancelled) setUmuStatus(status);

        // List executables from installation directory
        const result = await invoke<{
          executables: string[];
          nonExecutableScripts: string[];
        }>("list_launch_executables", {
          installationPath: installedGame.installationDirectory,
        });
        if (!cancelled) {
          setLaunchExecutables(result.executables);
          setNonExecutableScripts(result.nonExecutableScripts);
        }

        // Read saved launch config
        const configPath = await join(
          installedGame.versionDirectory,
          ".gamevault.game.config.json",
        );
        if (await invoke<boolean>("fs_path_exists", { path: configPath })) {
          try {
            const raw = JSON.parse(await invoke<string>("fs_read_text_file", { path: configPath }));
            if (!cancelled) {
              setSelectedLaunchExe(raw.launchexecutable || "");
              setLaunchParams(raw.launchparameters || "");
              setLaunchAsAdmin(!!raw.launchasadmin);
              setUmuGameId(raw.umugameid || "");
              setUmuStore(raw.umustore || "");
              setUmuProtonPath(raw.umuprotonpath || "");
              setUmuWinePrefix(raw.umuwineprefix || "");
            }
          } catch { }
        }
        if (!cancelled) launchOptionsLoadedRef.current = true;
      } catch (err) {
        console.error("Failed to load launch options:", err);
      } finally {
        if (!cancelled) setLoadingLaunchOptions(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab, installedGame, checkUmuStatus]);

  const handleMakeExecutable = useCallback(async () => {
    if (!installedGame) return;
    setMakingExecutable(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("make_script_executable", {
        installationPath: installedGame.installationDirectory,
        relativePaths: nonExecutableScripts,
      });
      // Refresh the list so the newly executable scripts appear.
      const result = await invoke<{
        executables: string[];
        nonExecutableScripts: string[];
      }>("list_launch_executables", {
        installationPath: installedGame.installationDirectory,
      });
      setLaunchExecutables(result.executables);
      setNonExecutableScripts(result.nonExecutableScripts);
    } catch (err: any) {
      console.error("Failed to make scripts executable:", err);
    } finally {
      setMakingExecutable(false);
    }
  }, [installedGame, nonExecutableScripts]);

  const handleInstallUmu = useCallback(async () => {
    setInstallingUmu(true);
    try {
      const ok = await installUmu(
        workingGame.metadata?.title || workingGame.title || "Game",
      );
      if (ok) {
        setUmuStatus(await checkUmuStatus());
      } else {
        await showAlert({
          title: "Failed to install umu-launcher",
          description:
            "umu-launcher could not be installed. Check your connection and try again.",
          affirmativeText: "OK",
        });
      }
    } finally {
      setInstallingUmu(false);
    }
  }, [
    installUmu,
    checkUmuStatus,
    showAlert,
    workingGame.metadata?.title,
    workingGame.title,
  ]);

  const persistLaunchOptions = useCallback(async (
    exe: string,
    params: string,
    runAsAdmin: boolean,
    umuGameId: string,
    umuStore: string,
    umuProtonPath: string,
    umuWinePrefix: string,
  ) => {
    if (!installedGame) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const { join } = await import("@tauri-apps/api/path");

      const configPath = await join(
        installedGame.versionDirectory,
        ".gamevault.game.config.json",
      );

      let current: Record<string, any> = {};
      if (await invoke<boolean>("fs_path_exists", { path: configPath })) {
        try {
          current = JSON.parse(await invoke<string>("fs_read_text_file", { path: configPath }));
        } catch {
          current = {};
        }
      }

      current.launchexecutable = exe || undefined;
      current.launchparameters = params.trim() || undefined;
      current.launchasadmin = runAsAdmin || undefined;
      current.umugameid = umuGameId.trim() || undefined;
      current.umustore = umuStore.trim() || undefined;
      current.umuprotonpath = umuProtonPath.trim() || undefined;
      current.umuwineprefix = umuWinePrefix.trim() || undefined;

      await invoke("fs_write_text_file", { path: configPath, content: JSON.stringify(current, null, 2) });
    } catch (err: any) {
      console.error("Failed to save launch options:", err);
    }
  }, [installedGame]);

  // Auto-save launch options on change (debounced)
  useEffect(() => {
    if (!launchOptionsLoadedRef.current) return;
    const timeout = setTimeout(() => {
      persistLaunchOptions(
        selectedLaunchExe,
        launchParams,
        launchAsAdmin,
        umuGameId,
        umuStore,
        umuProtonPath,
        umuWinePrefix,
      );
    }, 500);
    return () => clearTimeout(timeout);
  }, [
    selectedLaunchExe,
    launchParams,
    launchAsAdmin,
    umuGameId,
    umuStore,
    umuProtonPath,
    umuWinePrefix,
    persistLaunchOptions,
  ]);

  const updateInstallationFinishedFlag = useCallback(
    async (versionDirectory: string, installationFinished: boolean) => {
      const { invoke } = await import("@tauri-apps/api/core");
      const { join } = await import("@tauri-apps/api/path");

      const configPath = await join(versionDirectory, ".gamevault.game.config.json");
      if (!(await invoke<boolean>("fs_path_exists", { path: configPath }))) return;

      let current: Partial<GameVaultConfig> = {};
      try {
        current = JSON.parse(await invoke<string>("fs_read_text_file", { path: configPath })) as Partial<GameVaultConfig>;
      } catch {
        current = {};
      }

      const next: GameVaultConfig = {
        gameid: current.gameid,
        versionid: current.versionid,
        gametype: current.gametype,
        downloadfinished: Boolean(current.downloadfinished),
        extractionfinished: Boolean(current.extractionfinished),
        installationfinished: installationFinished,
        downloadprogress:
          typeof current.downloadprogress === "string"
            ? current.downloadprogress
            : "",
        launchexecutable: current.launchexecutable,
        launchparameters: current.launchparameters,
      };

      await invoke("fs_write_text_file", { path: configPath, content: JSON.stringify(next, null, 2) });
    },
    [],
  );

  const handleOpenInstallationDirectory = useCallback(async () => {
    if (!installedGame?.installationDirectory) return;

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_in_file_explorer", {
        path: installedGame.installationDirectory,
      });
    } catch (error: any) {
      await showAlert({
        title: "Error",
        description: error?.message || String(error),
        affirmativeText: "OK",
      });
    }
  }, [installedGame, showAlert]);

  const handleUninstallGame = useCallback(async () => {
    if (!installedGame) return;

    const resolvedTitle =
      workingGame.metadata?.title || workingGame.title || installedGame.gameTitle;

    if (isPortableInstallType(installedGame.gameType)) {
      const confirmed = await showAlert({
        title: `Are you sure you want to uninstall ${resolvedTitle} ?`,
        affirmativeText: "Yes",
        negativeText: "No",
      });

      if (!confirmed) return;

      setUninstalling(true);
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        if (await invoke<boolean>("fs_path_exists", { path: installedGame.installationDirectory })) {
          await invoke("fs_remove", { path: installedGame.installationDirectory, recursive: true });
        }
        await updateInstallationFinishedFlag(
          installedGame.versionDirectory,
          false,
        );
        // Clean up the empty per-version / per-game folders left behind.
        await pruneEmptyVersionFolders(installedGame.versionDirectory);
        setInstalledGame(await findInstalledGame());
        onUninstalled?.();
        await showAlert({
          title: "Game uninstalled",
          affirmativeText: "OK",
        });
      } catch (error: any) {
        await showAlert({
          title: "Error",
          description: error?.message || "Failed to uninstall game",
          affirmativeText: "OK",
        });
      } finally {
        setUninstalling(false);
      }
      return;
    }

    if (isSetupInstallType(installedGame.gameType)) {
      const configuredUninstaller =
        workingGame.metadata?.uninstaller_executable?.trim();

      const confirmed = await showAlert(
        configuredUninstaller
          ? {
              title: `Are you sure you want to uninstall '${resolvedTitle}' ?`,
              affirmativeText: "Yes",
              negativeText: "No",
            }
          : {
              title: `Are you sure you want to uninstall '${resolvedTitle}' ?`,
              description:
                "As this is a Windows Setup Game, you will need to select an uninstall executable manually",
              affirmativeText: "Yes",
              negativeText: "No",
            },
      );

      if (!confirmed) return;

      const runUninstaller = async (executablePath: string) => {
        setUninstalling(true);
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("launch_uninstall_executable", {
            executablePath,
            workingDirectory: installedGame.installationDirectory,
            argumentList: workingGame.metadata?.uninstaller_parameters || null,
          });
          await updateInstallationFinishedFlag(
            installedGame.versionDirectory,
            false,
          );
          setInstalledGame(await findInstalledGame());
          onUninstalled?.();
          await showAlert({
            title: "Game uninstalled",
            affirmativeText: "OK",
          });
        } catch (error: any) {
          await showAlert({
            title: "Error",
            description:
              error?.message || "Failed to run uninstall executable",
            affirmativeText: "OK",
          });
        } finally {
          setUninstalling(false);
        }
      };

      if (configuredUninstaller) {
        const isAbsolutePath = /^([a-zA-Z]:[\\/]|\/|\\)/.test(
          configuredUninstaller,
        );
        const { join } = await import("@tauri-apps/api/path");
        const { invoke } = await import("@tauri-apps/api/core");
        const resolvedUninstaller = isAbsolutePath
          ? configuredUninstaller
          : await join(
              installedGame.installationDirectory,
              configuredUninstaller.replace(/\\/g, "/"),
            );

        if (
          await invoke<boolean>("fs_path_exists", {
            path: resolvedUninstaller,
          })
        ) {
          await runUninstaller(resolvedUninstaller);
          return;
        }
      }

      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: false,
        multiple: false,
        defaultPath: installedGame.installationDirectory,
        title: "Select Uninstall Executable",
        filters: [
          {
            name: "Executables",
            extensions: ["exe", "msi", "bat", "cmd", "com"],
          },
        ],
      });

      if (typeof selected !== "string" || !selected) return;

      await runUninstaller(selected);
      return;
    }

    await showAlert({
      title: "Unsupported game type",
      description: "Only portable and setup games can be uninstalled right now.",
      affirmativeText: "OK",
    });
  }, [
    findInstalledGame,
    installedGame,
    onUninstalled,
    showAlert,
    updateInstallationFinishedFlag,
    workingGame.metadata?.title,
    workingGame.metadata?.uninstaller_executable,
    workingGame.metadata?.uninstaller_parameters,
    workingGame.title,
  ]);

  // Computed: Current shown mapped game
  const currentShownMappedGame = useMemo<GameMetadata | null>(() => {
    if (!workingGame.provider_metadata || metadataProviders.length === 0)
      return null;
    const selectedProvider = metadataProviders[selectedMetadataProviderIndex];
    if (!selectedProvider) return null;

    return (
      workingGame.provider_metadata.find(
        (meta) => meta.provider_slug === selectedProvider.slug,
      ) || null
    );
  }, [
    workingGame.provider_metadata,
    metadataProviders,
    selectedMetadataProviderIndex,
  ]);

  // Initialize providers on metadata tab open
  useEffect(() => {
    if (
      activeTab === "metadata" &&
      metadataProviders.length === 0 &&
      !loadingProviders
    ) {
      const initializeProviders = async () => {
        setLoadingProviders(true);
        try {
          const base = serverUrl?.replace(/\/+$/, "");
          if (!base) throw new Error("Missing server URL");

          const res = await authFetch(`${base}/api/metadata/providers`);
          if (!res.ok) {
            throw new Error(`Failed to fetch providers (${res.status})`);
          }

          let providers: MetadataProviderDto[] = await res.json();
          console.log(
            "📦 Providers from API:",
            providers.map((p) => ({
              slug: p.slug,
              name: p.name,
              priority: p.priority,
            })),
          );

          // Override priorities from game's provider_metadata
          if (workingGame.provider_metadata) {
            console.log(
              "🎮 Game provider_metadata:",
              workingGame.provider_metadata.map((m) => ({
                slug: m.provider_slug,
                priority: m.provider_priority,
              })),
            );
            providers = providers.map((provider) => {
              const gameProviderMeta = workingGame.provider_metadata?.find(
                (meta) => meta.provider_slug === provider.slug,
              );
              if (gameProviderMeta?.provider_priority != null) {
                console.log(
                  `✅ Overriding ${provider.slug}: ${provider.priority} -> ${gameProviderMeta.provider_priority}`,
                );
                return {
                  ...provider,
                  priority: gameProviderMeta.provider_priority,
                };
              }
              return provider;
            });
          }

          // Sort by priority descending
          providers.sort((a, b) => b.priority - a.priority);
          console.log(
            "🔄 Providers after sort:",
            providers.map((p) => ({
              slug: p.slug,
              name: p.name,
              priority: p.priority,
            })),
          );

          setMetadataProviders(providers);
          setSelectedMetadataProviderIndex(0);
        } catch (e: any) {
          console.error("Failed to fetch metadata providers:", e);
          await showAlert({
            title: "Error",
            description: e?.message || "Failed to load metadata providers",
            affirmativeText: "OK",
          });
        } finally {
          setLoadingProviders(false);
        }
      };

      initializeProviders();
    }
  }, [
    activeTab,
    metadataProviders.length,
    loadingProviders,
    serverUrl,
    authFetch,
    workingGame.provider_metadata,
    showAlert,
  ]);

  // Clear search results when provider selection changes
  useEffect(() => {
    setRemapSearchResults([]);
    setSearchQuery("");
    setMappedGameCoverUrl(null);

    // Set the current priority as the input value
    if (currentShownMappedGame?.provider_priority != null) {
      setCustomPriority(currentShownMappedGame.provider_priority.toString());
    } else {
      setCustomPriority("");
    }
  }, [selectedMetadataProviderIndex, currentShownMappedGame]);

  // Debounced search function
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!searchQuery.trim() || metadataProviders.length === 0) {
      setRemapSearchResults([]);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      const selectedProvider = metadataProviders[selectedMetadataProviderIndex];
      if (!selectedProvider) return;

      setSearching(true);
      try {
        const base = serverUrl?.replace(/\/+$/, "");
        if (!base) throw new Error("Missing server URL");

        const res = await authFetch(
          `${base}/api/metadata/providers/${selectedProvider.slug}/search?query=${encodeURIComponent(searchQuery)}`,
        );

        if (!res.ok) {
          throw new Error(`Search failed (${res.status})`);
        }

        const results = await res.json();
        setRemapSearchResults(Array.isArray(results) ? results : []);
      } catch (e: any) {
        console.error("Search failed:", e);
        setRemapSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [
    searchQuery,
    metadataProviders,
    selectedMetadataProviderIndex,
    serverUrl,
    authFetch,
  ]);

  // Core remap function
  const remapGame = async (
    providerDataId: string | null,
    priority?: number,
  ) => {
    const selectedProvider = metadataProviders[selectedMetadataProviderIndex];
    if (!selectedProvider) return;

    setRemapping(true);
    try {
      const base = serverUrl?.replace(/\/+$/, "");
      if (!base) throw new Error("Missing server URL");

      const mappingRequest: MapGameDto = {
        provider_slug: selectedProvider.slug,
        provider_data_id: providerDataId || undefined,
        provider_priority:
          priority !== undefined ? priority : selectedProvider.priority,
      };

      const updateDto: UpdateGameDto = {
        mapping_requests: [mappingRequest],
      };

      const res = await authFetch(`${base}/api/games/${workingGame.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(updateDto),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(
          `Remap failed (${res.status}): ${txt || res.statusText}`,
        );
      }

      const updatedGame = await res.json();
      setFullGame(updatedGame);
      onGameUpdated?.(updatedGame);
      emitGameUpdated(updatedGame);

      // Refresh providers to get updated priorities
      setMetadataProviders([]);

      await showAlert({
        title: "Success",
        description: providerDataId
          ? "Game remapped successfully"
          : "Game unmapped successfully",
        affirmativeText: "OK",
      });
    } catch (e: any) {
      await showAlert({
        title: "Error",
        description: e?.message || "Failed to remap game",
        affirmativeText: "OK",
      });
    } finally {
      setRemapping(false);
    }
  };

  const handleSavePriority = async () => {
    const priority = parseInt(customPriority, 10);
    if (isNaN(priority)) {
      await showAlert({
        title: "Invalid Priority",
        description: "Please enter a valid number for priority",
        affirmativeText: "OK",
      });
      return;
    }

    if (!currentShownMappedGame?.provider_data_id) {
      await showAlert({
        title: "No Mapping",
        description: "This game is not mapped to the selected provider",
        affirmativeText: "OK",
      });
      return;
    }

    await remapGame(currentShownMappedGame.provider_data_id, priority);
    setCustomPriority("");
  };

  const handleUnmap = async () => {
    const result = await showAlert({
      title: "Unmap Provider",
      description:
        "Are you sure you want to unmap this game from the selected provider?",
      affirmativeText: "Yes",
      negativeText: "Cancel",
    });

    if (result) {
      await remapGame(null);
    }
  };

  const handleRecache = async () => {
    if (!currentShownMappedGame?.provider_data_id) return;
    await remapGame(currentShownMappedGame.provider_data_id);
  };

  const handleRemapToResult = async (providerDataId: string) => {
    await remapGame(providerDataId);
    setRemapSearchResults([]);
    setSearchQuery("");
  };

  useEffect(
    () => () => {
      revokeRef.current.forEach((u) => {
        try {
          URL.revokeObjectURL(u);
        } catch { }
      });
    },
    [],
  );

  const coverMediaId = workingGame.metadata?.cover?.id;
  const backgroundMediaId = workingGame.metadata?.background?.id;

  const fetchMediaBlobUrl = useCallback(
    async (
      id: number,
      slot?: GameMediaSlot,
    ): Promise<string | null> => {
      if (!serverUrl || !id) return null;
      try {
        const blob = await resolveApiMediaBlob({
          serverUrl,
          mediaId: id,
          authFetch,
          owner: slot ? { gameId: workingGame.id, slot } : undefined,
        });
        const url = URL.createObjectURL(blob);
        revokeRef.current.push(url);
        return url;
      } catch {
        return null;
      }
    },
    [serverUrl, authFetch, workingGame.id],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (coverMediaId && coverImg.original == null) {
        const url = await fetchMediaBlobUrl(Number(coverMediaId), "cover");
        if (!cancelled && url)
          setCoverImg((s) => ({
            ...s,
            preview: url,
            original: url,
            loadedId: Number(coverMediaId),
          }));
      }
      if (backgroundMediaId && bgImg.original == null) {
        const url = await fetchMediaBlobUrl(
          Number(backgroundMediaId),
          "background",
        );
        if (!cancelled && url)
          setBgImg((s) => ({
            ...s,
            preview: url,
            original: url,
            loadedId: Number(backgroundMediaId),
          }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    coverMediaId,
    backgroundMediaId,
    fetchMediaBlobUrl,
    coverImg.original,
    bgImg.original,
  ]);

  // Load game cover image for metadata tab
  useEffect(() => {
    let cancelled = false;
    const loadGameCover = async () => {
      if (workingGame.metadata?.cover?.id) {
        const url = await fetchMediaBlobUrl(
          Number(workingGame.metadata.cover.id),
          "cover",
        );
        if (!cancelled && url) {
          setGameCoverUrl(url);
        }
      }
    };
    loadGameCover();
    return () => {
      cancelled = true;
    };
  }, [workingGame.metadata?.cover?.id, fetchMediaBlobUrl]);

  // Load mapped game cover image for metadata tab
  useEffect(() => {
    let cancelled = false;
    const loadMappedCover = async () => {
      if (currentShownMappedGame?.cover?.id) {
        const url = await fetchMediaBlobUrl(
          Number(currentShownMappedGame.cover.id),
        );
        if (!cancelled && url) {
          setMappedGameCoverUrl(url);
        }
      } else {
        setMappedGameCoverUrl(null);
      }
    };
    loadMappedCover();
    return () => {
      cancelled = true;
    };
  }, [currentShownMappedGame?.cover?.id, fetchMediaBlobUrl]);

  const loadFile = (
    file: File,
    target: "cover" | "bg",
    via: ImageState["via"],
  ) => {
    if (!file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    revokeRef.current.push(url);
    const update = { file, via, preview: url };
    if (target === "cover") setCoverImg((prev) => ({ ...prev, ...update }));
    else setBgImg((prev) => ({ ...prev, ...update }));
  };
  const loadUrl = (url: string, target: "cover" | "bg") => {
    if (!url.trim()) return;
    const safe = url.trim();
    const update = { file: null, via: "url" as const, preview: safe };
    if (target === "cover")
      setCoverImg((prev) => ({ ...prev, ...update, urlInput: safe }));
    else setBgImg((prev) => ({ ...prev, ...update, urlInput: safe }));
  };
  const handlePaste = (e: React.ClipboardEvent, target: "cover" | "bg") => {
    const items = e.clipboardData?.items;
    if (items) {
      for (const it of items) {
        if (it.kind === "file" && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            loadFile(f, target, "paste");
            e.preventDefault();
            return;
          }
        }
      }
    }
    const text = e.clipboardData?.getData("text");
    if (text && isProbablyImageUrl(text)) {
      loadUrl(text, target);
      e.preventDefault();
    }
  };
  const handleDrop = (e: React.DragEvent, target: "cover" | "bg") => {
    e.preventDefault();
    dragTargetRef.current = null;
    // In Tauri, external drags are handled by the native onDragDropEvent
    // listener; skip here so we don't double-load.
    if (isTauri && nativeDragHandledRef.current) return;
    const f = e.dataTransfer.files?.[0];
    if (f) {
      if (isTauri) nativeDragHandledRef.current = true;
      loadFile(f, target, "drag");
      return;
    }
    // Browser image drags expose multiple URLs (page URL first, image link
    // second) and `<img src>` in text/html — prefer the direct image link.
    const best = pickBestImageUrl(
      extractImageCandidatesFromDataTransfer(e.dataTransfer),
    );
    if (best && isProbablyImageUrl(best)) {
      loadUrl(best, target);
    }
  };
  const handleDragOver = (e: React.DragEvent, target: "cover" | "bg") => {
    e.preventDefault();
    dragTargetRef.current = target;
    nativeDragHandledRef.current = false;
  };
  const loadDroppedPath = async (paths: string[], target: "cover" | "bg") => {
    await applyDroppedSources(paths, {
      onUrl: (url) => loadUrl(url, target),
      onFile: (file) => {
        if (file.type.startsWith("image/")) loadFile(file, target, "drag");
      },
    });
  };
  const resolveDropTargetByPosition = (position: {
    x: number;
    y: number;
  }): "cover" | "bg" | null => {
    const dpr = window.devicePixelRatio || 1;
    const x = position.x / dpr;
    const y = position.y / dpr;
    for (const [ref, target] of [
      [coverZoneRef, "cover"],
      [bgZoneRef, "bg"],
    ] as const) {
      const el = ref.current;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
        return target;
    }
    return null;
  };
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        unlisten = await getCurrentWindow().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "enter" || payload.type === "over") {
            nativeDragHandledRef.current = false;
            return;
          }
          if (payload.type !== "drop") return;
          const target =
            dragTargetRef.current ??
            resolveDropTargetByPosition(payload.position);
          const paths = payload.paths ?? [];
          if (!target || !paths.length) return;
          nativeDragHandledRef.current = true;
          void loadDroppedPath(paths, target);
        });
      } catch (err) {
        console.error("Failed to init native drag-drop listener:", err);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTauri]);
  const coverFileInputRef = useRef<HTMLInputElement | null>(null);
  const bgFileInputRef = useRef<HTMLInputElement | null>(null);
  const imagesDirty =
    coverImg.preview !== coverImg.original || bgImg.preview !== bgImg.original;
  const obtainFileForState = async (
    state: ImageState,
    fallbackName: string,
  ): Promise<File | null> => {
    if (state.file) return state.file;
    if (state.via === "url" && state.preview) {
      try {
        if (isTauri) {
          const { invoke } = await import("@tauri-apps/api/core");
          const res = (await invoke("fetch_url_bytes", {
            url: state.preview,
          })) as { bytes: number[]; content_type: string };
          const bytes = new Uint8Array(res.bytes);
          const mime = res.content_type || "image/png";
          const ext = (mime.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "");
          return new File([bytes], `${fallbackName}.${ext}`, { type: mime });
        }
        const r = await fetch(state.preview);
        if (!r.ok) throw new Error("url fetch failed");
        const b = await r.blob();
        const ext = (b.type && b.type.split("/")[1]) || "png";
        return new File([b], `${fallbackName}.${ext}`, {
          type: b.type || "image/png",
        });
      } catch {
        return null;
      }
    }
    return null;
  };
  const resolveImageFile = async (
    state: ImageState,
    fallbackName: string,
  ): Promise<File> => {
    const f = await obtainFileForState(state, fallbackName);
    if (!f) {
      throw new Error(
        "Could not download image from URL — the site blocks cross-origin downloads.",
      );
    }
    return f;
  };
  const uploadImage = async (file: File): Promise<number> => {
    if (!serverUrl) throw new Error("No server URL");
    const base = serverUrl.replace(/\/+$/, "");
    const formData = new FormData();
    formData.append("file", file, file.name);
    const res = await authFetch(`${base}/api/media`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(
        `Upload failed (${res.status}): ${txt || res.statusText}`,
      );
    }
    const media = await res.json();
    const mid = media?.id ?? media?.ID;
    if (!mid) throw new Error("Upload response missing id");
    return mid;
  };

  const saveImages = async () => {
    if (!imagesDirty || savingImages) return;
    setSavingImages(true);
    setImagesMsg(null);

    try {
      const newCover = coverImg.preview !== coverImg.original;
      const newBg = bgImg.preview !== bgImg.original;

      // Upload new images and get their IDs
      const coverId = newCover
        ? await uploadImage(await resolveImageFile(coverImg, "cover"))
        : undefined;
      const backgroundId = newBg
        ? await uploadImage(await resolveImageFile(bgImg, "background"))
        : undefined;

      // Update game with new media IDs
      if (coverId || backgroundId) {
        const base = serverUrl?.replace(/\/+$/, "");
        if (!base) throw new Error("Missing server URL");

        const updateGame: UpdateGameDto = {
          user_metadata: {},
        };

        if (coverId) updateGame.user_metadata!.cover = { id: coverId } as any;
        if (backgroundId)
          updateGame.user_metadata!.background = { id: backgroundId } as any;

        const res = await authFetch(`${base}/api/games/${workingGame.id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(updateGame),
        });

        if (!res.ok) {
          const txt = await res.text();
          throw new Error(
            `Game update failed (${res.status}): ${txt || res.statusText}`,
          );
        }

        const updatedGame = await res.json();
        setFullGame(updatedGame);
        onGameUpdated?.(updatedGame);
        emitGameUpdated(updatedGame);
      }

      // Update local state to mark as saved
      setImagesMsg("Images saved successfully");
      if (newCover) {
        setCoverImg((s) => ({
          ...s,
          original: s.preview,
          via: "none",
          file: null,
          urlInput: "",
          loadedId: coverId ?? s.loadedId,
        }));
      }
      if (newBg) {
        setBgImg((s) => ({
          ...s,
          original: s.preview,
          via: "none",
          file: null,
          urlInput: "",
          loadedId: backgroundId ?? s.loadedId,
        }));
      }
    } catch (e: any) {
      setImagesMsg(e?.message || "Failed to save images");
    } finally {
      setSavingImages(false);
    }
  };

  const applyWatermark = (field: keyof CustomMetadataForm) => {
    const metadata = workingGame.metadata;
    let value: any = "";

    switch (field) {
      case "title":
        value = metadata?.title || workingGame.title || "";
        break;
      case "sort_title":
        value = workingGame.sort_title || "";
        break;
      case "description":
        value = metadata?.description || "";
        break;
      case "notes":
        value = metadata?.notes || "";
        break;
      case "average_playtime":
        value = metadata?.average_playtime?.toString() || "";
        break;
      case "age_rating":
        value = metadata?.age_rating?.toString() || "";
        break;
      case "release_date":
        if (metadata?.release_date) {
          const date = new Date(metadata.release_date);
          value = date.toISOString().split("T")[0];
        } else if (workingGame.release_date) {
          const date = new Date(workingGame.release_date);
          value = date.toISOString().split("T")[0];
        }
        break;
      case "rating":
        value = metadata?.rating?.toString() || "";
        break;
      case "early_access":
        value =
          metadata?.early_access !== undefined
            ? metadata.early_access.toString()
            : workingGame.early_access !== undefined
              ? workingGame.early_access.toString()
              : "";
        break;
      case "launch_executable":
        value = metadata?.launch_executable || "";
        break;
      case "launch_parameters":
        value = metadata?.launch_parameters || "";
        break;
      case "installer_executable":
        value = metadata?.installer_executable || "";
        break;
      case "installer_parameters":
        value = metadata?.installer_parameters || "";
        break;
      case "uninstaller_executable":
        value = metadata?.uninstaller_executable || "";
        break;
      case "uninstaller_parameters":
        value = metadata?.uninstaller_parameters || "";
        break;
      case "url_websites":
        value = Array.isArray(metadata?.url_websites)
          ? metadata.url_websites.join(", ")
          : "";
        break;
      case "genres":
        value = Array.isArray(metadata?.genres)
          ? metadata.genres.map((g: any) => g.name || g).join(", ")
          : "";
        break;
      case "tags":
        value = Array.isArray(metadata?.tags)
          ? metadata.tags.map((t: any) => t.name || t).join(", ")
          : "";
        break;
      case "publishers":
        value = Array.isArray(metadata?.publishers)
          ? metadata.publishers.map((p: any) => p.name || p).join(", ")
          : "";
        break;
      case "developers":
        value = Array.isArray(metadata?.developers)
          ? metadata.developers.map((d: any) => d.name || d).join(", ")
          : "";
        break;
      case "url_trailers":
        value = Array.isArray(metadata?.url_trailers)
          ? metadata.url_trailers.join(", ")
          : "";
        break;
      case "url_gameplays":
        value = Array.isArray(metadata?.url_gameplays)
          ? metadata.url_gameplays.join(", ")
          : "";
        break;
      case "url_screenshots":
        value = Array.isArray(metadata?.url_screenshots)
          ? metadata.url_screenshots.join(", ")
          : "";
        break;
    }

    setCustomMetadata((prev) => ({ ...prev, [field]: value }));
  };

  const getWatermark = (field: keyof CustomMetadataForm): string => {
    const metadata = workingGame.metadata;

    switch (field) {
      case "title":
        return metadata?.title || workingGame.title || "";
      case "sort_title":
        return workingGame.sort_title || "";
      case "description":
        return metadata?.description || "";
      case "notes":
        return metadata?.notes || "";
      case "average_playtime":
        return metadata?.average_playtime?.toString() || "";
      case "age_rating":
        return metadata?.age_rating?.toString() || "";
      case "release_date":
        if (metadata?.release_date) {
          const date = new Date(metadata.release_date);
          return date.toISOString().split("T")[0];
        } else if (workingGame.release_date) {
          const date = new Date(workingGame.release_date);
          return date.toISOString().split("T")[0];
        }
        return "";
      case "rating":
        return metadata?.rating?.toString() || "";
      case "early_access":
        return metadata?.early_access !== undefined
          ? metadata.early_access
            ? "true"
            : "false"
          : workingGame.early_access !== undefined
            ? workingGame.early_access
              ? "true"
              : "false"
            : "";
      case "launch_executable":
        return metadata?.launch_executable || "";
      case "launch_parameters":
        return metadata?.launch_parameters || "";
      case "installer_executable":
        return metadata?.installer_executable || "";
      case "installer_parameters":
        return metadata?.installer_parameters || "";
      case "uninstaller_executable":
        return metadata?.uninstaller_executable || "";
      case "uninstaller_parameters":
        return metadata?.uninstaller_parameters || "";
      case "url_websites":
        return Array.isArray(metadata?.url_websites)
          ? metadata.url_websites.join(", ")
          : "";
      case "genres":
        return Array.isArray(metadata?.genres)
          ? metadata.genres.map((g: any) => g.name || g).join(", ")
          : "";
      case "tags":
        return Array.isArray(metadata?.tags)
          ? metadata.tags.map((t: any) => t.name || t).join(", ")
          : "";
      case "publishers":
        return Array.isArray(metadata?.publishers)
          ? metadata.publishers.map((p: any) => p.name || p).join(", ")
          : "";
      case "developers":
        return Array.isArray(metadata?.developers)
          ? metadata.developers.map((d: any) => d.name || d).join(", ")
          : "";
      case "url_trailers":
        return Array.isArray(metadata?.url_trailers)
          ? metadata.url_trailers.join(", ")
          : "";
      case "url_gameplays":
        return Array.isArray(metadata?.url_gameplays)
          ? metadata.url_gameplays.join(", ")
          : "";
      case "url_screenshots":
        return Array.isArray(metadata?.url_screenshots)
          ? metadata.url_screenshots.join(", ")
          : "";
      default:
        return "";
    }
  };

  const saveCustomMetadata = async () => {
    setSavingCustomMetadata(true);
    try {
      const base = serverUrl?.replace(/\/+$/, "");
      if (!base) throw new Error("Missing server URL");

      const updateDto: any = {};

      if (customMetadata.title) updateDto.title = customMetadata.title;
      if (customMetadata.sort_title)
        updateDto.sort_title = customMetadata.sort_title;
      if (customMetadata.description)
        updateDto.description = customMetadata.description;
      if (customMetadata.notes) updateDto.notes = customMetadata.notes;
      if (customMetadata.average_playtime)
        updateDto.average_playtime = Number(customMetadata.average_playtime);
      if (customMetadata.age_rating)
        updateDto.age_rating = Number(customMetadata.age_rating);
      if (customMetadata.release_date)
        updateDto.release_date = customMetadata.release_date;
      if (customMetadata.rating)
        updateDto.rating = Number(customMetadata.rating);
      if (customMetadata.early_access !== "")
        updateDto.early_access = customMetadata.early_access === "true";

      if (customMetadata.launch_executable)
        updateDto.launch_executable = customMetadata.launch_executable;
      if (customMetadata.launch_parameters)
        updateDto.launch_parameters = customMetadata.launch_parameters;
      if (customMetadata.installer_executable)
        updateDto.installer_executable = customMetadata.installer_executable;
      if (customMetadata.installer_parameters)
        updateDto.installer_parameters = customMetadata.installer_parameters;
      if (customMetadata.uninstaller_executable)
        updateDto.uninstaller_executable =
          customMetadata.uninstaller_executable;
      if (customMetadata.uninstaller_parameters)
        updateDto.uninstaller_parameters =
          customMetadata.uninstaller_parameters;

      if (customMetadata.url_websites)
        updateDto.url_websites = customMetadata.url_websites
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      if (customMetadata.genres)
        updateDto.genres = customMetadata.genres
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      if (customMetadata.tags)
        updateDto.tags = customMetadata.tags
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      if (customMetadata.publishers)
        updateDto.publishers = customMetadata.publishers
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      if (customMetadata.developers)
        updateDto.developers = customMetadata.developers
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      if (customMetadata.url_trailers)
        updateDto.url_trailers = customMetadata.url_trailers
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      if (customMetadata.url_gameplays)
        updateDto.url_gameplays = customMetadata.url_gameplays
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      if (customMetadata.url_screenshots)
        updateDto.url_screenshots = customMetadata.url_screenshots
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

      const payload: UpdateGameDto = {
        user_metadata: updateDto,
      };

      const res = await authFetch(`${base}/api/games/${workingGame.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(
          `Failed to save custom metadata (${res.status}): ${txt || res.statusText}`,
        );
      }

      const updatedGame = await res.json();
      setFullGame(updatedGame);
      onGameUpdated?.(updatedGame);
      emitGameUpdated(updatedGame);

      await showAlert({
        title: "Success",
        description: "Custom metadata has been saved successfully.",
        affirmativeText: "OK",
      });

      // Reset form
      setCustomMetadata(getEmptyCustomMetadata());
    } catch (e: any) {
      await showAlert({
        title: "Error",
        description: e?.message || "Failed to save custom metadata",
        affirmativeText: "OK",
      });
    } finally {
      setSavingCustomMetadata(false);
    }
  };

  const handleWipeCustomMetadata = async () => {
    const result = await showAlert({
      title:
        "Are you sure you want to wipe all manually edited custom metadata and images?",
      description:
        "All fields will revert to the merged provider metadata (if available).\n\nThis action cannot be undone.",
      affirmativeText: "Yes",
      negativeText: "No",
    });

    if (result) {
      setSaving(true);
      try {
        const base = serverUrl?.replace(/\/+$/, "");
        if (!base) throw new Error("Missing server URL");

        const updateGame: UpdateGameDto = {
          mapping_requests: [
            {
              provider_slug: "user",
              provider_priority: 0,
            },
          ],
        };

        const res = await authFetch(`${base}/api/games/${workingGame.id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(updateGame),
        });

        if (!res.ok) {
          const txt = await res.text();
          throw new Error(
            `Failed to wipe custom metadata (${res.status}): ${txt || res.statusText}`,
          );
        }

        const updatedGame = await res.json();
        setFullGame(updatedGame);
        onGameUpdated?.(updatedGame);
        emitGameUpdated(updatedGame);

        await showAlert({
          title: "Success",
          description: "Custom metadata has been wiped successfully.",
          affirmativeText: "OK",
        });
      } catch (e: any) {
        await showAlert({
          title: "Error",
          description: e?.message || "Failed to wipe custom metadata",
          affirmativeText: "OK",
        });
      } finally {
        setSaving(false);
      }
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="7xl"
      className="!max-w-[min(95vw,1200px)] sm:!max-w-[min(65vw,1200px)] !h-[min(90vh,900px)] !w-full flex flex-col"
    >
      <DialogTitle className="flex items-center justify-between gap-2 sm:gap-4 pb-1 flex-shrink-0">
        <span>Game Settings</span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gv-line text-gv-muted hover:text-gv-text hover:bg-gv-panel-soft transition-colors"
          aria-label="Close"
          disabled={saving}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none">
            <path strokeWidth="2" strokeLinecap="round" d="M6 6 18 18" />
            <path strokeWidth="2" strokeLinecap="round" d="M18 6 6 18" />
          </svg>
        </button>
      </DialogTitle>

      {loadingFullGame ? (
        <div className="flex items-center justify-center p-8">
          <div className="text-sm text-fg-muted">Loading game data...</div>
        </div>
      ) : (
        <>
          {/* Vertical tab navigation layout */}
          <div className="flex flex-col sm:flex-row gap-0 flex-1 min-h-0">
            {/* Left sidebar - vertical tabs */}
            <div className="w-full sm:w-52 border-b sm:border-b-0 sm:border-r border-gv-line py-2 sm:py-4">
              <nav className="flex flex-row sm:flex-col gap-1 px-2 sm:px-3 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {(!isTauri || isOnline) && (
                <>
                <button
                  onClick={() => setActiveTab("images")}
                  className={
                    "flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 rounded-xl text-xs sm:text-sm font-medium transition-colors text-left whitespace-nowrap " +
                    (activeTab === "images"
                      ? "bg-gv-accent text-white"
                      : "text-gv-muted hover:bg-gv-panel-soft hover:text-gv-text")
                  }
                >
                  <PhotoIcon className="w-5 h-5 flex-shrink-0" />
                  <span>Edit Images</span>
                </button>
                <button
                  onClick={() => setActiveTab("metadata")}
                  className={
                    "flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 rounded-xl text-xs sm:text-sm font-medium transition-colors text-left whitespace-nowrap " +
                    (activeTab === "metadata"
                      ? "bg-gv-accent text-white"
                      : "text-gv-muted hover:bg-gv-panel-soft hover:text-gv-text")
                  }
                >
                  <CircleStackIcon className="w-5 h-5 flex-shrink-0" />
                  <span>Metadata</span>
                </button>
                <button
                  onClick={() => setActiveTab("custom-metadata")}
                  className={
                    "flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 rounded-xl text-xs sm:text-sm font-medium transition-colors text-left whitespace-nowrap " +
                    (activeTab === "custom-metadata"
                      ? "bg-gv-accent text-white"
                      : "text-gv-muted hover:bg-gv-panel-soft hover:text-gv-text")
                  }
                >
                  <PencilIcon className="w-5 h-5 flex-shrink-0" />
                  <span className="whitespace-nowrap">Custom Metadata</span>
                </button>
                </>
                )}
                {installationTabsVisible && (
                  <>
                    <button
                      onClick={() => setActiveTab("installation")}
                      className={
                        "flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 rounded-xl text-xs sm:text-sm font-medium transition-colors text-left whitespace-nowrap " +
                        (activeTab === "installation"
                          ? "bg-gv-accent text-white"
                          : "text-gv-muted hover:bg-gv-panel-soft hover:text-gv-text")
                      }
                    >
                      <FolderOpenIcon className="w-5 h-5 flex-shrink-0" />
                      <span>Installation</span>
                    </button>
                    <button
                      onClick={() => setActiveTab("launch-options")}
                      className={
                        "flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 rounded-xl text-xs sm:text-sm font-medium transition-colors text-left whitespace-nowrap " +
                        (activeTab === "launch-options"
                          ? "bg-gv-accent text-white"
                          : "text-gv-muted hover:bg-gv-panel-soft hover:text-gv-text")
                      }
                    >
                      <SparklesIcon className="w-5 h-5 flex-shrink-0" />
                      <span>Launch options</span>
                    </button>
                  </>
                )}
              </nav>
            </div>

            {/* Right content area */}
            <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
              <DialogBody className="flex-1 px-6 py-4 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gv-panel-strong [&::-webkit-scrollbar-thumb]:rounded-full">
                {activeTab === "images" && (
                  <div className="grid gap-8 md:grid-cols-2">
                    {/* Cover zone */}
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.14em] text-gv-muted">
                        <span>Cover</span>
                        {coverImg.via !== "none" && (
                          <span className="rounded-full bg-gv-panel px-2 py-0.5 text-[10px] font-semibold text-gv-muted">
                            {coverImg.via}
                          </span>
                        )}
                      </div>

                      <div
                        ref={coverZoneRef}
                        onPaste={(e) => handlePaste(e, "cover")}
                        onDrop={(e) => handleDrop(e, "cover")}
                        onDragOver={(e) => handleDragOver(e, "cover")}
                        className="relative rounded-2xl border-2 border-dashed border-gv-line bg-gv-panel-soft h-56 flex items-center justify-center cursor-pointer overflow-hidden transition-colors hover:border-gv-accent/50 hover:bg-gv-panel"
                        onClick={() => coverFileInputRef.current?.click()}
                      >
                        {coverImg.preview ? (
                          <img
                            src={coverImg.preview}
                            alt="Cover preview"
                            className="object-contain w-full h-full"
                            draggable={false}
                          />
                        ) : (
                          <div className="text-xs text-gv-muted text-center px-4">
                            {coverMediaId
                              ? "Loading…"
                              : "Drag & Drop / Click / Paste"}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type="text"
                          placeholder="Paste image URL"
                          value={coverImg.urlInput}
                          onChange={(e) =>
                            setCoverImg((p) => ({
                              ...p,
                              urlInput: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && coverImg.urlInput.trim()) {
                              loadUrl(coverImg.urlInput, "cover");
                            }
                          }}
                          onPaste={(e) => {
                            const text = e.clipboardData?.getData("text");
                            if (text && isProbablyImageUrl(text)) {
                              loadUrl(text, "cover");
                              e.preventDefault();
                            }
                          }}
                        />
                        {coverImg.preview &&
                          coverImg.preview !== coverImg.original && (
                            <Button
                              color="rose"
                              type="button"
                              onClick={() =>
                                setCoverImg((p) => ({
                                  ...p,
                                  file: null,
                                  via: "none",
                                  preview: p.original,
                                  urlInput: "",
                                }))
                              }
                            >
                              Reset
                            </Button>
                          )}
                      </div>
                      <input
                        ref={coverFileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) loadFile(f, "cover", "file");
                          e.target.value = "";
                        }}
                      />
                      <Button
                        type="button"
                        color="zinc"
                        onClick={() => void openImageSearch("Game Box Art")}
                        className="w-full"
                      >
                        <MagnifyingGlassIcon className="w-4 h-4" />
                        Find Images
                      </Button>
                    </div>
                    {/* Background zone */}
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.14em] text-gv-muted">
                        <span>Background</span>
                        {bgImg.via !== "none" && (
                          <span className="rounded-full bg-gv-panel px-2 py-0.5 text-[10px] font-semibold text-gv-muted">
                            {bgImg.via}
                          </span>
                        )}
                      </div>

                      <div
                        ref={bgZoneRef}
                        onPaste={(e) => handlePaste(e, "bg")}
                        onDrop={(e) => handleDrop(e, "bg")}
                        onDragOver={(e) => handleDragOver(e, "bg")}
                        className="relative rounded-2xl border-2 border-dashed border-gv-line bg-gv-panel-soft h-56 flex items-center justify-center cursor-pointer overflow-hidden transition-colors hover:border-gv-accent/50 hover:bg-gv-panel"
                        onClick={() => bgFileInputRef.current?.click()}
                      >
                        {bgImg.preview ? (
                          <img
                            src={bgImg.preview}
                            alt="Background preview"
                            className="object-cover w-full h-full"
                            draggable={false}
                          />
                        ) : (
                          <div className="text-xs text-gv-muted text-center px-4">
                            {backgroundMediaId
                              ? "Loading…"
                              : "Drag & Drop / Click / Paste"}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <Input
                          type="text"
                          placeholder="Paste image URL"
                          value={bgImg.urlInput}
                          onChange={(e) =>
                            setBgImg((p) => ({
                              ...p,
                              urlInput: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && bgImg.urlInput.trim()) {
                              loadUrl(bgImg.urlInput, "bg");
                            }
                          }}
                          onPaste={(e) => {
                            const text = e.clipboardData?.getData("text");
                            if (text && isProbablyImageUrl(text)) {
                              loadUrl(text, "bg");
                              e.preventDefault();
                            }
                          }}
                        />
                        {bgImg.preview && bgImg.preview !== bgImg.original && (
                          <Button
                            color="rose"
                            type="button"
                            onClick={() =>
                              setBgImg((p) => ({
                                ...p,
                                file: null,
                                via: "none",
                                preview: p.original,
                                urlInput: "",
                              }))
                            }
                          >
                            Reset
                          </Button>
                        )}
                      </div>
                      <input
                        ref={bgFileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) loadFile(f, "bg", "file");
                          e.target.value = "";
                        }}
                      />
                      <Button
                        type="button"
                        color="zinc"
                        onClick={() =>
                          void openImageSearch("Game Background Art")
                        }
                        className="w-full"
                      >
                        <MagnifyingGlassIcon className="w-4 h-4" />
                        Find Images
                      </Button>
                    </div>
                    {/* Save button for images tab */}
                    <div className="md:col-span-2 flex items-center gap-4 pt-2">
                      {imagesMsg && (
                        <Text
                          className={
                            "text-xs " +
                            (imagesMsg.includes("successfully")
                              ? "text-emerald-400"
                              : "text-rose-400")
                          }
                        >
                          {imagesMsg}
                        </Text>
                      )}
                      <div className="flex-1" />
                      <Button
                        color="indigo"
                        disabled={!imagesDirty || savingImages}
                        onClick={saveImages}
                      >
                        {savingImages ? "Saving Images…" : "Save Images"}
                      </Button>
                    </div>
                  </div>
                )}

                {activeTab === "metadata" && (
                  <div className="h-full flex flex-col overflow-hidden">
                    {loadingProviders ? (
                      <div className="flex items-center justify-center py-12">
                        <div className="text-sm text-gv-muted">
                          Loading providers...
                        </div>
                      </div>
                    ) : metadataProviders.length === 0 ? (
                      <div className="flex items-center justify-center py-12">
                        <div className="text-sm text-gv-muted">
                          No metadata providers available
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col h-full overflow-hidden">
                        {/* Provider Selector */}
                        <div className="flex-shrink-0 flex gap-2 flex-wrap mb-4 pb-4 border-b border-gv-line">
                          {metadataProviders.map((provider, index) => {
                            const isMapped =
                              workingGame.provider_metadata?.some(
                                (meta) => meta.provider_slug === provider.slug,
                              );
                            return (
                              <button
                                key={provider.slug}
                                onClick={() =>
                                  setSelectedMetadataProviderIndex(index)
                                }
                                disabled={remapping}
                                className={
                                  "px-3 py-1.5 rounded-lg text-sm font-medium transition-all " +
                                  (selectedMetadataProviderIndex === index
                                    ? "bg-gv-accent text-white shadow-sm"
                                    : isMapped
                                      ? "bg-gv-panel-soft text-gv-text hover:bg-gv-panel"
                                      : "bg-gv-panel-soft text-gv-muted opacity-60 hover:opacity-100")
                                }
                              >
                                {provider.name} ({provider.priority})
                              </button>
                            );
                          })}
                        </div>

                        {/* Content Area with fixed sections */}
                        <div className="flex-1 flex flex-col gap-4 min-h-0 overflow-y-auto overflow-x-hidden pr-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gv-panel-strong [&::-webkit-scrollbar-thumb]:rounded-full max-w-full">
                          {/* Comparison cards with separate action panel */}
                          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_220px] shrink-0 w-full max-w-full">
                            <div className="space-y-4 min-w-0">
                              <div className="surface-panel-soft rounded-2xl p-4">
                                <div className="mb-4">
                                  <h4 className="text-base font-semibold text-gv-text">
                                    GameVault
                                  </h4>
                                  <div className="text-xs text-gv-muted">
                                    Source file and imported game data
                                  </div>
                                </div>

                                <div className="flex flex-col gap-4 lg:flex-row">
                                  {gameCoverUrl && (
                                    <div className="shrink-0 self-start rounded-lg overflow-hidden border border-gv-line">
                                      <img
                                        src={gameCoverUrl}
                                        alt="Cover"
                                        className="w-32 h-44 object-cover"
                                        style={{ aspectRatio: "2/3" }}
                                        onError={(e) => {
                                          (
                                            e.target as HTMLImageElement
                                          ).style.display = "none";
                                        }}
                                      />
                                    </div>
                                  )}

                                  <div className="grid flex-1 gap-3 text-sm min-w-0 sm:grid-cols-2">
                                    <div className="sm:col-span-2">
                                      <div className="mb-1 text-gv-muted">
                                        File Path:
                                      </div>
                                      <div
                                        className="font-mono text-xs leading-relaxed text-gv-text break-all"
                                        title={workingGame.file_path || "N/A"}
                                      >
                                        {workingGame.file_path || "N/A"}
                                      </div>
                                    </div>
                                    <div>
                                      <div className="mb-1 text-gv-muted">
                                        Release Date:
                                      </div>
                                      <div className="text-gv-text">
                                        {workingGame.release_date
                                          ? formatDate(workingGame.release_date)
                                          : "N/A"}
                                      </div>
                                    </div>
                                    <div>
                                      <div className="mb-1 text-gv-muted">
                                        Added:
                                      </div>
                                      <div className="text-gv-text">
                                        {formatDate(workingGame.created_at)}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div className="surface-panel-soft rounded-2xl p-4">
                                <div className="mb-4">
                                  <h4 className="text-base font-semibold text-gv-text">
                                    Mapped Game
                                  </h4>
                                  <div className="text-xs text-gv-muted">
                                    Current provider match and cached metadata
                                  </div>
                                </div>

                                {currentShownMappedGame ? (
                                  <div className="flex flex-col gap-4 lg:flex-row">
                                    {mappedGameCoverUrl && (
                                      <div className="shrink-0 self-start rounded-lg overflow-hidden border border-gv-line">
                                        <img
                                          src={mappedGameCoverUrl}
                                          alt="Provider Cover"
                                          className="w-32 h-44 object-cover"
                                          style={{ aspectRatio: "2/3" }}
                                          onError={(e) => {
                                            (
                                              e.target as HTMLImageElement
                                            ).style.display = "none";
                                          }}
                                        />
                                      </div>
                                    )}

                                    <div className="grid flex-1 gap-3 text-sm min-w-0 sm:grid-cols-2">
                                      <div className="sm:col-span-2">
                                        <div className="mb-1 text-gv-muted">
                                          Title:
                                        </div>
                                        <div className="leading-relaxed text-gv-text">
                                          {currentShownMappedGame.title ||
                                            "N/A"}
                                        </div>
                                      </div>
                                      <div>
                                        <div className="mb-1 text-gv-muted">
                                          Release Date:
                                        </div>
                                        <div className="text-gv-text">
                                          {currentShownMappedGame.release_date
                                            ? formatDate(
                                                currentShownMappedGame.release_date,
                                              )
                                            : "N/A"}
                                        </div>
                                      </div>
                                      <div>
                                        <div className="mb-1 text-gv-muted">
                                          Last Cached:
                                        </div>
                                        <div className="text-gv-text">
                                          {currentShownMappedGame.updated_at
                                            ? formatDate(
                                                currentShownMappedGame.updated_at,
                                              )
                                            : "N/A"}
                                        </div>
                                      </div>
                                      {currentShownMappedGame.provider_data_url && (
                                        <div className="sm:col-span-2">
                                          <a
                                            href={
                                              currentShownMappedGame.provider_data_url
                                            }
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs text-gv-accent hover:underline"
                                          >
                                            View on{" "}
                                            {
                                              metadataProviders[
                                                selectedMetadataProviderIndex
                                              ]?.name
                                            }
                                          </a>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex min-h-24 items-center justify-center text-sm text-gv-muted">
                                    Not mapped to this provider
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-col gap-4 surface-panel-soft rounded-2xl p-4 w-full max-w-full 2xl:max-w-none">
                              <div>
                                <h4 className="text-base font-semibold text-gv-text">
                                  Actions
                                </h4>
                                <div className="text-xs text-gv-muted">
                                  Adjust match priority or refresh mapping
                                </div>
                              </div>

                              {currentShownMappedGame ? (
                                <div className="space-y-3 w-full max-w-full">
                                  <div className="w-full max-w-full">
                                    <label className="block text-xs font-medium text-gv-muted mb-2">
                                      Priority
                                    </label>
                                    <div className="flex gap-2 w-full max-w-full">
                                      <Input
                                        type="number"
                                        placeholder={`${currentShownMappedGame?.provider_priority ?? metadataProviders[selectedMetadataProviderIndex]?.priority ?? ""}`}
                                        value={customPriority}
                                        onChange={(e) =>
                                          setCustomPriority(e.target.value)
                                        }
                                        disabled={remapping}
                                        className="flex-1"
                                      />
                                      <Button
                                        color="indigo"
                                        onClick={handleSavePriority}
                                        disabled={!customPriority || remapping}
                                      >
                                        Save
                                      </Button>
                                    </div>
                                  </div>

                                  <Button
                                    color="amber"
                                    onClick={handleRecache}
                                    disabled={remapping}
                                    className="w-full"
                                  >
                                    <ArrowPathIcon className="w-4 h-4" />
                                    Recache
                                  </Button>
                                  <Button
                                    color="rose"
                                    onClick={handleUnmap}
                                    disabled={remapping}
                                    className="w-full"
                                  >
                                    <LinkSlashIcon className="w-4 h-4" />
                                    Unmap
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-center flex-1 text-sm text-gv-muted text-center">
                                  No actions available
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Search & Remap Section - Full Width with own scrollbar */}
                          <div className="flex-1 min-h-[300px] flex flex-col space-y-4 pt-4 border-t border-gv-line min-w-0 max-w-full">
                            <div className="flex-shrink-0">
                              <h4 className="text-base font-semibold mb-3 text-gv-text">
                                Search & Remap
                              </h4>
                              <Input
                                type="text"
                                placeholder={`Search ${metadataProviders[selectedMetadataProviderIndex]?.name}...`}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                disabled={remapping}
                              />
                            </div>

                            {searching && (
                              <div className="text-center py-4 text-sm text-gv-muted">
                                Searching...
                              </div>
                            )}

                            {!searching && remapSearchResults.length > 0 && (
                              <div className="flex-1 overflow-y-auto space-y-2 pr-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gv-line [&::-webkit-scrollbar-thumb]:rounded-full min-w-0">
                                {remapSearchResults.map((result, idx) => (
                                  <div
                                    key={idx}
                                    className="relative flex gap-3 p-3 rounded-lg border border-gv-line bg-gv-panel-soft min-w-0 max-w-full overflow-hidden"
                                  >
                                    {result.provider_data_id && (
                                      <div className="absolute top-2 right-2 text-[10px] text-gv-muted text-gv-muted font-mono bg-gv-panel-soft px-1.5 py-0.5 rounded z-10">
                                        ID: {result.provider_data_id}
                                      </div>
                                    )}
                                    {result.cover_url && (
                                      <img
                                        src={result.cover_url}
                                        alt={result.title}
                                        className="w-16 h-20 object-cover rounded flex-shrink-0"
                                        onError={(e) => {
                                          (
                                            e.target as HTMLImageElement
                                          ).style.display = "none";
                                        }}
                                      />
                                    )}
                                    <div className="flex-1 min-w-0 pr-20">
                                      <div className="font-medium text-sm text-gv-text truncate">
                                        {result.title || "Untitled"}
                                      </div>
                                      {result.release_date && (
                                        <div className="text-xs text-gv-muted">
                                          {formatYear(result.release_date)}
                                        </div>
                                      )}
                                      {result.description && (
                                        <div className="text-xs text-gv-muted mt-1 line-clamp-2">
                                          {result.description}
                                        </div>
                                      )}
                                    </div>
                                    <div className="absolute right-2 top-1/2 -translate-y-1/2 mt-5 z-10">
                                      <Button
                                        color="indigo"
                                        onClick={() =>
                                          handleRemapToResult(
                                            result.provider_data_id,
                                          )
                                        }
                                        disabled={
                                          remapping || !result.provider_data_id
                                        }
                                      >
                                        Remap
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "custom-metadata" && (
                  <div className="flex flex-col h-full">
                    {/* Header - fixed */}
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        <h3 className="text-lg font-semibold mb-4 text-gv-text">
                          Custom Metadata
                        </h3>
                        <p className="text-sm text-gv-muted">
                          Add custom fields and override metadata for this
                          workingGame.
                        </p>
                      </div>
                      <Button
                        color="rose"
                        onClick={handleWipeCustomMetadata}
                        disabled={saving}
                      >
                        <PaintBrushIcon className="w-4 h-4" />
                        Wipe CustomMetadata
                      </Button>
                    </div>

                    {/* Scrollable content */}
                    <div className="flex-1 overflow-y-auto pr-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gv-line [&::-webkit-scrollbar-thumb]:rounded-full">
                      <div className="space-y-4">
                        {/* Title */}
                        <div>
                          <label className="block text-sm font-medium text-gv-muted mb-1">
                            Title
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.title}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  title: e.target.value,
                                })
                              }
                              placeholder={getWatermark("title")}
                              className="pr-10"
                            />
                            {getWatermark("title") && (
                              <button
                                type="button"
                                onClick={() => applyWatermark("title")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gv-muted hover:text-gv-text"
                                title="Apply current value"
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Sort Title */}
                        <div>
                          <label className="block text-sm font-medium text-gv-muted mb-1">
                            Sort Title
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.sort_title}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  sort_title: e.target.value,
                                })
                              }
                              placeholder={getWatermark("sort_title")}
                              className="pr-10"
                            />
                            {getWatermark("sort_title") && (
                              <button
                                type="button"
                                onClick={() => applyWatermark("sort_title")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gv-muted hover:text-gv-text"
                                title="Apply current value"
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Description */}
                        <div>
                          <label className="block text-sm font-medium text-gv-muted mb-1">
                            Description
                          </label>
                          <div className="relative">
                            <textarea
                              value={customMetadata.description}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  description: e.target.value,
                                })
                              }
                              placeholder={getWatermark("description")}
                              rows={4}
                              className="w-full rounded-md border border-gv-line-strong bg-gv-panel px-3 py-2 text-sm text-gv-text placeholder:text-gv-muted focus:outline-none focus:ring-2 focus:ring-gv-accent-cool pr-10 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                            />
                            {getWatermark("description") && (
                              <button
                                type="button"
                                onClick={() => applyWatermark("description")}
                                className="absolute right-2 top-2 p-1 text-gv-muted hover:text-gv-text"
                                title="Apply current value"
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Notes */}
                        <div>
                          <label className="block text-sm font-medium text-gv-muted mb-1">
                            Notes
                          </label>
                          <div className="relative">
                            <textarea
                              value={customMetadata.notes}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  notes: e.target.value,
                                })
                              }
                              placeholder={getWatermark("notes")}
                              rows={3}
                              className="w-full rounded-md border border-gv-line-strong bg-gv-panel px-3 py-2 text-sm text-gv-text placeholder:text-gv-muted focus:outline-none focus:ring-2 focus:ring-gv-accent-cool pr-10 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                            />
                            {getWatermark("notes") && (
                              <button
                                type="button"
                                onClick={() => applyWatermark("notes")}
                                className="absolute right-2 top-2 p-1 text-gv-muted hover:text-gv-text"
                                title="Apply current value"
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          {/* Average Playtime */}
                          <div>
                            <label className="block text-sm font-medium text-gv-muted mb-1">
                              Avg Playtime (minutes)
                            </label>
                            <div className="relative">
                              <Input
                                type="number"
                                value={customMetadata.average_playtime}
                                onChange={(e) =>
                                  setCustomMetadata({
                                    ...customMetadata,
                                    average_playtime: e.target.value,
                                  })
                                }
                                placeholder={getWatermark("average_playtime")}
                                className="pr-10"
                              />
                              {getWatermark("average_playtime") && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    applyWatermark("average_playtime")
                                  }
                                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gv-muted hover:text-gv-text"
                                  title="Apply current value"
                                >
                                  <ArrowUturnLeftIcon className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Age Rating */}
                          <div>
                            <label className="block text-sm font-medium text-gv-muted mb-1">
                              Age Rating
                            </label>
                            <div className="relative">
                              <Input
                                type="number"
                                value={customMetadata.age_rating}
                                onChange={(e) =>
                                  setCustomMetadata({
                                    ...customMetadata,
                                    age_rating: e.target.value,
                                  })
                                }
                                placeholder={getWatermark("age_rating")}
                                className="pr-10"
                              />
                              {getWatermark("age_rating") && (
                                <button
                                  type="button"
                                  onClick={() => applyWatermark("age_rating")}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gv-muted hover:text-gv-text"
                                  title="Apply current value"
                                >
                                  <ArrowUturnLeftIcon className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Release Date */}
                          <div>
                            <label className="block text-sm font-medium text-gv-muted mb-1">
                              Release Date
                            </label>
                            <div className="relative">
                              <Input
                                type="date"
                                value={customMetadata.release_date}
                                onChange={(e) =>
                                  setCustomMetadata({
                                    ...customMetadata,
                                    release_date: e.target.value,
                                  })
                                }
                                placeholder={getWatermark("release_date")}
                                className="pr-10"
                              />
                              {getWatermark("release_date") && (
                                <button
                                  type="button"
                                  onClick={() => applyWatermark("release_date")}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gv-muted hover:text-gv-text"
                                  title="Apply current value"
                                >
                                  <ArrowUturnLeftIcon className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                            {getWatermark("release_date") &&
                              !customMetadata.release_date && (
                                <p className="mt-1 text-xs text-gv-muted">
                                  Current:{" "}
                                  {formatDate(getWatermark("release_date"))}
                                </p>
                              )}
                          </div>

                          {/* Rating */}
                          <div>
                            <label className="block text-sm font-medium text-gv-muted mb-1">
                              Rating
                            </label>
                            <div className="relative">
                              <Input
                                type="number"
                                step="0.1"
                                value={customMetadata.rating}
                                onChange={(e) =>
                                  setCustomMetadata({
                                    ...customMetadata,
                                    rating: e.target.value,
                                  })
                                }
                                placeholder={getWatermark("rating")}
                                className="pr-10"
                              />
                              {getWatermark("rating") && (
                                <button
                                  type="button"
                                  onClick={() => applyWatermark("rating")}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gv-muted hover:text-gv-text"
                                  title="Apply current value"
                                >
                                  <ArrowUturnLeftIcon className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Early Access */}
                        <div>
                          <label className="block text-sm font-medium text-gv-muted mb-1">
                            Early Access
                          </label>
                          <Listbox
                            value={customMetadata.early_access || null}
                            onChange={(value) =>
                              setCustomMetadata({
                                ...customMetadata,
                                early_access: value as string,
                              })
                            }
                            placeholder={
                              getWatermark("early_access")
                                ? `Current: ${getWatermark("early_access")}`
                                : "Select..."
                            }
                          >
                            <ListboxOption value="true">
                              <ListboxLabel>True</ListboxLabel>
                            </ListboxOption>
                            <ListboxOption value="false">
                              <ListboxLabel>False</ListboxLabel>
                            </ListboxOption>
                          </Listbox>
                        </div>

                        {/* Launch Executable */}
                        <div>
                          <label className="block text-sm font-medium text-gv-muted mb-1">
                            Default Launch Executable
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.launch_executable}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  launch_executable: e.target.value,
                                })
                              }
                              placeholder={getWatermark("launch_executable")}
                              className="pr-10"
                            />
                            {getWatermark("launch_executable") && (
                              <button
                                type="button"
                                onClick={() =>
                                  applyWatermark("launch_executable")
                                }
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gv-muted hover:text-gv-text"
                                title="Apply current value"
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Launch Parameters */}
                        <div>
                          <label className="block text-sm font-medium text-gv-muted mb-1">
                            Default Launch Parameters
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.launch_parameters}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  launch_parameters: e.target.value,
                                })
                              }
                              placeholder={getWatermark("launch_parameters")}
                              className="pr-10"
                            />
                            {getWatermark("launch_parameters") && (
                              <button
                                type="button"
                                onClick={() =>
                                  applyWatermark("launch_parameters")
                                }
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gv-muted hover:text-gv-text"
                                title="Apply current value"
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Installer Executable */}
                        <div>
                          <label className="block text-sm font-medium text-gv-muted mb-1">
                            Default Installer Executable
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.installer_executable}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  installer_executable: e.target.value,
                                })
                              }
                              placeholder={getWatermark("installer_executable")}
                              className="pr-10"
                            />
                            {getWatermark("installer_executable") && (
                              <button
                                type="button"
                                onClick={() =>
                                  applyWatermark("installer_executable")
                                }
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gv-muted hover:text-gv-text"
                                title="Apply current value"
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Installer Parameters */}
                        <div>
                          <label className="block text-sm font-medium text-gv-muted mb-1">
                            Default Installer Parameters
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.installer_parameters}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  installer_parameters: e.target.value,
                                })
                              }
                              placeholder={getWatermark("installer_parameters")}
                              className="pr-10"
                            />
                            {getWatermark("installer_parameters") && (
                              <button
                                type="button"
                                onClick={() =>
                                  applyWatermark("installer_parameters")
                                }
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gv-muted hover:text-gv-text"
                                title="Apply current value"
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Uninstaller Executable */}
                        <div>
                          <label className="block text-sm font-medium text-gv-muted mb-1">
                            Default Uninstaller Executable
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.uninstaller_executable}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  uninstaller_executable: e.target.value,
                                })
                              }
                              placeholder={getWatermark(
                                "uninstaller_executable",
                              )}
                              className="pr-10"
                            />
                            {getWatermark("uninstaller_executable") && (
                              <button
                                type="button"
                                onClick={() =>
                                  applyWatermark("uninstaller_executable")
                                }
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gv-muted hover:text-gv-text"
                                title="Apply current value"
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Uninstaller Parameters */}
                        <div>
                          <label className="block text-sm font-medium text-gv-muted mb-1">
                            Default Uninstaller Parameters
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.uninstaller_parameters}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  uninstaller_parameters: e.target.value,
                                })
                              }
                              placeholder={getWatermark(
                                "uninstaller_parameters",
                              )}
                              className="pr-10"
                            />
                            {getWatermark("uninstaller_parameters") && (
                              <button
                                type="button"
                                onClick={() =>
                                  applyWatermark("uninstaller_parameters")
                                }
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gv-muted hover:text-gv-text"
                                title="Apply current value"
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Website URLs */}
                        <div>
                          <label className="block text-sm font-medium text-gv-muted mb-1">
                            Website URLs{" "}
                            <span className="text-xs text-gv-muted">
                              (comma-separated)
                            </span>
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.url_websites}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  url_websites: e.target.value,
                                })
                              }
                              placeholder={getWatermark("url_websites")}
                              className="pr-10"
                            />
                            {getWatermark("url_websites") && (
                              <button
                                type="button"
                                onClick={() => applyWatermark("url_websites")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gv-muted hover:text-gv-text"
                                title="Apply current value"
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Genres */}
                        <div>
                          <label className="block text-sm font-medium text-gv-muted mb-1">
                            Genres{" "}
                            <span className="text-xs text-gv-muted">
                              (comma-separated)
                            </span>
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.genres}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  genres: e.target.value,
                                })
                              }
                              placeholder={getWatermark("genres")}
                              className="pr-10"
                            />
                            {getWatermark("genres") && (
                              <button
                                type="button"
                                onClick={() => applyWatermark("genres")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gv-muted hover:text-gv-text"
                                title="Apply current value"
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Tags */}
                        <div>
                          <label className="block text-sm font-medium text-gv-muted mb-1">
                            Tags{" "}
                            <span className="text-xs text-gv-muted">
                              (comma-separated)
                            </span>
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.tags}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  tags: e.target.value,
                                })
                              }
                              placeholder={getWatermark("tags")}
                              className="pr-10"
                            />
                            {getWatermark("tags") && (
                              <button
                                type="button"
                                onClick={() => applyWatermark("tags")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gv-muted hover:text-gv-text"
                                title="Apply current value"
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Publishers */}
                        <div>
                          <label className="block text-sm font-medium text-gv-muted mb-1">
                            Publishers{" "}
                            <span className="text-xs text-gv-muted">
                              (comma-separated)
                            </span>
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.publishers}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  publishers: e.target.value,
                                })
                              }
                              placeholder={getWatermark("publishers")}
                              className="pr-10"
                            />
                            {getWatermark("publishers") && (
                              <button
                                type="button"
                                onClick={() => applyWatermark("publishers")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gv-muted hover:text-gv-text"
                                title="Apply current value"
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Developers */}
                        <div>
                          <label className="block text-sm font-medium text-gv-muted mb-1">
                            Developers{" "}
                            <span className="text-xs text-gv-muted">
                              (comma-separated)
                            </span>
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.developers}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  developers: e.target.value,
                                })
                              }
                              placeholder={getWatermark("developers")}
                              className="pr-10"
                            />
                            {getWatermark("developers") && (
                              <button
                                type="button"
                                onClick={() => applyWatermark("developers")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gv-muted hover:text-gv-text"
                                title="Apply current value"
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Trailer URLs */}
                        <div>
                          <label className="block text-sm font-medium text-gv-muted mb-1">
                            Trailer URLs{" "}
                            <span className="text-xs text-gv-muted">
                              (comma-separated)
                            </span>
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.url_trailers}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  url_trailers: e.target.value,
                                })
                              }
                              placeholder={getWatermark("url_trailers")}
                              className="pr-10"
                            />
                            {getWatermark("url_trailers") && (
                              <button
                                type="button"
                                onClick={() => applyWatermark("url_trailers")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gv-muted hover:text-gv-text"
                                title="Apply current value"
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Gameplay URLs */}
                        <div>
                          <label className="block text-sm font-medium text-gv-muted mb-1">
                            Gameplay URLs{" "}
                            <span className="text-xs text-gv-muted">
                              (comma-separated)
                            </span>
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.url_gameplays}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  url_gameplays: e.target.value,
                                })
                              }
                              placeholder={getWatermark("url_gameplays")}
                              className="pr-10"
                            />
                            {getWatermark("url_gameplays") && (
                              <button
                                type="button"
                                onClick={() => applyWatermark("url_gameplays")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gv-muted hover:text-gv-text"
                                title="Apply current value"
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Screenshot URLs */}
                        <div>
                          <label className="block text-sm font-medium text-gv-muted mb-1">
                            Screenshot URLs{" "}
                            <span className="text-xs text-gv-muted">
                              (comma-separated)
                            </span>
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.url_screenshots}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  url_screenshots: e.target.value,
                                })
                              }
                              placeholder={getWatermark("url_screenshots")}
                              className="pr-10"
                            />
                            {getWatermark("url_screenshots") && (
                              <button
                                type="button"
                                onClick={() =>
                                  applyWatermark("url_screenshots")
                                }
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gv-muted hover:text-gv-text"
                                title="Apply current value"
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Fixed save button at bottom */}
                    <div className="flex justify-end pt-4 mt-4">
                      <Button
                        color="indigo"
                        onClick={saveCustomMetadata}
                        disabled={savingCustomMetadata}
                      >
                        {savingCustomMetadata
                          ? "Saving..."
                          : "Save Custom Metadata"}
                      </Button>
                    </div>
                  </div>
                )}

                {activeTab === "installation" && installedGame && (
                  <div className="max-w-3xl space-y-6">
                    <div>
                      <h3 className="text-lg font-semibold text-gv-text">
                        Installation
                      </h3>
                      <p className="mt-2 text-sm text-gv-muted">
                        here you can manage your Game Installation
                      </p>
                    </div>

                    <div className="rounded-xl border border-gv-line bg-gv-panel-soft p-4">
                      <div className="text-sm font-medium text-gv-text">
                        This Game was installed to
                      </div>
                      <div className="mt-3 rounded-lg border border-gv-line bg-gv-panel px-3 py-2 font-mono text-xs text-gv-text">
                        {installedGame.installationDirectory}
                      </div>
                      {installedGame.versionName && (
                        <p className="mt-3 text-xs text-gv-muted">
                          Installed version: {installedGame.versionName}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <Button
                        color="zinc"
                        onClick={handleOpenInstallationDirectory}
                        disabled={uninstalling}
                      >
                        <FolderOpenIcon className="w-4 h-4" />
                        Open Directory
                      </Button>
                      <Button
                        color="rose"
                        onClick={handleUninstallGame}
                        disabled={uninstalling}
                      >
                        <TrashIcon className="w-4 h-4" />
                        {uninstalling ? "Uninstalling..." : "Uninstall Game"}
                      </Button>
                    </div>

                    <DiskUsageChart
                      data={diskUsageData}
                      loading={diskUsageLoading}
                      gameTitle={
                        workingGame.metadata?.title ||
                        workingGame.title ||
                        installedGame.gameTitle
                      }
                      rootPath={diskUsageRoot?.path}
                    />
                  </div>
                )}

                {activeTab === "launch-options" && installedGame && (
                  <div className="max-w-3xl space-y-6">
                    <div>
                      <h3 className="text-lg font-semibold text-gv-text">
                        Launch Options
                      </h3>
                      <p className="mt-1 text-sm text-gv-muted">
                        Configure how this game is launched when you click the
                        play button.
                      </p>
                    </div>

                    {loadingLaunchOptions ? (
                      <div className="text-sm text-gv-muted">
                        Loading executables…
                      </div>
                    ) : (
                      <>
                        {/* Launch Executable Picker */}
                        <div>
                          <label className="block text-sm font-medium text-gv-muted mb-1">
                            Launch Executable
                          </label>
                          {launchExecutables.length === 0 ? (
                            <div className="space-y-3">
                              <p className="text-sm text-gv-muted">
                                No executables found in the installation folder.
                              </p>
                              {nonExecutableScripts.length > 0 && (
                                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                                  <p className="text-sm text-amber-700 dark:text-amber-300">
                                    Found {nonExecutableScripts.length}{" "}
                                    {nonExecutableScripts.length === 1
                                      ? "shell script"
                                      : "shell scripts"}{" "}
                                    that is missing the executable (
                                    <code className="font-mono">+x</code>)
                                    permission.
                                  </p>
                                  <Button
                                    color="amber"
                                    onClick={handleMakeExecutable}
                                    disabled={makingExecutable}
                                    className="mt-3"
                                  >
                                    {makingExecutable
                                      ? "Making executable…"
                                      : "Make executable"}
                                  </Button>
                                </div>
                              )}
                            </div>
                          ) : (
                            <Listbox
                              name="launchExe"
                              value={selectedLaunchExe}
                              onChange={(v: any) =>
                                setSelectedLaunchExe(String(v))
                              }
                            >
                              <ListboxOption value="">
                                <ListboxLabel>-- Select executable --</ListboxLabel>
                              </ListboxOption>
                              {launchExecutables.map((exe) => (
                                <ListboxOption key={exe} value={exe}>
                                  <ListboxLabel>{exe}</ListboxLabel>
                                </ListboxOption>
                              ))}
                            </Listbox>
                          )}
                        </div>

                        {isWindowsLaunchExe && (
                          <>
                            <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3">
                              <p className="text-sm text-indigo-700 dark:text-indigo-300">
                                This is a Windows executable — it will be run
                                with umu-launcher (Wine/Proton) on Linux.
                              </p>
                              {!umuStatus?.installed && (
                                <Button
                                  color="indigo"
                                  onClick={() => void handleInstallUmu()}
                                  disabled={installingUmu}
                                  className="mt-3"
                                >
                                  {installingUmu
                                    ? "Installing umu-launcher…"
                                    : "Install umu-launcher"}
                                </Button>
                              )}
                            </div>

                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                              <div>
                                <label className="block text-sm font-medium text-gv-muted mb-1">
                                  Game ID (GAMEID)
                                </label>
                                <Input
                                  name="umuGameId"
                                  value={umuGameId}
                                  onChange={(e: any) =>
                                    setUmuGameId(e.target.value)
                                  }
                                  placeholder="umu-default"
                                />
                                <p className="mt-1 text-xs text-gv-muted">
                                  Optional umu-database ID so protonfixes apply
                                  automatically.
                                </p>
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gv-muted mb-1">
                                  Store (STORE)
                                </label>
                                <Input
                                  name="umuStore"
                                  value={umuStore}
                                  onChange={(e: any) =>
                                    setUmuStore(e.target.value)
                                  }
                                  placeholder="e.g. gog, epic, ubisoft-connect"
                                />
                                <p className="mt-1 text-xs text-gv-muted">
                                  Storefront used together with GAMEID to look
                                  up fixes.
                                </p>
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gv-muted mb-1">
                                  Proton (PROTONPATH)
                                </label>
                                <Input
                                  name="umuProtonPath"
                                  value={umuProtonPath}
                                  onChange={(e: any) =>
                                    setUmuProtonPath(e.target.value)
                                  }
                                  placeholder="UMU-Proton"
                                />
                                <p className="mt-1 text-xs text-gv-muted">
                                  Proton directory, version name
                                  (GE-Proton9-5) or codename (GE-Proton).
                                </p>
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gv-muted mb-1">
                                  Wine Prefix (WINEPREFIX)
                                </label>
                                <Input
                                  name="umuWinePrefix"
                                  value={umuWinePrefix}
                                  onChange={(e: any) =>
                                    setUmuWinePrefix(e.target.value)
                                  }
                                  placeholder="~/.local/share/GameVault/umu"
                                />
                                <p className="mt-1 text-xs text-gv-muted">
                                  Where the Wine prefix lives. Defaults to
                                  $HOME/Games/umu/&lt;GAMEID&gt;.
                                </p>
                              </div>
                            </div>
                          </>
                        )}

                        {/* Launch Parameters */}
                        <div>
                          <label className="block text-sm font-medium text-gv-muted mb-1">
                            Launch Parameters
                          </label>
                          <Input
                            name="launchParams"
                            value={launchParams}
                            onChange={(e: any) =>
                              setLaunchParams(e.target.value)
                            }
                            placeholder="e.g. -fullscreen -width 1920"
                          />
                          <p className="mt-1 text-xs text-gv-muted">
                            Optional command-line arguments passed to the
                            executable.
                          </p>
                        </div>

                        {/* Run as Admin */}
                        <div>                         
                          <SwitchField>
                            <Switch
                              name="launchAsAdmin"
                              color="indigo"
                              aria-label="Run as Administrator"
                              checked={launchAsAdmin}
                              onChange={(v: boolean) => setLaunchAsAdmin(v)}
                            />
                            <Label>Run as Administrator</Label>
                          </SwitchField>
                          <p className="mt-1 ml-0 text-xs text-gv-muted">
                            Launch the game with elevated privileges (UAC on
                            Windows, root prompt on Linux).
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </DialogBody>
            </div>
          </div>

          {/* Bottom left info */}
          <div className="absolute bottom-4 left-4 text-xs text-gv-muted flex flex-row gap-4 lg:flex-col lg:gap-0 lg:space-y-0.5">
            <div className="truncate max-w-[200px] lg:max-w-none">
              {workingGame.metadata?.title || workingGame.title || "Unknown"}
            </div>
            <div>ID: {workingGame.id}</div>
            <div>
              Latest version:{" "}
              {workingGame.versions?.[0]?.version ||
                workingGame.version ||
                "N/A"}
            </div>
            {installedGame?.versionName && (
              <div>Installed version: {installedGame.versionName}</div>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
