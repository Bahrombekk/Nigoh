/* pages/map/util.ts — xarita bo'limining mayda yordamchilari (v3 map/util.js dan).
   Holat modeli (lib/types camStatus), kamera matnlari (kodek, format, km/piket, meta),
   qidiruv normallashtirish, CSS tokenlarini JS'da o'qish (Leaflet uchun), vaqt formatlari.
   Formatlar v3 xaritasiniki ("4 soat 10 daq", "5 daqiqa oldin") — lib/format dan farq qiladi. */
import { camStatus, STATUS_LABEL, type Camera, type UiStatus } from "@/lib/types";

export { camStatus, STATUS_LABEL };

export const NOGEO = "\u0000nogeo";

export function hasGeo(c: Pick<Camera, "lat" | "lng">): c is Camera & { lat: number; lng: number } {
  return c.lat != null && c.lng != null && !(c.lat === 0 && c.lng === 0);
}

export const STATUS_RANK: Record<UiStatus, number> = { offline: 4, "no-video": 3, unknown: 2, online: 1, disabled: 0 };

export function worstStatus(list: Camera[]): UiStatus {
  let best: UiStatus = "disabled", r = -1;
  list.forEach((c) => {
    const s = camStatus(c);
    if (STATUS_RANK[s] > r) { r = STATUS_RANK[s]; best = s; }
  });
  return best;
}

/* "H265" → "H.265" */
export function fmtCodec(codec: unknown): string {
  if (!codec) return "";
  return String(codec).replace(/^h\.?(26[45])$/i, "H.$1");
}

/* "1920x1080" → "1080p" */
export function fmtRes(res: unknown): string {
  if (!res) return "";
  const m = String(res).match(/(\d+)\s*[x×]\s*(\d+)/i);
  return m ? m[2] + "p" : String(res);
}

/* "3551 km · 5-piket" */
export function camPlace(c: { km?: number | null; picket?: number | string | null }): string {
  if (c.km == null) return "";
  return c.km + " km" + (c.picket != null && c.picket !== "" ? " · " + c.picket + "-piket" : "");
}

/* CameraRow meta: kodek yoki holat sababi ("oqim yoʻq"). */
export function camMeta(c: Camera): { text: string; bad?: boolean; warn?: boolean } {
  const st = camStatus(c);
  if (st === "offline") return { text: "oqim yoʻq", bad: true };
  if (st === "no-video") return { text: "tasvir yoʻq", warn: true };
  if (st === "disabled") return { text: "oʻchirilgan" };
  if (!c.codec) return { text: "oqim yoʻq", bad: true };
  return { text: fmtCodec(c.codec) };
}

/* "Jizzax · 3551 km · 5-piket" */
export function camSub(c: Camera): string {
  return [c.region, camPlace(c)].filter(Boolean).join(" · ");
}

export function regionKey(c: Camera): string {
  return hasGeo(c) ? (c.region || "—") : NOGEO;
}

/* Apostrof turlari bir xil; kirillcha so'rov lotinga o'giriladi (ma'lumot lotinda). */
const CYR: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k",
  л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch",
  ш: "sh", ъ: "'", ь: "", э: "e", ю: "yu", я: "ya", ў: "o'", қ: "q", ғ: "g'", ҳ: "h" };
export function norm(s: unknown): string {
  return String(s == null ? "" : s).toLowerCase().replace(/[ʻʼ'‘’`]/g, "'")
    .replace(/[а-яёўқғҳ]/g, (c) => CYR[c] ?? c).trim();
}

/** Mos qismni ajratish uchun bo'laklar: [oldin, mos, keyin] yoki null. */
export function splitHit(text: unknown, q: string): [string, string, string] | null {
  const t = String(text == null ? "" : text);
  if (!q) return null;
  const i = norm(t).indexOf(norm(q));
  if (i < 0) return null;
  const n = norm(q).length;
  return [t.slice(0, i), t.slice(i, i + n), t.slice(i + n)];
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* Leaflet/canvas uchun: "#2556eb14" → { color: "#2556eb", opacity: 0.078 }. */
export function cssColor(name: string, fallback = "#2556eb"): { color: string; opacity: number } {
  const v = cssVar(name) || fallback;
  const m = v.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (!m) return { color: v, opacity: 1 };
  return { color: "#" + m[1], opacity: m[2] ? parseInt(m[2], 16) / 255 : 1 };
}

export const p2 = (n: number) => String(n).padStart(2, "0");
export function hms(d: Date | string | number): string {
  const x = d instanceof Date ? d : new Date(d);
  return p2(x.getHours()) + ":" + p2(x.getMinutes()) + ":" + p2(x.getSeconds());
}
export function hm(d: Date | string | number): string {
  const x = d instanceof Date ? d : new Date(d);
  return p2(x.getHours()) + ":" + p2(x.getMinutes());
}

/* "45 s", "8 daq", "4 soat 10 daq", "8 kun 2 soat" */
export function fmtDur(sec: number | null | undefined): string {
  if (sec == null || isNaN(sec)) return "—";
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return sec + " s";
  if (sec < 3600) return Math.round(sec / 60) + " daq";
  if (sec < 86400) {
    const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return h + " soat" + (m ? " " + m + " daq" : "");
  }
  const d = Math.floor(sec / 86400), h = Math.round((sec % 86400) / 3600);
  return d + " kun" + (h ? " " + h + " soat" : "");
}

/* "hozirgina", "5 daqiqa oldin", "3 soat oldin", "12.03.2026 14:05" */
export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "maʼlum emas";
  const t = new Date(iso);
  if (isNaN(t.getTime())) return "maʼlum emas";
  const diff = (Date.now() - t.getTime()) / 1000;
  if (diff < 90) return "hozirgina";
  if (diff < 3600) return Math.round(diff / 60) + " daqiqa oldin";
  if (diff < 86400) return Math.round(diff / 3600) + " soat oldin";
  return p2(t.getDate()) + "." + p2(t.getMonth() + 1) + "." + t.getFullYear() + " " + hm(t);
}

/* "07.10 07:42" */
export function fmtStamp(iso: string): string {
  const t = new Date(iso);
  return isNaN(t.getTime()) ? "—" : p2(t.getDate()) + "." + p2(t.getMonth() + 1) + " " + hm(t);
}
/* Bugun — "10:05", oldin — "07.10 10:05" */
export function fmtWhen(iso: string): string {
  const t = new Date(iso);
  if (isNaN(t.getTime())) return "—";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return t >= today ? hm(t) : fmtStamp(iso);
}

/** Tor ekranlar (v3 MOBILE / PHONE media so'rovlari). */
export const MOBILE_Q = "(max-width:1023px)";
export const PHONE_Q = "(max-width:640px)";
