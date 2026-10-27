import { describe, expect, it } from "vitest";
import {
  formatCpuMemoryLabel,
  formatDisplayLabel,
  formatMonitorsLabel,
  type DisplayInfo,
  type MonitorInfo,
  type SystemSpecs,
} from "./rendering";

/** 16-core / 32-thread CPU with 64 GiB installed, as reported by the OS. */
function nativeSpecs(overrides: Partial<SystemSpecs["cpu"]> = {}): SystemSpecs {
  return {
    cpu: {
      brand: "AMD Ryzen 9 9950X3D 16-Core Processor",
      physical_cores: 16,
      logical_cores: 32,
      ...overrides,
    },
    memory: { total_bytes: 64 * 1024 ** 3 },
    approximate: false,
  };
}

function display(overrides: Partial<DisplayInfo> = {}): DisplayInfo {
  return {
    width: 2560,
    height: 1440,
    physicalWidth: 3840,
    physicalHeight: 2160,
    devicePixelRatio: 1.5,
    colorDepth: 24,
    visualViewport: null,
    ...overrides,
  };
}

const monitors: MonitorInfo[] = [
  {
    name: "\\\\.\\DISPLAY6",
    width: 3840,
    height: 2160,
    scale_factor: 1.5,
    position_x: 0,
    position_y: 0,
  },
  {
    name: null,
    width: 3440,
    height: 1440,
    scale_factor: 1,
    position_x: 3840,
    position_y: 0,
  },
];

describe("formatCpuMemoryLabel", () => {
  it("reports physical cores, threads and installed RAM from the OS", () => {
    expect(formatCpuMemoryLabel(nativeSpecs())).toBe(
      "AMD Ryzen 9 9950X3D 16-Core Processor · 16 cores / 32 threads · 64 GB",
    );
  });

  it("does not label logical CPUs as cores", () => {
    const label = formatCpuMemoryLabel(nativeSpecs());
    expect(label).not.toContain("32 cores");
    expect(label).toContain("16 cores / 32 threads");
  });

  it("prints a single count when cores and threads match", () => {
    expect(
      formatCpuMemoryLabel(
        nativeSpecs({ physical_cores: 8, logical_cores: 8 }),
      ),
    ).toContain("8 threads");
  });

  it("falls back to the browser values and marks them as estimates", () => {
    const specs: SystemSpecs = {
      cpu: { brand: null, physical_cores: null, logical_cores: 32 },
      memory: { total_bytes: 32 * 1024 ** 3 },
      approximate: true,
    };
    expect(formatCpuMemoryLabel(specs)).toBe("32 threads · 32 GB (estimated)");
  });

  it("omits unknown parts instead of printing placeholders", () => {
    const specs: SystemSpecs = {
      cpu: { brand: "Some CPU", physical_cores: null, logical_cores: null },
      memory: { total_bytes: null },
      approximate: false,
    };
    expect(formatCpuMemoryLabel(specs)).toBe("Some CPU");
  });

  it("returns a dash when nothing is known", () => {
    const specs: SystemSpecs = {
      cpu: { brand: null, physical_cores: null, logical_cores: null },
      memory: { total_bytes: null },
      approximate: false,
    };
    expect(formatCpuMemoryLabel(specs)).toBe("—");
  });
});

describe("formatDisplayLabel", () => {
  it("shows the panel resolution, not the scaled-down logical one", () => {
    expect(formatDisplayLabel(display())).toBe(
      "3840x2160 (2560x1440 logical) · 1.5x DPR · 24-bit",
    );
  });

  it("omits the logical size on unscaled displays", () => {
    expect(
      formatDisplayLabel(
        display({
          width: 3440,
          height: 1440,
          physicalWidth: 3440,
          physicalHeight: 1440,
          devicePixelRatio: 1,
        }),
      ),
    ).toBe("3440x1440 · 1x DPR · 24-bit");
  });
});

describe("formatMonitorsLabel", () => {
  it("lists every monitor with its physical resolution and scale factor", () => {
    expect(formatMonitorsLabel(monitors)).toBe(
      "3840x2160 @ 1.5x (\\\\.\\DISPLAY6), 3440x1440 @ 1x",
    );
  });

  it("returns a dash when no monitor was reported", () => {
    expect(formatMonitorsLabel([])).toBe("—");
  });
});
