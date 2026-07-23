import { useAuth } from "@/context/AuthContext";
import { isTauriApp } from "@/utils/tauri";
import { useEffect, useRef, useState } from "react";

export function useAuthMediaUrl(mediaId?: number | string | null) {
  const { authFetch, serverUrl } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const revokeRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (revokeRef.current) {
        URL.revokeObjectURL(revokeRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (revokeRef.current) {
      URL.revokeObjectURL(revokeRef.current);
      revokeRef.current = null;
    }

    setUrl(null);

    const numericId = Number(mediaId);
    if (!numericId || !serverUrl) return;

    let cancelled = false;

    (async () => {
      try {
        const base = serverUrl.replace(/\/+$/, "");
        const res = await authFetch(`${base}/api/media/${numericId}`);
        if (!res.ok) throw new Error(`Media fetch failed (${res.status})`);
        const blob = await res.blob();
        if (cancelled) return;

        const objectUrl = URL.createObjectURL(blob);
        revokeRef.current = objectUrl;
        setUrl(objectUrl);
      } catch {
        // Offline fallback: try Tauri local cache
        if (isTauriApp() && numericId) {
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            const cachedBytes = await invoke<number[] | null>("load_cached_image", {
              mediaId: numericId,
            });
            if (cachedBytes && cachedBytes.length > 0 && !cancelled) {
              const blob = new Blob([new Uint8Array(cachedBytes)]);
              const objectUrl = URL.createObjectURL(blob);
              revokeRef.current = objectUrl;
              setUrl(objectUrl);
              return;
            }
          } catch { /* cached image not available */ }
        }
        if (!cancelled) setUrl(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mediaId, serverUrl, authFetch]);

  return url;
}