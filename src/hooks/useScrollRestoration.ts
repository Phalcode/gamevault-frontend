import { useEffect, useRef } from "react";

/**
 * Persists and restores the scroll position of `[data-scroll-container]`
 * across React Router navigations.
 *
 * - Saves on every scroll event (debounced via rAF) — never in cleanup,
 *   so React StrictMode's simulated unmount-remount cannot corrupt the value.
 * - Restores once `readySignal` turns truthy (e.g. when list items are in
 *   the DOM) using `setTimeout(0)` so it survives StrictMode's effect
 *   cancel/reschedule cycle.
 *
 * @param storageKey  Unique sessionStorage key per page (e.g. "library_scroll")
 * @param readySignal Set to `true` when the scrollable content is mounted
 */
export function useScrollRestoration(
  storageKey: string,
  readySignal: boolean,
) {
  const restoredRef = useRef(false);

  // ── 1. Save on scroll events ──────────────────────────────────────────
  useEffect(() => {
    const el = document.querySelector(
      "[data-scroll-container]",
    ) as HTMLElement | null;
    if (!el) return;

    // Throttle the synchronous `sessionStorage` write. `sessionStorage.setItem`
    // blocks the main thread, and a held/drifting controller stick can scroll
    // this container on every animation frame for an unbounded amount of time —
    // writing the position 60×/s in that situation keeps the UI busy for as
    // long as the container moves. A trailing timer still persists the final
    // position shortly after scrolling stops.
    const WRITE_INTERVAL_MS = 150;
    let rafId = 0;
    let trailingTimer = 0;
    let lastWriteAt = 0;

    const write = () => {
      lastWriteAt = performance.now();
      sessionStorage.setItem(storageKey, String(el.scrollTop));
    };

    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const now = performance.now();
        if (now - lastWriteAt >= WRITE_INTERVAL_MS) {
          if (trailingTimer) {
            window.clearTimeout(trailingTimer);
            trailingTimer = 0;
          }
          write();
          return;
        }
        if (!trailingTimer) {
          trailingTimer = window.setTimeout(() => {
            trailingTimer = 0;
            write();
          }, WRITE_INTERVAL_MS);
        }
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(rafId);
      if (trailingTimer) window.clearTimeout(trailingTimer);
      el.removeEventListener("scroll", onScroll);
    };
  }, [storageKey]);

  // ── 2. Restore once content is in the DOM ────────────────────────────
  useEffect(() => {
    if (restoredRef.current || !readySignal) return;

    const el = document.querySelector(
      "[data-scroll-container]",
    ) as HTMLElement | null;
    if (!el) return;

    const raw = sessionStorage.getItem(storageKey);
    const target = raw ? Number(raw) : 0;

    if (target <= 0) {
      restoredRef.current = true;
      return;
    }

    // setTimeout(0): runs after the current render commit and survives
    // StrictMode's cleanup-cancel cycle (second mount will reschedule it).
    const id = setTimeout(() => {
      el.scrollTop = target;
      restoredRef.current = true;
    }, 0);

    return () => clearTimeout(id);
  }, [readySignal, storageKey]);
}
