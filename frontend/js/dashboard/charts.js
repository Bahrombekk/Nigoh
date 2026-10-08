/* ==========================================================================
   dashboard/charts.js — dashboard grafiklari (SVG, kutubxonasiz, Figma 03)
   --------------------------------------------------------------------------
   Vazifasi:
     Hozir / Trend / Tahlil tablaridagi chizmalar uchun umumiy chizgichlar:
       sparkline()  — StatCard ichidagi maydonli chiziq (ton rangida)
       lineChart()  — "Onlaynlik darajasi": maydonli chiziq, maqsad punktiri,
                      eng past nuqta (qizil), bo'shliq shtrixi, hover kursor
       columns()    — kunlik ustunlar (ustida qiymat, ostida kun; bugun to'q)
       hourBars()   — sutka soatlari: uzilish + sakrash qatlamlari, cho'qqi oynasi
       heatmap()    — hafta kuni × soat, 5 bosqichli qizil shkala, "kuzatuv yo'q"
       donut()      — holatlar taqsimoti halqasi
     va kursorga ergashuvchi grafik maslahati (chartTip).

   Eksport:
     chartTip, chTipShow(title, text, x, y), chTipHide(), firstDraw(id), hatchDef(id),
     sparkline, lineChart, columns, hourBars, heatmap, donut, HEAT_ALPHA

   Qoidalar:
     - Ranglar faqat tokenlardan: cssVar("--color-…") bilan o'qiladi, mavzu
       almashganda ("theme:changed") chaqiruvchi modul qayta chizadi.
     - Chizish haqiqiy pikselda (viewBox = element o'lchami) — yozuvlar har
       ekranda 11 px bo'lib qoladi; o'lcham o'zgarsa qayta chiziladi.
     - Raqamlar tabular-nums (CSS: .db-svg text).
   ========================================================================== */
import { esc } from "../core/state.js";
import { cssVar, p2, dayLabel } from "./common.js";

/* ---------- Grafik maslahati (kursorga ergashadi) ---------- */
class ChartTip {
  constructor() {
    this.el = document.createElement("div");
    this.el.className = "db-tip";
    this.el.setAttribute("role", "tooltip");
    document.body.appendChild(this.el);
  }
  show(title, text, cx, cy) {
    this.el.innerHTML = (title ? "<b>" + esc(title) + "</b>" : "") + (text ? "<span>" + esc(text) + "</span>" : "");
    this.el.classList.add("show");
    const r = this.el.getBoundingClientRect();
    let x = cx + 14, y = cy - r.height - 12;
    if (x + r.width > innerWidth - 8) x = cx - r.width - 14;
    if (y < 8) y = cy + 16;
    this.el.style.left = Math.max(8, x) + "px";
    this.el.style.top = y + "px";
  }
  hide() { this.el.classList.remove("show"); }
}
export const chartTip = new ChartTip();
export function chTipShow(title, text, x, y) { chartTip.show(title, text, x, y); }
export function chTipHide() { chartTip.hide(); }
addEventListener("scroll", chTipHide, true);

