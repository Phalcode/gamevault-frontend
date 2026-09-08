import { formatShortDate } from "@/utils/date";
import { formatDecimal } from "@/utils/number";

/**
 * Derive initial bookmark state from the raw API shape. Handles both the
 * `bookmarked_users` and `bookmarkedUsers` variants and matching by `id`/`ID`.
 */
export function initialGameBookmarked(
  game: any,
  currentUserId?: unknown,
): boolean {
  if (!currentUserId) return false;
  const raw = game?.bookmarked_users || game?.bookmarkedUsers;
  if (!Array.isArray(raw)) return false;
  return raw.some((u: any) => (u?.id ?? u?.ID) === currentUserId);
}

/**
 * Format a game size for display. Returns `null` for missing/NaN values (so
 * the caller can hide the size label) and scales up to PB. Distinct from
 * `downloadFormat.formatBytes`, which returns "0 B" for zero/negative.
 */
export function formatGameSize(bytes?: number): string | null {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${formatDecimal(value, value < 10 ? 2 : value < 100 ? 1 : 0)} ${units[unitIndex]}`;
}

/**
 * Resolve the cell that is shown next to a game card given the active sort,
 * mirroring the sort key so the metric always matches the ordering.
 */
export function resolveSortMetric(
  sortBy: string | undefined,
  game: any,
  formattedSize: string | null,
): string | null {
  switch (sortBy) {
    case "size":
      return formattedSize;
    case "created_at":
      return game.created_at ? formatShortDate(game.created_at) : null;
    case "metadata.release_date":
      return game.metadata?.release_date ? formatShortDate(game.metadata.release_date) : null;
    case "metadata.rating":
      return game.metadata?.rating != null
        ? `${formatDecimal(game.metadata.rating, 1)}%`
        : null;
    case "download_count":
      return game.download_count != null
        ? game.download_count.toLocaleString()
        : null;
    case "metadata.average_playtime":
      return game.metadata?.average_playtime != null
        ? `${Math.round(game.metadata.average_playtime / 60)}h`
        : null;
    default:
      return formattedSize;
  }
}
