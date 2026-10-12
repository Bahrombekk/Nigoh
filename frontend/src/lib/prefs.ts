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
// Serverga yuborilgan, lekin javobi hali kelmagan kalitlar (kalit -> yuborishlar soni).
const pending = new Map<string, number>();
// Oxirgi mahalliy o'zgarish vaqti: PATCH'dan OLDIN yuborilgan /auth/me javobi
// undan KEYIN kelishi mumkin — shu oynada ham server qiymati qabul qilinmaydi.
const touched = new Map<string, number>();
const GUARD_MS = 5000;
let timer: number | null = null;
const subs = new Set<() => void>();

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* yashirin rejim */ }
}
function emit() { subs.forEach((f) => f()); }

function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!authed || !Object.keys(dirty).length) return;
  const keys = Object.keys(dirty);
  const body = JSON.stringify(dirty);
  dirty = {};
  keys.forEach((k) => pending.set(k, (pending.get(k) || 0) + 1));
  const done = () => keys.forEach((k) => {
    const n = (pending.get(k) || 1) - 1;
    if (n > 0) pending.set(k, n); else pending.delete(k);
  });
  fetch("/api/auth/me/prefs", {
    method: "PATCH", credentials: "same-origin", keepalive: true,
    headers: { "Content-Type": "application/json" }, body,
  }).then(done, done);
}
addEventListener("pagehide", flush);

export const prefs = {
  get<T>(key: string, def: T): T { return (data[key] === undefined ? def : data[key]) as T; },
  set(key: string, value: unknown) {
    data = { ...data, [key]: value };
    touched.set(key, Date.now());
    persist();
    dirty[key] = value;
    if (!timer) timer = window.setTimeout(flush, 500);
    emit();
  },
  all(): Prefs { return data; },
};

export function setPrefsUser(isAuthed: boolean) { authed = isAuthed; }

/** Kirgandan keyin serverdagi qiymatlar mahalliy ustiga yoziladi.

    Hali serverga yetmagan (500 ms navbatdagi yoki yo'ldagi) kalitlar bundan
    mustasno: /auth/me shu oraliqda qayta so'ralsa (sozlama saqlandi, oynaga
    qaytildi) server ESKI qiymatni qaytaradi va u yangisini bosib ketardi —
    foydalanuvchi tilni almashtirsa ham "o'zgarmayapti" bo'lib ko'rinardi. */
export function applyServerPrefs(obj: Prefs | undefined) {
  if (!obj || typeof obj !== "object") return;
  const fresh: Prefs = {};
  for (const [k, v] of Object.entries(obj)) {
    const recent = Date.now() - (touched.get(k) || 0) < GUARD_MS;
    if (!(k in dirty) && !pending.has(k) && !recent) fresh[k] = v;
  }
  data = { ...data, ...fresh };
  persist();
  emit();
}

function subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }

export function usePref<T>(key: string, def: T): [T, (v: T) => void] {
  const v = useSyncExternalStore(subscribe, () => data[key]);
  return [(v === undefined ? def : v) as T, (nv: T) => prefs.set(key, nv)];
}
