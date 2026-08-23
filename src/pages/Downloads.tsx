import { useDownloads, type ActiveDownload } from "@/context/DownloadContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { Button } from "@/components/tailwind/button";
import { Media } from "@/components/Media";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import { Heading } from "@tw/heading";
import { Text } from "@tw/text";
import { Divider } from "@tw/divider";
import { Badge } from "@/components/tailwind/badge";
import { Input } from "@tw/input";
import { Listbox, ListboxLabel, ListboxOption } from "@tw/listbox";
import { isTauriApp } from "@/utils/tauri";
import type { GameMetadata } from "@/api/models/GameMetadata";
import {
  GamevaultGameTypeEnum,
  type GamevaultGameTypeEnum as GameType,
} from "@/api/models/GamevaultGame";
import { useEffect, useMemo, useState } from "react";
import {
  ArchiveBoxIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ClipboardDocumentIcon,
  ClockIcon,
  ComputerDesktopIcon,
  ExclamationTriangleIcon,
  FolderOpenIcon,
  KeyIcon,
  PauseIcon,
  PencilSquareIcon,
  PlayIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

type StepState = "pending" | "active" | "done" | "error";
type InstallViewMode = "portable" | "setup" | "undetected";

type InstallCardState = {
  mode: InstallViewMode;
  forcedType: GameType;
  installerOptions: string[];
  selectedInstaller: string;
  loadingInstallers: boolean;
  installerLoadError?: string;
};

const FORCE_INSTALL_TYPES: { label: string; value: GameType }[] = [
  { label: "Windows Setup", value: GamevaultGameTypeEnum.windows_setup },
  { label: "Windows Portable", value: GamevaultGameTypeEnum.windows_portable },
  { label: "Linux Portable", value: GamevaultGameTypeEnum.linux_portable },
];

function StepDot({ state }: { state: StepState }) {
  if (state === "done") {
    return <CheckCircleIcon className="h-5 w-5 text-green-500" />;
  }
  if (state === "error") {
    return <ExclamationTriangleIcon className="h-5 w-5 text-red-500" />;
  }
  if (state === "active") {
    return <ClockIcon className="h-5 w-5 text-gv-accent" />;
  }
  return <div className="h-3 w-3 rounded-full bg-gv-line" />;
}

function formatGameTypeLabel(gameType?: string) {
  if (!gameType) return "Undetectable";
  return gameType
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function resolveInstallMode(gameType?: string): InstallViewMode {
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

function normalizeRelativePath(value?: string) {
  return (value || "").replace(/\\/g, "/").toLowerCase();
}

function pickPreferredInstaller(options: string[], preferred?: string) {
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

export default function Downloads() {
  const {
    downloads,
    cancelDownload,
    pauseDownload,
    resumeDownload,
    deleteDownloadCard,
    retryDownload,
    openDownloadFolder,
    extractArchive,
    listInstallExecutables,
    copyInstallationFiles,
    launchInstallationExecutable,
    resetInstallationState,
    formatBytes,
    formatSpeed,
  } = useDownloads();
  const { showAlert } = useAlertDialog();
  const [passwordByGame, setPasswordByGame] = useState<Record<number, string>>(
    {},
  );
  const [installStateByGame, setInstallStateByGame] = useState<
    Record<number, InstallCardState>
  >({});
  const isTauri = isTauriApp();

  const downloadArray = useMemo(() => Object.values(downloads), [downloads]);

  useEffect(() => {
    setInstallStateByGame((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of Object.keys(prev)) {
        const gameId = Number(key);
        const download = downloads[gameId];
        if (!download || download.installationStatus === "completed") {
          delete next[gameId];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [downloads]);

  const getDownloadStepState = (status: string): StepState => {
    if (status === "completed") return "done";
    if (status === "downloading") return "active";
    if (status === "paused") return "active";
    if (status === "error" || status === "aborted") return "error";
    return "pending";
  };

  const getExtractionStepState = (download: ActiveDownload): StepState => {
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
  };

  const getInstallationStepState = (download: ActiveDownload): StepState => {
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
  };

  const handleExtract = async (gameId: number) => {
    const password = passwordByGame[gameId];
    await extractArchive(gameId, password);
  };

  const handleDeleteCard = async (gameId: number) => {
    const confirmed = await showAlert({
      title: "Delete download?",
      description:
        "Do you really want to delete this download card? This removes only the Download and Extraction folders for this game version.",
      affirmativeText: "Yes",
      negativeText: "No",
    });
    if (!confirmed) return;
    await deleteDownloadCard(gameId);
  };

  const closeInstallView = (gameId: number) => {
    setInstallStateByGame((prev) => {
      if (!prev[gameId]) return prev;
      const next = { ...prev };
      delete next[gameId];
      return next;
    });
  };

  const setUndetectedMode = (download: ActiveDownload) => {
    setInstallStateByGame((prev) => ({
      ...prev,
      [download.gameId]: {
        mode: "undetected",
        forcedType:
          FORCE_INSTALL_TYPES.find(
            (option) => option.value === download.gameType,
          )?.value || GamevaultGameTypeEnum.windows_setup,
        installerOptions: [],
        selectedInstaller: "",
        loadingInstallers: false,
        installerLoadError: undefined,
      },
    }));
  };

  const openInstallFlow = async (
    download: ActiveDownload,
    forcedType?: GameType,
  ) => {
    const effectiveType = forcedType || download.gameType;
    const mode = resolveInstallMode(effectiveType);

    resetInstallationState(download.gameId);

    if (mode === "setup") {
      setInstallStateByGame((prev) => ({
        ...prev,
        [download.gameId]: {
          mode,
          forcedType: effectiveType || GamevaultGameTypeEnum.windows_setup,
          installerOptions: [],
          selectedInstaller: "",
          loadingInstallers: true,
          installerLoadError: undefined,
        },
      }));

      try {
        const installerOptions = await listInstallExecutables(download.gameId);
        const preferredInstaller = pickPreferredInstaller(
          installerOptions,
          (download.gameMetadata as GameMetadata | undefined)
            ?.installer_executable,
        );
        setInstallStateByGame((prev) => ({
          ...prev,
          [download.gameId]: {
            mode,
            forcedType: effectiveType || GamevaultGameTypeEnum.windows_setup,
            installerOptions,
            selectedInstaller: preferredInstaller,
            loadingInstallers: false,
            installerLoadError: installerOptions.length
              ? undefined
              : "No executable installer was found in the extracted files.",
          },
        }));
      } catch (error) {
        setInstallStateByGame((prev) => ({
          ...prev,
          [download.gameId]: {
            mode,
            forcedType: effectiveType || GamevaultGameTypeEnum.windows_setup,
            installerOptions: [],
            selectedInstaller: "",
            loadingInstallers: false,
            installerLoadError: String(error),
          },
        }));
      }
      return;
    }

    setInstallStateByGame((prev) => ({
      ...prev,
      [download.gameId]: {
        mode,
        forcedType: effectiveType || GamevaultGameTypeEnum.windows_setup,
        installerOptions: [],
        selectedInstaller: "",
        loadingInstallers: false,
        installerLoadError: undefined,
      },
    }));
  };

  const handleCopyInstallPath = async (path?: string) => {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      await showAlert({
        title: "Path copied",
      });
    } catch {
      await showAlert({
        title: "Could not copy path",
        description: path,
      });
    }
  };

  const updateInstallState = (
    gameId: number,
    patch: Partial<InstallCardState>,
  ) => {
    setInstallStateByGame((prev) => {
      const existing = prev[gameId];
      if (!existing) return prev;
      return {
        ...prev,
        [gameId]: {
          ...existing,
          ...patch,
        },
      };
    });
  };

  const renderInstallFlow = (
    download: ActiveDownload,
    installState: InstallCardState,
  ) => {
    const gameTypeLabel = formatGameTypeLabel(
      installState.mode === "undetected"
        ? installState.forcedType
        : download.gameType || installState.forcedType,
    );
    const installationBusy =
      download.installationStatus === "copying" ||
      download.installationStatus === "launching" ||
      download.installationStatus === "running";

    return (
      <div className="surface-panel-soft rounded-xl p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ComputerDesktopIcon className="h-5 w-5 text-gv-accent" />
              <span className="text-sm font-semibold text-gv-text">
                Installation
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge color="indigo">{gameTypeLabel}</Badge>
              {download.installationStatus === "running" && (
                <Badge color="blue">Running</Badge>
              )}
              {download.installationStatus === "copying" && (
                <Badge color="blue">Copying</Badge>
              )}
            </div>
          </div>
          <Button plain onClick={() => setUndetectedMode(download)}>
            <PencilSquareIcon className="h-4 w-4" />
            Edit
          </Button>
        </div>

        {installState.mode === "portable" && (
          <div className="space-y-4">
            <p className="text-sm text-gv-muted">
              Portable game needs just to be copied.
            </p>

            {download.installationStatus === "copying" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-gv-muted">
                  <span>Copy Progress</span>
                  <span>
                    {download.installationProgress !== null &&
                    download.installationProgress !== undefined
                      ? `${download.installationProgress.toFixed(1)}%`
                      : "In progress"}
                  </span>
                </div>
                <div className="relative w-full h-2 bg-gv-line rounded-full overflow-hidden">
                  <div
                    className="absolute left-0 top-0 h-full bg-gv-accent transition-[width] duration-300"
                    style={{ width: `${download.installationProgress ?? 0}%` }}
                  />
                </div>
                {download.installationCurrentFile && (
                  <p
                    className="text-xs text-gv-muted truncate"
                    title={download.installationCurrentFile}
                  >
                    {download.installationCurrentFile}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {installState.mode === "setup" && (
          <div className="space-y-4">
            <div className="space-y-2 text-sm text-gv-muted">
              <p>To install this game, please follow the steps below:</p>
              <p>1. Pick the correct installer from the dropdown menu below.</p>
            </div>

            <Listbox
              value={installState.selectedInstaller}
              onChange={(value) =>
                updateInstallState(download.gameId, {
                  selectedInstaller: String(value || ""),
                })
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

            <div className="space-y-2 text-sm text-gv-muted">
              <p>2. Hit the 'Install' button to launch the games installer.</p>
              <p>3. Go through the game's setup process.</p>
              <p>
                Make sure to select this folder as the installers destination:
              </p>
            </div>

            <div className="surface-panel-soft rounded-xl p-3">
              <div className="flex items-center justify-between gap-3">
                <p
                  className="min-w-0 flex-1 truncate text-sm text-gv-muted"
                  title={download.installationDirectory}
                >
                  {download.installationDirectory ||
                    "No installation path available"}
                </p>
                <Button
                  color="zinc"
                  onClick={() =>
                    handleCopyInstallPath(download.installationDirectory)
                  }
                  disabled={!download.installationDirectory}
                >
                  <ClipboardDocumentIcon className="h-4 w-4" />
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
              onChange={(value) =>
                updateInstallState(download.gameId, {
                  forcedType: value as GameType,
                })
              }
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
          <Button
            color="zinc"
            onClick={() => closeInstallView(download.gameId)}
          >
            Cancel
          </Button>

          <div className="flex items-center gap-2">
            {download.installationStatus === "running" && (
              <span className="text-xs font-medium text-gv-accent">
                Running
              </span>
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
              <Button
                color="indigo"
                onClick={() =>
                  void openInstallFlow(download, installState.forcedType)
                }
              >
                Force Installation
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex min-h-full flex-col gap-6">
      <div className="space-y-2">
        <Heading>Downloads</Heading>
        <Text className="max-w-2xl">
          Track active, queued, and completed game downloads.
        </Text>
      </div>
      <Divider className="border-gv-line/80" />

      {downloadArray.length > 0 && (
        <div className="space-y-4">
          {downloadArray.map((download, index) => {
            const installView = installStateByGame[download.gameId];
            const installViewOpen = Boolean(installView);
            const downloadStep = getDownloadStepState(download.status);
            const extractionStep = getExtractionStepState(download);
            const installationStep = getInstallationStepState(download);
            const progressText =
              download.status === "downloading"
                ? `${download.progress?.toFixed(1) || "0.0"}%`
                : download.status === "paused"
                  ? "Paused"
                  : download.status === "completed"
                    ? "Done"
                    : download.status === "aborted"
                      ? "Cancelled"
                      : "Failed";

            return (
              <div
                key={download.gameId}
                className="surface-panel relative rounded-2xl p-4 sm:p-5 animate-[panel-in_0.18s_ease-out] motion-reduce:animate-none"
                style={{ animationDelay: `${Math.min(index * 0.05, 0.3)}s` }}
              >
                <div className="flex flex-col items-start gap-4 sm:flex-row">
                  <div className="shrink-0">
                    {(download.gameMetadata as any)?.cover ? (
                      <Media
                        media={(download.gameMetadata as any).cover}
                        width={96}
                        height={136}
                        square
                        alt={`${download.gameTitle} cover art`}
                        className="overflow-hidden rounded-lg border border-gv-line bg-gv-panel-soft shadow-sm"
                        gameId={download.gameId}
                        mediaSlot="cover"
                        fallback={
                          <CoverPlaceholder
                            title={download.gameTitle || "Game"}
                            size="normal"
                            className="h-full w-full"
                          />
                        }
                      />
                    ) : (
                      <div className="h-34 w-24 overflow-hidden rounded-lg border border-dashed border-gv-line bg-gv-panel-soft">
                        <CoverPlaceholder
                          title={download.gameTitle || "Game"}
                          size="normal"
                          className="h-full w-full"
                        />
                      </div>
                    )}
                  </div>

                  {!installViewOpen && (
                    <div className="pt-1 min-w-45">
                      <ol className="space-y-3">
                        <li className="flex items-center gap-2">
                          <StepDot state={downloadStep} />
                          <span className="text-sm font-medium text-gv-text">
                            Download
                          </span>
                        </li>
                        <li className="pl-2 ml-2.25 h-4 border-l border-gv-line" />
                        <li className="flex items-center gap-2">
                          <StepDot state={extractionStep} />
                          <span className="text-sm font-medium text-gv-text">
                            Extraction
                          </span>
                        </li>
                        <li className="pl-2 ml-2.25 h-4 border-l border-gv-line" />
                        <li className="flex items-center gap-2">
                          <StepDot state={installationStep} />
                          <span className="text-sm font-medium text-gv-text">
                            Installation
                          </span>
                        </li>
                      </ol>
                    </div>
                  )}

                  <div className="flex-1 min-w-0 space-y-3 self-stretch">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3
                          className="font-medium text-sm text-gv-text truncate"
                          title={download.filename}
                        >
                          {download.filename}
                        </h3>
                        <div className="mt-1 text-xs text-gv-muted flex flex-wrap items-center gap-2">
                          <span>
                            {formatBytes(download.received)} /{" "}
                            {download.total
                              ? formatBytes(download.total)
                              : "Unknown"}
                          </span>
                          {download.speedBps !== undefined &&
                            download.status === "downloading" && (
                              <>
                                <span>-</span>
                                <span>{formatSpeed(download.speedBps)}</span>
                              </>
                            )}
                        </div>
                      </div>
                      <Badge
                        color={
                          download.status === "completed"
                            ? "green"
                            : download.status === "error" ||
                                download.status === "aborted"
                              ? "red"
                              : "blue"
                        }
                      >
                        {progressText}
                      </Badge>
                    </div>

                    {(download.status === "downloading" ||
                      download.status === "paused") && (
                      <div className="relative w-full h-2 bg-gv-line rounded-full overflow-hidden">
                        <div
                          className="absolute left-0 top-0 h-full bg-gv-accent transition-[width] duration-300"
                          style={{ width: `${download.progress ?? 0}%` }}
                        />
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2">
                      {isTauri && (
                        <Button
                          color="zinc"
                          onClick={() =>
                            void openDownloadFolder(download.gameId)
                          }
                          disabled={!download.downloadDirectory}
                        >
                          <FolderOpenIcon className="h-4 w-4" />
                          Open Folder
                        </Button>
                      )}
                      {download.status === "downloading" && (
                        <Button
                          color="amber"
                          onClick={() => pauseDownload(download.gameId)}
                        >
                          <PauseIcon className="h-4 w-4" />
                          Pause
                        </Button>
                      )}
                      {download.status === "paused" && (
                        <Button
                          color="indigo"
                          onClick={() => resumeDownload(download.gameId)}
                        >
                          <PlayIcon className="h-4 w-4" />
                          Resume
                        </Button>
                      )}
                      {download.status === "downloading" && (
                        <Button
                          color="rose"
                          onClick={() => cancelDownload(download.gameId)}
                        >
                          <XMarkIcon className="h-4 w-4" />
                          Cancel
                        </Button>
                      )}
                      {(download.status === "error" ||
                        download.status === "aborted") && (
                        <Button
                          color="indigo"
                          onClick={() => retryDownload(download.gameId)}
                        >
                          <ArrowPathIcon className="h-4 w-4" />
                          Try Again
                        </Button>
                      )}
                      <Button
                        color="rose"
                        onClick={() => void handleDeleteCard(download.gameId)}
                      >
                        <TrashIcon className="h-4 w-4" />
                        Delete
                      </Button>
                    </div>

                    {download.error &&
                      (download.status === "error" ||
                        download.status === "aborted") && (
                        <div className="text-xs text-red-600 dark:text-red-400">
                          {download.error}
                        </div>
                      )}

                    {download.status === "completed" && !installViewOpen && (
                      <div className="space-y-3">
                        <div className="surface-panel-soft rounded-xl p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-sm font-medium text-gv-text">
                              <ArchiveBoxIcon className="h-4 w-4 text-gv-accent" />
                              Extraction
                            </div>
                            {download.extractionStatus === "completed" && (
                              <Badge color="green">Extracted</Badge>
                            )}
                          </div>

                          {(download.extractionStatus === "needs-password" ||
                            download.extractionPasswordRequired) && (
                            <div className="mt-3 space-y-2">
                              <label className="text-xs text-gv-muted flex items-center gap-1">
                                <KeyIcon className="h-4 w-4" />
                                Archive password
                              </label>
                              <Input
                                type="password"
                                value={passwordByGame[download.gameId] || ""}
                                onChange={(e: any) =>
                                  setPasswordByGame((prev) => ({
                                    ...prev,
                                    [download.gameId]: e.target.value,
                                  }))
                                }
                                placeholder="Enter archive password"
                              />
                            </div>
                          )}

                          <div className="mt-3 flex justify-end">
                            <Button
                              color={
                                download.extractionStatus === "error" ||
                                download.extractionStatus === "needs-password"
                                  ? "amber"
                                  : "indigo"
                              }
                              onClick={() =>
                                void handleExtract(download.gameId)
                              }
                              disabled={
                                download.extractionStatus === "extracting"
                              }
                            >
                              {download.extractionStatus === "extracting"
                                ? "Extracting..."
                                : download.extractionStatus === "completed"
                                  ? "Extract Again"
                                  : download.extractionStatus === "error" ||
                                      download.extractionStatus ===
                                        "needs-password"
                                    ? "Try Extraction Again"
                                    : "Start Extraction"}
                            </Button>
                          </div>

                          {download.extractionStatus === "extracting" && (
                            <div className="mt-3 space-y-2">
                              <div className="flex items-center justify-between text-xs text-gv-muted">
                                <span>Extraction Progress</span>
                                <span>
                                  {download.extractionProgress !== null &&
                                  download.extractionProgress !== undefined
                                    ? `${download.extractionProgress.toFixed(1)}%`
                                    : "In progress"}
                                </span>
                              </div>
                              <div className="relative w-full h-2 bg-gv-line rounded-full overflow-hidden">
                                <div
                                  className="absolute left-0 top-0 h-full bg-gv-accent transition-[width] duration-300"
                                  style={{
                                    width: `${download.extractionProgress ?? 0}%`,
                                  }}
                                />
                              </div>
                              {download.extractionCurrentFile && (
                                <p
                                  className="text-xs text-gv-muted truncate"
                                  title={download.extractionCurrentFile}
                                >
                                  {download.extractionCurrentFile}
                                </p>
                              )}
                            </div>
                          )}

                          {download.extractionError && (
                            <div className="mt-2 text-xs text-red-600 dark:text-red-400">
                              {download.extractionError}
                            </div>
                          )}
                        </div>

                        {download.extractionStatus === "completed" &&
                          isTauri && (
                            <div className="surface-panel-soft rounded-xl p-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 text-sm font-medium text-gv-text">
                                  <ComputerDesktopIcon className="h-4 w-4 text-gv-accent" />
                                  Installation
                                </div>
                                {download.installationStatus ===
                                  "completed" && (
                                  <Badge color="green">Installed</Badge>
                                )}
                                {download.installationStatus === "running" && (
                                  <Badge color="blue">Running</Badge>
                                )}
                              </div>

                              <p className="mt-2 text-xs text-gv-muted">
                                Start the installation process for this
                                extracted game.
                              </p>

                              {(download.installationStatus === "copying" ||
                                download.installationStatus ===
                                  "launching") && (
                                <div className="mt-3 space-y-2">
                                  <div className="flex items-center justify-between text-xs text-gv-muted">
                                    <span>
                                      {download.installationStatus === "copying"
                                        ? "Installation Copy"
                                        : "Installer Launch"}
                                    </span>
                                    <span>
                                      {download.installationStatus ===
                                        "copying" &&
                                      download.installationProgress !== null &&
                                      download.installationProgress !==
                                        undefined
                                        ? `${download.installationProgress.toFixed(1)}%`
                                        : download.installationStatus ===
                                            "launching"
                                          ? "Starting"
                                          : "In progress"}
                                    </span>
                                  </div>
                                  {download.installationStatus ===
                                    "copying" && (
                                    <div className="relative w-full h-2 bg-gv-line rounded-full overflow-hidden">
                                      <div
                                        className="absolute left-0 top-0 h-full bg-gv-accent transition-[width] duration-300"
                                        style={{
                                          width: `${download.installationProgress ?? 0}%`,
                                        }}
                                      />
                                    </div>
                                  )}
                                  {download.installationCurrentFile && (
                                    <p
                                      className="text-xs text-gv-muted truncate"
                                      title={download.installationCurrentFile}
                                    >
                                      {download.installationCurrentFile}
                                    </p>
                                  )}
                                </div>
                              )}

                              {download.installationError && (
                                <div className="mt-2 text-xs text-red-600 dark:text-red-400">
                                  {download.installationError}
                                </div>
                              )}

                              <div className="mt-3 flex justify-end gap-2">
                                <Button
                                  color="zinc"
                                  onClick={() => void openInstallFlow(download)}
                                  disabled={
                                    download.installationStatus === "copying" ||
                                    download.installationStatus === "launching"
                                  }
                                >
                                  {download.installationStatus === "completed"
                                    ? "Install Again"
                                    : "Install"}
                                </Button>
                                {download.installationStatus ===
                                  "completed" && (
                                  <Button
                                    color="indigo"
                                    href={`/library/${download.gameId}`}
                                  >
                                    Go to Game
                                  </Button>
                                )}
                              </div>
                            </div>
                          )}
                      </div>
                    )}

                    {download.status === "completed" &&
                      installViewOpen &&
                      renderInstallFlow(download, installView)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {downloadArray.length === 0 && (
        <div className="surface-panel-soft rounded-3xl py-16 text-center">
          <ArrowDownTrayIcon className="mx-auto h-12 w-12 text-gv-muted" />
          <h3 className="mt-3 text-sm font-semibold text-gv-text">
            No downloads
          </h3>
          <p className="mt-1 text-sm text-gv-muted">
            Start downloading games from your library
          </p>
        </div>
      )}
    </div>
  );
}
