import { useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import { isTauriApp } from "@/utils/tauri";
import { getRootPaths } from "@/utils/rootPaths";

/**
 * Game time tracker lifecycle controller.
 *
 * The actual tracking runs in the Rust backend (`src-tauri/src/time_tracker.rs`):
 * it polls every 60 seconds, matches running processes to installed games and
 * credits one minute per matched game. This hook only starts/stops that native
 * loop and replays playtime that was recorded offline.
 *
 * Every decision and every previously swallowed `invoke` failure is written to
 * the native tracker log, because the loop credits exactly one minute per tick:
 * a playtime that ends up lower than what was played is always caused by a
 * missed tick, a lost process match or a rejected request, and the log has to
 * show which one it was.
 */

interface OfflineTimeFile {
  path: string;
  userId: number;
  gameId: number;
  accumulatedMinutes: number;
}

/** Mirrors a frontend lifecycle line into the native tracker log. */
async function logTrackerLine(
  level: "info" | "warn" | "error",
  category: string,
  message: string,
): Promise<void> {
  if (level === "error") {
    console.error(`[tracker:${category}]`, message);
  } else if (level === "warn") {
    console.warn(`[tracker:${category}]`, message);
  } else {
    console.debug(`[tracker:${category}]`, message);
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("tracker_log_line", { level, category, message });
  } catch {
    // Diagnostics must never break the tracker itself.
  }
}

/**
 * Invokes a tracker command and records failures.
 *
 * These calls used to be `.catch(() => {})`, which hid a tracker that never
 * started or never stopped.
 */
async function invokeTracker<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(command, args);
  } catch (error) {
    await logTrackerLine("error", "invoke", `${command} failed: ${String(error)}`);
    return null;
  }
}

/**
 * Replays every offline time file and logs what was found, credited or kept.
 *
 * `reason` ends up in the log so a failed replay can be traced back to startup
 * or a reconnect.
 */
async function reconcileOfflineTime(options: {
  serverUrl: string;
  accessToken: string;
  reason: string;
}): Promise<void> {
  const rootPaths = getRootPaths();
  if (!rootPaths.length) {
    await logTrackerLine(
      "warn",
      "offline",
      `${options.reason}: no root paths configured, skipping offline replay`,
    );
    return;
  }

  let files = 0;
  let creditedMinutes = 0;
  let pendingMinutes = 0;

  for (const root of rootPaths) {
    const offlineFiles =
      (await invokeTracker<OfflineTimeFile[]>("get_offline_time_files", {
        selectedRoot: root.path,
      })) ?? [];

    for (const file of offlineFiles) {
      files += 1;

      if (!file.accumulatedMinutes || file.accumulatedMinutes <= 0) {
        await invokeTracker("delete_offline_time_file", { path: file.path });
        continue;
      }

      const success = await invokeTracker<boolean>("sync_offline_time", {
        serverUrl: options.serverUrl,
        accessToken: options.accessToken,
        userId: file.userId,
        gameId: file.gameId,
        minutes: file.accumulatedMinutes,
      });

      if (success) {
        creditedMinutes += file.accumulatedMinutes;
        await invokeTracker("delete_offline_time_file", { path: file.path });
      } else {
        pendingMinutes += file.accumulatedMinutes;
      }
    }
  }

  await logTrackerLine(
    pendingMinutes > 0 ? "warn" : "info",
    "offline",
    `${options.reason}: ${files} offline file(s), credited ${creditedMinutes} min, ${pendingMinutes} min kept for the next attempt`,
  );
}

