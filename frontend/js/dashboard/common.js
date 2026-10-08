/* ==========================================================================
   dashboard/common.js — dashboard uchun umumiy yordamchilar (v3, Figma 03)
   --------------------------------------------------------------------------
   Vazifasi:
     Formatlash (foiz, son, davomiylik, kun yorlig'i), holat modeli
     (backend state → UI status/yorliq), serverdan ma'lumot olish keshi,
     karta ichidagi holatlar (skeleton / Alert / bo'sh) va token ranglari.

   Eksport:
     fmtPct, fmtInt, fmtDur, fmtSince, p2, dayLabel, hhmm, WD
     camState(c), STATUS, LABEL
     load(url, maxAge)   — /api so'rovi, 55 s kesh (server 60 s keshlaydi), bir vaqtda bitta
     cached(url)         — keshdagi javob (yoki undefined)
     cssVar(name)        — token qiymati (grafik ranglari; mavzu almashsa qayta o'qiladi)
     withSkeleton(el, html, promise) — 300 ms dan uzoq yuklansa skeleton
     alertHtml(title, text) — Alert (xato) + "Qayta urinish" (data-db-retry)
     emptyHtml(title, text) — EmptyState (nodata)
     errHtml(err)        — 404 (eski server, endpoint yo'q) → EmptyState, aks holda Alert

   Bog'liqliklar: ../core/api.js, ../core/state.js (esc), ../core/ui.js (emptyState), ../core/icons.js
   ========================================================================== */
import { api } from "../core/api.js";
import { esc } from "../core/state.js";
import { emptyState } from "../core/ui.js";
import { icon } from "../core/icons.js";

/* ---------- Formatlash ---------- */
export const p2 = (n) => String(n).padStart(2, "0");
/* Date.getDay() tartibida (0 = yakshanba) */
export const WD = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];

export function fmtPct(v, digits = 1) {
  if (v == null || !isFinite(v)) return "—";
  return v.toFixed(digits).replace(".", ",") + "%";
}
export function fmtInt(n) {
  if (n == null || !isFinite(n)) return "—";
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
/* Soniya → "45 s", "7 daq", "3,9 soat", "28 kun" */
export function fmtDur(sec) {
  if (sec == null || !isFinite(sec)) return "—";
  if (sec < 60) return Math.round(sec) + " s";
  if (sec < 3600) return Math.round(sec / 60) + " daq";
  if (sec < 86400) {
    const h = sec / 3600;
    return (h < 10 ? h.toFixed(1).replace(".", ",").replace(",0", "") : Math.round(h)) + " soat";
  }
  return Math.round(sec / 86400) + " kun";
}
/* ISO vaqtdan hozirgacha: "10 daq", "11 soat", "28 kun" */
export function fmtSince(iso) {
  const t = Date.parse(iso);
  if (!t) return null;
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 60) return min + " daq";
  if (min < 1440) return Math.round(min / 60) + " soat";
  return Math.round(min / 1440) + " kun";
}
export function hhmm(ts) {
  const d = new Date(ts);
  return p2(d.getHours()) + ":" + p2(d.getMinutes());
}
/* "Ju 2" — kun yorlig'i; bugun bo'lsa "Bugun" */
export function dayLabel(date, isToday) {
  if (isToday) return "Bugun";
  const d = typeof date === "string" ? new Date(date + "T12:00:00") : new Date(date);
  return WD[d.getDay()] + " " + d.getDate();
}

/* ---------- Holat modeli (V3_FRONTEND.md) ---------- */
export function camState(c) {
  if (c.state) return c.state;
  return c.online === true ? "online" : c.online === false ? "offline" : "unknown";
}
export const STATUS = { online: "online", stalled: "no-video", offline: "offline", disabled: "disabled", unknown: "unknown" };
export const LABEL = { online: "Onlayn", stalled: "Tasvirsiz", offline: "Uzilgan", disabled: "Oʻchirilgan", unknown: "Nomaʼlum" };

/* ---------- Ma'lumot olish (kesh) ---------- */
const cache = new Map();   // url → { at, data, err, promise }

