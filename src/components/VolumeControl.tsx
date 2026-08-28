import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
} from "@heroicons/react/24/outline";
import {
  AUDIO_VOLUME_EVENT,
  getAudioVolume,
  setAudioVolume,
} from "@/utils/audio";

/**
 * Volume slider for the central audio system: drag to set the level,
 * click the speaker icon to mute/unmute, shows the percentage.
 */
export function VolumeControl({ className }: { className?: string }) {
  const [volume, setVolume] = useState(getAudioVolume());

  useEffect(() => {
    const onVolumeChange = () => setVolume(getAudioVolume());
    window.addEventListener(AUDIO_VOLUME_EVENT, onVolumeChange);
    return () => window.removeEventListener(AUDIO_VOLUME_EVENT, onVolumeChange);
  }, []);

  const handleChange = (value: number) => {
    setVolume(value);
    setAudioVolume(value);
  };

  const muted = volume === 0;

  return (
    <div className={clsx("flex items-center gap-3", className)}>
      <button
        type="button"
        onClick={() => handleChange(muted ? 1 : 0)}
        aria-label={muted ? "Unmute" : "Mute"}
        title={muted ? "Unmute" : "Mute"}
        className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-gv-muted transition-colors hover:bg-gv-panel-soft hover:text-gv-text focus:outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gv-accent-cool"
      >
        {muted ? (
          <SpeakerXMarkIcon className="size-5" aria-hidden="true" />
        ) : (
          <SpeakerWaveIcon className="size-5" aria-hidden="true" />
        )}
      </button>

      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        onChange={(event) => handleChange(Number(event.target.value))}
        aria-label="Sound volume"
        aria-valuetext={`${Math.round(volume * 100)}%`}
        className="h-1.5 w-full min-w-0 cursor-pointer appearance-none rounded-full bg-gv-line accent-gv-accent"
      />

      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-gv-muted">
        {Math.round(volume * 100)}%
      </span>
    </div>
  );
}