export function useGameTimeTracker() {
  const { serverUrl, user, auth } = useAuth();
  const { onReconnect } = useOnlineStatus();
  const startedRef = useRef<{ serverUrl: string; userId: number } | null>(null);
  const syncInFlightRef = useRef(false);
  const initialSyncDoneRef = useRef(false);

  // Start / restart tracker as soon as credentials are available. We key the
  // "started" state on server+user so a token refresh (handled by
  // update_tracker_auth) doesn't restart the 60s polling loop.
  useEffect(() => {
    if (!isTauriApp()) return;

    const userId = user?.id;
    const accessToken = auth?.access_token;
    const downloadPaths = getRootPaths().map((p) => p.path);

    if (!serverUrl || !userId || !accessToken) {
      if (startedRef.current) {
        // Logout or a genuinely missing session: stop the native loop.
        startedRef.current = null;
        void logTrackerLine(
          "info",
          "lifecycle",
          "stopping tracker: credentials are gone (logout or missing session)",
        );
        void invokeTracker("stop_game_time_tracker", {
          reason: "credentials unavailable (logout or missing session)",
        });
      } else {
        void logTrackerLine("info", "lifecycle", "tracker idle: waiting for credentials");
      }
      return;
    }

    if (!downloadPaths.length) {
      if (startedRef.current) {
        // Root paths can be momentarily empty (storage still loading). The
        // native loop re-reads the library every tick, so keep it running
        // instead of tearing down a session that is tracking a running game.
        void logTrackerLine(
          "warn",
          "lifecycle",
          "root paths are empty but the session is valid — keeping the tracker running",
        );
      } else {
        void logTrackerLine(
          "warn",
          "lifecycle",
          "tracker idle: no download root paths configured",
        );
      }
      return;
    }

    const started = startedRef.current;
    if (started && started.serverUrl === serverUrl && started.userId === userId) {
      // Same session (token may have refreshed); leave the loop running.
      return;
    }

    // New session or a changed server/user — (re)start with fresh credentials.
    if (started) {
      void logTrackerLine(
        "info",
        "lifecycle",
        `restarting tracker for a new session (server=${serverUrl}, user=${userId}, roots=${downloadPaths.length})`,
      );
    } else {
      void logTrackerLine(
        "info",
        "lifecycle",
        `starting tracker (server=${serverUrl}, user=${userId}, roots=${downloadPaths.length})`,
      );
    }

    startedRef.current = { serverUrl, userId };
    void invokeTracker("start_game_time_tracker", {
      serverUrl,
      userId,
      accessToken,
      downloadPath: null,
      downloadPaths,
    });
  }, [serverUrl, user?.id, auth?.access_token]);

  // Stop the tracker on unmount.
  useEffect(() => {
    return () => {
      if (!startedRef.current) return;
      startedRef.current = null;
      void logTrackerLine("info", "lifecycle", "stopping tracker: hook unmounted");
      void invokeTracker("stop_game_time_tracker", { reason: "hook unmounted" });
    };
  }, []);

  // Update auth token separately to avoid restarting the whole tracker on refresh
  useEffect(() => {
    if (!isTauriApp() || !startedRef.current) return;
    const accessToken = auth?.access_token;
    if (!accessToken) return;

    void invokeTracker("update_tracker_auth", { accessToken }).then((result) => {
      if (result !== null) {
        void logTrackerLine("info", "lifecycle", "auth token refreshed — tracker kept running");
      }
    });
  }, [auth?.access_token]);

  // Sync any lingering offline time on startup (handles case where user
  // went offline, closed the app, then restarted while online)
  useEffect(() => {
    if (!isTauriApp()) return;
    if (!serverUrl || !auth?.access_token) return;
    if (initialSyncDoneRef.current) return;
    initialSyncDoneRef.current = true;

    void reconcileOfflineTime({
      serverUrl,
      accessToken: auth.access_token,
      reason: "startup",
    });
  }, [serverUrl, auth?.access_token]);

  // Sync offline time when coming back online
  useEffect(() => {
    if (!isTauriApp()) return;

    const unregister = onReconnect(async () => {
      if (syncInFlightRef.current) return;
      syncInFlightRef.current = true;

      try {
        await reconcileOfflineTime({
          serverUrl,
          accessToken: auth?.access_token || "",
          reason: "reconnect",
        });
      } finally {
        syncInFlightRef.current = false;
      }
    });

    return unregister;
  }, [onReconnect, serverUrl, auth?.access_token]);

  // Record window visibility and connectivity next to the tracker ticks, so a
  // sleep/resume or an offline window lines up with the tick gaps in the log.
  useEffect(() => {
    if (!isTauriApp()) return;

    const handleVisibility = () => {
      void logTrackerLine("info", "app", `window visibility: ${document.visibilityState}`);
    };
    const handleFocus = () => {
      void logTrackerLine("info", "app", "window focused");
    };
    const handleBlur = () => {
      void logTrackerLine("info", "app", "window blurred");
    };
    const handleOnline = () => {
      void logTrackerLine("info", "app", "browser reports online");
    };
    const handleOffline = () => {
      void logTrackerLine(
        "warn",
        "app",
        "browser reports offline — playtime is stored offline until the connection returns",
      );
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);
}
