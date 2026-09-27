import { describe, expect, it } from "vitest";
import {
  formatLedgerGame,
  formatPlaytimeLedger,
  formatTrackerDump,
  formatTrackerLine,
  formatTrackerStats,
  ledgerShortfall,
  logText,
  type GamePlayLedger,
  type TrackerLogLine,
  type TrackerRuntimeStats,
  type TrackerStatus,
} from "./trackerLog";

function game(overrides: Partial<GamePlayLedger> = {}): GamePlayLedger {
  return {
    gameId: 1,
    gameTitle: "Some Game",
    matched: true,
    firstMatchedAt: null,
    lastMatchedAt: null,
    matchedTicks: 0,
    creditedTicks: 0,
    offlineTicks: 0,
    lostTicks: 0,
    droppedTicks: 0,
    matchFlaps: 0,
    creditedMinutes: 0,
    offlineMinutes: 0,
    observedSeconds: 0,
    lastServerMinutes: null,
    lastSkipReason: null,
    ...overrides,
  };
}

function stats(overrides: Partial<TrackerRuntimeStats> = {}): TrackerRuntimeStats {
  return {
    running: true,
    startedAt: null,
    tickCount: 0,
    tickIntervalSecs: 60,
    lostTicks: 0,
    catchUpTicks: 0,
    lastTickAt: null,
    lastTickGapSecs: null,
    lastTickDurationMs: null,
    lastTickSummary: null,
    lastError: null,
    consecutiveFailures: 0,
    authRejectedCount: 0,
    stopReason: null,
    logPath: null,
    ...overrides,
  };
}

function line(seq: number, text = `line ${seq}`): TrackerLogLine {
  return { seq, at: 1_600_000_000_000 + seq * 1000, level: "tick", category: "tick", text };
}

describe("ledgerShortfall", () => {
  it("reports the minutes the tracker saw but never credited", () => {
    // One hour observed, 15 minutes credited: the reported 1h -> 15min case.
    const played = game({
      observedSeconds: 60 * 60,
      creditedMinutes: 15,
    });

    expect(ledgerShortfall(played)).toBe(45);
  });

  it("counts offline minutes as credited and never goes negative", () => {
    const stored = game({ observedSeconds: 60 * 20, creditedMinutes: 15, offlineMinutes: 5 });
    expect(ledgerShortfall(stored)).toBe(0);
  });
});

describe("formatLedgerGame", () => {
  it("includes observed, credited and lost minutes with the last reason", () => {
    const text = formatLedgerGame(
      game({
        observedSeconds: 60 * 60,
        creditedMinutes: 15,
        lostTicks: 45,
        droppedTicks: 40,
        matchFlaps: 3,
        lastSkipReason: "no_matching_process",
      }),
    );

    expect(text).toContain("observed=60min");
    expect(text).toContain("credited=15min");
    expect(text).toContain("lost=45min");
    expect(text).toContain("dropped=40min");
    expect(text).toContain("flaps=3");
    expect(text).toContain("SHORTFALL=45min");
    expect(text).toContain('last_reason="no_matching_process"');
  });

  it("omits the shortfall when everything was accounted for", () => {
    expect(formatLedgerGame(game({ observedSeconds: 60, creditedMinutes: 1 }))).not.toContain(
      "SHORTFALL",
    );
  });
});

describe("formatPlaytimeLedger", () => {
  it("explains an empty ledger", () => {
    expect(formatPlaytimeLedger([])).toContain("no games tracked yet");
  });

  it("lists the biggest shortfall first", () => {
    const text = formatPlaytimeLedger([
      game({ gameId: 1, observedSeconds: 60 * 5, creditedMinutes: 5 }),
      game({ gameId: 2, observedSeconds: 60 * 60, creditedMinutes: 15 }),
    ]);

    expect(text.split("\n")).toHaveLength(2);
    expect(text.indexOf("#2")).toBeLessThan(text.indexOf("#1"));
  });
});

describe("formatTrackerStats", () => {
  it("summarises the loop counters", () => {
    const text = formatTrackerStats(
      stats({ tickCount: 42, lostTicks: 3, authRejectedCount: 2, stopReason: "hook unmounted" }),
    );

    expect(text).toContain("running=yes");
    expect(text).toContain("interval=60s");
    expect(text).toContain("ticks=42");
    expect(text).toContain("lost_ticks=3");
    expect(text).toContain("auth_rejected=2");
    expect(text).toContain("stop_reason=hook unmounted");
  });
});

describe("formatTrackerLine", () => {
  it("prefixes the UTC time and level", () => {
    // 2020-09-13 12:26:40 UTC
    expect(formatTrackerLine(line(0, "hello"))).toBe("12:26:40.000 [tick] hello");
  });

  it("joins lines for copy/paste", () => {
    expect(logText([line(0, "a"), line(1, "b")])).toBe(
      "12:26:40.000 [tick] a\n12:26:41.000 [tick] b",
    );
  });
});

describe("formatTrackerDump", () => {
  const status: TrackerStatus = {
    trackerRunning: true,
    stats: stats({ tickCount: 7, lastTickSummary: "tick 7 | matched=1" }),
    games: [game({ observedSeconds: 60 * 60, creditedMinutes: 15, lostTicks: 45 })],
    logPath: "C:/logs/tracker-logs/tracker.log",
  };

  it("combines status, ledger and log tail", () => {
    const dump = formatTrackerDump({
      status,
      lines: [line(0, "match_started")],
      generatedAt: "2026-09-26T00:00:00.000Z",
    });

    expect(dump).toContain("generated: 2026-09-26T00:00:00.000Z");
    expect(dump).toContain("log file: C:/logs/tracker-logs/tracker.log");
    expect(dump).toContain("ticks=7");
    expect(dump).toContain("SHORTFALL=45min");
    expect(dump).toContain("match_started");
  });

  it("includes the scan snapshot when provided", () => {
    const dump = formatTrackerDump({
      status,
      lines: [],
      scan: {
        trackerRunning: true,
        roots: ["D:/Games"],
        totalProcesses: 120,
        allProcesses: [],
        games: [],
        processMatches: [{ gameId: 4, matched: false, matchingProcesses: [] }],
      },
    });

    expect(dump).toContain("roots=D:/Games");
    expect(dump).toContain("#4 matched=false");
  });

  it("degrades gracefully without a tracker status", () => {
    const dump = formatTrackerDump({ status: null, lines: [] });

    expect(dump).toContain("tracker status: unavailable");
    expect(dump).toContain("(empty)");
  });
});
