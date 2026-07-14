import { Navbar } from "@components/Navbar";
import { Sidebar } from "@components/Sidebar";
import { SidebarLayout } from "@tw/sidebar-layout";
import { Outlet, matchPath, useLocation } from "react-router";
import ProtectedRoute from "../guards/ProtectedRoute";
import { useGameTimeTracker } from "@/hooks/useGameTimeTracker";

interface DashboardLayoutProps {
  guarded?: boolean; // optional boolean to toggle guarding, default true
}

export default function DashboardLayout({
  guarded = true,
}: DashboardLayoutProps) {
  const location = useLocation();
  const isGameViewRoute = Boolean(
    matchPath({ path: "/library/:id" }, location.pathname),
  );
  const isCommunityProfileRoute = Boolean(
    matchPath({ path: "/community/:id" }, location.pathname),
  );
  const isFullBleed = isGameViewRoute || isCommunityProfileRoute;

  useGameTimeTracker();

  return (
    <ProtectedRoute guarded={guarded}>
      <SidebarLayout
        sidebar={<Sidebar />}
        navbar={<Navbar />}
        fullWidth={isFullBleed}
        fullBleed={isFullBleed}
      >
        <Outlet />
      </SidebarLayout>
    </ProtectedRoute>
  );
}
