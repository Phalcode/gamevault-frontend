import { NavbarSection, Navbar as TailwindNavbar } from "@tw/navbar";
import { Logo } from "./Logo";
import { useOnlineStatus } from "@/context/OfflineContext";
import { isTauriApp } from "@/utils/tauri";

export function Navbar() {
  const { isOnline } = useOnlineStatus();
  const isTauri = isTauriApp();

  return (
    <TailwindNavbar>
      <NavbarSection>
        <Logo variant="sidebar" height="h-4" />
        {isTauri && !isOnline && (
          <span className="ml-3 inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
            </span>
            Offline
          </span>
        )}
      </NavbarSection>
    </TailwindNavbar>
  );
}
