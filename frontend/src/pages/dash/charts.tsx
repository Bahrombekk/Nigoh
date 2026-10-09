/* pages/dash/charts.tsx — dashboard grafiklari (SVG, kutubxonasiz; v3 dashboard/charts.js dan).
     <Sparkline>  — StatCard ichidagi maydonli chiziq (ton rangida)
     <LineChart>  — "Onlaynlik darajasi": maydonli chiziq, maqsad 95% punktiri, eng past nuqta,
                    kuzatuv bo'shlig'i shtrixi, hover kursor
     <Columns>    — kunlik ustunlar (ustida qiymat, ostida kun; bugun to'q)
     <HourBars>   — sutka soatlari: uzilish + qisqa uzilish qatlamlari, cho'qqi oynasi
     <Heatmap>    — hafta kuni × soat, karta enini to'liq egallaydi, "kuzatuv yo'q"
     <Donut>      — holatlar halqasi
   Qoidalar: ranglar faqat tokenlardan (cssVar), chizish haqiqiy pikselda (viewBox = element
   o'lchami) — o'lcham o'zgarsa (ResizeObserver) yoki mavzu almashsa ("nigoh:theme") qayta
   chiziladi. Grafik maslahati kursorga ergashadi (.db-tip, bitta umumiy element). */
import { useEffect, useLayoutEffect, useRef } from "react";
import { useT } from "@/i18n/I18nProvider";
import { cssVar } from "@/lib/theme";
import { dayLabel, p2 } from "./common";
import type { SeriesPoint, Hourly } from "./queries";

type T = (s: string) => string;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const f1 = (n: number) => n.toFixed(1);

/* ---------- Grafik maslahati (kursorga ergashadi) ---------- */
let tipEl: HTMLDivElement | null = null;
function tip() {
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.className = "db-tip";
    tipEl.setAttribute("role", "tooltip");
    document.body.appendChild(tipEl);
    addEventListener("scroll", chTipHide, true);
  }
  return tipEl;
}
export function chTipShow(title: string, text: string, cx: number, cy: number) {
  const el = tip();
  el.innerHTML = (title ? "<b>" + esc(title) + "</b>" : "") + (text ? "<span>" + esc(text) + "</span>" : "");
  el.classList.add("show");
  const r = el.getBoundingClientRect();
  let x = cx + 14, y = cy - r.height - 12;
  if (x + r.width > innerWidth - 8) x = cx - r.width - 14;
  if (y < 8) y = cy + 16;
  el.style.left = Math.max(8, x) + "px";
  el.style.top = y + "px";
}
export function chTipHide() { tipEl?.classList.remove("show"); }

/** "Kuzatuv yo'q" shtrix naqshi. */
function hatchDef(id: string) {
  return '<pattern id="' + id + '" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
    '<rect width="6" height="6" fill="' + cssVar("--color-bg-secondary") + '"/>' +
    '<line x1="0" y1="0" x2="0" y2="6" stroke="' + cssVar("--color-border-primary") + '" stroke-width="2"/></pattern>';
}
const size = (el: Element, defH: number) => ({
  W: Math.max(60, Math.round(el.clientWidth) || 300),
  H: Math.max(24, Math.round(el.clientHeight) || defH),
});
function hhmmOf(t: number) { const d = new Date(t); return p2(d.getHours()) + ":" + p2(d.getMinutes()); }
const fmtN = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ","));

/** Chizgichni o'lcham/mavzu o'zgarganda qayta chaqiradi. watchParent — balandlik ota elementdan. */
function useDraw(draw: (el: SVGSVGElement) => void, deps: unknown[], watchParent = false) {
  const ref = useRef<SVGSVGElement>(null);
  const fn = useRef(draw);
  fn.current = draw;
  useLayoutEffect(() => { if (ref.current) fn.current(ref.current); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let key = "";
    const keyOf = () => el.clientWidth + "x" + (watchParent ? el.parentElement?.clientHeight : el.clientHeight);
    key = keyOf();
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const k = keyOf();
        if (k === key) return;
        key = k;
        chTipHide();
        fn.current(el);
      });
    });
    ro.observe(el);
    if (watchParent && el.parentElement) ro.observe(el.parentElement);
    const th = () => fn.current(el);
    window.addEventListener("nigoh:theme", th);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); window.removeEventListener("nigoh:theme", th); chTipHide(); };
  }, [watchParent]);
  return ref;
}

