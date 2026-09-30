/**
 * Launch log helpers.
 *
 * The Tauri backend records the full output of every game launch and streams
 * it live into the "Launch log" window (`launch-log` window label).
 */
export interface LaunchLogLine {
  seq: number;
  /** "out", "err" or "info". */
  stream: string;
  text: string;
}

export interface LaunchLogSnapshot {
  id: number;
  title: string;
  /** "game" or "installer". */
  kind: string;
  /** "running", "finished" or "failed". */
  status: string;
  exitCode: number | null;
  path: string | null;
  truncated: boolean;
  nextSeq: number;
  lines: LaunchLogLine[];
}

export interface LaunchLogEntry {
  id: number;
  title: string;
  kind: string;
  status: string;
  path: string | null;
  startedAt: number;
  lines: number;
}

export interface LaunchLogLinesBatch {
  logId: number;
  startSeq: number;
  lines: LaunchLogLine[];
}

export const LINES_EVENT = "launch-log-lines";
export const STATE_EVENT = "launch-log-state";

/** Lines kept in the window before the oldest ones are dropped. */
export const MAX_WINDOW_LINES = 5000;

export interface LogBuffer {
  lines: LaunchLogLine[];
  nextSeq: number;
}

/**
 * Appends a live batch to the buffer, dropping lines the window already has.
 *
 * Batches can arrive out of order or overlap (the snapshot and the live stream
 * race on mount), so every line carries a monotonic `seq`.
 */
export function appendLogBatch(
  buffer: LogBuffer,
  batch: LaunchLogLinesBatch,
): LogBuffer {
  const fresh = batch.lines.filter((line) => line.seq >= buffer.nextSeq);
  if (!fresh.length) return buffer;

  const lines = [...buffer.lines, ...fresh];
  return {
    lines:
      lines.length > MAX_WINDOW_LINES
        ? lines.slice(lines.length - MAX_WINDOW_LINES)
        : lines,
    nextSeq: fresh[fresh.length - 1].seq + 1,
  };
}

/** Replaces the buffer with a snapshot (used on mount and when a launch starts). */
export function bufferFromSnapshot(snapshot: LaunchLogSnapshot): LogBuffer {
  const lines = snapshot.lines.slice(-MAX_WINDOW_LINES);
  return {
    lines,
    nextSeq: Math.max(
      snapshot.nextSeq,
      (lines[lines.length - 1]?.seq ?? -1) + 1,
    ),
  };
}

export function formatExitCode(snapshot: LaunchLogSnapshot): string {
  if (snapshot.status === "running") return "running";
  if (snapshot.exitCode === null) return snapshot.status;
  return `${snapshot.status} (exit code ${snapshot.exitCode})`;
}

export function logText(lines: LaunchLogLine[]): string {
  return lines.map((line) => line.text).join("\n");
}

async function invokeCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export function getLaunchLog(
  logId?: number,
): Promise<LaunchLogSnapshot | null> {
  return invokeCommand<LaunchLogSnapshot | null>("get_launch_log", {
    logId: logId ?? null,
  });
}

export function listLaunchLogs(): Promise<LaunchLogEntry[]> {
  return invokeCommand<LaunchLogEntry[]>("list_launch_logs");
}

export function openLaunchLogWindow(): Promise<void> {
  return invokeCommand<void>("open_launch_log_window");
}

export function openLaunchLogFolder(): Promise<void> {
  return invokeCommand<void>("open_launch_log_folder");
}

export function clearLaunchLogs(): Promise<void> {
  return invokeCommand<void>("clear_launch_logs");
}

export function readLaunchLogFile(path: string): Promise<string> {
  return invokeCommand<string>("read_launch_log_file", { path });
}
