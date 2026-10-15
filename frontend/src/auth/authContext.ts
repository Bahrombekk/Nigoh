/* auth/authContext.ts — kirish konteksti: AuthCtx, useAuth() va isAdmin().
   Provayder (holat, kirish/chiqish) — AuthProvider.tsx da. */
import { createContext, useContext } from "react";
import type { Me, Role } from "@/lib/types";

export interface User { username: string; role: Role; full_name: string }
export type Reason = "login" | "expired";

export interface Ctx {
  me: Me | undefined;
  user: User | null;
  loading: boolean;
  guest: boolean;
  loginOpen: boolean;
  loginReason: Reason;
  openLogin: (reason?: Reason) => void;
  login: (username: string, password: string, remember: boolean) => Promise<Me>;
  logout: () => Promise<void>;
  enterGuest: () => void;
}
export const AuthCtx = createContext<Ctx | null>(null);

export function useAuth(): Ctx {
  const c = useContext(AuthCtx);
  if (!c) throw new Error("AuthProvider yo'q");
  return c;
}
export const isAdmin = (u: User | null) => u?.role === "admin";
