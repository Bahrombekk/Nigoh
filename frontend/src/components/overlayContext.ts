/* components/overlayContext.ts — OverlayProvider konteksti va uning hook'lari:
   useToast() (toast(text, {tone, action, onAction, ms})) va
   useConfirm() (await confirm({title, text, ok, danger}) → boolean).
   Provayder (toast ro'yxati, tasdiqlash oynasi) — overlays.tsx da. */
import { createContext, useContext } from "react";

export type Tone = "success" | "info" | "error";
export interface ToastOpts { tone?: Tone; action?: string; onAction?: () => void; ms?: number }
export interface ConfirmOpts { title: string; text?: string; ok?: string; cancel?: string; danger?: boolean; icon?: string }

export const OverlayCtx = createContext<{
  toast: (text: string, opts?: ToastOpts | boolean) => () => void;
  confirm: (o: ConfirmOpts) => Promise<boolean>;
} | null>(null);

export function useToast() {
  const c = useContext(OverlayCtx);
  if (!c) throw new Error("OverlayProvider yo'q");
  return c.toast;
}
export function useConfirm() {
  const c = useContext(OverlayCtx);
  if (!c) throw new Error("OverlayProvider yo'q");
  return c.confirm;
}
