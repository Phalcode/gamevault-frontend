import { createAvatar } from "@dicebear/core";
import { funEmoji } from "@dicebear/collection";

/**
 * Returns a deterministic DiceBear fun-emoji avatar as an SVG data URI.
 *
 * The same `seed` always produces the same image, so avatars are stable across
 * renders, navigations and sessions. Used both to mask a user's real profile
 * picture in OPSEC mode and as the default fallback for users who have not
 * uploaded one (instead of an empty box or initials).
 */
export function createDicebearAvatar(seed: string): string {
  return createAvatar(funEmoji, {
    seed,
  }).toDataUri();
}
