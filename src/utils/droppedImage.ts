/**
 * Shared resolver for dropped/pasted image sources.
 *
 * Drag & drop on Linux (WebKitGTK) reports browser-dragged images as URIs
 * instead of file paths, so the native drop handler can hand us
 * `https://...` (sometimes with the link text appended), `file://` URIs or
 * plain OS paths. This resolves all of them to something consumable:
 * - local paths / `file://` URIs -> bytes read via `fs_read_binary_file`
 * - `data:` URIs and image URLs -> fetched into a `File`
 * - direct image URLs -> passed through as `{ kind: "url" }` so the existing
 *   image-url upload flow is used
 */

export type ResolvedDropImage =
  | { kind: "url"; url: string }
  | { kind: "file"; file: File };

/** True for URLs that end in a common image extension. */
export function isProbablyImageUrl(value: string): boolean {
  return /^https?:\/\/.+\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i.test(
    value.trim(),
  );
}

async function readLocalFile(path: string): Promise<File | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const arr = (await invoke("fs_read_binary_file", { path })) as number[];
    const bytes = new Uint8Array(arr);
    const name = path.split(/[\\/]/).pop() || "image.png";
    const ext = (name.split(".").pop() || "").toLowerCase();
    const type =
      /^(png|jpe?g|gif|webp|avif|svg)$/i.test(ext)
        ? `image/${ext === "jpg" ? "jpeg" : ext}`
        : "application/octet-stream";
    return new File([bytes], name, { type });
  } catch (error) {
    console.error("Failed to read dropped file:", error);
    return null;
  }
}

async function fetchImageFile(url: string): Promise<File | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) return null;
    const name =
      decodeURIComponent(
        (url.match(/\/[^/?#]+(?=(\?|#|$))/)?.[0] || "/image.png").slice(1),
      ) || "image.png";
    return new File([blob], name, { type: blob.type });
  } catch (error) {
    console.error("Failed to fetch dropped image URL:", error);
    return null;
  }
}

/**
 * Resolve a single dropped source.
 * Returns `null` when the source can't be read (logs the reason).
 */
export async function resolveDroppedImageSource(
  source: string,
): Promise<ResolvedDropImage | null> {
  const value = source.trim();
  if (!value) return null;

  // data: URI
  if (/^data:image\//i.test(value)) {
    const file = await fetchImageFile(value);
    return file ? { kind: "file", file } : null;
  }

  // Browser-dragged URL (possibly with link text appended, e.g.
  // "https://example.com/image.jpg 45 - phalanx").
  const urlMatch = value.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) {
    const url = urlMatch[0];
    if (isProbablyImageUrl(url)) return { kind: "url", url };
    const file = await fetchImageFile(url);
    if (file) return { kind: "file", file };
    // Fetch failed (CORS, offline, ...) — fall back to the URL flow so the
    // backend can download it instead (no browser CORS involved).
    return { kind: "url", url };
  }

  // file:// URI (WebKitGTK)
  if (value.startsWith("file://")) {
    const file = await readLocalFile(
      decodeURIComponent(value.slice("file://".length)),
    );
    return file ? { kind: "file", file } : null;
  }

  // Plain local path (OS file drag)
  const file = await readLocalFile(value);
  return file ? { kind: "file", file } : null;
}

/**
 * Try each dropped source in order and hand the first usable one to the
 * caller. Returns `true` when something was applied. `applyDroppedSources`
 * is the shared entry point for the native drag-drop listeners.
 */
export async function applyDroppedSources(
  sources: string[],
  handlers: { onUrl: (url: string) => void; onFile: (file: File) => void },
): Promise<boolean> {
  for (const source of sources) {
    const resolved = await resolveDroppedImageSource(source);
    if (!resolved) continue;
    if (resolved.kind === "url") {
      handlers.onUrl(resolved.url);
    } else {
      handlers.onFile(resolved.file);
    }
    return true;
  }
  return false;
}
