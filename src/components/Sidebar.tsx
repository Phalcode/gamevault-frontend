import { Media } from "@/components/Media";
import { useAuth } from "@/context/AuthContext";
import { Logo } from "@components/Logo";
import {
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
import { Badge } from "@tw/badge";
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
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useNews } from "../hooks/useNews";
import ThemeSwitch from "./ThemeSwitch";
import { NewsDialog } from "./news/NewsDialog";

export function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showNews, setShowNews] = useState(false);
  const username = user?.username || (user as any)?.Username || "Unknown";
  const email = user?.email || (user as any)?.EMail || "";
  const avatar = user?.avatar;
  const { hasNewNews } = useNews();
  const [badgeVisible, setBadgeVisible] = useState(hasNewNews);
  useEffect(() => {
    if (hasNewNews) {
      setBadgeVisible(true);
    }
  }, [hasNewNews]);

  const handleLogout = (e: React.MouseEvent) => {
    e.preventDefault();
    logout();
    navigate("/library", { replace: true });
  };
  const handleCloseNewsDialog = () => {
    setShowNews(false);
    setBadgeVisible(false);
  };

  return (
    <>
      <TailwindSidebar>
        <SidebarHeader>
          <Logo variant="sidebar" height="h-4" />
        </SidebarHeader>
        <SidebarBody>
          <SidebarSection>
            <SidebarItem href="/library">
              <Squares2X2Icon />
              <SidebarLabel className="flex justify-between w-full">
                Library
              </SidebarLabel>
            </SidebarItem>
            <SidebarItem href="/community">
              <UserGroupIcon />
              <SidebarLabel className="flex justify-between w-full">
                Community
              </SidebarLabel>
            </SidebarItem>
            <SidebarItem href="/settings">
              <Cog6ToothIcon />
              <SidebarLabel className="flex justify-between w-full">
                Settings
              </SidebarLabel>
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
            <SidebarItem href="https://discord.gg/NEdNen2dSu" target="_blank">
              <ChatBubbleLeftRightIcon />
              <SidebarLabel>Discord</SidebarLabel>
            </SidebarItem>
            <SidebarItem
              onClick={(e: any) => {
                e.preventDefault();
                setShowNews(true);
              }}
            >
              <NewspaperIcon />
              <SidebarLabel className="flex justify-between w-full items-center">
                News
                {badgeVisible && (
                  <Badge color="indigo" className="ml-2 animate-pulse">
                    New
                  </Badge>
                )}
              </SidebarLabel>
            </SidebarItem>
            <SidebarItem
              href="https://gamevau.lt/gamevault-plus"
              target="_blank"
            >
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
                <Media
                  media={avatar}
                  size={40}
                  className="size-10"
                  square
                  alt={username}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm/5 font-medium text-zinc-950 dark:text-white">
                    {username}
                  </span>
                  {email && (
                    <span className="block truncate text-xs/5 font-normal text-zinc-500 dark:text-zinc-400">
                      {email}
                    </span>
                  )}
                </span>
              </span>
              <ChevronUpIcon />
            </DropdownButton>
            <DropdownMenu className="min-w-64" anchor="top start">
              <DropdownItem href="/community">
                <UserIcon />
                <DropdownLabel>My profile</DropdownLabel>
              </DropdownItem>
              <DropdownDivider />
              <DropdownItem href="#" onClick={handleLogout}>
                <ArrowRightStartOnRectangleIcon />
                <DropdownLabel>Sign out</DropdownLabel>
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
        </SidebarFooter>
      </TailwindSidebar>
      {showNews && <NewsDialog onClose={handleCloseNewsDialog} />}
    </>
  );
}
