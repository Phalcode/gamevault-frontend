import { Navbar } from "@components/Navbar";
import { Sidebar } from "@components/Sidebar";
import { SidebarLayout } from "@tw/sidebar-layout";
import { PageLoader } from "@/components/PageLoader";
import { Suspense } from "react";
import { Outlet, matchPath, useLocation } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { pageVariants } from "@/lib/motion";
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
  const isFullBleed = isGameViewRoute;

  useGameTimeTracker();

  return (
    <ProtectedRoute guarded={guarded}>
      <SidebarLayout
        sidebar={<Sidebar />}
        navbar={<Navbar />}
        fullWidth={isFullBleed}
        fullBleed={isFullBleed}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="h-full"
          >
            <Suspense fallback={<PageLoader />}>
              <Outlet />
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </SidebarLayout>
    </ProtectedRoute>
  );
}
