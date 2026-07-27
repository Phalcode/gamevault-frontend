import { useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import { isTauriApp } from "@/utils/tauri";
import { getRootPaths } from "@/utils/rootPaths";

export function useGameTimeTracker() {
  const { serverUrl, user, auth } = useAuth();
  const { onReconnect } = useOnlineStatus();
  const startedRef = useRef(false);
  const syncInFlightRef = useRef(false);
  const initialSyncDoneRef = useRef(false);

  // Start / restart tracker when credentials become available
  useEffect(() => {
    if (!isTauriApp()) return;

    const userId = user?.id;
    const accessToken = auth?.access_token;
    const downloadPaths = getRootPaths().map((p) => p.path);

    if (!serverUrl || !userId || !accessToken || !downloadPaths.length) {
      // If tracker was running but credentials are gone (logout), stop it
      if (startedRef.current) {
        startedRef.current = false;
        import("@tauri-apps/api/core").then(({ invoke }) => {
          invoke("stop_game_time_tracker").catch(() => {});
        });
      }
      return;
    }

    // Start the tracker
    startedRef.current = true;
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke("start_game_time_tracker", {
        serverUrl,
        userId,
        accessToken,
        downloadPath: null,
        downloadPaths,
      }).catch(() => {});
    });

    return () => {
      // Cleanup on unmount
      startedRef.current = false;
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke("stop_game_time_tracker").catch(() => {});
      });
    };
  }, [serverUrl, user?.id]); // Intentionally NOT including accessToken — handled below

  // Update auth token separately to avoid restarting the whole tracker on refresh
  useEffect(() => {
    if (!isTauriApp() || !startedRef.current) return;
    const accessToken = auth?.access_token;
    if (!accessToken) return;

    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke("update_tracker_auth", { accessToken }).catch(() => {});
    });
  }, [auth?.access_token]);

  // Sync any lingering offline time on startup (handles case where user
  // went offline, closed the app, then restarted while online)
  useEffect(() => {
    if (!isTauriApp()) return;
    if (!serverUrl || !auth?.access_token) return;
    if (initialSyncDoneRef.current) return;
    initialSyncDoneRef.current = true;

    (async () => {
      try {
        const rootPaths = getRootPaths();
        if (!rootPaths.length) return;

        const { invoke } = await import("@tauri-apps/api/core");

        for (const root of rootPaths) {
          const files = await invoke<any[]>("get_offline_time_files", {
            selectedRoot: root.path,
          }).catch(() => [] as any[]);

          for (const file of files) {
            if (!file.accumulatedMinutes || file.accumulatedMinutes <= 0) {
              await invoke("delete_offline_time_file", { path: file.path }).catch(() => {});
              continue;
            }

            try {
              const success = await invoke<boolean>("sync_offline_time", {
                serverUrl,
                accessToken: auth.access_token,
                userId: file.userId,
                gameId: file.gameId,
                minutes: file.accumulatedMinutes,
              });

              if (success) {
                await invoke("delete_offline_time_file", { path: file.path }).catch(() => {});
              }
            } catch {
              // Retry on next reconnect
            }
          }
        }
      } catch {
        // Silently fail
      }
    })();
  }, [serverUrl, auth?.access_token]);

  // Sync offline time when coming back online
  useEffect(() => {
    if (!isTauriApp()) return;

    const unregister = onReconnect(async () => {
      if (syncInFlightRef.current) return;
      syncInFlightRef.current = true;

      try {
        const rootPaths = getRootPaths();
        if (!rootPaths.length) return;

        const { invoke } = await import("@tauri-apps/api/core");

        for (const root of rootPaths) {
          const files = await invoke<any[]>("get_offline_time_files", {
            selectedRoot: root.path,
          }).catch(() => [] as any[]);

          for (const file of files) {
            if (!file.accumulatedMinutes || file.accumulatedMinutes <= 0) {
              // Delete empty files
              await invoke("delete_offline_time_file", { path: file.path }).catch(() => {});
              continue;
            }

            try {
              const success = await invoke<boolean>("sync_offline_time", {
                serverUrl,
                accessToken: auth?.access_token || "",
                userId: file.userId,
                gameId: file.gameId,
                minutes: file.accumulatedMinutes,
              });

              if (success) {
                await invoke("delete_offline_time_file", { path: file.path }).catch(() => {});
              }
            } catch {
              // Retry on next reconnect
            }
          }
        }
      } catch {
        // Silently fail — retry on next reconnect
      } finally {
        syncInFlightRef.current = false;
      }
    });

    return unregister;
  }, [onReconnect, serverUrl, auth?.access_token]);
}
