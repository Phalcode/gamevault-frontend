import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { isTauriApp } from "@/utils/tauri";

const SKIPPED_UPDATE_KEY = "gv_skipped_update_version";
const UPDATE_CHANNEL_KEY = "gv_update_channel";
const AUTO_CHECK_DELAY_MS = 1500;
const APP_UPDATER_EVENT = "app-updater-progress";
const GITHUB_RELEASE_API_URLS: Record<UpdateChannel, string> = {
  stable:
    "https://api.github.com/repos/Phalcode/gamevault-frontend/releases/latest",
  "early-access":
    "https://api.github.com/repos/Phalcode/gamevault-frontend/releases/tags/early-access",
  unstable:
    "https://api.github.com/repos/Phalcode/gamevault-frontend/releases/tags/unstable",
};
const GITHUB_RELEASE_PAGE_URLS: Record<UpdateChannel, string> = {
  stable: "https://github.com/Phalcode/gamevault-frontend/releases/latest",
  "early-access":
    "https://github.com/Phalcode/gamevault-frontend/releases/tag/early-access",
  unstable:
    "https://github.com/Phalcode/gamevault-frontend/releases/tag/unstable",
};

export type UpdateChannel = "stable" | "early-access" | "unstable";

type UpdateDownloadEvent =
  | {
      event: "Started";
      contentLength?: number | null;
      chunkLength?: number | null;
    }
  | {
      event: "Progress";
      contentLength?: number | null;
      chunkLength?: number | null;
    }
  | {
      event: "Installing";
      contentLength?: number | null;
      chunkLength?: number | null;
    }
  | {
      event: "Finished";
      contentLength?: number | null;
      chunkLength?: number | null;
    };

type PendingUpdate = {
  version: string;
  body?: string | null;
  currentVersion: string;
  channel: UpdateChannel;
};

interface GithubReleaseFallback {
  tag_name: string;
  html_url?: string;
  body?: string | null;
  published_at?: string;
  updated_at?: string;
}

interface CheckForUpdatesOptions {
  manual?: boolean;
}

interface AppUpdaterContextValue {
  updateChannel: UpdateChannel;
  updaterEnabled: boolean;
  updaterReady: boolean;
  isChecking: boolean;
  isInstalling: boolean;
  availableVersion: string | null;
  errorText: string | null;
  statusText: string | null;
  setUpdateChannel: (channel: UpdateChannel) => void;
  checkForUpdates: (options?: CheckForUpdatesOptions) => Promise<void>;
}

const AppUpdaterContext = createContext<AppUpdaterContextValue | undefined>(
  undefined,
);

function channelLabel(channel: UpdateChannel): string {
  return channel;
}

function readSkippedVersion(channel: UpdateChannel): string | null {
  try {
    return localStorage.getItem(`${SKIPPED_UPDATE_KEY}:${channel}`);
  } catch {
    return null;
  }
}

function writeSkippedVersion(channel: UpdateChannel, version: string): void {
  try {
    localStorage.setItem(`${SKIPPED_UPDATE_KEY}:${channel}`, version);
  } catch {
    // localStorage unavailable
  }
}

function clearSkippedVersion(channel: UpdateChannel): void {
  try {
    localStorage.removeItem(`${SKIPPED_UPDATE_KEY}:${channel}`);
  } catch {
    // localStorage unavailable
  }
}

function defaultChannelForBuild(): UpdateChannel {
  const buildChannel = __BUILD_CHANNEL__;
  return buildChannel === "unstable" || buildChannel === "early-access"
    ? buildChannel
    : "stable";
}

function readUpdateChannel(): UpdateChannel {
  const buildDefault = defaultChannelForBuild();
  try {
    const value = localStorage.getItem(UPDATE_CHANNEL_KEY);
    if (
      value === "stable" ||
      value === "unstable" ||
      value === "early-access"
    ) {
      return value;
    }
    return buildDefault;
  } catch {
    return buildDefault;
  }
}

function formatReleaseNotes(notes?: string | null): string {
  if (!notes) return "";

  const collapsed = notes.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  if (collapsed.length <= 240) return collapsed;
  return `${collapsed.slice(0, 237)}...`;
}

