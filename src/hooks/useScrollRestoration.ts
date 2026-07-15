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

    let rafId = 0;
    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        sessionStorage.setItem(storageKey, String(el.scrollTop));
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(rafId);
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
