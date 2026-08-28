import { useEffect, useRef, useState } from "react";
import {
  AUDIO_VOLUME_EVENT,
  getAudioVolume,
  getSoundUrl,
  type SoundName,
} from "@/utils/audio";

type UseSoundResult = {
  isPlaying: boolean;
  play: () => Promise<void>;
  pause: () => void;
  toggle: () => void;
};

/**
 * React hook for the central audio system.
 *
 * Use this instead of creating `<audio>` elements, `new Audio(...)` or
 * per-component fetch/blob logic anywhere in the app — the hook resolves the
 * playable URL (with the Linux/WebKitGTK `tauri://` blob workaround) through
 * the shared cache, keeps the element volume in sync with the global
 * GameVault volume setting, and is safe to toggle immediately after mount.
 *
 * ```tsx
 * const { isPlaying, toggle } = useSound("wellerman");
 * ```
 */
export function useSound(name: SoundName): UseSoundResult {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlPromiseRef = useRef<Promise<string>>(Promise.resolve(""));

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    let cancelled = false;

    const urlPromise = getSoundUrl(name);
    urlPromiseRef.current = urlPromise;
    urlPromise.then((url) => {
      if (!cancelled) audio.src = url;
    });

    audio.volume = getAudioVolume();
    const onVolumeChange = () => {
      audio.volume = getAudioVolume();
    };
    const onEnded = () => setIsPlaying(false);
    window.addEventListener(AUDIO_VOLUME_EVENT, onVolumeChange);
    audio.addEventListener("ended", onEnded);

    return () => {
      cancelled = true;
      audio.pause();
      window.removeEventListener(AUDIO_VOLUME_EVENT, onVolumeChange);
      audio.removeEventListener("ended", onEnded);
    };
  }, [name]);

  const play = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.src) {
      try {
        audio.src = await urlPromiseRef.current;
      } catch {
        return;
      }
    }
    audio.volume = getAudioVolume();
    try {
      await audio.play();
      setIsPlaying(true);
    } catch {
      // Autoplay blocked or the sound failed to load.
      setIsPlaying(false);
    }
  };

  const pause = () => {
    audioRef.current?.pause();
    setIsPlaying(false);
  };

  const toggle = () => {
    if (isPlaying) {
      pause();
    } else {
      void play();
    }
  };

  return { isPlaying, play, pause, toggle };
}
