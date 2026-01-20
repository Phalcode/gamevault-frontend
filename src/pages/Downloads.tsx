import { useDownloads } from "@/context/DownloadContext";
import { Button } from "@/components/tailwind/button";
import { Heading } from "@tw/heading";
import { Divider } from "@tw/divider";
import { Badge } from "@/components/tailwind/badge";
import {
  ArrowDownTrayIcon,
  XMarkIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";

export default function Downloads() {
  const {
    downloads,
    cancelDownload,
    formatBytes,
    formatSpeed,
  } = useDownloads();

  const downloadArray = Object.values(downloads);
  const activeDownloads = downloadArray.filter(
    (d) => d.status === "downloading"
  );
  const completedDownloads = downloadArray.filter(
    (d) => d.status === "completed"
  );
  const failedDownloads = downloadArray.filter(
    (d) => d.status === "error" || d.status === "aborted"
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <Heading>Downloads</Heading>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Manage your game downloads for the GameVault desktop application
        </p>
      </div>

      <Divider className="my-6" />

      {/* Active Downloads */}
      {activeDownloads.length > 0 && (
        <>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <ArrowDownTrayIcon className="h-5 w-5" />
              Active Downloads ({activeDownloads.length})
            </h2>
          </div>
          <div className="space-y-3 mb-8">
            {activeDownloads.map((download) => (
              <div
                key={download.gameId}
                className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm text-zinc-900 dark:text-zinc-100 truncate">
                      {download.filename}
                    </h3>
                    <div className="flex items-center gap-2 mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                      <span>
                        {formatBytes(download.received)} /{" "}
                        {download.total ? formatBytes(download.total) : "Unknown"}
                      </span>
                      {download.speedBps !== undefined && (
                        <>
                          <span>•</span>
                          <span>{formatSpeed(download.speedBps)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <Button
                    color="red"
                    onClick={() => cancelDownload(download.gameId)}
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </Button>
                </div>
                <div className="relative w-full h-2 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="absolute left-0 top-0 h-full bg-blue-500 transition-all duration-300"
                    style={{
                      width: `${download.progress ?? 0}%`,
                    }}
                  />
                </div>
                <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 text-right">
                  {download.progress?.toFixed(1)}%
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Completed Downloads */}
      {completedDownloads.length > 0 && (
        <>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <CheckCircleIcon className="h-5 w-5 text-green-600" />
              Completed ({completedDownloads.length})
            </h2>
          </div>
          <div className="space-y-2 mb-8">
            {completedDownloads.map((download) => (
              <div
                key={download.gameId}
                className="p-3 rounded-lg border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/30"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm text-zinc-900 dark:text-zinc-100 truncate">
                      {download.filename}
                    </h3>
                    <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                      {download.total ? formatBytes(download.total) : "Unknown size"}
                    </div>
                  </div>
                  <Badge color="green">Completed</Badge>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Failed Downloads */}
      {failedDownloads.length > 0 && (
        <>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <ExclamationTriangleIcon className="h-5 w-5 text-red-600" />
              Failed ({failedDownloads.length})
            </h2>
          </div>
          <div className="space-y-2 mb-8">
            {failedDownloads.map((download) => (
              <div
                key={download.gameId}
                className="p-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm text-zinc-900 dark:text-zinc-100 truncate">
                      {download.filename}
                    </h3>
                    {download.error && (
                      <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                        {download.error}
                      </div>
                    )}
                  </div>
                  <Badge color="red">
                    {download.status === "aborted" ? "Cancelled" : "Failed"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </>
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
