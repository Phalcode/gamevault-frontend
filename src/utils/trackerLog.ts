/**
 * Tracker log & playtime diagnostics helpers.
 *
 * The Rust time tracker credits exactly one minute per matched tick and records
 * every tick, match transition and credit outcome in a rotating log file
 * (`tracker-logs/tracker.log`). These helpers read that log, the per-game
 * playtime ledger and the one-shot scan report, and format them for a bug
 * report.
 */

export interface TrackerLogLine {
  seq: number;
  /** Milliseconds since the unix epoch. */
  at: number;
  /** "info", "warn", "error" or "tick". */
  level: string;
  /** e.g. "lifecycle", "tick", "game", "credit", "offline", "app". */
  category: string;
  text: string;
}

export interface TrackerRuntimeStats {
  running: boolean;
  startedAt: number | null;
  tickCount: number;
  tickIntervalSecs: number;
  /** Ticks the interval expected but that never ran (sleep, freeze, starvation). */
  lostTicks: number;
  catchUpTicks: number;
  lastTickAt: number | null;
  lastTickGapSecs: number | null;
  lastTickDurationMs: number | null;
  lastTickSummary: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  /** Increments the server rejected with 401/403 (expired token). */
  authRejectedCount: number;
  stopReason: string | null;
  logPath: string | null;
}

export interface GamePlayLedger {
  gameId: number;
  gameTitle: string;
  matched: boolean;
  firstMatchedAt: number | null;
  lastMatchedAt: number | null;
  matchedTicks: number;
  creditedTicks: number;
  offlineTicks: number;
  lostTicks: number;
  /** Lost ticks attributed to a tick gap (sleep/resume, freeze, starvation). */
  droppedTicks: number;
  matchFlaps: number;
  creditedMinutes: number;
  offlineMinutes: number;
  observedSeconds: number;
  lastServerMinutes: number | null;
  lastSkipReason: string | null;
}

export interface TrackerStatus {
  trackerRunning: boolean;
  stats: TrackerRuntimeStats;
  games: GamePlayLedger[];
  logPath: string | null;
}

export interface TrackerDebugProcess {
  pid: number;
  exe: string | null;
  cmd: string;
}

export interface TrackerDebugGame {
  gameId: number;
  gameTitle: string;
  installationDirectory: string;
  versionDirectory: string;
  exeCandidates: string[];
}

export interface TrackerDebugMatch {
  gameId: number;
  matched: boolean;
  matchingProcesses: string[];
}

export interface TrackerDebugReport {
  trackerRunning: boolean;
  roots: string[];
  totalProcesses: number;
  allProcesses: TrackerDebugProcess[];
  games: TrackerDebugGame[];
  processMatches: TrackerDebugMatch[];
}

/** Lines kept when formatting a log tail for a bug report. */
export const MAX_DUMP_LINES = 400;

async function invokeCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

/** `10:15:23.123 [warn] text` — enough to line ticks up with a session. */
export function formatTrackerLine(line: TrackerLogLine): string {
  const time = new Date(line.at).toISOString().slice(11, 23);
  return `${time} [${line.level}] ${line.text}`;
}

export function logText(lines: TrackerLogLine[]): string {
  return lines.map(formatTrackerLine).join("\n");
}

/** Minutes the tracker saw (wall clock) but never credited for this game. */
export function ledgerShortfall(game: GamePlayLedger): number {
  const observed = Math.floor(game.observedSeconds / 60);
  return Math.max(0, observed - game.creditedMinutes - game.offlineMinutes);
}

export function formatLedgerGame(game: GamePlayLedger): string {
  const observed = Math.floor(game.observedSeconds / 60);
  const parts = [
    `#${game.gameId} ${game.gameTitle || "(unknown)"}`,
    `observed=${observed}min`,
    `credited=${game.creditedMinutes}min`,
    `offline=${game.offlineMinutes}min`,
    `lost=${game.lostTicks}min`,
    `dropped=${game.droppedTicks}min`,
    `flaps=${game.matchFlaps}`,
  ];
  const shortfall = ledgerShortfall(game);
  if (shortfall > 0) {
    parts.push(`SHORTFALL=${shortfall}min`);
  }
  if (game.lastSkipReason) {
    parts.push(`last_reason="${game.lastSkipReason}"`);
  }
  return parts.join(" | ");
}

