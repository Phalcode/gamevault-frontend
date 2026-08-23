/**
 * Web Gamepad API input layer.
 *
 * Polls `navigator.getGamepads()` on every animation frame (the Gamepad API
 * has no push events for button state) and turns the raw state into discrete,
 * app-friendly frames:
 *   - `direction` is a discrete step (rising edge or hold repeat), so callers
 *     move focus exactly once per step instead of once per frame.
 *   - `scrollX`/`scrollY` are continuous right-stick values in [-1, 1].
 *   - `justPressed`/`pressed` are action sets for edge/level detection.
 *
 * Standard (Xbox-style) mapping: A=0, B=1, X=2, Y=3, LB=4, RB=5,
 * Select=8, Start=9, D-pad=12..15, left stick=axes 0..1, right stick=2..3.
 */

const DEADZONE = 0.3;
const SCROLL_DEADZONE = 0.15;
const REPEAT_DELAY_MS = 400;
const REPEAT_INTERVAL_MS = 120;

export type GamepadDirection = "up" | "down" | "left" | "right";

export type GamepadAction =
  "a" | "b" | "x" | "y" | "lb" | "rb" | "select" | "start";

export interface GamepadFrame {
  /** Discrete directional step (rising edge or hold repeat); null = no step. */
  direction: GamepadDirection | null;
  /** Right-stick scroll values in [-1, 1]; 0 = neutral. */
  scrollX: number;
  scrollY: number;
  /** Actions whose rising edge occurred this frame. */
  justPressed: ReadonlySet<GamepadAction>;
  /** Actions currently held. */
  pressed: ReadonlySet<GamepadAction>;
}

type FrameCallback = (frame: GamepadFrame) => void;
type ConnectionCallback = (connected: boolean) => void;

const ACTION_BY_BUTTON: Record<number, GamepadAction> = {
  0: "a",
  1: "b",
  2: "x",
  3: "y",
  4: "lb",
  5: "rb",
  8: "select",
  9: "start",
};

const DIRECTION_BY_DPAD_BUTTON: Record<number, GamepadDirection> = {
  12: "up",
  13: "down",
  14: "left",
  15: "right",
};

let frameSubscribers = new Set<FrameCallback>();
let connectionSubscribers = new Set<ConnectionCallback>();
let rafId: number | null = null;
let running = false;
let connected = false;

// Input state carried between frames.
let prevPressed = new Set<GamepadAction>();
let prevDirection: GamepadDirection | null = null;
let directionHeldSince = 0;
let lastRepeatAt = 0;
let awaitingFirstRepeat = false;

function getGamepad(): Gamepad | null {
  try {
    const pads = navigator.getGamepads();
    for (const pad of pads) {
      if (pad && pad.connected) return pad;
    }
  } catch {
    // Gamepad API unavailable
  }
  return null;
}

function axisWithDeadzone(value: number | undefined, deadzone: number): number {
  const v = value ?? 0;
  if (Number.isNaN(v) || Math.abs(v) < deadzone) return 0;
  return ((Math.abs(v) - deadzone) / (1 - deadzone)) * Math.sign(v);
}

function resolveDirection(gamepad: Gamepad): GamepadDirection | null {
  // D-pad wins over the left stick.
  for (const [indexStr, direction] of Object.entries(
    DIRECTION_BY_DPAD_BUTTON,
  )) {
    if (gamepad.buttons[Number(indexStr)]?.pressed) return direction;
  }
  const x = axisWithDeadzone(gamepad.axes[0], DEADZONE);
  const y = axisWithDeadzone(gamepad.axes[1], DEADZONE);
  if (x === 0 && y === 0) return null;
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? "right" : "left";
  return y > 0 ? "down" : "up";
}

function resolvePressed(gamepad: Gamepad): Set<GamepadAction> {
  const pressed = new Set<GamepadAction>();
  for (const [indexStr, action] of Object.entries(ACTION_BY_BUTTON)) {
    if (gamepad.buttons[Number(indexStr)]?.pressed) pressed.add(action);
  }
  return pressed;
}

function tick() {
  rafId = requestAnimationFrame(tick);

  const gamepad = getGamepad();
  if (!gamepad) return;

  const now = performance.now();

  // Discrete directional steps (rising edge + hold repeat).
  let step: GamepadDirection | null = null;
  const direction = resolveDirection(gamepad);
  if (direction !== null) {
    if (direction !== prevDirection) {
      step = direction; // rising edge
      directionHeldSince = now;
      lastRepeatAt = now;
      awaitingFirstRepeat = true;
    } else if (awaitingFirstRepeat) {
      if (now - directionHeldSince >= REPEAT_DELAY_MS) {
        step = direction;
        awaitingFirstRepeat = false;
        lastRepeatAt = now;
      }
    } else if (now - lastRepeatAt >= REPEAT_INTERVAL_MS) {
      step = direction;
      lastRepeatAt = now;
    }
  }
  prevDirection = direction;

  // Button edge detection.
  const pressed = resolvePressed(gamepad);
  const justPressed = new Set<GamepadAction>();
  for (const action of pressed) {
    if (!prevPressed.has(action)) justPressed.add(action);
  }
  prevPressed = pressed;

  const frame: GamepadFrame = {
    direction: step,
    scrollX: axisWithDeadzone(gamepad.axes[2], SCROLL_DEADZONE),
    scrollY: axisWithDeadzone(gamepad.axes[3], SCROLL_DEADZONE),
    justPressed,
    pressed,
  };

  for (const subscriber of frameSubscribers) {
    subscriber(frame);
  }
}

function notifyConnection(value: boolean) {
  if (connected === value) return;
  connected = value;
  for (const subscriber of connectionSubscribers) {
    subscriber(value);
  }
}

function handleConnected() {
  notifyConnection(true);
}

function handleDisconnected() {
  if (!getGamepad()) notifyConnection(false);
}

/** Start polling for gamepad input. Idempotent; pairs with `stopGamepadInput`. */
export function startGamepadInput(): void {
  if (running) return;
  if (typeof navigator === "undefined" || !navigator.getGamepads) return;
  running = true;
  window.addEventListener("gamepadconnected", handleConnected);
  window.addEventListener("gamepaddisconnected", handleDisconnected);
  notifyConnection(getGamepad() !== null);
  rafId = requestAnimationFrame(tick);
}

/** Stop polling and reset state. */
export function stopGamepadInput(): void {
  if (!running) return;
  running = false;
  window.removeEventListener("gamepadconnected", handleConnected);
  window.removeEventListener("gamepaddisconnected", handleDisconnected);
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  prevPressed = new Set();
  prevDirection = null;
  awaitingFirstRepeat = false;
  connected = false;
}

/** Subscribe to input frames. Returns an unsubscribe function. */
export function subscribeGamepadInput(onFrame: FrameCallback): () => void {
  frameSubscribers.add(onFrame);
  return () => frameSubscribers.delete(onFrame);
}

/** Subscribe to connection-state changes. Returns an unsubscribe function. */
export function subscribeGamepadConnection(
  onChange: ConnectionCallback,
): () => void {
  connectionSubscribers.add(onChange);
  return () => connectionSubscribers.delete(onChange);
}

/** Whether at least one gamepad is currently connected. */
export function isGamepadConnected(): boolean {
  return connected || getGamepad() !== null;
}
