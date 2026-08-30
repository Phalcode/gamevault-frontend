import clsx from "clsx";
import { useSearchParams } from "react-router";
import { Divider } from "@tw/divider";
import { Heading } from "@tw/heading";
import { Input, InputGroup } from "@tw/input";
import {
  useDownloads,
  type SimulatedDownloadKind,
} from "@/context/DownloadContext";
import { useIgnoreList } from "@/context/IgnoreListContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import { useAppUpdater } from "@/context/AppUpdaterContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { Switch } from "@tw/switch";
import { Text } from "@/components/tailwind/text";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import {
  isTauriApp,
  isDebugTauriOverride,
  setDebugTauriOverride,
} from "@/utils/tauri";
import { Button } from "@/components/tailwind/button";
import { Listbox, ListboxLabel, ListboxOption } from "@tw/listbox";
import ThemeSelect from "@/components/ThemeSelect";
import ZoomControl from "@/components/ZoomControl";
import BackButton from "@/components/BackButton";
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogTitle,
} from "@/components/tailwind/dialog";
import { isAnalyticsEnabled, setAnalyticsEnabled } from "@/utils/analytics";
import { clearImageCache } from "@/utils/mediaCache";
import { playSound } from "@/utils/audio";
import { VolumeControl } from "@/components/VolumeControl";
import {
  type RootPathEntry,
  getRootPaths,
  addRootPath,
  removeRootPath,
  updateRootPath,
  updateRootPathLabel,
} from "@/utils/rootPaths";
import {
  FolderArrowDownIcon,
  ComputerDesktopIcon,
  ShieldCheckIcon,
  SwatchIcon,
  ArrowPathIcon,
  SparklesIcon,
  ExclamationTriangleIcon,
  WrenchIcon,
  EyeSlashIcon,
  InformationCircleIcon,
  ChevronRightIcon,
  ClipboardDocumentIcon,
  PlusIcon,
  PencilSquareIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
  FolderIcon,
  TrashIcon,
  SpeakerWaveIcon,
} from "@heroicons/react/24/outline";

const AUTOSTART_MINIMIZED_KEY = "tauri_start_minimized";
const MINIMIZE_ON_GAME_LAUNCH_KEY = "tauri_minimize_on_game_launch";
const AUTO_EXTRACT_KEY = "tauri_auto_extract";
const AUTO_INSTALL_KEY = "tauri_auto_install";
const AUTO_DELETE_SOURCE_KEY = "tauri_auto_delete_source";
const DEV_TOOLS_KEY = "gv_dev_tools_unlocked";

const SENSITIVE_KEY_PATTERN = /token|password|secret|auth|refresh|credential/i;

const SIMULATED_DOWNLOAD_KINDS: {
  kind: SimulatedDownloadKind;
  label: string;
}[] = [
  { kind: "downloading", label: "Downloading" },
  { kind: "paused", label: "Paused" },
  { kind: "error", label: "Error" },
  { kind: "aborted", label: "Aborted" },
  { kind: "completed", label: "Completed" },
  { kind: "installing", label: "Installing" },
];

interface ThirdPartyLicense {
  name: string;
  version: string;
  licenses: string;
  repository: string | null;
  url: string | null;
  licenseText: string;
}

interface LicensesData {
  generatedAt: string;
  packages: ThirdPartyLicense[];
}

type SettingsCategory =
  | "downloads"
  | "appearance"
  | "sound"
  | "startup"
  | "games"
  | "privacy"
  | "about"
  | "developer";

const CATEGORY_META: Record<
  SettingsCategory,
  {
    label: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  downloads: {
    label: "Downloads",
    description: "Where and how games are downloaded.",
    icon: FolderArrowDownIcon,
  },
  appearance: {
    label: "Appearance",
    description: "How the app looks.",
    icon: SwatchIcon,
  },
  sound: {
    label: "Sound",
    description: "Sound effects and volume.",
    icon: SpeakerWaveIcon,
  },
  startup: {
    label: "Startup",
    description: "How the app starts with your computer.",
    icon: ComputerDesktopIcon,
  },
  games: {
    label: "Games",
    description: "How the app behaves when you play games.",
    icon: GamepadIcon,
  },
  privacy: {
    label: "Privacy",
    description: "What information the app shares.",
    icon: ShieldCheckIcon,
  },
  about: {
    label: "About",
    description: "Version, licenses and system info.",
    icon: InformationCircleIcon,
  },
  developer: {
    label: "Developer Tools",
    description: "Tools for development.",
    icon: WrenchIcon,
  },
};

interface SearchableSetting {
  /** Stable identifier, also used as the scroll/highlight target. */
  id: string;
  title: string;
  description?: string;
  category: SettingsCategory;
  keywords: string[];
  /** Only shown in the desktop (Tauri) app. Hidden from search on the web build. */
  desktopOnly?: boolean;
}

/**
 * Flat index of every individual setting, used by the settings search bar to
 * surface results that map back to their owning category.
 */
const SETTINGS_SEARCH_INDEX: SearchableSetting[] = [
  // Downloads
  {
    id: "downloads-locations",
    title: "Download locations",
    description: "Folders where games are stored",
    category: "downloads",
    keywords: ["location", "folder", "directory", "path", "storage"],
    desktopOnly: true,
  },
  {
    id: "downloads-speed-limit",
    title: "Download speed limit",
    description: "Limit download bandwidth. 0 means no limit.",
    category: "downloads",
    keywords: ["speed", "limit", "bandwidth", "throttle", "kb"],
  },
  {
    id: "downloads-auto-extract",
    title: "Auto-Extract Downloads",
    description: "Unpack archives right after downloading",
    category: "downloads",
    keywords: ["extract", "unpack", "archive", "zip", "rar"],
    desktopOnly: true,
  },
  {
    id: "downloads-auto-install",
    title: "Auto-Install Games",
    description: "Start installers or copy portable files automatically",
    category: "downloads",
    keywords: ["install", "installer", "setup", "portable"],
    desktopOnly: true,
  },
  {
    id: "downloads-auto-delete-source",
    title: "Auto-Delete Source Files",
    description: "Clean up downloads after installation to free space",
    category: "downloads",
    keywords: ["delete", "cleanup", "space", "source", "files"],
    desktopOnly: true,
  },
  {
    id: "downloads-clear-image-cache",
    title: "Clear image cache",
    description: "Remove cached covers and background images",
    category: "downloads",
    keywords: ["cache", "images", "covers", "backgrounds", "clear"],
  },
  // Appearance
  {
    id: "appearance-theme",
    title: "Theme",
    description: "Choose light, dark, or follow your device",
    category: "appearance",
    keywords: ["theme", "dark", "light", "mode", "color"],
  },
  {
    id: "appearance-zoom",
    title: "Zoom",
    description: "Zoom the interface in or out",
    category: "appearance",
    keywords: ["zoom", "scale", "size", "font", "ui"],
  },
  // Sound
  {
    id: "sound-volume",
    title: "Volume",
    description: "Master volume for GameVault sounds",
    category: "sound",
    keywords: ["volume", "sound", "audio", "mute", "effects"],
  },
  {
    id: "sound-test",
    title: "Test sound",
    description: "Play a preview at the current volume",
    category: "sound",
    keywords: ["sound", "test", "preview", "audio"],
  },
  // Startup
  {
    id: "startup-autostart",
    title: "Launch GameVault on Computer Startup",
    description: "Automatically start GameVault when you log in",
    category: "startup",
    keywords: ["autostart", "startup", "boot", "launch", "login"],
    desktopOnly: true,
  },
  {
    id: "startup-start-minimized",
    title: "Minimize to System Tray on Startup",
    description: "Start silently in the tray instead of opening the window",
    category: "startup",
    keywords: ["startup", "minimize", "tray", "background", "hidden"],
    desktopOnly: true,
  },
  // Games
  {
    id: "games-minimize-on-launch",
    title: "Minimize when launching a game",
    description: "Hide GameVault while a game runs and restore it on quit",
    category: "games",
    keywords: ["minimize", "launch", "game", "tray", "playing", "restore"],
    desktopOnly: true,
  },
  {
    id: "games-ignore-list",
    title: "Ignore List",
    description: "Files GameVault should skip completely",
    category: "games",
    keywords: ["ignore", "hidden", "executables", "skip", "setup"],
    desktopOnly: true,
  },
  // Privacy
  {
    id: "privacy-analytics",
    title: "Usage analytics",
    description: "Help make GameVault better",
    category: "privacy",
    keywords: ["analytics", "privacy", "telemetry", "usage", "anonymous"],
  },
  // About
  {
    id: "about-version",
    title: "Application Version",
    description: "The installed GameVault version",
    category: "about",
    keywords: ["version", "build", "app"],
  },
  {
    id: "about-license",
    title: "License",
    description: "GameVault is licensed under CC BY-NC-SA 4.0",
    category: "about",
    keywords: ["license", "legal", "cc"],
  },
  {
    id: "about-open-source-licenses",
    title: "Open Source Licenses",
    description: "Third-party libraries used by GameVault",
    category: "about",
    keywords: ["open source", "licenses", "third-party", "libraries"],
  },
  {
    id: "about-updates",
    title: "Updates",
    description: "Update channel and auto-update status",
    category: "about",
    keywords: ["update", "updater", "channel", "version", "stable"],
    desktopOnly: true,
  },
  {
    id: "about-system",
    title: "System information",
    description: "Platform, operating system and hardware details",
    category: "about",
    keywords: ["system", "info", "os", "platform", "hardware", "cpu"],
  },
  // Developer
  {
    id: "developer-simulate-desktop",
    title: "Simulate Desktop App",
    description: "Preview GameVault as a native desktop application",
    category: "developer",
    keywords: ["simulate", "desktop", "tauri", "debug"],
  },
  {
    id: "developer-simulate-outage",
    title: "Simulate Network Outage",
    description: "Force an offline state to test error banners",
    category: "developer",
    keywords: ["network", "offline", "outage", "simulate", "error"],
  },
  {
    id: "developer-toasts",
    title: "Toast Notifications",
    description: "Preview each toast tone",
    category: "developer",
    keywords: ["toast", "notification", "snackbar", "preview"],
  },
  {
    id: "developer-simulate-download",
    title: "Simulate Download Status",
    description: "Preview each download state without a real download",
    category: "developer",
    keywords: ["download", "simulate", "status", "test"],
  },
  {
    id: "developer-build-info",
    title: "Build Info",
    description: "Version, channel and environment",
    category: "developer",
    keywords: ["build", "version", "channel", "environment"],
  },
  {
    id: "developer-settings-dump",
    title: "Copy Settings Dump",
    description: "Export all preferences as JSON for bug reports",
    category: "developer",
    keywords: ["settings", "dump", "export", "copy", "json", "diagnostics"],
  },
];

