import { useAuthMediaUrl } from "@/hooks/useAuthMediaUrl";
import { GameMediaSlot } from "@/utils/mediaCache";
import React, { useEffect, useState } from "react";
import { Media as MediaType } from "../api";

interface Props {
  media?: MediaType;
  size?: number;
  width?: number;
  height?: number;
  className?: string;
  alt?: string;
  square?: boolean;
  fit?: "contain" | "cover";
  fallback?: React.ReactNode;
  onClick?: React.MouseEventHandler;
  gameId?: number;
  mediaSlot?: GameMediaSlot;
}

export function Media({
  media,
  size = 40,
  width,
  height,
  className,
  alt = "",
  square = false,
  fit = "contain",
  fallback,
  onClick = () => {},
  gameId,
  mediaSlot,
}: Props) {
  const imageId = media?.id;
  const [stalled, setStalled] = useState(false);
  const {
    url: blobUrl,
    error,
    loading,
    retryAfterDecodeError,
  } = useAuthMediaUrl(
    imageId,
    gameId && mediaSlot ? { gameId, slot: mediaSlot } : undefined,
  );

  useEffect(() => {
    setStalled(false);
    if (!loading || blobUrl || error) return;
    const stallTimer = window.setTimeout(() => {
      setStalled(true);
    }, 1200);
    return () => window.clearTimeout(stallTimer);
  }, [imageId, loading, blobUrl, error]);

  const dimW = (width ?? size) + "px";
  const dimH = (height ?? size) + "px";
  const showFallback =
    Boolean(fallback) && (!imageId || !!error || (stalled && !blobUrl));

  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: dimW,
        height: dimH,
        borderRadius: square ? 0 : "50%",
        overflow: "hidden",
        background:
          "linear-gradient(110deg,#232230 8%,#2d2c3a 18%,#232230 33%)",
      }}
      title={error || (imageId ? `Media ID: ${imageId}` : "No avatar")}
    >
      {imageId && !blobUrl && !error && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            animation: "avatar-shimmer 1.2s linear infinite",
            background:
              "linear-gradient(110deg,#232230 8%,#2d2c3a 18%,#232230 33%)",
            backgroundSize: "200% 100%",
          }}
        />
      )}
      {error && !fallback && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 600,
            background: "#5b2525",
            color: "#fff",
          }}
        >
          !
        </div>
      )}
      {blobUrl && !error && (
        <img
          src={blobUrl}
          alt={alt}
          style={{ width: "100%", height: "100%", objectFit: fit }}
          draggable={false}
          onClick={onClick}
          onError={retryAfterDecodeError}
        />
      )}
      {showFallback && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
          }}
        >
          {fallback}
        </div>
      )}
    </div>
  );
}
