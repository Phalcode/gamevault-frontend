// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UmuProvider } from "./UmuContext";

const harness = vi.hoisted(() => ({
  handlers: {} as Record<string, (event: { payload: unknown }) => void>,
}));

vi.mock("@/utils/tauri", () => ({ isTauriApp: () => true }));
vi.mock("@/utils/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => ({})),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (name: string, handler: (event: { payload: unknown }) => void) => {
      harness.handlers[name] = handler;
      return () => {
        delete harness.handlers[name];
      };
    },
  ),
}));

function emitUmuStatus(payload: Record<string, unknown>) {
  act(() => {
    harness.handlers["umu-status"]({ payload });
  });
}

describe("UmuProvider", () => {
  beforeEach(() => {
    harness.handlers = {};
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("hides the setup overlay on the terminal phase", async () => {
    render(
      <UmuProvider>
        <div>app content</div>
      </UmuProvider>,
    );

    await waitFor(() =>
      expect(harness.handlers["umu-status"]).toBeTypeOf("function"),
    );

    emitUmuStatus({
      phase: "setup",
      line: "INFO: downloading UMU-Proton",
    });

    expect(
      await screen.findByText("Setting up umu launcher…"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/INFO: downloading UMU-Proton/),
    ).toBeInTheDocument();

    emitUmuStatus({ phase: "exit" });

    await waitFor(() =>
      expect(
        screen.queryByText("Setting up umu launcher…"),
      ).not.toBeInTheDocument(),
    );
  });

  it("hides the setup overlay on an error phase", async () => {
    render(
      <UmuProvider>
        <div>app content</div>
      </UmuProvider>,
    );

    await waitFor(() =>
      expect(harness.handlers["umu-status"]).toBeTypeOf("function"),
    );

    emitUmuStatus({ phase: "setup", line: "INFO: setting up" });
    expect(
      await screen.findByText("Setting up umu launcher…"),
    ).toBeInTheDocument();

    emitUmuStatus({ phase: "error", message: "umu-launcher setup failed" });

    await waitFor(() =>
      expect(
        screen.queryByText("Setting up umu launcher…"),
      ).not.toBeInTheDocument(),
    );
  });
});
