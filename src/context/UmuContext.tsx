import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { UmuSetupOverlay, type UmuPhase } from "@/components/UmuSetupOverlay";
import { isTauriApp } from "@/utils/tauri";

export interface UmuStatusInfo {
  installed: boolean;
  version: string | null;
  path: string | null;
  supportedPlatform: boolean;
}

interface UmuContextValue {
  /** Reports whether umu-launcher is installed (or null when unavailable). */
  checkUmuStatus: () => Promise<UmuStatusInfo | null>;
  /** Installs umu-launcher, streaming progress into the overlay. */
  installUmu: (gameTitle?: string) => Promise<boolean>;
}

const UmuContext = createContext<UmuContextValue | null>(null);

export const useUmu = () => {
  const ctx = useContext(UmuContext);
  if (!ctx) throw new Error("useUmu must be used within an UmuProvider");
  return ctx;
};

const MAX_OVERLAY_LINES = 20;

/**
 * Listens for `umu-status` events emitted by the Tauri backend while a
 * Windows executable runs through umu-launcher and renders the
 * "Setting up umu launcher…" overlay until the game/installer starts.
 */
export function UmuProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<UmuPhase>("setup");
  const [gameTitle, setGameTitle] = useState<string | undefined>(undefined);
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    if (!isTauriApp()) return;
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<{
          gameTitle?: string | null;
          phase: string;
          line?: string | null;
          message?: string | null;
        }>("umu-status", (event) => {
          const { phase: nextPhase, line, gameTitle: nextGameTitle } =
            event.payload;
          if (nextPhase === "installing" || nextPhase === "setup") {
            setPhase(nextPhase as UmuPhase);
            if (nextGameTitle) setGameTitle(nextGameTitle);
            if (line) {
              setLines((prev) => [...prev, line].slice(-MAX_OVERLAY_LINES));
            }
            setVisible(true);
          } else {
            // running | error | exit → the game/installer started or ended
            setVisible(false);
            setLines([]);
            setGameTitle(undefined);
          }
        });
      } catch {
        // Non-Tauri environments won't have the IPC bridge; ignore.
      }
    })();

    return () => {
      unlisten?.();
    };
  }, []);

  const checkUmuStatus = useCallback(async (): Promise<UmuStatusInfo | null> => {
    if (!isTauriApp()) return null;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<UmuStatusInfo>("umu_status");
    } catch {
      return null;
    }
  }, []);

  const installUmu = useCallback(async (gameTitle?: string): Promise<boolean> => {
    if (!isTauriApp()) return false;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("install_umu_launcher", { gameTitle: gameTitle ?? null });
      return true;
    } catch {
      return false;
    }
  }, []);

  return (
    <UmuContext.Provider value={{ checkUmuStatus, installUmu }}>
      {children}
      <UmuSetupOverlay
        visible={visible}
        phase={phase}
        gameTitle={gameTitle}
        lines={lines}
        onDismiss={() => setVisible(false)}
      />
    </UmuContext.Provider>
  );
}
