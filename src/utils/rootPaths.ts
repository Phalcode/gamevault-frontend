/**
 * Multi-root directory management.
 *
 * Legacy: single path stored as `tauri_download_path` (string).
 * Current: array stored as `tauri_download_paths` (JSON string).
 *
 * Each entry: { id: string (UUID), path: string, label: string }
 */

export interface RootPathEntry {
  id: string;
  path: string;
  label: string;
}

const LEGACY_KEY = "tauri_download_path";
const ROOT_PATHS_KEY = "tauri_download_paths";

/** Auto-migrate legacy single path to array. Returns the migrated array. */
function migrateLegacyPath(): RootPathEntry[] | null {
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy || legacy.trim().length === 0) return null;

    const entry: RootPathEntry = {
      id: crypto.randomUUID(),
      path: legacy.trim(),
      label: "",
    };

    const paths = [entry];
    localStorage.setItem(ROOT_PATHS_KEY, JSON.stringify(paths));
    localStorage.removeItem(LEGACY_KEY);
    return paths;
  } catch {
    return null;
  }
}

/** Read all configured root paths from localStorage. */
export function getRootPaths(): RootPathEntry[] {
  try {
    const raw = localStorage.getItem(ROOT_PATHS_KEY);
    if (!raw) {
      const migrated = migrateLegacyPath();
      return migrated ?? [];
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      // Corrupt data — attempt migration fallback
      const migrated = migrateLegacyPath();
      return migrated ?? [];
    }

    return (parsed as RootPathEntry[]).filter(
      (e) => typeof e.id === "string" && e.id.length > 0 && typeof e.path === "string" && e.path.trim().length > 0,
    );
  } catch {
    return [];
  }
}

/** Persist root paths to localStorage. */
export function setRootPaths(paths: RootPathEntry[]): void {
  try {
    localStorage.setItem(ROOT_PATHS_KEY, JSON.stringify(paths));
  } catch {
    console.warn("Failed to persist root paths");
  }
}

/** Add a new root path. Returns updated array. */
export function addRootPath(pathInput: string, label = ""): RootPathEntry[] {
  const clean = pathInput.trim();
  if (!clean) return getRootPaths();

  const existing = getRootPaths();

  // Deduplicate by path (case-insensitive on Windows, but normalized here)
  const normalized = clean.replace(/\\/g, "/").toLowerCase();
  if (existing.some((e) => e.path.replace(/\\/g, "/").toLowerCase() === normalized)) {
    return existing;
  }

  const entry: RootPathEntry = { id: crypto.randomUUID(), path: clean, label };
  const updated = [...existing, entry];
  setRootPaths(updated);
  return updated;
}

/** Remove a root path by id. Returns updated array. */
export function removeRootPath(id: string): RootPathEntry[] {
  const updated = getRootPaths().filter((e) => e.id !== id);
  setRootPaths(updated);

  // If all paths removed, clear legacy key too (clean state)
  if (updated.length === 0) {
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch { /* ignore */ }
  }

  return updated;
}

/** Update label for a root path entry. */
export function updateRootPathLabel(id: string, label: string): RootPathEntry[] {
  const updated = getRootPaths().map((e) =>
    e.id === id ? { ...e, label } : e,
  );
  setRootPaths(updated);
  return updated;
}

/** Update path for a root path entry (re-browse). */
export function updateRootPath(id: string, newPath: string): RootPathEntry[] {
  const clean = newPath.trim();
  if (!clean) return getRootPaths();
  const updated = getRootPaths().map((e) =>
    e.id === id ? { ...e, path: clean } : e,
  );
  setRootPaths(updated);
  return updated;
}

/**
 * Get a single default root path for consumers that only need one.
 * Returns first entry, or null if no paths configured.
 */
export function getDefaultRootPath(): RootPathEntry | null {
  const paths = getRootPaths();
  return paths.length > 0 ? paths[0] : null;
}

/**
 * Check if any root paths are configured at all.
 * Backward-compatible: also checks legacy key.
 */
export function hasRootPaths(): boolean {
  return getRootPaths().length > 0;
}
