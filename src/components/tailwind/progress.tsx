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
}: Readonly<ProgressBarProps>) {
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
      <progress
        value={Math.round(percent)}
        max={100}
        aria-label={label}
        className="block h-2 w-full overflow-hidden rounded-full bg-gv-line text-gv-accent [&::-webkit-progress-bar]:bg-gv-line [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-gv-accent [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-gv-accent"
      />
      {currentFile && (
        <p className="truncate text-xs text-gv-muted" title={currentFile}>
          {currentFile}
        </p>
      )}
    </div>
  );
}
