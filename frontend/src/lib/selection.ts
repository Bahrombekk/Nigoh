/* lib/selection.ts — xaritada tanlangan kamera (bo'limlararo; v3 dagi state.selectedId).
   Xarita yozadi: setSelectedCamera(id | null). Devor o'qiydi: useSelectedCamera() —
   katak ajratib ko'rsatiladi (.is-sel), Fokus shu kameradan boshlanadi.
   Seans davomida saqlanadi (sessionStorage) — sahifa yangilansa ham. */
import { useSyncExternalStore } from "react";

const KEY = "nigoh.selected";
let selected: number | null = null;
try { const v = Number(sessionStorage.getItem(KEY)); selected = v > 0 ? v : null; } catch { /* */ }
const subs = new Set<() => void>();

export function setSelectedCamera(id: number | null) {
  if (id === selected) return;
  selected = id;
  try { if (id) sessionStorage.setItem(KEY, String(id)); else sessionStorage.removeItem(KEY); } catch { /* */ }
  subs.forEach((f) => f());
}
export function getSelectedCamera() { return selected; }

export function useSelectedCamera(): number | null {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => selected);
}