/* Kirish animatsiyasi har grafikda bir marta (avto-yangilashda qayta o'ynamaydi). */
const animated = new Set();
export function firstDraw(id) {
  if (animated.has(id)) return false;
  animated.add(id);
  return !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* "Kuzatuv yo'q" shtrix naqshi. */
export function hatchDef(id) {
  return '<pattern id="' + id + '" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
    '<rect width="6" height="6" fill="' + cssVar("--color-bg-secondary") + '"/>' +
    '<line x1="0" y1="0" x2="0" y2="6" stroke="' + cssVar("--color-border-primary") + '" stroke-width="2"/></pattern>';
}

const size = (el, defH) => ({
  W: Math.max(60, Math.round(el.clientWidth) || 300),
  H: Math.max(24, Math.round(el.clientHeight) || defH),
});
const f1 = (n) => n.toFixed(1);

/* ---------- Sparkline ---------- */
/* values — sonlar (null — bo'shliq, tashlab yuboriladi); color — token nomi. */
export function sparkline(el, values, colorToken) {
  if (!el) return;
  const data = values.filter((v) => v != null && isFinite(v));
  if (data.length < 2) { el.innerHTML = ""; return; }
  const { W, H } = size(el, 30);
  const P = 2;
  let max = Math.max(...data), min = Math.min(...data);
  if (max === min) { max += 1; min -= 1; }
  const x = (i) => (W * i) / (data.length - 1);
  const y = (v) => P + (H - 2 * P) * (1 - (v - min) / (max - min));
  const pts = data.map((v, i) => f1(x(i)) + "," + f1(y(v))).join(" ");
  const c = cssVar(colorToken);
  el.setAttribute("viewBox", "0 0 " + W + " " + H);
  el.innerHTML = '<polygon points="0,' + H + " " + pts + " " + W + "," + H + '" fill="' + c + '" fill-opacity=".14"/>' +
    '<polyline points="' + pts + '" fill="none" stroke="' + c + '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>';
}

/* ---------- Onlaynlik chizig'i ---------- */
/* points — [{t (ms), pct, online, total}], opts — {goal, span: "day"|"week"|"month", onLow(p)} */
export function lineChart(el, points, opts = {}) {
  if (!el) return;
  const { W, H } = size(el, 174);
  const L = 40, R = 8, T = 8, B = 24;
  const data = points.filter((p) => p.pct != null && isFinite(p.pct));
  if (data.length < 2) { el.innerHTML = ""; return; }
  const brand = cssVar("--color-icon-brand"), grid = cssVar("--color-border-secondary"),
        warn = cssVar("--color-icon-warning"), warnT = cssVar("--color-text-warning"),
        err = cssVar("--color-icon-error"), bg = cssVar("--color-bg-primary"),
        tick = cssVar("--color-text-tertiary"), cur = cssVar("--color-border-strong");
  const t0 = opts.from || data[0].t, t1 = opts.to || data[data.length - 1].t;
  const x = (t) => L + (W - L - R) * (t - t0) / Math.max(1, t1 - t0);
  const y = (v) => T + (H - T - B) * (1 - v / 100);
  let out = "<defs>" + hatchDef("db-lc-hatch") + "</defs>";
  [100, 50, 0].forEach((v) => {
    out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + f1(y(v)) + '" y2="' + f1(y(v)) + '" stroke="' + grid + '"/>' +
      '<text x="0" y="' + f1(y(v) + 4) + '" fill="' + tick + '" class="db-ax">' + v + "%</text>";
  });

  // Vaqt yorliqlari: sutka — 4 soatda, hafta — har kun, oy — 5 kunda; o'ngda "hozir".
  const HOUR = 3600e3, DAY = 24 * HOUR;
  const span = opts.span || "day";
  const ticks = [];
  if (span === "day") {
    const s = new Date(t0); s.setMinutes(0, 0, 0);
    for (let t = s.getTime() + HOUR; t < t1; t += HOUR) if (new Date(t).getHours() % 4 === 2) ticks.push([t, hhmmOf(t)]);
  } else {
    const s = new Date(t0); s.setHours(0, 0, 0, 0);
    const stepD = span === "week" ? 1 : 5;
    let k = 0;
    for (let t = s.getTime() + DAY; t < t1; t += DAY, k++) if (k % stepD === 0) ticks.push([t, dayLabel(new Date(t))]);
  }
  ticks.filter(([t]) => x(t) < W - R - 48 && x(t) > L + 14).forEach(([t, l]) => {
    out += '<text x="' + f1(x(t)) + '" y="' + (H - 6) + '" text-anchor="middle" fill="' + tick + '" class="db-ax">' + l + "</text>";
  });
  out += '<text x="' + L + '" y="' + (H - 6) + '" text-anchor="middle" fill="' + tick + '" class="db-ax">' +
    (span === "day" ? hhmmOf(t0) : dayLabel(new Date(t0))) + "</text>";
  out += '<text x="' + (W - R) + '" y="' + (H - 6) + '" text-anchor="end" fill="' + tick + '" class="db-ax">hozir</text>';

  // Kuzatuv bo'shliqlari: chiziq uziladi, joyi shtrixlanadi (nolga tushirilmaydi).
  const dts = data.slice(1).map((p, i) => p.t - data[i].t).sort((a, b) => a - b);
  const typical = dts[Math.floor(dts.length / 2)] || 300e3;
  const runs = [[data[0]]];
  for (let i = 1; i < data.length; i++) {
    if (data[i].t - data[i - 1].t > typical * 3) {
      out += '<rect x="' + f1(x(data[i - 1].t)) + '" y="' + T + '" width="' + f1(x(data[i].t) - x(data[i - 1].t)) +
        '" height="' + (H - T - B) + '" fill="url(#db-lc-hatch)"/>';
      runs.push([]);
    }
    runs[runs.length - 1].push(data[i]);
  }
  runs.forEach((run) => {
    const pts = run.map((p) => f1(x(p.t)) + "," + f1(y(p.pct))).join(" ");
    if (run.length > 1) {
      out += '<polygon points="' + f1(x(run[0].t)) + "," + f1(y(0)) + " " + pts + " " +
        f1(x(run[run.length - 1].t)) + "," + f1(y(0)) + '" fill="' + brand + '" fill-opacity=".1"/>';
    }
    out += '<polyline points="' + pts + '" fill="none" stroke="' + brand + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
  });

  // Maqsad chizig'i.
  const goal = opts.goal || 95;
  out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + f1(y(goal)) + '" y2="' + f1(y(goal)) +
    '" stroke="' + warn + '" stroke-width="1.5" stroke-dasharray="5 4"/>' +
    '<text x="' + (W - R) + '" y="' + f1(y(goal) + 15) + '" text-anchor="end" fill="' + warnT + '" stroke="' + bg + '" stroke-width="3" paint-order="stroke" class="db-ax">maqsad ' + goal + "%</text>";

  // Eng past nuqta — qizil.
  let low = data[0];
  data.forEach((p) => { if (p.pct < low.pct) low = p; });
  out += '<circle cx="' + f1(x(low.t)) + '" cy="' + f1(y(low.pct)) + '" r="3.5" fill="' + err + '" stroke="' + bg + '" stroke-width="1.5"/>';

  out += '<line class="db-cur" y1="' + T + '" y2="' + f1(y(0)) + '" stroke="' + cur + '" style="display:none"/>' +
    '<circle class="db-cur-dot" r="4" fill="' + brand + '" stroke="' + bg + '" stroke-width="2" style="display:none"/>' +
    '<rect class="db-hit" x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + (H - T - B) + '" fill="transparent"/>';
  el.setAttribute("viewBox", "0 0 " + W + " " + H);
  el.innerHTML = out;

  const line = el.querySelector(".db-cur"), dot = el.querySelector(".db-cur-dot");
  const hit = el.querySelector(".db-hit");
  hit.addEventListener("pointermove", (e) => {
    const r = el.getBoundingClientRect();
    const t = t0 + ((e.clientX - r.left) - L) / (W - L - R) * (t1 - t0);
    let best = data[0];
    data.forEach((p) => { if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p; });
    const bx = f1(x(best.t));
    line.setAttribute("x1", bx); line.setAttribute("x2", bx); line.style.display = "";
    dot.setAttribute("cx", bx); dot.setAttribute("cy", f1(y(best.pct))); dot.style.display = "";
    const when = span === "day" ? hhmmOf(best.t) : dayLabel(new Date(best.t)) + " " + hhmmOf(best.t);
    chTipShow(when + " · " + Math.round(best.pct) + "%",
      best.total ? Math.round(best.online) + "/" + Math.round(best.total) + " onlayn" : "", e.clientX, e.clientY);
  });
  hit.addEventListener("pointerleave", () => { line.style.display = "none"; dot.style.display = "none"; chTipHide(); });
}
function hhmmOf(t) { const d = new Date(t); return p2(d.getHours()) + ":" + p2(d.getMinutes()); }

/* ---------- Ustunlar ---------- */
/* items — [{label, value|null, cap, tipTitle, tipText, hi}], opts — {max, color (token), caps} */
export function columns(el, items, opts = {}) {
  if (!el) return;
  const { W, H } = size(el, 200);
  const T = 20, B = 22;
  const c = cssVar(opts.color || "--color-icon-brand");
  const tick = cssVar("--color-text-tertiary"), strong = cssVar("--color-text-primary"),
        capC = cssVar("--color-text-secondary"), ghost = cssVar("--color-border-primary");
  const vals = items.map((i) => i.value).filter((v) => v != null);
  const max = opts.max || Math.max(1, ...vals);
  const n = items.length;
  const slot = W / n;
  const bw = Math.max(4, Math.min(28, slot * 0.56));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const every = n > 14 ? Math.ceil(n / 7) : 1;
  let out = "";
  items.forEach((it, i) => {
    const cx = slot * i + slot / 2, x0 = cx - bw / 2;
    if (it.value == null) {
      out += '<rect x="' + f1(x0) + '" y="' + T + '" width="' + f1(bw) + '" height="' + (H - T - B) +
        '" rx="4" fill="none" stroke="' + ghost + '" stroke-dasharray="3 3"/>';
    } else {
      const top = Math.min(y(it.value), H - B - 2);
      out += '<path class="db-col" d="' + colPath(x0, bw, top, H - B) + '" fill="' + c + '" fill-opacity="' + (it.hi ? 1 : 0.45) + '"/>';
      if (opts.caps !== false && n <= 14 && it.cap != null) {
        out += '<text x="' + f1(cx) + '" y="' + f1(top - 6) + '" text-anchor="middle" fill="' + capC + '" class="db-ax">' + esc(it.cap) + "</text>";
      }
    }
    if (it.label && (i % every === 0 || it.hi)) {
      out += '<text x="' + f1(cx) + '" y="' + (H - 5) + '" text-anchor="middle" fill="' + (it.hi ? strong : tick) +
        '" class="db-ax' + (it.hi ? " db-ax--strong" : "") + '">' + esc(it.label) + "</text>";
    }
    out += '<rect class="db-slot" data-i="' + i + '" x="' + f1(slot * i) + '" y="0" width="' + f1(slot) + '" height="' + (H - B) + '" fill="transparent"/>';
  });
  el.setAttribute("viewBox", "0 0 " + W + " " + H);
  el.innerHTML = out;
  el.querySelectorAll(".db-slot").forEach((r) => {
    const it = items[Number(r.dataset.i)];
    r.addEventListener("pointermove", (e) => chTipShow(it.tipTitle, it.tipText, e.clientX, e.clientY));
    r.addEventListener("pointerleave", chTipHide);
  });
}
/* Usti 4px yumaloq, asosi tekis ustun. */
function colPath(x, w, yTop, yBase) {
  const r = Math.min(4, w / 2, Math.max(0, yBase - yTop));
  return "M" + f1(x) + "," + f1(yBase) + " L" + f1(x) + "," + f1(yTop + r) +
    " Q" + f1(x) + "," + f1(yTop) + " " + f1(x + r) + "," + f1(yTop) +
    " L" + f1(x + w - r) + "," + f1(yTop) +
    " Q" + f1(x + w) + "," + f1(yTop) + " " + f1(x + w) + "," + f1(yTop + r) +
    " L" + f1(x + w) + "," + f1(yBase) + " Z";
}

/* ---------- Sutka soatlari (ikki qatlamli ustunlar) ---------- */
/* data — {outages: [24], blips: [24], peak: {from_hour, to_hour, outages}|null}.
   Pastda — haqiqiy uzilishlar (qizil), ustida — qisqa sakrashlar (to'q sariq, och);
   eng zich 3 soatlik oyna fon bilan ajratiladi (yarim tundan o'tishi mumkin). */
export function hourBars(el, data) {
  if (!el) return;
  const { W, H } = size(el, 200);
  const L = 28, R = 4, T = 10, B = 20;
  const out = data.outages || [], bl = data.blips || [];
  const tot = (h) => (out[h] || 0) + (bl[h] || 0);
  const max = Math.max(1, ...Array.from({ length: 24 }, (_, h) => tot(h)));
  const err = cssVar("--color-icon-error"), warn = cssVar("--color-icon-warning"),
        grid = cssVar("--color-border-secondary"), tick = cssVar("--color-text-tertiary"),
        band = cssVar("--color-bg-brand-subtle"), bandT = cssVar("--color-text-brand");
  const slot = (W - L - R) / 24;
  const bw = Math.max(3, Math.min(22, slot * 0.62));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  let svg = "";
  // Cho'qqi oynasi
  const pk = data.peak;
  if (pk && pk.outages) {
    const hrs = [];
    for (let h = pk.from_hour; hrs.length < 24; h = (h + 1) % 24) { hrs.push(h); if (h === (pk.to_hour + 23) % 24) break; }
    const runs = [];
    hrs.forEach((h) => { const r = runs[runs.length - 1]; if (r && r[1] === h - 1) r[1] = h; else runs.push([h, h]); });
    runs.forEach(([a, b]) => {
      svg += '<rect x="' + f1(L + a * slot) + '" y="0" width="' + f1((b - a + 1) * slot) + '" height="' + (H - B) +
        '" rx="6" fill="' + band + '"/>';
    });
    svg += '<text x="' + f1(L + runs[0][0] * slot + 4) + '" y="' + (T + 2) + '" fill="' + bandT + '" class="db-ax">choʻqqi</text>';
  }
  [0, 0.5, 1].forEach((k) => {
    const v = Math.round(max * k);
    svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + f1(y(v)) + '" y2="' + f1(y(v)) + '" stroke="' + grid + '"/>' +
      '<text x="' + (L - 6) + '" y="' + f1(y(v) + 4) + '" text-anchor="end" fill="' + tick + '" class="db-ax">' + v + "</text>";
  });
  for (let h = 0; h < 24; h++) {
    const cx = L + slot * h + slot / 2, x0 = cx - bw / 2;
    const o = out[h] || 0, b = bl[h] || 0;
    if (o) svg += '<path d="' + colPath(x0, bw, y(o), H - B) + '" fill="' + err + '"/>';
    if (b) {
      const top = y(o + b), base = y(o) - (o ? 1.5 : 0);
      if (base - top > 0.5) svg += '<path d="' + colPath(x0, bw, top, base) + '" fill="' + warn + '" fill-opacity=".6"/>';
    }
    if (h % 3 === 0) svg += '<text x="' + f1(cx) + '" y="' + (H - 5) + '" text-anchor="middle" fill="' + tick + '" class="db-ax">' + p2(h) + "</text>";
    svg += '<rect class="db-slot" data-h="' + h + '" x="' + f1(L + slot * h) + '" y="0" width="' + f1(slot) + '" height="' + (H - B) + '" fill="transparent"/>';
  }
  el.setAttribute("viewBox", "0 0 " + W + " " + H);
  el.innerHTML = svg;
  el.onpointermove = (e) => {
    const s = e.target.closest(".db-slot");
    if (!s) { chTipHide(); return; }
    const h = Number(s.dataset.h);
    chTipShow(p2(h) + ":00–" + p2(h) + ":59",
      fmtN(out[h] || 0) + " ta uzilish · " + fmtN(bl[h] || 0) + " ta qisqa uzilish", e.clientX, e.clientY);
  };
  el.onpointerleave = chTipHide;
}
const fmtN = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ","));

