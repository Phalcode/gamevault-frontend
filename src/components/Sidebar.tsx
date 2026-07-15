import { UserAvatar } from "@/components/UserAvatar";
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
  ArrowDownTrayIcon,
} from "@heroicons/react/16/solid";
import { Cog6ToothIcon } from "@heroicons/react/20/solid";
import { Badge } from "@tw/badge";
import { isTauriApp } from "@/utils/tauri";
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
import { useLocation, useNavigate } from "react-router";
import { GamevaultUserRoleEnum } from "../api";
import { useNews } from "../hooks/useNews";
import ThemeSwitch from "./ThemeSwitch";
import { UserEditorModal } from "./admin/UserEditorModal";
import { NewsDialog } from "./news/NewsDialog";

export function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showNews, setShowNews] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const username = user?.username || "Unknown User";
  const email = user?.email || "";
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

  const roleVal = user?.role;
  const isAdmin = Number(roleVal) >= Number(GamevaultUserRoleEnum._3);
  const isTauri = isTauriApp();
  const isCurrentPath = (path: string) => {
    if (path === "/library") {
      return (
        location.pathname === "/library" ||
        location.pathname.startsWith("/library/")
      );
    }

    return (
      location.pathname === path ||
      location.pathname.startsWith(`${path}/`)
    );
  };

  return (
    <>
      <TailwindSidebar>
        <SidebarHeader>
          <Logo variant="sidebar" height="h-4" />
        </SidebarHeader>
        <SidebarBody>
          <SidebarSection>
            <SidebarItem href="/library" current={isCurrentPath("/library")}>
              <Squares2X2Icon />
              <SidebarLabel className="flex justify-between w-full">
                Library
              </SidebarLabel>
            </SidebarItem>
            {isTauri && (
              <SidebarItem
                href="/downloads"
                current={isCurrentPath("/downloads")}
              >
                <ArrowDownTrayIcon />
                <SidebarLabel className="flex justify-between w-full">
                  Downloads
                </SidebarLabel>
              </SidebarItem>
            )}
            <SidebarItem href="/community" current={isCurrentPath("/community")}>
              <UserGroupIcon />
              <SidebarLabel className="flex justify-between w-full">
                Community
              </SidebarLabel>
            </SidebarItem>
            <SidebarItem href="/settings" current={isCurrentPath("/settings")}>
              <Cog6ToothIcon />
              <SidebarLabel className="flex justify-between w-full">
                Settings
              </SidebarLabel>
            </SidebarItem>
            {isAdmin ? (
              <SidebarItem href="/admin" current={isCurrentPath("/admin")}>
                <ShieldExclamationIcon />
                <SidebarLabel>Administration</SidebarLabel>
              </SidebarItem>
            ) : (
              <SidebarItem
                href="#"
                onClick={(e) => e.preventDefault()}
                className="hidden cursor-not-allowed"
              >
                <ShieldExclamationIcon />
                <SidebarLabel>Administration</SidebarLabel>
              </SidebarItem>
            )}
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
                  <Badge color="amber" className="ml-2 motion-safe:animate-pulse">
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
            <div className="rounded-2xl border border-gv-line/70 bg-white/25 px-3 py-2.5 dark:bg-white/3">
              <ThemeSwitch />
            </div>
          </SidebarSection>
        </SidebarBody>
        <SidebarFooter>
          <Dropdown>
            <DropdownButton as={SidebarItem}>
              <span className="flex min-w-0 items-center gap-3">
                <UserAvatar
                  media={avatar}
                  size={40}
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
              <DropdownItem
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setShowEditProfile(true);
                }}
              >
                <UserIcon />
                <DropdownLabel>Edit profile</DropdownLabel>
              </DropdownItem>
              <DropdownDivider />
              <DropdownItem href={user?.id ? `/community/${user.id}` : "/community"}>
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
      {showEditProfile && user && (
        <UserEditorModal
          self
          user={user}
          onClose={() => setShowEditProfile(false)}
        />
      )}
    </>
  );
}
