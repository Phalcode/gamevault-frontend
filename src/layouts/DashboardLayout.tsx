import { Navbar } from "@components/Navbar";
import { Sidebar } from "@components/Sidebar";
import { SidebarLayout } from "@tw/sidebar-layout";
import { PageLoader } from "@/components/PageLoader";
import { PageVisibilityProvider } from "@/context/PageVisibilityContext";
import { Suspense, useEffect, useRef, type ReactNode } from "react";
import { matchPath, useLocation, useOutlet } from "react-router";
import { motion } from "motion/react";
import { pageVariants } from "@/lib/motion";
import ProtectedRoute from "../guards/ProtectedRoute";
import { useGameTimeTracker } from "@/hooks/useGameTimeTracker";
import { useTrayMenu } from "@/hooks/useTrayMenu";

interface DashboardLayoutProps {
  guarded?: boolean; // optional boolean to toggle guarding, default true
}

interface MountedPage {
  path: string;
  node: ReactNode;
}

/**
 * Wrapper around a mounted route page. A page that is not on screen leaves the
 * layout and the paint work, but keeps its DOM and component state, and any
 * media it was playing is stopped so a cached game page cannot keep sounding.
 */
function RoutePage({
  active,
  animateIn,
  children,
}: {
  active: boolean;
  animateIn: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (active) return;
    ref.current
      ?.querySelectorAll<HTMLMediaElement>("video, audio")
      .forEach((element) => element.pause());
  }, [active]);

  return (
    <motion.div
      ref={ref}
      variants={pageVariants}
      initial={animateIn ? "initial" : false}
      animate="animate"
      // A cached page is taken out of flow and out of paint, so it cannot
      // affect the visible page's layout or its scrollbar.
      className={active ? "h-full" : "page-inactive"}
      aria-hidden={!active}
      inert={!active}
    >
      {children}
    </motion.div>
  );
}

export default function DashboardLayout({
  guarded = true,
}: DashboardLayoutProps) {
  const location = useLocation();
  // Freeze the outlet element for the current route. Rendering this element
  // (instead of the live <Outlet />) means the page that is animating out keeps
  // showing its own content, rather than instantly switching to the incoming
  // tab's content/loading state, which caused a visible flash on tab switch.
  const outlet = useOutlet();
  const isGameViewRoute = Boolean(
    matchPath({ path: "/library/:id" }, location.pathname),
  );
  const isCommunityProfileRoute = Boolean(
    matchPath({ path: "/community/:id" }, location.pathname),
  );
  const isFullBleed = isGameViewRoute;

  useGameTimeTracker();
  // Keeps the native tray menu's recently-played list in sync and serves its
  // "launch game" / "open page" actions.
  useTrayMenu();

  // ── Route page cache ───────────────────────────────────────────────────
  //
  // The page that was just left stays mounted, hidden, instead of being torn
  // down. Rebuilding the library on every return from a game meant recreating
  // hundreds of cards, re-running their effects and restoring the scroll
  // position from scratch, which left the window empty while it happened.
  // Keeping one page alive makes going back instant: the DOM, the loaded
  // pages, the filters and the scroll position are all still there.
  //
  // Only the previous page is kept, so memory stays bounded (library plus the
  // game page you came from). Opening a third page drops the oldest one.
  const pagesRef = useRef<MountedPage[]>([]);
  const mountedPages = pagesRef.current;
  const activeIndex = mountedPages.findIndex(
    (page) => page.path === location.pathname,
  );

  if (activeIndex === -1) {
    const previous = mountedPages[mountedPages.length - 1];
    pagesRef.current = [
      ...(previous ? [{ path: previous.path, node: previous.node }] : []),
      { path: location.pathname, node: outlet },
    ];
  } else {
    // Refresh only the visible page so route params and context still reach it.
    pagesRef.current = mountedPages.map((page) =>
      page.path === location.pathname ? { ...page, node: outlet } : page,
    );
  }
  const pages = pagesRef.current;
  const isFirstPage = pages.length === 1;

  return (
    <ProtectedRoute guarded={guarded}>
      <SidebarLayout
        sidebar={<Sidebar />}
        navbar={<Navbar />}
        fullWidth={isFullBleed}
        fullBleed={isFullBleed}
      >
        <div className="relative h-full">
          {pages.map((page) => {
            const isActive = page.path === location.pathname;
            return (
              <PageVisibilityProvider key={page.path} active={isActive}>
                <RoutePage active={isActive} animateIn={!isFirstPage}>
                  <Suspense fallback={<PageLoader />}>{page.node}</Suspense>
                </RoutePage>
              </PageVisibilityProvider>
            );
          })}
        </div>
      </SidebarLayout>
    </ProtectedRoute>
  );
}
