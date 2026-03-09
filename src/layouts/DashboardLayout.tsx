import { Navbar } from "@components/Navbar";
import { Sidebar } from "@components/Sidebar";
import { SidebarLayout } from "@tw/sidebar-layout";
import { Outlet, matchPath, useLocation } from "react-router";
import ProtectedRoute from "../guards/ProtectedRoute";

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

  return (
    <ProtectedRoute guarded={guarded}>
      <SidebarLayout
        sidebar={<Sidebar />}
        navbar={<Navbar />}
        fullWidth={isGameViewRoute}
        fullBleed={isGameViewRoute}
      >
        <Outlet />
      </SidebarLayout>
    </ProtectedRoute>
  );
}
