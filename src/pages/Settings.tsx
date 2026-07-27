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
import { isAnalyticsEnabled, setAnalyticsEnabled } from "@/utils/analytics";
import {
  type RootPathEntry,
  getRootPaths,
  addRootPath,
  removeRootPath,
  updateRootPath,
  updateRootPathLabel,
} from "@/utils/rootPaths";
import {
  FolderArrowDownIcon,
  ComputerDesktopIcon,
  ChartBarIcon,
  PlusIcon,
  XMarkIcon,
  TagIcon,
  FolderIcon,
} from "@heroicons/react/24/outline";

const RETAIN_KEY = "app_retain_library_prefs";
const AUTOSTART_MINIMIZED_KEY = "tauri_start_minimized";
const AUTO_EXTRACT_KEY = "tauri_auto_extract";
const AUTO_INSTALL_KEY = "tauri_auto_install";
const AUTO_DELETE_SOURCE_KEY = "tauri_auto_delete_source";

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
  const [analyticsConsent, setAnalyticsConsent] = useState<boolean>(() => {
    return isAnalyticsEnabled();
  });
  const [rootPaths, setRootPaths] = useState<RootPathEntry[]>(() =>
    getRootPaths(),
  );
  const [autostartEnabled, setAutostartEnabled] = useState<boolean | null>(
    null,
  );
  const [startMinimized, setStartMinimized] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTOSTART_MINIMIZED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [autoExtract, setAutoExtract] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTO_EXTRACT_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [autoInstall, setAutoInstall] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTO_INSTALL_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [autoDeleteSource, setAutoDeleteSource] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTO_DELETE_SOURCE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const isTauri = isTauriApp();

  useEffect(() => {
    try {
      localStorage.setItem(RETAIN_KEY, retainLibraryPrefs ? "1" : "0");
    } catch {
      console.warn("Failed to persist retain library prefs");
    }
  }, [retainLibraryPrefs]);

  // Initialize autostart state from the Tauri plugin
  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    (async () => {
      try {
        const { isEnabled } = await import("@tauri-apps/plugin-autostart");
        const enabled = await isEnabled();
        if (!cancelled) setAutostartEnabled(enabled);
      } catch (e) {
        console.error("Failed to check autostart status:", e);
        if (!cancelled) setAutostartEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isTauri]);

  // Sync startMinimized to Rust backend config file
  useEffect(() => {
    if (!isTauri) return;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("set_start_minimized", { minimized: startMinimized });
      } catch (e) {
        console.error("Failed to sync start minimized preference:", e);
      }
    })();
  }, [startMinimized, isTauri]);

  // Persist startMinimized to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(AUTOSTART_MINIMIZED_KEY, startMinimized ? "1" : "0");
    } catch {
      console.warn("Failed to persist start minimized preference");
    }
  }, [startMinimized]);

  // Persist auto-flow settings to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(AUTO_EXTRACT_KEY, autoExtract ? "1" : "0");
    } catch {
      console.warn("Failed to persist auto-extract preference");
    }
  }, [autoExtract]);

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_INSTALL_KEY, autoInstall ? "1" : "0");
    } catch {
      console.warn("Failed to persist auto-install preference");
    }
  }, [autoInstall]);

  useEffect(() => {
    try {
      localStorage.setItem(
        AUTO_DELETE_SOURCE_KEY,
        autoDeleteSource ? "1" : "0",
      );
    } catch {
      console.warn("Failed to persist auto-delete preference");
    }
  }, [autoDeleteSource]);

  const handleSpeedChange = (raw: number) => {
    if (Number.isNaN(raw) || raw <= 0) {
      setSpeedLimitKB(0);
    } else {
      setSpeedLimitKB(raw);
    }
  };

  const handleAddRootPath = async (e: React.MouseEvent) => {
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
        const updated = addRootPath(selected);
        setRootPaths(updated);

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

  const handleBrowseRootPath = async (id: string) => {
    if (!isTauri) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Download Directory",
      });
      if (selected && typeof selected === "string") {
        const updated = updateRootPath(id, selected);
        setRootPaths(updated);

        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const { join } = await import("@tauri-apps/api/path");
          const gameVaultRoot = await join(selected, "GameVault");
          await invoke("fs_create_dir_all", { path: gameVaultRoot });
        } catch {
          // Folder creation is best-effort
        }
      }
    } catch (error) {
      console.error("Error re-selecting download folder:", error);
    }
  };

  const handleRemoveRootPath = (id: string) => {
    const updated = removeRootPath(id);
    setRootPaths(updated);
  };

  const handleLabelChange = (id: string, label: string) => {
    const updated = updateRootPathLabel(id, label);
    setRootPaths(updated);
  };

  return (
    <div className="flex min-h-full flex-col gap-6">
      <Heading>Settings</Heading>
      <Text className="mt-1 max-w-2xl">
        Configure download paths, speed limits, and library preferences.
      </Text>
      <Divider />

      <div className="max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Downloads Section */}
        <section className="rounded-2xl border border-gv-line bg-gv-panel p-6">
          <Fieldset>
            <Legend>Downloads</Legend>
            <Text className="mt-1">
              Configure where games are saved and manage transfer speeds.
            </Text>

            {isTauri && (
              <Field className="mt-6">
                <Label>Download folders</Label>
                <Text className="mb-2">
                  Game files will be stored in a GameVault subfolder at each
                  location.
                </Text>

                {rootPaths.length === 0 && (
                  <div className="flex items-center gap-2 rounded-xl border border-dashed border-gv-line p-4 text-sm text-gv-muted">
                    <FolderIcon className="h-5 w-5 shrink-0" />
                    No download folders configured. Click below to add one.
                  </div>
                )}

                <div className="space-y-2">
                  {rootPaths.map((root) => (
                    <div
                      key={root.id}
                      className="flex flex-col gap-2 rounded-xl border border-gv-line bg-gv-panel-soft p-3"
                    >
                      <div className="flex items-center gap-2">
                        {/* Label input */}
                        <div className="relative flex-shrink-0">
                          <TagIcon className="absolute left-2 top-1/2 h-4 w-4 stroke-[1.8] -translate-y-1/2 text-gv-muted" />
                          <Input
                            type="text"
                            value={root.label}
                            onChange={(e: any) =>
                              handleLabelChange(root.id, e.target.value)
                            }
                            placeholder="Label"
                            className="w-24 pl-7 text-xs"
                            aria-label="Label for this download folder"
                          />
                        </div>

                        {/* Browse button */}
                        <Button
                          type="button"
                          color="zinc"
                          className="text-xs shrink-0"
                          onClick={() => handleBrowseRootPath(root.id)}
                        >
                          <FolderArrowDownIcon className="h-4 w-4 stroke-[1.8]" />
                          Choose
                        </Button>

                        {/* Remove button */}
                        <button
                          type="button"
                          onClick={() => handleRemoveRootPath(root.id)}
                          className="rounded-xl p-1.5 text-gv-muted hover:bg-red-500/10 hover:text-red-400 transition-colors cursor-pointer"
                          aria-label="Remove download folder"
                        >
                          <XMarkIcon className="h-4 w-4" />
                        </button>
                      </div>
                      <Text className="text-xs text-gv-muted break-all">
                        {root.path}
                      </Text>
                    </div>
                  ))}
                </div>

                <div className="mt-3">
                  <Button
                    type="button"
                    color="indigo"
                    onClick={handleAddRootPath}
                  >
                    <PlusIcon className="h-4 w-4" />
                    Add Root Directory
                  </Button>
                </div>
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

        {/* Privacy & Analytics Section */}
        <section className="rounded-2xl border border-gv-line bg-gv-panel p-6">
          <Fieldset>
            <Legend className="flex items-center gap-2">
              <ChartBarIcon className="size-5" />
              Privacy &amp; Analytics
            </Legend>
            <Text className="mt-1">
              Control how data is shared to help improve GameVault.
            </Text>

            <Field className="mt-6">
              <SwitchField>
                <Switch
                  name="analyticsConsent"
                  color="indigo"
                  aria-label="Enable anonymous usage analytics"
                  checked={analyticsConsent}
                  onChange={(v: boolean) => {
                    setAnalyticsEnabled(v);
                    setAnalyticsConsent(v);
                  }}
                />
                <Label>Send anonymous usage analytics</Label>
                <Text className="mt-1">
                  We collect anonymous data about how you use GameVault, like
                  which features you use and whether errors occur. This helps us
                  understand what to improve. No personal information is ever
                  collected. Changes take effect after{" "}
                  {isTauri ? "restarting the app" : "reloading"}.
                </Text>
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

        {/* Desktop Section — Tauri only */}
        {isTauri && (
          <section className="rounded-2xl border border-gv-line bg-gv-panel p-6">
            <Fieldset>
              <Legend className="flex items-center gap-2">
                <ComputerDesktopIcon className="size-5" />
                Desktop
              </Legend>
              <Text className="mt-1">
                Configure how GameVault behaves on your desktop.
              </Text>

              <Field className="mt-6">
                <SwitchField>
                  <Switch
                    name="autostart"
                    color="indigo"
                    aria-label="Launch GameVault on computer startup"
                    checked={autostartEnabled ?? false}
                    disabled={autostartEnabled === null}
                    onChange={async (v: boolean) => {
                      setAutostartEnabled(v);
                      try {
                        const { enable, disable } =
                          await import("@tauri-apps/plugin-autostart");
                        if (v) {
                          await enable();
                        } else {
                          await disable();
                          // Force start-minimized off when autostart is disabled
                          setStartMinimized(false);
                        }
                      } catch (e) {
                        console.error("Failed to update autostart:", e);
                        setAutostartEnabled(!v); // Revert on failure
                      }
                    }}
                  />
                  <Label>Launch GameVault on Computer Startup</Label>
                </SwitchField>
                <Text className="mt-1">
                  Automatically start GameVault when you log in to your
                  computer.
                </Text>
              </Field>

              <Field className="mt-6">
                <SwitchField>
                  <Switch
                    name="startMinimized"
                    color="indigo"
                    aria-label="Minimize GameVault to system tray on startup"
                    checked={startMinimized}
                    disabled={!autostartEnabled}
                    onChange={(v: boolean) => setStartMinimized(v)}
                  />
                  <Label>Minimize GameVault to System Tray on Startup</Label>
                </SwitchField>
                <Text className="mt-1">
                  When auto-start is enabled, GameVault will start silently in
                  the system tray instead of opening the full window.
                </Text>
              </Field>

              <Field className="mt-6">
                <SwitchField>
                  <Switch
                    name="autoExtract"
                    color="indigo"
                    aria-label="Automatically extract downloaded archives"
                    checked={autoExtract}
                    onChange={(v: boolean) => setAutoExtract(v)}
                  />
                  <Label>Auto-Extract Downloads</Label>
                </SwitchField>
                <Text className="mt-1">
                  Automatically extract archives as soon as a download finishes.
                  Password-protected archives will still require manual
                  extraction.
                </Text>
              </Field>

              <Field className="mt-6">
                <SwitchField>
                  <Switch
                    name="autoInstall"
                    color="indigo"
                    aria-label="Automatically install games after extraction"
                    checked={autoInstall}
                    onChange={(v: boolean) => setAutoInstall(v)}
                  />
                  <Label>Auto-Install Games</Label>
                </SwitchField>
                <Text className="mt-1">
                  After extraction, automatically copy portable games or launch
                  installers for setup games.
                </Text>
              </Field>

              <Field className="mt-6">
                <SwitchField>
                  <Switch
                    name="autoDeleteSource"
                    color="indigo"
                    aria-label="Delete downloaded and extracted files after portable game install"
                    checked={autoDeleteSource}
                    onChange={(v: boolean) => setAutoDeleteSource(v)}
                  />
                  <Label>Auto-Delete Source Files</Label>
                </SwitchField>
                <Text className="mt-1">
                  After a portable game is installed, delete the downloaded
                  archive and extracted files to save disk space. Does not apply
                  to setup-based games.
                </Text>
              </Field>
            </Fieldset>
          </section>
        )}

        {/* Dev Tools — only visible in development builds */}
        {import.meta.env.DEV && (
          <section className="rounded-2xl border border-gv-warning/30 bg-gv-warning/5 p-6 lg:col-span-2">
            <Fieldset>
              <Legend className="flex items-center gap-2 text-gv-warning">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="size-4 shrink-0"
                >
                  <path
                    fillRule="evenodd"
                    d="M6.701 2.25c.577-1 2.02-1 2.598 0l5.196 9a1.5 1.5 0 0 1-1.299 2.25H2.804a1.5 1.5 0 0 1-1.3-2.25l5.197-9ZM8 4a.75.75 0 0 1 .75.75v3a.75.75 0 1 1-1.5 0v-3A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                    clipRule="evenodd"
                  />
                </svg>
                Developer Tools
              </Legend>
              <Text className="mt-1">
                These options are only visible in development builds and will
                not appear in production.
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
                  Preview how GameVault looks and behaves as a native desktop
                  application.
                </Text>
              </Field>
            </Fieldset>
          </section>
        )}

        {/* Version */}
        <p className="px-1 text-xs text-gv-muted lg:col-span-2">
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