/* ---------- Sparkline ---------- */
function drawSparkline(el: SVGSVGElement, values: number[], colorToken: string) {
  const data = values.filter((v) => v != null && isFinite(v));
  if (data.length < 2) { el.innerHTML = ""; return; }
  const { W, H } = size(el, 30);
  const P = 2;
  let max = Math.max(...data), min = Math.min(...data);
  if (max === min) { max += 1; min -= 1; }
  const x = (i: number) => (W * i) / (data.length - 1);
  const y = (v: number) => P + (H - 2 * P) * (1 - (v - min) / (max - min));
  const pts = data.map((v, i) => f1(x(i)) + "," + f1(y(v))).join(" ");
  const c = cssVar(colorToken);
  el.setAttribute("viewBox", "0 0 " + W + " " + H);
  el.innerHTML = '<polygon points="0,' + H + " " + pts + " " + W + "," + H + '" fill="' + c + '" fill-opacity=".14"/>' +
    '<polyline points="' + pts + '" fill="none" stroke="' + c + '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>';
}
export function Sparkline({ values, color }: { values: number[]; color: string }) {
  const sig = values.join(",");
  const ref = useDraw((el) => drawSparkline(el, values, color), [sig, color]);
  return <svg ref={ref} className="db-spark" aria-hidden="true" />;
}

