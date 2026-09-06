/**
 * Streamer / OPSEC mode utilities.
 *
 * When enabled, user-facing identifiers (display names, handles, emails and the
 * server URL) are replaced with deterministic placeholder values so a stream
 * capture never leaks real identities or the server address.
 *
 * The setting is display-only: form inputs and sort helpers are intentionally
 * left unmasked.
 */

import { useEffect, useState } from "react";

const STREAMER_MODE_KEY = "gv_streamer_mode";
const STREAMER_MODE_EVENT = "gv:streamer-mode-change";

const FAKE_DISPLAY_NAMES = [
  "Dr. Wobble",
  "Noodle McFuzzle",
  "Captain Clutch",
  "Salty Sam",
  "Lazy Llama",
  "Pixel Peeker",
  "Glitch Goblin",
  "Space Cadet",
  "Turbo Turtle",
  "Waffle Wizard",
  "Sir Loin",
  "Mystery Meat",
  "Bongo Bop",
  "Sticky Keys",
  "Ping Pong Brain",
];

const FAKE_HANDLES = [
  "night_owl",
  "spicy_noodle",
  "quiet_llama",
  "pixel_drifter",
  "wobbly_waffle",
  "galaxy_goblin",
  "turbo_snail",
  "sleepy_guardian",
  "mellow_peeper",
  "burst_bubble",
  "calm_biscuit",
  "crispy_moth",
  "fuzzy_signal",
  "chill_cactus",
];

const FAKE_SERVER_URL = "https://my.secret.server";

/** Deterministic djb2-style hash of a string, used to pick a stable placeholder. */
function hash(input: string): number {
  let value = 0;
  for (let index = 0; index < input.length; index += 1) {
    value = (value << 5) - value + input.charCodeAt(index);
    value |= 0;
  }
  return Math.abs(value);
}

function pick<T>(items: T[], seed: string): T {
  return items[hash(seed) % items.length];
}

export function getStreamerMode(): boolean {
  try {
    return localStorage.getItem(STREAMER_MODE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setStreamerMode(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(STREAMER_MODE_KEY, "true");
    } else {
      localStorage.removeItem(STREAMER_MODE_KEY);
    }
  } catch {
    // Ignore storage errors (e.g. when storage is unavailable).
  }
  window.dispatchEvent(new Event(STREAMER_MODE_EVENT));
}

/** React hook that returns the current streamer mode and updates reactively. */
export function useStreamerMode(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => getStreamerMode());

  useEffect(() => {
    const sync = () => setEnabled(getStreamerMode());
    window.addEventListener(STREAMER_MODE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(STREAMER_MODE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return enabled;
}

export function maskDisplayName(name: string): string {
  return name ? pick(FAKE_DISPLAY_NAMES, name) : "Anonymous";
}

export function maskHandle(handle: string): string {
  return handle ? pick(FAKE_HANDLES, handle) : "_anon";
}

export function maskEmail(email: string): string {
  if (!email) return "";
  const atIndex = email.indexOf("@");
  if (atIndex === -1) return "****@masked.example";
  const domain = email.slice(atIndex + 1);
  return `${pick(FAKE_HANDLES, email)}@${domain || "masked.example"}`;
}

export function maskUrl(url: string): string {
  return url ? FAKE_SERVER_URL : "";
}
