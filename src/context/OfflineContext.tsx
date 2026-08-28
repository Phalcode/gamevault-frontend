import {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { isTauriApp } from "@/utils/tauri";

// ── Types ────────────────────────────────────────────────────────────────────

interface OfflineContextValue {
  /** Whether the server is currently reachable */
  isOnline: boolean;
  /** Whether a status check is in-flight */
  isChecking: boolean;
  /** Timestamp (ms) of last successful status check */
  lastOnlineAt: number | null;
  /** Force an immediate status check */
  checkNow: () => void;
  /** Registered callbacks invoked when transitioning offline → online */
  onReconnect: (cb: () => void) => () => void;
  /** Dev-only: simulate a network outage (forces offline state on/off) */
  forceOffline: boolean;
  setForceOffline: (enabled: boolean) => void;
}

const OfflineCtx = createContext<OfflineContextValue>({
  isOnline: true,
  isChecking: false,
  lastOnlineAt: null,
  checkNow: () => {},
  onReconnect: () => () => {},
  forceOffline: false,
  setForceOffline: () => {},
});

// ── Provider ─────────────────────────────────────────────────────────────────

export function OfflineProvider({ children }: { children: ReactNode }) {
  const isTauri = isTauriApp();
  const [isOnline, setIsOnline] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [lastOnlineAt, setLastOnlineAt] = useState<number | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [forceOffline, setForceOfflineState] = useState<boolean>(() => {
    try {
      return localStorage.getItem("gv_force_offline") === "1";
    } catch {
      return false;
    }
  });

  const setForceOffline = useCallback((enabled: boolean) => {
    try {
      if (enabled) {
        localStorage.setItem("gv_force_offline", "1");
      } else {
        localStorage.removeItem("gv_force_offline");
      }
    } catch {
      // localStorage unavailable
    }
    setForceOfflineState(enabled);
    // When restoring connectivity in web mode there is no poller to
    // re-check, so optimistically assume we are back online.
    if (!enabled && !isTauriApp()) {
      setIsOnline(true);
    }
  }, []);

  const reconnectCallbacksRef = useRef<Set<() => void>>(new Set());
  const wasOfflineRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isOnlineRef = useRef(true);

  // Keep ref in sync with state so polling closure always sees latest
  isOnlineRef.current = isOnline;

  // Force offline state while the outage simulation is active
  useEffect(() => {
    if (forceOffline) {
      setIsOnline(false);
    }
  }, [forceOffline]);

  // Read server URL from localStorage (same key as AuthContext)
  useEffect(() => {
    if (!isTauri) return;
    const stored = localStorage.getItem("app_server_url");
    if (stored) setServerUrl(stored);
  }, [isTauri]);

  // Background poller
  useEffect(() => {
    if (!isTauri || !serverUrl) return;

    const checkStatus = async () => {
      setIsChecking(true);
      if (forceOffline) {
        setIsOnline(false);
        setIsChecking(false);
        return;
      }
      try {
        const res = await fetch(`${serverUrl}/api/status`, {
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) {
          // Server reachable but unhealthy — still "online"
        }
        if (!isOnlineRef.current) {
          // Transition: offline → online
          console.log(
            "[offline] transition: OFFLINE → ONLINE, firing reconnect callbacks",
          );
          wasOfflineRef.current = true;
        }
        setIsOnline(true);
        setLastOnlineAt(Date.now());
      } catch {
        // Network error — server unreachable
        if (isOnlineRef.current) {
          console.log("[offline] transition: ONLINE → OFFLINE");
        }
        setIsOnline(false);
      } finally {
        setIsChecking(false);
      }
    };

    // Initial check
    checkStatus();

    // Poll every 15 seconds
    intervalRef.current = setInterval(checkStatus, 15_000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isTauri, serverUrl, forceOffline]);

  // Fire reconnect callbacks when transitioning offline → online
  useEffect(() => {
    if (isOnline && wasOfflineRef.current) {
      console.log(
        "[offline] reconnect effect firing, callbacks:",
        reconnectCallbacksRef.current.size,
      );
      wasOfflineRef.current = false;
      reconnectCallbacksRef.current.forEach((cb) => {
        try {
          cb();
        } catch {
          // ignore callback errors
        }
      });
    }
  }, [isOnline]);

  const checkNow = useCallback(() => {
    if (!serverUrl || forceOffline) return;
    setIsChecking(true);
    fetch(`${serverUrl}/api/status`, {
      signal: AbortSignal.timeout(8000),
    })
      .then(() => {
        setIsOnline(true);
        setLastOnlineAt(Date.now());
      })
      .catch(() => {
        setIsOnline(false);
      })
      .finally(() => setIsChecking(false));
  }, [serverUrl, forceOffline]);

  const onReconnect = useCallback((cb: () => void) => {
    reconnectCallbacksRef.current.add(cb);
    return () => {
      reconnectCallbacksRef.current.delete(cb);
    };
  }, []);

  return (
    <OfflineCtx.Provider
      value={{
        isOnline,
        isChecking,
        lastOnlineAt,
        checkNow,
        onReconnect,
        forceOffline,
        setForceOffline,
      }}
    >
      {children}
    </OfflineCtx.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useOnlineStatus() {
  return useContext(OfflineCtx);
}
