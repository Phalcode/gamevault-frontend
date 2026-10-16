import clsx from "clsx";

/**
 * A settings field laid out as a row: label and description on the left, the
 * control right-aligned in a fixed column so every row of a group lines up.
 * Used for the grouped fields of the game settings.
 */
export function SettingsRow({
  label,
  description,
  className,
  children,
}: {
  label: string;
  description?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={clsx(
        "flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-6",
        className,
      )}
    >
      <div className="sm:pt-1.5">
        <p className="text-sm font-medium text-gv-text">{label}</p>
        {description ? (
          <p className="mt-0.5 text-xs leading-5 text-gv-muted">
            {description}
          </p>
        ) : null}
      </div>
      <div className="w-full sm:w-80 sm:shrink-0">{children}</div>
    </div>
  );
}

/** Bordered card holding `SettingsRow`s, separated by hairlines. */
export function SettingsRowGroup({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={clsx(
        "divide-y divide-gv-line overflow-hidden rounded-2xl border border-gv-line bg-gv-panel",
        className,
      )}
    >
      {children}
    </div>
  );
}
