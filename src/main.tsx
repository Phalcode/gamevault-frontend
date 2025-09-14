import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, Navigate } from "react-router";
import { Login } from "./components/Login";
import { Register } from "./components/Register";
import "./index.css";
import DashboardLayout from "./layouts/DashboardLayout";
import FullscreenLayout from "./layouts/FullscreenLayout";
import Administration from "./pages/Administration";
import Community from "./pages/Community";
import Downloads from "./pages/Downloads";
import Library from "./pages/Library";
import NotFound from "./pages/NotFound";
import Settings from "./pages/Settings";
import { AuthProvider, useAuth } from "./context/AuthContext";

function ProtectedRoute({ children }: { children: React.ReactElement }) {
  const { auth, bootstrapping } = useAuth();
  if (bootstrapping) return <div className="p-6 text-center">Loading…</div>;
  if (!auth) return <Navigate to="/" replace />;
  return children;
}

function RedirectIfAuth({ children }: { children: React.ReactElement }) {
  const { auth, bootstrapping } = useAuth();
  if (bootstrapping) return <div className="p-6 text-center">Loading…</div>;
  if (auth) return <Navigate to="/library" replace />;
  return children;
}

(window as any).global = window;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<FullscreenLayout />}>
            <Route
              index
              element={
                <RedirectIfAuth>
                  <Login />
                </RedirectIfAuth>
              }
            />
            <Route
              path="register"
              element={
                <RedirectIfAuth>
                  <Register />
                </RedirectIfAuth>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Route>

          <Route element={<DashboardLayout />}>
            <Route
              index
              path="library"
              element={
                <ProtectedRoute>
                  <Library />
                </ProtectedRoute>
              }
            />
            <Route
              path="downloads"
              element={
                <ProtectedRoute>
                  <Downloads />
                </ProtectedRoute>
              }
            />
            <Route
              path="community"
              element={
                <ProtectedRoute>
                  <Community />
                </ProtectedRoute>
              }
            />
            <Route
              path="settings"
              element={
                <ProtectedRoute>
                  <Settings />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin"
              element={
                <ProtectedRoute>
                  <Administration />
                </ProtectedRoute>
              }
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
);
