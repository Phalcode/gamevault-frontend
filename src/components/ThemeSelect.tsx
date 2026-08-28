import { getStoredTheme, applyTheme, type ThemeMode } from "@/utils/theme";
import {
  ComputerDesktopIcon,
  MoonIcon,
  SunIcon,
} from "@heroicons/react/16/solid";
import { Listbox, ListboxLabel, ListboxOption } from "@tw/listbox";
import { useCallback, useEffect, useState } from "react";

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: typeof SunIcon }[] = [
  { value: "system", label: "System", icon: ComputerDesktopIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
];

export default function ThemeSelect({ className }: { className?: string }) {
  const [theme, setTheme] = useState<ThemeMode>(getStoredTheme);

  useEffect(() => {
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => applyTheme("system");
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [theme]);

  const handleChange = useCallback((val: ThemeMode) => {
    setTheme(val);
    applyTheme(val);
  }, []);

  return (
    <Listbox
      name="theme"
      value={theme}
      onChange={handleChange}
      className={className}
    >
      {THEME_OPTIONS.map((opt) => (
        <ListboxOption key={opt.value} value={opt.value}>
          <opt.icon className="size-4" />
          <ListboxLabel>{opt.label}</ListboxLabel>
        </ListboxOption>
      ))}
    </Listbox>
  );
}