export function load(url, maxAge = 55000) {
  const c = cache.get(url);
  if (c && c.promise) return c.promise;
  if (c && c.data !== undefined && Date.now() - c.at < maxAge) return Promise.resolve(c.data);
  const entry = c || {};
  entry.promise = api(url).then((data) => {
    Object.assign(entry, { data, at: Date.now(), err: null, promise: null });
    return data;
  }, (err) => {
    entry.promise = null;
    entry.err = err;
    throw err;
  });
  cache.set(url, entry);
  return entry.promise;
}
export function cached(url) {
  const c = cache.get(url);
  return c ? c.data : undefined;
}
/* Majburiy yangilash (Qayta urinish) — kesh tozalanadi. */
export function invalidate() { cache.forEach((c) => { c.at = 0; }); }

/* Onlaynlik qatori davrga ko'ra: Bugun — 5 daq, 7 kun — soatlik, 30 kun — 6 soatlik.
   Eski backend `step=6h` ni bilmaydi (422) — soatlik olib, shu yerda 6 soatga yig'iladi.
   Natija: [{t, pct, online, total}] */
export async function loadSeries(days) {
  const pts = (j) => (j.points || []).filter((p) => p.total > 0)
    .map((p) => ({ t: Date.parse(p.ts), pct: p.pct != null ? p.pct : (p.online / p.total) * 100, online: p.online, total: p.total }));
  if (days <= 1) return pts(await load("/api/stats/series?days=1&step=5m"));
  if (days <= 7) return pts(await load("/api/stats/series?days=" + days + "&step=hour"));
  try {
    return pts(await load("/api/stats/series?days=" + days + "&step=6h"));
  } catch (e) {
    if (e.status !== 422 && e.status !== 400) throw e;
    const hourly = pts(await load("/api/stats/series?days=" + days + "&step=hour"));
    const buckets = new Map();
    hourly.forEach((p) => {
      const d = new Date(p.t);
      d.setHours(Math.floor(d.getHours() / 6) * 6, 0, 0, 0);
      const k = d.getTime();
      const b = buckets.get(k) || { t: k, on: 0, tot: 0, n: 0 };
      b.on += p.online; b.tot += p.total; b.n++;
      buckets.set(k, b);
    });
    return [...buckets.values()].sort((a, b) => a.t - b.t)
      .map((b) => ({ t: b.t, online: b.on / b.n, total: b.tot / b.n, pct: (b.on / b.tot) * 100 }));
  }
}

/* ---------- Karta holatlari ---------- */
/* Skeleton faqat 300 ms dan uzoq yuklansa (Dev handoff §7). */
export function withSkeleton(el, skeleton, promise) {
  if (!el) return promise;
  const t = setTimeout(() => {
    if (!el.dataset.filled) el.innerHTML = skeleton;
  }, 300);
  const done = () => clearTimeout(t);
  promise.then(done, done);
  return promise;
}
export function skelBars(n = 4, h = 16) {
  let s = '<div class="db-skel">';
  for (let i = 0; i < n; i++) {
    s += '<span class="skeleton" style="height:' + h + "px;width:" + (55 + (i * 23) % 40) + '%"></span>';
  }
  return s + "</div>";
}
export function skelBlock(h = 120) {
  return '<div class="db-skel"><span class="skeleton db-skel__block" style="height:' + h + 'px"></span></div>';
}
export function alertHtml(title = "Maʼlumot yuklanmadi", text = "Server javob bermadi.") {
  return '<div class="alert alert--error db-alert" role="alert">' + icon("triangle-exclamation", "sm") +
    '<div class="alert__body"><div class="alert__title">' + esc(title) + '</div><div class="alert__text">' +
    esc(text) + "</div></div>" +
    '<button class="btn btn--tertiary btn--sm" data-db-retry>Qayta urinish</button></div>';
}
export function emptyHtml(title, text = "") {
  return emptyState({ type: "nodata", title, text });
}
/* Eski (v2) serverda endpoint bo'lmasa — xato emas, "hali yo'q" holati. */
export function errHtml(err) {
  if (err && err.status === 404) return emptyHtml("Server bu hisobotni bermaydi", "Server yangilangach shu yerda koʻrinadi.");
  return alertHtml();
}

/* ---------- Tokenlar ---------- */
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
