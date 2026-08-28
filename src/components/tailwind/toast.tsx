import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import type React from "react";
import { motion, type HTMLMotionProps } from "motion/react";
import { DURATION_FAST, DURATION_SLOW, EASE_OUT } from "@/lib/motion";
import { isTauriApp } from "@/utils/tauri";

export type ToastTone = "info" | "success" | "warning" | "danger";

const tones: Record<
  ToastTone,
  {
    rail: string;
    icon: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  info: {
    rail: "bg-gv-accent",
    icon: "bg-gv-accent/15 text-gv-accent",
    Icon: InformationCircleIcon,
  },
  success: {
    rail: "bg-gv-success",
    icon: "bg-gv-success/15 text-gv-success",
    Icon: CheckCircleIcon,
  },
  warning: {
    rail: "bg-gv-warning",
    icon: "bg-gv-warning/15 text-gv-warning",
    Icon: ExclamationTriangleIcon,
  },
  danger: {
    rail: "bg-gv-danger",
    icon: "bg-gv-danger/15 text-gv-danger",
    Icon: XCircleIcon,
  },
};

/**
 * Non-blocking floating toast, aligned to GameVault's design language.
 *
 * - Raised panel surface (`gv-panel-strong`) with a 1px cool border and the
 *   shared shell shadow, instead of a flat `bg-gv-panel` + generic `shadow-lg`.
 * - A left accent rail + tinted icon tile carry the semantic tone without
 *   relying on color alone (accessibility requirement).
 * - 16px surface radius and the project-wide easing curve / durations.
 * - Reduced-motion is handled globally via `MotionConfig reducedMotion="user"`.
 */
export function Toast({
  tone = "info",
  title,
  description,
  onDismiss,
  className,
  ...props
}: {
  tone?: ToastTone;
  title: string;
  description?: string;
  onDismiss?: () => void;
  className?: string;
} & HTMLMotionProps<"div">) {
  const { rail, icon, Icon } = tones[tone];

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6, transition: { duration: DURATION_FAST } }}
      transition={{ duration: DURATION_SLOW, ease: EASE_OUT }}
      role="status"
      {...props}
      className={clsx(
        className,
        "pointer-events-auto fixed right-4 z-50 flex w-[min(90vw,360px)] items-start gap-2.5 overflow-hidden rounded-2xl border border-gv-line bg-gv-panel-strong py-3 pr-2 pl-4 shadow-(--shadow-shell)",
        // In the desktop app the custom window titlebar (36px) owns the top
        // right corner, so keep toasts below it instead of covering the
        // window controls.
        isTauriApp() ? "top-13" : "top-4",
      )}
    >
      {/* Accent rail: semantic tone signal (paired with the icon for a11y) */}
      <span className={clsx("absolute inset-y-0 left-0 w-0.75", rail)} />

      <span
        className={clsx(
          "flex size-9 shrink-0 items-center justify-center rounded-xl",
          icon,
        )}
      >
        <Icon className="size-5" />
      </span>

      <div className="min-w-0 flex-1 py-0.5">
        <p className="text-sm font-semibold tracking-[-0.01em] text-gv-text">
          {title}
        </p>
        {description && (
          <p className="mt-0.5 text-sm text-gv-muted">{description}</p>
        )}
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="flex size-9 shrink-0 items-center justify-center rounded-xl text-gv-muted transition-colors hover:bg-gv-panel-soft hover:text-gv-text focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gv-accent-cool"
        >
          <XMarkIcon className="size-4" />
          <span className="sr-only">Dismiss</span>
        </button>
      )}
    </motion.div>
  );
}

export default Toast;
