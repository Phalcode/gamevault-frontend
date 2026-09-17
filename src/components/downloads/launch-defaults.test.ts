import { describe, expect, it } from "vitest";
import { mergeLaunchDefaults } from "./launch-defaults";

describe("mergeLaunchDefaults", () => {
  it("fills empty options from the server defaults", () => {
    const merged = mergeLaunchDefaults(
      {},
      {
        launchExecutable: "Game.exe",
        launchParameters: "-novid",
        umuGameId: "umu-12345",
        umuStore: "egs",
        umuProtonPath: "GE-Proton9-5",
      },
      ["Game.exe", "Launcher.exe"],
    );

    expect(merged).toEqual({
      launchexecutable: "Game.exe",
      launchparameters: "-novid",
      umugameid: "umu-12345",
      umustore: "egs",
      umuprotonpath: "GE-Proton9-5",
    });
  });

  it("still adopts the umu defaults when a launch executable is already set", () => {
    // Regression: the old blanket guard returned early and skipped everything.
    const merged = mergeLaunchDefaults(
      { launchexecutable: "MyChoice.exe" },
      { umuGameId: "umu-12345", umuStore: "egs" },
      [],
    );

    expect(merged).toEqual({
      launchexecutable: "MyChoice.exe",
      umugameid: "umu-12345",
      umustore: "egs",
    });
  });

  it("never overwrites values the user configured", () => {
    const current = {
      launchexecutable: "MyChoice.exe",
      launchparameters: "-windowed",
      umugameid: "umu-own",
      umustore: "steam",
      umuprotonpath: "GE-Proton8-27",
    };

    expect(
      mergeLaunchDefaults(
        current,
        {
          launchExecutable: "Server.exe",
          launchParameters: "-server",
          umuGameId: "umu-server",
          umuStore: "egs",
          umuProtonPath: "GE-Proton9-5",
        },
        ["Server.exe"],
      ),
    ).toBeNull();
  });

  it("auto-detects an executable without any server defaults", () => {
    // Keeps the existing "pick the first candidate" behavior when the server
    // does not define a launch executable.
    expect(mergeLaunchDefaults({}, {}, ["First.exe", "Other.exe"])).toEqual({
      launchexecutable: "First.exe",
    });
  });

  it("ignores blank and missing defaults", () => {
    expect(mergeLaunchDefaults({}, { launchParameters: "   " }, [])).toBeNull();
    expect(
      mergeLaunchDefaults({}, { launchExecutable: " ", umuStore: "" }, []),
    ).toBeNull();
  });
});
