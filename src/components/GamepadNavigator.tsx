import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import {
  pulseGamepad,
  subscribeGamepadInput,
  type GamepadDirection,
  type GamepadFrame,
} from "@/utils/gamepad";
import { countBucket, trackEvent } from "@/utils/analytics";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

const GAMEPAD_FOCUS_CLASS = "gv-gamepad-focus";
const GAMEPAD_MODE_CLASS = "gv-gamepad-mode";
const GROUP_SELECTOR = "[data-gamepad-group]";
// Right-stick scrolling is per second, not per frame, so a 120 Hz display does
// not scroll twice as fast as a 60 Hz one.
const SCROLL_PX_PER_SECOND = 1500;
const PAGE_SCROLL_FRACTION = 0.8;

const OPEN_POPOVER_SELECTOR = [
  '[role="listbox"][data-headlessui-state="open"]',
  '[role="menu"][data-headlessui-state="open"]',
].join(", ");

type ScopeKind = "document" | "dialog" | "popover";
interface Scope {
  kind: ScopeKind;
  root: HTMLElement | Document;
}

function isVisible(element: Element): boolean {
  // A focusable element is only a valid navigation target when it AND every
  // ancestor up to <body> actually render. Ancestor visibility is checked via
  // computed display/visibility/opacity — not box size: HeadlessUI wraps its
  // floating panels and dialogs in zero-size portal containers, so a zero-box
  // ancestor must not hide the (absolutely positioned) element inside it.
  // An `inert` ancestor is a cached route page that is not on screen.
  if (element.closest("[inert]")) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  let node: HTMLElement | null = element as HTMLElement;
  while (node && node !== document.body) {
    if (node.hasAttribute("role")) {
      const role = node.getAttribute("role");
      if (role === "dialog" || role === "alertdialog") break;
    }
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    const opacity = Number.parseFloat(style.opacity);
    if (!Number.isNaN(opacity) && opacity <= 0) return false;
    node = node.parentElement;
  }
  return true;
}

/**
 * Collect the focus stops the D-pad may land on.
 *
 * A `[data-gamepad-group]` (a game card, for example) counts as ONE stop: the
 * card itself. Its inner buttons are overlay actions that only appear on focus;
 * putting them into the spatial grid would make the ring jump onto a 44px star
 * button between two cards. They stay reachable through the X action instead
 * (see `cycleGroupActions`).
 */
function collectFocusables(scope: HTMLElement | Document): HTMLElement[] {
  const focusables: HTMLElement[] = [];
  const seenGroups = new Set<HTMLElement>();
  scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR).forEach((element) => {
    if (!isVisible(element) || element.closest('[aria-hidden="true"]')) return;
    if (!isAppElement(element)) return;
    const group = element.closest<HTMLElement>(GROUP_SELECTOR);
    if (group) {
      if (seenGroups.has(group)) return;
      seenGroups.add(group);
      const primary = getGroupPrimary(group);
      if (primary) focusables.push(primary);
      return;
    }
    focusables.push(element);
  });
  return focusables;
}

/** All usable focus targets inside one grouped component, in DOM order. */
function getGroupFocusables(group: HTMLElement): HTMLElement[] {
  return Array.from(
    group.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      isVisible(element) &&
      !element.closest('[aria-hidden="true"]') &&
      isAppElement(element),
  );
}

/** The group's main target (the card link), which is always its first stop. */
function getGroupPrimary(group: HTMLElement): HTMLElement | null {
  return getGroupFocusables(group)[0] ?? null;
}

/** Whether the element is one of a group's overlay actions, not its main target. */
function isSecondaryFocusable(element: HTMLElement): boolean {
  const group = element.closest<HTMLElement>(GROUP_SELECTOR);
  if (!group) return false;
  const primary = getGroupPrimary(group);
  return primary !== null && primary !== element;
}

/** Text fields need a keyboard; they are poor automatic focus targets. */
function isTextEntry(element: HTMLElement): boolean {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    element.isContentEditable
  );
}

