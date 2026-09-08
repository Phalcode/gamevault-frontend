export interface SearchableSettingMeta {
  /** Stable identifier, also used as the scroll/highlight target. */
  id: string;
  title: string;
  description?: string;
  category: string;
  keywords: string[];
  /** Only shown in the desktop (Tauri) app. Hidden from search on the web build. */
  desktopOnly?: boolean;
  /** Only shown on the web build. Hidden from search in the real desktop app. */
  webOnly?: boolean;
  /** Only shown on Linux (Tauri). Hidden from search elsewhere. */
  linuxOnly?: boolean;
}

export interface PlatformFlags {
  isTauri: boolean;
  isDesktopApp: boolean;
  isLinux: boolean;
}

/** Filter the settings index based on the current platform flags. */
export function filterSearchableSettings<T extends SearchableSettingMeta>(
  index: T[],
  flags: PlatformFlags,
): T[] {
  return index.filter(
    (s) =>
      (!s.desktopOnly || flags.isTauri) &&
      (!s.webOnly || !flags.isDesktopApp) &&
      (!s.linuxOnly || flags.isLinux),
  );
}

/**
 * Match a setting against a trimmed, lowercased query by title, description,
 * or any keyword. Returns true for an empty query (callers gate on this).
 */
export function matchesQuery<T extends SearchableSettingMeta>(
  setting: T,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  return (
    setting.title.toLowerCase().includes(q) ||
    (setting.description?.toLowerCase().includes(q) ?? false) ||
    setting.keywords.some((k) => k.includes(q))
  );
}

/** Run a search over the index, respecting platform-only settings. */
export function searchSettings<T extends SearchableSettingMeta>(
  index: T[],
  query: string,
  flags: PlatformFlags,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return filterSearchableSettings(index, flags).filter((s) =>
    matchesQuery(s, q),
  );
}

/** Deduplicated set of categories that contain at least one matching setting. */
export function searchResultCategories<C extends string>(
  results: Array<{ category: C }>,
): C[] {
  return Array.from(new Set(results.map((s) => s.category)));
}

/** Highlight class applied to the scroll-target setting after a search pick. */
export function rowHighlight(
  highlightedId: string | null,
  searchableId: string,
): string {
  return highlightedId === searchableId ? "bg-gv-accent/10" : "";
}
