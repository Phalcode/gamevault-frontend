import { NavbarSection, Navbar as TailwindNavbar } from "@tw/navbar";
import { Logo } from "./Logo";

export function Navbar() {
  return (
    <TailwindNavbar>
      <NavbarSection>
        <Logo variant="sidebar" height="h-4" />
      </NavbarSection>
    </TailwindNavbar>
  );
}
