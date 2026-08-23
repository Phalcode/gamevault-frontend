import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import {
  subscribeGamepadInput,
  type GamepadDirection,
  type GamepadFrame,
} from "@/utils/gamepad";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

const GAMEPAD_FOCUS_CLASS = "gv-gamepad-focus";
const SCROLL_PX_PER_FRAME = 28;
const PAGE_SCROLL_FRACTION = 0.8;

type ScopeKind = "document" | "dialog" | "popover";
interface Scope {
  kind: ScopeKind;
  root: HTMLElement | Document;
}

function isVisible(element: Element): boolean {
  const htmlElement = element as HTMLElement;
  const rect = htmlElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = getComputedStyle(htmlElement);
  return style.visibility !== "hidden" && style.display !== "none";
}

function collectFocusables(scope: HTMLElement | Document): HTMLElement[] {
  const focusables: HTMLElement[] = [];
  scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR).forEach((element) => {
    if (isVisible(element) && !element.closest('[aria-hidden="true"]')) {
      focusables.push(element);
    }
  });
  return focusables;
}

/** Find the innermost open interactive layer (popover > dialog > document). */
function detectScope(): Scope {
  // An open listbox/menu keeps focus on its trigger (aria-expanded="true");
  // handle it before dialogs so popovers inside dialogs still work.
  const active = document.activeElement;
  if (
    active instanceof HTMLElement &&
    active.getAttribute("aria-expanded") === "true"
  ) {
    const popovers = document.querySelectorAll<HTMLElement>(
      '[role="listbox"][data-headlessui-state="open"], [role="menu"][data-headlessui-state="open"]',
    );
    for (const popover of popovers) {
      if (isVisible(popover)) return { kind: "popover", root: popover };
    }
  }
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  for (const dialog of dialogs) {
    if (isVisible(dialog)) return { kind: "dialog", root: dialog };
  }
  const popovers = document.querySelectorAll<HTMLElement>(
    '[role="listbox"][data-headlessui-state="open"], [role="menu"][data-headlessui-state="open"]',
  );
  for (const popover of popovers) {
    if (isVisible(popover)) return { kind: "popover", root: popover };
  }
  return { kind: "document", root: document };
}

/**
 * Pick the best candidate in the given direction. Restricts to elements whose
 * centers lie in the target half-plane and roughly inside the same row/column
 * band, then scores by primary-axis distance plus a perpendicular penalty.
 */
