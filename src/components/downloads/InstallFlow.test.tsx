// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GamevaultGameTypeEnum } from "@/api/models/GamevaultGame";
import type { ActiveDownload } from "@/context/DownloadContext";
import { InstallFlow } from "./InstallFlow";
import type { InstallCardState } from "./install-utils";

const mocks = vi.hoisted(() => ({
  openLaunchLogWindow: vi.fn(async () => {}),
  showAlert: vi.fn(async () => false),
  copyInstallationFiles: vi.fn(),
  launchInstallationExecutable: vi.fn(),
}));

vi.mock("@/context/DownloadContext", () => ({
  useDownloads: () => ({
    copyInstallationFiles: mocks.copyInstallationFiles,
    launchInstallationExecutable: mocks.launchInstallationExecutable,
  }),
}));
vi.mock("@/context/AlertDialogContext", () => ({
  useAlertDialog: () => ({ showAlert: mocks.showAlert }),
}));
vi.mock("@/utils/launchLog", () => ({
  openLaunchLogWindow: mocks.openLaunchLogWindow,
}));

const setupState: InstallCardState = {
  mode: "setup",
  forcedType: GamevaultGameTypeEnum.windows_setup,
  installerOptions: ["setup.exe"],
  selectedInstaller: "setup.exe",
  loadingInstallers: false,
};

const failedDownload: ActiveDownload = {
  gameId: 1,
  versionId: 2,
  gameTitle: "Anno 1602 A.D.",
  filename: "setup.exe",
  received: 0,
  total: 0,
  progress: 100,
  abortController: new AbortController(),
  startedAt: Date.now(),
  status: "completed",
  extractionStatus: "completed",
  installationDirectory:
    "/home/player/Games/GameVault/Anno 1602 A.D./Installation",
  installationStatus: "error",
  installationError: "Installer exited with code 1.",
  installationExitCode: 1,
  installationSource: "installer",
};

function renderFlow(download: ActiveDownload) {
  render(
    <InstallFlow
      download={download}
      installState={setupState}
      onUpdate={vi.fn()}
      onClose={vi.fn()}
      onSetUndetectedMode={vi.fn()}
      onForceInstall={vi.fn()}
    />,
  );
}

describe("InstallFlow", () => {
  it("offers the launch log for a failed installer run", async () => {
    const user = userEvent.setup();
    renderFlow(failedDownload);

    await user.click(screen.getByRole("button", { name: "View launch log" }));

    expect(mocks.openLaunchLogWindow).toHaveBeenCalledTimes(1);
  });

  it("does not offer the launch log for a failed file copy", () => {
    renderFlow({ ...failedDownload, installationSource: "copy" });

    expect(
      screen.queryByRole("button", { name: "View launch log" }),
    ).not.toBeInTheDocument();
  });
});
