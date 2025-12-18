import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, ArrowsPointingOutIcon } from "@heroicons/react/24/solid";

export interface ResolvedStream {
  video: string;            // Direct video stream URL (mp4/webm) OR image URL when type === image/placeholder
  poster?: string;          // Poster thumbnail URL (optional)
  originalUrl?: string;     // Original YouTube (or other) URL for reference
  type?: string;            // MIME type override for <source> or "image/placeholder" for screenshots
  title?: string;           // Optional title / caption
}

export type MediaItem = string | ResolvedStream; // raw URL (YouTube or image) or resolved object

interface MediaSliderProps {
  trailers?: MediaItem[] | null;      // YouTube or direct video links
  screenshots?: string[] | null;      // Image URLs (merged after trailers)
  className?: string;
  aspect?: string;                    // Tailwind aspect ratio class e.g. 'aspect-video'
  autoPlay?: boolean;
  loop?: boolean;
}

function isYouTube(url: string | undefined): boolean {
  if (!url) return false;
  return /^(https?:)?\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url);
}

function extractYouTubeId(url: string): string | null {
  try {
    const idMatch = url.match(/(?:v=|youtu\.be\/)"?([A-Za-z0-9_-]{11})/);
    if (idMatch && idMatch[1]) return idMatch[1];
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v && v.length === 11) return v;
    }
    if (u.hostname === "youtu.be") {
      const id = u.pathname.replace(/\//g, "");
      if (id.length === 11) return id;
    }
    return null;
  } catch {
    return null;
  }
}


export const MediaSlider: React.FC<MediaSliderProps> = ({
  trailers,
  screenshots,
  className = "",
  aspect = "aspect-video",
  autoPlay = false,
  loop = false,
}) => {

  // Merge trailers + screenshots list
  const rawList = useMemo(() => {
    const t = trailers || [];
    const s = (screenshots || []).map<ResolvedStream>((url) => ({
      video: url,
      poster: url,
      type: "image/placeholder",
      originalUrl: url,
    }));
    return [...t, ...s];
  }, [trailers, screenshots]);

  // Normalize list items into unified objects
  const resolved: ResolvedStream[] = useMemo(() => {
    const out: ResolvedStream[] = [];
    for (const item of rawList) {
      if (typeof item === "string") {
        out.push({ video: item, originalUrl: item, poster: isImage(item) ? item : undefined });
      } else {
        out.push(item);
      }
    }
    return out;
  }, [rawList]);

  const [index, setIndex] = useState(0);
  const list = resolved;
  const current = list[index];

  const isImageOnly = useMemo(() => current && current.type === "image/placeholder", [current]);

  const isYT = !isImageOnly && isYouTube(current?.video);
  const ytId = isYT ? extractYouTubeId(current?.video || "") : null;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const next = useCallback(() => {
    setIndex((i) => (list.length === 0 ? 0 : (i + 1) % list.length));
  }, [list.length]);
  const prev = useCallback(() => {
    setIndex((i) => (list.length === 0 ? 0 : (i - 1 + list.length) % list.length));
  }, [list.length]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      if (autoPlay && !isImageOnly && !isYT) videoRef.current.play().catch(() => {});
    }
  }, [index, autoPlay, isImageOnly, isYT]);


  if (!list.length) {
    return <div className={`relative w-full ${aspect} bg-black/40 rounded-lg flex items-center justify-center text-xs text-zinc-400 ${className}`}>No media</div>;
  }

  const requestFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const fn: any = el.requestFullscreen || (el as any).webkitRequestFullscreen || (el as any).mozRequestFullScreen || (el as any).msRequestFullscreen;
    try { fn && fn.call(el); } catch {}
  }, []);

  const exitFullscreen = useCallback(() => {
    const doc: any = document;
    const fn = document.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen;
    try { fn && fn.call(document); } catch {}
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (isFullscreen) exitFullscreen(); else requestFullscreen();
  }, [isFullscreen, exitFullscreen, requestFullscreen]);

  useEffect(() => {
    const handler = () => {
      const fsElement = (document as any).fullscreenElement || (document as any).webkitFullscreenElement || (document as any).mozFullScreenElement || (document as any).msFullscreenElement;
      setIsFullscreen(!!fsElement && fsElement === containerRef.current);
    };
    document.addEventListener('fullscreenchange', handler);
    document.addEventListener('webkitfullscreenchange', handler as any);
    document.addEventListener('mozfullscreenchange', handler as any);
    document.addEventListener('MSFullscreenChange', handler as any);
    return () => {
      document.removeEventListener('fullscreenchange', handler);
      document.removeEventListener('webkitfullscreenchange', handler as any);
      document.removeEventListener('mozfullscreenchange', handler as any);
      document.removeEventListener('MSFullscreenChange', handler as any);
    };
  }, []);

  return (
    <div ref={containerRef} className={`relative w-full ${aspect} bg-black rounded-lg overflow-hidden ${className}`}>
      {isImageOnly ? (
        <img
          src={current.poster || current.video}
          alt={current.title || "Screenshot"}
          className="absolute inset-0 w-full h-full object-contain"
          draggable={false}
        />
      ) : isYT && ytId ? (
        <iframe
          key={ytId}
          className="absolute inset-0 w-full h-full"
          src={`https://www.youtube.com/embed/${ytId}?rel=0&playsinline=1&mute=1&fs=0&enablejsapi=1${autoPlay ? "&autoplay=1" : ""}`}
          title={current.title || "Trailer"}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          // Native fullscreen intentionally disabled to use custom control
          ref={(el) => {
            if (el && autoPlay) {
              // Attempt delayed play via YouTube Iframe API postMessage (minimal subset)
              setTimeout(() => {
                try {
                  el.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*');
                } catch {}
              }, 500);
            }
          }}
        />
      ) : (
        <>
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-contain"
            controls
            playsInline
            muted={autoPlay}
            loop={loop}
            poster={current?.poster}
            autoPlay={autoPlay && !isImageOnly && !isYT}
          >
            {current?.video && <source src={current.video} type={current?.type || undefined} />}
          </video>
        </>
      )}

      {list.length > 1 && (
        <>
          <button
            type="button"
            onClick={prev}
            className="absolute top-1/2 left-2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Previous media"
          >
            <ChevronLeftIcon className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={next}
            className="absolute top-1/2 right-2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Next media"
          >
            <ChevronRightIcon className="w-5 h-5" />
          </button>
        </>
      )}

      <div className={
        `absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2 flex items-center justify-between text-[11px] text-white` +
        (isYT ? ' pointer-events-none' : '')
      }>
        <div className={isYT ? 'pointer-events-none' : ''}>
          Media {index + 1} / {list.length}
        </div>
        <div className="flex items-center gap-2">
          {isYT && !ytId && <span className="text-rose-300 pointer-events-none">Unrecognized YouTube URL</span>}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="p-1.5 rounded-md bg-white/10 hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-indigo-500 pointer-events-auto"
            aria-label="Toggle fullscreen"
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            aria-pressed={isFullscreen}
          >
            <ArrowsPointingOutIcon className={`w-4 h-4 transition-transform ${isFullscreen ? 'scale-90 rotate-180' : ''}`} />
          </button>
        </div>
      </div>
    </div>
  );
};

function isImage(url: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i.test(url);
}

export default MediaSlider;
