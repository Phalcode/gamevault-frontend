import { isDebugTauriOverride, setDebugTauriOverride } from "@/utils/tauri";
import { ComputerDesktopIcon } from "@heroicons/react/16/solid";
import { Switch, SwitchField, SwitchGroup } from "@tw/switch";
import { useCallback, useEffect, useState } from "react";

export default function TauriDebugSwitch({
  className,
}: {
  className?: string;
}) {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setChecked(isDebugTauriOverride());
  }, []);

  const handleChange = useCallback((next: boolean) => {
    setChecked(next);
    setDebugTauriOverride(next);
    // Force a full page reload so all components pick up the new mode
    window.location.reload();
  }, []);

  return (
    <SwitchGroup className={className}>
      <SwitchField>
        <div
          data-slot="label"
          className="flex items-center gap-2 text-sm text-gv-muted"
        >
          <ComputerDesktopIcon className="size-4" aria-hidden="true" />
          <span>Simulate Desktop</span>
        </div>

        <Switch
          aria-label="Toggle Tauri desktop simulation mode"
          checked={checked}
          onChange={handleChange}
          color="dark/zinc"
          className="cursor-pointer"
        />
      </SwitchField>
    </SwitchGroup>
  );
}
