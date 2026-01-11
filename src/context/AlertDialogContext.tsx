import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { Alert, AlertTitle, AlertDescription, AlertActions } from "@tw/alert";
import { Button } from "@tw/button";

// Shape of a queued alert request
export interface AlertDialogRequest {
  id: number;
  title: string;
  description?: string;
  affirmativeText?: string;
  negativeText?: string;
  resolve: (value: boolean) => void;
}

interface AlertDialogContextValue {
  showAlert: (options: {
    title: string;
    description?: string;
    affirmativeText?: string;
    negativeText?: string;
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

  const handleClose = useCallback((result: boolean) => {
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
  }, [dequeue]);

  const showAlert = useCallback<AlertDialogContextValue["showAlert"]>(
    ({ title, description, affirmativeText = "Confirm", negativeText }) => {
      return new Promise<boolean>((resolve) => {
        const request: AlertDialogRequest = {
          id: ++idRef.current,
          title,
          description,
          affirmativeText,
          negativeText,
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
  const isConfirmationDialog = active && (active.description || active.negativeText);
  const variant = isConfirmationDialog ? "modal" : "toast";

  return (
    <AlertDialogContext.Provider value={value}>
      {children}
      {variant === "toast" ? (
        // Toast notifications - render without Dialog to avoid blocking interactions
        active && (
          <div className="fixed top-4 right-4 z-50 w-[220px] sm:w-auto rounded-md bg-white px-4 py-2 shadow-lg ring-1 ring-zinc-950/10 text-sm flex items-center gap-2 dark:bg-zinc-900 dark:ring-white/10 pointer-events-auto animate-in fade-in slide-in-from-top-2 duration-150">
            <div className="font-semibold text-zinc-950 dark:text-white">
              {active.title}
            </div>
          </div>
        )
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
  return null;
};

export default AlertDialogProvider;
