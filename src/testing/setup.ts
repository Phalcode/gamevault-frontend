import "@testing-library/jest-dom/vitest";

/**
 * jsdom does not implement `ResizeObserver`, which the Headless UI overlays
 * (dropdowns, comboboxes) use to keep an open panel in place.
 */
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
