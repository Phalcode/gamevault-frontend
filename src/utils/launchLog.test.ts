import { describe, expect, it } from "vitest";
import {
  MAX_WINDOW_LINES,
  appendLogBatch,
  bufferFromSnapshot,
  formatExitCode,
  logText,
  type LaunchLogSnapshot,
} from "./launchLog";

function line(seq: number, text = `line ${seq}`) {
  return { seq, stream: "out", text };
}

describe("appendLogBatch", () => {
  it("appends new lines and advances the sequence", () => {
    const buffer = appendLogBatch(
      { lines: [line(0)], nextSeq: 1 },
      { logId: 1, startSeq: 1, lines: [line(1), line(2)] },
    );

    expect(buffer.lines.map((entry) => entry.seq)).toEqual([0, 1, 2]);
    expect(buffer.nextSeq).toBe(3);
  });

  it("ignores duplicate and out-of-order batches", () => {
    const buffer = { lines: [line(0), line(1)], nextSeq: 2 };

    expect(
      appendLogBatch(buffer, {
        logId: 1,
        startSeq: 0,
        lines: [line(0), line(1)],
      }),
    ).toBe(buffer);
    // Partially overlapping batches only add the new lines.
    const merged = appendLogBatch(buffer, {
      logId: 1,
      startSeq: 1,
      lines: [line(1), line(2)],
    });
    expect(merged.lines.map((entry) => entry.seq)).toEqual([0, 1, 2]);
  });

  it("caps the buffer at the maximum line count", () => {
    const buffer = { lines: [line(0)], nextSeq: 1 };
    const merged = appendLogBatch(buffer, {
      logId: 1,
      startSeq: 1,
      lines: Array.from({ length: MAX_WINDOW_LINES + 10 }, (_, index) =>
        line(index + 1),
      ),
    });

    expect(merged.lines).toHaveLength(MAX_WINDOW_LINES);
    expect(merged.lines[0].seq).toBe(11);
  });
});

describe("bufferFromSnapshot", () => {
  it("keeps the snapshot lines and resumes after the highest sequence", () => {
    const snapshot: LaunchLogSnapshot = {
      id: 7,
      title: "Game",
      kind: "game",
      status: "running",
      exitCode: null,
      path: "/tmp/log.log",
      truncated: false,
      nextSeq: 3,
      lines: [line(1), line(2)],
    };

    expect(bufferFromSnapshot(snapshot)).toEqual({
      lines: [line(1), line(2)],
      nextSeq: 3,
    });
  });
});

describe("formatExitCode", () => {
  const base: LaunchLogSnapshot = {
    id: 1,
    title: "Game",
    kind: "game",
    status: "finished",
    exitCode: null,
    path: null,
    truncated: false,
    nextSeq: 0,
    lines: [],
  };

  it("shows the status while running", () => {
    expect(formatExitCode({ ...base, status: "running" })).toBe("running");
  });

  it("includes the exit code when there is one", () => {
    expect(formatExitCode({ ...base, exitCode: 1 })).toBe(
      "finished (exit code 1)",
    );
    expect(formatExitCode({ ...base, status: "failed", exitCode: null })).toBe(
      "failed",
    );
  });
});

describe("logText", () => {
  it("joins the line texts", () => {
    expect(logText([line(0, "a"), line(1, "b")])).toBe("a\nb");
  });
});