/**
 * Gamepad icon in the Heroicons outline style (24x24, 1.5 stroke). Heroicons
 * has no native controller glyph, so this keeps the "Games" category on-theme.
 */
function GamepadIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M6.5 7h11a4.5 4.5 0 0 1 4.3 5.7l-.9 3A3.5 3.5 0 0 1 13.5 17l-.7-1h-1.6l-.7 1a3.5 3.5 0 0 1-7.4-1.3l-.9-3A4.5 4.5 0 0 1 6.5 7Z" />
      <path d="M8.5 10.5v3" />
      <path d="M7 12h3" />
      <circle cx="15.5" cy="11" r="1" />
      <circle cx="17.5" cy="13" r="1" />
    </svg>
  );
}

/**
 * Grouped settings list, iOS Settings style: a rounded container with
 * hairline dividers and a small uppercase group caption above it.
 */
function SettingsGroup({
  caption,
  description,
  children,
  className,
  id,
}: {
  caption?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div className={clsx(className)} id={id}>
      {caption && (
        <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-gv-muted">
          {caption}
        </p>
      )}
      {description && (
        <p className="mb-2 px-1 text-xs leading-5 text-gv-muted">
          {description}
        </p>
      )}
      <div className="divide-y divide-gv-line overflow-hidden rounded-2xl border border-gv-line bg-gv-panel-strong shadow-sm">
        {children}
      </div>
    </div>
  );
}

