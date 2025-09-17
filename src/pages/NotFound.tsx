import { Button } from "@tw/button";
import { useEffect, useRef, useState } from "react";
import useDarkMode from "use-dark-mode";
import ThemeSwitch from "../components/ThemeSwitch";
export default function NotFound() {
  const darkMode = useDarkMode(false, {
    classNameDark: "dark",
    classNameLight: "light",
    element:
      typeof document !== "undefined" ? document.documentElement : undefined,
  });

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
    const onEnded = () => setIsPlaying(false);
    a.addEventListener("ended", onEnded);
    return () => a.removeEventListener("ended", onEnded);
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
      <div className="relative z-10 flex flex-col items-center text-center">
        <img
          src="/crackpipe.png"
          alt="Dead End Roadsign"
          className={`mb-4 h-40 cursor-pointer ${
            isPlaying ? "animate-[spin_7s_linear_infinite]" : ""
          }`}
          onClick={togglePlayPause}
        />
        <audio ref={audioRef} src="/wellerman.m4a" preload="none" />
        <h1 className="text-xl">404 - Page Not Found</h1>
        <h2 className="text-4xl mb-4 font-bold">
          „Arr... ye've taken a wrong turn at the seven seas!“{" "}
        </h2>
        <Button href="/">Sail Back Home</Button>
        <ThemeSwitch className="mt-4" />
      </div>
    </div>
  );
}
