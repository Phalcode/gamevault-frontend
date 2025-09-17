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
      audioRef.current.volume = 0.1;
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
    const onEnded = () => setIsPlaying(false);
    a.addEventListener("ended", onEnded);
    return () => a.removeEventListener("ended", onEnded);
  }, []);

  return (
    <div className="flex flex-col items-center">
      <img
        src="/crackpipe.png"
        alt="Dead End Roadsign"
        className={`mb-4 h-40 cursor-pointer ${
          isPlaying ? "animate-[spin_5s_linear_infinite]" : ""
        }`}
        onClick={togglePlayPause}
      />
      <audio ref={audioRef} src="/wellerman.m4a" preload="none" />
      <h1 className="text-xl">404 - Page Not Found</h1>
      <h2 className="text-4xl mb-4 font-bold">
        „Arr... ye&apos;ve taken a wrong turn at the seven seas!“
      </h2>
      <Button href="/">Sail Back Home</Button>
    </div>
  );
}
