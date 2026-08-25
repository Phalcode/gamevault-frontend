import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import {
  GameMediaOwner,
  invalidateMedia,
  resolveApiMediaBlob,
} from "@/utils/mediaCache";
import { useCallback, useEffect, useRef, useState } from "react";

export function useAuthMediaUrl(
  mediaId?: number | string | null,
  owner?: GameMediaOwner,
) {
  const { authFetch, serverUrl } = useAuth();
  const { isOnline } = useOnlineStatus();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshRequest, setRefreshRequest] = useState<{
    mediaId: number;
    nonce: number;
  } | null>(null);
  // Track the object URL currently handed to the <img> and any URL that was
  // replaced but must stay alive until the browser has switched src. Revoking a
  // URL while the <img> still references it is what surfaces as
  // "blob error ... failed to load the resource".
  const currentUrlRef = useRef<string | null>(null);
  const retiredUrlsRef = useRef<string[]>([]);
  const loadedMediaIdRef = useRef<number | null>(null);
  const decodeRetryMediaIdRef = useRef<number | null>(null);
  const ownerGameId = owner?.gameId;
  const ownerSlot = owner?.slot;

  // Only revoke on unmount; never synchronously while the image is in use.
  useEffect(
    () => () => {
      if (currentUrlRef.current) {
        URL.revokeObjectURL(currentUrlRef.current);
        currentUrlRef.current = null;
      }
      for (const url of retiredUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      retiredUrlsRef.current = [];
    },
    [],
  );

  // Revoke a replaced URL only after the browser has painted the new src.
  const retireUrl = useCallback((url: string) => {
    retiredUrlsRef.current.push(url);
    requestAnimationFrame(() => {
      retiredUrlsRef.current = retiredUrlsRef.current.filter((u) => u !== url);
      URL.revokeObjectURL(url);
    });
  }, []);

  useEffect(() => {
    const numericId = Number(mediaId);
    if (!numericId || !serverUrl) {
      setLoading(false);
      setUrl(null);
      setError(null);
      loadedMediaIdRef.current = null;
      return;
    }

    // Avoid tearing down an already-loaded image on unrelated dep churn (e.g.
    // the online flag or authFetch identity changing). Only reload when the
    // media changes or a refresh was explicitly requested for this media.
    if (
      loadedMediaIdRef.current === numericId &&
      refreshRequest?.mediaId !== numericId
    ) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const blob = await resolveApiMediaBlob({
          serverUrl,
          mediaId: numericId,
          authFetch,
          owner:
            ownerGameId && ownerSlot
              ? { gameId: ownerGameId, slot: ownerSlot }
              : undefined,
          forceRefresh: refreshRequest?.mediaId === numericId,
          allowTauriFallback: !isOnline,
        });
        if (cancelled) return;

        const objectUrl = URL.createObjectURL(blob);
        const previous = currentUrlRef.current;
        currentUrlRef.current = objectUrl;
        loadedMediaIdRef.current = numericId;
        setUrl(objectUrl);

        if (previous && previous !== objectUrl) {
          retireUrl(previous);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setUrl(null);
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Failed to load image",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    mediaId,
    serverUrl,
    authFetch,
    ownerGameId,
    ownerSlot,
    refreshRequest,
    isOnline,
    retireUrl,
  ]);

  useEffect(() => {
    decodeRetryMediaIdRef.current = null;
  }, [mediaId]);

  const retryAfterDecodeError = useCallback(() => {
    const numericId = Number(mediaId);
    if (!numericId || !serverUrl) {
      setError("Failed to decode image");
      return;
    }

    if (decodeRetryMediaIdRef.current === numericId) {
      setError("Failed to decode image");
      return;
    }

    decodeRetryMediaIdRef.current = numericId;
    setLoading(true);
    void invalidateMedia(serverUrl, numericId).finally(() => {
      setRefreshRequest({ mediaId: numericId, nonce: Date.now() });
    });
  }, [mediaId, serverUrl]);

  return { url, error, loading, retryAfterDecodeError };
}
