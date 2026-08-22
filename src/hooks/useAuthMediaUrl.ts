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
  const revokeRef = useRef<string | null>(null);
  const decodeRetryMediaIdRef = useRef<number | null>(null);
  const ownerGameId = owner?.gameId;
  const ownerSlot = owner?.slot;

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
    setError(null);

    const numericId = Number(mediaId);
    if (!numericId || !serverUrl) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

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
        revokeRef.current = objectUrl;
        setUrl(objectUrl);
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