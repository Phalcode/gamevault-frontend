import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import { isTauriApp } from "@/utils/tauri";

interface IgnoreListContextValue {
  ignoreList: string[];
  initialized: boolean;
  loading: boolean;
  error: string | null;
  setIgnoreList: (names: string[]) => Promise<void>;
  refresh: () => Promise<void>;
}

const IgnoreListContext = createContext<IgnoreListContextValue | null>(null);

interface IgnoreListState {
  ignored: string[];
  initialized: boolean;
}

export function IgnoreListProvider({ children }: { children: ReactNode }) {
  const { serverUrl, authFetch, auth } = useAuth();
  const { isOnline } = useOnlineStatus();
  const [ignoreList, setIgnoreListState] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!isTauriApp()) return;

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const state = await invoke<IgnoreListState>("get_ignore_list");
      setIgnoreListState(state.ignored ?? []);
      setInitialized(!!state.initialized);

      if (state.initialized || !isOnline || !serverUrl || !auth?.access_token) {
        return;
      }

      if (fetchingRef.current) return;
      fetchingRef.current = true;
      setLoading(true);
      setError(null);

      try {
        const res = await authFetch(`${serverUrl}/api/progresses/ignorefile`);
        if (!res.ok) {
          throw new Error(`Failed to load ignore list (${res.status})`);
        }
        const data = await res.json();
        const names: string[] = Array.isArray(data)
          ? data.filter((n): n is string => typeof n === "string")
          : [];
        await invoke("set_ignore_list", { ignored: names });
        setIgnoreListState(names);
        setInitialized(true);
      } finally {
        fetchingRef.current = false;
        setLoading(false);
      }
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  }, [serverUrl, authFetch, auth?.access_token, isOnline]);

  // Load persisted list once on mount (Tauri only) and re-run when
  // connection state changes so the first online session seeds the list.
  useEffect(() => {
    if (!isTauriApp()) return;
    refresh();
  }, [refresh]);

  const setIgnoreList = useCallback(async (names: string[]) => {
    if (!isTauriApp()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_ignore_list", { ignored: names });
    const state = await invoke<IgnoreListState>("get_ignore_list");
    setIgnoreListState(state.ignored ?? []);
    setInitialized(true);
  }, []);

  return (
    <IgnoreListContext.Provider
      value={{
        ignoreList,
        initialized,
        loading,
        error,
        setIgnoreList,
        refresh,
      }}
    >
      {children}
    </IgnoreListContext.Provider>
  );
}

export function useIgnoreList() {
  const ctx = useContext(IgnoreListContext);
  if (!ctx) {
    throw new Error("useIgnoreList must be used within IgnoreListProvider");
  }
  return ctx;
}
