import React, { createContext, useContext, useCallback, useRef, useState, useEffect, ReactNode } from 'react';
import { useAuth } from './AuthContext';

export interface ActiveDownload {
  gameId: number;
  filename: string;
  received: number;
  total: number | null;
  progress: number | null;
  abortController: AbortController;
  startedAt: number;
  speedBps?: number;
  status: 'downloading' | 'completed' | 'error' | 'aborted';
  error?: string;
  fileWriter?: { close(): Promise<void>; abort(): Promise<void>; }; 
}

interface DownloadContextValue {
  downloads: Record<number, ActiveDownload>;
  startDownload: (gameId: number, filename: string) => void;
  cancelDownload: (gameId: number) => void;
  speedLimitKB: number;
  setSpeedLimitKB: (v: number) => void;
  formatBytes: (bytes: number) => string;
  formatSpeed: (bps?: number) => string;
  formatKBps: (bps?: number) => string;
  formatLimit: (kbPerSec: number) => string;
}

const DownloadContext = createContext<DownloadContextValue | null>(null);

export function DownloadProvider({ children }: { children: ReactNode }) {
  const { serverUrl, authFetch } = useAuth();
  const [downloads, setDownloads] = useState<Record<number, ActiveDownload>>({});
  const [speedLimitKB, setSpeedLimitKBState] = useState<number>(() => {
    const NEW_KEY = 'download_speed_limit_kb';
    const existing = localStorage.getItem(NEW_KEY);
    if (existing) {
      const parsed = parseInt(existing, 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    const legacy = localStorage.getItem('download_speed_limit');
    if (legacy) {
      const legacyBytes = parseInt(legacy, 10);
      if (!Number.isNaN(legacyBytes) && legacyBytes > 0) {
        const converted = Math.max(1, Math.round(legacyBytes / 1000)); // decimal KB
        localStorage.setItem(NEW_KEY, String(converted));
        return converted;
      }
    }
    return 0;
  });
  const speedSamplesRef = useRef<Record<number, { t: number; bytes: number }[]>>({});
  const SPEED_WINDOW_MS = 5000;
  const UI_THROTTLE_MS = 200;
  const trimSamples = (samples: { t: number; bytes: number }[], now: number) => {
    while (samples.length && now - samples[0].t > SPEED_WINDOW_MS) samples.shift();
  };
  const computeSpeedBps = (samples: { t: number; bytes: number }[], received: number, now: number): number | undefined => {
    if (!samples.length) return undefined;
    const first = samples[0];
    const elapsedSec = (now - first.t) / 1000;
    if (elapsedSec <= 0) return undefined;
    return (received - first.bytes) / elapsedSec;
  };
  const precision = (v: number) => (v < 10 ? 2 : v < 100 ? 1 : 0);
  const trimZeros = (s: string) => (s.includes('.') ? s.replace(/\.?0+$/,'') : s);
  const scaleDecimal = (value: number, base: number, units: string[]) => {
    let v = value; let u = 0;
    while (v >= base && u < units.length - 1) { v /= base; u++; }
    return { value: v, unit: units[u] };
  };

  const updateDownload = useCallback((gameId: number, patch: Partial<ActiveDownload>) => {
    setDownloads(prev => {
      const existing = prev[gameId];
      if (!existing) return prev;
      return { ...prev, [gameId]: { ...existing, ...patch } };
    });
  }, []);

  const cancelDownload = useCallback((gameId: number) => {
    setDownloads(prev => {
      const d = prev[gameId];
      if (!d) return prev;
      d.abortController.abort();
      if (d.fileWriter) {       
        d.fileWriter.abort().catch(() => {});
      }
      return { ...prev, [gameId]: { ...d, status: 'aborted' } };
    });
  }, []);

  const lastUpdateRef = useRef<Record<number, number>>({});

  const startDownload = useCallback(async (gameId: number, filename: string) => {
    if (!serverUrl) return;
    if (downloads[gameId]?.status === 'downloading') return;
    const base = serverUrl.replace(/\/$/, '');
    const url = `${base}/api/games/${gameId}/download`;
    const ac = new AbortController();
    const entry: ActiveDownload = {
      gameId,
      filename,
      received: 0,
      total: null,
      progress: 0,
      abortController: ac,
      startedAt: performance.now(),
      status: 'downloading'
    };
    setDownloads(prev => ({ ...prev, [gameId]: entry }));
    speedSamplesRef.current[gameId] = [{ t: performance.now(), bytes: 0 }];

    try {
      let writer: { write(data: any): Promise<void>; close(): Promise<void>; abort(): Promise<void>; } | null = null;
      if (typeof (window as any).showSaveFilePicker === 'function') {
        try {
          const handle = await (window as any).showSaveFilePicker({ suggestedName: filename });
          writer = await handle.createWritable();
          if (writer) updateDownload(gameId, { fileWriter: writer });
        } catch (pickErr: any) {
          if (pickErr?.name === 'AbortError') {
            updateDownload(gameId, { status: 'aborted' });
            return;
          }
          throw pickErr;
        }
      }
      const res = await authFetch(url, {
        method: 'GET',
        headers: { 'X-Download-Speed-Limit': String(speedLimitKB) },
        signal: ac.signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('Content-Length')) || 0;
      if (total > 0) updateDownload(gameId, { total });
      const reader = res.body?.getReader();
      if (!reader) throw new Error('Streaming not supported');
      const chunks: (Uint8Array | ArrayBuffer)[] = writer ? [] : [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          if (writer) await writer.write(value);
          else chunks.push(value);
          received += value.length;
          const progress = total > 0 ? received / total : null;
          const now = performance.now();
          const samples = speedSamplesRef.current[gameId];
          samples.push({ t: now, bytes: received });
          trimSamples(samples, now);
          const speedBps = computeSpeedBps(samples, received, now);
          const last = lastUpdateRef.current[gameId] || 0;
          if (now - last > UI_THROTTLE_MS || progress === 1) {
            lastUpdateRef.current[gameId] = now;
            updateDownload(gameId, { received, progress, speedBps });
          }
        }
      }
      if (writer) await writer.close();
      else {
        const blob = new Blob(chunks as BlobPart[]);
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
      }
      updateDownload(gameId, { status: 'completed', progress: 1 });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        updateDownload(gameId, { status: 'aborted' });
      } else {
        updateDownload(gameId, { status: 'error', error: String(err) });
      }
    }
  }, [serverUrl, authFetch, downloads, updateDownload, speedLimitKB]);

  const setSpeedLimitKB = useCallback((v: number) => {
    const val = Math.max(0, v || 0);
    setSpeedLimitKBState(val);
    localStorage.setItem('download_speed_limit_kb', String(val));
  }, []);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === 'download_speed_limit_kb' && e.newValue !== null) {
        const parsed = parseInt(e.newValue, 10);
        if (!Number.isNaN(parsed)) setSpeedLimitKBState(parsed);
      } else if (e.key === 'download_speed_limit' && e.newValue !== null) {
        const legacyBytes = parseInt(e.newValue, 10);
        if (!Number.isNaN(legacyBytes)) {
          const converted = Math.max(legacyBytes > 0 ? 1 : 0, Math.round(legacyBytes / 1000));
          setSpeedLimitKBState(converted);
          localStorage.setItem('download_speed_limit_kb', String(converted));
        }
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const formatBytes = useCallback((bytes: number) => {
    if (!isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB','MB','GB','TB','PB'];
    let v = bytes / 1024; let u = 0;
    while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
    return `${trimZeros(v.toFixed(precision(v)))} ${units[u]}`;
  }, []);

  const formatSpeed = useCallback((bps?: number) => {
    if (bps === undefined || bps === null || !isFinite(bps)) return '';
    if (bps < 1000) return `${bps.toFixed(0)} B/s`;
    // decimal scaling
    let { value: v, unit } = scaleDecimal(bps / 1000, 1000, ['KB','MB','GB','TB','PB']);
    return `${trimZeros(v.toFixed(precision(v)))} ${unit}/s`;
  }, []);

  const formatKBps = useCallback((bps?: number) => {
    if (bps === undefined || bps === null || !isFinite(bps) || bps <= 0) return '0 KB/s';
    const kb = bps / 1000;
    return `${trimZeros(kb.toFixed(precision(kb)))} KB/s`;
  }, []);

  const formatLimit = useCallback((kbPerSec: number) => {
    if (!kbPerSec || kbPerSec <= 0) return 'Unlimited';
    let { value: v, unit } = scaleDecimal(kbPerSec, 1000, ['KB/s','MB/s','GB/s','TB/s']);
    return `${trimZeros(v.toFixed(precision(v)))} ${unit}`;
  }, []);

  const value: DownloadContextValue = {
    downloads,
    startDownload,
    cancelDownload,
    speedLimitKB,
    setSpeedLimitKB,
    formatBytes,
    formatSpeed,
    formatKBps,
    formatLimit
  };
  return <DownloadContext.Provider value={value}>{children}</DownloadContext.Provider>;
}

export function useDownloads() {
  const ctx = useContext(DownloadContext);
  if (!ctx) throw new Error('useDownloads must be used within DownloadProvider');
  return ctx;
}