/* ---------- Issiqlik xaritasi ---------- */
/* 5 bosqich (0 — eng och, kuzatuv bor lekin uzilish yo'q). */
export const HEAT_ALPHA = [0.07, 0.2, 0.36, 0.54, 0.74, 0.95];
/* rows — [{label, tip, hours: [24 ta son|null] | null}] */
export function heatmap(el, rows) {
  if (!el) return;
  const W = Math.max(120, Math.round(el.clientWidth) || 380);
  const padL = 24, padB = 18, gap = 3;
  // Kataklar karta enini to'liq egallaydi (ilgari eni 18 px bilan cheklanib,
  // keng kartada jadval chap tomonda qolib ketardi).
  const cell = Math.max(6, (W - padL) / 24 - gap);
  // Katak balandligi karta bo'sh joyiga moslashadi (18–30 px).
  const avail = el.parentElement ? el.parentElement.clientHeight : 0;
  const rowH = Math.max(Math.min(cell, 18), Math.min(30, avail ? (avail - padB) / rows.length - gap : 18));
  const H = Math.round(rows.length * (rowH + gap) + padB);
  const red = cssVar("--color-icon-error"), tick = cssVar("--color-text-tertiary"),
        none = cssVar("--color-border-primary");
  const vals = rows.flatMap((r) => (r.hours || []).filter((v) => v != null && v > 0)).sort((a, b) => a - b);
  const cuts = [0.2, 0.4, 0.6, 0.8].map((q) => vals[Math.floor(q * (vals.length - 1))] || 0);
  const level = (v) => (v > 0 ? 1 + cuts.filter((c) => v > c).length : 0);
  let out = "";
  rows.forEach((r, i) => {
    const y0 = i * (rowH + gap);
    out += '<text x="0" y="' + f1(y0 + rowH / 2 + 4) + '" fill="' + tick + '" class="db-ax">' + esc(r.label) + "</text>";
    for (let h = 0; h < 24; h++) {
      const v = r.hours ? r.hours[h] : null;
      const x0 = padL + h * (cell + gap);
      if (v == null) {
        out += '<rect class="db-hc" data-r="' + i + '" data-h="' + h + '" x="' + f1(x0 + 0.5) + '" y="' + f1(y0 + 0.5) +
          '" width="' + f1(cell - 1) + '" height="' + f1(rowH - 1) + '" rx="3" fill="transparent" stroke="' + none + '" stroke-dasharray="2 2"/>';
      } else {
        out += '<rect class="db-hc" data-r="' + i + '" data-h="' + h + '" x="' + f1(x0) + '" y="' + f1(y0) + '" width="' + f1(cell) +
          '" height="' + f1(rowH) + '" rx="3" fill="' + red + '" fill-opacity="' + HEAT_ALPHA[level(v)] + '"/>';
      }
    }
  });
  [0, 6, 12, 18].forEach((h) => {
    out += '<text x="' + f1(padL + h * (cell + gap)) + '" y="' + (H - 3) + '" fill="' + tick + '" class="db-ax">' + p2(h) + "</text>";
  });
  el.setAttribute("viewBox", "0 0 " + W + " " + H);
  el.style.height = H + "px";
  el.innerHTML = out;
  const fmtN = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ","));
  el.onpointermove = (e) => {
    const c = e.target.closest(".db-hc");
    if (!c) { chTipHide(); return; }
    const r = rows[Number(c.dataset.r)], h = Number(c.dataset.h);
    const v = r.hours ? r.hours[h] : null;
    chTipShow(v == null ? "Kuzatuv yoʻq" : fmtN(v) + " ta uzilish",
      r.tip + " · " + p2(h) + ":00–" + p2(h) + ":59", e.clientX, e.clientY);
  };
  el.onpointerleave = chTipHide;
}

