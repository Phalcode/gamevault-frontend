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
 * LT=6, RT=7, Select=8, Start=9, D-pad=12..15, left stick=axes 0..1,
 * right stick=2..3.
 */

const STICK_DEADZONE = 0.28;
const SCROLL_DEADZONE = 0.12;

// Direction repeat timing. The first press has to feel immediate, then holding
// a direction accelerates: a quick tap nudges the focus ring one step, holding
// the stick glides through a shelf the way console UIs do.
const DPAD_REPEAT_START_MS = 300;
const DPAD_REPEAT_MIN_MS = 55;
const DPAD_REPEAT_MAX_MS = 115;
const STICK_REPEAT_START_MS = 280;
const STICK_REPEAT_MIN_MS = 60;
const STICK_REPEAT_MAX_MS = 170;
const REPEAT_ACCELERATION_MS = 1000;

// Right-stick scrolling is smoothed so releasing the stick coasts to a stop
// instead of snapping the view to a halt.
const SCROLL_SMOOTHING_MS = 55;

export type GamepadDirection = "up" | "down" | "left" | "right";

export type GamepadAction =
  "a" | "b" | "x" | "y" | "lb" | "rb" | "lt" | "rt" | "select" | "start";

export interface GamepadFrame {
  /** Discrete directional step (rising edge or hold repeat); null = no step. */
  direction: GamepadDirection | null;
  /** Deflection that produced the step (0..1, D-pad = 1). */
  directionMagnitude: number;
  /** Right-stick scroll values in [-1, 1]; 0 = neutral. */
  scrollX: number;
  scrollY: number;
  /** Milliseconds since the previous poll (16.7 at 60 Hz). */
  deltaMs: number;
  /** Actions whose rising edge occurred this frame. */
  justPressed: ReadonlySet<GamepadAction>;
  /** Actions currently held. */
  pressed: ReadonlySet<GamepadAction>;
}

/** A resolved directional input together with where it came from. */
export interface DirectionInput {
  direction: GamepadDirection;
  magnitude: number;
  source: "dpad" | "stick";
  axis: "x" | "y";
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
  6: "lt",
  7: "rt",
  8: "select",
  9: "start",
};

