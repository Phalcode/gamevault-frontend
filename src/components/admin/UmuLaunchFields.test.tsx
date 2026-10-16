// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { UmuLaunchFields, type UmuLaunchValues } from "./UmuLaunchFields";

const protonBuilds = [
  {
    name: "GE-Proton11-6",
    path: "/home/u/.local/share/Steam/compatibilitytools.d/GE-Proton11-6",
    source: "/home/u/.local/share/Steam/compatibilitytools.d",
  },
  {
    name: "GE-Proton10-32",
    path: "/home/u/.var/app/com.valvesoftware.Steam/data/Steam/compatibilitytools.d/GE-Proton10-32",
    source:
      "/home/u/.var/app/com.valvesoftware.Steam/data/Steam/compatibilitytools.d",
  },
];

const emptyValues: UmuLaunchValues = {
  umuGameId: "",
  umuStore: "",
  umuProtonPath: "",
  umuWinePrefix: "",
};

function renderFields(overrides: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  render(
    <UmuLaunchFields
      values={emptyValues}
      onChange={onChange}
      protonBuilds={protonBuilds}
      desktop
      {...overrides}
    />,
  );
  return { onChange };
}

/** Same, but controlled like the real dialog so typing accumulates. */
function renderControlledFields(overrides: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  function Harness() {
    const [values, setValues] = useState<UmuLaunchValues>(emptyValues);
    return (
      <UmuLaunchFields
        values={values}
        onChange={(field, value) => {
          onChange(field, value);
          setValues((current) => ({ ...current, [field]: value }));
        }}
        protonBuilds={protonBuilds}
        desktop
        {...overrides}
      />
    );
  }
  render(<Harness />);
  return { onChange };
}

async function openProtonSuggestions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText("Show suggestions"));
}

describe("UmuLaunchFields", () => {
  it("reports typing in the plain text fields", async () => {
    const user = userEvent.setup();
    const { onChange } = renderControlledFields();

    await user.type(screen.getByLabelText("Game ID"), "1811260");
    expect(onChange).toHaveBeenLastCalledWith("umuGameId", "1811260");
    expect(screen.getByLabelText("Game ID")).toHaveValue("1811260");
  });

  it("renders the values it is given", () => {
    render(
      <UmuLaunchFields
        values={{
          ...emptyValues,
          umuGameId: "1811260",
          umuStore: "steam",
        }}
        onChange={() => {}}
        protonBuilds={[]}
      />,
    );

    expect(screen.getByLabelText("Game ID")).toHaveValue("1811260");
    expect(screen.getByLabelText("Store")).toHaveValue("steam");
  });

  it("lists the installed Proton builds together with where they were found", async () => {
    const user = userEvent.setup();
    renderFields();

    await openProtonSuggestions(user);
    expect(await screen.findByText("GE-Proton11-6")).toBeInTheDocument();
    expect(screen.getByText("Steam")).toBeInTheDocument();
    expect(screen.getByText("Steam (Flatpak)")).toBeInTheDocument();
    expect(screen.getByText("UMU-Proton")).toBeInTheDocument();
  });

  it("picking a build reports the folder name", async () => {
    const user = userEvent.setup();
    const { onChange } = renderControlledFields();

    await openProtonSuggestions(user);
    await user.click(await screen.findByText("GE-Proton11-6"));

    expect(onChange).toHaveBeenLastCalledWith("umuProtonPath", "GE-Proton11-6");
  });

  it("still accepts a Proton name that is not installed", async () => {
    const user = userEvent.setup();
    const { onChange } = renderControlledFields();

    await user.click(screen.getByLabelText("Proton version"));
    await user.keyboard("Proton-Custom-9");

    expect(onChange).toHaveBeenLastCalledWith(
      "umuProtonPath",
      "Proton-Custom-9",
    );
  });

  it("filters the suggestions while typing", async () => {
    const user = userEvent.setup();
    renderFields();

    await openProtonSuggestions(user);
    expect(await screen.findByText("GE-Proton10-32")).toBeInTheDocument();

    await user.keyboard("11-6");
    expect(await screen.findByText("GE-Proton11-6")).toBeInTheDocument();
    expect(screen.queryByText("GE-Proton10-32")).not.toBeInTheDocument();
  });

  it("hints when no Proton build is installed", () => {
    render(
      <UmuLaunchFields
        values={emptyValues}
        onChange={() => {}}
        protonBuilds={[]}
        desktop
      />,
    );

    expect(
      screen.getByText(/No Proton builds found in compatibilitytools.d/),
    ).toBeInTheDocument();
  });

  it("shows the resolved prefix and opens its folder", async () => {
    const user = userEvent.setup();
    const onOpenPrefixFolder = vi.fn();
    renderFields({
      resolvedPrefixPath: "/home/u/.local/share/GameVault/prefixes/Game",
      onOpenPrefixFolder,
    });

    await user.click(screen.getByText("Open folder"));
    expect(onOpenPrefixFolder).toHaveBeenCalledWith(
      "/home/u/.local/share/GameVault/prefixes/Game",
    );
  });
});
