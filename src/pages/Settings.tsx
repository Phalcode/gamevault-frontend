import { Divider } from "@tw/divider";
import { Heading, Subheading } from "@tw/heading";
import { Input } from "@tw/input";
import { useDownloads } from "@/context/DownloadContext";

export default function Settings() {
  const { speedLimit, setSpeedLimit, formatSpeed, formatBytes } = useDownloads();
  // speedLimit is stored internally as bytes/sec. We present KB/s to the user.
  const kbValue = speedLimit > 0 ? Math.round(speedLimit / 1000) : 0; // decimal KB

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
                      setSpeedLimit(0); // unlimited
                    } else {
                      setSpeedLimit(raw * 1000); // store decimal KB as bytes/sec
                    }
                  }}
                  placeholder="0 (unlimited)"
                  className="max-w-56"
                />
                {speedLimit > 0 && (
                  <span className="text-[10px] text-fg-muted flex flex-col leading-3">
                    <span>{kbValue} KB/s</span>
                    <span className="opacity-70">≈ {formatSpeed(speedLimit)}</span>
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
