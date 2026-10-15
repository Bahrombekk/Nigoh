/* auth/AuthProvider.tsx — kim kirgan, kirish ekrani, mehmon rejimi, chiqish.
   useAuth() (authContext.ts): { user, me, loading, guest, loginOpen, loginReason, openLogin, login, logout, enterGuest }
   - 401 (api.ts "nigoh:unauthorized") → kirish ekrani "Seans tugadi" holatida.
   - Kirgach serverdagi prefs mahalliy ustiga yoziladi (mavzu, til ...).
   - Sayt nomi hujjat sarlavhasiga, sayt standart tili — I18nProvider'ga. */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { applyServerPrefs, setPrefsUser } from "@/lib/prefs";
import type { Me } from "@/lib/types";
import { qk, useMe } from "@/data/queries";
import { useI18n } from "@/i18n/i18nContext";
import { AuthCtx, type Ctx, type Reason, type User } from "./authContext";

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { setSiteLang } = useI18n();
  const meQ = useMe();
  const me = meQ.data;
  const [guest, setGuest] = useState(false);
  const [forced, setForced] = useState<Reason | null>(null);

  // Barqaror obyekt: har renderda yangisi yaratilsa useAuth() iste'molchilari
  // hammasi qayta chizilardi va "unauthorized" tinglovchisi qayta ulanardi.
  const user = useMemo<User | null>(() => (me?.authenticated && me.username && me.role
    ? { username: me.username, role: me.role, full_name: me.full_name || "" } : null), [me]);

  useEffect(() => {
    setPrefsUser(!!user);
    if (me?.authenticated) applyServerPrefs(me.prefs);
    if (me?.site_name) document.title = me.site_name + " — video nazorat tizimi";
    setSiteLang(me?.language);
    const b = document.body.classList;
    b.toggle("authed", !!user);
    b.toggle("anon", !user);
    b.toggle("is-admin", user?.role === "admin");
    b.toggle("operator", user?.role === "operator");
    b.toggle("viewer", user?.role === "viewer");
  }, [me, user?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = () => { if (user) setForced("expired"); qc.setQueryData(qk.me, (m: Me | undefined) => m && { ...m, authenticated: false }); };
    window.addEventListener("nigoh:unauthorized", h);
    return () => window.removeEventListener("nigoh:unauthorized", h);
  }, [user, qc]);

  const login = useCallback(async (username: string, password: string, remember: boolean) => {
    await api("/api/auth/login", { method: "POST", body: { username, password, remember } });
    const full = await api<Me>("/api/auth/me");
    qc.setQueryData(qk.me, full);
    setForced(null);
    setGuest(false);
    qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    return full;
  }, [qc]);

  const logout = useCallback(async () => {
    try { await api("/api/auth/logout", { method: "POST" }); } catch { /* baribir */ }
    location.reload();
  }, []);

  const loading = meQ.isPending;
  const needLogin = !loading && !user && !guest;
  const value = useMemo<Ctx>(() => ({
    me, user, loading, guest,
    loginOpen: !!forced || needLogin,
    loginReason: forced || "login",
    openLogin: (r = "login") => setForced(r),
    login, logout,
    enterGuest: () => { setGuest(true); setForced(null); },
  }), [me, user, loading, guest, forced, needLogin, login, logout]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
