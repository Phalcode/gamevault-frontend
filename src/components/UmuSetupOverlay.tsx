import {
  Dialog,
  DialogDescription,
  DialogTitle,
} from "@/components/tailwind/dialog";
import { Button } from "@tw/button";

export type UmuPhase = "installing" | "setup" | "running" | "error" | "exit";

interface UmuSetupOverlayProps {
  visible: boolean;
  phase: UmuPhase;
  gameTitle?: string;
  lines: string[];
  onDismiss: () => void;
}

/**
 * Full-screen overlay shown while umu-launcher is being installed or while
 * `umu-run` performs its first-run setup (downloading UMU-Proton and the
 * Steam runtime). Auto-dismisses once the game/installer actually starts.
 */
export function UmuSetupOverlay({
  visible,
  phase,
  gameTitle,
  lines,
  onDismiss,
}: UmuSetupOverlayProps) {
  if (!visible) return null;

  const installing = phase === "installing";
  const title = installing
    ? "Installing umu launcher…"
    : "Setting up umu launcher…";

  return (
    <Dialog open onClose={() => onDismiss()} size="lg">
      <div className="p-6">
        <div className="flex items-start gap-4">
          <svg
            className="mt-1 h-8 w-8 shrink-0 text-gv-accent motion-safe:animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <div className="min-w-0">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {installing
                ? "umu-launcher lets GameVault run Windows games on Linux. Downloading and setting it up — this can take a moment."
                : gameTitle
                  ? `Preparing the Wine/Proton environment for ${gameTitle}. The first launch downloads UMU-Proton and the Steam runtime, which can take a few minutes.`
                  : "Preparing the Wine/Proton environment. The first launch downloads UMU-Proton and the Steam runtime, which can take a few minutes."}
            </DialogDescription>
          </div>
        </div>

        {lines.length > 0 && (
          <pre className="mt-4 max-h-56 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-950 p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words text-zinc-200 dark:border-zinc-800">
            {lines.join("\n")}
          </pre>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button plain onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
