// ThemeToggle.tsx
import { MoonIcon, SunIcon } from "@heroicons/react/16/solid";
import { Switch, SwitchField, SwitchGroup } from "@tw/switch";
import useDarkMode from "use-dark-mode";

export default function ThemeSwitch({ className }: { className?: string }) {
  const darkMode = useDarkMode(false, {
    classNameDark: "dark",
    classNameLight: "light",
    element:
      typeof document !== "undefined" ? document.documentElement : undefined,
  });

  return (
    <SwitchGroup className={className}>
      <SwitchField>
        <div
          data-slot="label"
          className="flex items-center gap-2 text-sm text-zinc-900 dark:text-zinc-100"
        >
          {darkMode.value ? (
            <MoonIcon className="size-4" aria-hidden="true" />
          ) : (
            <SunIcon className="size-4" aria-hidden="true" />
          )}
          <span>Toggle Theme</span>
        </div>

        <Switch
          aria-label="Toggle dark mode"
          checked={darkMode.value}
          onChange={darkMode.toggle}
          color="dark/zinc"
          className="cursor-pointer"
        />
      </SwitchField>
    </SwitchGroup>
  );
}
