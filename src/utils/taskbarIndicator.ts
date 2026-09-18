/**
 * Taskbar / dock indicator state derived from the download cards.
 *
 * Lives outside `DownloadContext` so the aggregation rules stay unit
 * testable. The status strings match the `TaskbarStatus` enum on the native
 * side (`src-tauri/src/taskbar.rs`).
 *
 * A card only drives the OS indicator while it actually has work left to do.
 * Cards that reached a terminal state (download finished, extraction
 * finished, installation finished, installer running, cancelled) stay in the
 * download list until the user deletes them, so they must be ignored —
 * otherwise the indicator sticks at the last phase's 100%.
 */

export type TaskbarIndicatorStatus =
  "none" | "normal" | "paused" | "error" | "indeterminate";

/**
 * The subset of a download card the indicator cares about. `ActiveDownload`
 * is structurally compatible with this, so no import cycle is needed.
 */
export interface TaskbarIndicatorCard {
  status: string;
  progress?: number | null;
  extractionStatus?: string;
  extractionProgress?: number | null;
  extractionPasswordRequired?: boolean;
  installationStatus?: string;
  installationProgress?: number | null;
}

export interface TaskbarIndicatorState {
  status: TaskbarIndicatorStatus;
  /** Whole percent (`0..=100`). Only meaningful for a determinate status. */
  progress: number;
}

const NO_INDICATOR: TaskbarIndicatorState = { status: "none", progress: 0 };

/** Clamp any card progress into a `0..=100` percent, defaulting to `0`. */
function toPercent(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

/**
 * Whether the card currently has work in progress (or needs the user to act
 * on it). Terminal states — download completed/aborted, extraction completed,
 * installation completed, installer launched/running — are not active, but a
 * paused download and an error/password prompt are, so their indicator stays
 * visible until the user resolves them.
 */
function isActive(card: TaskbarIndicatorCard): boolean {
  return (
    card.status === "downloading" ||
    card.status === "paused" ||
    card.status === "error" ||
    card.extractionStatus === "extracting" ||
    card.extractionStatus === "needs-password" ||
    card.extractionStatus === "error" ||
    card.installationStatus === "copying" ||
    card.installationStatus === "error"
  );
}

/**
 * The progress of the phase the card is currently in. An active phase that
 * does not know its progress yet reports `0`, which the caller turns into an
 * indeterminate indicator instead of a misleading `100%`.
 */
function currentProgress(card: TaskbarIndicatorCard): number {
  const extraction = card.extractionStatus;
  if (
    extraction === "extracting" ||
    extraction === "needs-password" ||
    extraction === "error"
  ) {
    return toPercent(card.extractionProgress);
  }

  const installation = card.installationStatus;
  if (installation === "copying" || installation === "error") {
    return toPercent(card.installationProgress);
  }

  return toPercent(card.progress);
}

/** Whether the card needs the user's attention (error or password prompt). */
function needsAction(card: TaskbarIndicatorCard): boolean {
  return (
    card.status === "error" ||
    card.extractionStatus === "error" ||
    card.extractionStatus === "needs-password" ||
    card.extractionPasswordRequired === true ||
    card.installationStatus === "error"
  );
}

/**
 * Whether the card is in a phase that can legitimately report `0%` — used to
 * distinguish "just started, total unknown" from "no work at all".
 */
function canBeIndeterminate(card: TaskbarIndicatorCard): boolean {
  return (
    card.status === "downloading" ||
    card.extractionStatus === "extracting" ||
    card.installationStatus === "copying"
  );
}

/**
 * Aggregate the given download cards into a single OS indicator state.
 *
 * Returns `{ status: "none" }` when nothing is left to do, which the caller
 * translates into clearing the native indicator.
 */
export function computeTaskbarIndicator(
  cards: readonly TaskbarIndicatorCard[],
): TaskbarIndicatorState {
  const active = cards.filter(isActive);
  if (active.length === 0) return NO_INDICATOR;

  // Average progress across the currently-active phase of each download.
  const progress = Math.round(
    active.reduce((sum, card) => sum + currentProgress(card), 0) /
      active.length,
  );

  if (active.some(needsAction)) return { status: "error", progress };
  if (active.some((card) => card.status === "paused")) {
    return { status: "paused", progress };
  }
  if (progress === 0 && active.some(canBeIndeterminate)) {
    return { status: "indeterminate", progress };
  }
  return { status: "normal", progress };
}
