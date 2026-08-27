import { Button } from "@tw/button";
import { useEffect, useRef, useState } from "react";
export default function NotFound() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const togglePlayPause = async () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.volume = 0.05;
      try {
        await audioRef.current.play();
        setIsPlaying(true);
      } catch {
        // autoplay blocked or other error
      }
    }
  };
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    // WebKitGTK (Linux packaged build) blocks media loaded from the
    // `tauri://` custom scheme with "the resource was requested insecurely"
    // even though the request returns 200 (tauri-apps/tauri#12767). Loading
    // the asset as a blob URL avoids the custom scheme entirely.
    fetch("/wellerman.m4a")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        a.src = objectUrl;
      })
      .catch(() => {
        // Fetch failed — keep the original direct URL as a fallback.
      });
    const onEnded = () => setIsPlaying(false);
    a.addEventListener("ended", onEnded);
    return () => {
      cancelled = true;
      a.removeEventListener("ended", onEnded);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);
  return (
    <div className="flex flex-col items-center justify-center h-dvh w-dvw">
      <img
        src="/ships.png"
        alt="Ships Background"
        className={`absolute inset-0 w-full h-full object-cover ${
          isPlaying
            ? "opacity-100 transition-opacity duration-10000"
            : "opacity-0"
        }`}
      />
      <div className="relative z-10 flex flex-col items-center text-center px-4">
        <img
          src="/crackpipe.png"
          alt="Dead End Roadsign"
          width={160}
          height={160}
          className={`mb-4 h-40 cursor-pointer motion-reduce:animate-none ${
            isPlaying ? "animate-[spin_7s_linear_infinite]" : ""
          }`}
          onClick={togglePlayPause}
        />
        <audio ref={audioRef} src="/wellerman.m4a" preload="none" />
        <h1 className="text-xl">404 - Page Not Found</h1>
        <h2 className="text-2xl sm:text-4xl mb-4 font-bold text-balance">
          „Arr... ye've taken a wrong turn at the seven seas!“
        </h2>
        <Button href="/">Sail Back Home</Button>
      </div>
    </div>
  );
}
