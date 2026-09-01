import { Button } from "@/components/tailwind/button";
import { Badge } from "@/components/tailwind/badge";
import { Listbox, ListboxLabel, ListboxOption } from "@tw/listbox";
import { useDownloads, type ActiveDownload } from "@/context/DownloadContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { ProgressBar } from "@/components/tailwind/progress";
import type { GamevaultGameTypeEnum as GameType } from "@/api/models/GamevaultGame";
import {
  ClipboardDocumentIcon,
  ComputerDesktopIcon,
  PencilSquareIcon,
} from "@heroicons/react/24/outline";
import { formatDecimal } from "@/utils/number";
import {
  FORCE_INSTALL_TYPES,
  formatGameTypeLabel,
  type InstallCardState,
} from "./install-utils";

type InstallFlowProps = {
  download: ActiveDownload;
  installState: InstallCardState;
  onUpdate: (patch: Partial<InstallCardState>) => void;
  onClose: () => void;
  onSetUndetectedMode: () => void;
  onForceInstall: () => void;
};

export function InstallFlow({
  download,
  installState,
  onUpdate,
  onClose,
  onSetUndetectedMode,
  onForceInstall,
}: InstallFlowProps) {
  const { copyInstallationFiles, launchInstallationExecutable } =
    useDownloads();
  const { showAlert } = useAlertDialog();

  const gameTypeLabel = formatGameTypeLabel(
    installState.mode === "undetected"
      ? installState.forcedType
      : download.gameType || installState.forcedType,
  );
  const installationBusy =
    download.installationStatus === "copying" ||
    download.installationStatus === "launching" ||
    download.installationStatus === "running";

  const copyProgressText =
    download.installationProgress !== null &&
    download.installationProgress !== undefined
      ? `${formatDecimal(download.installationProgress, 1)}%`
      : "In progress";

  const handleCopyInstallPath = async (path?: string) => {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      await showAlert({ title: "Path copied" });
    } catch {
      await showAlert({ title: "Could not copy path", description: path });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <ComputerDesktopIcon
            className="size-5 shrink-0 text-gv-accent"
            aria-hidden="true"
          />
          <span className="truncate text-sm font-semibold text-gv-text">
            Installation
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge color="indigo">{gameTypeLabel}</Badge>
          {download.installationStatus === "running" && (
            <Badge color="blue">Running</Badge>
          )}
          {download.installationStatus === "copying" && (
            <Badge color="blue">Copying</Badge>
          )}
          <Button plain onClick={onSetUndetectedMode}>
            <PencilSquareIcon className="h-4 w-4" aria-hidden="true" />
            Edit
          </Button>
        </div>
      </div>

      {installState.mode === "portable" && (
        <div className="space-y-4">
          <p className="text-sm text-gv-muted">
            This is a portable game, so there is no setup to run. Just press
            "Install" and GameVault will copy the game files to the game's
            installation folder.
          </p>

          {download.installationStatus === "copying" && (
            <ProgressBar
              label="Copy Progress"
              value={download.installationProgress}
              valueText={copyProgressText}
              currentFile={download.installationCurrentFile}
            />
          )}
        </div>
      )}

      {installState.mode === "setup" && (
        <div className="space-y-4">
          <ol className="list-decimal space-y-1.5 pl-4 text-sm text-gv-muted marker:text-gv-muted">
            <li>Pick the correct installer from the dropdown menu below.</li>
          </ol>

          <Listbox
            value={installState.selectedInstaller}
            onChange={(value) =>
              onUpdate({ selectedInstaller: String(value || "") })
            }
            placeholder={
              installState.loadingInstallers
                ? "Scanning extracted files..."
                : "Select an installer"
            }
            aria-label="Installer executable"
            disabled={installState.loadingInstallers}
          >
            {installState.installerOptions.map((option) => (
              <ListboxOption key={option} value={option}>
                <ListboxLabel>{option}</ListboxLabel>
              </ListboxOption>
            ))}
          </Listbox>

          <ol
            start={2}
            className="list-decimal space-y-1.5 pl-4 text-sm text-gv-muted marker:text-gv-muted"
          >
            <li>Hit the 'Install' button to launch the game's installer.</li>
            <li>Go through the game's setup process.</li>
            <li>
              If not already set, make sure to select this folder as the installer's destination:
            </li>
          </ol>

          <div className="surface-panel-soft rounded-xl p-3">
            <div className="flex items-center justify-between gap-3">
              <p
                className="min-w-0 flex-1 truncate font-mono text-xs text-gv-muted"
                title={download.installationDirectory}
              >
                {download.installationDirectory ||
                  "No installation path available"}
              </p>
              <Button
                color="zinc"
                onClick={() =>
                  void handleCopyInstallPath(download.installationDirectory)
                }
                disabled={!download.installationDirectory}
              >
                <ClipboardDocumentIcon className="h-4 w-4" aria-hidden="true" />
                Copy Path
              </Button>
            </div>
          </div>

          {installState.installerLoadError && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {installState.installerLoadError}
            </p>
          )}
        </div>
      )}

      {installState.mode === "undetected" && (
        <div className="space-y-4">
          <p className="text-sm text-gv-muted">
            Unable to detect game type. You can try forcing an installation
            procedure by selecting it from the options below.
          </p>

          <Listbox
            value={installState.forcedType}
            onChange={(value) => onUpdate({ forcedType: value as GameType })}
            aria-label="Forced installation type"
          >
            {FORCE_INSTALL_TYPES.map((option) => (
              <ListboxOption key={option.value} value={option.value}>
                <ListboxLabel>{option.label}</ListboxLabel>
              </ListboxOption>
            ))}
          </Listbox>
        </div>
      )}

      {download.installationError && (
        <div className="text-xs text-red-600 dark:text-red-400">
          {download.installationError}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button color="zinc" onClick={onClose}>
          Cancel
        </Button>

        <div className="flex items-center gap-2">
          {download.installationStatus === "running" && (
            <span className="text-xs font-medium text-gv-accent">Running</span>
          )}

          {installState.mode === "portable" && (
            <Button
              color="indigo"
              onClick={() => void copyInstallationFiles(download.gameId)}
              disabled={installationBusy}
            >
              {download.installationStatus === "copying"
                ? "Installing..."
                : "Install"}
            </Button>
          )}

          {installState.mode === "setup" && (
            <Button
              color="indigo"
              onClick={() =>
                void launchInstallationExecutable(
                  download.gameId,
                  installState.selectedInstaller,
                )
              }
              disabled={
                installationBusy ||
                installState.loadingInstallers ||
                !installState.selectedInstaller
              }
            >
              {download.installationStatus === "launching"
                ? "Launching..."
                : "Install"}
            </Button>
          )}

          {installState.mode === "undetected" && (
            <Button color="indigo" onClick={onForceInstall}>
              Force Installation
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
