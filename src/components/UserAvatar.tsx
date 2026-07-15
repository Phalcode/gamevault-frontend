import { Media } from "@/components/Media";
import clsx from "clsx";
import type { ReactNode } from "react";

interface UserAvatarProps {
  media?: { id?: number } | null;
  size: number;
  alt?: string;
  fallback?: ReactNode;
  className?: string;
}

/** Consistent rounded-square user avatar used across the entire app. */
export function UserAvatar({
  media,
  size,
  alt = "",
  fallback,
  className,
}: UserAvatarProps) {
  return (
    <div
      className={clsx(
        "shrink-0 overflow-hidden rounded-[20%]",
        className,
      )}
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
