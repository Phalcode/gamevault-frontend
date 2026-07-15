import { Divider } from "@tw/divider";
import { Heading } from "@tw/heading";
import { Input } from "@tw/input";
import { useDownloads } from "@/context/DownloadContext";
import { SwitchField, Switch } from "@tw/switch";
import { Field, Fieldset, Label, Legend } from "@/components/tailwind/fieldset";
import { Text } from "@/components/tailwind/text";
import { useEffect, useState } from "react";
import { isTauriApp } from "@/utils/tauri";
import { isDebugTauriOverride, setDebugTauriOverride } from "@/utils/tauri";
import { Button } from "@/components/tailwind/button";
import ThemeSelect from "@/components/ThemeSelect";
import {
  FolderArrowDownIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  ComputerDesktopIcon,
} from "@heroicons/react/24/outline";

const RETAIN_KEY = "app_retain_library_prefs";
const DOWNLOAD_PATH_KEY = "tauri_download_path";

export default function Settings() {
  const { speedLimitKB, setSpeedLimitKB, formatSpeed, formatLimit } =
    useDownloads() as any;
  const kbValue = speedLimitKB;
  const [retainLibraryPrefs, setRetainLibraryPrefs] = useState<boolean>(() => {
    try {
      return localStorage.getItem(RETAIN_KEY) === "1";
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
  const [pathCopied, setPathCopied] = useState(false);
  const isTauri = isTauriApp();

  useEffect(() => {
    try {
      localStorage.setItem(RETAIN_KEY, retainLibraryPrefs ? "1" : "0");
    } catch {
      console.warn("Failed to persist retain library prefs");
    }
  }, [retainLibraryPrefs]);

  const handleSpeedChange = (raw: number) => {
    if (Number.isNaN(raw) || raw <= 0) {
      setSpeedLimitKB(0);
    } else {
      setSpeedLimitKB(raw);
    }
  };

  const handleSelectDownloadFolder = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isTauri) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Download Directory",
      });
      if (selected && typeof selected === "string") {
        setDownloadPath(selected);
        localStorage.setItem(DOWNLOAD_PATH_KEY, selected);

        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const { join } = await import("@tauri-apps/api/path");
          const gameVaultRoot = await join(selected, "GameVault");
          await invoke("fs_create_dir_all", { path: gameVaultRoot });
        } catch {
          // Folder creation is best-effort; settings save succeeded
        }
      }
    } catch (error) {
      console.error("Error selecting download folder:", error);
    }
  };

  const handleCopyPath = async () => {
    if (!downloadPath) return;
    try {
      await navigator.clipboard.writeText(downloadPath);
      setPathCopied(true);
      setTimeout(() => setPathCopied(false), 2000);
    } catch {
      // Clipboard API unavailable
    }
  };

  // Truncate path for display: show last 2 segments
  const displayPath = downloadPath
    ? downloadPath.split(/[\\/]/).slice(-2).join("/")
    : "No folder selected";

  return (
    <div className="flex min-h-full flex-col gap-6">
      <Heading>Settings</Heading>
      <Text className="mt-1 max-w-2xl">
        Configure download paths, speed limits, and library preferences.
      </Text>
      <Divider />

      <div className="max-w-2xl space-y-6">
        {/* Downloads Section */}
        <section className="rounded-2xl border border-gv-line bg-gv-panel p-6">
          <Fieldset>
            <Legend>Downloads</Legend>
            <Text className="mt-1">
              Configure where games are saved and manage transfer speeds.
            </Text>

            {isTauri && (
              <Field className="mt-6">
                <Label>Download folder</Label>
                <Text className="mb-2">
                  Game files will be stored in a GameVault subfolder at this
                  location.
                </Text>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Input
                      type="text"
                      value={downloadPath}
                      readOnly
                      className="pr-16"
                      placeholder="Select a download folder"
                      title={downloadPath || undefined}
                    />
                    {downloadPath && (
                      <button
                        type="button"
                        onClick={handleCopyPath}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl p-2 text-gv-muted transition-colors hover:bg-gv-panel-soft hover:text-gv-text cursor-pointer"
                        aria-label={pathCopied ? "Path copied" : "Copy path to clipboard"}
                      >
                        {pathCopied ? (
                          <CheckIcon className="h-4 w-4 text-green-400" />
                        ) : (
                          <ClipboardDocumentIcon className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </div>
                  <Button
                    type="button"
                    color="zinc"
                    onClick={handleSelectDownloadFolder}
                  >
                    <FolderArrowDownIcon className="h-5 w-5" />
                    Browse
                  </Button>
                </div>
                {downloadPath && (
                  <Text className="mt-1 text-xs">
                    {displayPath}
                  </Text>
                )}
              </Field>
            )}

            <Field className="mt-8">
              <Label>Download speed limit</Label>
              <Text className="mb-2">
                Limit the bandwidth used for game downloads. Set to 0 for no
                limit.
              </Text>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  value={kbValue}
                  onChange={(e: any) =>
                    handleSpeedChange(parseInt(e.target.value || "0", 10))
                  }
                  placeholder="0 (unlimited)"
                  className="max-w-36"
                />
                <span className="text-xs text-gv-muted">KB/s</span>
                {speedLimitKB > 0 && (
                  <span className="rounded-full bg-gv-panel-soft px-2.5 py-1 text-xs text-gv-muted">
                    {formatLimit(speedLimitKB)}
                  </span>
                )}
              </div>
            </Field>
          </Fieldset>
        </section>

        {/* Library Section */}
        <section className="rounded-2xl border border-gv-line bg-gv-panel p-6">
          <Fieldset>
            <Legend>Library</Legend>
            <Text className="mt-1">
              Control how your game library behaves across sessions.
            </Text>

            <Field className="mt-6">
              <SwitchField>
                <Switch
                  name="retainLibraryPrefs"
                  color="indigo"
                  aria-label="Retain Library sorting and filter preferences"
                  checked={retainLibraryPrefs}
                  onChange={(v: boolean) => setRetainLibraryPrefs(v)}
                />
                <Label>Retain sorting and filter preferences</Label>
              </SwitchField>
            </Field>
          </Fieldset>
        </section>

        {/* Appearance Section */}
        <section className="rounded-2xl border border-gv-line bg-gv-panel p-6">
          <Fieldset>
            <Legend>Appearance</Legend>
            <Text className="mt-1">
              Customize how GameVault looks on your device.
            </Text>

            <Field className="mt-6">
              <Label>Theme</Label>
              <Text className="mb-2">
                Choose between light, dark, or follow your device settings.
              </Text>
              <ThemeSelect className="max-w-56" />
            </Field>

          </Fieldset>
        </section>

        {/* Dev Tools — only visible in development builds */}
        {import.meta.env.DEV && (
          <section className="rounded-2xl border border-gv-warning/30 bg-gv-warning/5 p-6">
            <Fieldset>
              <Legend className="flex items-center gap-2 text-gv-warning">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="size-4 shrink-0">
                  <path fillRule="evenodd" d="M6.701 2.25c.577-1 2.02-1 2.598 0l5.196 9a1.5 1.5 0 0 1-1.299 2.25H2.804a1.5 1.5 0 0 1-1.3-2.25l5.197-9ZM8 4a.75.75 0 0 1 .75.75v3a.75.75 0 1 1-1.5 0v-3A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
                </svg>
                Developer Tools
              </Legend>
              <Text className="mt-1">
                These options are only visible in development builds and will not appear in production.
              </Text>

              <Field className="mt-6">
                <SwitchField>
                  <Switch
                    name="simulateDesktop"
                    color="indigo"
                    aria-label="Simulate Tauri desktop app mode"
                    checked={isDebugTauriOverride()}
                    onChange={(v: boolean) => {
                      setDebugTauriOverride(v);
                      window.location.reload();
                    }}
                  />
                  <Label>
                    <span className="inline-flex items-center gap-1.5">
                      <ComputerDesktopIcon className="size-4" />
                      Simulate Desktop App
                    </span>
                  </Label>
                </SwitchField>
                <Text className="mt-1">
                  Preview how GameVault looks and behaves as a native desktop application.
                </Text>
              </Field>
            </Fieldset>
          </section>
        )}

        {/* Version */}
        <p className="px-1 text-xs text-gv-muted">
          GameVault Web UI&nbsp;&nbsp;
          <a
            href={`https://github.com/Phalcode/gamevault-frontend/releases/tag/${__APP_VERSION__}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gv-text underline underline-offset-2 transition-colors"
          >
            v{__APP_VERSION__}
          </a>
        </p>
      </div>
    </div>
  );
}
