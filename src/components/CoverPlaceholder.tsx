import clsx from "clsx";

export const coverPalettes = [
  {
    bg: "linear-gradient(145deg, rgba(116,104,235,0.5), rgba(30,28,48,0.96))",
    border: "rgba(142, 123, 237, 0.36)",
  },
  {
    bg: "linear-gradient(145deg, rgba(84,73,198,0.42), rgba(18,22,36,0.96))",
    border: "rgba(84, 73, 198, 0.34)",
  },
  {
    bg: "linear-gradient(145deg, rgba(177,125,25,0.28), rgba(30,20,37,0.96))",
    border: "rgba(177, 125, 25, 0.32)",
  },
  {
    bg: "linear-gradient(145deg, rgba(40,171,126,0.24), rgba(20,27,40,0.96))",
    border: "rgba(40, 171, 126, 0.28)",
  },
] as const;

export function hashedPalette(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return coverPalettes[Math.abs(hash) % coverPalettes.length];
}

/** Colorful cover placeholder with game initials & pattern */
export default function CoverPlaceholder({
  title,
  size = "normal",
  className,
}: {
  title: string;
  size?: "small" | "normal" | "large";
  className?: string;
}) {
  const palette = hashedPalette(title);
  const initials = title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  const sizeClasses = {
    small: {
      title: "text-[0.55rem]",
      initials: "text-lg mb-0.5",
      padding: "p-1.5",
    },
    normal: {
      title: "text-[0.65rem]",
      initials: "text-xl mb-1",
      padding: "p-2",
    },
    large: {
      title: "text-sm",
      initials: "text-3xl mb-2",
      padding: "p-3",
    },
  };

  return (
    <div
      className={clsx(
        "flex h-full w-full flex-col items-center justify-center rounded-[inherit] border text-center",
        sizeClasses[size].padding,
        className,
      )}
      style={{ background: palette.bg, borderColor: palette.border }}
    >
      <div
        className={clsx(
          "font-black tracking-[0.18em] text-white/90",
          sizeClasses[size].initials,
        )}
      >
        {initials}
      </div>
      <div
        className={clsx(
          "line-clamp-2 max-w-[90%] font-medium uppercase tracking-[0.14em] text-white/65",
          sizeClasses[size].title,
        )}
      >
        {title}
      </div>
    </div>
  );
}