const DPAD_BUTTONS = {
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const;

let frameSubscribers = new Set<FrameCallback>();
let connectionSubscribers = new Set<ConnectionCallback>();
let rafId: number | null = null;
let running = false;
let connected = false;

// Input state carried between frames.
interface DirectionTrack {
  direction: GamepadDirection | null;
  heldSince: number;
  lastStepAt: number;
  awaitingFirstRepeat: boolean;
}

let prevPressed = new Set<GamepadAction>();
let directionTrack: DirectionTrack = {
  direction: null,
  heldSince: 0,
  lastStepAt: 0,
  awaitingFirstRepeat: false,
};
// Last dominant stick axis, used as hysteresis so a diagonal push does not
// oscillate between two neighbours every frame.
let preferredAxis: "x" | "y" | null = null;
let stepMagnitude = 0;
let lastTickAt = 0;
let smoothScrollX = 0;
let smoothScrollY = 0;

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

export function axisWithDeadzone(
  value: number | undefined,
  deadzone: number,
): number {
  const v = value ?? 0;
  if (Number.isNaN(v) || Math.abs(v) < deadzone) return 0;
  return ((Math.abs(v) - deadzone) / (1 - deadzone)) * Math.sign(v);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * clamp01(amount);
}

/**
 * Pick the dominant axis, keeping the previous axis while both are close.
 * Without this hysteresis a slightly diagonal stick push flips between
 * horizontal and vertical every frame, which makes the focus ring jitter.
 */
function chooseAxis(
  x: number,
  y: number,
  preferred: "x" | "y" | null,
): "x" | "y" {
  if (x === 0) return "y";
  if (y === 0) return "x";
  if (preferred === "x" && Math.abs(x) * 1.25 >= Math.abs(y)) return "x";
  if (preferred === "y" && Math.abs(y) * 1.25 >= Math.abs(x)) return "y";
  return Math.abs(x) > Math.abs(y) ? "x" : "y";
}

/**
 * Resolve the current direction including its source and deflection.
 * The D-pad wins over the left stick; opposing D-pad buttons cancel out.
 */
export function resolveDirectionInput(
  gamepad: Gamepad,
  preferred: "x" | "y" | null = null,
): DirectionInput | null {
  const dpadX =
    (gamepad.buttons[DPAD_BUTTONS.right]?.pressed ? 1 : 0) -
    (gamepad.buttons[DPAD_BUTTONS.left]?.pressed ? 1 : 0);
  const dpadY =
    (gamepad.buttons[DPAD_BUTTONS.down]?.pressed ? 1 : 0) -
    (gamepad.buttons[DPAD_BUTTONS.up]?.pressed ? 1 : 0);

  if (dpadX !== 0 || dpadY !== 0) {
    const axis = chooseAxis(dpadX, dpadY, preferred);
    return {
      direction:
        axis === "x"
          ? dpadX > 0
            ? "right"
            : "left"
          : dpadY > 0
            ? "down"
            : "up",
      magnitude: 1,
      source: "dpad",
      axis,
    };
  }

  const x = axisWithDeadzone(gamepad.axes[0], STICK_DEADZONE);
  const y = axisWithDeadzone(gamepad.axes[1], STICK_DEADZONE);
  if (x === 0 && y === 0) return null;

  const axis = chooseAxis(x, y, preferred);
  return {
    direction:
      axis === "x" ? (x > 0 ? "right" : "left") : y > 0 ? "down" : "up",
    magnitude: Math.min(1, Math.hypot(x, y)),
    source: "stick",
    axis,
  };
}

export function resolveDirection(
  gamepad: Gamepad,
  preferred: "x" | "y" | null = null,
): GamepadDirection | null {
  return resolveDirectionInput(gamepad, preferred)?.direction ?? null;
}

export function resolvePressed(gamepad: Gamepad): Set<GamepadAction> {
  const pressed = new Set<GamepadAction>();
  for (const [indexStr, action] of Object.entries(ACTION_BY_BUTTON)) {
    if (gamepad.buttons[Number(indexStr)]?.pressed) pressed.add(action);
  }
  return pressed;
}

/**
 * Schedules the next poll frame, unless the loop is stopped or the document is
 * hidden.
 *
 * The Gamepad API has no push events for button state, so the loop has to run
 * to notice input — but there is no input to notice while the window is
 * minimized or in the background, and keeping a 60 Hz main-thread loop alive
 * there is pure overhead. `handleVisibility` restarts it on return.
 */
function scheduleTick(): void {
  if (!running || rafId !== null) return;
  if (typeof document !== "undefined" && document.hidden) return;
  rafId = requestAnimationFrame(tick);
}

function handleVisibility(): void {
  if (!running) return;
  // A frame scheduled just before the document was hidden never fires, so any
  // pending id is stale — clear it before deciding whether to re-arm.
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  scheduleTick();
}

function tick() {
  if (!running) {
    rafId = null;
    return;
  }
  // Re-arm before doing any work. While the document is hidden the browser
  // stops calling rAF; handleVisibility cancels/reschedules around that so the
  // loop never burns cycles in the background.
  rafId = requestAnimationFrame(tick);

  const gamepad = getGamepad();
  if (!gamepad) return;

  const now = performance.now();
  const deltaMs =
    lastTickAt === 0 ? 16.67 : Math.min(64, Math.max(1, now - lastTickAt));
  lastTickAt = now;

  // Discrete directional steps (rising edge + accelerated hold repeat).
  const input = resolveDirectionInput(gamepad, preferredAxis);
  if (input?.source === "stick") preferredAxis = input.axis;

  let step: GamepadDirection | null = null;
  stepMagnitude = 0;

  if (input) {
    if (directionTrack.direction !== input.direction) {
      // Rising edge (or a direction change while holding): always immediate.
      directionTrack.direction = input.direction;
      directionTrack.heldSince = now;
      directionTrack.lastStepAt = now;
      directionTrack.awaitingFirstRepeat = true;
      step = input.direction;
    } else if (directionTrack.awaitingFirstRepeat) {
      const startDelay =
        input.source === "dpad" ? DPAD_REPEAT_START_MS : STICK_REPEAT_START_MS;
      if (now - directionTrack.heldSince >= startDelay) {
        directionTrack.awaitingFirstRepeat = false;
        directionTrack.lastStepAt = now;
        step = input.direction;
      }
    } else {
      const held = now - directionTrack.heldSince;
      const acceleration = clamp01(
        (held - DPAD_REPEAT_START_MS) / REPEAT_ACCELERATION_MS,
      );
      // D-pad repeat speeds up over time; the stick is also driven by how far
      // it is pushed, so a gentle tilt moves slowly and a full tilt races.
      const interval =
        input.source === "dpad"
          ? lerp(DPAD_REPEAT_MAX_MS, DPAD_REPEAT_MIN_MS, acceleration)
          : lerp(
              STICK_REPEAT_MAX_MS,
              STICK_REPEAT_MIN_MS,
              Math.max(acceleration, input.magnitude),
            );
      if (now - directionTrack.lastStepAt >= interval) {
        directionTrack.lastStepAt = now;
        step = input.direction;
      }
    }
    if (step) stepMagnitude = input.magnitude;
  } else {
    directionTrack.direction = null;
    directionTrack.awaitingFirstRepeat = false;
    preferredAxis = null;
  }

  // Button edge detection.
  const pressed = resolvePressed(gamepad);
  const justPressed = new Set<GamepadAction>();
  for (const action of pressed) {
    if (!prevPressed.has(action)) justPressed.add(action);
  }
  prevPressed = pressed;

  // Analog right-stick scrolling with a short coast-to-stop tail.
  const targetScrollX = axisWithDeadzone(gamepad.axes[2], SCROLL_DEADZONE);
  const targetScrollY = axisWithDeadzone(gamepad.axes[3], SCROLL_DEADZONE);
  const smoothing = 1 - Math.exp(-deltaMs / SCROLL_SMOOTHING_MS);
  smoothScrollX += (targetScrollX - smoothScrollX) * smoothing;
  smoothScrollY += (targetScrollY - smoothScrollY) * smoothing;
  if (Math.abs(smoothScrollX) < 0.01) smoothScrollX = 0;
  if (Math.abs(smoothScrollY) < 0.01) smoothScrollY = 0;

  const frame: GamepadFrame = {
    direction: step,
    directionMagnitude: stepMagnitude,
    scrollX: smoothScrollX,
    scrollY: smoothScrollY,
    deltaMs,
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
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibility);
  }
  notifyConnection(getGamepad() !== null);
  scheduleTick();
}

