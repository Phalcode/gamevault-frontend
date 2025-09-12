import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { Login } from "./components/Login";
import { Register } from "./components/Register";
import "./index.css";
import DashboardLayout from "./layouts/DashboardLayout";
import FullscreenLayout from "./layouts/FullscreenLayout";
import Administration from "./pages/Administration";
import Community from "./pages/Community";
import Downloads from "./pages/Downloads";
import Library from "./pages/Library";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<FullscreenLayout />}>
          <Route index element={<Login />} />
          <Route path="register" element={<Register />} />
        </Route>

        <Route element={<DashboardLayout />}>
          <Route index path="library" element={<Library />} />
          <Route path="downloads" element={<Downloads />} />
          <Route path="community" element={<Community />} />
          <Route path="settings" element={<Settings />} />
          <Route path="administration" element={<Administration />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
