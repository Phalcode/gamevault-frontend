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
import { adjectives, animals, uniqueNamesGenerator } from "unique-names-generator";

const STREAMER_MODE_KEY = "gv_streamer_mode";
const STREAMER_MODE_EVENT = "gv:streamer-mode-change";

const FAKE_SERVER_URL = "https://my.secret.server";
const FAKE_EMAIL_DOMAIN = "masked.example";

/** True for an empty/null/undefined seed (no identifiable user). */
function isEmptySeed(seed: string | number): boolean {
  return seed === "" || seed == null;
}

const capitalize = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1);

/**
 * Generate a single deterministic (adjective, animal) pair from the seed so the
 * display name and the handle/email always line up (same words). Kept short —
 * adjective + animal is enough for OPSEC mode.
 */
function maskParts(
  seed: string | number,
): { adjective: string; animal: string } {
  const generated = uniqueNamesGenerator({
    dictionaries: [adjectives, animals],
    length: 2,
    separator: "_",
    style: "lowerCase",
    seed: String(seed),
  });
  const [adjective, ...rest] = generated.split("_");
  return { adjective, animal: rest.join("_") || adjective };
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

/** Deterministic stand-in display name, seeded from the user's stable id. */
export function maskDisplayName(seed: string | number): string {
  if (isEmptySeed(seed)) return "Anonymous";
  const { adjective, animal } = maskParts(seed);
  return `${capitalize(adjective)} ${capitalize(animal)}`;
}

/** Deterministic stand-in handle, seeded from the user's stable id. */
export function maskHandle(seed: string | number): string {
  if (isEmptySeed(seed)) return "_anon";
  const { adjective, animal } = maskParts(seed);
  return `${adjective}_${animal}`;
}

/** Deterministic stand-in email. The real domain is never leaked. */
export function maskEmail(seed: string | number): string {
  if (isEmptySeed(seed)) return "";
  return `${maskHandle(seed)}@${FAKE_EMAIL_DOMAIN}`;
}

export function maskUrl(url: string): string {
  return url ? FAKE_SERVER_URL : "";
}

export interface MaskedUser {
  displayName: string;
  handle: string;
  email: string;
}

/**
 * Masks every identifier of a user with a single, stable stand-in seeded from
 * `user.id`, so the same user always gets the same placeholder everywhere.
 */
export function maskUser(user: { id?: number }): MaskedUser {
  const seed = user.id != null ? String(user.id) : "";
  return {
    displayName: maskDisplayName(seed),
    handle: maskHandle(seed),
    email: maskEmail(seed),
  };
}

/**
 * Ctrl/Cmd + Shift + O toggles OPSEC/streamer mode from anywhere in the app.
 * Returns a cleanup function removing the listener.
 */
export function registerStreamerModeHotkey(): () => void {
  const handler = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== "o") return;
    if (!event.shiftKey) return;
    if (!event.ctrlKey && !event.metaKey) return;
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable)
    ) {
      return;
    }
    event.preventDefault();
    setStreamerMode(!getStreamerMode());
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}
