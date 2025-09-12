import { AuthLayout } from "@tw/auth-layout";
import { Outlet } from "react-router";

export default function FullscreenLayout() {
  return (
    <AuthLayout>
      <Outlet />
    </AuthLayout>
  );
}
