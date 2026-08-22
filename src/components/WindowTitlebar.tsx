import {
  MinusIcon,
  Squares2X2Icon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { isTauriApp } from "@/utils/tauri";

async function minimizeWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().minimize();
}

async function toggleMaximizeWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().toggleMaximize();
}

async function closeWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}

const controlButtonClassName =
  "flex w-11 cursor-pointer items-center justify-center text-gv-muted transition-colors hover:bg-white/5 hover:text-gv-text focus:outline-none";

export default function WindowTitlebar() {
  // Only rendered inside the Tauri desktop shell; hidden in plain browser mode.
  if (!isTauriApp()) {
    return null;
  }

  return (
    <header
      data-tauri-drag-region
      className="relative z-40 flex h-9 shrink-0 select-none items-stretch justify-end bg-gv-bg"
    >
      <div className="flex items-stretch">
        <button
          type="button"
          aria-label="Minimize"
          onClick={() => void minimizeWindow()}
          className={controlButtonClassName}
        >
          <MinusIcon className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Maximize"
          onClick={() => void toggleMaximizeWindow()}
          className={controlButtonClassName}
        >
          <Squares2X2Icon className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Close"
          onClick={() => void closeWindow()}
          className={`${controlButtonClassName} hover:bg-red-500 hover:text-white`}
        >
          <XMarkIcon className="size-4" />
        </button>
      </div>
    </header>
  );
}
