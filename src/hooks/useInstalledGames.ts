import { useCallback, useEffect, useState } from "react";
import { isTauriApp } from "@/utils/tauri";

export interface InstalledGameInfo {
  gameId: number;
  gameTitle: string;
  gameMetadata: Record<string, any> | null;
  gameType: string | null;
  versionId: number;
  versionName: string;
  installationDirectory: string;
  versionDirectory: string;
}

export function useInstalledGames() {
  const [installedGames, setInstalledGames] = useState<InstalledGameInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInstalledGames = useCallback(async () => {
    if (!isTauriApp()) return;

    const selectedRoot = localStorage.getItem("tauri_download_path");
    if (!selectedRoot) {
      setInstalledGames([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const results = await invoke<InstalledGameInfo[]>("list_installed_games", {
        selectedRoot,
      });
      setInstalledGames(results);
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setInstalledGames([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInstalledGames();
  }, [fetchInstalledGames]);

  return { installedGames, loading, error, refetch: fetchInstalledGames };
}