/** Elements the gamepad ring may be drawn around. */
function isNavigationTarget(element: HTMLElement): boolean {
  if (element.matches(FOCUSABLE_SELECTOR)) return true;
  const role = element.getAttribute("role");
  return role === "menuitem" || role === "option";
}

function scrollBehavior(): ScrollBehavior {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";
  } catch {
    return "auto";
  }
}

/**
 * Whether an element belongs to the application. Browser extensions (e.g.
 * password managers like Bitwarden) inject autofill popups directly into the
 * document, outside the app's `#root` and its HeadlessUI portals; those are
 * not legitimate focus targets for the gamepad.
 */
function isAppElement(element: Element): boolean {
  const root = document.getElementById("root");
  if (root && (element === root || root.contains(element))) return true;
  return (
    element.closest(
      '[data-headlessui-portal], [data-headlessui-state="open"]',
    ) !== null
  );
}

/**
 * Selectable options inside an open menu/listbox. Navigation moves focus
 * directly between these (HeadlessUI v2 ignores synthetic key events on its
 * floating panels, so dispatching ArrowUp/Down there does not move the active
 * option). Focusing an option also drives the `data-focus`/`data-active`
 * visual state, so the current item stays visible.
 */
function collectPopoverItems(root: HTMLElement): HTMLElement[] {
  const items = Array.from(
    root.querySelectorAll<HTMLElement>('[role="menuitem"], [role="option"]'),
  );
  return items.filter(
    (element) => !element.hasAttribute("disabled") && isVisible(element),
  );
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
      OPEN_POPOVER_SELECTOR,
    );
    for (const popover of popovers) {
      if (isVisible(popover)) return { kind: "popover", root: popover };
    }
  }
  // HeadlessUI renders the dialog ROOT as a zero-size element (its backdrop
  // and panel children are position:fixed, so the root has no geometry of its
  // own). Openness is therefore detected via state attributes, not size.
  const dialogs = document.querySelectorAll<HTMLElement>(
    '[role="dialog"], [role="alertdialog"]',
  );
  for (const dialog of dialogs) {
    if (dialog.getAttribute("data-headlessui-state") === "open") {
      return { kind: "dialog", root: dialog };
    }
    // Non-HeadlessUI dialogs (e.g. a native <dialog open>): fall back to
    // geometry-based visibility.
    if (!dialog.hasAttribute("data-headlessui-state") && isVisible(dialog)) {
      return { kind: "dialog", root: dialog };
    }
  }
  const popovers = document.querySelectorAll<HTMLElement>(
    OPEN_POPOVER_SELECTOR,
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
 *
 * With `relaxed`, the perpendicular band limit is dropped; this keeps a press
 * from silently doing nothing (or worse, falling back to DOM order and moving
 * vertically) when the next target is farther away perpendicularly — e.g.
 * jumping from the left sidebar into the page content.
 */
function pickSpatial(
  from: HTMLElement,
  candidates: HTMLElement[],
  direction: GamepadDirection,
  relaxed = false,
): HTMLElement | null {
  const fromRect = from.getBoundingClientRect();
  const fromCenterX = fromRect.left + fromRect.width / 2;
  const fromCenterY = fromRect.top + fromRect.height / 2;
  const horizontal = direction === "left" || direction === "right";

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

    const primary = horizontal ? Math.abs(dx) : Math.abs(dy);
    const secondary = horizontal ? Math.abs(dy) : Math.abs(dx);
    const distance = Math.hypot(dx, dy) || primary;

    // Overlap on the perpendicular axis: cards in the same row/column overlap
    // fully. Together with the alignment ratio this keeps the ring inside the
    // grid instead of drifting diagonally into a neighbouring column.
    const overlap = horizontal
      ? overlapLength(fromRect.top, fromRect.bottom, rect.top, rect.bottom)
      : overlapLength(fromRect.left, fromRect.right, rect.left, rect.right);
    const alignment = primary / distance;
    const band = horizontal
      ? Math.min(fromRect.height, rect.height)
      : Math.min(fromRect.width, rect.width);
    if (!relaxed && overlap === 0 && secondary > band) continue;

    // Prefer close, aligned targets; a full perpendicular overlap is the
    // strongest signal that the target is the intended neighbour.
    const score =
      distance * (1 + (1 - alignment) * 1.8) - Math.min(overlap, band) * 0.6;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

function overlapLength(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
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
    // Where the ring was last parked on each route, so returning from a game
    // page lands on the card that was opened instead of the first item.
    const focusMemory = new Map<string, HTMLElement>();
    let lastPath = window.location.pathname;

    const clearRing = () => {
      gamepadFocusRef.current?.classList.remove(GAMEPAD_FOCUS_CLASS);
      gamepadFocusRef.current = null;
    };

    // Console mode hides the mouse cursor while the controller is the active
    // input device. Any real mouse/trackpad movement brings it back.
    const enterGamepadMode = () => {
      document.documentElement.classList.add(GAMEPAD_MODE_CLASS);
    };
    const exitGamepadMode = () => {
      document.documentElement.classList.remove(GAMEPAD_MODE_CLASS);
    };
    let lastPointerX = 0;
    let lastPointerY = 0;
    const handlePointerMove = (event: MouseEvent) => {
      const moved =
        Math.abs(event.clientX - lastPointerX) +
        Math.abs(event.clientY - lastPointerY);
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      if (moved > 4) exitGamepadMode();
    };
    window.addEventListener("pointerdown", exitGamepadMode, true);
    window.addEventListener("mousemove", handlePointerMove, true);

    // The ring follows the real focus, not only the element the D-pad moved
    // to. Dialogs, HeadlessUI popovers and browser-driven focus changes then
    // keep exactly one ring on screen, and focus returning to a trigger after
    // a menu closes is highlighted again without another button press.
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!document.documentElement.classList.contains(GAMEPAD_MODE_CLASS)) {
        return;
      }
      if (!isAppElement(target) || !isNavigationTarget(target)) return;
      const previous = gamepadFocusRef.current;
      if (previous && previous !== target) {
        previous.classList.remove(GAMEPAD_FOCUS_CLASS);
      }
      target.classList.add(GAMEPAD_FOCUS_CLASS);
      gamepadFocusRef.current = target;
    };
    window.addEventListener("focusin", handleFocusIn, true);

    const handleFocusOut = (event: FocusEvent) => {
      const current = gamepadFocusRef.current;
      if (!current || event.target !== current) return;
      const next = event.relatedTarget;
      if (next instanceof Element && isAppElement(next)) {
        // Focus moved within the app: `handleFocusIn` moves the ring.
        return;
      }
      const movedToBody =
        next === null ||
        next === document.body ||
        next === document.documentElement;
      if (movedToBody) {
        clearRing();
        return;
      }
      // Focus stolen by a non-app element: keep the ring as the anchor. The
      // next D-pad press / A reclaims focus and resumes from here.
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

    function rememberFocus(element: HTMLElement): void {
      // Dialog and popover contents are transient; remembering one of their
      // buttons would become the return target when the page is revisited.
      if (
        element.closest(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
        )
      ) {
        return;
      }
      focusMemory.set(lastPath, element);
    }

    function setGamepadFocus(element: HTMLElement): void {
      if (element !== gamepadFocusRef.current) {
        gamepadFocusRef.current?.classList.remove(GAMEPAD_FOCUS_CLASS);
      }
      element.focus({ preventScroll: true });
      element.classList.add(GAMEPAD_FOCUS_CLASS);
      gamepadFocusRef.current = element;
      rememberFocus(element);
      element.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: scrollBehavior(),
      });
    }

    /**
     * Follow a route change. A tab switch keeps the ring on the still-visible
     * sidebar item; leaving a page (a card opened, B pressed) restores the
     * remembered focus target on the next interaction, so going back to the
     * library continues where the user was.
     */
    function syncRoute(): void {
      const path = window.location.pathname;
      if (path === lastPath) return;
      lastPath = path;

      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        isAppElement(active) &&
        isVisible(active) &&
        !active.closest("[inert]")
      ) {
        return;
      }

      const remembered = focusMemory.get(path);
      if (
        remembered &&
        remembered.isConnected &&
        isVisible(remembered) &&
        !isSecondaryFocusable(remembered)
      ) {
        setGamepadFocus(remembered);
        return;
      }
      clearRing();
    }

    function adoptInitialFocus(scope: Scope): void {
      const candidates = collectFocusables(scope.root);
      if (candidates.length === 0) return;
      const current = document.activeElement;
      if (current instanceof HTMLElement && candidates.includes(current))
        return;

      const explicit =
        scope.root instanceof Document
          ? document.querySelector<HTMLElement>("[data-gamepad-default]")
          : (scope.root as HTMLElement).querySelector<HTMLElement>(
              "[data-gamepad-default]",
            );

      let pool = candidates;
      if (scope.root instanceof Document) {
        // The first press should land in the page content, not on chrome
        // like the logo link sitting before `<main>` in the DOM. Pages can
        // still opt into an explicit target via [data-gamepad-default].
        const main = document.querySelector<HTMLElement>("main");
        const mainCandidates = main ? collectFocusables(main) : [];
        if (mainCandidates.length > 0) pool = mainCandidates;
      }

      // Text fields need a keyboard and cannot be "activated" with A, so the
      // first press starts on the first real control instead.
      const target =
        (explicit && candidates.includes(explicit) ? explicit : null) ??
        pool.find((element) => !isTextEntry(element)) ??
        pool[0] ??
        candidates.find((element) => !isTextEntry(element)) ??
        candidates[0];
      if (target) setGamepadFocus(target);
    }

    function moveFocus(direction: GamepadDirection): void {
      syncRoute();
      const scope = detectScope();

      if (scope.kind === "popover") {
        // Move focus between the menu/listbox options directly. HeadlessUI v2
        // keeps its own notion of the active option and does not react to
        // synthetic ArrowUp/Down dispatched on the floating panel, so driving
        // the options through real focus is the only reliable path.
        const root = scope.root as HTMLElement;
        const items = collectPopoverItems(root);
        if (items.length > 0) {
          const current = document.activeElement;
          const index =
            current instanceof HTMLElement ? items.indexOf(current) : -1;
          if (index === -1) {
            // Nothing inside the popover is focused yet — start at an edge.
            setGamepadFocus(
              direction === "up" ? items[items.length - 1] : items[0],
            );
          } else {
            const delta = direction === "down" ? 1 : -1;
            setGamepadFocus(
              items[(index + delta + items.length) % items.length],
            );
          }
          return;
        }
        // No discrete options (unusual popover): fall back to synthetic keys.
        if (direction === "up") dispatchKey("ArrowUp");
        if (direction === "down") dispatchKey("ArrowDown");
        return;
      }

      const candidates = collectFocusables(scope.root);
      if (candidates.length === 0) return;

      let anchor: HTMLElement | null = null;
      const current = document.activeElement;
      if (current instanceof HTMLElement && isSecondaryFocusable(current)) {
        // The ring is on a card's overlay action (opened with X). Directional
        // navigation continues from the card itself, not from the 44px button.
        const group = current.closest<HTMLElement>(GROUP_SELECTOR);
        const primary = group ? getGroupPrimary(group) : null;
        if (primary && candidates.includes(primary)) anchor = primary;
      }
      if (
        !anchor &&
        current instanceof HTMLElement &&
        candidates.includes(current) &&
        isAppElement(current)
      ) {
        anchor = current;
      }
      if (
        !anchor &&
        gamepadFocusRef.current &&
        candidates.includes(gamepadFocusRef.current)
      ) {
        // An external overlay (e.g. password-manager autofill popup) stole
        // focus from the ring element; resume navigation from it instead of
        // resetting to the first focusable.
        anchor = gamepadFocusRef.current;
        setGamepadFocus(anchor);
      }
      if (!anchor) {
        adoptInitialFocus(scope);
        return;
      }

      const next =
        pickSpatial(anchor, candidates, direction) ??
        pickSpatial(anchor, candidates, direction, true) ??
        fallbackDocumentOrder(anchor, candidates, direction);
      if (next) setGamepadFocus(next);
    }

    function activateFocused(): void {
      syncRoute();
      const scope = detectScope();

      if (scope.kind === "popover") {
        const element = document.activeElement;
        if (element instanceof HTMLElement) {
          const role = element.getAttribute("role");
          if (role === "menuitem" || role === "option") {
            // Confirm the currently focused option.
            element.click();
            return;
          }
        }
        // Focus is on the trigger/panel: jump to the first option so the next
        // A confirms it (mirrors a keyboard user pressing Enter to move into
        // the menu rather than closing it).
        const items = collectPopoverItems(scope.root as HTMLElement);
        if (items.length > 0) {
          setGamepadFocus(items[0]);
          return;
        }
        dispatchKey("Enter");
        return;
      }

      const candidates = collectFocusables(scope.root);
      let element = document.activeElement;
      if (
        !(element instanceof HTMLElement) ||
        !candidates.includes(element) ||
        !isAppElement(element)
      ) {
        // Focus is not on one of our targets (stolen by an external overlay):
        // act on the ring element instead.
        element = gamepadFocusRef.current;
      }
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
      // Opening a closed menu/listbox trigger via ArrowDown (as a keyboard
      // user would) keeps focus on the trigger, so the gamepad focus ring
      // stays visible instead of jumping into the panel and being cleared.
      const trigger = element.closest<HTMLElement>("[aria-haspopup]");
      if (trigger && trigger.getAttribute("aria-expanded") !== "true") {
        dispatchKey("ArrowDown");
        return;
      }
      element.click();
    }

    function isScrollable(node: HTMLElement): boolean {
      const style = getComputedStyle(node);
      return (
        /(auto|scroll)/.test(style.overflowY) &&
        node.scrollHeight > node.clientHeight
      );
    }

    function findScrollContainer(): HTMLElement | null {
      const scope = detectScope();
      const active = document.activeElement;

      if (scope.kind === "popover") {
        // Focus stays on the trigger (outside the popover), so only the
        // popover root itself is a valid scroll target.
        const root = scope.root as HTMLElement;
        return isScrollable(root) ? root : null;
      }

      let node = active instanceof HTMLElement ? active.parentElement : null;
      while (node && node !== document.body) {
        if (isScrollable(node)) return node;
        node = node.parentElement;
      }

      if (scope.kind === "dialog") {
        // Never scroll page content behind an open dialog.
        return null;
      }
      return document.querySelector<HTMLElement>("[data-scroll-container]");
    }

    // A held/drifting right stick drives `scrollFocusedContainer` on every
    // animation frame. `findScrollContainer` runs `detectScope` (several
    // `querySelectorAll` sweeps) and `getComputedStyle` (a forced synchronous
    // reflow), so cache its result briefly instead of re-resolving it 60×/s —
    // otherwise the main thread never gets idle while the stick is anywhere but
    // dead centre.
    let scrollContainerCache: {
      element: HTMLElement | null;
      at: number;
    } | null = null;

    function findScrollContainerCached(): HTMLElement | null {
      const now = performance.now();
      const cached = scrollContainerCache;
      if (cached && now - cached.at < 250) {
        if (!cached.element || cached.element.isConnected)
          return cached.element;
      }
      const element = findScrollContainer();
      scrollContainerCache = { element, at: now };
      return element;
    }

    function scrollFocusedContainer(
      scrollX: number,
      scrollY: number,
      deltaMs: number,
    ): void {
      if (scrollX === 0 && scrollY === 0) return;
      const container = findScrollContainerCached();
      const seconds = Math.min(64, Math.max(1, deltaMs)) / 1000;
      container?.scrollBy({
        top: scrollY * SCROLL_PX_PER_SECOND * seconds,
        left: scrollX * SCROLL_PX_PER_SECOND * seconds,
      });
    }

    function pageScroll(directionSign: 1 | -1): void {
      // Triggers always page the main content, even when the ring currently
      // sits in the sidebar (whose own list would be the nearest scrollable).
      const scope = detectScope();
      const container =
        scope.kind === "document"
          ? (document.querySelector<HTMLElement>("[data-scroll-container]") ??
            findScrollContainer())
          : findScrollContainer();
      if (!container) return;
      container.scrollBy({
        top: directionSign * container.clientHeight * PAGE_SCROLL_FRACTION,
        behavior: scrollBehavior(),
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
      if (active instanceof HTMLElement && isSecondaryFocusable(active)) {
        // B leaves the card's action overlay and returns to the card.
        const group = active.closest<HTMLElement>(GROUP_SELECTOR);
        const primary = group ? getGroupPrimary(group) : null;
        if (primary) {
          setGamepadFocus(primary);
          return;
        }
      }
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement
      ) {
        // Escape cancels inline editing (Settings rename, GameSettings, ...).
        dispatchKey("Escape");
        // Some pages focus a text field on load (login). Escape there is a
        // no-op, so the field would swallow B forever; leave it instead, so
        // the next B can navigate back.
        window.setTimeout(() => {
          if (document.activeElement === active && active.isConnected) {
            active.blur();
            adoptInitialFocus({ kind: "document", root: document });
          }
        }, 0);
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

    // A card is one focus stop; X cycles through its overlay actions (bookmark,
    // settings, play/download) instead of scattering them into the grid.
    function cycleGroupActions(): void {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return;
      const group = active.closest<HTMLElement>(GROUP_SELECTOR);
      if (!group) return;
      const items = getGroupFocusables(group);
      if (items.length < 2) return;
      const index = items.indexOf(active);
      // Entering the group always starts with its first action.
      const nextIndex = index <= 0 ? 1 : (index + 1) % items.length;
      pulseGamepad(0.16, 10);
      setGamepadFocus(items[nextIndex] ?? items[1]);
    }

    function pathOfAnchor(anchor: HTMLElement): string | null {
      const href = anchor.getAttribute("href");
      if (!href || href === "#" || href.startsWith("http")) return null;
      try {
        return new URL(href, window.location.origin).pathname;
      } catch {
        return null;
      }
    }

    function getNavTabs(): HTMLElement[] {
      for (const root of document.querySelectorAll<HTMLElement>(
        "[data-gamepad-tabs]",
      )) {
        const tabs = Array.from(
          root.querySelectorAll<HTMLElement>("a[href]"),
        ).filter(
          (element) =>
            isVisible(element) &&
            isAppElement(element) &&
            pathOfAnchor(element) !== null,
        );
        // The layout renders the sidebar twice (desktop + mobile drawer);
        // only the one on screen is a valid tab strip.
        if (tabs.length > 0) return tabs;
      }
      return [];
    }

    function activeTabIndex(tabs: HTMLElement[]): number {
      const path = window.location.pathname;
      let bestIndex = -1;
      let bestLength = -1;
      tabs.forEach((tab, index) => {
        const tabPath = pathOfAnchor(tab);
        if (!tabPath) return;
        // /library/123 belongs to the Library tab (/library).
        if (path === tabPath || path.startsWith(`${tabPath}/`)) {
          if (tabPath.length > bestLength) {
            bestLength = tabPath.length;
            bestIndex = index;
          }
        }
      });
      return bestIndex;
    }

    function switchTab(delta: 1 | -1): void {
      // Only the page itself has tabs; a dialog or open menu owns the buttons.
      if (detectScope().kind !== "document") return;
      const tabs = getNavTabs();
      if (tabs.length === 0) return;
      const index = activeTabIndex(tabs);
      const nextIndex =
        index === -1
          ? delta > 0
            ? 0
            : tabs.length - 1
          : (index + delta + tabs.length) % tabs.length;
      const next = tabs[nextIndex];
      if (!next) return;
      // Keep the ring on the tab so LB/RB can keep cycling, like a console's
      // shoulder-button tab strip.
      setGamepadFocus(next);
      next.click();
    }

    function toggleNavFocus(): void {
      if (detectScope().kind !== "document") return;
      const active = document.activeElement;
      const navRoot = Array.from(
        document.querySelectorAll<HTMLElement>("[data-gamepad-tabs]"),
      ).find(
        (root) =>
          active instanceof HTMLElement &&
          root.contains(active) &&
          isVisible(root),
      );
      if (navRoot) {
        // Back into the page content.
        const main = document.querySelector<HTMLElement>("main");
        const candidates = main ? collectFocusables(main) : [];
        const target =
          candidates.find((element) => !isTextEntry(element)) ?? candidates[0];
        if (target) setGamepadFocus(target);
        return;
      }
      const tabs = getNavTabs();
      if (tabs.length === 0) return;
      const index = activeTabIndex(tabs);
      setGamepadFocus(tabs[index === -1 ? 0 : index] ?? tabs[0]);
    }

    // One event per session: whether gamepad navigation is used at all is the
    // interesting part, not how often a stick moved.
    let reportedInput = false;
    const mountedAt = Date.now();
    function reportGamepadUse(input: string): void {
      if (reportedInput) return;
      reportedInput = true;
      trackEvent("gamepad_navigation_used", {
        input,
        after_seconds: countBucket(Math.round((Date.now() - mountedAt) / 1000)),
      });
    }

    function handleFrame(frame: GamepadFrame): void {
      const hasActivity =
        frame.direction !== null ||
        frame.justPressed.size > 0 ||
        frame.scrollX !== 0 ||
        frame.scrollY !== 0;
      if (!hasActivity) return;

      enterGamepadMode();

      if (frame.scrollX !== 0 || frame.scrollY !== 0) {
        reportGamepadUse("scroll");
        scrollFocusedContainer(frame.scrollX, frame.scrollY, frame.deltaMs);
      }

      for (const action of frame.justPressed) {
        reportGamepadUse(action);
        switch (action) {
          case "a":
            activateFocused();
            pulseGamepad(0.22, 12);
            break;
          case "b":
            goBack();
            pulseGamepad(0.3, 14);
            break;
          case "x":
            cycleGroupActions();
            break;
          case "lb":
            switchTab(-1);
            break;
          case "rb":
            switchTab(1);
            break;
          case "lt":
            pageScroll(-1);
            break;
          case "rt":
            pageScroll(1);
            break;
          case "start":
            toggleNavFocus();
            pulseGamepad(0.25, 12);
            break;
          // y, select: reserved for future use.
          default:
            break;
        }
      }

      if (frame.direction) {
        reportGamepadUse(frame.direction);
        moveFocus(frame.direction);
      }
    }

    const unsubscribe = subscribeGamepadInput(handleFrame);
    return () => {
      unsubscribe();
      window.removeEventListener("focusin", handleFocusIn, true);
      window.removeEventListener("focusout", handleFocusOut, true);
      window.removeEventListener("pointerdown", exitGamepadMode, true);
      window.removeEventListener("mousemove", handlePointerMove, true);
      window.removeEventListener("keydown", handleKeyDownCapture, true);
      clearRing();
      document.documentElement.classList.remove(GAMEPAD_MODE_CLASS);
    };
  }, []);

  return null;
}
