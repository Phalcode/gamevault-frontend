import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { MotionConfig } from "motion/react";
import { Login } from "./components/Login";
import { Register } from "./components/Register";
import { PageLoader } from "./components/PageLoader";
import {
  AlertDialogProvider,
  GlobalAlertDialogBridge,
} from "./context/AlertDialogContext";
import { AppUpdaterProvider } from "./context/AppUpdaterContext";
import { AuthProvider } from "./context/AuthContext";
import { DownloadProvider } from "./context/DownloadContext";
import { GamepadProvider } from "./context/GamepadContext";
import { IgnoreListProvider } from "./context/IgnoreListContext";
import { OfflineProvider } from "./context/OfflineContext";
import { UmuProvider } from "./context/UmuContext";
import "./index.css";
import DashboardLayout from "./layouts/DashboardLayout";
import FullscreenLayout from "./layouts/FullscreenLayout";
import ProtectedRoute from "./guards/ProtectedRoute";
import { GamevaultUserRoleEnum } from "./api";

// Route-level code splitting keeps the initial bundle small. Pages that are
// only reached after login (library, game view, settings, downloads, ...) are
// loaded lazily so the first paint is fast.
const Administration = lazy(() => import("./pages/Administration"));
const Community = lazy(() => import("./pages/Community"));
const Library = lazy(() => import("./pages/Library"));
const GameView = lazy(() => import("./pages/GameView"));
const UserProfile = lazy(() => import("./pages/UserProfile"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Settings = lazy(() => import("./pages/Settings"));
const Downloads = lazy(() => import("./pages/Downloads"));
import { applyTheme, getStoredTheme } from "./utils/theme";
import { applyZoom, getStoredZoom, registerZoomHotkeys } from "./utils/zoom";
import { registerReloadHotkey } from "./utils/reload";
import {
  registerExternalLinkHandler,
  isTauriApp,
} from "./utils/tauri";
import { isAnalyticsEnabled } from "./utils/analytics";
import { startMediaCacheMaintenance } from "./utils/mediaCache";
import * as Swetrix from "swetrix";

// Apply stored theme immediately to prevent flash of wrong theme
applyTheme(getStoredTheme());
// Apply persisted zoom level (native webview zoom in Tauri, CSS zoom on web)
void applyZoom(getStoredZoom());
void startMediaCacheMaintenance();

(window as any).global = window;

if (isAnalyticsEnabled()) {
  Swetrix.init("dBl2xaaJ9x3M", { preloadSessionReplay: true, apiURL: "https://analytics.platform.phalco.de/log" });
  Swetrix.trackViews();
  Swetrix.trackErrors();
}

// Ctrl/Cmd + +/-/0 zoom hotkeys (browsers already handle these natively)
if (isTauriApp()) {
  registerZoomHotkeys();
  // F5 reloads the app in the Tauri webview (packaged builds have no native F5)
  registerReloadHotkey();
  // Open every external link (target=_blank, http(s), mailto, tel) through
  // the native OS opener instead of being swallowed by the webview.
  registerExternalLinkHandler();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <OfflineProvider>
          <IgnoreListProvider>
            <DownloadProvider>
              <AlertDialogProvider>
                <AppUpdaterProvider>
                  <UmuProvider>
                    <GlobalAlertDialogBridge />
                    <BrowserRouter>
                      <GamepadProvider>
                        <Suspense fallback={<PageLoader />}>
                          <Routes>
                            <Route element={<FullscreenLayout />}>
                              <Route index element={<Login />} />
                              <Route path="register" element={<Register />} />
                            </Route>

                            <Route element={<DashboardLayout />}>
                              <Route index path="library" element={<Library />} />
                              <Route path="library/:id" element={<GameView />} />
                              <Route path="downloads" element={<Downloads />} />
                              <Route path="community" element={<Community />} />
                              <Route
                                path="community/:id"
                                element={<UserProfile />}
                              />
                              <Route path="settings" element={<Settings />} />
                              <Route
                                path="admin"
                                element={
                                  <ProtectedRoute
                                    guarded
                                    requiredRole={GamevaultUserRoleEnum._3}
                                  >
                                    <Administration />
                                  </ProtectedRoute>
                                }
                              />
                            </Route>

                            <Route path="*" element={<NotFound />} />
                          </Routes>
                        </Suspense>
                      </GamepadProvider>
                    </BrowserRouter>
                  </UmuProvider>
                </AppUpdaterProvider>
              </AlertDialogProvider>
            </DownloadProvider>
          </IgnoreListProvider>
        </OfflineProvider>
      </AuthProvider>
    </MotionConfig>
  </StrictMode>,
);
