import { Outlet } from "react-router";
import { Navbar } from "../components/tailwind/navbar";
import { Sidebar } from "../components/tailwind/sidebar";
import { SidebarLayout } from "../components/tailwind/sidebar-layout";

export default function DashboardLayout() {
  return (
    <SidebarLayout
      sidebar={<Sidebar>{/* Your sidebar content */}</Sidebar>}
      navbar={<Navbar>{/* Your navbar content */}</Navbar>}
    >
      <h1>Dashboard</h1>
      <Outlet />
    </SidebarLayout>
  );
}
