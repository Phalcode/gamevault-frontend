import { Logo } from "@components/Logo";
import {
  ArrowDownTrayIcon,
  ArrowRightStartOnRectangleIcon,
  ChatBubbleLeftRightIcon,
  ChevronUpIcon,
  LifebuoyIcon,
  NewspaperIcon,
  RocketLaunchIcon,
  ShieldExclamationIcon,
  Squares2X2Icon,
  UserGroupIcon,
  UserIcon,
} from "@heroicons/react/16/solid";
import { Cog6ToothIcon } from "@heroicons/react/20/solid";
import { Avatar } from "@tw/avatar";
import {
  Dropdown,
  DropdownButton,
  DropdownDivider,
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
} from "@tw/dropdown";
import {
  SidebarBody,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
  SidebarLabel,
  SidebarSection,
  SidebarSpacer,
  Sidebar as TailwindSidebar,
} from "@tw/sidebar";
import ThemeSwitch from "./ThemeSwitch";

export function Sidebar() {
  return (
    <TailwindSidebar>
      <SidebarHeader>
        <Logo variant="sidebar" height="h-4" />
      </SidebarHeader>
      <SidebarBody>
        <SidebarSection>
          <SidebarItem href="/library">
            <Squares2X2Icon />
            <SidebarLabel>Library</SidebarLabel>
          </SidebarItem>
          <SidebarItem href="/downloads">
            <ArrowDownTrayIcon />
            <SidebarLabel>Dowloads</SidebarLabel>
          </SidebarItem>
          <SidebarItem href="/community">
            <UserGroupIcon />
            <SidebarLabel>Community</SidebarLabel>
          </SidebarItem>
          <SidebarItem href="/settings">
            <Cog6ToothIcon />
            <SidebarLabel>Settings</SidebarLabel>
          </SidebarItem>
          <SidebarItem href="/admin">
            <ShieldExclamationIcon />
            <SidebarLabel>Administration</SidebarLabel>
          </SidebarItem>
        </SidebarSection>

        <SidebarSpacer />
        <SidebarSection>
          <SidebarItem href="https://gamevau.lt/docs/intro" target="_blank">
            <LifebuoyIcon />
            <SidebarLabel>Documentation</SidebarLabel>
          </SidebarItem>
          <SidebarItem>
            <ChatBubbleLeftRightIcon />
            <SidebarLabel>Discord</SidebarLabel>
          </SidebarItem>
          <SidebarItem href="/news">
            <NewspaperIcon />
            <SidebarLabel>News</SidebarLabel>
          </SidebarItem>
          <SidebarItem href="https://gamevau.lt/gamevault-plus" target="_blank">
            <RocketLaunchIcon />
            <SidebarLabel>GameVault+</SidebarLabel>
          </SidebarItem>
          <SidebarItem>
            <ThemeSwitch />
          </SidebarItem>
        </SidebarSection>
      </SidebarBody>
      <SidebarFooter>
        <Dropdown>
          <DropdownButton as={SidebarItem}>
            <span className="flex min-w-0 items-center gap-3">
              <Avatar src="/pfp.jpg" className="size-10" square alt="" />
              <span className="min-w-0">
                <span className="block truncate text-sm/5 font-medium text-zinc-950 dark:text-white">
                  Noel Christus
                </span>
                <span className="block truncate text-xs/5 font-normal text-zinc-500 dark:text-zinc-400">
                  sag-amen@web.de
                </span>
              </span>
            </span>
            <ChevronUpIcon />
          </DropdownButton>
          <DropdownMenu className="min-w-64" anchor="top start">
            <DropdownItem href="/profile">
              <UserIcon />
              <DropdownLabel>My profile</DropdownLabel>
            </DropdownItem>
            <DropdownDivider />
            <DropdownItem href="/login">
              <ArrowRightStartOnRectangleIcon />
              <DropdownLabel>Sign out</DropdownLabel>
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
      </SidebarFooter>
    </TailwindSidebar>
  );
}