function formatUpdatePrompt(
  version: string,
  channel: UpdateChannel,
  notes?: string | null,
): string {
  const releaseNotes = formatReleaseNotes(notes);
  const parts = [
    `You are running GameVault v${__APP_VERSION__}.`,
    `GameVault v${version} is available on the ${channelLabel(channel)} channel and can be downloaded from GitHub now.`,
  ];

  if (releaseNotes) {
    parts.push(`Release notes: ${releaseNotes}`);
  }

  parts.push("Do you want to download and install this update now?");
  return parts.join(" ");
}

function formatUpdateError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return "GameVault could not complete the update check.";
}

function normalizeVersion(version: string): string {
  return version.replace(/^v/i, "").trim();
}

function compareVersions(left: string, right: string): number {
  const leftParts = normalizeVersion(left)
    .split("-")[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  const rightParts = normalizeVersion(right)
    .split("-")[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10));

  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = Number.isFinite(leftParts[index]) ? leftParts[index] : 0;
    const rightValue = Number.isFinite(rightParts[index])
      ? rightParts[index]
      : 0;

    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }

  return 0;
}

function isMissingUpdaterFeedError(error: unknown): boolean {
  const message = formatUpdateError(error).toLowerCase();
  return (
    message.includes("404") ||
    message.includes("not found") ||
    message.includes("target")
  );
}

