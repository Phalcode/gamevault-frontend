import { describe, expect, it } from "vitest";
import {
  CARD_HOVER,
  DURATION_BASE,
  DURATION_FAST,
  DURATION_SLOW,
  EASE_OUT,
  fadeUp,
  pageTransition,
  pageVariants,
  staggerContainer,
} from "./motion";

describe("motion presets", () => {
  it("exposes the shared easing curve", () => {
    expect(EASE_OUT).toEqual([0.23, 1, 0.32, 1]);
  });

  it("keeps durations within the 120–220ms window", () => {
    expect(DURATION_FAST).toBe(0.12);
    expect(DURATION_BASE).toBe(0.18);
    expect(DURATION_SLOW).toBe(0.22);
  });

  it("uses the base duration and ease-out in pageTransition", () => {
    expect(pageTransition).toEqual({ duration: DURATION_BASE, ease: EASE_OUT });
  });

  it("fadeUp hides then slides up", () => {
    expect(fadeUp.hidden).toEqual({ opacity: 0, y: 8 });
    expect((fadeUp.visible as any).y).toBe(0);
  });

  it("staggerContainer staggers children", () => {
    expect((staggerContainer.visible as any).transition).toHaveProperty(
      "staggerChildren",
    );
  });

  it("pageVariants expose initial/animate/exit", () => {
    expect(pageVariants.initial).toEqual({ opacity: 0, y: 8 });
    expect((pageVariants.animate as any).transition).toEqual(pageTransition);
  });

  it("CARD_HOVER lifts on hover", () => {
    expect(CARD_HOVER).toContain("hover:-translate-y-1");
  });
});
