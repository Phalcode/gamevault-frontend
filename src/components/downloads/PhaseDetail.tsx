import { Badge } from "@/components/tailwind/badge";
import { Input } from "@tw/input";
import type { ActiveDownload } from "@/context/DownloadContext";
import { ProgressBar } from "@/components/tailwind/progress";
import { InstallFlow } from "./InstallFlow";
import type { InstallCardState } from "./install-utils";
import {
  ArchiveBoxIcon,
  ComputerDesktopIcon,
  ExclamationTriangleIcon,
  KeyIcon,
} from "@heroicons/react/24/outline";
import { formatDecimal } from "@/utils/number";

type PhaseDetailProps = {
  download: ActiveDownload;
  isTauri: boolean;
  password: string;
  onPasswordChange: (value: string) => void;
  installState: InstallCardState | null;
  onUpdateInstallState: (patch: Partial<InstallCardState>) => void;
  onCloseInstallView: () => void;
  onSetUndetectedMode: () => void;
  onForceInstall: () => void;
};

function ErrorNote({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400">
      <ExclamationTriangleIcon
        className="mt-0.5 size-4 shrink-0"
        aria-hidden="true"
      />
      <span className="min-w-0">{message}</span>
    </div>
  );
}

export function PhaseDetail({
  download,
  isTauri,
  password,
  onPasswordChange,
  installState,
  onUpdateInstallState,
  onCloseInstallView,
  onSetUndetectedMode,
  onForceInstall,
}: PhaseDetailProps) {
  const isDownloadingOrPaused =
    download.status === "downloading" || download.status === "paused";
  const isFailed =
    download.status === "error" || download.status === "aborted";
  const isExtracting = download.extractionStatus === "extracting";
  const needsPassword =
    download.extractionStatus === "needs-password" ||
    download.extractionPasswordRequired;
  const isInstallCopyingOrLaunching =
    download.installationStatus === "copying" ||
    download.installationStatus === "launching";

  const extractionProgressText =
    download.extractionProgress !== null &&
    download.extractionProgress !== undefined
      ? `${formatDecimal(download.extractionProgress, 1)}%`
      : "In progress";

  const installProgressText =
    download.installationStatus === "copying" &&
    download.installationProgress !== null &&
    download.installationProgress !== undefined
      ? `${formatDecimal(download.installationProgress, 1)}%`
      : download.installationStatus === "launching"
        ? "Starting"
        : "In progress";

  return (
    <div className="surface-panel-soft rounded-xl p-4">
      {installState ? (
        <InstallFlow
          download={download}
          installState={installState}
          onUpdate={onUpdateInstallState}
          onClose={onCloseInstallView}
          onSetUndetectedMode={onSetUndetectedMode}
          onForceInstall={onForceInstall}
        />
      ) : isDownloadingOrPaused ? (
        <ProgressBar
          label="Download progress"
          value={download.progress}
          valueText={
            download.status === "paused"
              ? "Paused"
              : `${formatDecimal(download.progress ?? 0, 1)}%`
          }
        />
      ) : isFailed ? (
        download.error ? (
          <ErrorNote message={download.error} />
        ) : (
          <p className="text-xs text-gv-muted">
            {download.status === "aborted"
              ? "Download was cancelled."
              : "Download failed."}
          </p>
        )
      ) : download.status === "completed" ? (
        <div className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-gv-text">
                <ArchiveBoxIcon
                  className="size-4 shrink-0 text-gv-accent"
                  aria-hidden="true"
                />
                <span className="truncate">Extraction</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {download.extractionStatus === "completed" && (
                  <Badge color="green">Extracted</Badge>
                )}
                {needsPassword && (
                  <Badge color="amber">Password needed</Badge>
                )}
              </div>
            </div>

            {needsPassword && (
              <div className="space-y-1.5">
                <label
                  htmlFor={`archive-password-${download.gameId}`}
                  className="flex items-center gap-1.5 text-xs text-gv-muted"
                >
                  <KeyIcon className="size-4" aria-hidden="true" />
                  Archive password
                </label>
                <Input
                  id={`archive-password-${download.gameId}`}
                  type="password"
                  value={password}
                  onChange={(event) => onPasswordChange(event.target.value)}
                  placeholder="Enter archive password"
                />
              </div>
            )}

            {isExtracting && (
              <ProgressBar
                label="Extracting"
                value={download.extractionProgress}
                valueText={extractionProgressText}
                currentFile={download.extractionCurrentFile}
              />
            )}

            {download.extractionError && (
              <ErrorNote message={download.extractionError} />
            )}

            {download.sourceFilesDeleted && (
              <p className="text-xs text-gv-muted">
                Source files were deleted, so this download can no longer be
                extracted.
              </p>
            )}
          </div>

          {download.extractionStatus === "completed" && isTauri && (
            <div className="space-y-3 border-t border-gv-line pt-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-gv-text">
                  <ComputerDesktopIcon
                    className="size-4 shrink-0 text-gv-accent"
                    aria-hidden="true"
                  />
                  <span className="truncate">Installation</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {download.installationStatus === "completed" && (
                    <Badge color="green">Installed</Badge>
                  )}
                  {download.installationStatus === "running" && (
                    <Badge color="blue">Running</Badge>
                  )}
                  {download.installationStatus === "copying" && (
                    <Badge color="blue">Copying</Badge>
                  )}
                </div>
              </div>

              <p className="text-xs text-gv-muted">
                {download.installationStatus === "completed"
                  ? "The game is installed and ready to play."
                  : download.installationStatus === "copying"
                    ? "Copying the game files to the installation folder…"
                    : download.installationStatus === "launching"
                      ? "Launching the game's installer…"
                      : download.installationStatus === "running"
                        ? "The installer is running. Follow its steps to finish the setup."
                        : download.sourceFilesDeleted
                          ? "Source files were deleted after installation."
                          : "Start the installation process for this extracted game."}
              </p>

              {isInstallCopyingOrLaunching && (
                <ProgressBar
                  label={
                    download.installationStatus === "copying"
                      ? "Installation Copy"
                      : "Installer Launch"
                  }
                  value={download.installationProgress}
                  valueText={installProgressText}
                  currentFile={download.installationCurrentFile}
                />
              )}

              {download.installationError && (
                <ErrorNote message={download.installationError} />
              )}

              {download.installationStatus === "completed" &&
                download.installationDirectory && (
                  <p className="truncate text-xs text-gv-muted" title={download.installationDirectory}>
                    Installed to {download.installationDirectory}.
                  </p>
                )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
