import { useCallback, useEffect, useRef } from "react";
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
  /** Unix seconds of the last write; 0 for files from older builds. */
  updatedAt: number;
}

/** Payload of the native `tracker-auth-expired` event. */
interface TrackerAuthExpiredPayload {
  at: number;
  authRejectedCount: number;
  pendingOfflineMinutes: number;
  retryInSecs: number;
}

/** Only the part of the native tracker status this hook needs. */
interface TrackerStatusSummary {
  pendingOfflineMinutes: number;
}

const AUTH_EXPIRED_EVENT = "tracker-auth-expired";

/**
 * How often the hook refreshes the session and hands it to the native tracker.
 *
 * Must stay well below the server's access-token lifetime (a few minutes),
 * otherwise the tracker always runs one tick on a token that just expired.
 */
const KEEP_ALIVE_MS = 60 * 1000;
/** How often pending offline playtime is retried in the background. */
const PENDING_RETRY_MS = 5 * 60 * 1000;

/**
 * Mirrors a frontend lifecycle line to the console.
 *
 * The native tracker log is disabled (`tracker_log::ENABLED` in
 * `src-tauri/src/tracker_log.rs`), so nothing is sent over IPC. Re-add the
 * `tracker_log_line` invoke here when the native log is switched back on.
 */
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
  let oldestFileMinutes = 0;

  for (const root of rootPaths) {
    const offlineFiles =
      (await invokeTracker<OfflineTimeFile[]>("get_offline_time_files", {
        selectedRoot: root.path,
      })) ?? [];

    for (const file of offlineFiles) {
      files += 1;

      if (file.updatedAt) {
        const ageMinutes = Math.max(
          0,
          Math.round(Date.now() / 1000 - file.updatedAt) / 60,
        );
        oldestFileMinutes = Math.max(oldestFileMinutes, Math.round(ageMinutes));
      }

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
        reason: options.reason,
      });

      if (success) {
        creditedMinutes += file.accumulatedMinutes;
        await invokeTracker("delete_offline_time_file", { path: file.path });
      } else {
        pendingMinutes += file.accumulatedMinutes;
      }
    }
  }

  const age = oldestFileMinutes > 0 ? `, oldest file ${oldestFileMinutes} min old` : "";
  await logTrackerLine(
    pendingMinutes > 0 ? "warn" : "info",
    "offline",
    `${options.reason}: ${files} offline file(s), credited ${creditedMinutes} min, ${pendingMinutes} min kept for the next attempt${age}`,
  );
}

export function useGameTimeTracker() {
  const { serverUrl, user, auth, getAccessToken } = useAuth();
  const { onReconnect } = useOnlineStatus();
  const startedRef = useRef<{ serverUrl: string; userId: number } | null>(null);
  const syncInFlightRef = useRef(false);
  const initialSyncDoneRef = useRef(false);
  /** Token last handed to the native tracker (avoids duplicate pushes). */
  const pushedTokenRef = useRef<string | null>(null);

  /**
   * Hands a (possibly refreshed) token to the native tracker — but only when it
   * actually changed, so the log does not fill up with duplicate auth lines.
   */
  const pushToken = useCallback((token: string) => {
    if (pushedTokenRef.current === token) return;
    pushedTokenRef.current = token;
    void invokeTracker("update_tracker_auth", { accessToken: token });
  }, []);

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
    pushedTokenRef.current = accessToken;
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
    pushToken(accessToken);
  }, [auth?.access_token, pushToken]);

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

  // The native tracker tells us when the server rejects its session. Without
  // this, the tracker kept using an expired token for as long as the UI made
  // no authenticated request (an hour of playtime ended up offline).
  useEffect(() => {
    if (!isTauriApp()) return;

    let unlisten: (() => void) | undefined;
    let disposed = false;

    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const stop = await listen<TrackerAuthExpiredPayload>(
          AUTH_EXPIRED_EVENT,
          async (event) => {
            const { authRejectedCount, pendingOfflineMinutes, retryInSecs } =
              event.payload;
            await logTrackerLine(
              "warn",
              "auth",
              `server rejected the session (${authRejectedCount} rejection(s), ${pendingOfflineMinutes} min stored offline, next retry in ${retryInSecs}s) — requesting a fresh session`,
            );

            // Refreshes the token when it is near expiry (single-flight).
            const token = await getAccessToken();
            if (!token) {
              await logTrackerLine(
                "error",
                "auth",
                "no fresh session available — playtime keeps being stored offline",
              );
              return;
            }

            pushToken(token);

            if (syncInFlightRef.current) return;
            syncInFlightRef.current = true;
            try {
              await reconcileOfflineTime({
                serverUrl,
                accessToken: token,
                reason: "auth-refresh",
              });
            } finally {
              syncInFlightRef.current = false;
            }
          },
        );

        if (disposed) {
          stop();
        } else {
          unlisten = stop;
        }
      } catch (error) {
        await logTrackerLine(
          "error",
          "auth",
          `could not subscribe to ${AUTH_EXPIRED_EVENT}: ${String(error)}`,
        );
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [getAccessToken, pushToken, serverUrl]);

  // Keep the native tracker's session copy fresh. Token refresh is otherwise
  // lazy (nothing asks for a new token while the UI sits idle), and a token
  // that is only refreshed at its expiry moment is always rejected once before
  // it lands — so this refreshes well ahead of the deadline.
  useEffect(() => {
    if (!isTauriApp()) return;

    const id = window.setInterval(() => {
      if (!startedRef.current) return;
      void getAccessToken().then((token) => {
        if (token) {
          pushToken(token);
        }
      });
    }, KEEP_ALIVE_MS);

    return () => window.clearInterval(id);
  }, [getAccessToken, pushToken]);

  // Retry playtime that is waiting offline, without needing an app restart.
  useEffect(() => {
    if (!isTauriApp()) return;

    const id = window.setInterval(async () => {
      if (syncInFlightRef.current) return;

      const status = await invokeTracker<TrackerStatusSummary>("get_tracker_status");
      if (!status || status.pendingOfflineMinutes <= 0) return;

      const token = await getAccessToken();
      if (!token) return;
      pushToken(token);

      syncInFlightRef.current = true;
      try {
        await reconcileOfflineTime({
          serverUrl,
          accessToken: token,
          reason: "periodic-retry",
        });
      } finally {
        syncInFlightRef.current = false;
      }
    }, PENDING_RETRY_MS);

    return () => window.clearInterval(id);
  }, [getAccessToken, pushToken, serverUrl]);

  // The browser reporting "online" is the earliest signal that the server is
  // reachable again — replay immediately instead of waiting for the poller.
  useEffect(() => {
    if (!isTauriApp()) return;

    const handleOnline = async () => {
      if (syncInFlightRef.current) return;

      const token = await getAccessToken();
      if (!token) return;
      pushToken(token);

      syncInFlightRef.current = true;
      try {
        await reconcileOfflineTime({
          serverUrl,
          accessToken: token,
          reason: "browser-online",
        });
      } finally {
        syncInFlightRef.current = false;
      }
    };

    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [getAccessToken, pushToken, serverUrl]);

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
