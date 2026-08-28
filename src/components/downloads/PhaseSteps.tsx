import { Fragment } from "react";
import clsx from "clsx";
import {
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";

export type StepState = "pending" | "active" | "done" | "error";

export type PhaseStep = {
  id: string;
  label: string;
  state: StepState;
  valueText?: string;
};

function StepIcon({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <CheckCircleIcon
        className="size-5 shrink-0 text-gv-success"
        aria-hidden="true"
      />
    );
  }
  if (state === "error") {
    return (
      <ExclamationTriangleIcon
        className="size-5 shrink-0 text-gv-danger"
        aria-hidden="true"
      />
    );
  }
  if (state === "active") {
    return (
      <ClockIcon
        className="size-5 shrink-0 text-gv-accent"
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className="flex size-5 shrink-0 items-center justify-center"
      aria-hidden="true"
    >
      <span className="size-2.5 rounded-full bg-gv-line" />
    </span>
  );
}

export function PhaseSteps({ steps }: { steps: PhaseStep[] }) {
  return (
    <ol className="flex items-center gap-2 sm:gap-3" aria-label="Download phases">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const labelClass =
          step.state === "error"
            ? "text-gv-danger"
            : step.state === "pending"
              ? "text-gv-muted"
              : "text-gv-text";
        return (
          <Fragment key={step.id}>
            <li
              aria-current={step.state === "active" ? "step" : undefined}
              className="flex min-w-0 items-center gap-2"
            >
              <StepIcon state={step.state} />
              <span className="min-w-0">
                <span
                  className={clsx(
                    "block truncate text-xs font-semibold tracking-[-0.01em]",
                    labelClass,
                  )}
                >
                  {step.label}
                </span>
                {step.valueText && (
                  <span className="block truncate text-[11px] tabular-nums text-gv-muted">
                    {step.valueText}
                  </span>
                )}
              </span>
            </li>
            {!isLast && (
              <li
                aria-hidden="true"
                className={clsx(
                  "h-px min-w-6 flex-1 rounded-full",
                  step.state === "done" ? "bg-gv-success/70" : "bg-gv-line",
                )}
              />
            )}
          </Fragment>
        );
      })}
    </ol>
  );
}
