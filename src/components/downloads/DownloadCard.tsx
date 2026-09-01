import { useState, type ComponentType, type ReactNode } from "react";
import { useDownloads, type ActiveDownload } from "@/context/DownloadContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { Button } from "@/components/tailwind/button";
import { Badge } from "@/components/tailwind/badge";
import {
  Dropdown,
  DropdownButton,
  DropdownDivider,
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
} from "@/components/tailwind/dropdown";
import { Media } from "@/components/Media";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import { formatDecimal } from "@/utils/number";
import { isTauriApp } from "@/utils/tauri";
import { PhaseSteps, type StepState } from "./PhaseSteps";
import { PhaseDetail } from "./PhaseDetail";
import { useInstallFlow } from "./useInstallFlow";
import {
  ArchiveBoxIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ComputerDesktopIcon,
  EllipsisHorizontalIcon,
  ExclamationTriangleIcon,
  FolderOpenIcon,
  PauseIcon,
  PlayIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

type ChipColor = "blue" | "green" | "red" | "amber";

function getStatusChip(download: ActiveDownload): {
  label: string;
  color: ChipColor;
  icon: ComponentType<{ className?: string }>;
} {
  if (download.status === "downloading") {
    return { label: "Downloading", color: "blue", icon: ArrowDownTrayIcon };
  }
  if (download.status === "paused") {
    return { label: "Paused", color: "amber", icon: PauseIcon };
  }
  if (download.status === "error") {
    return { label: "Failed", color: "red", icon: ExclamationTriangleIcon };
  }
  if (download.status === "aborted") {
    return { label: "Cancelled", color: "red", icon: XMarkIcon };
  }
  if (download.installationStatus === "completed") {
    return { label: "Installed", color: "green", icon: CheckCircleIcon };
  }
  if (
    download.installationStatus === "copying" ||
    download.installationStatus === "launching" ||
    download.installationStatus === "running"
  ) {
    return { label: "Installing", color: "blue", icon: ComputerDesktopIcon };
  }
  if (download.extractionStatus === "completed") {
    return { label: "Extracted", color: "blue", icon: ArchiveBoxIcon };
  }
  return { label: "Done", color: "green", icon: CheckCircleIcon };
}

function getDownloadStepState(status: string): StepState {
  if (status === "completed") return "done";
  if (status === "downloading") return "active";
  if (status === "paused") return "active";
  if (status === "error" || status === "aborted") return "error";
  return "pending";
}

function getExtractionStepState(download: ActiveDownload): StepState {
  if (download.status !== "completed") return "pending";
  if (download.extractionStatus === "completed") return "done";
  if (download.extractionStatus === "extracting") return "active";
  if (
    download.extractionStatus === "error" ||
    download.extractionStatus === "needs-password"
  ) {
    return "error";
  }
  return "active";
}

function getInstallationStepState(download: ActiveDownload): StepState {
  if (download.extractionStatus !== "completed") return "pending";
  if (download.installationStatus === "completed") return "done";
  if (
    download.installationStatus === "copying" ||
    download.installationStatus === "launching" ||
    download.installationStatus === "running"
  ) {
    return "active";
  }
  if (download.installationStatus === "error") return "error";
  return "pending";
}

export function DownloadCard({
  download,
  index = 0,
}: {
  download: ActiveDownload;
  index?: number;
}) {
  const {
    cancelDownload,
    pauseDownload,
    resumeDownload,
    deleteDownloadCard,
    retryDownload,
    openDownloadFolder,
    extractArchive,
    formatBytes,
    formatSpeed,
  } = useDownloads();
  const { showAlert } = useAlertDialog();
  const isTauri = isTauriApp();
  const [password, setPassword] = useState("");
  const {
    installState,
    openInstallFlow,
    closeInstallView,
    setUndetectedMode,
    updateInstallState,
  } = useInstallFlow(download);

  const downloadStep = getDownloadStepState(download.status);
  const extractionStep = getExtractionStepState(download);
  const installationStep = getInstallationStepState(download);
  const status = getStatusChip(download);

  const isExtracting = download.extractionStatus === "extracting";
  const needsPassword =
    download.extractionStatus === "needs-password" ||
    download.extractionPasswordRequired;
  const isInstalling =
    download.installationStatus === "copying" ||
    download.installationStatus === "launching" ||
    download.installationStatus === "running";
  const isInstalled = download.installationStatus === "completed";
  const isExtracted = download.extractionStatus === "completed";
  const isFailed = download.status === "error" || download.status === "aborted";
  const installViewOpen = installState !== null;

  const handleExtract = async () => {
    await extractArchive(download.gameId, password);
  };

  const handleDeleteCard = async () => {
    const confirmed = await showAlert({
      title: "Delete download?",
      description:
        "Do you really want to delete this download card? This removes only the Download and Extraction folders for this game version.",
      affirmativeText: "Yes",
      negativeText: "No",
    });
    if (!confirmed) return;
    await deleteDownloadCard(download.gameId);
  };

  const steps = [
    {
      id: "download",
      label: "Download",
      state: downloadStep,
      valueText:
        downloadStep === "active" && download.progress !== null
          ? `${formatDecimal(download.progress, 1)}%`
          : undefined,
    },
    {
      id: "extraction",
      label: "Extraction",
      state: extractionStep,
      valueText:
        extractionStep === "active" &&
        download.extractionProgress !== null &&
        download.extractionProgress !== undefined
          ? `${formatDecimal(download.extractionProgress, 1)}%`
          : undefined,
    },
    {
      id: "installation",
      label: "Installation",
      state: installationStep,
      valueText:
        installationStep === "active" &&
        download.installationProgress !== null &&
        download.installationProgress !== undefined
          ? `${formatDecimal(download.installationProgress, 1)}%`
          : undefined,
    },
  ];

  const primaryAction: ReactNode = (() => {
    if (installViewOpen) return null;

    if (download.status === "downloading") {
      return (
        <Button color="amber" onClick={() => pauseDownload(download.gameId)}>
          <PauseIcon className="h-4 w-4" aria-hidden="true" />
          Pause
        </Button>
      );
    }
    if (download.status === "paused") {
      return (
        <Button color="indigo" onClick={() => resumeDownload(download.gameId)}>
          <PlayIcon className="h-4 w-4" aria-hidden="true" />
          Resume
        </Button>
      );
    }
    if (isFailed) {
      return (
        <Button color="indigo" onClick={() => retryDownload(download.gameId)}>
          <ArrowPathIcon className="h-4 w-4" aria-hidden="true" />
          Try Again
        </Button>
      );
    }
    if (download.status === "completed" && !isExtracted) {
      return (
        <Button
          color={
            needsPassword || download.extractionStatus === "error"
              ? "amber"
              : "indigo"
          }
          onClick={() => void handleExtract()}
          disabled={isExtracting}
        >
          {isExtracting
            ? "Extracting..."
            : download.extractionStatus === "completed"
              ? "Extract Again"
              : needsPassword || download.extractionStatus === "error"
                ? "Try Extraction Again"
                : "Start Extraction"}
        </Button>
      );
    }
    if (download.status === "completed" && isExtracted && isTauri) {
      if (isInstalling) {
        return (
          <Button color="indigo" disabled>
            Installing...
          </Button>
        );
      }
      if (isInstalled) {
        return (
          <Button color="indigo" href={`/library/${download.gameId}`}>
            Go to Game
          </Button>
        );
      }
      return (
        <Button color="indigo" onClick={() => void openInstallFlow()}>
          Install
        </Button>
      );
    }
    return null;
  })();

  return (
    <div
      className="surface-panel rounded-2xl p-4 transition-colors duration-150 hover:border-gv-line-strong animate-[panel-in_0.18s_ease-out] motion-reduce:animate-none sm:p-5"
      style={{ animationDelay: `${Math.min(index * 0.05, 0.3)}s` }}
    >
      <div className="flex items-center gap-4 sm:gap-5">
        <div className="shrink-0">
          {(download.gameMetadata as any)?.cover ? (
            <Media
              media={(download.gameMetadata as any).cover}
              width={112}
              height={150}
              square
              alt={`${download.gameTitle} cover art`}
              className="overflow-hidden rounded-lg border border-gv-line bg-gv-panel-soft shadow-sm"
              gameId={download.gameId}
              mediaSlot="cover"
              fallback={
                <CoverPlaceholder
                  title={download.gameTitle || "Game"}
                  size="large"
                  className="h-full w-full"
                />
              }
            />
          ) : (
            <div className="aspect-3/4 w-28 overflow-hidden rounded-lg border border-dashed border-gv-line bg-gv-panel-soft">
              <CoverPlaceholder
                title={download.gameTitle || "Game"}
                size="large"
                className="h-full w-full"
              />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3
                className="truncate text-base font-semibold tracking-[-0.02em] text-gv-text"
                title={download.gameTitle || download.filename}
              >
                {download.gameTitle || download.filename}
              </h3>
              <p
                className="mt-1 truncate font-mono text-sm text-gv-muted"
                title={download.filename}
              >
                {download.filename}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gv-muted">
                <span className="tabular-nums">
                  {formatBytes(download.received)} /{" "}
                  {download.total ? formatBytes(download.total) : "Unknown"}
                </span>
                {download.speedBps !== undefined &&
                  download.status === "downloading" && (
                    <span className="tabular-nums">
                      {formatSpeed(download.speedBps)}
                    </span>
                  )}
              </div>
            </div>
            <Badge color={status.color} className="shrink-0">
              <status.icon className="size-4" aria-hidden="true" />
              {status.label}
            </Badge>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <PhaseSteps steps={steps} />
      </div>

      <div className="mt-4">
        <PhaseDetail
          download={download}
          isTauri={isTauri}
          password={password}
          onPasswordChange={setPassword}
          installState={installState}
          onUpdateInstallState={updateInstallState}
          onCloseInstallView={closeInstallView}
          onSetUndetectedMode={setUndetectedMode}
          onForceInstall={() => {
            if (installState) void openInstallFlow(installState.forcedType);
          }}
        />
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-gv-line pt-3">
        {primaryAction}
        <Dropdown>
          <DropdownButton
            as={Button}
            plain
            aria-label="More actions"
            title="More actions"
          >
            <EllipsisHorizontalIcon className="h-4 w-4" aria-hidden="true" />
          </DropdownButton>
          <DropdownMenu anchor="bottom end" className="min-w-48">
            {isTauri && (
              <DropdownItem
                onClick={() => void openDownloadFolder(download.gameId)}
                disabled={!download.downloadDirectory}
              >
                <FolderOpenIcon data-slot="icon" aria-hidden="true" />
                <DropdownLabel>Open Folder</DropdownLabel>
              </DropdownItem>
            )}
            {isExtracted && !download.sourceFilesDeleted && (
              <DropdownItem onClick={() => void handleExtract()}>
                <ArchiveBoxIcon data-slot="icon" aria-hidden="true" />
                <DropdownLabel>Extract Again</DropdownLabel>
              </DropdownItem>
            )}
            {download.status === "downloading" && (
              <DropdownItem onClick={() => cancelDownload(download.gameId)}>
                <XMarkIcon data-slot="icon" aria-hidden="true" />
                <DropdownLabel>Cancel Download</DropdownLabel>
              </DropdownItem>
            )}
            {isInstalled && isTauri && (
              <DropdownItem onClick={() => void openInstallFlow()}>
                <ArrowPathIcon data-slot="icon" aria-hidden="true" />
                <DropdownLabel>Install Again</DropdownLabel>
              </DropdownItem>
            )}
            <DropdownDivider />
            <DropdownItem onClick={() => void handleDeleteCard()}>
              <TrashIcon data-slot="icon" aria-hidden="true" />
              <DropdownLabel>Delete</DropdownLabel>
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
      </div>
    </div>
  );
}
