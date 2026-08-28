import clsx from "clsx";

type ProgressBarProps = {
  /** Current progress value, 0–100. Null/undefined renders an empty bar. */
  value: number | null | undefined;
  /** Left-side caption, e.g. "Extraction". */
  label?: string;
  /** Right-side value, e.g. "45.2%". Rendered with tabular numerals. */
  valueText?: string;
  /** Current file or extra detail rendered below the bar. */
  currentFile?: string;
  className?: string;
};

export function ProgressBar({
  value,
  label,
  valueText,
  currentFile,
  className,
}: ProgressBarProps) {
  const percent =
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(100, Math.max(0, value))
      : 0;

  return (
    <div className={clsx("space-y-1.5", className)}>
      {(label || valueText) && (
        <div className="flex items-center justify-between gap-3 text-xs text-gv-muted">
          <span className="truncate">{label}</span>
          {valueText && (
            <span className="shrink-0 tabular-nums">{valueText}</span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-label={label}
        className="relative h-2 w-full overflow-hidden rounded-full bg-gv-line"
      >
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-gv-accent transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
      {currentFile && (
        <p className="truncate text-xs text-gv-muted" title={currentFile}>
          {currentFile}
        </p>
      )}
    </div>
  );
}
