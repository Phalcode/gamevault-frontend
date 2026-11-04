import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useGamepad } from "@/context/GamepadContext";
import { DURATION_BASE, EASE_OUT } from "@/lib/motion";

/**
 * Console-style control hints. Shown while a controller is connected and in
 * use, hidden again after mouse/touch input or a period without gamepad
 * activity, so it stays discoverable without becoming permanent chrome.
 */
export function GamepadHints() {
  const { connected, active } = useGamepad();
  const visible = connected && active;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: DURATION_BASE, ease: EASE_OUT }}
          className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
          aria-hidden="true"
        >
          <div className="flex max-w-full flex-wrap items-center justify-center gap-x-4 gap-y-1.5 rounded-2xl border border-gv-line bg-gv-panel/85 px-4 py-2 text-gv-muted shadow-(--shadow-card) backdrop-blur-xl">
            <Hint button="A" label="Select" />
            <Hint button="B" label="Back" />
            <Hint button="X" label="Actions" />
            <Hint button="LB / RB" label="Sections" />
            <Hint button="LT / RT" label="Scroll" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Hint({ button, label }: { button: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <Key>{button}</Key>
      <span className="text-xs font-medium">{label}</span>
    </span>
  );
}

function Key({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-6 min-w-6 items-center justify-center rounded-md border border-gv-line-strong bg-gv-panel-soft px-1.5 text-[11px]/none font-semibold tracking-wide text-gv-text">
      {children}
    </span>
  );
}
