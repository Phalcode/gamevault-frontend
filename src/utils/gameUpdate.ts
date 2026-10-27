import type { GamevaultGame } from "@/api/models/GamevaultGame";

/** OS family a game version is built for. */
export type GamePlatform = "windows" | "linux";

/** Minimal shape of the installed-version info attached to a game card. */
export interface InstalledVersionLike {
  versionId?: number;
  versionName?: string;
  /** Version type from the local install config, e.g. `WINDOWS_PORTABLE`. */
  gameType?: string | null;
}

interface ServerVersionLike {
  id?: number;
  type?: string | null;
  version?: string | null;
  indexed_at?: string | Date | null;
  updated_at?: string | Date | null;
  created_at?: string | Date | null;
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
 * Maps a GameVault version type (`WINDOWS_PORTABLE`, `LINUX_SETUP`, …) to the
 * OS family it runs on. `UNDETECTABLE` and unknown types map to `null`.
 */
export function resolveVersionPlatform(
  type?: string | null,
): GamePlatform | null {
  const normalized = String(type ?? "")
    .trim()
    .toUpperCase();
  if (normalized.startsWith("WINDOWS_")) return "windows";
  if (normalized.startsWith("LINUX_")) return "linux";
  return null;
}

function collectVersions(game: any): ServerVersionLike[] {
  return Array.isArray(game?.versions)
    ? (game.versions as ServerVersionLike[]).filter((version) => !!version)
    : [];
}

function hasVersionTag(version: ServerVersionLike): boolean {
  return typeof version.version === "string" && version.version.trim() !== "";
}

/**
 * Resolves the platform of the locally installed version. The version id is
 * matched against the server's version list first (the install config does not
 * always carry the type); the stored install type is the fallback.
 */
function resolveInstalledPlatform(
  installed: InstalledVersionLike | null | undefined,
  versions: ServerVersionLike[],
): GamePlatform | null {
  if (!installed) return null;

  const versionId = Number(installed.versionId);
  if (Number.isFinite(versionId) && versionId > 0) {
    const installedVersion = versions.find(
      (version) => Number(version.id) === versionId,
    );
    const platform = resolveVersionPlatform(installedVersion?.type);
    if (platform) return platform;
  }

  return resolveVersionPlatform(installed.gameType);
}

interface VersionSignals {
  numericParts: number[];
  comparable: boolean;
  isPreRelease: boolean;
}

function extractVersionSignals(tag?: string | null): VersionSignals {
  const normalized = normalizeVersionTag(tag);
  const numericParts = (normalized.match(/\d+/g) || []).map(Number);
  return {
    numericParts,
    comparable: numericParts.length > 0,
    isPreRelease:
      /(alpha|beta|pre|preview|rc|test|dev|hotfix|patch|build)/i.test(
        normalized,
      ),
  };
}

function compareNumericParts(a: number[], b: number[]): number {
  const maxLength = Math.max(a.length, b.length);
  for (let i = 0; i < maxLength; i++) {
    const aPart = a[i] ?? 0;
    const bPart = b[i] ?? 0;
    if (aPart !== bPart) return bPart - aPart;
  }
  return 0;
}

function versionTimestamp(version: ServerVersionLike): number {
  const raw =
    version.indexed_at ?? version.updated_at ?? version.created_at ?? 0;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : 0;
}

/** Sorts versions newest-first using the version tag, then index recency. */
function newestVersion(versions: ServerVersionLike[]): ServerVersionLike {
  return [...versions].sort((a, b) => {
    const aSignals = extractVersionSignals(a.version);
    const bSignals = extractVersionSignals(b.version);

    if (aSignals.comparable !== bSignals.comparable) {
      return aSignals.comparable ? -1 : 1;
    }

    const numericCompare = compareNumericParts(
      aSignals.numericParts,
      bSignals.numericParts,
    );
    if (numericCompare !== 0) return numericCompare;

    if (aSignals.isPreRelease !== bSignals.isPreRelease) {
      return aSignals.isPreRelease ? 1 : -1;
    }

    const aTime = versionTimestamp(a);
    const bTime = versionTimestamp(b);
    if (aTime !== bTime) return bTime - aTime;

    return (Number(b.id) || 0) - (Number(a.id) || 0);
  })[0];
}

/**
 * Resolves the platform of the legacy `version` mirror. The mirrored tag is
 * matched against the version list first, because locally installed game cards
 * overwrite `game.type` with the installed type — which says nothing about the
 * server's default version.
 */
function resolveMirroredPlatform(
  game: any,
  versions: ServerVersionLike[],
  mirrored: string,
): GamePlatform | null {
  const direct = resolveVersionPlatform(game?.type);
  const normalizedMirror = normalizeVersionTag(mirrored);
  if (!normalizedMirror) return direct;

  const matchedPlatforms = versions
    .filter(
      (version) =>
        hasVersionTag(version) &&
        normalizeVersionTag(version.version) === normalizedMirror,
    )
    .map((version) => resolveVersionPlatform(version.type))
    .filter((platform): platform is GamePlatform => platform !== null);

  if (direct && matchedPlatforms.includes(direct)) return direct;
  return matchedPlatforms[0] ?? direct;
}

/**
 * Returns the server's current version tag for the installed platform.
 *
 * A game can carry versions for several platforms (e.g. a Windows build and a
 * newer Linux build). The legacy `version` mirror points at the backend's
 * default version, which may belong to another platform, so it is only used
 * when it provably belongs to the installed platform. Otherwise the newest
 * version tag of the matching platform wins. When the installed platform
 * cannot be determined, the previous platform-agnostic behavior applies.
 */
export function resolveServerVersionTag(
  game: any,
  installed?: InstalledVersionLike | null,
): string | null {
  const versions = collectVersions(game);
  const platform = resolveInstalledPlatform(installed, versions);

  const mirrored = typeof game?.version === "string" ? game.version.trim() : "";
  const mirroredPlatform = mirrored
    ? resolveMirroredPlatform(game, versions, mirrored)
    : null;

  if (platform) {
    if (mirrored && mirroredPlatform === platform) return mirrored;

    const typedVersions = versions.filter(
      (version) => resolveVersionPlatform(version.type) !== null,
    );
    if (typedVersions.length > 0) {
      const samePlatform = typedVersions.filter(
        (version) =>
          resolveVersionPlatform(version.type) === platform &&
          hasVersionTag(version),
      );

      // No version for the installed platform means there is nothing to update
      // to — never fall back to a tag from another platform.
      if (samePlatform.length === 0) return null;

      return newestVersion(samePlatform).version!.trim();
    }

    // Legacy payload without version types: compare against the mirror.
    return mirrored || null;
  }

  if (mirrored) return mirrored;

  const taggedVersions = versions.filter(hasVersionTag);
  return taggedVersions.length > 0
    ? newestVersion(taggedVersions).version!.trim()
    : null;
}

/**
 * Whether a newer version of an installed game is available on the server.
 *
 * A game can only have an update when it is installed locally (which yields an
 * installed version tag) and that tag differs from the server's current version
 * tag for the same platform. Versions for other platforms are ignored, so a
 * newer Linux build never shows up as an update on a Windows install (and vice
 * versa). Returns `false` whenever either side is unknown so the indicator
 * never shows speculatively.
 */
export function isGameUpdateAvailable(
  game: Pick<GamevaultGame, "version" | "versions"> | any,
  installed: InstalledVersionLike | null | undefined,
): boolean {
  if (!installed) return false;

  const installedTag = normalizeVersionTag(installed.versionName);
  if (!installedTag) return false;

  const serverTag = normalizeVersionTag(
    resolveServerVersionTag(game, installed),
  );
  if (!serverTag) return false;

  return installedTag !== serverTag;
}
