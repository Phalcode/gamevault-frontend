import type { GamevaultGame } from "@/api/models/GamevaultGame";

/** Minimal shape of the installed-version info attached to a game card. */
export interface InstalledVersionLike {
  versionId?: number;
  versionName?: string;
}

/**
 * Normalizes a version tag so trivially different spellings compare equal:
 * trims, lowercases and drops a leading `v`/`v.`. So `" v1.2.0 "` and
 * `"1.2.0"` both normalize to `"1.2.0"`.
 */
export function normalizeVersionTag(tag?: string | null): string {
  return (tag ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/^v\.?\s*/, "")
    .replace(/\s+/g, " ");
}

/**
 * Returns the server's current ("latest"/default) version tag for a game.
 *
 * The backend keeps the legacy `version` column in sync with the default
 * version (chosen by `selectDefaultGameVersion`, i.e. the newest comparable
 * version), so it is the most reliable single source. When that mirror is
 * missing — e.g. a cached/offline payload that only carries `versions[]` — fall
 * back to the newest entry by `indexed_at`/`created_at`, then by `id`.
 */
export function resolveServerVersionTag(game: any): string | null {
  const mirrored = typeof game?.version === "string" ? game.version.trim() : "";
  if (mirrored) return mirrored;

  const versions = Array.isArray(game?.versions)
    ? (game.versions as any[]).filter(
        (v) => v && typeof v.version === "string" && v.version.trim(),
      )
    : [];
  if (versions.length === 0) return null;

  const newest = [...versions].sort((a, b) => {
    const at = new Date(
      a.indexed_at ?? a.updated_at ?? a.created_at ?? 0,
    ).getTime();
    const bt = new Date(
      b.indexed_at ?? b.updated_at ?? b.created_at ?? 0,
    ).getTime();
    if (at !== bt) return bt - at;
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  })[0];

  return typeof newest?.version === "string" ? newest.version : null;
}

/**
 * Whether a newer version of an installed game is available on the server.
 *
 * A game can only have an update when it is installed locally (which yields an
 * installed version tag) and that tag differs from the server's current default
 * version tag. Returns `false` whenever either side is unknown so the indicator
 * never shows speculatively.
 */
export function isGameUpdateAvailable(
  game: Pick<GamevaultGame, "version" | "versions"> | any,
  installed: InstalledVersionLike | null | undefined,
): boolean {
  if (!installed) return false;

  const installedTag = normalizeVersionTag(installed.versionName);
  if (!installedTag) return false;

  const serverTag = normalizeVersionTag(resolveServerVersionTag(game));
  if (!serverTag) return false;

  return installedTag !== serverTag;
}
