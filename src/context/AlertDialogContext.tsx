import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Alert, AlertTitle, AlertDescription, AlertActions } from '@tw/alert';
import { Button } from '@tw/button';

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

const AlertDialogContext = createContext<AlertDialogContextValue | undefined>(undefined);

export const useAlertDialog = () => {
  const ctx = useContext(AlertDialogContext);
  if (!ctx) throw new Error('useAlertDialog must be used within an AlertDialogProvider');
  return ctx;
};

/**
 * Provider renders a single alert dialog at a time; subsequent calls are queued.
 */
export const AlertDialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queueRef = useRef<AlertDialogRequest[]>([]);
  const idRef = useRef(0);
  const [, forceRerender] = useState({});
  const activeRef = useRef<AlertDialogRequest | null>(null);

  const dequeue = () => {
    if (activeRef.current) return; // already showing one
    const next = queueRef.current.shift() || null;
    activeRef.current = next;
    forceRerender({});
  };

  const showAlert = useCallback<AlertDialogContextValue['showAlert']>(({ title, description, affirmativeText = 'Confirm', negativeText }) => {
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
  }, []);

  const handleClose = (result: boolean) => {
    if (activeRef.current) {
      activeRef.current.resolve(result);
      activeRef.current = null;
      forceRerender({});
      // small timeout ensures state commit before pulling next
      setTimeout(() => dequeue(), 0);
    }
  };

  const value: AlertDialogContextValue = { showAlert };

  const active = activeRef.current;

  return (
    <AlertDialogContext.Provider value={value}>
      {children}
      <Alert
        open={!!active}
        onClose={(open: boolean) => {
          if (!open) handleClose(false);
        }}
        size="sm"
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
                {active.affirmativeText || 'Confirm'}
              </Button>
            </AlertActions>
          </>
        )}
      </Alert>
    </AlertDialogContext.Provider>
  );
};

// Optional convenience imperative API attached to window for non-hook usage (e.g., outside React tree)
declare global {
  interface Window {
    showAlertDialog?: AlertDialogContextValue['showAlert'];
  }
}

export const GlobalAlertDialogBridge: React.FC = () => {
  const { showAlert } = useAlertDialog();
  // Assign once per render (idempotent)
  window.showAlertDialog = showAlert;
  return null;
};

export default AlertDialogProvider;
