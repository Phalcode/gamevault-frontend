import { describe, expect, it } from "vitest";
import {
  computeTaskbarIndicator,
  type TaskbarIndicatorCard,
} from "./taskbarIndicator";

function card(overrides: Partial<TaskbarIndicatorCard>): TaskbarIndicatorCard {
  return { status: "downloading", progress: 0, ...overrides };
}

describe("computeTaskbarIndicator", () => {
  it("hides the indicator when there are no cards", () => {
    expect(computeTaskbarIndicator([])).toEqual({
      status: "none",
      progress: 0,
    });
  });

  it("reports the download progress of an active download", () => {
    expect(computeTaskbarIndicator([card({ progress: 42 })])).toEqual({
      status: "normal",
      progress: 42,
    });
  });

  it("uses the extraction progress while extracting", () => {
    const extracting = card({
      status: "completed",
      progress: 100,
      extractionStatus: "extracting",
      extractionProgress: 30,
    });
    expect(computeTaskbarIndicator([extracting])).toEqual({
      status: "normal",
      progress: 30,
    });
  });

  it("uses the installation progress while copying files", () => {
    const copying = card({
      status: "completed",
      progress: 100,
      extractionStatus: "completed",
      extractionProgress: 100,
      installationStatus: "copying",
      installationProgress: 77,
    });
    expect(computeTaskbarIndicator([copying])).toEqual({
      status: "normal",
      progress: 77,
    });
  });

  it("hides the indicator once a download finished awaiting extraction", () => {
    const downloaded = card({ status: "completed", progress: 100 });
    expect(computeTaskbarIndicator([downloaded])).toEqual({
      status: "none",
      progress: 0,
    });
  });

  it("hides the indicator once the game is installed", () => {
    const installed = card({
      status: "completed",
      progress: 100,
      extractionStatus: "completed",
      extractionProgress: 100,
      installationStatus: "completed",
      installationProgress: 100,
    });
    expect(computeTaskbarIndicator([installed])).toEqual({
      status: "none",
      progress: 0,
    });
  });

  it("hides the indicator when the installer is running", () => {
    const launching = card({
      status: "completed",
      progress: 100,
      extractionStatus: "completed",
      installationStatus: "launching",
    });
    const running = card({
      status: "completed",
      progress: 100,
      extractionStatus: "completed",
      installationStatus: "running",
    });
    expect(computeTaskbarIndicator([launching, running])).toEqual({
      status: "none",
      progress: 0,
    });
  });

  it("hides the indicator for a cancelled download", () => {
    const aborted = card({ status: "aborted", progress: 12 });
    expect(computeTaskbarIndicator([aborted])).toEqual({
      status: "none",
      progress: 0,
    });
  });

  it("keeps showing a paused download", () => {
    const paused = card({ status: "paused", progress: 55 });
    expect(computeTaskbarIndicator([paused])).toEqual({
      status: "paused",
      progress: 55,
    });
  });

  it("shows an error indicator for failed downloads", () => {
    const failed = card({ status: "error", progress: 10 });
    expect(computeTaskbarIndicator([failed])).toEqual({
      status: "error",
      progress: 10,
    });
  });

  it("shows an error indicator when extraction failed", () => {
    const failed = card({
      status: "completed",
      progress: 100,
      extractionStatus: "error",
      extractionProgress: 60,
    });
    expect(computeTaskbarIndicator([failed])).toEqual({
      status: "error",
      progress: 60,
    });
  });

  it("shows an error indicator when a password is required", () => {
    const encrypted = card({
      status: "completed",
      progress: 100,
      extractionStatus: "needs-password",
      extractionProgress: 40,
      extractionPasswordRequired: true,
    });
    expect(computeTaskbarIndicator([encrypted])).toEqual({
      status: "error",
      progress: 40,
    });
  });

  it("shows an error indicator when the file copy failed", () => {
    const failed = card({
      status: "completed",
      progress: 100,
      extractionStatus: "completed",
      installationStatus: "error",
    });
    expect(computeTaskbarIndicator([failed])).toEqual({
      status: "error",
      progress: 0,
    });
  });

  it("does not report 100% for a phase whose progress is unknown", () => {
    const copying = card({
      status: "completed",
      progress: 100,
      extractionStatus: "completed",
      extractionProgress: 100,
      installationStatus: "copying",
      installationProgress: null,
    });
    expect(computeTaskbarIndicator([copying])).toEqual({
      status: "indeterminate",
      progress: 0,
    });
  });

  it("falls back to an indeterminate bar when the total size is unknown", () => {
    const unknownTotal = card({ status: "downloading", progress: null });
    expect(computeTaskbarIndicator([unknownTotal])).toEqual({
      status: "indeterminate",
      progress: 0,
    });
  });

  it("ignores finished cards when averaging with an active download", () => {
    const installed = card({
      status: "completed",
      progress: 100,
      extractionStatus: "completed",
      installationStatus: "completed",
    });
    const downloading = card({ progress: 50 });
    expect(computeTaskbarIndicator([installed, downloading])).toEqual({
      status: "normal",
      progress: 50,
    });
  });

  it("prioritises an error over a running download", () => {
    const failed = card({ status: "error", progress: 100 });
    const downloading = card({ progress: 80 });
    expect(computeTaskbarIndicator([failed, downloading])).toEqual({
      status: "error",
      progress: 90,
    });
  });

  it("prioritises the error state over paused", () => {
    const paused = card({ status: "paused", progress: 20 });
    const failed = card({ status: "error", progress: 20 });
    expect(computeTaskbarIndicator([paused, failed])).toEqual({
      status: "error",
      progress: 20,
    });
  });

  it("clamps and rounds card progress into whole percent", () => {
    expect(computeTaskbarIndicator([card({ progress: 150 })])).toEqual({
      status: "normal",
      progress: 100,
    });
    expect(computeTaskbarIndicator([card({ progress: -5 })])).toEqual({
      status: "indeterminate",
      progress: 0,
    });
    expect(computeTaskbarIndicator([card({ progress: 33.4 })])).toEqual({
      status: "normal",
      progress: 33,
    });
  });
});
