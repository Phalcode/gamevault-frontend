import { useDownloads } from "@/context/DownloadContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { Button } from "@/components/tailwind/button";
import { Heading } from "@tw/heading";
import { Divider } from "@tw/divider";
import { Badge } from "@/components/tailwind/badge";
import { Input } from "@tw/input";
import { isTauriApp } from "@/utils/tauri";
import { useMemo, useState } from "react";
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  PauseIcon,
  PlayIcon,
  TrashIcon,
  ArchiveBoxIcon,
  CheckCircleIcon,
  ClockIcon,
  FolderOpenIcon,
  KeyIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";

type StepState = "pending" | "active" | "done" | "error";

function StepDot({ state }: { state: StepState }) {
  if (state === "done") {
    return <CheckCircleIcon className="h-5 w-5 text-green-600" />;
  }
  if (state === "error") {
    return <ExclamationTriangleIcon className="h-5 w-5 text-red-600" />;
  }
  if (state === "active") {
    return <ClockIcon className="h-5 w-5 text-indigo-600" />;
  }
  return <div className="h-3 w-3 rounded-full bg-zinc-300 dark:bg-zinc-700" />;
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
    formatBytes,
    formatSpeed,
  } = useDownloads();
  const { showAlert } = useAlertDialog();
  const [passwordByGame, setPasswordByGame] = useState<Record<number, string>>(
    {},
  );
  const isTauri = isTauriApp();

  const downloadArray = useMemo(() => Object.values(downloads), [downloads]);

  const getDownloadStepState = (status: string): StepState => {
    if (status === "completed") return "done";
    if (status === "downloading") return "active";
    if (status === "paused") return "active";
    if (status === "error" || status === "aborted") return "error";
    return "pending";
  };

  const getExtractionStepState = (download: any): StepState => {
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

  const handleExtract = async (gameId: number) => {
    const password = passwordByGame[gameId];
    await extractArchive(gameId, password);
  };

  const handleDeleteCard = async (gameId: number) => {
    const confirmed = await showAlert({
      title: "Delete download?",
      description:
        "Do you really want to delete this download card? This removes only the Downloads and Extractions folders for this game version.",
      affirmativeText: "Yes",
      negativeText: "No",
    });
    if (!confirmed) return;
    await deleteDownloadCard(gameId);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <Heading>Downloads</Heading>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Manage your game downloads for the GameVault desktop application
        </p>
      </div>

      <Divider className="my-6" />

      {downloadArray.length > 0 && (
        <div className="space-y-4 mb-8">
          {downloadArray.map((download) => {
            const downloadStep = getDownloadStepState(download.status);
            const extractionStep = getExtractionStepState(download);
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
                className="relative rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4"
              >
                <button
                  type="button"
                  aria-label="Delete download card"
                  title="Delete download and extraction folders"
                  onClick={() => void handleDeleteCard(download.gameId)}
                  className="absolute top-3 right-3 inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-300 text-zinc-600 hover:bg-zinc-100 hover:text-red-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-red-400"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
                <div className="flex items-start gap-4">
                  <div className="pt-1 min-w-[180px]">
                    <ol className="space-y-3">
                      <li className="flex items-center gap-2">
                        <StepDot state={downloadStep} />
                        <span className="text-sm font-medium">Download</span>
                      </li>
                      <li className="pl-2 ml-[9px] h-4 border-l border-zinc-300 dark:border-zinc-700" />
                      <li className="flex items-center gap-2">
                        <StepDot state={extractionStep} />
                        <span className="text-sm font-medium">Extraction</span>
                      </li>
                    </ol>
                  </div>

                  <div className="flex-1 min-w-0 space-y-3">
                    <div className="flex items-start justify-between gap-3 pr-10">
                      <div className="min-w-0">
                        <h3
                          className="font-medium text-sm text-zinc-900 dark:text-zinc-100 truncate"
                          title={download.filename}
                        >
                          {download.filename}
                        </h3>
                        <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 flex flex-wrap items-center gap-2">
                          <span>
                            {formatBytes(download.received)} /{" "}
                            {download.total ? formatBytes(download.total) : "Unknown"}
                          </span>
                          {download.speedBps !== undefined &&
                            download.status === "downloading" && (
                              <>
                                <span>•</span>
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
                      <div className="relative w-full h-2 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="absolute left-0 top-0 h-full bg-blue-500 transition-all duration-300"
                          style={{ width: `${download.progress ?? 0}%` }}
                        />
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2">
                      {isTauri && (
                        <Button
                          color="zinc"
                          onClick={() => void openDownloadFolder(download.gameId)}
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
                          color="red"
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
                    </div>

                    {download.error &&
                      (download.status === "error" ||
                        download.status === "aborted") && (
                        <div className="text-xs text-red-600 dark:text-red-400">
                          {download.error}
                        </div>
                      )}

                    {download.status === "completed" && (
                      <div className="mt-2 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-950/30">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <ArchiveBoxIcon className="h-4 w-4" />
                            Extraction
                          </div>
                          {download.extractionStatus === "completed" && (
                            <Badge color="green">Extracted</Badge>
                          )}
                        </div>

                        {(download.extractionStatus === "needs-password" ||
                          download.extractionPasswordRequired) && (
                          <div className="mt-3 space-y-2">
                            <label className="text-xs text-zinc-600 dark:text-zinc-400 flex items-center gap-1">
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
                            onClick={() => void handleExtract(download.gameId)}
                            disabled={download.extractionStatus === "extracting"}
                          >
                            {download.extractionStatus === "extracting"
                              ? "Extracting..."
                              : download.extractionStatus === "completed"
                                ? "Extract Again"
                                : download.extractionStatus === "error" ||
                                    download.extractionStatus === "needs-password"
                                  ? "Try Extraction Again"
                                  : "Start Extraction"}
                          </Button>
                        </div>

                        {download.extractionStatus === "extracting" && (
                          <div className="mt-3 space-y-2">
                            <div className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400">
                              <span>Extraction Progress</span>
                              <span>
                                {download.extractionProgress !== null &&
                                download.extractionProgress !== undefined
                                  ? `${download.extractionProgress.toFixed(1)}%`
                                  : "In progress"}
                              </span>
                            </div>
                            <div className="relative w-full h-2 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                              <div
                                className="absolute left-0 top-0 h-full bg-indigo-500 transition-all duration-300"
                                style={{ width: `${download.extractionProgress ?? 0}%` }}
                              />
                            </div>
                            {download.extractionCurrentFile && (
                              <p
                                className="text-xs text-zinc-500 dark:text-zinc-400 truncate"
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
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty State */}
      {downloadArray.length === 0 && (
        <div className="text-center py-12">
          <ArrowDownTrayIcon className="mx-auto h-12 w-12 text-zinc-400" />
          <h3 className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
            No downloads
          </h3>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Start downloading games from your library
          </p>
        </div>
      )}
    </div>
  );
}
