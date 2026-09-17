import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LINES_EVENT,
  STATE_EVENT,
  appendLogBatch,
  bufferFromSnapshot,
  clearLaunchLogs,
  formatExitCode,
  getLaunchLog,
  listLaunchLogs,
  logText,
  openLaunchLogFolder,
  readLaunchLogFile,
  type LaunchLogEntry,
  type LaunchLogLine,
  type LaunchLogLinesBatch,
  type LaunchLogSnapshot,
} from "@/utils/launchLog";

/**
 * Standalone window that streams the current launch log (umu/Proton output
 * included) and lets the user open earlier logs. Booted directly from
 * `main.tsx` when the window was opened with `#launch-log`.
 */
export function LaunchLogWindow() {
  const [snapshot, setSnapshot] = useState<LaunchLogSnapshot | null>(null);
  const [lines, setLines] = useState<LaunchLogLine[]>([]);
  const [nextSeq, setNextSeq] = useState(0);
  const [follow, setFollow] = useState(true);
  const [entries, setEntries] = useState<LaunchLogEntry[]>([]);
  const [history, setHistory] = useState<string | null>(null);

  const bufferRef = useRef({ lines, nextSeq });
  bufferRef.current = { lines, nextSeq };
  const logIdRef = useRef<number | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);

  const refreshHistory = useCallback(async () => {
    try {
      setEntries(await listLaunchLogs());
    } catch {
      // Not running inside Tauri — nothing to list.
    }
  }, []);

  // Initial snapshot.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const current = await getLaunchLog();
        if (cancelled || !current) return;
        logIdRef.current = current.id;
        setSnapshot(current);
        const buffer = bufferFromSnapshot(current);
        setLines(buffer.lines);
        setNextSeq(buffer.nextSeq);
        bufferRef.current = buffer;
      } catch {
        // ignore
      }
      void refreshHistory();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshHistory]);

  // Live stream.
  useEffect(() => {
    let unlistenLines: (() => void) | undefined;
    let unlistenState: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlistenLines = await listen<LaunchLogLinesBatch>(
          LINES_EVENT,
          (event) => {
            if (
              logIdRef.current !== null &&
              event.payload.logId !== logIdRef.current
            ) {
              return;
            }
            const merged = appendLogBatch(bufferRef.current, event.payload);
            bufferRef.current = merged;
            setLines(merged.lines);
            setNextSeq(merged.nextSeq);
          },
        );
        unlistenState = await listen<LaunchLogSnapshot>(
          STATE_EVENT,
          (event) => {
            // A new launch started while the window is open: switch to it.
            if (event.payload.id !== logIdRef.current) {
              const buffer = bufferFromSnapshot(event.payload);
              logIdRef.current = event.payload.id;
              bufferRef.current = buffer;
              setLines(buffer.lines);
              setNextSeq(buffer.nextSeq);
              setHistory(null);
              void refreshHistory();
            }
            setSnapshot(event.payload);
          },
        );
      } catch {
        // ignore
      }
    })();
    return () => {
      unlistenLines?.();
      unlistenState?.();
    };
  }, [refreshHistory]);

  // Keep the view pinned to the bottom while following.
  useEffect(() => {
    if (!follow) return;
    const element = preRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines, follow]);

  const shownText = useMemo(
    () => (history !== null ? history : logText(lines)),
    [history, lines],
  );

  const statusText = snapshot ? formatExitCode(snapshot) : "no launch yet";

  return (
    <div className="flex h-screen flex-col bg-gv-bg text-gv-text">
      <header className="flex flex-wrap items-center gap-3 border-b border-gv-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">
            {snapshot ? snapshot.title : "Launch log"}
          </h1>
          <p className="truncate text-xs text-gv-muted">
            {statusText}
            {snapshot?.path ? ` — ${snapshot.path}` : ""}
            {snapshot?.truncated ? " — older lines were dropped" : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-gv-muted">
            <input
              type="checkbox"
              checked={follow}
              onChange={(event) => setFollow(event.target.checked)}
            />
            Follow
          </label>
          <button
            type="button"
            className="rounded border border-gv-line px-2 py-1 text-xs hover:bg-gv-panel"
            onClick={() => void navigator.clipboard.writeText(shownText)}
          >
            Copy
          </button>
          <button
            type="button"
            className="rounded border border-gv-line px-2 py-1 text-xs hover:bg-gv-panel"
            onClick={() => void openLaunchLogFolder()}
          >
            Open folder
          </button>
          <button
            type="button"
            className="rounded border border-gv-line px-2 py-1 text-xs hover:bg-gv-panel"
            onClick={async () => {
              await clearLaunchLogs();
              setHistory(null);
              setLines([]);
              bufferRef.current = {
                lines: [],
                nextSeq: bufferRef.current.nextSeq,
              };
              await refreshHistory();
            }}
          >
            Clear
          </button>
          <button
            type="button"
            className="rounded border border-gv-line px-2 py-1 text-xs hover:bg-gv-panel"
            onClick={() =>
              void import("@tauri-apps/api/window").then(
                ({ getCurrentWindow }) => getCurrentWindow().close(),
              )
            }
          >
            Close
          </button>
        </div>
      </header>

      {entries.length > 1 && (
        <div className="flex items-center gap-2 border-b border-gv-line px-4 py-2 text-xs text-gv-muted">
          <span>Recent launches:</span>
          <select
            className="rounded border border-gv-line bg-gv-panel px-2 py-1 text-xs"
            value={history !== null ? "history" : "current"}
            onChange={async (event) => {
              const value = event.target.value;
              if (value === "current" || value === "history") {
                setHistory(null);
                return;
              }
              const entry = entries.find(
                (candidate) => String(candidate.id) === value,
              );
              if (!entry?.path) return;
              try {
                setHistory(await readLaunchLogFile(entry.path));
              } catch {
                setHistory(null);
              }
            }}
          >
            <option value="current">
              {snapshot
                ? `Current: #${snapshot.id} ${snapshot.title}`
                : "Current"}
            </option>
            {history !== null && (
              <option value="history">Loaded from file</option>
            )}
            {entries
              .filter((entry) => entry.id !== snapshot?.id)
              .map((entry) => (
                <option key={entry.id} value={String(entry.id)}>
                  #{entry.id} {entry.title} ({entry.status})
                </option>
              ))}
          </select>
          {history !== null && (
            <button
              type="button"
              className="underline decoration-dotted hover:text-gv-text"
              onClick={() => setHistory(null)}
            >
              back to live log
            </button>
          )}
        </div>
      )}

      <pre
        ref={preRef}
        className="m-0 flex-1 overflow-auto whitespace-pre-wrap break-all px-4 py-3 font-mono text-xs leading-relaxed"
      >
        {shownText || "No output yet."}
      </pre>
    </div>
  );
}

export default LaunchLogWindow;