/* ---------- Onlaynlik chizig'i ---------- */
interface LineOpts { goal?: number; span?: "day" | "week" | "month"; from?: number; to?: number }
function drawLine(el: SVGSVGElement, points: SeriesPoint[], opts: LineOpts, t: T) {
  const { W, H } = size(el, 174);
  const L = 40, R = 8, T0 = 8, B = 24;
  const data = points.filter((p) => p.pct != null && isFinite(p.pct));
  if (data.length < 2) { el.innerHTML = ""; return; }
  const brand = cssVar("--color-icon-brand"), grid = cssVar("--color-border-secondary"),
    warn = cssVar("--color-icon-warning"), warnT = cssVar("--color-text-warning"),
    err = cssVar("--color-icon-error"), bg = cssVar("--color-bg-primary"),
    tick = cssVar("--color-text-tertiary"), cur = cssVar("--color-border-strong");
  const t0 = opts.from || data[0].t, t1 = opts.to || data[data.length - 1].t;
  const x = (tm: number) => L + (W - L - R) * (tm - t0) / Math.max(1, t1 - t0);
  const y = (v: number) => T0 + (H - T0 - B) * (1 - v / 100);
  let out = "<defs>" + hatchDef("db-lc-hatch") + "</defs>";
  [100, 50, 0].forEach((v) => {
    out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + f1(y(v)) + '" y2="' + f1(y(v)) + '" stroke="' + grid + '"/>' +
      '<text x="0" y="' + f1(y(v) + 4) + '" fill="' + tick + '" class="db-ax">' + v + "%</text>";
  });
  // Vaqt yorliqlari: sutka — 4 soatda, hafta — har kun, oy — 5 kunda; o'ngda "hozir".
  const HOUR = 3600e3, DAY = 24 * HOUR;
  const span = opts.span || "day";
  const ticks: [number, string][] = [];
  if (span === "day") {
    const s = new Date(t0); s.setMinutes(0, 0, 0);
    for (let tm = s.getTime() + HOUR; tm < t1; tm += HOUR) if (new Date(tm).getHours() % 4 === 2) ticks.push([tm, hhmmOf(tm)]);
  } else {
    const s = new Date(t0); s.setHours(0, 0, 0, 0);
    const stepD = span === "week" ? 1 : 5;
    let k = 0;
    for (let tm = s.getTime() + DAY; tm < t1; tm += DAY, k++) if (k % stepD === 0) ticks.push([tm, t(dayLabel(new Date(tm)))]);
  }
  ticks.filter(([tm]) => x(tm) < W - R - 48 && x(tm) > L + 14).forEach(([tm, l]) => {
    out += '<text x="' + f1(x(tm)) + '" y="' + (H - 6) + '" text-anchor="middle" fill="' + tick + '" class="db-ax">' + esc(l) + "</text>";
  });
  out += '<text x="' + L + '" y="' + (H - 6) + '" text-anchor="middle" fill="' + tick + '" class="db-ax">' +
    esc(span === "day" ? hhmmOf(t0) : t(dayLabel(new Date(t0)))) + "</text>";
  out += '<text x="' + (W - R) + '" y="' + (H - 6) + '" text-anchor="end" fill="' + tick + '" class="db-ax">' + esc(t("hozir")) + "</text>";

  // Kuzatuv bo'shliqlari: chiziq uziladi, joyi shtrixlanadi (nolga tushirilmaydi).
  const dts = data.slice(1).map((p, i) => p.t - data[i].t).sort((a, b) => a - b);
  const typical = dts[Math.floor(dts.length / 2)] || 300e3;
  const runs: SeriesPoint[][] = [[data[0]]];
  for (let i = 1; i < data.length; i++) {
    if (data[i].t - data[i - 1].t > typical * 3) {
      out += '<rect x="' + f1(x(data[i - 1].t)) + '" y="' + T0 + '" width="' + f1(x(data[i].t) - x(data[i - 1].t)) +
        '" height="' + (H - T0 - B) + '" fill="url(#db-lc-hatch)"/>';
      runs.push([]);
    }
    runs[runs.length - 1].push(data[i]);
  }
  runs.forEach((run) => {
    const ps = run.map((p) => f1(x(p.t)) + "," + f1(y(p.pct))).join(" ");
    if (run.length > 1) {
      out += '<polygon points="' + f1(x(run[0].t)) + "," + f1(y(0)) + " " + ps + " " +
        f1(x(run[run.length - 1].t)) + "," + f1(y(0)) + '" fill="' + brand + '" fill-opacity=".1"/>';
    }
    out += '<polyline points="' + ps + '" fill="none" stroke="' + brand + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
  });
  // Maqsad chizig'i.
  const goal = opts.goal || 95;
  out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + f1(y(goal)) + '" y2="' + f1(y(goal)) +
    '" stroke="' + warn + '" stroke-width="1.5" stroke-dasharray="5 4"/>' +
    '<text x="' + (W - R) + '" y="' + f1(y(goal) + 15) + '" text-anchor="end" fill="' + warnT + '" stroke="' + bg +
    '" stroke-width="3" paint-order="stroke" class="db-ax">' + esc(t("maqsad " + goal + "%")) + "</text>";
  // Eng past nuqta — qizil.
  let low = data[0];
  data.forEach((p) => { if (p.pct < low.pct) low = p; });
  out += '<circle cx="' + f1(x(low.t)) + '" cy="' + f1(y(low.pct)) + '" r="3.5" fill="' + err + '" stroke="' + bg + '" stroke-width="1.5"/>';
  out += '<line class="db-cur" y1="' + T0 + '" y2="' + f1(y(0)) + '" stroke="' + cur + '" style="display:none"/>' +
    '<circle class="db-cur-dot" r="4" fill="' + brand + '" stroke="' + bg + '" stroke-width="2" style="display:none"/>' +
    '<rect class="db-hit" x="' + L + '" y="' + T0 + '" width="' + (W - L - R) + '" height="' + (H - T0 - B) + '" fill="transparent"/>';
  el.setAttribute("viewBox", "0 0 " + W + " " + H);
  el.innerHTML = out;

  const line = el.querySelector<SVGLineElement>(".db-cur")!, dot = el.querySelector<SVGCircleElement>(".db-cur-dot")!;
  const hit = el.querySelector<SVGRectElement>(".db-hit")!;
  hit.addEventListener("pointermove", (e) => {
    const r = el.getBoundingClientRect();
    const tm = t0 + ((e.clientX - r.left) - L) / (W - L - R) * (t1 - t0);
    let best = data[0];
    data.forEach((p) => { if (Math.abs(p.t - tm) < Math.abs(best.t - tm)) best = p; });
    const bx = f1(x(best.t));
    line.setAttribute("x1", bx); line.setAttribute("x2", bx); line.style.display = "";
    dot.setAttribute("cx", bx); dot.setAttribute("cy", f1(y(best.pct))); dot.style.display = "";
    const when = span === "day" ? hhmmOf(best.t) : t(dayLabel(new Date(best.t))) + " " + hhmmOf(best.t);
    chTipShow(when + " · " + Math.round(best.pct) + "%",
      best.total ? t(Math.round(best.online) + "/" + Math.round(best.total) + " onlayn") : "", e.clientX, e.clientY);
  });
  hit.addEventListener("pointerleave", () => { line.style.display = "none"; dot.style.display = "none"; chTipHide(); });
}
export function LineChart({ points, opts, label }: { points: SeriesPoint[]; opts: LineOpts; label: string }) {
  const t = useT();
  const ref = useDraw((el) => drawLine(el, points, opts, t), [points, opts.goal, opts.span, opts.from, opts.to, t]);
  return <svg ref={ref} className="db-svg" role="img" aria-label={t(label)} />;
}

