import { useCallback, useEffect, useState } from "react";
import { useDownloads, type ActiveDownload } from "@/context/DownloadContext";
import type { GameMetadata } from "@/api/models/GameMetadata";
import {
  GamevaultGameTypeEnum,
  type GamevaultGameTypeEnum as GameType,
} from "@/api/models/GamevaultGame";
import {
  FORCE_INSTALL_TYPES,
  pickPreferredInstaller,
  resolveInstallMode,
  type InstallCardState,
} from "./install-utils";

/**
 * Owns the expanded install-flow state for a single download card:
 * mode (portable/setup/undetected), installer selection and the async
 * installer scan. Automatically closes once installation completes.
 */
export function useInstallFlow(download: ActiveDownload) {
  const { listInstallExecutables, resetInstallationState } = useDownloads();
  const [installState, setInstallState] = useState<InstallCardState | null>(
    null,
  );

  useEffect(() => {
    if (download.installationStatus === "completed") {
      setInstallState(null);
    }
  }, [download.installationStatus]);

  const closeInstallView = useCallback(() => setInstallState(null), []);

  const setUndetectedMode = useCallback(() => {
    setInstallState({
      mode: "undetected",
      forcedType:
        FORCE_INSTALL_TYPES.find(
          (option) => option.value === download.gameType,
        )?.value || GamevaultGameTypeEnum.windows_setup,
      installerOptions: [],
      selectedInstaller: "",
      loadingInstallers: false,
      installerLoadError: undefined,
    });
  }, [download.gameType]);

  const openInstallFlow = useCallback(
    async (forcedType?: GameType) => {
      const effectiveType = forcedType || download.gameType;
      const mode = resolveInstallMode(effectiveType);

      resetInstallationState(download.gameId);

      if (mode === "setup") {
        setInstallState({
          mode,
          forcedType: effectiveType || GamevaultGameTypeEnum.windows_setup,
          installerOptions: [],
          selectedInstaller: "",
          loadingInstallers: true,
          installerLoadError: undefined,
        });

        try {
          const installerOptions = await listInstallExecutables(
            download.gameId,
          );
          const preferredInstaller = pickPreferredInstaller(
            installerOptions,
            (download.gameMetadata as GameMetadata | undefined)
              ?.installer_executable,
          );
          setInstallState({
            mode,
            forcedType: effectiveType || GamevaultGameTypeEnum.windows_setup,
            installerOptions,
            selectedInstaller: preferredInstaller,
            loadingInstallers: false,
            installerLoadError: installerOptions.length
              ? undefined
              : "No executable installer was found in the extracted files.",
          });
        } catch (error) {
          setInstallState({
            mode,
            forcedType: effectiveType || GamevaultGameTypeEnum.windows_setup,
            installerOptions: [],
            selectedInstaller: "",
            loadingInstallers: false,
            installerLoadError: String(error),
          });
        }
        return;
      }

      setInstallState({
        mode,
        forcedType: effectiveType || GamevaultGameTypeEnum.windows_setup,
        installerOptions: [],
        selectedInstaller: "",
        loadingInstallers: false,
        installerLoadError: undefined,
      });
    },
    [
      download.gameId,
      download.gameType,
      download.gameMetadata,
      listInstallExecutables,
      resetInstallationState,
    ],
  );

  const updateInstallState = useCallback(
    (patch: Partial<InstallCardState>) => {
      setInstallState((prev) => (prev ? { ...prev, ...patch } : prev));
    },
    [],
  );

  return {
    installState,
    openInstallFlow,
    closeInstallView,
    setUndetectedMode,
    updateInstallState,
  };
}
