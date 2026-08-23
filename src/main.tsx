import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { MotionConfig } from "motion/react";
import { Login } from "./components/Login";
import { Register } from "./components/Register";
import {
  AlertDialogProvider,
  GlobalAlertDialogBridge,
} from "./context/AlertDialogContext";
import { AppUpdaterProvider } from "./context/AppUpdaterContext";
import { AuthProvider } from "./context/AuthContext";
import { DownloadProvider } from "./context/DownloadContext";
import { IgnoreListProvider } from "./context/IgnoreListContext";
import { OfflineProvider } from "./context/OfflineContext";
import "./index.css";
import DashboardLayout from "./layouts/DashboardLayout";
import FullscreenLayout from "./layouts/FullscreenLayout";
import Administration from "./pages/Administration";
import ProtectedRoute from "./guards/ProtectedRoute";
import Community from "./pages/Community";
import Library from "./pages/Library";
import GameView from "./pages/GameView";
import UserProfile from "./pages/UserProfile";
import NotFound from "./pages/NotFound";
import Settings from "./pages/Settings";
import Downloads from "./pages/Downloads";
import { GamevaultUserRoleEnum } from "./api";
import { applyTheme, getStoredTheme } from "./utils/theme";
import { applyZoom, getStoredZoom, registerZoomHotkeys } from "./utils/zoom";
import { isTauriApp } from "./utils/tauri";
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
  Swetrix.init("dBl2xaaJ9x3M", { preloadSessionReplay: true });
  Swetrix.trackViews();
  Swetrix.trackErrors();
}

// Ctrl/Cmd + +/-/0 zoom hotkeys (browsers already handle these natively)
if (isTauriApp()) {
  registerZoomHotkeys();
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
                  <GlobalAlertDialogBridge />
                  <BrowserRouter>
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
                        <Route path="community/:id" element={<UserProfile />} />
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
                  </BrowserRouter>
                </AppUpdaterProvider>
              </AlertDialogProvider>
            </DownloadProvider>
          </IgnoreListProvider>
        </OfflineProvider>
      </AuthProvider>
    </MotionConfig>
  </StrictMode>,
);
