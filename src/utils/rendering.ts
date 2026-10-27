import { formatBytes } from "@/utils/downloadFormat";
import { isTauriApp } from "@/utils/tauri";

/** OS info reported by the Rust backend (`get_rendering_diagnostics`). */
export interface OsInfo {
  name: string;
  os_version: string;
  kernel_version: string;
  long_os_version: string;
  arch: string;
}

export interface MonitorInfo {
  name: string | null;
  width: number;
  height: number;
  scale_factor: number;
  position_x: number;
  position_y: number;
}

/** Live WebKitGTK state (Linux only). */
export interface WebKitState {
  smooth_scroll: boolean;
  hardware_acceleration_policy: string;
  webgl_enabled: boolean;
}

export interface WebGLInfo {
  supported: boolean;
  webgl2: boolean;
  vendor: string | null;
  renderer: string | null;
  version: string | null;
}

export interface WebGPUInfo {
  supported: boolean;
  vendor: string | null;
  architecture: string | null;
  description: string | null;
  device: string | null;
}

export interface CpuInfo {
  brand: string | null;
  physical_cores: number | null;
  logical_cores: number | null;
}

export interface MemoryInfo {
  total_bytes: number | null;
}

/** CPU / RAM facts as reported by the native backend. */
export interface NativeSystemSpecs {
  cpu: CpuInfo;
  memory: MemoryInfo;
}

/**
 * CPU / RAM facts used by the UI. `approximate` marks values that came from
 * browser APIs (web build) rather than the OS — the browser only exposes the
 * logical CPU count and a RAM figure rounded down to a power of two.
 */
export interface SystemSpecs extends NativeSystemSpecs {
  approximate: boolean;
}

export interface DisplayInfo {
  /** Logical (CSS) pixels of the screen the window is currently on. */
  width: number;
  height: number;
  /** Physical (device) pixels of that screen, i.e. the resolution the OS shows. */
  physicalWidth: number;
  physicalHeight: number;
  devicePixelRatio: number;
  colorDepth: number;
  visualViewport: { width: number; height: number; scale: number } | null;
}

/** Subset of diagnostics returned by the Rust `get_rendering_diagnostics` command. */
export type TauriDiagnostics = Pick<
  RenderingDiagnostics,
  "os" | "monitors" | "webkit"
> & { system: NativeSystemSpecs };

export interface RenderingDiagnostics {
  os: OsInfo;
  monitors: MonitorInfo[];
  webkit: WebKitState | null;
  webgl: WebGLInfo;
  webgpu: WebGPUInfo;
  display: DisplayInfo;
  system: SystemSpecs;
}

/**
 * Reads the live WebKitGTK settings from Rust. Only meaningful on Linux.
 */
export async function getWebkitSettings(): Promise<WebKitState | null> {
  if (!isTauriApp()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<WebKitState>("get_webkit_settings");
  } catch {
    return null;
  }
}

/**
 * Reads GPU / renderer info from a scratch WebGL context. Returns an object
 * with `supported: false` when WebGL is unavailable. The context is released
 * so we never hold the GPU.
 */
export function getWebGLInfo(): WebGLInfo {
  try {
    const canvas = document.createElement("canvas");
    let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
    let webgl2 = false;
    try {
      gl = canvas.getContext("webgl2");
      webgl2 = Boolean(gl);
    } catch {
      gl = null;
    }
    if (!gl) {
      try {
        gl = canvas.getContext("webgl");
      } catch {
        gl = null;
      }
    }
    if (!gl) {
      return {
        supported: false,
        webgl2: false,
        vendor: null,
        renderer: null,
        version: null,
      };
    }

    let vendor: string | null = null;
    let renderer: string | null = null;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (ext) {
      vendor =
        String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) ?? "").trim() || null;
      renderer =
        String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? "").trim() ||
        null;
    } else {
      vendor = String(gl.getParameter(gl.VENDOR) ?? "").trim() || null;
      renderer = String(gl.getParameter(gl.RENDERER) ?? "").trim() || null;
    }
    const version = String(gl.getParameter(gl.VERSION) ?? "").trim() || null;

    // Release the context so the GPU isn't held for the app's lifetime.
    (
      gl.getExtension("WEBGL_lose_context") as {
        loseContext?: () => void;
      } | null
    )?.loseContext?.();

    return { supported: true, webgl2, vendor, renderer, version };
  } catch {
    return {
      supported: false,
      webgl2: false,
      vendor: null,
      renderer: null,
      version: null,
    };
  }
}