/** Stop polling and reset state. */
export function stopGamepadInput(): void {
  if (!running) return;
  running = false;
  window.removeEventListener("gamepadconnected", handleConnected);
  window.removeEventListener("gamepaddisconnected", handleDisconnected);
  if (typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", handleVisibility);
  }
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  prevPressed = new Set();
  directionTrack = {
    direction: null,
    heldSince: 0,
    lastStepAt: 0,
    awaitingFirstRepeat: false,
  };
  preferredAxis = null;
  stepMagnitude = 0;
  lastTickAt = 0;
  smoothScrollX = 0;
  smoothScrollY = 0;
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

/**
 * Fire a short rumble pulse, when the controller supports it.
 *
 * Console UIs tick on activation; the caller keeps this deliberately subtle
 * (a few milliseconds) so it reads as feedback, not noise. Unsupported
 * controllers and browsers that block haptics are ignored.
 */
export function pulseGamepad(strength = 0.3, durationMs = 16): void {
  const gamepad = getGamepad();
  if (!gamepad) return;

  const actuator = (
    gamepad as unknown as {
      vibrationActuator?: {
        playEffect?: (
          type: string,
          params: {
            startDelay: number;
            duration: number;
            weakMagnitude: number;
            strongMagnitude: number;
          },
        ) => Promise<unknown>;
      };
    }
  ).vibrationActuator;
  if (!actuator?.playEffect) return;

  try {
    void actuator.playEffect("dual-rumble", {
      startDelay: 0,
      duration: durationMs,
      weakMagnitude: strength,
      strongMagnitude: strength,
    });
  } catch {
    // Controller/browser without rumble support.
  }
}
