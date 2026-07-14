import clsx from "clsx";

interface SkeletonProps {
  className?: string;
  /** h-4 (text), h-8 (heading), h-40 (card), h-96 (large card), etc. */
}

/** A pulsing placeholder for content that is still loading. Respects prefers-reduced-motion. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={clsx(
        "rounded-lg bg-gv-panel-strong motion-safe:animate-pulse",
        className,
      )}
    />
  );
}

/** A text skeleton line of the given width. */
export function SkeletonText({
  width = "w-full",
  className,
}: {
  width?: string;
  className?: string;
}) {
  return <Skeleton className={clsx("h-4", width, className)} />;
}

/** A card-shaped skeleton placeholder. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <Skeleton
      className={clsx(
        "aspect-3/4 w-full rounded-3xl",
        className,
      )}
    />
  );
}
