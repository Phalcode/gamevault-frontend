import { describe, expect, it } from "vitest";
import {
  axisWithDeadzone,
  resolveDirection,
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
});

describe("resolvePressed", () => {
  it("maps pressed buttons to actions", () => {
    const gamepad = mockGamepad({
      buttons: [{ pressed: true }, { pressed: false }, { pressed: true }],
    });
    expect(resolvePressed(gamepad)).toEqual(new Set(["a", "x"]));
  });
});
