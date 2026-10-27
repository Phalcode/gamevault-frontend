/**
 * Helpers for page-level `Escape` handling.
 *
 * Page-level handlers (Settings drill-down, GameView, ...) use these to make
 * sure ESC closes an open Headless UI overlay (dialog/popover/listbox/menu)
 * or cancels inline editing first, instead of navigating away underneath it.
 */

/** Returns true when a Headless UI overlay is currently open. */
export function hasOpenOverlay(): boolean {
  if (typeof document === "undefined") return false;
  return (
    document.querySelector('[data-headlessui-state="open"]') !== null ||
    document.querySelector('[role="dialog"]') !== null
  );
}

/** Returns true when the event originates from an editable control. */
export function isEditableTarget(event: Event): boolean {
  const target = event.target;
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable)
  );
}
