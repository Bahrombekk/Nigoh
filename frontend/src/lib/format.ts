/* lib/format.ts — vaqt va son formatlari (UZ_GLOSSARY: o'nli vergul, "45 s · 7 daq · 1,8 soat · 6 kun"). */
import { dateShort } from "@/i18n/core.js";

export const p2 = (n: number) => String(n).padStart(2, "0");

export function fmtTime(d: Date | string | number = new Date()): string {
  const x = d instanceof Date ? d : new Date(d);
  return p2(x.getHours()) + ":" + p2(x.getMinutes()) + ":" + p2(x.getSeconds());
}
export function fmtHm(d: Date | string | number): string {
  const x = d instanceof Date ? d : new Date(d);
  return p2(x.getHours()) + ":" + p2(x.getMinutes());
}
export function fmtDateShort(d = new Date()): string { return dateShort(d); }

export function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/ /g, " ");
}
export function fmtPct(n: number | null | undefined, digits = 1): string {
  return n == null ? "—" : fmtNum(n, digits) + "%";
}
/** Davomiylik: 45 s · 7 daq · 1,8 soat · 6 kun */
export function fmtDur(sec: number | null | undefined): string {
  if (sec == null) return "—";
  if (sec < 60) return Math.round(sec) + " s";
  if (sec < 3600) return Math.round(sec / 60) + " daq";
  if (sec < 86400) return fmtNum(sec / 3600, sec < 36000 ? 1 : 0) + " soat";
  return fmtNum(sec / 86400, sec < 864000 ? 1 : 0) + " kun";
}
export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  return fmtDur(s) + " oldin";
}
export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms = 300) {
  let t: number | undefined;
  return (...a: A) => { clearTimeout(t); t = window.setTimeout(() => fn(...a), ms); };
}
