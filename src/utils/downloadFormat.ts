import { formatTrimmedNumber } from "./number";

const SKIP_AUTO_RESUME_KEY = "skip_auto_resume_downloads";

export function getSkipAutoResumeIds(): Set<number> {
  try {
    const raw = localStorage.getItem(SKIP_AUTO_RESUME_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(
      (Array.isArray(arr) ? arr : []).map(Number).filter((n) => n > 0),
    );
  } catch {
    return new Set();
  }
}

export function setSkipAutoResume(gameId: number, skip: boolean): void {
  if (gameId <= 0) return;
  const ids = getSkipAutoResumeIds();
  if (skip) ids.add(gameId);
  else ids.delete(gameId);
  try {
    localStorage.setItem(SKIP_AUTO_RESUME_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

export interface SpeedSample {
  t: number;
  bytes: number;
}

export function computeSpeedBps(
  samples: SpeedSample[],
  received: number,
  now: number,
): number | undefined {
  if (!samples.length) return undefined;
  const first = samples[0];
  const elapsedSec = (now - first.t) / 1000;
  if (elapsedSec <= 0) return undefined;
  return (received - first.bytes) / elapsedSec;
}

function precision(v: number): number {
  return v < 10 ? 2 : v < 100 ? 1 : 0;
}

function scaleDecimal(value: number, base: number, units: string[]) {
  let v = value;
  let u = 0;
  while (v >= base && u < units.length - 1) {
    v /= base;
    u++;
  }
  return { value: v, unit: units[u] };
}

export function formatBytes(bytes: number): string {
  if (!isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${formatTrimmedNumber(v, precision(v))} ${units[u]}`;
}

export function formatSpeed(bps?: number): string {
  if (bps === undefined || bps === null || !isFinite(bps)) return "";
  if (bps < 1000) return `${formatTrimmedNumber(bps, 0)} B/s`;
  // decimal scaling
  let { value: v, unit } = scaleDecimal(bps / 1000, 1000, [
    "KB",
    "MB",
    "GB",
    "TB",
    "PB",
  ]);
  return `${formatTrimmedNumber(v, precision(v))} ${unit}/s`;
}

export function formatKBps(bps?: number): string {
  if (bps === undefined || bps === null || !isFinite(bps) || bps <= 0)
    return "0 KB/s";
  const kb = bps / 1000;
  return `${formatTrimmedNumber(kb, precision(kb))} KB/s`;
}

export function formatLimit(kbPerSec: number): string {
  if (!kbPerSec || kbPerSec <= 0) return "Unlimited";
  let { value: v, unit } = scaleDecimal(kbPerSec, 1000, [
    "KB/s",
    "MB/s",
    "GB/s",
    "TB/s",
  ]);
  return `${formatTrimmedNumber(v, precision(v))} ${unit}`;
}
