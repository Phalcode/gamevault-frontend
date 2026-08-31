import {
  GamevaultGameTypeEnum,
  type GamevaultGameTypeEnum as GameType,
} from "@/api/models/GamevaultGame";

export type InstallViewMode = "portable" | "setup" | "undetected";

export type InstallCardState = {
  mode: InstallViewMode;
  forcedType: GameType;
  installerOptions: string[];
  selectedInstaller: string;
  loadingInstallers: boolean;
  installerLoadError?: string;
};

export const FORCE_INSTALL_TYPES: { label: string; value: GameType }[] = [
  { label: "Windows Setup", value: GamevaultGameTypeEnum.windows_setup },
  { label: "Windows Portable", value: GamevaultGameTypeEnum.windows_portable },
  { label: "Linux Portable", value: GamevaultGameTypeEnum.linux_portable },
];

export function formatGameTypeLabel(gameType?: string) {
  if (!gameType) return "Undetectable";
  return gameType
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function resolveInstallMode(gameType?: string): InstallViewMode {
  if (gameType === GamevaultGameTypeEnum.windows_setup) {
    return "setup";
  }

  if (
    gameType === GamevaultGameTypeEnum.windows_portable ||
    gameType === GamevaultGameTypeEnum.linux_portable ||
    gameType === GamevaultGameTypeEnum.windows_software ||
    gameType === GamevaultGameTypeEnum.linux_software
  ) {
    return "portable";
  }

  return "undetected";
}

export function normalizeRelativePath(value?: string) {
  return (value || "").replace(/\\/g, "/").toLowerCase();
}

const WINDOWS_EXECUTABLE_EXTENSIONS = ["exe", "bat", "cmd", "com", "msi"];

/**
 * True when the relative path points to a Windows executable that needs
 * Proton/Wine (umu-launcher) to run on Linux.
 */
export function isWindowsExecutablePath(value?: string) {
  if (!value) return false;
  const lower = value.toLowerCase();
  return WINDOWS_EXECUTABLE_EXTENSIONS.some(
    (ext) => lower.endsWith(`.${ext}`),
  );
}

export function pickPreferredInstaller(options: string[], preferred?: string) {
  if (!options.length) return "";
  if (!preferred) return options[0];

  const normalizedPreferred = normalizeRelativePath(preferred);
  const exactMatch = options.find(
    (option) => normalizeRelativePath(option) === normalizedPreferred,
  );
  if (exactMatch) return exactMatch;

  const suffixMatch = options.find((option) =>
    normalizeRelativePath(option).endsWith(normalizedPreferred),
  );
  return suffixMatch || options[0];
}

/**
 * Resolve the launch executable to auto-select after installation.
 *
 * Prefers the game's configured `launch_executable` when it matches a real
 * candidate (case-insensitive, separator-normalized). When nothing is
 * configured or nothing matches, falls back to auto-detecting the first
 * available executable — restoring the legacy client's behavior of picking a
 * default launch executable automatically.
 */
export function pickPreferredExecutable(options: string[], preferred?: string) {
  if (!options.length) return "";

  if (preferred && preferred.trim()) {
    const normalizedPreferred = normalizeRelativePath(preferred);
    const exactMatch = options.find(
      (option) => normalizeRelativePath(option) === normalizedPreferred,
    );
    if (exactMatch) return exactMatch;
  }

  return options[0];
}
