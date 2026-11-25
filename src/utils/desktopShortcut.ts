import { blobToBase64 } from "@/utils/binary";
import { resolveApiMediaBlob } from "@/utils/mediaCache";

export interface DesktopShortcutResult {
  /** Absolute path of the created shortcut. */
  path: string;
  /** Icon origin: `executable`, `cover` or `none`. */
  icon: string;
}

/**
 * Creates a desktop shortcut that starts an installed game through its
 * `gamevault://start` deep link. The Rust command handles the platform-specific
 * file format and icon extraction.
 */
export async function createGameDesktopShortcut({
  gameId,
  title,
  executablePath,
  coverBase64,
}: {
  gameId: number;
  title: string;
  executablePath: string;
  coverBase64: string | null;
}): Promise<DesktopShortcutResult> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DesktopShortcutResult>("create_desktop_shortcut", {
    gameId,
    title,
    executablePath,
    coverBase64,
  });
}

/**
 * Loads the game cover as base64 for the shortcut icon fallback.
 *
 * The cover only matters when the executable has no extractable icon, so every
 * failure (missing media, offline, cache error) resolves to `null` instead of
 * blocking the shortcut itself.
 */
export async function loadGameCoverBase64({
  serverUrl,
  authFetch,
  gameId,
  coverId,
}: {
  serverUrl?: string | null;
  authFetch?: ((input: string, init?: RequestInit) => Promise<Response>) | null;
  gameId: number;
  coverId?: number | string | null;
}): Promise<string | null> {
  if (!coverId || !serverUrl || !authFetch) return null;

  try {
    const blob = await resolveApiMediaBlob({
      serverUrl,
      mediaId: Number(coverId),
      authFetch,
      owner: { gameId, slot: "cover" },
    });
    return await blobToBase64(blob);
  } catch {
    return null;
  }
}
