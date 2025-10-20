import { useAuth } from "@/context/AuthContext";
import React, { useEffect, useRef, useState } from "react";
import { Media as MediaType } from "../api";

interface Props {
  media?: MediaType;
  size?: number;
  width?: number;
  height?: number;
  className?: string;
  alt?: string;
  square?: boolean;
  fallback?: React.ReactNode;
  onClick?: React.MouseEventHandler;
}

export function Media({
  media,
  size = 40,
  width,
  height,
  className,
  alt = "",
  square = false,
  fallback,
  onClick = () => {},
}: Props) {
  const imageId = media?.id;
  const { authFetch, serverUrl } = useAuth();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revokeRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (revokeRef.current) URL.revokeObjectURL(revokeRef.current);
    },
    [],
  );

  useEffect(() => {
    if (revokeRef.current) {
      URL.revokeObjectURL(revokeRef.current);
      revokeRef.current = null;
    }
    setBlobUrl(null);
    setError(null);
    if (!imageId || !serverUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const base = serverUrl.replace(/\/+$/, "");
        const mediaUrl = `${base}/api/media/${imageId}`;
        const res = await authFetch(mediaUrl);
        if (!res.ok) throw new Error(`Media fetch failed (${res.status})`);
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        revokeRef.current = url;
        setBlobUrl(url);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load image");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [imageId, serverUrl, authFetch]);

  const dimW = (width ?? size) + "px";
  const dimH = (height ?? size) + "px";
  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: dimW,
        height: dimH,
        borderRadius: square ? 12 : "50%",
        overflow: "hidden",
        background:
          "linear-gradient(110deg,#232230 8%,#2d2c3a 18%,#232230 33%)",
      }}
      title={error || (imageId ? `Media ID: ${imageId}` : "No avatar")}
    >
      {!blobUrl && !error && (
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
      {error && (
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
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
          draggable={false}
          onClick={onClick}
        />
      )}
      {fallback && !blobUrl && !error && (
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
