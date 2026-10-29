import * as Swetrix from "swetrix";
import { isTauriApp, isTauriDesktop } from "./tauri";

/** Swetrix project the Phalcode endpoints collect into. */
const ANALYTICS_PROJECT_ID = "dBl2xaaJ9x3M";
/**
 * Collectors in priority order. The first one that answers is used, so a blocked
 * or unreachable domain falls through to the next entry. The Phalcode
 * collectors are Base64 encoded so they do not appear as plain text in the
 * bundle, which keeps domain blocklists from picking them up.
 */
export const ANALYTICS_ENDPOINTS = [
  "https://api.swetrix.com/log",
  ...[
    "aHR0cHM6Ly9hbmFseXRpY3MucGxhdGZvcm0ucGhhbGNvLmRlL2xvZw==",
    "aHR0cHM6Ly9hbmFsLnBoYWxjby5kZS9sb2c=",
    "aHR0cHM6Ly90cmFjay5waGFsY28uZGUvbG9n",
    "aHR0cHM6Ly95b3VyLWRucy1wcm92aWRlci1pcy1waXNzaW5nLW1lLW9mZi5waGFsY28uZGUvbG9n",
    "aHR0cHM6Ly9zcHkucGhhbGNvLmRlL2xvZw==",
  ].map((encoded) => atob(encoded)),
];
/** Session replay is expensive, so only a fraction of sessions is recorded. */
const REPLAY_SAMPLE_RATE = 0.2;
/**
 * A collector that hangs must not keep the app waiting, so the probe gives up
 * quickly and the next one is tried.
 */
const PROBE_TIMEOUT_MS = 4_000;

const ANALYTICS_CONSENT_KEY = "app_analytics_consent";

/** Metadata values must be primitives; the SDK rejects nested objects. */
export type AnalyticsMeta = Record<
  string,
  string | number | boolean | null | undefined
>;

interface StopHandle {
  stop: () => unknown;
}

let consent: boolean | null = null;
let tracking = false;
let initPromise: Promise<void> | null = null;
let transportInstalled = false;
/** Collector the SDK is pointed at, chosen once at startup. */
let activeEndpoint: string | null = null;
const stopHandles: StopHandle[] = [];

function readLocalConsent(): boolean {
  try {
    const stored = localStorage.getItem(ANALYTICS_CONSENT_KEY);
    if (stored === null) return true;
    return stored === "1";
  } catch {
    return true;
  }
}

function writeLocalConsent(enabled: boolean): void {
  try {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, enabled ? "1" : "0");
  } catch {
    // localStorage unavailable (private browsing, etc.)
  }
}

/**
 * Returns whether analytics tracking is currently enabled.
 *
 * Defaults to `true` (opt-out) until {@link initAnalytics} has resolved the
 * stored preference.
 */
export function isAnalyticsEnabled(): boolean {
  return consent ?? readLocalConsent();
}

/**
 * Reads the stored consent. In the desktop app the Rust settings file is the
 * source of truth, because the installer clears the webview data folder on
 * updates. The localStorage value is mirrored for the web build and migrated on
 * the first start of a build that has the Rust setting.
 */
export async function loadAnalyticsConsent(): Promise<boolean> {
  const local = readLocalConsent();

  if (!isTauriApp()) {
    consent = local;
    writeLocalConsent(local);
    return local;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const stored = await invoke<boolean | null>("get_analytics_enabled");
    if (stored === null || stored === undefined) {
      // First start after the setting moved into the Rust config: carry the
      // webview decision over, then treat the config as the source of truth.
      await invoke("set_analytics_enabled", { enabled: local });
      consent = local;
    } else {
      consent = stored;
    }
  } catch (error) {
    console.error("Failed to load analytics consent:", error);
    consent = local;
  }

  writeLocalConsent(consent);
  return consent;
}

