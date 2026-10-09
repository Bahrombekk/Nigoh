/* pages/settings/util.ts — Sozlamalar bo'limlari uchun mayda yordamchilar (v3 settings/util.js).
   whenText(iso)  — "bugun 10:02" / "kecha 18:21" / "27 sen 16:44"
   agoText(iso)   — "85 daq oldin" / "bugun 09:12" / "12 kun oldin" (Oxirgi kirish)
   clockText(iso) — "10:06:55" (bugun) yoki "07.10 10:06:55"
   durText(sec)   — "8 kun 2 soat" / "3 soat 12 daq" / "45 daq"
   mbText(mb)     — "27,7 MB" / "1,2 GB"
   initials(name) — "Nosirov Sobit" → "NS", "admin" → "AD"
   tempPassword() — vaqtinchalik parol (o'xshash belgilarsiz: 0/O, 1/l/I yo'q)
   copyText(text) — buferga nusxalash (Promise<bool>)
   Natija matnlari o'zbekcha — ko'rsatishda t() dan o'tkaziladi. */
import { useEffect, useState } from "react";

const p2 = (n: number) => String(n).padStart(2, "0");
const MO = ["yan", "fev", "mar", "apr", "may", "iyun", "iyul", "avg", "sen", "okt", "noy", "dek"];

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}
function dayDiff(d: Date) {
  const a = new Date(); a.setHours(0, 0, 0, 0);
  const b = new Date(d); b.setHours(0, 0, 0, 0);
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}
const hm = (d: Date) => p2(d.getHours()) + ":" + p2(d.getMinutes());

export function whenText(iso: string | null | undefined) {
  const d = parse(iso);
  if (!d) return "—";
  const dd = dayDiff(d);
  if (dd === 0) return "bugun " + hm(d);
  if (dd === 1) return "kecha " + hm(d);
  return d.getDate() + " " + MO[d.getMonth()] + (d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : "") + " " + hm(d);
}

export function agoText(iso: string | null | undefined) {
  const d = parse(iso);
  if (!d) return "Hech qachon";
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 90) return "hozirgina";
  if (s < 3600) return Math.round(s / 60) + " daq oldin";
  const dd = dayDiff(d);
  if (dd === 0) return "bugun " + hm(d);
  if (dd === 1) return "kecha " + hm(d);
  if (dd < 30) return dd + " kun oldin";
  return whenText(iso);
}

export function clockText(iso: string | null | undefined) {
  const d = parse(iso);
  if (!d) return "—";
  const t = hm(d) + ":" + p2(d.getSeconds());
  return dayDiff(d) === 0 ? t : p2(d.getDate()) + "." + p2(d.getMonth() + 1) + " " + t;
}

export function durText(sec: number | null | undefined) {
  if (sec == null || isNaN(sec)) return "";
  sec = Math.max(0, Math.round(sec));
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d) return d + " kun" + (h ? " " + h + " soat" : "");
  if (h) return h + " soat" + (m ? " " + m + " daq" : "");
  return Math.max(1, m) + " daq";
}

export function mbText(mb: number | null | undefined) {
  if (mb == null || isNaN(mb)) return "—";
  if (mb >= 1024) return (mb / 1024).toFixed(1).replace(".", ",") + " GB";
  return (mb >= 100 ? Math.round(mb) : Number(mb).toFixed(1).replace(".", ",")) + " MB";
}

export function initials(name: string | null | undefined) {
  const src = String(name || "?").trim();
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : src.slice(0, 2)).toUpperCase();
}

const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
export function tempPassword(n = 12) {
  const buf = new Uint32Array(n);
  crypto.getRandomValues(buf);
  return [...buf].map((x) => ALPHA[x % ALPHA.length]).join("");
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

/** Qiymat o'zgarishidan 300 ms keyin qaytaradi (SearchField, v3 bindSearch). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