/* ---------- Ustunlar ---------- */
export interface ColItem { label: string; value: number | null; cap: string | null; tipTitle: string; tipText: string; hi: boolean }
/** Usti 4px yumaloq, asosi tekis ustun. */
function colPath(x: number, w: number, yTop: number, yBase: number) {
  const r = Math.min(4, w / 2, Math.max(0, yBase - yTop));
  return "M" + f1(x) + "," + f1(yBase) + " L" + f1(x) + "," + f1(yTop + r) +
    " Q" + f1(x) + "," + f1(yTop) + " " + f1(x + r) + "," + f1(yTop) +
    " L" + f1(x + w - r) + "," + f1(yTop) +
    " Q" + f1(x + w) + "," + f1(yTop) + " " + f1(x + w) + "," + f1(yTop + r) +
    " L" + f1(x + w) + "," + f1(yBase) + " Z";
}
function drawColumns(el: SVGSVGElement, items: ColItem[], opts: { max?: number; color?: string }, t: T) {
  const { W, H } = size(el, 200);
  const T0 = 20, B = 22;
  const c = cssVar(opts.color || "--color-icon-brand");
  const tick = cssVar("--color-text-tertiary"), strong = cssVar("--color-text-primary"),
    capC = cssVar("--color-text-secondary"), ghost = cssVar("--color-border-primary");
  const vals = items.map((i) => i.value).filter((v): v is number => v != null);
  const max = opts.max || Math.max(1, ...vals);
  const n = items.length;
  const slot = W / n;
  const bw = Math.max(4, Math.min(28, slot * 0.56));
  const y = (v: number) => T0 + (H - T0 - B) * (1 - v / max);
  const every = n > 14 ? Math.ceil(n / 7) : 1;
  let out = "";
  items.forEach((it, i) => {
    const cx = slot * i + slot / 2, x0 = cx - bw / 2;
    if (it.value == null) {
      out += '<rect x="' + f1(x0) + '" y="' + T0 + '" width="' + f1(bw) + '" height="' + (H - T0 - B) +
        '" rx="4" fill="none" stroke="' + ghost + '" stroke-dasharray="3 3"/>';
    } else {
      const top = Math.min(y(it.value), H - B - 2);
      out += '<path class="db-col" d="' + colPath(x0, bw, top, H - B) + '" fill="' + c + '" fill-opacity="' + (it.hi ? 1 : 0.45) + '"/>';
      if (n <= 14 && it.cap != null) {
        out += '<text x="' + f1(cx) + '" y="' + f1(top - 6) + '" text-anchor="middle" fill="' + capC + '" class="db-ax">' + esc(it.cap) + "</text>";
      }
    }
    if (it.label && (i % every === 0 || it.hi)) {
      out += '<text x="' + f1(cx) + '" y="' + (H - 5) + '" text-anchor="middle" fill="' + (it.hi ? strong : tick) +
        '" class="db-ax' + (it.hi ? " db-ax--strong" : "") + '">' + esc(t(it.label)) + "</text>";
    }
    out += '<rect class="db-slot" data-i="' + i + '" x="' + f1(slot * i) + '" y="0" width="' + f1(slot) + '" height="' + (H - B) + '" fill="transparent"/>';
  });
  el.setAttribute("viewBox", "0 0 " + W + " " + H);
  el.innerHTML = out;
  el.onpointermove = (e) => {
    const s = (e.target as Element).closest<SVGElement>(".db-slot");
    if (!s) { chTipHide(); return; }
    const it = items[Number(s.dataset.i)];
    chTipShow(t(it.tipTitle), t(it.tipText), e.clientX, e.clientY);
  };
  el.onpointerleave = chTipHide;
}
export function Columns({ items, max, color, label }: { items: ColItem[]; max?: number; color: string; label: string }) {
  const t = useT();
  const ref = useDraw((el) => drawColumns(el, items, { max, color }, t), [items, max, color, t]);
  return <svg ref={ref} className="db-svg" role="img" aria-label={t(label)} />;
}

