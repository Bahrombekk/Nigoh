/* pages/dash/format.ts — dashboard formatlash va holat modeli (v3 dashboard/common.js dan).
   Foiz, son, davomiylik, kun yorlig'i; backend state → UI status/yorliq.
   Raqam formatlari v3 bilan aynan bir xil (lib/format dagisi bilan aralashtirmang — davomiylik boshqacha);
   p2 — lib/format dan (bir xil). */
import { p2 } from "@/lib/format";
import type { ApiState, Camera, UiStatus } from "@/lib/types";

/* ---------- Formatlash ---------- */
/** Date.getDay() tartibida (0 = yakshanba) */
export const WD = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toFixed(digits).replace(".", ",") + "%";
}
export function fmtInt(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
/** Soniya → "45 s", "7 daq", "3,9 soat", "28 kun" */
export function fmtDur(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec)) return "—";
  if (sec < 60) return Math.round(sec) + " s";
  if (sec < 3600) return Math.round(sec / 60) + " daq";
  if (sec < 86400) {
    const h = sec / 3600;
    return (h < 10 ? h.toFixed(1).replace(".", ",").replace(",0", "") : Math.round(h)) + " soat";
  }
  return Math.round(sec / 86400) + " kun";
}
/** ISO vaqtdan hozirgacha: "10 daq", "11 soat", "28 kun" */
export function fmtSince(iso: string | null | undefined): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (!t) return null;
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 60) return min + " daq";
  if (min < 1440) return Math.round(min / 60) + " soat";
  return Math.round(min / 1440) + " kun";
}
export function hhmm(ts: string | number | Date): string {
  const d = new Date(ts);
  return p2(d.getHours()) + ":" + p2(d.getMinutes());
}
/** "Ju 2" — kun yorlig'i; bugun bo'lsa "Bugun" */
export function dayLabel(date: string | number | Date, isToday?: boolean): string {
  if (isToday) return "Bugun";
  const d = typeof date === "string" ? new Date(date + "T12:00:00") : new Date(date);
  return WD[d.getDay()] + " " + d.getDate();
}

/* ---------- Holat modeli ---------- */
export function camState(c: Pick<Camera, "state" | "online">): ApiState {
  if (c.state) return c.state;
  return c.online === true ? "online" : c.online === false ? "offline" : "unknown";
}
export const STATUS: Record<ApiState, UiStatus> = { online: "online", stalled: "no-video", offline: "offline", disabled: "disabled", unknown: "unknown" };
export const LABEL: Record<ApiState, string> = { online: "Onlayn", stalled: "Tasvirsiz", offline: "Uzilgan", disabled: "Oʻchirilgan", unknown: "Nomaʼlum" };
