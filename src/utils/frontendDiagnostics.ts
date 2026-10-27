import { isTauriApp } from "./tauri";

/**
 * Frontend diagnostics feed for the native watchdog.
 *
 * Pairs with `src-tauri/src/frontend_watchdog.rs`. A frozen webview cannot log
 * its own freeze, so instead of relying on `console` output this module posts a
 * small heartbeat to Rust every couple of seconds with everything needed to
 * explain a hang after the fact:
 *
 *   - the current route and window visibility,
 *   - the longest main-thread block since the previous heartbeat,
 *   - the JS heap size (Chromium exposes `performance.memory`),
 *   - the DOM element and `<img>` counts (a growth indicator),
 *   - a bounded ring of breadcrumbs (route changes, long tasks, uncaught
 *     errors, unhandled rejections, main-thread blocks).
 *
 * The Rust watchdog notices when the heartbeats stop and writes the last state
 * to the normal app log, so a freeze leaves a timeline behind. All of this is
 * best-effort and desktop-only: every failure is swallowed so diagnostics can
 * never break the app.
 */

/** How often to check in with the watchdog. */
const HEARTBEAT_MS = 2_000;
const MAX_BREADCRUMBS = 40;
/** How many recent breadcrumbs to include in one heartbeat. */
const BREADCRUMBS_SENT = 25;
/** A frame gap at least this long is reported as a main-thread block. */
const LAG_REPORT_MS = 250;
/** Long tasks shorter than this are ignored (too noisy to be useful). */
const LONG_TASK_MIN_MS = 250;

const breadcrumbs: string[] = [];
let started = false;
let seq = 0;
/**
 * Whether the detailed feed (breadcrumbs + long-task observation) is recorded.
 *
 * Off by default; toggled by the "Verbose diagnostics logging" Developer Tools
 * setting. The heartbeat itself always runs — it is what lets the native
 * watchdog notice an unresponsive interface and recover it — and the small
 * route/visibility/lag/heap/DOM numbers are always reported, so a hang is still
 * described even with verbosity off. Only the (chattier) breadcrumb trail and
 * the long-task observer are opt-in.
 */
let verbose = false;
/** Whether the long-task observer has been attached. */
let longTasksObserved = false;
/** Longest frame gap observed since the previous heartbeat (ms). */
let maxLagMs = 0;
/** Timestamp of the previous animation frame; 0 = no valid baseline yet. */
let lastFrameAt = 0;
let lastRoute = "";

/** Enables or disables the detailed diagnostics feed at runtime. */
export function setDiagnosticsVerbose(enabled: boolean): void {
  verbose = enabled;
  if (enabled) {
    watchLongTasks();
  } else {
    // Drop the trail so a later report never carries stale verbosity.
    breadcrumbs.length = 0;
  }
}

/** Records a breadcrumb that will travel with the next heartbeats. */
export function recordBreadcrumb(label: string, detail?: string): void {
  if (!started || !verbose) return;
  breadcrumbs.push(detail ? `${label}: ${detail}` : label);
  if (breadcrumbs.length > MAX_BREADCRUMBS) {
    breadcrumbs.splice(0, breadcrumbs.length - MAX_BREADCRUMBS);
  }
}

function currentRoute(): string {
  return `${window.location.pathname}${window.location.hash}`;
}

/** Sends one heartbeat. `forceHidden` marks a normal close/reload as not-a-hang. */
async function sendHeartbeat(forceHidden = false): Promise<void> {
  if (!isTauriApp()) return;

  const route = currentRoute();
  if (route !== lastRoute) {
    lastRoute = route;
    recordBreadcrumb("route", route);
  }

  const lagMs = Math.round(maxLagMs);
  maxLagMs = 0;
  if (lagMs >= LAG_REPORT_MS) {
    recordBreadcrumb("main-thread block", `${lagMs}ms`);
  }

  const memory = (
    performance as unknown as {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
    }
  ).memory;
  const toMb = (bytes: number | undefined) =>
    typeof bytes === "number" ? Number((bytes / 1048576).toFixed(1)) : null;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("frontend_heartbeat", {
      status: {
        visibility:
          forceHidden || document.visibilityState === "hidden"
            ? "hidden"
            : "visible",
        route,
        seq: ++seq,
        maxLagMs: lagMs,
        heapUsedMb: toMb(memory?.usedJSHeapSize),
        heapTotalMb: toMb(memory?.totalJSHeapSize),
        domNodes: document.getElementsByTagName("*").length,
        imgCount: document.images.length,
        breadcrumbs: breadcrumbs.slice(-BREADCRUMBS_SENT),
      },
    });
  } catch {
    // Diagnostics must never surface an error to the app.
  }
}

/** Measures the gap between animation frames (paused while the window is hidden). */
function monitorFrames(): void {
  const onFrame = (timestamp: number) => {
    requestAnimationFrame(onFrame);
    if (lastFrameAt !== 0) {
      const delta = timestamp - lastFrameAt;
      if (delta > maxLagMs) maxLagMs = delta;
    }
    lastFrameAt = timestamp;
  };
  requestAnimationFrame(onFrame);
}

/** Records long main-thread tasks where the platform supports them. */
function watchLongTasks(): void {
  if (longTasksObserved) return;
  longTasksObserved = true;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration >= LONG_TASK_MIN_MS) {
          recordBreadcrumb("long task", `${Math.round(entry.duration)}ms`);
        }
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
  } catch {
    // `longtask` is Chromium-only; harmless where unsupported.
  }
}

/** Starts the diagnostics feed. Idempotent, desktop-only, never throws. */
export function startFrontendDiagnostics(): void {
  if (started) return;
  if (!isTauriApp()) return;
  if (typeof window === "undefined" || typeof document === "undefined") return;

  started = true;
  lastRoute = currentRoute();
  recordBreadcrumb("diagnostics started", lastRoute);

  document.addEventListener("visibilitychange", () => {
    // A hidden window pauses rAF, so the first delta after resuming would look
    // like a multi-second block; drop the stale baseline.
    lastFrameAt = 0;
    recordBreadcrumb("visibility", document.visibilityState);
    void sendHeartbeat();
  });

  // Best-effort final check-in so a normal close or reload is not reported as
  // an unresponsive frontend.
  window.addEventListener("pagehide", () => {
    void sendHeartbeat(true);
  });

  window.addEventListener("error", (event) => {
    recordBreadcrumb("uncaught error", event.message || "unknown");
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    recordBreadcrumb(
      "unhandled rejection",
      reason instanceof Error ? reason.message : String(reason),
    );
  });

  monitorFrames();

  window.setInterval(() => void sendHeartbeat(), HEARTBEAT_MS);

  // Adopt the persisted verbosity setting, then start reporting. Best-effort:
  // a failure just leaves the detailed feed off.
  void (async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      setDiagnosticsVerbose(await invoke<boolean>("get_diagnostics_verbose"));
    } catch {
      // Keep the default (off).
    }
    void sendHeartbeat();
  })();
}