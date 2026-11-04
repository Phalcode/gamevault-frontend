import { describe, expect, it } from "vitest";
import {
  axisWithDeadzone,
  resolveDirection,
  resolveDirectionInput,
  resolvePressed,
} from "./gamepad";

function mockGamepad({
  buttons = [] as { pressed: boolean }[],
  axes = [] as number[],
} = {}): Gamepad {
  return { buttons, axes } as unknown as Gamepad;
}

describe("axisWithDeadzone", () => {
  it("returns 0 below/at the deadzone and for NaN", () => {
    expect(axisWithDeadzone(0.1, 0.3)).toBe(0);
    expect(axisWithDeadzone(NaN, 0.3)).toBe(0);
    expect(axisWithDeadzone(undefined, 0.3)).toBe(0);
  });

  it("rescale the remaining magnitude", () => {
    expect(axisWithDeadzone(0.5, 0.3)).toBeCloseTo((0.5 - 0.3) / (1 - 0.3));
    expect(axisWithDeadzone(-0.5, 0.3)).toBeCloseTo(-(0.5 - 0.3) / (1 - 0.3));
  });
});

describe("resolveDirection", () => {
  it("returns null when there is no input", () => {
    expect(resolveDirection(mockGamepad())).toBeNull();
  });

  it("prefers the D-pad", () => {
    const buttons = new Array(16).fill({ pressed: false });
    buttons[12] = { pressed: true }; // D-pad up
    const gamepad = mockGamepad({ buttons });
    expect(resolveDirection(gamepad)).toBe("up");
  });

  it("uses the left stick when the D-pad is idle", () => {
    const gamepad = mockGamepad({ axes: [0.9, 0] });
    expect(resolveDirection(gamepad)).toBe("right");
  });

  it("ignores opposing D-pad buttons", () => {
    const buttons = new Array(16).fill({ pressed: false });
    buttons[14] = { pressed: true }; // left
    buttons[15] = { pressed: true }; // right
    const gamepad = mockGamepad({ buttons });
    expect(resolveDirection(gamepad)).toBeNull();
  });

  it("keeps the current axis while a diagonal stays close", () => {
    const gamepad = mockGamepad({ axes: [0.5, 0.55] });
    // Slightly more vertical, but the horizontal axis was dominant last frame.
    expect(resolveDirection(gamepad, "x")).toBe("right");
    expect(resolveDirection(gamepad)).toBe("down");
  });
});

describe("resolveDirectionInput", () => {
  it("reports the D-pad source at full magnitude", () => {
    const buttons = new Array(16).fill({ pressed: false });
    buttons[13] = { pressed: true }; // down
    expect(resolveDirectionInput(mockGamepad({ buttons }))).toEqual({
      direction: "down",
      magnitude: 1,
      source: "dpad",
      axis: "y",
    });
  });

  it("reports stick deflection so repeats can scale with it", () => {
    const input = resolveDirectionInput(mockGamepad({ axes: [0.8, 0] }));
    expect(input?.source).toBe("stick");
    expect(input?.direction).toBe("right");
    expect(input?.magnitude).toBeCloseTo((0.8 - 0.28) / (1 - 0.28));
  });
});

describe("resolvePressed", () => {
  it("maps pressed buttons to actions", () => {
    const gamepad = mockGamepad({
      buttons: [{ pressed: true }, { pressed: false }, { pressed: true }],
    });
    expect(resolvePressed(gamepad)).toEqual(new Set(["a", "x"]));
  });
});
