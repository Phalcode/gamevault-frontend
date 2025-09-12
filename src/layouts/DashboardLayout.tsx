import { Navbar } from "@components/Navbar";
import { Sidebar } from "@components/Sidebar";
import { SidebarLayout } from "@tw/sidebar-layout";
import { Outlet } from "react-router";

export default function DashboardLayout() {
  return (
    <SidebarLayout sidebar={<Sidebar />} navbar={<Navbar />}>
      <Outlet />
    </SidebarLayout>
  );
}
