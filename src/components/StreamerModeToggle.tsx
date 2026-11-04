import { setStreamerMode, useStreamerMode } from "@/utils/streamerMode";
import { trackEvent } from "@/utils/analytics";
import { Switch, SwitchField, SwitchGroup } from "@tw/switch";

export default function StreamerModeToggle({
  className,
}: {
  className?: string;
}) {
  const streamerMode = useStreamerMode();

  return (
    <SwitchGroup className={className}>
      <SwitchField>
        <Switch
          aria-label="Streamer / OPSEC Mode"
          checked={streamerMode}
          onChange={(value: boolean) => {
            setStreamerMode(value);
            trackEvent("streamer_mode_changed", { enabled: value });
          }}
          color="dark/zinc"
          className="cursor-pointer"
        />
      </SwitchField>
    </SwitchGroup>
  );
}
