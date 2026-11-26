import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { rememberServerUuid } from "@/utils/serverIdentity";

export interface ServerInfo {
  status: string;
  version: string;
  server_uuid?: string;
  registration_enabled: boolean;
  required_registration_fields: string[];
  available_authentication_methods: string[];
}

interface UseServerStatusResult {
  info: ServerInfo | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useServerStatus(): UseServerStatusResult {
  const { serverUrl } = useAuth();
  const [infoState, setInfoState] = useState<{
    url: string;
    info: ServerInfo;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!serverUrl) {
      setInfoState(null);
      setError(null);
      setLoading(false);
      return;
    }
    const base = serverUrl.replace(/\/+$/, "");
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`${base}/api/status`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok)
          throw new Error(
            `Status failed (${res.status}): ${(await res.text()) || res.statusText}`,
          );
        const data = await res.json();
        rememberServerUuid(serverUrl, data?.server_uuid);
        if (!cancelled) setInfoState({ url: serverUrl, info: data });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverUrl, nonce]);

  // Never expose the previous server's status/UUID after a server switch.
  const info = infoState && infoState.url === serverUrl ? infoState.info : null;

  return { info, loading, error, refresh };
}