/* ---------- Sutka soatlari (ikki qatlamli ustunlar) ---------- */
function drawHourBars(el: SVGSVGElement, data: Hourly, t: T) {
  const { W, H } = size(el, 200);
  const L = 28, R = 4, T0 = 10, B = 20;
  const out = data.outages || [], bl = data.blips || [];
  const tot = (h: number) => (out[h] || 0) + (bl[h] || 0);
  const max = Math.max(1, ...Array.from({ length: 24 }, (_, h) => tot(h)));
  const err = cssVar("--color-icon-error"), warn = cssVar("--color-icon-warning"),
    grid = cssVar("--color-border-secondary"), tick = cssVar("--color-text-tertiary"),
    band = cssVar("--color-bg-brand-subtle"), bandT = cssVar("--color-text-brand");
  const slot = (W - L - R) / 24;
  const bw = Math.max(3, Math.min(22, slot * 0.62));
  const y = (v: number) => T0 + (H - T0 - B) * (1 - v / max);
  let svg = "";
  const pk = data.peak;
  if (pk && pk.outages) {
    const hrs: number[] = [];
    for (let h = pk.from_hour; hrs.length < 24; h = (h + 1) % 24) { hrs.push(h); if (h === (pk.to_hour + 23) % 24) break; }
    const runs: [number, number][] = [];
    hrs.forEach((h) => { const r = runs[runs.length - 1]; if (r && r[1] === h - 1) r[1] = h; else runs.push([h, h]); });
    runs.forEach(([a, b]) => {
      svg += '<rect x="' + f1(L + a * slot) + '" y="0" width="' + f1((b - a + 1) * slot) + '" height="' + (H - B) +
        '" rx="6" fill="' + band + '"/>';
    });
    svg += '<text x="' + f1(L + runs[0][0] * slot + 4) + '" y="' + (T0 + 2) + '" fill="' + bandT + '" class="db-ax">' + esc(t("choʻqqi")) + "</text>";
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
    const s = (e.target as Element).closest<SVGElement>(".db-slot");
    if (!s) { chTipHide(); return; }
    const h = Number(s.dataset.h);
    chTipShow(p2(h) + ":00–" + p2(h) + ":59",
      t(fmtN(out[h] || 0) + " ta uzilish") + " · " + t(fmtN(bl[h] || 0) + " ta qisqa uzilish"), e.clientX, e.clientY);
  };
  el.onpointerleave = chTipHide;
}
export function HourBars({ data }: { data: Hourly }) {
  const t = useT();
  const ref = useDraw((el) => drawHourBars(el, data, t), [data, t]);
  return <svg ref={ref} className="db-svg" role="img" aria-label={t("Sutka soatlari boʻyicha uzilishlar")} />;
}