function pickSpatial(
  from: HTMLElement,
  candidates: HTMLElement[],
  direction: GamepadDirection,
): HTMLElement | null {
  const fromRect = from.getBoundingClientRect();
  const fromCenterX = fromRect.left + fromRect.width / 2;
  const fromCenterY = fromRect.top + fromRect.height / 2;

  let best: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (candidate === from) continue;
    const rect = candidate.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const dx = rect.left + rect.width / 2 - fromCenterX;
    const dy = rect.top + rect.height / 2 - fromCenterY;

    if (direction === "left" && dx >= 0) continue;
    if (direction === "right" && dx <= 0) continue;
    if (direction === "up" && dy >= 0) continue;
    if (direction === "down" && dy <= 0) continue;

    const horizontal = direction === "left" || direction === "right";
    const primary = horizontal ? Math.abs(dx) : Math.abs(dy);
    const secondary = horizontal ? Math.abs(dy) : Math.abs(dx);
    const band = horizontal
      ? Math.max(fromRect.height, rect.height)
      : Math.max(fromRect.width, rect.width);
    if (secondary > band) continue;

    const score = primary + secondary * 2;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

function fallbackDocumentOrder(
  current: HTMLElement,
  candidates: HTMLElement[],
  direction: GamepadDirection,
): HTMLElement | null {
  const index = candidates.indexOf(current);
  if (index === -1) return candidates[0] ?? null;
  const nextIndex =
    direction === "down" || direction === "right"
      ? Math.min(index + 1, candidates.length - 1)
      : Math.max(index - 1, 0);
  return candidates[nextIndex] ?? null;
}

/**
 * Global gamepad navigation engine. Rendered once by `GamepadProvider`:
 * turns input frames into focus movement, activation, back handling and
 * scrolling. HeadlessUI popovers/dialogs are driven through synthetic
 * keyboard events so their built-in keyboard semantics stay the source of
 * truth.
 */
export default function GamepadNavigator() {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const gamepadFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // The gamepad focus ring follows the element we focused; remove it as
    // soon as that element loses focus (mouse click elsewhere, blur, removal).
    const handleFocusOut = (event: FocusEvent) => {
      const current = gamepadFocusRef.current;
      if (current && event.target === current) {
        current.classList.remove(GAMEPAD_FOCUS_CLASS);
        gamepadFocusRef.current = null;
      }
    };
    window.addEventListener("focusout", handleFocusOut, true);

    // Popover triggers must only open on an explicit A press. Some setups map
    // gamepad input to real keyboard events (e.g. Steam Input); stray arrow
    // key events from the stick/D-pad would open a focused, closed trigger
    // via HeadlessUI's native keyboard handling. Suppress those here. Enter
    // and Space are deliberately allowed: controller mappings send them for
    // the A button, and they should open the trigger. Untrusted (synthetic)
    // events and elements not focused by the gamepad are exempt.
    const handleKeyDownCapture = (event: KeyboardEvent) => {
      if (!event.isTrusted) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const trigger = target.closest<HTMLElement>("[aria-haspopup]");
      if (!trigger || !trigger.classList.contains(GAMEPAD_FOCUS_CLASS)) return;
      if (trigger.getAttribute("aria-expanded") === "true") return;
      const opensPopover = ["ArrowDown", "ArrowUp"].includes(event.key);
      if (!opensPopover) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", handleKeyDownCapture, true);

    function dispatchKey(key: string): void {
      const target =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : document.body;
      target.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    }

    function setGamepadFocus(element: HTMLElement): void {
      gamepadFocusRef.current?.classList.remove(GAMEPAD_FOCUS_CLASS);
      element.focus({ preventScroll: true });
      element.classList.add(GAMEPAD_FOCUS_CLASS);
      gamepadFocusRef.current = element;
      element.scrollIntoView({ block: "nearest", inline: "nearest" });
    }

    function adoptInitialFocus(scope: Scope): void {
      const candidates = collectFocusables(scope.root);
      if (candidates.length === 0) return;
      const current = document.activeElement;
      if (current instanceof HTMLElement && candidates.includes(current))
        return;
      const defaultElement =
        scope.root instanceof Document
          ? document.querySelector<HTMLElement>("[data-gamepad-default]")
          : null;
      const target =
        defaultElement && candidates.includes(defaultElement)
          ? defaultElement
          : candidates[0];
      setGamepadFocus(target);
    }

    function moveFocus(direction: GamepadDirection): void {
      const scope = detectScope();

      if (scope.kind === "popover") {
        // HeadlessUI keeps focus on the owning button; its keyboard handler
        // moves the active option.
        if (direction === "up") dispatchKey("ArrowUp");
        if (direction === "down") dispatchKey("ArrowDown");
        return;
      }

      const candidates = collectFocusables(scope.root);
      if (candidates.length === 0) return;

      const current = document.activeElement;
      if (!(current instanceof HTMLElement) || !candidates.includes(current)) {
        adoptInitialFocus(scope);
        return;
      }

      const next =
        pickSpatial(current, candidates, direction) ??
        fallbackDocumentOrder(current, candidates, direction);
      if (next) setGamepadFocus(next);
    }

    function activateFocused(): void {
      const scope = detectScope();

      if (scope.kind === "popover") {
        // Enter confirms the active option in a listbox/menu.
        dispatchKey("Enter");
        return;
      }

      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) return;
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      ) {
        // Text entry needs a real keyboard (no virtual keyboard in v1).
        element.focus();
        return;
      }
      element.click();
    }

    function findScrollContainer(): HTMLElement | null {
      let node =
        document.activeElement instanceof HTMLElement
          ? document.activeElement.parentElement
          : null;
      while (node) {
        const style = getComputedStyle(node);
        if (
          /(auto|scroll)/.test(style.overflowY) &&
          node.scrollHeight > node.clientHeight
        ) {
          return node;
        }
        node = node.parentElement;
      }
      return document.querySelector<HTMLElement>("[data-scroll-container]");
    }

    function scrollFocusedContainer(scrollX: number, scrollY: number): void {
      if (scrollX === 0 && scrollY === 0) return;
      const container = findScrollContainer();
      container?.scrollBy({
        top: scrollY * SCROLL_PX_PER_FRAME,
        left: scrollX * SCROLL_PX_PER_FRAME,
      });
    }

    function pageScroll(directionSign: 1 | -1): void {
      const container = findScrollContainer();
      if (!container) return;
      container.scrollBy({
        top: directionSign * container.clientHeight * PAGE_SCROLL_FRACTION,
        behavior: "smooth",
      });
    }

    function goBack(): void {
      const scope = detectScope();

      if (scope.kind !== "document") {
        // Escape closes popovers and dialogs (HeadlessUI listens globally).
        dispatchKey("Escape");
        return;
      }

      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement
      ) {
        // Escape cancels inline editing (Settings rename, GameSettings, ...).
        dispatchKey("Escape");
        return;
      }

      const historyIndex =
        (window.history.state?.idx as number | undefined) ?? 0;
      if (historyIndex > 0) {
        navigateRef.current(-1);
        return;
      }

      // Top of the history stack: jump back to the first focusable element.
      const first = collectFocusables(document)[0];
      if (first) setGamepadFocus(first);
    }

    function handleFrame(frame: GamepadFrame): void {
      if (frame.scrollX !== 0 || frame.scrollY !== 0) {
        scrollFocusedContainer(frame.scrollX, frame.scrollY);
      }

      for (const action of frame.justPressed) {
        switch (action) {
          case "a":
            activateFocused();
            break;
          case "b":
            goBack();
            break;
          case "lb":
            pageScroll(-1);
            break;
          case "rb":
            pageScroll(1);
            break;
          // x, y, select, start: reserved for future use.
          default:
            break;
        }
      }

      if (frame.direction) {
        moveFocus(frame.direction);
      }
    }

    const unsubscribe = subscribeGamepadInput(handleFrame);

    return () => {
      unsubscribe();
      window.removeEventListener("focusout", handleFocusOut, true);
      window.removeEventListener("keydown", handleKeyDownCapture, true);
      gamepadFocusRef.current?.classList.remove(GAMEPAD_FOCUS_CLASS);
      gamepadFocusRef.current = null;
    };
  }, []);

  return null;
}
