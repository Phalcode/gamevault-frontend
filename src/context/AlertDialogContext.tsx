import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AnimatePresence } from "motion/react";
import {
  CheckIcon,
  ClipboardIcon,
  CommandLineIcon,
} from "@heroicons/react/24/outline";
import {
  Alert,
  AlertTitle,
  AlertDescription,
  AlertBody,
  AlertActions,
} from "@tw/alert";
import { Button } from "@tw/button";
import { Toast, type ToastTone } from "@tw/toast";
import { isTauriApp } from "@/utils/tauri";

// Shape of a queued alert request
export interface AlertDialogRequest {
  id: number;
  title: string;
  description?: string;
  /** Optional raw process/console output rendered in a terminal-style block. */
  log?: string;
  affirmativeText?: string;
  negativeText?: string;
  tone?: ToastTone;
  resolve: (value: boolean) => void;
}

interface AlertDialogContextValue {
  showAlert: (options: {
    title: string;
    description?: string;
    log?: string;
    affirmativeText?: string;
    negativeText?: string;
    tone?: ToastTone;
  }) => Promise<boolean>;
}

const AlertDialogContext = createContext<AlertDialogContextValue | undefined>(
  undefined,
);

export const useAlertDialog = () => {
  const ctx = useContext(AlertDialogContext);
  if (!ctx)
    throw new Error(
      "useAlertDialog must be used within an AlertDialogProvider",
    );
  return ctx;
};

/**
 * Terminal-style block that shows raw process output with a copy button.
 */
function ConsoleOutput({ log }: { log: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(log);
      setCopied(true);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (e.g. insecure context); keep the button inert.
    }
  }, [log]);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <AlertBody>
      <div className="flex items-center gap-2 rounded-t-lg border border-b-0 border-zinc-200 bg-zinc-950 px-3 py-2 dark:border-zinc-800">
        <CommandLineIcon className="size-3.5 text-zinc-400" />
        <span className="text-xs font-medium tracking-wide text-zinc-400">
          CONSOLE OUTPUT
        </span>
        <button
          type="button"
          aria-label="Copy console output to clipboard"
          onClick={() => void copy()}
          className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
        >
          {copied ? (
            <CheckIcon className="size-3.5 text-emerald-400" />
          ) : (
            <ClipboardIcon className="size-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-48 overflow-y-auto rounded-b-lg border border-zinc-200 bg-zinc-950 p-3 font-mono text-xs leading-5 whitespace-pre-wrap wrap-break-word text-zinc-200 dark:border-zinc-800">
        {log}
      </pre>
    </AlertBody>
  );
}

/**
 * Provider renders a single alert dialog at a time; subsequent calls are queued.
 */
export const AlertDialogProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const queueRef = useRef<AlertDialogRequest[]>([]);
  const idRef = useRef(0);
  const [, forceRerender] = useState({});
  const activeRef = useRef<AlertDialogRequest | null>(null);
  const autoCloseTimerRef = useRef<number | null>(null);

  const dequeue = useCallback(() => {
    if (activeRef.current) return; // already showing one
    const next = queueRef.current.shift() || null;
    activeRef.current = next;
    forceRerender({});

    // Auto-close after 4 seconds for toast notifications only
    if (next && !next.description && !next.negativeText) {
      if (autoCloseTimerRef.current) {
        window.clearTimeout(autoCloseTimerRef.current);
      }
      autoCloseTimerRef.current = window.setTimeout(() => {
        if (activeRef.current?.id === next.id) {
          handleClose(true);
        }
      }, 4000);
    }
  }, []);

  const handleClose = useCallback(
    (result: boolean) => {
      if (activeRef.current) {
        activeRef.current.resolve(result);
        activeRef.current = null;
        if (autoCloseTimerRef.current) {
          window.clearTimeout(autoCloseTimerRef.current);
          autoCloseTimerRef.current = null;
        }
        forceRerender({});
        // small timeout ensures state commit before pulling next
        setTimeout(() => dequeue(), 0);
      }
    },
    [dequeue],
  );

  const showAlert = useCallback<AlertDialogContextValue["showAlert"]>(
    ({
      title,
      description,
      log,
      affirmativeText = "Confirm",
      negativeText,
      tone,
    }) => {
      return new Promise<boolean>((resolve) => {
        const request: AlertDialogRequest = {
          id: ++idRef.current,
          title,
          description,
          log,
          affirmativeText,
          negativeText,
          tone,
          resolve,
        };
        queueRef.current.push(request);
        dequeue();
      });
    },
    [dequeue],
  );

  const value: AlertDialogContextValue = { showAlert };

  const active = activeRef.current;

  // Use modal variant for confirmation dialogs (with description/negativeText), toast for simple notifications
  const isConfirmationDialog =
    active && (active.description || active.negativeText);
  const variant = isConfirmationDialog ? "modal" : "toast";

  return (
    <AlertDialogContext.Provider value={value}>
      {children}
      {variant === "toast" ? (
        // Toast notifications - render outside Dialog to avoid blocking interactions
        <AnimatePresence>
          {active && (
            <Toast
              tone={active.tone}
              title={active.title}
              description={active.description}
              onDismiss={() => handleClose(true)}
            />
          )}
        </AnimatePresence>
      ) : (
        // Modal dialogs - use Alert component
        <Alert
          open={!!active}
          onClose={(open: boolean) => {
            if (!open) {
              handleClose(false);
            }
          }}
          variant="modal"
        >
          {active && (
            <>
              <AlertTitle>{active.title}</AlertTitle>
              {active.description && (
                <AlertDescription>{active.description}</AlertDescription>
              )}
              {active.log && <ConsoleOutput log={active.log} />}
              <AlertActions>
                {active.negativeText && (
                  <Button plain onClick={() => handleClose(false)}>
                    {active.negativeText}
                  </Button>
                )}
                <Button onClick={() => handleClose(true)} autoFocus>
                  {active.affirmativeText || "Confirm"}
                </Button>
              </AlertActions>
            </>
          )}
        </Alert>
      )}
    </AlertDialogContext.Provider>
  );
};

// Optional convenience imperative API attached to window for non-hook usage (e.g., outside React tree)
declare global {
  interface Window {
    showAlertDialog?: AlertDialogContextValue["showAlert"];
  }
}

export const GlobalAlertDialogBridge: React.FC = () => {
  const { showAlert } = useAlertDialog();
  // Assign once per render (idempotent)
  window.showAlertDialog = showAlert;

  // Surface game launch failures captured in the Tauri backend (a game that
  // exits immediately with console output, e.g. a missing prerequisite) as a
  // clear error dialog instead of silently doing nothing. The wording makes
  // it obvious the *game process* closed — not GameVault — and shows the
  // game's own output in a console-style block.
  useEffect(() => {
    if (!isTauriApp()) return;
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<{
          gameTitle: string;
          exitCode?: number | null;
          message: string;
        }>("game-launch-failed", (event) => {
          const { gameTitle, exitCode, message } = event.payload;
          const codeInfo =
            exitCode != null ? ` with exit code ${exitCode}` : "";
          showAlert({
            title: `${gameTitle} exited with an error`,
            description: `The game process closed${codeInfo}. It printed the following output:`,
            log: message,
            affirmativeText: "OK",
          });
        });
      } catch {
        // Non-Tauri environments won't have the IPC bridge; ignore.
      }
    })();

    return () => {
      unlisten?.();
    };
  }, [showAlert]);

  return null;
};

export default AlertDialogProvider;