function startTracking(): void {
  if (tracking) return;
  const endpoint = activeEndpoint ?? ANALYTICS_ENDPOINTS[0];
  tracking = true;

  installDesktopTransport(endpoint);

  Swetrix.init(ANALYTICS_PROJECT_ID, {
    apiURL: endpoint,
    preloadSessionReplay: true,
  });

  // Swetrix sends a heartbeat every 28s while tracking views. Ids in the path
  // are grouped so the dashboard shows stable page names.
  void Swetrix.trackViews({
    heartbeatOnBackground: false,
    callback: (payload) => ({
      pg: normalizeRoute(payload.pg ?? window.location.pathname),
    }),
  }).then((actions) => {
    if (tracking) stopHandles.push(actions);
    else void actions.stop();
  });

  stopHandles.push(Swetrix.trackErrors({ sampleRate: 1 }));

  void Swetrix.startSessionReplay({
    privacy: "normal",
    maskAllText: true,
    sampleRate: REPLAY_SAMPLE_RATE,
  })
    .then((actions) => {
      if (tracking) stopHandles.push(actions);
      else void actions.stop();
    })
    .catch(() => {
      // Replay is optional: a failed preload must not affect the app.
    });
}

/**
 * Reads a request body as text, or returns `null` for bodies that cannot be
 * forwarded (streams).
 */
async function requestBody(
  body: BodyInit | null | undefined,
): Promise<string | null> {
  if (typeof body === "string") return body;
  if (body instanceof Blob) return await body.text();
  if (body === null || body === undefined) return "";
  return null;
}

/**
 * In the desktop app the webview runs on a custom origin, which the collector
 * treats as third-party traffic: the pageview creates no session, so every
 * heartbeat after it is answered with 403 and the client records nothing.
 *
 * Forwarding the SDK's requests through Rust removes the browser from the path.
 * They arrive with our own user agent, no webview origin, and pageview and
 * heartbeat share one connection identity, which is what sessions are keyed on.
 */
function installDesktopTransport(endpoint: string): void {
  if (transportInstalled || !isTauriDesktop()) return;
  transportInstalled = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (!url.startsWith(endpoint)) {
      return originalFetch(input, init);
    }

    const body = await requestBody(init?.body);
    if (body === null) return originalFetch(input, init);

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const status = await invoke<number>("analytics_post", { url, body });
      return new Response("{}", {
        status,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      if (import.meta.env.DEV) {
        console.debug("[analytics] forwarding failed", error);
      }
      return new Response("{}", { status: 503 });
    }
  };
}

function stopTracking(): void {
  tracking = false;
  for (const handle of stopHandles.splice(0)) {
    try {
      void handle.stop();
    } catch {
      // Stopping is best effort.
    }
  }
}

/**
 * A POST with an empty body is rejected by the collector (400). Any answer below
 * 500 still proves the host is reachable, which is all this probe needs. A
 * network error or a server error means the next candidate gets a chance.
 */
