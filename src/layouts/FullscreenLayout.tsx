import { AuthLayout } from "@tw/auth-layout";
import { PageLoader } from "@/components/PageLoader";
import { Suspense } from "react";
import { Outlet } from "react-router";
import RedirectIfAuth from "../guards/RedirectIfAuth";

interface FullscreenLayoutProps {
  guarded?: boolean; // optional prop to toggle guarding, default true
}

export default function FullscreenLayout({
  guarded = true,
}: FullscreenLayoutProps) {
  return (
    <RedirectIfAuth guarded={guarded}>
      <AuthLayout>
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </AuthLayout>
    </RedirectIfAuth>
  );
}
