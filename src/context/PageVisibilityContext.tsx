import { createContext, useContext, type ReactNode } from "react";

/**
 * Whether the surrounding route page is the one on screen.
 *
 * Route pages stay mounted after they are left (see `DashboardLayout`), so a
 * page can be in the tree while another one is shown. Code that touches shared
 * browser state — scroll position, focus, observers — has to know the
 * difference.
 */
const PageVisibilityContext = createContext(true);

export function PageVisibilityProvider({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <PageVisibilityContext.Provider value={active}>
      {children}
    </PageVisibilityContext.Provider>
  );
}

/** Whether the surrounding route page is currently on screen. */
export function usePageIsActive(): boolean {
  return useContext(PageVisibilityContext);
}