/** One row inside a settings group: label + description on the left, control on the right. */
function SettingsRow({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div
      id={id}
      className={clsx(
        "flex min-h-12 items-center justify-between gap-x-4 px-4 py-2.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Left-hand label + optional description for a settings row. */
function SettingsLabel({
  title,
  description,
  className,
}: {
  title: string;
  description?: string | null;
  className?: string;
}) {
  return (
    <div className={clsx("min-w-0 flex-1", className)}>
      <p className="text-sm font-medium text-gv-text">{title}</p>
      {description && (
        <p className="mt-0.5 text-xs leading-5 text-gv-muted">{description}</p>
      )}
    </div>
  );
}

/** Section heading shown above the groups of the active category. */
function SettingsSectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gv-panel-soft text-gv-accent ring-1 ring-gv-line">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 pt-0.5">
        <h2 className="text-base font-semibold tracking-[-0.01em] text-gv-text">
          {title}
        </h2>
        {description && (
          <p className="mt-0.5 text-xs text-gv-muted sm:text-sm">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

/** Row that opens an external URL in the default browser (Tauri) or a new tab (web). */
function AboutLinkRow({
  title,
  value,
  href,
}: {
  title: string;
  value: string;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex min-h-12 w-full cursor-pointer items-center justify-between gap-x-4 px-4 py-2.5 text-left transition-colors hover:bg-gv-panel-soft"
    >
      <SettingsLabel title={title} />
      <span className="flex min-w-0 shrink-0 items-center gap-1.5 text-sm font-medium text-gv-accent">
        <span className="truncate">{value}</span>
        <ChevronRightIcon className="size-3.5 shrink-0 text-gv-muted" />
      </span>
    </a>
  );
}

interface SystemInfo {
  platform: string;
  os: string;
  architecture: string;
  language: string;
  cores: string;
  memory: string;
  screen: string;
  userAgent: string;
}

function collectSystemInfo(isTauri: boolean): SystemInfo {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const uaData = (nav as any)?.userAgentData as
    { platform?: string; architecture?: string; mobile?: boolean } | undefined;

  const os = (uaData?.platform || nav?.platform || "Unknown").trim();
  const architecture = (uaData?.architecture || "").trim();
  const screen =
    typeof window !== "undefined"
      ? `${window.screen.width}x${window.screen.height}`
      : "Unknown";

  return {
    platform: isTauri ? "desktop" : "web",
    os,
    architecture,
    language: nav?.language || "Unknown",
    cores: nav?.hardwareConcurrency
      ? String(nav.hardwareConcurrency)
      : "Unknown",
    memory:
      (nav as any)?.deviceMemory != null
        ? `${(nav as any).deviceMemory} GB`
        : "Unknown",
    screen,
    userAgent: nav?.userAgent || "Unknown",
  };
}

export default function Settings() {
  const {
    speedLimitKB,
    setSpeedLimitKB,
    formatSpeed,
    formatLimit,
    simulateDownload,
  } = useDownloads() as any;
  const kbValue = speedLimitKB;
  const [analyticsConsent, setAnalyticsConsent] = useState<boolean>(() => {
    return isAnalyticsEnabled();
  });
  const [rootPaths, setRootPaths] = useState<RootPathEntry[]>(() =>
    getRootPaths(),
  );
  const [autostartEnabled, setAutostartEnabled] = useState<boolean | null>(
    null,
  );
  const [startMinimized, setStartMinimized] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTOSTART_MINIMIZED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [minimizeOnGameLaunch, setMinimizeOnGameLaunch] = useState<boolean>(
    () => {
      try {
        return localStorage.getItem(MINIMIZE_ON_GAME_LAUNCH_KEY) === "1";
      } catch {
        return false;
      }
    },
  );
  const [autoExtract, setAutoExtract] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTO_EXTRACT_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [autoInstall, setAutoInstall] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTO_INSTALL_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [autoDeleteSource, setAutoDeleteSource] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTO_DELETE_SOURCE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const isTauri = isTauriApp();
  const systemInfo = collectSystemInfo(isTauri);
  const { ignoreList, setIgnoreList } = useIgnoreList();
  const { forceOffline, setForceOffline } = useOnlineStatus();
  const { showAlert } = useAlertDialog();
  const {
    updateChannel,
    updaterEnabled,
    updaterReady,
    isChecking: isCheckingUpdates,
    isInstalling: isInstallingUpdate,
    availableVersion,
    errorText: updaterErrorText,
    statusText: updaterStatusText,
    setUpdateChannel,
    checkForUpdates,
  } = useAppUpdater();
  const [newIgnore, setNewIgnore] = useState("");
  const [ignoreSearch, setIgnoreSearch] = useState("");
  // Deep-link support: `/settings?section=downloads` opens a specific section.
  const [searchParams] = useSearchParams();
  // `null` shows the master list of settings areas; a value drills into it.
  const [activeCategory, setActiveCategory] = useState<SettingsCategory | null>(
    null,
  );
  useEffect(() => {
    const raw = searchParams.get("section");
    // Map legacy section names to the reorganized categories so old
    // deep links (e.g. `?section=desktop`) keep working.
    const legacy: Record<string, SettingsCategory> = {
      desktop: "startup",
      general: "startup",
      library: "downloads",
      ignore: "games",
    };
    const section = (raw && legacy[raw]) || (raw as SettingsCategory | null);
    setActiveCategory(section && section in CATEGORY_META ? section : null);
  }, [searchParams]);
  // Settings search: free-text query, the matched settings, and the target we
  // scroll/highlight to when a result is chosen.
  const [searchQuery, setSearchQuery] = useState("");
  const [scrollToSetting, setScrollToSetting] = useState<string | null>(null);
  const [highlightedSetting, setHighlightedSetting] = useState<string | null>(
    null,
  );

  const trimmedQuery = searchQuery.trim().toLowerCase();
  // On the web build, desktop-only settings don't exist, so never suggest them.
  const searchableSettings = isTauri
    ? SETTINGS_SEARCH_INDEX
    : SETTINGS_SEARCH_INDEX.filter((s) => !s.desktopOnly);
  const matchesQuery = (s: SearchableSetting) =>
    s.title.toLowerCase().includes(trimmedQuery) ||
    (s.description?.toLowerCase().includes(trimmedQuery) ?? false) ||
    s.keywords.some((k) => k.includes(trimmedQuery));

  const searchResults = trimmedQuery
    ? searchableSettings.filter(matchesQuery)
    : [];

  // Categories that contain at least one matching setting, shown while
  // searching so the user can still jump straight to a whole area.
  const searchResultCategories = trimmedQuery
    ? (Array.from(
        new Set(searchResults.map((s) => s.category)),
      ) as SettingsCategory[])
    : [];

  const isSearching = trimmedQuery.length > 0;

  const openSearchResult = (result: SearchableSetting) => {
    setActiveCategory(result.category);
    setScrollToSetting(result.id);
    setHighlightedSetting(result.id);
    setSearchQuery("");
  };

  /** Subtle flash used when a search result scrolls a setting into view. */
  const rowHighlight = (searchableId: string) =>
    highlightedSetting === searchableId ? "bg-gv-accent/10" : "";

  // When a search result opens a category, wait for it to render, then scroll
  // the target setting into view and flash a highlight ring around it.
  useEffect(() => {
    if (!activeCategory || !scrollToSetting) return;
    const id = `setting-${scrollToSetting}`;
    const timer = window.setTimeout(() => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      window.setTimeout(() => setHighlightedSetting(null), 1600);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [activeCategory, scrollToSetting]);

  const [licensesOpen, setLicensesOpen] = useState(false);
  const [licenseData, setLicenseData] = useState<LicensesData | null>(null);
  const [expandedLicense, setExpandedLicense] = useState<string | null>(null);
  const [licenseExpanded, setLicenseExpanded] = useState(false);
  const [gameVaultLicense, setGameVaultLicense] = useState<string | null>(null);
  const [devToolsUnlocked, setDevToolsUnlocked] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DEV_TOOLS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const versionClickCount = useRef(0);
  const versionClickTimer = useRef<number | null>(null);
  const [editingRootId, setEditingRootId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");

  // Initialize autostart state from the Tauri plugin
  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    (async () => {
      try {
        const { isEnabled } = await import("@tauri-apps/plugin-autostart");
        const enabled = await isEnabled();
        if (!cancelled) setAutostartEnabled(enabled);
      } catch (e) {
        console.error("Failed to check autostart status:", e);
        if (!cancelled) setAutostartEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isTauri]);

  // Sync startMinimized to Rust backend config file
  useEffect(() => {
    if (!isTauri) return;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("set_start_minimized", { minimized: startMinimized });
      } catch (e) {
        console.error("Failed to sync start minimized preference:", e);
      }
    })();
  }, [startMinimized, isTauri]);

  // Persist startMinimized to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(AUTOSTART_MINIMIZED_KEY, startMinimized ? "1" : "0");
    } catch {
      console.warn("Failed to persist start minimized preference");
    }
  }, [startMinimized]);

  // Sync minimizeOnGameLaunch to the Rust backend config file
  useEffect(() => {
    if (!isTauri) return;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("set_minimize_on_game_launch", {
          minimizeOnLaunch: minimizeOnGameLaunch,
        });
      } catch (e) {
        console.error("Failed to sync minimize on game launch preference:", e);
      }
    })();
  }, [minimizeOnGameLaunch, isTauri]);

  // Persist minimizeOnGameLaunch to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        MINIMIZE_ON_GAME_LAUNCH_KEY,
        minimizeOnGameLaunch ? "1" : "0",
      );
    } catch {
      console.warn("Failed to persist minimize on game launch preference");
    }
  }, [minimizeOnGameLaunch]);

  // Persist auto-flow settings to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(AUTO_EXTRACT_KEY, autoExtract ? "1" : "0");
    } catch {
      console.warn("Failed to persist auto-extract preference");
    }
  }, [autoExtract]);

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_INSTALL_KEY, autoInstall ? "1" : "0");
    } catch {
      console.warn("Failed to persist auto-install preference");
    }
  }, [autoInstall]);

  useEffect(() => {
    try {
      localStorage.setItem(
        AUTO_DELETE_SOURCE_KEY,
        autoDeleteSource ? "1" : "0",
      );
    } catch {
      console.warn("Failed to persist auto-delete preference");
    }
  }, [autoDeleteSource]);

  const handleSpeedChange = (raw: number) => {
    if (Number.isNaN(raw) || raw <= 0) {
      setSpeedLimitKB(0);
    } else {
      setSpeedLimitKB(raw);
    }
  };

  const handleAddRootPath = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isTauri) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Download Directory",
      });
      if (selected && typeof selected === "string") {
        const updated = addRootPath(selected);
        setRootPaths(updated);

        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const { join } = await import("@tauri-apps/api/path");
          const gameVaultRoot = await join(selected, "GameVault");
          await invoke("fs_create_dir_all", { path: gameVaultRoot });
        } catch {
          // Folder creation is best-effort; settings save succeeded
        }
      }
    } catch (error) {
      console.error("Error selecting download folder:", error);
    }
  };

  const handleBrowseRootPath = async (id: string) => {
    if (!isTauri) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Download Directory",
      });
      if (selected && typeof selected === "string") {
        const updated = updateRootPath(id, selected);
        setRootPaths(updated);

        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const { join } = await import("@tauri-apps/api/path");
          const gameVaultRoot = await join(selected, "GameVault");
          await invoke("fs_create_dir_all", { path: gameVaultRoot });
        } catch {
          // Folder creation is best-effort
        }
      }
    } catch (error) {
      console.error("Error re-selecting download folder:", error);
    }
  };

  const handleRemoveRootPath = (id: string) => {
    const updated = removeRootPath(id);
    setRootPaths(updated);
  };

  const handleLabelChange = (id: string, label: string) => {
    const updated = updateRootPathLabel(id, label);
    setRootPaths(updated);
  };

  const startRenameRootPath = (root: RootPathEntry) => {
    setEditingRootId(root.id);
    setEditingLabel(root.label);
  };

  const commitRenameRootPath = (id: string) => {
    if (editingRootId !== id) return;
    handleLabelChange(id, editingLabel);
    setEditingRootId(null);
    setEditingLabel("");
  };

  const cancelRenameRootPath = () => {
    setEditingRootId(null);
    setEditingLabel("");
  };

  const handleAddIgnore = async () => {
    const name = newIgnore.trim();
    if (!name) return;
    const exists = ignoreList.some(
      (existing) => existing.toLowerCase() === name.toLowerCase(),
    );
    if (exists) {
      setNewIgnore("");
      return;
    }
    await setIgnoreList([...ignoreList, name]);
    setNewIgnore("");
  };

  const handleRemoveIgnore = async (name: string) => {
    await setIgnoreList(ignoreList.filter((existing) => existing !== name));
  };

  const handleClearImageCache = async () => {
    const confirmed = await showAlert({
      title: "Clear image cache?",
      description:
        "This removes all cached game covers and background images. They will be re-downloaded from your server the next time they're shown.",
      affirmativeText: "Clear cache",
      negativeText: "Cancel",
      tone: "warning",
    });
    if (!confirmed) return;

    try {
      const removed = await clearImageCache();
      await showAlert({
        title: "Image cache cleared",
        description:
          removed > 0
            ? `Removed ${removed} cached image${removed === 1 ? "" : "s"}.`
            : "No cached images were found.",
        tone: "success",
      });
    } catch {
      await showAlert({
        title: "Failed to clear cache",
        description: "Something went wrong while clearing the image cache.",
        tone: "danger",
      });
    }
  };

  const handleCopySettingsDump = async () => {
    const settings: Record<string, string | null> = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        settings[key] = SENSITIVE_KEY_PATTERN.test(key)
          ? "[redacted]"
          : localStorage.getItem(key);
      }
    } catch {
      // localStorage unavailable
    }
    const dump = JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        platform: isTauri ? "desktop" : "web",
        version: __APP_VERSION__,
        system: systemInfo,
        settings,
      },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(dump);
      await showAlert({
        title: "Settings dump copied to clipboard",
        tone: "success",
      });
    } catch {
      try {
        const blob = new Blob([dump], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `gamevault-settings-${new Date()
          .toISOString()
          .slice(0, 10)}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        await showAlert({
          title: "Settings dump downloaded as JSON",
          tone: "success",
        });
      } catch {
        await showAlert({
          title: "Couldn't export settings dump",
          tone: "danger",
        });
      }
    }
  };

  const ignoreQuery = ignoreSearch.trim().toLowerCase();
  const filteredIgnoreList = ignoreQuery
    ? ignoreList.filter((name) => name.toLowerCase().includes(ignoreQuery))
    : ignoreList;

  const openLicenses = async () => {
    if (!licenseData) {
      try {
        const mod = await import("@/generated/third-party-licenses.json");
        setLicenseData(mod.default as unknown as LicensesData);
      } catch (e) {
        console.error("Failed to load license data:", e);
        return;
      }
    }
    setLicensesOpen(true);
  };

  const toggleGameVaultLicense = async () => {
    if (!gameVaultLicense) {
      try {
        const mod = await import("../../LICENSE?raw");
        setGameVaultLicense(mod.default as string);
      } catch (e) {
        console.error("Failed to load GameVault license:", e);
        return;
      }
    }
    setLicenseExpanded((v) => !v);
  };

  // Hidden dev-tools unlock: 5 quick clicks on the version number (like
  // Android's build-number taps) reveal the Developer Tools section.
  const handleVersionClick = () => {
    versionClickCount.current += 1;
    if (versionClickTimer.current !== null) {
      window.clearTimeout(versionClickTimer.current);
    }
    versionClickTimer.current = window.setTimeout(() => {
      versionClickCount.current = 0;
    }, 1500);
    if (versionClickCount.current >= 5) {
      versionClickCount.current = 0;
      if (devToolsUnlocked) {
        setDevToolsUnlocked(false);
        try {
          localStorage.removeItem(DEV_TOOLS_KEY);
        } catch {
          // localStorage unavailable
        }
        void showAlert({ title: "Developer Tools locked", tone: "warning" });
      } else {
        setDevToolsUnlocked(true);
        try {
          localStorage.setItem(DEV_TOOLS_KEY, "1");
        } catch {
          // localStorage unavailable
        }
        playSound("unlock");
        void showAlert({ title: "Developer Tools unlocked", tone: "success" });
      }
    }
  };

  useEffect(() => {
    return () => {
      if (versionClickTimer.current !== null) {
        window.clearTimeout(versionClickTimer.current);
      }
    };
  }, []);

  // Flat category list (no group captions); desktop-only entries stay hidden for web users.
  // Category nav order; desktop-only General leads, Developer sits at the end.
  // Ordered most → least used by a typical user. Desktop-only categories are
  // interleaved; on web the desktop ones simply drop out.
  const navCategories: SettingsCategory[] = [
    "appearance",
    "sound",
    "downloads",
    ...(isTauri ? (["games", "startup"] as SettingsCategory[]) : []),
    "privacy",
    "about",
    ...(import.meta.env.DEV || devToolsUnlocked
      ? (["developer"] as SettingsCategory[])
      : []),
  ];

  // During search, present categories in the same order as the nav list.
  const orderedSearchCategories = navCategories.filter((c) =>
    searchResultCategories.includes(c),
  );

  const renderCategoryRow = (id: SettingsCategory, index: number) => {
    const meta = CATEGORY_META[id];
    const Icon = meta.icon;
    return (
      <motion.button
        key={id}
        type="button"
        onClick={() => setActiveCategory(id)}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          delay: 0.05 + index * 0.04,
          duration: 0.22,
          ease: [0.23, 1, 0.32, 1],
        }}
        className="group flex w-full min-h-12 cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-gv-panel-soft"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gv-panel-soft text-gv-accent ring-1 ring-gv-line transition-colors group-hover:bg-gv-accent/15">
          <Icon className="size-4" />
        </span>
        <SettingsLabel title={meta.label} description={meta.description} />
        <ChevronRightIcon className="size-4 shrink-0 text-gv-muted" />
      </motion.button>
    );
  };

  const speedLimitControl = (
    <div className="flex shrink-0 items-center gap-2">
      <div className="relative w-28 [&_input]:pr-10">
        <Input
          type="number"
          min={0}
          value={kbValue}
          onChange={(e: any) =>
            handleSpeedChange(parseInt(e.target.value || "0", 10))
          }
          placeholder="0"
          aria-label="Download speed limit in kilobytes per second"
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gv-muted">
          KB/s
        </span>
      </div>
      {speedLimitKB > 0 && (
        <span className="rounded-full bg-gv-panel-soft px-2 py-0.5 text-[11px] font-medium text-gv-muted ring-1 ring-gv-line">
          {formatLimit(speedLimitKB)}
        </span>
      )}
    </div>
  );

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-full flex-col gap-6">
        {activeCategory !== null && (
          <BackButton onClick={() => setActiveCategory(null)} />
        )}
        <div className="space-y-2">
          <Heading>Settings</Heading>
          <Text className="max-w-2xl">Tune GameVault to your liking.</Text>
        </div>
        <Divider className="border-gv-line/80" />

        <div className="w-full max-w-3xl">
          <AnimatePresence mode="wait" initial={false}>
            {activeCategory === null ? (
              <motion.div
                key="overview"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                className="space-y-6"
              >
                <SettingsGroup>
                  <SettingsRow>
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <InputGroup>
                          <MagnifyingGlassIcon data-slot="icon" />
                          <Input
                            type="search"
                            value={searchQuery}
                            onChange={(e: any) =>
                              setSearchQuery(e.target.value)
                            }
                            onKeyDown={(e: any) => {
                              if (e.key === "Escape") {
                                setSearchQuery("");
                              }
                            }}
                            placeholder="Search settings…"
                            aria-label="Search settings"
                          />
                        </InputGroup>
                      </div>
                      {isSearching && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery("")}
                          className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-xl text-gv-muted transition-colors hover:bg-gv-panel-soft hover:text-gv-text"
                          aria-label="Clear settings search"
                        >
                          <XMarkIcon className="size-4" />
                        </button>
                      )}
                    </div>
                  </SettingsRow>
                </SettingsGroup>

                {isSearching ? (
                  <>
                    <SettingsGroup
                      caption="Results"
                      description={
                        searchResults.length > 0
                          ? `${searchResults.length} setting${searchResults.length === 1 ? "" : "s"} matching “${searchQuery.trim()}”.`
                          : undefined
                      }
                    >
                      {searchResults.length === 0 ? (
                        <SettingsRow>
                          <div className="flex items-center gap-2 text-sm text-gv-muted">
                            <MagnifyingGlassIcon className="size-4 shrink-0" />
                            No settings match “{searchQuery.trim()}”. Try a
                            different keyword.
                          </div>
                        </SettingsRow>
                      ) : (
                        searchResults.map((result, i) => (
                          <motion.button
                            key={result.id}
                            type="button"
                            onClick={() => openSearchResult(result)}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{
                              delay: 0.02 + i * 0.02,
                              duration: 0.16,
                              ease: [0.23, 1, 0.32, 1],
                            }}
                            className="group flex min-h-12 w-full cursor-pointer items-center justify-between gap-x-4 px-4 py-2.5 text-left transition-colors hover:bg-gv-panel-soft"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gv-text">
                                {result.title}
                              </p>
                              {result.description && (
                                <p className="mt-0.5 text-xs leading-5 text-gv-muted">
                                  {result.description}
                                </p>
                              )}
                              <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.08em] text-gv-accent">
                                {CATEGORY_META[result.category].label}
                              </p>
                            </div>
                            <ChevronRightIcon className="size-4 shrink-0 text-gv-muted transition-transform group-hover:translate-x-0.5" />
                          </motion.button>
                        ))
                      )}
                    </SettingsGroup>

                    {searchResultCategories.length > 0 && (
                      <SettingsGroup caption="Areas">
                        {orderedSearchCategories.map(renderCategoryRow)}
                      </SettingsGroup>
                    )}
                  </>
                ) : (
                  <SettingsGroup>
                    {navCategories.map(renderCategoryRow)}
                  </SettingsGroup>
                )}
              </motion.div>
            ) : (
              <motion.div
                key={activeCategory}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                className="space-y-6"
              >
                {activeCategory === "downloads" && (
                  <>
                    <SettingsSectionHeader
                      icon={FolderArrowDownIcon}
                      title="Downloads"
                      description="Everything about storing and downloading your games."
                    />

                    {isTauri && (
                      <SettingsGroup
                        id="setting-downloads-locations"
                        className={rowHighlight("downloads-locations")}
                        caption="Download locations"
                        description="A GameVault subfolder is created inside each location automatically."
                      >
                        {rootPaths.length === 0 && (
                          <SettingsRow>
                            <div className="flex items-center gap-2 text-sm text-gv-muted">
                              <FolderIcon className="size-4 shrink-0" />
                              No download locations yet. Add one below.
                            </div>
                          </SettingsRow>
                        )}

                        {rootPaths.map((root) => {
                          const displayLabel =
                            root.label.trim() ||
                            root.path.split(/[\\/]/).filter(Boolean).pop() ||
                            "Unnamed";
                          const isRenaming = editingRootId === root.id;
                          return (
                            <SettingsRow key={root.id}>
                              <div className="min-w-0 flex-1">
                                {isRenaming ? (
                                  <Input
                                    type="text"
                                    value={editingLabel}
                                    autoFocus
                                    onChange={(e: any) =>
                                      setEditingLabel(e.target.value)
                                    }
                                    onBlur={() => commitRenameRootPath(root.id)}
                                    onKeyDown={(e: any) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        commitRenameRootPath(root.id);
                                      } else if (e.key === "Escape") {
                                        cancelRenameRootPath();
                                      }
                                    }}
                                    placeholder="Folder label"
                                    className="[&_input]:h-9 [&_input]:py-1 [&_input]:text-sm [&_input]:rounded-xl"
                                    aria-label="Label for this download folder"
                                  />
                                ) : (
                                  <div className="flex min-w-0 items-center gap-1.5">
                                    <span className="min-w-0 truncate text-sm font-medium text-gv-text">
                                      {displayLabel}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => startRenameRootPath(root)}
                                      className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-gv-muted transition-colors hover:bg-gv-panel-soft hover:text-gv-text cursor-pointer"
                                      aria-label={`Rename ${displayLabel}`}
                                    >
                                      <PencilSquareIcon className="size-3.5" />
                                    </button>
                                  </div>
                                )}
                                <p
                                  className="mt-0.5 truncate text-xs text-gv-muted"
                                  title={root.path}
                                >
                                  {root.path}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <Button
                                  type="button"
                                  color="zinc"
                                  className="text-xs"
                                  onClick={() => handleBrowseRootPath(root.id)}
                                >
                                  <FolderArrowDownIcon className="size-3.5" />
                                  Choose
                                </Button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveRootPath(root.id)}
                                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-gv-muted transition-colors hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
                                  aria-label="Remove download folder"
                                >
                                  <XMarkIcon className="size-4" />
                                </button>
                              </div>
                            </SettingsRow>
                          );
                        })}

                        <button
                          type="button"
                          onClick={handleAddRootPath}
                          className="flex min-h-12 w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-gv-accent transition-colors hover:bg-gv-panel-soft cursor-pointer"
                        >
                          <PlusIcon className="size-4" />
                          Add Download Location
                        </button>
                      </SettingsGroup>
                    )}

                    <SettingsGroup
                      id="setting-downloads-speed-limit"
                      className={rowHighlight("downloads-speed-limit")}
                      caption="Download speed"
                    >
                      <SettingsRow>
                        <SettingsLabel
                          title="Download speed limit"
                          description="Set to 0 for no limit."
                        />
                        {speedLimitControl}
                      </SettingsRow>
                    </SettingsGroup>

                    {isTauri && (
                      <SettingsGroup caption="After downloading">
                        <SettingsRow
                          id="setting-downloads-auto-extract"
                          className={rowHighlight("downloads-auto-extract")}
                        >
                          <SettingsLabel
                            title="Auto-Extract Downloads"
                            description="Unpack archives right after downloading."
                          />
                          <Switch
                            name="autoExtract"
                            color="indigo"
                            aria-label="Automatically extract downloaded archives"
                            checked={autoExtract}
                            onChange={(v: boolean) => setAutoExtract(v)}
                          />
                        </SettingsRow>
                        <SettingsRow
                          id="setting-downloads-auto-install"
                          className={rowHighlight("downloads-auto-install")}
                        >
                          <SettingsLabel
                            title="Auto-Install Games"
                            description="Start installers or copy portable files automatically."
                          />
                          <Switch
                            name="autoInstall"
                            color="indigo"
                            aria-label="Automatically install games after extraction"
                            checked={autoInstall}
                            onChange={(v: boolean) => setAutoInstall(v)}
                          />
                        </SettingsRow>
                        <SettingsRow
                          id="setting-downloads-auto-delete-source"
                          className={rowHighlight(
                            "downloads-auto-delete-source",
                          )}
                        >
                          <SettingsLabel
                            title="Auto-Delete Source Files"
                            description="Clean up downloads after installation to free up space."
                          />
                          <Switch
                            name="autoDeleteSource"
                            color="indigo"
                            aria-label="Delete downloaded and extracted files after portable game install"
                            checked={autoDeleteSource}
                            onChange={(v: boolean) => setAutoDeleteSource(v)}
                          />
                        </SettingsRow>
                      </SettingsGroup>
                    )}

                    <SettingsGroup
                      id="setting-downloads-clear-image-cache"
                      className={rowHighlight("downloads-clear-image-cache")}
                      caption="Storage"
                    >
                      <SettingsRow>
                        <SettingsLabel
                          title="Clear image cache"
                          description="Remove all cached game covers and background images so they're re-downloaded from your server."
                        />
                        <Button
                          outline
                          onClick={() => void handleClearImageCache()}
                        >
                          <TrashIcon className="size-4" />
                          Clear cache
                        </Button>
                      </SettingsRow>
                    </SettingsGroup>
                  </>
                )}

                {activeCategory === "startup" && isTauri && (
                  <>
                    <SettingsSectionHeader
                      icon={ComputerDesktopIcon}
                      title="Startup"
                      description="How GameVault starts with your computer."
                    />
                    <SettingsGroup
                      id="setting-startup-autostart"
                      className={rowHighlight("startup-autostart")}
                      caption="On login"
                    >
                      <SettingsRow>
                        <SettingsLabel
                          title="Launch GameVault on Computer Startup"
                          description="Automatically start GameVault when you log in to your computer."
                        />
                        <Switch
                          name="autostart"
                          color="indigo"
                          aria-label="Launch GameVault on computer startup"
                          checked={autostartEnabled ?? false}
                          disabled={autostartEnabled === null}
                          onChange={async (v: boolean) => {
                            setAutostartEnabled(v);
                            try {
                              const { enable, disable } =
                                await import("@tauri-apps/plugin-autostart");
                              if (v) {
                                await enable();
                              } else {
                                await disable();
                                // Force start-minimized off when autostart is disabled
                                setStartMinimized(false);
                              }
                            } catch (e) {
                              console.error("Failed to update autostart:", e);
                              setAutostartEnabled(!v); // Revert on failure
                            }
                          }}
                        />
                      </SettingsRow>
                    </SettingsGroup>

                    <SettingsGroup
                      id="setting-startup-start-minimized"
                      className={rowHighlight("startup-start-minimized")}
                      caption="Window"
                    >
                      <SettingsRow>
                        <SettingsLabel
                          title="Minimize GameVault to System Tray on Startup"
                          description="When auto-start is enabled, GameVault will start silently in the system tray instead of opening the full window."
                        />
                        <Switch
                          name="startMinimized"
                          color="indigo"
                          aria-label="Minimize GameVault to system tray on startup"
                          checked={startMinimized}
                          disabled={!autostartEnabled}
                          onChange={(v: boolean) => setStartMinimized(v)}
                        />
                      </SettingsRow>
                    </SettingsGroup>
                  </>
                )}

                {activeCategory === "games" && isTauri && (
                  <>
                    <SettingsSectionHeader
                      icon={GamepadIcon}
                      title="Games"
                      description="How GameVault behaves when you play games."
                    />
                    <SettingsGroup
                      id="setting-games-minimize-on-launch"
                      className={rowHighlight("games-minimize-on-launch")}
                      caption="While playing"
                    >
                      <SettingsRow>
                        <SettingsLabel
                          title="Minimize GameVault when launching a game"
                          description="Hide GameVault to the system tray while a game is running and bring it back when the game quits."
                        />
                        <Switch
                          name="minimizeOnGameLaunch"
                          color="indigo"
                          aria-label="Minimize GameVault when launching a game"
                          checked={minimizeOnGameLaunch}
                          onChange={(v: boolean) => setMinimizeOnGameLaunch(v)}
                        />
                      </SettingsRow>
                    </SettingsGroup>

                    <SettingsGroup
                      id="setting-games-ignore-list"
                      className={rowHighlight("games-ignore-list")}
                      caption="Ignored executables"
                      description="Names of installers or helper tools (e.g. setup) to skip, so they're not offered as a launch option and not counted as playtime. Enter the name without its file extension."
                    >
                      {ignoreList.length === 0 && (
                        <SettingsRow>
                          <div className="flex items-center gap-2 text-sm text-gv-muted">
                            <EyeSlashIcon className="size-4 shrink-0" />
                            No executables ignored yet. Add one below.
                          </div>
                        </SettingsRow>
                      )}
                      {ignoreList.length > 0 && (
                        <SettingsRow>
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <div className="min-w-0 flex-1">
                              <InputGroup>
                                <MagnifyingGlassIcon data-slot="icon" />
                                <Input
                                  type="search"
                                  value={ignoreSearch}
                                  onChange={(e: any) =>
                                    setIgnoreSearch(e.target.value)
                                  }
                                  placeholder="Search hidden files…"
                                  aria-label="Search hidden executables"
                                />
                              </InputGroup>
                            </div>
                            <span className="shrink-0 whitespace-nowrap text-xs text-gv-muted">
                              {filteredIgnoreList.length} of {ignoreList.length}
                            </span>
                          </div>
                        </SettingsRow>
                      )}
                      {filteredIgnoreList.length === 0 &&
                        ignoreList.length > 0 && (
                          <SettingsRow>
                            <div className="flex items-center gap-2 text-sm text-gv-muted">
                              <MagnifyingGlassIcon className="size-4 shrink-0" />
                              No matches for “{ignoreSearch.trim()}”.
                            </div>
                          </SettingsRow>
                        )}
                      {filteredIgnoreList.length > 0 && (
                        <div className="max-h-80 divide-y divide-gv-line overflow-y-auto">
                          {filteredIgnoreList.map((name) => (
                            <SettingsRow key={name}>
                              <span className="min-w-0 flex-1 truncate text-sm font-medium text-gv-text">
                                {name}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRemoveIgnore(name)}
                                className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-gv-muted transition-colors hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
                                aria-label={`Remove ${name} from ignore list`}
                              >
                                <XMarkIcon className="size-4" />
                              </button>
                            </SettingsRow>
                          ))}
                        </div>
                      )}
                      <SettingsRow>
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <Input
                            type="text"
                            value={newIgnore}
                            onChange={(e: any) => setNewIgnore(e.target.value)}
                            onKeyDown={(e: any) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleAddIgnore();
                              }
                            }}
                            placeholder="e.g. setup"
                            className="min-w-0 flex-1"
                            aria-label="Executable name to ignore (without file extension)"
                          />
                          <Button
                            type="button"
                            color="indigo"
                            className="shrink-0 px-3"
                            onClick={handleAddIgnore}
                          >
                            <PlusIcon className="size-4" />
                            Add
                          </Button>
                        </div>
                      </SettingsRow>
                    </SettingsGroup>
                  </>
                )}

                {activeCategory === "privacy" && (
                  <>
                    <SettingsSectionHeader
                      icon={ShieldCheckIcon}
                      title="Privacy"
                      description="Your data stays yours. Here's what GameVault sends."
                    />
                    <SettingsGroup>
                      <SettingsRow>
                        <SettingsLabel
                          title="Help improve GameVault"
                          description={`We'd like to send a few anonymous usage stats — which features you use and whether something goes wrong — so we know what to fix. Nothing personal, no game names, no IP-tracked browsing. It just helps us improve the app. You can turn it off anytime. Changes take effect after ${isTauri ? "restarting the app" : "reloading"}.`}
                        />
                        <Switch
                          name="analyticsConsent"
                          color="indigo"
                          aria-label="Help improve GameVault with anonymous usage analytics"
                          checked={analyticsConsent}
                          onChange={(v: boolean) => {
                            setAnalyticsEnabled(v);
                            setAnalyticsConsent(v);
                          }}
                        />
                      </SettingsRow>
                    </SettingsGroup>
                  </>
                )}

                {activeCategory === "appearance" && (
                  <>
                    <SettingsSectionHeader
                      icon={SwatchIcon}
                      title="Appearance"
                      description="How GameVault looks."
                    />
                    <SettingsGroup
                      id="setting-appearance-theme"
                      className={rowHighlight("appearance-theme")}
                    >
                      <SettingsRow>
                        <SettingsLabel
                          title="Theme"
                          description="Choose between light, dark, or follow your device settings."
                        />
                        <div className="w-40 shrink-0">
                          <ThemeSelect />
                        </div>
                      </SettingsRow>
                    </SettingsGroup>

                    <SettingsGroup
                      id="setting-appearance-zoom"
                      className={rowHighlight("appearance-zoom")}
                    >
                      <SettingsRow>
                        <SettingsLabel
                          title="Zoom"
                          description="Zoom the interface in or out."
                        />
                        <div className="w-44 shrink-0">
                          <ZoomControl />
                        </div>
                      </SettingsRow>
                    </SettingsGroup>
                  </>
                )}

                {activeCategory === "sound" && (
                  <>
                    <SettingsSectionHeader
                      icon={SpeakerWaveIcon}
                      title="Sound"
                      description="GameVault sound effects and volume."
                    />
                    <SettingsGroup
                      id="setting-sound-volume"
                      className={rowHighlight("sound-volume")}
                    >
                      <SettingsRow>
                        <SettingsLabel
                          title="Volume"
                          description="Adjust the master volume of GameVault sounds. Click the speaker to mute."
                        />
                        <div className="w-44 shrink-0">
                          <VolumeControl />
                        </div>
                      </SettingsRow>
                    </SettingsGroup>

                    <SettingsGroup
                      id="setting-sound-test"
                      className={rowHighlight("sound-test")}
                    >
                      <SettingsRow>
                        <SettingsLabel
                          title="Test sound"
                          description="Play a preview at the current volume."
                        />
                        <Button
                          color="zinc"
                          onClick={() => void playSound("pop")}
                          className="shrink-0"
                        >
                          <SpeakerWaveIcon
                            className="h-4 w-4"
                            aria-hidden="true"
                          />
                          Play
                        </Button>
                      </SettingsRow>
                    </SettingsGroup>
                  </>
                )}

                {activeCategory === "developer" &&
                  (import.meta.env.DEV || devToolsUnlocked) && (
                    <>
                      <SettingsSectionHeader
                        icon={ExclamationTriangleIcon}
                        title="Developer Tools"
                        description="Tools for development."
                      />
                      <SettingsGroup
                        id="setting-developer-simulate-desktop"
                        className={rowHighlight("developer-simulate-desktop")}
                      >
                        <SettingsRow>
                          <SettingsLabel
                            title="Simulate Desktop App"
                            description="Preview how GameVault looks and behaves as a native desktop application."
                          />
                          <Switch
                            name="simulateDesktop"
                            color="indigo"
                            aria-label="Simulate Tauri desktop app mode"
                            checked={isDebugTauriOverride()}
                            onChange={(v: boolean) => {
                              setDebugTauriOverride(v);
                              window.location.reload();
                            }}
                          />
                        </SettingsRow>
                      </SettingsGroup>

                      <SettingsGroup
                        id="setting-developer-simulate-outage"
                        className={rowHighlight("developer-simulate-outage")}
                        caption="Network"
                      >
                        <SettingsRow>
                          <SettingsLabel
                            title="Simulate Network Outage"
                            description="Force an offline state to test error banners, retries and reconnection. Persists until you disable it."
                          />
                          <Switch
                            name="simulateOutage"
                            color="indigo"
                            aria-label="Simulate network outage"
                            checked={forceOffline}
                            onChange={(v: boolean) => setForceOffline(v)}
                          />
                        </SettingsRow>
                      </SettingsGroup>

                      <SettingsGroup
                        id="setting-developer-toasts"
                        className={rowHighlight("developer-toasts")}
                        caption="Toasts"
                      >
                        <SettingsRow>
                          <SettingsLabel
                            title="Toast Notifications"
                            description="Preview each toast tone. Handy for checking the snackbar position and styling."
                          />
                        </SettingsRow>
                        <SettingsRow>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              color="zinc"
                              onClick={() =>
                                void showAlert({
                                  title: "Info toast",
                                  tone: "info",
                                })
                              }
                            >
                              Info
                            </Button>
                            <Button
                              color="zinc"
                              onClick={() =>
                                void showAlert({
                                  title: "Success toast",
                                  tone: "success",
                                })
                              }
                            >
                              Success
                            </Button>
                            <Button
                              color="zinc"
                              onClick={() =>
                                void showAlert({
                                  title: "Warning toast",
                                  tone: "warning",
                                })
                              }
                            >
                              Warning
                            </Button>
                            <Button
                              color="zinc"
                              onClick={() =>
                                void showAlert({
                                  title: "Danger toast",
                                  tone: "danger",
                                })
                              }
                            >
                              Danger
                            </Button>
                          </div>
                        </SettingsRow>
                      </SettingsGroup>

                      <SettingsGroup
                        id="setting-developer-simulate-download"
                        className={rowHighlight("developer-simulate-download")}
                        caption="Downloads"
                      >
                        <SettingsRow>
                          <SettingsLabel
                            title="Simulate Download Status"
                            description="Adds a fake card to the Downloads page so you can preview each state without a real download."
                          />
                        </SettingsRow>
                        <SettingsRow>
                          <div className="flex flex-wrap gap-2">
                            {SIMULATED_DOWNLOAD_KINDS.map(({ kind, label }) => (
                              <Button
                                key={kind}
                                type="button"
                                color="zinc"
                                className="px-3"
                                onClick={() => simulateDownload(kind)}
                              >
                                {label}
                              </Button>
                            ))}
                          </div>
                        </SettingsRow>
                      </SettingsGroup>

                      <SettingsGroup
                        id="setting-developer-build-info"
                        className={rowHighlight("developer-build-info")}
                        caption="Build Info"
                      >
                        <SettingsRow>
                          <SettingsLabel title="Version" />
                          <span className="shrink-0 font-mono text-xs text-gv-text">
                            {__APP_VERSION__}
                          </span>
                        </SettingsRow>
                        <SettingsRow>
                          <SettingsLabel title="Channel" />
                          <span className="shrink-0 font-mono text-xs text-gv-muted">
                            {__BUILD_CHANNEL__}
                          </span>
                        </SettingsRow>
                        <SettingsRow>
                          <SettingsLabel title="Environment" />
                          <span className="shrink-0 font-mono text-xs text-gv-muted">
                            {import.meta.env.MODE} ·{" "}
                            {isTauri ? "desktop" : "web"}
                          </span>
                        </SettingsRow>
                      </SettingsGroup>

                      <SettingsGroup
                        id="setting-developer-settings-dump"
                        className={rowHighlight("developer-settings-dump")}
                        caption="Diagnostics"
                      >
                        <SettingsRow>
                          <SettingsLabel
                            title="Copy Settings Dump"
                            description="Copies all local preferences (sensitive values redacted) to the clipboard as JSON for bug reports."
                          />
                          <Button
                            type="button"
                            color="indigo"
                            className="shrink-0"
                            onClick={() => void handleCopySettingsDump()}
                          >
                            <ClipboardDocumentIcon className="size-4" />
                            Copy
                          </Button>
                        </SettingsRow>
                      </SettingsGroup>
                    </>
                  )}

                {activeCategory === "about" && (
                  <>
                    <SettingsSectionHeader
                      icon={InformationCircleIcon}
                      title="About"
                      description="Version, licenses and system information."
                    />
                    <SettingsGroup
                      id="setting-about-version"
                      className={rowHighlight("about-version")}
                    >
                      <SettingsRow>
                        <SettingsLabel title="Application Version" />
                        <button
                          type="button"
                          onClick={handleVersionClick}
                          title="Application version"
                          className="inline-flex shrink-0 cursor-pointer items-center rounded-md bg-gv-panel-soft px-2 py-1 font-mono text-xs text-gv-text ring-1 ring-gv-line transition-colors hover:ring-gv-line-strong"
                        >
                          v{__APP_VERSION__}
                        </button>
                      </SettingsRow>
                      <AboutLinkRow
                        title="Developed by"
                        value="Phalcode"
                        href="https://phalco.de"
                      />
                      <div
                        id="setting-about-license"
                        className={rowHighlight("about-license")}
                      >
                        <button
                          type="button"
                          onClick={() => void toggleGameVaultLicense()}
                          aria-expanded={licenseExpanded}
                          className="group flex min-h-12 w-full cursor-pointer items-center justify-between gap-x-4 px-4 py-2.5 text-left transition-colors hover:bg-gv-panel-soft"
                        >
                          <SettingsLabel title="License" />
                          <span className="flex min-w-0 shrink-0 items-center gap-1.5 text-sm font-medium text-gv-accent">
                            <span className="truncate">CC BY-NC-SA 4.0</span>
                            <ChevronRightIcon
                              className={clsx(
                                "size-3.5 shrink-0 text-gv-muted transition-transform",
                                licenseExpanded && "rotate-90",
                              )}
                            />
                          </span>
                        </button>
                        {licenseExpanded && gameVaultLicense && (
                          <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap wrap-break-word border-t border-gv-line bg-gv-panel-soft/60 px-4 py-3 font-mono text-xs leading-5 text-gv-muted">
                            {gameVaultLicense}
                          </pre>
                        )}
                      </div>
                      <AboutLinkRow
                        title="Legal Notice"
                        value="https://phalco.de/legal"
                        href="https://phalco.de/legal"
                      />
                      <AboutLinkRow
                        title="Privacy Policy"
                        value="https://phalco.de/privacy"
                        href="https://phalco.de/privacy"
                      />
                      <AboutLinkRow
                        title="Terms of Service"
                        value="https://phalco.de/tos"
                        href="https://phalco.de/tos"
                      />
                      <AboutLinkRow
                        title="Metadata Providers"
                        value="IGDB"
                        href="https://www.igdb.com"
                      />
                      <div
                        id="setting-about-open-source-licenses"
                        className={rowHighlight("about-open-source-licenses")}
                      >
                        <button
                          type="button"
                          onClick={() => void openLicenses()}
                          className="group flex min-h-12 w-full cursor-pointer items-center justify-between gap-x-4 px-4 py-2.5 text-left transition-colors hover:bg-gv-panel-soft"
                        >
                          <SettingsLabel title="Open Source Licenses" />
                          <span className="flex min-w-0 shrink-0 items-center gap-1.5 text-sm font-medium text-gv-accent">
                            <span className="truncate">
                              {licenseData
                                ? `${licenseData.packages.length} libraries`
                                : "View"}
                            </span>
                            <ChevronRightIcon className="size-3.5 shrink-0 text-gv-muted" />
                          </span>
                        </button>
                      </div>
                    </SettingsGroup>

                    <SettingsGroup
                      id="setting-about-system"
                      className={rowHighlight("about-system")}
                      caption="System"
                    >
                      <SettingsRow>
                        <SettingsLabel title="Platform" />
                        <span className="shrink-0 font-mono text-xs text-gv-muted">
                          {systemInfo.platform}
                        </span>
                      </SettingsRow>
                      <SettingsRow>
                        <SettingsLabel title="Operating System" />
                        <span className="shrink-0 font-mono text-xs text-gv-muted">
                          {systemInfo.os}
                        </span>
                      </SettingsRow>
                      <SettingsRow>
                        <SettingsLabel title="Architecture" />
                        <span className="shrink-0 font-mono text-xs text-gv-muted">
                          {systemInfo.architecture || "—"}
                        </span>
                      </SettingsRow>
                      <SettingsRow>
                        <SettingsLabel title="Language" />
                        <span className="shrink-0 font-mono text-xs text-gv-muted">
                          {systemInfo.language}
                        </span>
                      </SettingsRow>
                      <SettingsRow>
                        <SettingsLabel title="Screen" />
                        <span className="shrink-0 font-mono text-xs text-gv-muted">
                          {systemInfo.screen}
                        </span>
                      </SettingsRow>
                      <SettingsRow>
                        <SettingsLabel title="CPU Cores" />
                        <span className="shrink-0 font-mono text-xs text-gv-muted">
                          {systemInfo.cores}
                        </span>
                      </SettingsRow>
                      <SettingsRow>
                        <SettingsLabel title="Memory" />
                        <span className="shrink-0 font-mono text-xs text-gv-muted">
                          {systemInfo.memory}
                        </span>
                      </SettingsRow>
                    </SettingsGroup>

                    {isTauri && (
                      <>
                        <SettingsGroup
                          id="setting-about-updates"
                          className={rowHighlight("about-updates")}
                          caption="Updates"
                        >
                          {availableVersion && !isInstallingUpdate && (
                            <SettingsRow>
                              <SettingsLabel
                                title="Available update"
                                description="A newer version is available for this channel."
                              />
                              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-gv-accent/15 px-2 py-1 font-mono text-xs font-medium text-gv-accent-strong ring-1 ring-gv-accent/25">
                                <SparklesIcon className="size-3.5" />v
                                {availableVersion}
                              </span>
                            </SettingsRow>
                          )}

                          <SettingsRow>
                            <SettingsLabel
                              title="Update channel"
                              description="Choose which kind of releases you receive."
                            />
                            <div className="w-36 shrink-0">
                              <Listbox
                                name="updateChannel"
                                value={updateChannel}
                                onChange={setUpdateChannel}
                              >
                                <ListboxOption value="stable">
                                  <ListboxLabel>Stable</ListboxLabel>
                                </ListboxOption>
                                {devToolsUnlocked && (
                                  <>
                                    <ListboxOption value="early-access">
                                      <ListboxLabel>Early Access</ListboxLabel>
                                    </ListboxOption>
                                    <ListboxOption value="unstable">
                                      <ListboxLabel>Unstable</ListboxLabel>
                                    </ListboxOption>
                                  </>
                                )}
                              </Listbox>
                            </div>
                          </SettingsRow>

                          <SettingsRow>
                            <SettingsLabel
                              title="Auto-update status"
                              description={
                                updaterErrorText
                                  ? updaterErrorText
                                  : updaterStatusText ||
                                    (updaterReady
                                      ? updaterEnabled
                                        ? `Enabled for the ${updateChannel === "early-access" ? "Early Access" : updateChannel === "unstable" ? "Unstable" : "Stable"} channel.`
                                        : "Not configured for this build yet."
                                      : "Checking availability...")
                              }
                            />
                            {updaterErrorText ? (
                              <ExclamationTriangleIcon className="size-4 shrink-0 text-red-400" />
                            ) : (
                              <span
                                className={clsx(
                                  "size-2.5 shrink-0 rounded-full",
                                  updaterEnabled
                                    ? "bg-gv-success"
                                    : "bg-gv-muted/60",
                                )}
                              />
                            )}
                          </SettingsRow>
                        </SettingsGroup>

                        <SettingsGroup
                          id="setting-about-check-updates"
                          className={rowHighlight("about-updates")}
                        >
                          <SettingsRow>
                            <SettingsLabel
                              title="Check for updates"
                              description="Look for a newer version now."
                            />
                            <Button
                              type="button"
                              color="indigo"
                              className="shrink-0"
                              disabled={
                                !updaterReady ||
                                isCheckingUpdates ||
                                isInstallingUpdate
                              }
                              onClick={() =>
                                void checkForUpdates({ manual: true })
                              }
                            >
                              <ArrowPathIcon
                                className={
                                  isCheckingUpdates
                                    ? "size-4 animate-spin motion-reduce:animate-none"
                                    : "size-4"
                                }
                              />
                              {isCheckingUpdates
                                ? "Checking..."
                                : isInstallingUpdate
                                  ? "Updating..."
                                  : "Check"}
                            </Button>
                          </SettingsRow>
                        </SettingsGroup>
                      </>
                    )}
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <Dialog
        open={licensesOpen}
        onClose={() => setLicensesOpen(false)}
        size="3xl"
        className="h-[min(85vh,850px)]! flex flex-col"
      >
        <div className="flex items-start justify-between gap-4">
          <DialogTitle>Open Source Licenses</DialogTitle>
          <button
            type="button"
            onClick={() => setLicensesOpen(false)}
            aria-label="Close licenses dialog"
            className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-xl text-gv-muted transition-colors hover:bg-gv-panel-soft hover:text-gv-text"
          >
            <XMarkIcon className="size-5" />
          </button>
        </div>
        <DialogDescription>
          GameVault is built with {licenseData?.packages.length ?? "…"} open
          source libraries. Tap a library to view its license.
        </DialogDescription>
        <DialogBody className="flex-1 min-h-0 overflow-y-auto">
          {licenseData ? (
            <div className="divide-y divide-gv-line overflow-hidden rounded-2xl border border-gv-line bg-gv-panel-strong">
              {licenseData.packages.map((pkg) => {
                const key = `${pkg.name}@${pkg.version}`;
                const expanded = expandedLicense === key;
                return (
                  <div key={key}>
                    <button
                      type="button"
                      onClick={() => setExpandedLicense(expanded ? null : key)}
                      aria-expanded={expanded}
                      className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-gv-panel-soft"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-sm text-gv-text">
                          {pkg.name}
                        </span>
                        <span className="block text-xs text-gv-muted">
                          v{pkg.version}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className="rounded-md bg-gv-panel-soft px-2 py-0.5 text-[11px] text-gv-muted ring-1 ring-gv-line">
                          {pkg.licenses}
                        </span>
                        <ChevronRightIcon
                          className={clsx(
                            "size-3.5 shrink-0 text-gv-muted transition-transform",
                            expanded && "rotate-90",
                          )}
                        />
                      </span>
                    </button>
                    {expanded && (
                      <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap wrap-break-word border-t border-gv-line bg-gv-panel-soft/60 px-4 py-3 font-mono text-xs leading-5 text-gv-muted">
                        {pkg.licenseText ||
                          "License text not included for this package."}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <Text className="text-sm text-gv-muted">Loading licenses…</Text>
          )}
        </DialogBody>
      </Dialog>
    </MotionConfig>
  );
}
