/* lib/prefs.ts — foydalanuvchi afzalliklari (v3 bilan bir xil: localStorage "nigoh.prefs",
   kirgan foydalanuvchida PATCH /api/auth/me/prefs, 500 ms jamlab; sahifa yopilganda darhol).
   React'da: usePref(key, def) — o'zgarsa komponent qayta chiziladi. */
import { useSyncExternalStore } from "react";
import type { Prefs } from "./types";

const KEY = "nigoh.prefs";
let data: Prefs = {};
try { data = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { data = {}; }

let authed = false;
let dirty: Record<string, unknown> = {};
let timer: number | null = null;
const subs = new Set<() => void>();

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* yashirin rejim */ }
}
function emit() { subs.forEach((f) => f()); }

function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!authed || !Object.keys(dirty).length) return;
  const body = JSON.stringify(dirty);
  dirty = {};
  fetch("/api/auth/me/prefs", {
    method: "PATCH", credentials: "same-origin", keepalive: true,
    headers: { "Content-Type": "application/json" }, body,
  }).catch(() => {});
}
addEventListener("pagehide", flush);

export const prefs = {
  get<T>(key: string, def: T): T { return (data[key] === undefined ? def : data[key]) as T; },
  set(key: string, value: unknown) {
    data = { ...data, [key]: value };
    persist();
    dirty[key] = value;
    if (!timer) timer = window.setTimeout(flush, 500);
    emit();
  },
  all(): Prefs { return data; },
};

export function setPrefsUser(isAuthed: boolean) { authed = isAuthed; }

/** Kirgandan keyin serverdagi qiymatlar mahalliy ustiga yoziladi. */
export function applyServerPrefs(obj: Prefs | undefined) {
  if (!obj || typeof obj !== "object") return;
  data = { ...data, ...obj };
  persist();
  emit();
}

function subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }

export function usePref<T>(key: string, def: T): [T, (v: T) => void] {
  const v = useSyncExternalStore(subscribe, () => data[key]);
  return [(v === undefined ? def : v) as T, (nv: T) => prefs.set(key, nv)];
}
