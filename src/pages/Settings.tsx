import { Divider } from "@tw/divider";
import { Heading, Subheading } from "@tw/heading";
import { Input } from "@tw/input";
import { useDownloads } from "@/context/DownloadContext";
import { SwitchField, Switch } from "@tw/switch";
import { Label } from "@/components/tailwind/fieldset";
import { useEffect, useState } from "react";
import { isTauriApp } from "@/utils/tauri";
import { Button } from "@/components/tailwind/button";
import { FolderIcon } from "@heroicons/react/24/outline";

const RETAIN_KEY = "app_retain_library_prefs";
const DOWNLOAD_PATH_KEY = "tauri_download_path";

export default function Settings() {
  const { speedLimitKB, setSpeedLimitKB, formatSpeed, formatLimit } =
    useDownloads() as any;
  // speedLimitKB stored directly as KB/s (decimal). 0 = unlimited.
  const kbValue = speedLimitKB;
  const [retainLibraryPrefs, setRetainLibraryPrefs] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(RETAIN_KEY);
      return v === "1";
    } catch {
      return false;
    }
  });
  const [downloadPath, setDownloadPath] = useState<string>(() => {
    try {
      return localStorage.getItem(DOWNLOAD_PATH_KEY) || "";
    } catch {
      return "";
    }
  });
  const isTauri = isTauriApp();

  useEffect(() => {
    try {
      localStorage.setItem(RETAIN_KEY, retainLibraryPrefs ? "1" : "0");
    } catch {}
  }, [retainLibraryPrefs]);

  const handleSelectDownloadFolder = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log("=== Browse button clicked ===");
    console.log("isTauri:", isTauri);
    if (!isTauri) {
      console.error("Not in Tauri app, cannot select folder");
      return;
    }
    try {
      console.log("Importing dialog module...");
      const { open } = await import("@tauri-apps/plugin-dialog");
      console.log("Dialog module imported successfully");
      console.log("Opening folder picker...");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Download Directory",
      });
      console.log("Selected path:", selected);
      if (selected && typeof selected === "string") {
        console.log("Setting download path to:", selected);
        console.log("Path type:", typeof selected);
        console.log("Path length:", selected.length);
        console.log(
          "Path characters:",
          selected
            .split("")
            .map((c, i) => `${i}: '${c}' (${c.charCodeAt(0)})`)
            .join(", "),
        );
        setDownloadPath(selected);
        localStorage.setItem(DOWNLOAD_PATH_KEY, selected);

        try {
          const { mkdir } = await import("@tauri-apps/plugin-fs");
          const { join } = await import("@tauri-apps/api/path");
          const gameVaultRoot = await join(selected, "GameVault");
          await mkdir(await join(gameVaultRoot, "Downloads"), {
            recursive: true,
          });
          await mkdir(await join(gameVaultRoot, "Extractions"), {
            recursive: true,
          });
          await mkdir(await join(gameVaultRoot, "Installations"), {
            recursive: true,
          });
        } catch (folderError) {
          console.error("Failed to create GameVault folder structure:", folderError);
        }

        console.log("Download path saved to localStorage");
        console.log(
          "Verifying saved path:",
          localStorage.getItem(DOWNLOAD_PATH_KEY),
        );
      } else {
        console.log("No folder selected or invalid selection");
      }
    } catch (error) {
      console.error("Error selecting download folder:", error);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-auto pb-12">
      <Heading>Settings</Heading>
      <Divider />
      <div className="max-w-xl space-y-8 p-2">
        <section>
          <Subheading level={2}>Downloads</Subheading>
          <div className="flex flex-col gap-4">
            {isTauri && (
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-fg-muted">
                  Download Location
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    value={downloadPath || "No folder selected"}
                    readOnly
                    className="flex-1"
                    placeholder="Select a download folder"
                  />
                  <Button
                    type="button"
                    color="zinc"
                    onClick={handleSelectDownloadFolder}
                  >
                    <FolderIcon className="h-5 w-5" />
                    Browse
                  </Button>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-fg-muted flex flex-col gap-1">
                Download Speed Limit (KB/s). Set 0 for unlimited
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    value={kbValue}
                    onChange={(e: any) => {
                      const raw = parseInt(e.target.value || "0", 10);
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
          </div>
        </section>

        <section>
          <Subheading level={2}>Library</Subheading>
          <div className="flex flex-col gap-4">
            <SwitchField>
              <Switch
                name="retainLibraryPrefs"
                color="indigo"
                aria-label="Retain Library sorting and filter preferences"
                checked={retainLibraryPrefs}
                onChange={(v: boolean) => setRetainLibraryPrefs(v)}
              />
              <Label>Retain Sorting and Filter preferences</Label>
            </SwitchField>
          </div>
        </section>
      </div>
    </div>
  );
}
