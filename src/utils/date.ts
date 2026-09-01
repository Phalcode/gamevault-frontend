/**
 * Shared, locale-aware date formatting helpers.
 *
 * All GameVault date display should go through these so the output is
 * uniform and follows the locale the computer uses (e.g. `dd.mm.yyyy` for
 * German, `mm/dd/yyyy` for US English) — rather than a hard-coded `en-US`
 * format or a cached `Intl.DateTimeFormat` built once at module load.
 *
 * Note: `toLocaleDateString()` / `toLocaleString()` resolve the default
 * locale at call time, so they always reflect the current system locale.
 */

function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (value == null || value === "") return null;
  // Date-only strings like "2023-01-01" are calendar dates without a time.
  // Parsing them with `new Date(...)` treats them as UTC midnight, which can
  // shift a day (or year) in timezones west of UTC. Read them as a local date
  // instead so the intended calendar day is preserved.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Locale date only, e.g. `15.08.2025` (de) or `08/15/2025` (en-US). */
export function formatDate(value: unknown, fallback = "—"): string {
  const date = toDate(value);
  return date ? date.toLocaleDateString() : fallback;
}

/** Locale date + time, e.g. `15.08.2025, 16:01` (de). */
export function formatDateTime(value: unknown, fallback = "—"): string {
  const date = toDate(value);
  return date ? date.toLocaleString() : fallback;
}

/**
 * Compact date with a short month name, e.g. `15. Jan. 2025` (de) or
 * `Jan 15, 2025` (en-US). Useful for card metrics.
 */
export function formatShortDate(value: unknown, fallback = ""): string {
  const date = toDate(value);
  return date
    ? date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : fallback;
}

/** Locale time only, e.g. `16:01` (de) or `4:01 PM` (en-US). */
export function formatTime(value: unknown, fallback = ""): string {
  const date = toDate(value);
  return date ? date.toLocaleTimeString() : fallback;
}

/** Year only, e.g. `2023`. Handles date-only strings timezone-safely. */
export function formatYear(value: unknown, fallback = ""): string {
  const date = toDate(value);
  return date ? String(date.getFullYear()) : fallback;
}
