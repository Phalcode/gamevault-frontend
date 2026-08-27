import { useDownloads } from "@/context/DownloadContext";
import { DownloadCard } from "@/components/downloads/DownloadCard";
import { Heading } from "@tw/heading";
import { Text } from "@tw/text";
import { Divider } from "@tw/divider";
import { ArrowDownTrayIcon } from "@heroicons/react/24/outline";
import { useMemo } from "react";

export default function Downloads() {
  const { downloads } = useDownloads();
  const downloadArray = useMemo(() => Object.values(downloads), [downloads]);

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
          {downloadArray.map((download, index) => (
            <DownloadCard key={download.gameId} download={download} index={index} />
          ))}
        </div>
      )}

      {downloadArray.length === 0 && (
        <div className="surface-panel-soft rounded-3xl px-6 py-16 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-gv-line bg-gv-panel">
            <ArrowDownTrayIcon className="size-7 text-gv-muted" aria-hidden="true" />
          </div>
          <h3 className="mt-4 text-sm font-semibold text-gv-text">
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

