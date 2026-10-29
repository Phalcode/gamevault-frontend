import { useEffect, useRef } from "react";
import { usePageIsActive } from "@/context/PageVisibilityContext";

/**
 * Persists and restores the scroll position of `[data-scroll-container]`
 * across React Router navigations.
 *
 * The scroll container belongs to the layout and is shared by every page, so a
 * page only owns its position while it is the visible one:
 *
 * - the position is saved only while the page is active, otherwise scrolling
 *   another page would overwrite it;
 * - it is restored every time the page becomes active again, because the
 *   container kept the other page's position in the meantime.
 *
 * @param storageKey  Unique sessionStorage key per page (e.g. "library_scroll")
 * @param readySignal Set to `true` when the scrollable content is mounted
 */
export function useScrollRestoration(storageKey: string, readySignal: boolean) {
  const isActive = usePageIsActive();
  const activeRef = useRef(isActive);
  activeRef.current = isActive;

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
        // Another page is on screen and owns the container right now.
        if (!activeRef.current) return;
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
            if (activeRef.current) write();
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

  // ── 2. Restore whenever this page becomes the visible one ────────────
  useEffect(() => {
    if (!isActive || !readySignal) return;

    const el = document.querySelector(
      "[data-scroll-container]",
    ) as HTMLElement | null;
    if (!el) return;

    const raw = sessionStorage.getItem(storageKey);
    const target = raw ? Number(raw) : 0;
    if (!(target > 0)) return;

    // setTimeout(0): runs after the current render commit and survives
    // StrictMode's cleanup-cancel cycle (second mount will reschedule it).
    // The frame afterwards re-applies the value in case the page had not been
    // laid out at its full height yet and the first write was clamped.
    let rafId = 0;
    const id = setTimeout(() => {
      el.scrollTop = target;
      rafId = requestAnimationFrame(() => {
        if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target;
      });
    }, 0);

    return () => {
      clearTimeout(id);
      cancelAnimationFrame(rafId);
    };
  }, [isActive, readySignal, storageKey]);
}