/* ---------- Donut ---------- */
/* parts — [{key, n, color (token), label}], center — {value, sub} */
export function donut(el, parts, center) {
  if (!el) return;
  const S = 132, R = 54, SW = 14, C = 2 * Math.PI * R;
  const total = parts.reduce((s, p) => s + p.n, 0) || 1;
  const shown = parts.filter((p) => p.n > 0);
  const gap = shown.length > 1 ? 3 : 0;
  let acc = 0, segs = "";
  shown.forEach((p) => {
    const len = Math.max((C * p.n) / total - gap, 0.5);
    segs += '<circle class="db-dn-seg" data-k="' + p.key + '" cx="' + S / 2 + '" cy="' + S / 2 + '" r="' + R +
      '" fill="none" stroke="' + cssVar(p.color) + '" stroke-width="' + SW + '" stroke-dasharray="' + f1(len) + " " + f1(C) +
      '" stroke-dashoffset="' + f1(-acc) + '" transform="rotate(-90 ' + S / 2 + " " + S / 2 + ')"/>';
    acc += (C * p.n) / total;
  });
  el.setAttribute("viewBox", "0 0 " + S + " " + S);
  el.innerHTML = '<circle cx="' + S / 2 + '" cy="' + S / 2 + '" r="' + R + '" fill="none" stroke="' + cssVar("--color-bg-tertiary") +
    '" stroke-width="' + SW + '"/>' + segs +
    '<text x="' + S / 2 + '" y="' + (S / 2 + 4) + '" text-anchor="middle" class="db-dn-v" fill="' + cssVar("--color-text-primary") + '">' +
    esc(center.value) + "</text>" +
    '<text x="' + S / 2 + '" y="' + (S / 2 + 22) + '" text-anchor="middle" class="db-ax" fill="' + cssVar("--color-text-tertiary") + '">' +
    esc(center.sub) + "</text>";
}
