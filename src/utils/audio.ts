/**
 * Central audio system for GameVault.
 *
 * Handles the OS/webview specifics in one place:
 * - WebKitGTK on Linux (packaged Tauri app) blocks media loaded from the
 *   `tauri://` custom scheme with "the resource was requested insecurely"
 *   (tauri-apps/tauri#12767) even though the request returns 200. Loading
 *   every sound through fetch -> Blob -> object URL avoids the custom scheme
 *   entirely.
 * - Autoplay restrictions are handled per-play (callers get a rejected
 *   promise on block; they can retry from a user gesture).
 * - A single persisted volume setting (`gv_audio_volume`) is shared by every
 *   sound and broadcast via `AUDIO_VOLUME_EVENT` so open UIs stay in sync.
 */

export type SoundName = "unlock" | "pop" | "wellerman";

const SOUND_SOURCES: Record<SoundName, string> = {
  unlock: "/audio/laughingdog.ogg",
  pop: "/audio/pop.ogg",
  wellerman: "/audio/wellerman.ogg",
};

/** `CustomEvent` fired on `window` whenever the volume changes. */
export const AUDIO_VOLUME_EVENT = "gv:audio-volume-change";

const VOLUME_STORAGE_KEY = "gv_audio_volume";
export const DEFAULT_AUDIO_VOLUME = 0.7;

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_AUDIO_VOLUME;
  return Math.min(1, Math.max(0, value));
}

/** Current sound volume in the 0..1 range (persisted). */
export function getAudioVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_STORAGE_KEY);
    if (raw !== null) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return clampVolume(parsed);
    }
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_AUDIO_VOLUME;
}

/** Set and persist the sound volume (0..1). */
export function setAudioVolume(volume: number): void {
  const next = clampVolume(volume);
  try {
    localStorage.setItem(VOLUME_STORAGE_KEY, String(next));
  } catch {
    // localStorage unavailable
  }
  // Update every currently playing element immediately, so the volume
  // slider takes effect live even for sounds started before the change.
  for (const element of liveElements) {
    element.volume = next;
  }
  window.dispatchEvent(
    new CustomEvent(AUDIO_VOLUME_EVENT, { detail: { volume: next } }),
  );
}

/** Blob URLs are cached per sound; they must not be revoked while cached. */
const soundUrlCache = new Map<SoundName, Promise<string>>();

/** Every audio element currently alive (playing or paused) — kept in sync with the volume live. */
const liveElements = new Set<HTMLAudioElement>();

function trackElement(element: HTMLAudioElement): void {
  liveElements.add(element);
  element.addEventListener("ended", () => liveElements.delete(element), {
    once: true,
  });
}

/**
 * Resolve a playable URL for a bundled sound. Prefers a cached Blob object
 * URL (works on Linux native); falls back to the direct asset URL (dev
 * server, non-Linux webviews) when fetching fails.
 */
export function getSoundUrl(name: SoundName): Promise<string> {
  const cached = soundUrlCache.get(name);
  if (cached) return cached;

  const promise = fetch(SOUND_SOURCES[name])
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.blob();
    })
    .then((blob) => URL.createObjectURL(blob))
    .catch(() => SOUND_SOURCES[name]);

  soundUrlCache.set(name, promise);
  return promise;
}

/**
 * Play a bundled sound at (optionally) the system volume.
 * Returns the playing element so callers can stop it, or `null` when the
 * sound cannot be fetched or autoplay is blocked.
 */
export async function playSound(
  name: SoundName,
  options?: { volume?: number },
): Promise<HTMLAudioElement | null> {
  try {
    const url = await getSoundUrl(name);
    const audio = new Audio(url);
    audio.volume = clampVolume(options?.volume ?? getAudioVolume());
    trackElement(audio);
    await audio.play();
    return audio;
  } catch {
    return null;
  }
}
