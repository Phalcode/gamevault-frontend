/**
 * Shared, locale-aware number formatting helpers.
 *
 * These use `Intl.NumberFormat` so the decimal separator and thousands
 * separator follow the locale the computer uses (e.g. `1,5 GB` for German vs
 * `1.5 GB` for US English), instead of the hard-coded `.` that `toFixed`
 * always produces.
 */

const formatterCache = new Map<string, Intl.NumberFormat>();

function currentLocale(): string | undefined {
  return typeof navigator !== "undefined" ? navigator.language : undefined;
}

function getFormatter(
  locale: string | undefined,
  options: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = `${locale ?? "default"}::${JSON.stringify(options)}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    formatterCache.set(key, formatter);
  }
  return formatter;
}

/** Locale-aware number with the given `Intl.NumberFormat` options. */
export function formatNumber(
  value: number,
  options: Intl.NumberFormatOptions = {},
): string {
  return getFormatter(currentLocale(), options).format(value);
}

/**
 * Locale-aware number with a fixed number of fraction digits (trailing zeros
 * are kept), e.g. `1.50` (en-US) / `1,50` (de).
 */
export function formatDecimal(value: number, fractionDigits: number): string {
  return formatNumber(value, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/**
 * Locale-aware number with trailing zeros trimmed, e.g. `1.5` (en-US) /
 * `1,5` (de). Replaces the previous `trimZeros(x.toFixed(n))` pattern.
 */
export function formatTrimmedNumber(
  value: number,
  maxFractionDigits: number,
): string {
  return formatNumber(value, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  });
}