async function fetchGithubReleaseFallback(
  channel: UpdateChannel,
): Promise<GithubReleaseFallback> {
  const response = await fetch(GITHUB_RELEASE_API_URLS[channel], {
    headers: {
      Accept: "application/vnd.github+json",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub release lookup failed (${response.status}).`);
  }

  return (await response.json()) as GithubReleaseFallback;
}

function openExternalReleasePage(channel: UpdateChannel, url?: string): void {
  const targetUrl = url || GITHUB_RELEASE_PAGE_URLS[channel];
  window.open(targetUrl, "_blank", "noopener,noreferrer");
}

export function AppUpdaterProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { showAlert } = useAlertDialog();
  const [updateChannel, setUpdateChannelState] = useState<UpdateChannel>(() =>
    readUpdateChannel(),
  );
  const [updaterEnabled, setUpdaterEnabled] = useState(false);
  const [updaterReady, setUpdaterReady] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const runningRef = useRef(false);
  const autoCheckedRef = useRef(false);

  const setUpdateChannel = useCallback((channel: UpdateChannel) => {
    setUpdateChannelState(channel);

    try {
      localStorage.setItem(UPDATE_CHANNEL_KEY, channel);
    } catch {
      console.warn("Failed to persist update channel preference");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!isTauriApp()) {
        if (!cancelled) {
          setUpdaterEnabled(false);
          setUpdaterReady(true);
        }
        return;
      }

      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const enabled = await invoke<boolean>("is_updater_enabled");
        if (!cancelled) {
          setUpdaterEnabled(enabled);
        }
      } catch (error) {
        console.warn("Updater probe failed:", error);
        if (!cancelled) {
          setUpdaterEnabled(false);
        }
      } finally {
        if (!cancelled) {
          setUpdaterReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const checkForUpdates = useCallback(
    async ({ manual = false }: CheckForUpdatesOptions = {}) => {
      if (runningRef.current) {
        return;
      }

      if (!isTauriApp()) {
        if (manual) {
          await showAlert({
            title: "Desktop updates unavailable",
            description:
              "Auto-updates are only available in the GameVault desktop app.",
            affirmativeText: "OK",
          });
        }
        return;
      }

      if (!updaterEnabled) {
        if (manual) {
          await showAlert({
            title: "Auto-updates not configured",
            description:
              "This desktop build does not have a Tauri updater public key configured yet.",
            affirmativeText: "OK",
          });
        }
        return;
      }

      runningRef.current = true;
      setIsChecking(true);
      setErrorText(null);
      setStatusText(`Checking ${channelLabel(updateChannel)} updates...`);
      let update: PendingUpdate | null = null;
      let removeProgressListener: (() => void) | null = null;

      const handleMissingFeedFallback = async (cause: unknown) => {
        const fallbackMessage =
          "The signed updater feed for this channel is not published yet.";

        try {
          const release = await fetchGithubReleaseFallback(updateChannel);
          const releaseUrl =
            release.html_url || GITHUB_RELEASE_PAGE_URLS[updateChannel];

          if (updateChannel === "stable") {
            const remoteVersion = normalizeVersion(release.tag_name);
            const hasNewerStable =
              compareVersions(remoteVersion, __APP_VERSION__) > 0;

            if (!hasNewerStable) {
              setAvailableVersion(null);
              setErrorText(fallbackMessage);
              setStatusText(
                "The stable updater feed is not published yet. Open the stable GitHub release page to install or switch channels manually.",
              );

              if (!manual) {
                return;
              }

              const approved = await showAlert({
                title: "Stable release page available",
                description: `The signed updater feed is not published yet for the stable channel. GitHub currently lists stable release v${remoteVersion}. Open that release page instead?`,
                affirmativeText: "Open GitHub release",
                negativeText: "Cancel",
              });

              if (approved) {
                openExternalReleasePage(updateChannel, releaseUrl);
                setStatusText("Opened the stable GitHub release page.");
              }

              return;
            }

            setAvailableVersion(remoteVersion);
            setErrorText(fallbackMessage);
            setStatusText(
              `Stable release v${remoteVersion} is available on GitHub, but the signed updater feed is not published yet.`,
            );

            if (
              !manual &&
              readSkippedVersion(updateChannel) === remoteVersion
            ) {
              return;
            }

            if (!manual) {
              return;
            }

            const approved = await showAlert({
              title: `Stable release v${remoteVersion} available`,
              description:
                "The signed updater feed is not published yet for the stable channel. A newer stable GitHub release is available. Open the GitHub release page instead?",
              affirmativeText: "Open GitHub release",
              negativeText: "Cancel",
            });

            if (approved) {
              clearSkippedVersion(updateChannel);
              openExternalReleasePage(updateChannel, releaseUrl);
              setStatusText("Opened the stable GitHub release page.");
            }
            return;
          }

          const label = channelLabel(updateChannel);
          setAvailableVersion(null);
          setErrorText(fallbackMessage);
          setStatusText(
            `The ${label} updater feed is not published yet. The ${label} GitHub prerelease page is available instead.`,
          );

          if (!manual) {
            return;
          }

          const updatedLabel = release.updated_at || release.published_at;
          const description = updatedLabel
            ? `The signed updater feed is not published yet for the ${label} channel. GitHub shows a ${label} prerelease updated at ${new Date(updatedLabel).toLocaleString()}. Open that release page instead?`
            : `The signed updater feed is not published yet for the ${label} channel. Open the ${label} GitHub prerelease page instead?`;

          const approved = await showAlert({
            title: `${label} release page available`,
            description,
            affirmativeText: `Open ${label} release`,
            negativeText: "Cancel",
          });

          if (approved) {
            openExternalReleasePage(updateChannel, releaseUrl);
            setStatusText(`Opened the ${label} GitHub release page.`);
          }
        } catch (fallbackError) {
          const message = formatUpdateError(fallbackError);
          console.error(
            "GitHub release fallback failed:",
            cause,
            fallbackError,
          );
          setAvailableVersion(null);
          setErrorText(message);
          setStatusText(null);

          if (manual) {
            await showAlert({
              title: "Update failed",
              description: message,
              affirmativeText: "OK",
            });
          }
        }
      };

      try {
        const { invoke } = await import("@tauri-apps/api/core");
        update = (await invoke<PendingUpdate | null>("check_for_app_update", {
          channel: updateChannel,
        })) as PendingUpdate | null;

        if (!update) {
          setAvailableVersion(null);
          setStatusText(
            `GameVault is up to date on the ${channelLabel(updateChannel)} channel.`,
          );

          if (manual) {
            await showAlert({
              title: "GameVault is up to date",
              description: `You are already running the latest ${channelLabel(updateChannel)} desktop release (v${__APP_VERSION__}).`,
              affirmativeText: "OK",
            });
          }
          return;
        }

        setAvailableVersion(update.version);

        if (!manual && readSkippedVersion(updateChannel) === update.version) {
          setStatusText(
            `${channelLabel(updateChannel)} update v${update.version} is available.`,
          );
          return;
        }

        const approved = await showAlert({
          title: `Update v${update.version} available`,
          description: formatUpdatePrompt(
            update.version,
            updateChannel,
            update.body,
          ),
          affirmativeText: "Update now",
          negativeText: "Later",
        });

        if (!approved) {
          if (!manual) {
            writeSkippedVersion(updateChannel, update.version);
          }
          setStatusText(
            `${channelLabel(updateChannel)} update v${update.version} is available.`,
          );
          return;
        }

        clearSkippedVersion(updateChannel);
        setIsInstalling(true);
        setStatusText("Downloading update...");
        void showAlert({ title: "Downloading update..." });

        let contentLength = 0;
        let downloaded = 0;

        const { listen } = await import("@tauri-apps/api/event");
        removeProgressListener = await listen<UpdateDownloadEvent>(
          APP_UPDATER_EVENT,
          (event) => {
            switch (event.payload.event) {
              case "Started":
                contentLength = event.payload.contentLength ?? 0;
                setStatusText(
                  contentLength > 0
                    ? "Downloading update... 0%"
                    : "Downloading update...",
                );
                break;
              case "Progress":
                downloaded += event.payload.chunkLength ?? 0;
                if (contentLength > 0) {
                  const percent = Math.min(
                    99,
                    Math.round((downloaded / contentLength) * 100),
                  );
                  setStatusText(`Downloading update... ${percent}%`);
                }
                break;
              case "Installing":
                setStatusText("Installing update...");
                void showAlert({ title: "Installing update..." });
                break;
              case "Finished":
                setStatusText("Update installed. Restart GameVault to finish.");
                break;
            }
          },
        );

        await invoke<string | null>("download_and_install_app_update", {
          channel: updateChannel,
        });

        setAvailableVersion(null);
        setStatusText("Update installed. Restart GameVault to finish.");

        await showAlert({
          title: "Update installed",
          description:
            "GameVault has been updated. Restart the app to finish loading the new version.",
          affirmativeText: "OK",
        });
      } catch (error) {
        if (isMissingUpdaterFeedError(error)) {
          await handleMissingFeedFallback(error);
          return;
        }

        const message = formatUpdateError(error);
        console.error("Update check failed:", error);
        setErrorText(message);
        setStatusText(null);

        if (manual) {
          await showAlert({
            title: "Update failed",
            description: message,
            affirmativeText: "OK",
          });
        }
      } finally {
        if (removeProgressListener) {
          removeProgressListener();
        }

        runningRef.current = false;
        setIsChecking(false);
        setIsInstalling(false);
      }
    },
    [showAlert, updateChannel, updaterEnabled],
  );

  useEffect(() => {
    autoCheckedRef.current = false;
    setAvailableVersion(null);
    setErrorText(null);
    setStatusText(null);
  }, [updateChannel]);

  useEffect(() => {
    if (!updaterReady || !updaterEnabled || autoCheckedRef.current) {
      return;
    }

    autoCheckedRef.current = true;
    const timer = window.setTimeout(() => {
      void checkForUpdates();
    }, AUTO_CHECK_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [checkForUpdates, updaterEnabled, updaterReady]);

  return (
    <AppUpdaterContext.Provider
      value={{
        updateChannel,
        updaterEnabled,
        updaterReady,
        isChecking,
        isInstalling,
        availableVersion,
        errorText,
        statusText,
        setUpdateChannel,
        checkForUpdates,
      }}
    >
      {children}
    </AppUpdaterContext.Provider>
  );
}

export function useAppUpdater() {
  const context = useContext(AppUpdaterContext);

  if (!context) {
    throw new Error("useAppUpdater must be used within an AppUpdaterProvider");
  }

  return context;
}
