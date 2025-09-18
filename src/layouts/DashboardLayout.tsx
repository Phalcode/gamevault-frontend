import { Navbar } from "@components/Navbar";
import { Sidebar } from "@components/Sidebar";
import { SidebarLayout } from "@tw/sidebar-layout";
import { Outlet } from "react-router";
import ProtectedRoute from "../guards/ProtectedRoute";

interface DashboardLayoutProps {
  guarded?: boolean; // optional boolean to toggle guarding, default true
}

export default function DashboardLayout({
  guarded = true,
}: DashboardLayoutProps) {
  return (
    <ProtectedRoute guarded={guarded}>
      <SidebarLayout sidebar={<Sidebar />} navbar={<Navbar />}>
        <Outlet />
      </SidebarLayout>
    </ProtectedRoute>
  );
}