const EMPTY_WEBGPU: WebGPUInfo = {
  supported: false,
  vendor: null,
  architecture: null,
  description: null,
  device: null,
};

/** Resolves `promise` unless it doesn't settle within `ms` (rejects on timeout). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error("WebGPU adapter request timed out")),
        ms,
      );
    }),
  ]);
}

/**
 * Best-effort WebGPU adapter info. WebGPU may be unavailable (safe under
 * `tauri://localhost`, or on WSL where the adapter request never resolves),
 * in which case this returns `{ supported: false }`. A timeout guards against
 * a hanging `requestAdapter()` so the diagnostics never get stuck loading.
 */
export async function getWebGPUInfo(): Promise<WebGPUInfo> {
  const gpu = (
    navigator as unknown as {
      gpu?: { requestAdapter?: () => Promise<unknown> };
    }
  ).gpu;
  if (!gpu?.requestAdapter) return EMPTY_WEBGPU;
  try {
    const adapter = (await withTimeout(
      gpu.requestAdapter() as Promise<unknown>,
      2500,
    )) as {
      info?: {
        vendor?: string;
        architecture?: string;
        description?: string;
        device?: string;
      };
    } | null;
    if (!adapter) return EMPTY_WEBGPU;
    const info = adapter.info ?? {};
    return {
      supported: true,
      vendor: info.vendor ?? null,
      architecture: info.architecture ?? null,
      description: info.description ?? null,
      device: info.device ?? null,
    };
  } catch {
    return EMPTY_WEBGPU;
  }
}

export function getDisplayInfo(): DisplayInfo {
  const vv = (
    window as unknown as {
      visualViewport?: { width: number; height: number; scale: number };
    }
  ).visualViewport;
  const width = window.screen?.width ?? 0;
  const height = window.screen?.height ?? 0;
  const devicePixelRatio = window.devicePixelRatio || 1;
  return {
    width,
    height,
    // `screen.*` is logical pixels; multiplying by the DPR yields the panel
    // resolution the OS reports (e.g. 2560x1440 @1.5 -> 3840x2160).
    physicalWidth: Math.round(width * devicePixelRatio),
    physicalHeight: Math.round(height * devicePixelRatio),
    devicePixelRatio,
    colorDepth: window.screen?.colorDepth ?? 0,
    visualViewport: vv
      ? { width: vv.width, height: vv.height, scale: vv.scale }
      : null,
  };
}

/**
 * Best-effort CPU / RAM facts for the web build (and as a fallback when the
 * desktop backend reports nothing). Both browser APIs are deliberately coarse:
 * `hardwareConcurrency` is the logical CPU count and `deviceMemory` is the RAM
 * rounded down to a power of two, hence the `approximate` marker.
 */
function getBrowserSystemSpecs(): NativeSystemSpecs {
  const nav =
    typeof navigator !== "undefined"
      ? (navigator as unknown as {
          hardwareConcurrency?: number;
          deviceMemory?: number;
        })
      : undefined;
  const logicalCores = nav?.hardwareConcurrency ?? 0;
  const memoryGiB = nav?.deviceMemory ?? 0;
  return {
    cpu: {
      brand: null,
      physical_cores: null,
      logical_cores: logicalCores > 0 ? logicalCores : null,
    },
    memory: {
      total_bytes: memoryGiB > 0 ? memoryGiB * 1024 ** 3 : null,
    },
  };
}

/**
 * Normalizes the native payload, tolerating backends that predate the
 * `system` field (an older app shell talking to a newer frontend).
 */
function toNativeSystemSpecs(
  specs: NativeSystemSpecs | null | undefined,
): NativeSystemSpecs | null {
  if (!specs) return null;
  const cpu = specs.cpu ?? ({} as CpuInfo);
  const memory = specs.memory ?? ({} as MemoryInfo);
  return {
    cpu: {
      brand: cpu.brand ?? null,
      physical_cores: cpu.physical_cores ?? null,
      logical_cores: cpu.logical_cores ?? null,
    },
    memory: { total_bytes: memory.total_bytes ?? null },
  };
}

