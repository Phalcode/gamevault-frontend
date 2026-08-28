import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AnimatePresence } from "motion/react";
import { Alert, AlertTitle, AlertDescription, AlertActions } from "@tw/alert";
import { Button } from "@tw/button";
import { Toast, type ToastTone } from "@tw/toast";
import { isTauriApp } from "@/utils/tauri";

// Shape of a queued alert request
export interface AlertDialogRequest {
  id: number;
  title: string;
  description?: string;
  affirmativeText?: string;
  negativeText?: string;
  tone?: ToastTone;
  resolve: (value: boolean) => void;
}

interface AlertDialogContextValue {
  showAlert: (options: {
    title: string;
    description?: string;
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
      affirmativeText = "Confirm",
      negativeText,
      tone,
    }) => {
      return new Promise<boolean>((resolve) => {
        const request: AlertDialogRequest = {
          id: ++idRef.current,
          title,
          description,
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
  // clear error dialog instead of silently doing nothing.
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
          const { gameTitle, message } = event.payload;
          showAlert({
            title: `Failed to launch "${gameTitle}"`,
            description: message,
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
