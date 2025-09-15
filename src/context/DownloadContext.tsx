import React, { createContext, useContext, useCallback, useRef, useState, useEffect, ReactNode } from 'react';
import { useAuth } from './AuthContext';

export interface ActiveDownload {
  gameId: number;
  filename: string;
  received: number;
  total: number | null; // null when unknown
  progress: number | null; // 0..1 or null
  abortController: AbortController;
  startedAt: number;
  speedBps?: number; // updated periodically
  status: 'downloading' | 'completed' | 'error' | 'aborted';
  error?: string;
}

interface DownloadContextValue {
  downloads: Record<number, ActiveDownload>;
  startDownload: (gameId: number, filename: string) => void;
  cancelDownload: (gameId: number) => void;
  speedLimit: number; // bytes/sec (0 = unlimited)
  setSpeedLimit: (v: number) => void;
  formatBytes: (bytes: number) => string;
  formatSpeed: (bps?: number) => string;
}

const DownloadContext = createContext<DownloadContextValue | null>(null);

export function DownloadProvider({ children }: { children: ReactNode }) {
  const { serverUrl, authFetch } = useAuth();
  const [downloads, setDownloads] = useState<Record<number, ActiveDownload>>({});
  const [speedLimit, setSpeedLimitState] = useState<number>(() => {
    const stored = localStorage.getItem('download_speed_limit');
    const parsed = stored ? parseInt(stored, 10) : 0;
    return Number.isNaN(parsed) ? 0 : parsed;
  });
  const speedSamplesRef = useRef<Record<number, { t: number; bytes: number }[]>>({});

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
      return { ...prev, [gameId]: { ...d, status: 'aborted' } };
    });
  }, []);

  const startDownload = useCallback(async (gameId: number, filename: string) => {
    if (!serverUrl) return;
    if (downloads[gameId]?.status === 'downloading') return; // already downloading
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
      const res = await authFetch(url, {
        method: 'GET',
        headers: { 'X-Download-Speed-Limit': String(speedLimit) },
        signal: ac.signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('Content-Length')) || 0;
      if (total > 0) updateDownload(gameId, { total });
      const reader = res.body?.getReader();
      if (!reader) throw new Error('Streaming not supported');
      const chunks: (Uint8Array | ArrayBuffer)[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.length;
          const progress = total > 0 ? received / total : null;
          const now = performance.now();
          const samples = speedSamplesRef.current[gameId];
          samples.push({ t: now, bytes: received });
          // keep last 5s of samples
          while (samples.length && now - samples[0].t > 5000) samples.shift();
          const first = samples[0];
            const elapsed = (now - first.t) / 1000;
          const deltaBytes = received - first.bytes;
          const speedBps = elapsed > 0 ? deltaBytes / elapsed : undefined;
          updateDownload(gameId, { received, progress, speedBps });
        }
      }
      const blob = new Blob(chunks as BlobPart[]);
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      updateDownload(gameId, { status: 'completed', progress: 1 });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        updateDownload(gameId, { status: 'aborted' });
      } else {
        updateDownload(gameId, { status: 'error', error: String(err) });
      }
    }
  }, [serverUrl, authFetch, downloads, updateDownload, speedLimit]);

  const setSpeedLimit = useCallback((v: number) => {
    const val = Math.max(0, v || 0);
    setSpeedLimitState(val);
    localStorage.setItem('download_speed_limit', String(val));
  }, []);

  // Sync with external changes (other tabs or manual localStorage edits)
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === 'download_speed_limit' && e.newValue !== null) {
        const parsed = parseInt(e.newValue, 10);
        if (!Number.isNaN(parsed)) setSpeedLimitState(parsed);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const formatBytes = useCallback((bytes: number) => {
    if (!isFinite(bytes)) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB','MB','GB','TB','PB'];
    let v = bytes / 1024;
    let u = 0;
    while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
    const prec = v < 10 ? 2 : v < 100 ? 1 : 0;
    return `${v.toFixed(prec)} ${units[u]}`;
  }, []);

  const formatSpeed = useCallback((bps?: number) => {
    if (bps === undefined || bps === null || !isFinite(bps)) return '';
    if (bps < 1000) return `${bps.toFixed(0)} B/s`;
    const units = ['KB','MB','GB','TB','PB'];
    let v = bps / 1000;
    let u = 0;
    while (v >= 1000 && u < units.length - 1) { v /= 1000; u++; }
    const prec = v < 10 ? 2 : v < 100 ? 1 : 0;
    return `${v.toFixed(prec)} ${units[u]}/s`;
  }, []);

  const value: DownloadContextValue = {
    downloads,
    startDownload,
    cancelDownload,
    speedLimit,
    setSpeedLimit,
    formatBytes,
    formatSpeed
  };
  return <DownloadContext.Provider value={value}>{children}</DownloadContext.Provider>;
}

export function useDownloads() {
  const ctx = useContext(DownloadContext);
  if (!ctx) throw new Error('useDownloads must be used within DownloadProvider');
  return ctx;
}
