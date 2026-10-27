import { setStreamerMode, useStreamerMode } from "@/utils/streamerMode";
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
          onChange={setStreamerMode}
          color="dark/zinc"
          className="cursor-pointer"
        />
      </SwitchField>
    </SwitchGroup>
  );
}