/**
 * Formats the CPU / Memory row, e.g.
 * `AMD Ryzen 9 9950X3D 16-Core Processor · 16 cores / 32 threads · 64 GB`.
 */
export function formatCpuMemoryLabel(specs: SystemSpecs): string {
  const parts: string[] = [];
  if (specs.cpu.brand) parts.push(specs.cpu.brand);
  const cores = specs.cpu.physical_cores;
  const threads = specs.cpu.logical_cores;
  if (cores && threads && cores !== threads) {
    parts.push(`${cores} cores / ${threads} threads`);
  } else if (threads ?? cores) {
    // Only one count known: the browser build sees logical CPUs only.
    parts.push(`${threads ?? cores} threads`);
  }
  if (specs.memory.total_bytes) {
    parts.push(formatBytes(specs.memory.total_bytes));
  }
  if (parts.length === 0) return "—";
  // Browser-reported values are privacy-clipped, so flag them as estimates.
  return `${parts.join(" · ")}${specs.approximate ? " (estimated)" : ""}`;
}

/**
 * Formats the display row. Reports the panel resolution the OS would show
 * (physical pixels), with the logical size next to it when the display is
 * scaled, e.g. `3840x2160 (2560x1440 logical) · 1.5x DPR · 24-bit`.
 */
export function formatDisplayLabel(display: DisplayInfo): string {
  const physical = `${display.physicalWidth}x${display.physicalHeight}`;
  const logical = `${display.width}x${display.height}`;
  const scaled =
    display.physicalWidth !== display.width ||
    display.physicalHeight !== display.height;
  const resolution = scaled ? `${physical} (${logical} logical)` : physical;
  return `${resolution} · ${display.devicePixelRatio}x DPR · ${display.colorDepth}-bit`;
}

/**
 * Formats the monitor list, e.g.
 * `3840x2160 @ 1.5x (\\.\DISPLAY6), 3440x1440 @ 1x (\\.\DISPLAY8)`.
 */
export function formatMonitorsLabel(monitors: MonitorInfo[]): string {
  if (monitors.length === 0) return "—";
  return monitors
    .map(
      (m) =>
        `${m.width}x${m.height} @ ${m.scale_factor}x${m.name ? ` (${m.name})` : ""}`,
    )
    .join(", ");
}

function fallbackOs(): OsInfo {
  const nav = navigator as unknown as {
    platform?: string;
    userAgent?: string;
    userAgentData?: { platform?: string; architecture?: string };
  };
  return {
    name: nav.userAgentData?.platform || nav.platform || "Unknown",
    os_version: "",
    kernel_version: "",
    long_os_version: nav.userAgent || "Unknown",
    arch: nav.userAgentData?.architecture || "",
  };
}

/**
 * Collects the full rendering / GPU / display / OS diagnostics. In the desktop
 * app the OS + monitor + WebKit state and the CPU / RAM facts come from Rust;
 * GPU/WebGL/WebGPU/display are read on the frontend, and CPU / RAM fall back to
 * the (coarse) browser APIs when there is no backend. Same payload is surfaced
 * in both the About "System" section and the "Copy Settings Dump" output.
 */
export async function getRenderingDiagnostics(): Promise<RenderingDiagnostics> {
  const [tauri, webgpu] = await Promise.all([
    getTauriDiagnostics(),
    getWebGPUInfo(),
  ]);
  const native = toNativeSystemSpecs(tauri?.system);
  return {
    os: tauri?.os ?? fallbackOs(),
    monitors: tauri?.monitors ?? [],
    webkit: tauri?.webkit ?? null,
    webgl: getWebGLInfo(),
    webgpu,
    display: getDisplayInfo(),
    system: native
      ? { ...native, approximate: false }
      : { ...getBrowserSystemSpecs(), approximate: true },
  };
}

async function getTauriDiagnostics(): Promise<TauriDiagnostics | null> {
  if (!isTauriApp()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<TauriDiagnostics>("get_rendering_diagnostics");
  } catch (error) {
    console.warn("Failed to fetch rendering diagnostics from Tauri", error);
    return null;
  }
}