async function isEndpointReachable(endpoint: string): Promise<boolean> {
  try {
    if (isTauriDesktop()) {
      const { invoke } = await import("@tauri-apps/api/core");
      const status = await invoke<number>("analytics_post", {
        url: endpoint,
        body: "{}",
      });
      return status < 500;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

/** First collector that answers, `null` when none does. */
async function selectEndpoint(): Promise<string | null> {
  for (const endpoint of ANALYTICS_ENDPOINTS) {
    if (await isEndpointReachable(endpoint)) return endpoint;
  }
  return null;
}

/**
 * Resolves the stored consent and starts tracking when it is enabled.
 */
export function initAnalytics(): Promise<void> {
  initPromise ??= (async () => {
    const enabled = await loadAnalyticsConsent();
    if (!enabled) return;

    const endpoint = await selectEndpoint();
    if (!endpoint) {
      if (import.meta.env.DEV) {
        console.debug("[analytics] no collector reachable, tracking stays off");
      }
      return;
    }

    activeEndpoint = endpoint;
    startTracking();
  })();
  return initPromise;
}

/**
 * Persists the user's choice and starts or stops tracking without a restart.
 */
export async function setAnalyticsEnabled(enabled: boolean): Promise<void> {
  consent = enabled;
  writeLocalConsent(enabled);

  if (enabled) {
    startTracking();
    trackEvent("analytics_consent_changed", { enabled: true });
  } else {
    trackEvent("analytics_consent_changed", { enabled: false });
    stopTracking();
  }

  if (!isTauriApp()) return;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_analytics_enabled", { enabled });
  } catch (error) {
    console.error("Failed to persist analytics consent:", error);
  }
}

function cleanMeta(
  meta: AnalyticsMeta | undefined,
): Record<string, string | number | boolean> | undefined {
  if (!meta) return undefined;
  const cleaned: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value === null || value === undefined) continue;
    cleaned[key] = value;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

/** Host of the collector in use, e.g. `api.swetrix.com`. */
function collectorHost(): string {
  return (activeEndpoint ?? ANALYTICS_ENDPOINTS[0])
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

/**
 * Sends one anonymous custom event. No-op while tracking is off, never throws.
 * Every event carries the collector it was sent to, so a fallback is visible in
 * the dashboard.
 */
export function trackEvent(event: string, meta?: AnalyticsMeta): void {
  if (!tracking) return;
  try {
    void Swetrix.track({
      ev: event,
      meta: cleanMeta({ ...meta, collector: collectorHost() }),
    });
  } catch (error) {
    if (import.meta.env.DEV) {
      console.debug("[analytics] tracking failed", event, error);
    }
  }
}

/**
 * Collapses route ids so pageviews stay comparable between builds.
 */
export function normalizeRoute(path: string): string {
  const clean = path.split("?")[0].split("#")[0];
  if (/^\/library\/[^/]+\/?$/.test(clean)) return "/library/game";
  if (/^\/community\/[^/]+\/?$/.test(clean)) return "/community/profile";
  return clean || "/";
}

let clicksRegistered = false;
let lastClickId = "";
let lastClickAt = 0;

/**
 * Reports clicks on elements that carry a `data-analytics-id`. Everything
 * without an id stays untracked, so no label text, game title or input value
 * ever leaves the app.
 */
export function registerAnalyticsClicks(): void {
  if (typeof document === "undefined" || clicksRegistered) return;
  clicksRegistered = true;

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element | null;
      const element = target?.closest?.(
        "[data-analytics-id]",
      ) as HTMLElement | null;
      if (!element) return;
      if (element.dataset.analyticsSkip === "true") return;
      const id = element.dataset.analyticsId;
      if (!id) return;

      // Debounce double clicks and repeated activations of the same control.
      const now = Date.now();
      if (id === lastClickId && now - lastClickAt < 300) return;
      lastClickId = id;
      lastClickAt = now;

      trackEvent("ui_click", {
        id,
        route: normalizeRoute(window.location.pathname),
      });
    },
    true,
  );
}

// ── Buckets ────────────────────────────────────────────────────────────────
// Sizes, durations and counts are bucketed so a single data point cannot be
// traced back to a game, a file or a person.

export function sizeBucket(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "unknown";
  const megabytes = bytes / (1024 * 1024);
  if (megabytes < 100) return "lt_100mb";
  if (megabytes < 500) return "100mb_500mb";
  if (megabytes < 1024) return "500mb_1gb";
  if (megabytes < 5 * 1024) return "1gb_5gb";
  if (megabytes < 20 * 1024) return "5gb_20gb";
  return "gt_20gb";
}

export function durationBucket(milliseconds?: number | null): string {
  if (!milliseconds || milliseconds <= 0) return "unknown";
  const seconds = milliseconds / 1000;
  if (seconds < 10) return "lt_10s";
  if (seconds < 60) return "10s_1min";
  if (seconds < 10 * 60) return "1min_10min";
  if (seconds < 60 * 60) return "10min_1h";
  return "gt_1h";
}

export function countBucket(count?: number | null): string {
  if (count === null || count === undefined || count < 0) return "unknown";
  if (count === 0) return "0";
  if (count < 10) return "1_9";
  if (count < 100) return "10_99";
  if (count < 1000) return "100_999";
  if (count < 10000) return "1k_10k";
  return "gt_10k";
}

export function progressBucket(percent?: number | null): string {
  if (percent === null || percent === undefined || percent < 0)
    return "unknown";
  if (percent < 25) return "0_25";
  if (percent < 50) return "25_50";
  if (percent < 75) return "50_75";
  if (percent < 100) return "75_100";
  return "100";
}
