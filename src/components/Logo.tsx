import useDarkMode from "use-dark-mode";
import { SidebarItem } from "./tailwind/sidebar";

type LogoVariant = "logo" | "plus" | "text" | "sidebar";

interface LogoProps {
  variant?: LogoVariant;
  alt?: string;
  className?: string;
  wrapperClassName?: string;
  height?: string; // e.g. "h-8"
  gap?: string; // e.g. "gap-2"
}

export function Logo({
  variant = "logo",
  alt = "Logo",
  className = "",
  wrapperClassName = "",
  height = "h-8",
  gap = "gap-2",
}: LogoProps) {
  // keep Tailwind's .dark class in sync with the hook
  const darkMode = useDarkMode(false, {
    classNameDark: "dark",
    classNameLight: "light",
    element:
      typeof document !== "undefined" ? document.documentElement : undefined,
  });

  const srcText = `/logo-text-${darkMode.value ? "dark" : "light"}.svg`;

  if (variant === "sidebar") {
    return (
      <SidebarItem href="/library">
        <img src="/logo.svg" alt={alt} className={`${height} ${className}`} />
        <img
          key={srcText}
          src={srcText}
          alt={`${alt} text`}
          className={`${height} ${className}`}
        />
      </SidebarItem>
    );
  }

  let src = "";
  switch (variant) {
    case "plus":
      src = "/logo-plus.svg";
      break;
    case "text":
      src = srcText;
      break;
    default:
      src = "/logo.svg";
  }

  return (
    <img key={src} src={src} alt={alt} className={`${height} ${className}`} />
  );
}
