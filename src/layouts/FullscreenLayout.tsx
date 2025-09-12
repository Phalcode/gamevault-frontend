import { Outlet } from "react-router";
import { AuthLayout } from "../components/tailwind/auth-layout";

export default function FullscreenLayout() {
  return (
    <AuthLayout>
      <Outlet />
    </AuthLayout>
  );
}
