/**
 * Shared motion presets for GameVault's subtle, site-wide animation language.
 *
 * Rules (design system):
 * - Durations stay in the 120–220ms window.
 * - One easing curve only: `--ease-out` = cubic-bezier(0.23, 1, 0.32, 1).
 * - Animate only `transform` and `opacity` (no layout/width/color churn).
 * - `reducedMotion` is handled globally via `MotionConfig reducedMotion="user"`.
 */
import type { Transition, Variants } from "motion/react";

/** Same curve as `--ease-out` in `src/index.css`. */
export const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

export const DURATION_FAST = 0.12;
export const DURATION_BASE = 0.18;
export const DURATION_SLOW = 0.22;

export const pageTransition: Transition = {
  duration: DURATION_BASE,
  ease: EASE_OUT,
};

/** Fade + slide-up for list items / cards (entrance only). */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION_SLOW, ease: EASE_OUT },
  },
};

/** Container that staggers its direct motion children on mount. */
export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.04 } },
};

/** Fade between pages / panels. */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: pageTransition },
  exit: {
    opacity: 0,
    y: -4,
    transition: { duration: DURATION_FAST, ease: EASE_OUT },
  },
};

/** Standard hover lift used by cards across the app. */
export const CARD_HOVER =
  "transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-1 hover:border-gv-line-strong hover:shadow-(--shadow-shell)";
