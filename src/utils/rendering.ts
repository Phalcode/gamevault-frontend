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

export interface DisplayInfo {
  width: number;
  height: number;
  devicePixelRatio: number;
  colorDepth: number;
  visualViewport: { width: number; height: number; scale: number } | null;
}

/** Subset of diagnostics returned by the Rust `get_rendering_diagnostics` command. */
export type TauriDiagnostics = Pick<
  RenderingDiagnostics,
  "os" | "monitors" | "webkit"
>;

export interface RenderingDiagnostics {
  os: OsInfo;
  monitors: MonitorInfo[];
  webkit: WebKitState | null;
  webgl: WebGLInfo;
  webgpu: WebGPUInfo;
  display: DisplayInfo;
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
      return { supported: false, webgl2: false, vendor: null, renderer: null, version: null };
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
    return { supported: false, webgl2: false, vendor: null, renderer: null, version: null };
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
      setTimeout(() => reject(new Error("WebGPU adapter request timed out")), ms);
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
  return {
    width: window.screen?.width ?? 0,
    height: window.screen?.height ?? 0,
    devicePixelRatio: window.devicePixelRatio || 1,
    colorDepth: window.screen?.colorDepth ?? 0,
    visualViewport: vv
      ? { width: vv.width, height: vv.height, scale: vv.scale }
      : null,
  };
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
 * app the OS + monitor + WebKit state come from Rust; GPU/WebGL/WebGPU/display
 * are read on the frontend. Same payload is surfaced in both the DevTools
 * "Rendering & System" section and the "Copy Settings Dump" output.
 */
export async function getRenderingDiagnostics(): Promise<RenderingDiagnostics> {
  const [tauri, webgpu] = await Promise.all([
    getTauriDiagnostics(),
    getWebGPUInfo(),
  ]);
  return {
    os: tauri?.os ?? fallbackOs(),
    monitors: tauri?.monitors ?? [],
    webkit: tauri?.webkit ?? null,
    webgl: getWebGLInfo(),
    webgpu,
    display: getDisplayInfo(),
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