/* ---------- Issiqlik xaritasi ---------- */
/** 5 bosqich (0 — eng och, kuzatuv bor lekin uzilish yo'q). */
export const HEAT_ALPHA = [0.07, 0.2, 0.36, 0.54, 0.74, 0.95];
export interface HeatRow { label: string; tip: string; hours: (number | null)[] | null }
function drawHeatmap(el: SVGSVGElement, rows: HeatRow[], t: T) {
  const W = Math.max(120, Math.round(el.clientWidth) || 380);
  const padL = 24, padB = 18, gap = 3;
  // Kataklar karta enini to'liq egallaydi.
  const cell = Math.max(6, (W - padL) / 24 - gap);
  // Katak balandligi karta bo'sh joyiga moslashadi (18–30 px).
  const avail = el.parentElement ? el.parentElement.clientHeight : 0;
  const rowH = Math.max(Math.min(cell, 18), Math.min(30, avail ? (avail - padB) / rows.length - gap : 18));
  const H = Math.round(rows.length * (rowH + gap) + padB);
  const red = cssVar("--color-icon-error"), tick = cssVar("--color-text-tertiary"), none = cssVar("--color-border-primary");
  const vals = rows.flatMap((r) => (r.hours || []).filter((v): v is number => v != null && v > 0)).sort((a, b) => a - b);
  const cuts = [0.2, 0.4, 0.6, 0.8].map((q) => vals[Math.floor(q * (vals.length - 1))] || 0);
  const level = (v: number) => (v > 0 ? 1 + cuts.filter((c) => v > c).length : 0);
  let out = "";
  rows.forEach((r, i) => {
    const y0 = i * (rowH + gap);
    out += '<text x="0" y="' + f1(y0 + rowH / 2 + 4) + '" fill="' + tick + '" class="db-ax">' + esc(t(r.label)) + "</text>";
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
  el.onpointermove = (e) => {
    const c = (e.target as Element).closest<SVGElement>(".db-hc");
    if (!c) { chTipHide(); return; }
    const r = rows[Number(c.dataset.r)], h = Number(c.dataset.h);
    const v = r.hours ? r.hours[h] : null;
    chTipShow(t(v == null ? "Kuzatuv yoʻq" : fmtN(v) + " ta uzilish"), t(r.tip) + " · " + p2(h) + ":00–" + p2(h) + ":59", e.clientX, e.clientY);
  };
  el.onpointerleave = chTipHide;
}
export function Heatmap({ rows }: { rows: HeatRow[] }) {
  const t = useT();
  const ref = useDraw((el) => drawHeatmap(el, rows, t), [rows, t], true);
  return <svg ref={ref} className="db-svg" role="img" aria-label={t("Uzilishlar xaritasi")} />;
}

/* ---------- Donut ---------- */
export interface DonutPart { key: string; n: number; color: string; label: string }
function drawDonut(el: SVGSVGElement, parts: DonutPart[], center: { value: string; sub: string }) {
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
export function Donut({ parts, value, sub }: { parts: DonutPart[]; value: string; sub: string }) {
  const t = useT();
  const sig = parts.map((p) => p.key + p.n).join(",");
  const ref = useDraw((el) => drawDonut(el, parts, { value, sub }), [sig, value, sub]);
  return <svg ref={ref} className="db-donut" role="img" aria-label={t("Holatlar taqsimoti")} />;
}
