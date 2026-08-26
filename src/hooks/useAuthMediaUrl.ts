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
  enabled = true,
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
  // Keep the latest online/auth refs so the fetch effect doesn't restart on
  // connectivity or token churn (which caused flicker/reloops).
  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;
  const authFetchRef = useRef(authFetch);
  authFetchRef.current = authFetch;

  // Track the object URL currently handed to the <img> and any URLs that were
  // replaced but must stay alive until the browser has finished with them.
  // Revoking a URL while the <img> still references it is what surfaces as
  // "blob error ... failed to load the resource".
  const currentUrlRef = useRef<string | null>(null);
  const revokeTimersRef = useRef<Map<string, number>>(new Map());
  const loadedMediaIdRef = useRef<number | null>(null);
  const decodeRetryMediaIdRef = useRef<number | null>(null);
  const ownerGameId = owner?.gameId;
  const ownerSlot = owner?.slot;

  // Revoke everything on unmount (the <img> is gone by then, so it's safe).
  useEffect(
    () => () => {
      for (const [url, timer] of revokeTimersRef.current) {
        window.clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      revokeTimersRef.current.clear();
      if (currentUrlRef.current) {
        URL.revokeObjectURL(currentUrlRef.current);
        currentUrlRef.current = null;
      }
    },
    [],
  );

  // Revoke a replaced URL only after a safe delay (so a lazily-decoding <img>
  // has already switched to the new src), never synchronously.
  const scheduleRevoke = useCallback((url: string, delayMs = 10_000) => {
    const existing = revokeTimersRef.current.get(url);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      revokeTimersRef.current.delete(url);
      URL.revokeObjectURL(url);
    }, delayMs);
    revokeTimersRef.current.set(url, timer);
  }, []);

  useEffect(() => {
    // Defer the actual fetch until the element is near the viewport. This
    // prevents a long/infinite list from issuing a burst of blob requests for
    // images the user hasn't scrolled to yet. Once `enabled` flips true it
    // stays true, so re-enabling always fetches fresh for the current media.
    if (!enabled) {
      loadedMediaIdRef.current = null;
      setLoading(false);
      return;
    }

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
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const blob = await resolveApiMediaBlob({
          serverUrl,
          mediaId: numericId,
          authFetch: authFetchRef.current,
          owner:
            ownerGameId && ownerSlot
              ? { gameId: ownerGameId, slot: ownerSlot }
              : undefined,
          forceRefresh: refreshRequest?.mediaId === numericId,
          allowTauriFallback: !isOnlineRef.current,
          signal: controller.signal,
        });
        if (cancelled) return;

        const objectUrl = URL.createObjectURL(blob);
        const previous = currentUrlRef.current;
        currentUrlRef.current = objectUrl;
        loadedMediaIdRef.current = numericId;
        setUrl(objectUrl);

        if (previous && previous !== objectUrl) {
          scheduleRevoke(previous);
        }
      } catch (caughtError) {
        // An aborted fetch is expected when the component unmounts or the
        // media changes; don't surface it as an error or unhandled rejection.
        if ((caughtError as { name?: string } | null)?.name === "AbortError") {
          return;
        }
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
      controller.abort();
    };
  }, [
    mediaId,
    serverUrl,
    ownerGameId,
    ownerSlot,
    refreshRequest,
    scheduleRevoke,
    enabled,
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
