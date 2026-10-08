/* ==========================================================================
   map/util.js — xarita bo'limining mayda yordamchilari (v3)
   --------------------------------------------------------------------------
   Vazifasi:
     Holat modeli (backend `state` → UI holati va matni), kamera matnlari
     (kodek, format, km/piket, qator meta), qidiruv normallashtirish va
     ajratib ko'rsatish, CSS tokenlarini JS'da o'qish (Leaflet/canvas uchun).
     Hech qanday DOM yoki xarita holatiga bog'liq emas — import qilish xavfsiz.

   Eksport:
     hasGeo(cam)            — haqiqiy koordinata bormi (0/0 emas)
     camStatus(cam)         — "online" | "no-video" | "offline" | "disabled" | "unknown"
     STATUS_LABEL           — holat → "Onlayn", "Tasvirsiz", ...
     STATUS_RANK            — eng yomon holatni topish uchun og'irlik
     worstStatus(list)      — ro'yxatdagi eng yomon holat
     fmtCodec, fmtRes, camPlace, camMeta, camSub — kamera matnlari
     NOGEO                  — koordinatasiz kameralar guruhi kaliti
     regionKey(cam)         — ro'yxatdagi guruh kaliti (koordinatasiz → NOGEO)
     norm(s)                — qidiruv uchun: kichik harf, apostroflar bir xil
     highlight(text, q)     — mos qismni <mark class="mp-hl"> bilan (esc qilingan)
     cssVar(name), cssColor(name) — token qiymati; {color, opacity} (#rrggbbaa → alfa)
     setParam(key, val), getParam(key) — manzil parametri (?camera, ?panel)
     p2, hms(date), fmtDur(sec), fmtAgo(iso)
   ========================================================================== */
import { esc } from "../core/state.js";

export const NOGEO = "\u0000nogeo";

export function hasGeo(c) {
  return c.lat != null && c.lng != null && !(c.lat === 0 && c.lng === 0);
}

/* Yagona holat modeli (docs/V3_FRONTEND.md): stalled → "Tasvirsiz". */
export function camStatus(c) {
  switch (c.state) {
    case "online": return "online";
    case "stalled": return "no-video";
    case "offline": return "offline";
    case "disabled": return "disabled";
    case "unknown": return "unknown";
    default: return c.online === false ? "offline" : c.online ? "online" : "unknown";
  }
}

export const STATUS_LABEL = {
  online: "Onlayn", "no-video": "Tasvirsiz", offline: "Uzilgan",
  disabled: "Oʻchirilgan", unknown: "Nomaʼlum",
};

export const STATUS_RANK = { offline: 4, "no-video": 3, unknown: 2, online: 1, disabled: 0 };

export function worstStatus(list) {
  let best = "disabled", r = -1;
  list.forEach((c) => {
    const s = camStatus(c);
    if (STATUS_RANK[s] > r) { r = STATUS_RANK[s]; best = s; }
  });
  return best;
}

/* "H265" → "H.265" */
export function fmtCodec(codec) {
  if (!codec) return "";
  return String(codec).replace(/^h\.?(26[45])$/i, "H.$1");
}

/* "1920x1080" → "1080p" */
export function fmtRes(res) {
  if (!res) return "";
  const m = String(res).match(/(\d+)\s*[x×]\s*(\d+)/i);
  return m ? m[2] + "p" : String(res);
}

/* "3551 km · 5-piket" */
export function camPlace(c) {
  if (c.km == null) return "";
  return c.km + " km" + (c.picket != null && c.picket !== "" ? " · " + c.picket + "-piket" : "");
}

/* CameraRow meta: kodek yoki holat sababi ("oqim yoʻq"). */
export function camMeta(c) {
  const st = camStatus(c);
  if (st === "offline") return { text: "oqim yoʻq", bad: true };
  if (st === "no-video") return { text: "tasvir yoʻq", warn: true };
  if (st === "disabled") return { text: "oʻchirilgan" };
  if (!c.codec) return { text: "oqim yoʻq", bad: true };
  return { text: fmtCodec(c.codec) };
}

/* "Jizzax · 3551 km · 5-piket" */
export function camSub(c) {
  return [c.region, camPlace(c)].filter(Boolean).join(" · ");
}

export function regionKey(c) {
  return hasGeo(c) ? (c.region || "—") : NOGEO;
}

/* Apostrof turlari (ʻ ʼ ' ‘ ’ `) bir xil — "Fargʻona" = "Farg'ona". Kirillcha
   soʻrov lotinga oʻgiriladi ("Тошкент" = "Toshkent") — interfeys ўзбекча boʻlsa ham
   maʼlumot (kamera nomi, hudud) lotinda. */
const CYR = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k",
  л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch",
  ш: "sh", ъ: "'", ь: "", э: "e", ю: "yu", я: "ya", ў: "o'", қ: "q", ғ: "g'", ҳ: "h" };
export function norm(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/[ʻʼ'‘’`]/g, "'")
    .replace(/[а-яёўқғҳ]/g, (c) => CYR[c] ?? c).trim();
}

export function highlight(text, q) {
  const t = String(text == null ? "" : text);
  if (!q) return esc(t);
  const i = norm(t).indexOf(norm(q));
  if (i < 0) return esc(t);
  const n = norm(q).length;
  return esc(t.slice(0, i)) + '<mark class="mp-hl">' + esc(t.slice(i, i + n)) + "</mark>" + esc(t.slice(i + n));
}

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* Leaflet/canvas uchun: "#2556eb14" → { color: "#2556eb", opacity: 0.078 }. */
export function cssColor(name, fallback = "#2556eb") {
  const v = cssVar(name) || fallback;
  const m = v.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (!m) return { color: v, opacity: 1 };
  return { color: "#" + m[1], opacity: m[2] ? parseInt(m[2], 16) / 255 : 1 };
}

/* Manzil parametri (?camera=89, ?panel=closed) — #hash va boshqa parametrlar saqlanadi. */
export function setParam(key, val) {
  const u = new URL(location.href);
  if (val == null || val === "") u.searchParams.delete(key); else u.searchParams.set(key, val);
  const s = u.searchParams.toString();
  const next = u.pathname + (s ? "?" + s : "") + u.hash;
  if (next !== location.pathname + location.search + location.hash) history.replaceState(null, "", next);
}
export function getParam(key) { return new URLSearchParams(location.search).get(key); }

export const p2 = (n) => String(n).padStart(2, "0");
export function hms(d) {
  d = d instanceof Date ? d : new Date(d);
  return p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds());
}
export function hm(d) {
  d = d instanceof Date ? d : new Date(d);
  return p2(d.getHours()) + ":" + p2(d.getMinutes());
}

/* "45 s", "8 daq", "4 soat 10 daq", "8 kun 2 soat" */
export function fmtDur(sec) {
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
export function fmtAgo(iso) {
  if (!iso) return "maʼlum emas";
  const t = new Date(iso);
  if (isNaN(t)) return "maʼlum emas";
  const diff = (Date.now() - t.getTime()) / 1000;
  if (diff < 90) return "hozirgina";
  if (diff < 3600) return Math.round(diff / 60) + " daqiqa oldin";
  if (diff < 86400) return Math.round(diff / 3600) + " soat oldin";
  return p2(t.getDate()) + "." + p2(t.getMonth() + 1) + "." + t.getFullYear() + " " + hm(t);
}
