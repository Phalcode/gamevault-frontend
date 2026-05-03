import { useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { isTauriApp } from "@/utils/tauri";

export function useGameTimeTracker() {
  const { serverUrl, user, auth } = useAuth();
  const startedRef = useRef(false);

  // Start / restart tracker when credentials become available
  useEffect(() => {
    if (!isTauriApp()) return;

    const userId = user?.id;
    const accessToken = auth?.access_token;
    const downloadPath = localStorage.getItem("tauri_download_path");

    if (!serverUrl || !userId || !accessToken || !downloadPath) {
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
        downloadPath,
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
}
