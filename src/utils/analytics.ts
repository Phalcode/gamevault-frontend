const ANALYTICS_CONSENT_KEY = "app_analytics_consent";

/**
 * Returns whether analytics tracking is currently enabled.
 * Defaults to `true` (opt-out) when no preference has been stored.
 */
export function isAnalyticsEnabled(): boolean {
  try {
    const stored = localStorage.getItem(ANALYTICS_CONSENT_KEY);
    if (stored === null) return true;
    return stored === "1";
  } catch {
    return true;
  }
}

/**
 * Persists the user's analytics consent preference.
 */
export function setAnalyticsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, enabled ? "1" : "0");
  } catch {
    // localStorage unavailable (private browsing, etc.)
  }
}
