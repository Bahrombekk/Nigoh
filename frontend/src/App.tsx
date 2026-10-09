/* App.tsx — marshrutlar (HashRouter: #/, #/dash/trend, #/wall/focus, #/admin, #/settings/tizim).
   Statistika — kirganlar; Boshqaruv va Sozlamalar — faqat administrator.
   Har bo'lim o'z papkasida (pages/<bo'lim>/), lazy yuklanadi. */
import { lazy, Suspense, type ReactNode } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router";
import { useAuth } from "@/auth/AuthProvider";
import { LoginScreen } from "@/auth/LoginScreen";
import { AppShell } from "@/layout/AppShell";
import { TooltipLayer } from "@/components/overlays";
import { Icon } from "@/components/Icon";

const MapPage = lazy(() => import("@/pages/map/MapPage"));
const DashPage = lazy(() => import("@/pages/dash/DashPage"));
const WallPage = lazy(() => import("@/pages/wall/WallPage"));
const AdminPage = lazy(() => import("@/pages/admin/AdminPage"));
const SettingsPage = lazy(() => import("@/pages/settings/SettingsPage"));

function Splash() {
  return <div id="splash" aria-hidden="true"><span className="logo-mark logo-mark--lg"><Icon name="eye" size="lg" /></span></div>;
}

function Guard({ need, children }: { need: "auth" | "admin"; children: ReactNode }) {
  const { user, loading, openLogin } = useAuth();
  if (loading) return null;
  if (!user) { if (need === "auth") queueMicrotask(() => openLogin()); return <Navigate to="/" replace />; }
  if (need === "admin" && user.role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const { loading, user, guest } = useAuth();
  const ready = !loading && (!!user || guest);
  return (
    <HashRouter>
      <TooltipLayer />
      {loading && <Splash />}
      <LoginScreen />
      {ready && (
        <Suspense fallback={null}>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<MapPage />} />
              <Route path="dash/:sub?" element={<Guard need="auth"><DashPage /></Guard>} />
              <Route path="wall/:sub?" element={<WallPage />} />
              <Route path="admin" element={<Guard need="admin"><AdminPage /></Guard>} />
              <Route path="settings/:sub?" element={<Guard need="admin"><SettingsPage /></Guard>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Suspense>
      )}
    </HashRouter>
  );
}
