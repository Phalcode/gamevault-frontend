import { useCallback, useEffect, useState } from "react";
import { isTauriApp } from "@/utils/tauri";

export interface DiskUsageData {
  total: number;
  free: number;
  currentGameSize: number;
  otherGamesSize: number;
  unmanagedData: number;
}

/**
 * Fetches the disk-usage breakdown for a download location (root path),
 * powered by the `get_disk_usage` Tauri command. When `currentVersionDir` is
 * provided, the size of that specific game version is reported separately so
 * it can be highlighted in the "This Game" slice of the donut chart.
 */
export function useDiskUsage(
  rootPath: string | null | undefined,
  currentVersionDir: string | null | undefined,
): {
  data: DiskUsageData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [data, setData] = useState<DiskUsageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDiskUsage = useCallback(async () => {
    if (!isTauriApp() || !rootPath) {
      setData(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<any>("get_disk_usage", {
        selectedRoot: rootPath,
        currentVersionDir: currentVersionDir || null,
      });
      setData({
        total: Number(result.total || 0),
        free: Number(result.free || 0),
        currentGameSize: Number(result.currentGameSize || 0),
        otherGamesSize: Number(result.otherGamesSize || 0),
        unmanagedData: Number(result.unmanagedData || 0),
      });
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [rootPath, currentVersionDir]);

  useEffect(() => {
    fetchDiskUsage();
  }, [fetchDiskUsage]);

  return { data, loading, error, refetch: fetchDiskUsage };
}