/** Human-readable playtime accounting table, one line per game. */
export function formatPlaytimeLedger(games: GamePlayLedger[]): string {
  if (!games.length) {
    return "(no games tracked yet — nothing was matched since the tracker started)";
  }
  const lines = games
    .slice()
    .sort((a, b) => ledgerShortfall(b) - ledgerShortfall(a));
  return lines.map(formatLedgerGame).join("\n");
}

/** Compact summary of the tracker loop counters. */
export function formatTrackerStats(stats: TrackerRuntimeStats): string {
  const lastTick = stats.lastTickAt
    ? new Date(stats.lastTickAt).toISOString()
    : "never";
  return [
    `running=${stats.running ? "yes" : "no"}`,
    `interval=${stats.tickIntervalSecs}s`,
    `ticks=${stats.tickCount}`,
    `lost_ticks=${stats.lostTicks}`,
    `catch_up_ticks=${stats.catchUpTicks}`,
    `consecutive_failures=${stats.consecutiveFailures}`,
    `auth_rejected=${stats.authRejectedCount}`,
    `last_tick=${lastTick}`,
    `last_tick_gap=${stats.lastTickGapSecs ?? "unknown"}s`,
    `stop_reason=${stats.stopReason ?? "none"}`,
    `last_error=${stats.lastError ?? "none"}`,
  ].join(" | ");
}

/**
 * Full diagnostics block for the clipboard: loop counters, the per-game
 * playtime accounting and the tail of the tracker log.
 */
export function formatTrackerDump(options: {
  status: TrackerStatus | null;
  lines: TrackerLogLine[];
  scan?: TrackerDebugReport | null;
  /** Overrides "now" for deterministic output (tests). */
  generatedAt?: string;
}): string {
  const { status, lines, scan } = options;
  const sections: string[] = [
    "=== GameVault time tracker diagnostics ===",
    `generated: ${options.generatedAt ?? new Date().toISOString()}`,
  ];

  if (!status) {
    sections.push("tracker status: unavailable (tracker log not initialized)");
  } else {
    sections.push(`log file: ${status.logPath ?? "unknown"}`);
    sections.push(`stats: ${formatTrackerStats(status.stats)}`);
    sections.push(`last tick summary: ${status.stats.lastTickSummary ?? "none"}`);
    sections.push("");
    sections.push("--- playtime ledger (observed vs credited) ---");
    sections.push(formatPlaytimeLedger(status.games));
  }

  if (scan) {
    sections.push("");
    sections.push("--- scan snapshot ---");
    sections.push(
      `roots=${scan.roots.join(", ") || "none"} | processes=${scan.totalProcesses} | installed=${scan.games.length}`,
    );
    for (const match of scan.processMatches) {
      sections.push(
        `#${match.gameId} matched=${match.matched} processes=${match.matchingProcesses.join(" ; ") || "-"}`,
      );
    }
  }

  sections.push("");
  sections.push(`--- tracker log tail (last ${Math.min(lines.length, MAX_DUMP_LINES)} lines) ---`);
  sections.push(lines.length ? logText(lines.slice(-MAX_DUMP_LINES)) : "(empty)");

  return sections.join("\n");
}

// ── Commands ───────────────────────────────────────────────────────────────

export function getTrackerLog(limit?: number): Promise<TrackerLogLine[]> {
  return invokeCommand<TrackerLogLine[]>("get_tracker_log", {
    limit: limit ?? null,
  });
}

export function getTrackerStatus(): Promise<TrackerStatus> {
  return invokeCommand<TrackerStatus>("get_tracker_status");
}

export function resetTrackerLedger(): Promise<void> {
  return invokeCommand<void>("reset_tracker_ledger");
}

export function clearTrackerLog(): Promise<void> {
  return invokeCommand<void>("clear_tracker_log");
}

export function openTrackerLogFolder(): Promise<void> {
  return invokeCommand<void>("open_tracker_log_folder");
}

export function readTrackerLogFile(
  path: string,
  maxBytes?: number,
): Promise<string> {
  return invokeCommand<string>("read_tracker_log_file", {
    path,
    maxBytes: maxBytes ?? null,
  });
}

/** Records a frontend line in the same native tracker log. */
export function trackerLogLine(
  level: "info" | "warn" | "error",
  category: string,
  message: string,
): Promise<void> {
  return invokeCommand<void>("tracker_log_line", { level, category, message });
}

/** Replays one tracker scan and reports what it found right now. */
export function debugTrackerScan(
  selectedRoot?: string,
): Promise<TrackerDebugReport> {
  return invokeCommand<TrackerDebugReport>("debug_tracker_scan", {
    selectedRoot: selectedRoot ?? null,
  });
}
