import { Media } from "@/components/Media";
import { createDicebearAvatar } from "@/utils/dicebearAvatar";
import { useStreamerMode } from "@/utils/streamerMode";
import clsx from "clsx";
import { useMemo, type ReactNode } from "react";

interface UserAvatarProps {
  media?: { id?: number } | null;
  size: number;
  alt?: string;
  fallback?: ReactNode;
  className?: string;
  /** Stable per-user identifier used to seed the placeholder avatar. */
  seed?: string;
}

/** Consistent rounded-square user avatar used across the entire app. */
export function UserAvatar({
  media,
  size,
  alt = "",
  fallback,
  className,
  seed,
}: UserAvatarProps) {
  const streamerMode = useStreamerMode();

  // In OPSEC mode the real profile picture must never be shown, and any user
  // without an uploaded avatar gets a deterministic stand-in instead of a
  // blank box or initials derived from an unmasked name.
  const showPlaceholder = streamerMode || !media?.id;
  const placeholderSeed = seed || alt || "anonymous";
  const placeholderSrc = useMemo(
    () => (showPlaceholder ? createDicebearAvatar(placeholderSeed) : ""),
    [showPlaceholder, placeholderSeed],
  );
  if (showPlaceholder) {
    return (
      <div
        className={clsx("shrink-0 overflow-hidden rounded-[20%]", className)}
        style={{ width: size, height: size }}
      >
        <img
          src={placeholderSrc}
          alt={alt}
          width={size}
          height={size}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className={clsx("shrink-0 overflow-hidden rounded-[20%]", className)}
      style={{ width: size, height: size }}
    >
      <Media
        media={media as any}
        size={size}
        square
        fit="cover"
        alt={alt}
        fallback={fallback}
      />
    </div>
  );
}
