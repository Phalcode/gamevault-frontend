import { Divider } from "@tw/divider";
import { Heading, Subheading } from "@tw/heading";
import { Input } from "@tw/input";
import { useDownloads } from "@/context/DownloadContext";

export default function Settings() {
  const { speedLimitKB, setSpeedLimitKB, formatSpeed, formatLimit } = useDownloads() as any;
  // speedLimitKB stored directly as KB/s (decimal). 0 = unlimited.
  const kbValue = speedLimitKB;

  return (
    <div className="flex flex-col h-full overflow-auto pb-12">
      <Heading>Settings</Heading>
      <Divider />
      <div className="max-w-xl space-y-8 p-2">
        <section>
          <Subheading level={2}>Downloads</Subheading>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-fg-muted flex flex-col gap-1">
              Download Speed Limit (KB/s). Set 0 for unlimited
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  value={kbValue}
                  onChange={(e: any) => {
                    const raw = parseInt(e.target.value || '0', 10);
                    if (Number.isNaN(raw) || raw <= 0) {
                      setSpeedLimitKB(0); // unlimited
                    } else {
                      setSpeedLimitKB(raw); // store raw KB value
                    }
                  }}
                  placeholder="0 (unlimited)"
                  className="max-w-56"
                />
                {speedLimitKB > 0 && (
                  <span className="text-[10px] text-fg-muted flex flex-col leading-3">
                    <span>{formatLimit(speedLimitKB)}</span>                   
                  </span>
                )}
              </div>
            </label>
          </div>
        </section>
      </div>
    </div>
  );
}
