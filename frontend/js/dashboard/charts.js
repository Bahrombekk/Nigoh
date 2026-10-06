/* ==========================================================================
   dashboard/charts.js — dashboard grafiklari (SVG, kutubxonasiz)
   --------------------------------------------------------------------------
   Vazifasi:
     Dashboarddagi vaqt grafiklari: davr bo'yicha onlaynlik chizig'i
     (bo'shliqlar shtrixlanadi), 7 kunlik ustunlar (uptime, uzilishlar),
     bugungi soatlik uzilishlar; umumiy grafik maslahati (tooltip) va
     overview.js ham ishlatadigan kichik yordamchilar.

   Eksport:
     ChartTooltip               — klass: show(value, label, x, y), hide() — #chart-tip
     chartTooltip               — yagona nusxa
     chTipShow(v, l, x, y)      — chartTooltip.show ga yo'naltiradi
     chTipHide()                — chartTooltip.hide ga yo'naltiradi
     firstDraw(id)              — kirish animatsiyasi shu grafikda birinchi martami
     hatchDef(id)               — "ma'lumot yo'q" shtrix naqshi (<pattern>)
     Charts                     — klass: loadTimeline, renderTimeline, renderDailyCharts,
                                  renderHourly; konstruktor davr va oyna o'lchami hodisalarini ulaydi
     charts                     — yagona nusxa
     loadTimeline()             — 7/30 kunlik soatlik onlaynlikni olib chizish
     renderTimeline()           — onlaynlik chizig'i va ustidagi yig'ma raqamlar
     renderDailyCharts()        — 7 kunlik ikki ustunli panel
     renderHourly()             — bugungi uzilishlar soat kesimida

   Bog'liqliklar:
     import: ../core/state.js ($, esc, state)

   DOM: #chart-tip, #ch-timeline, #ch-timeline-empty, #tl-sub, #tl-now, #tl-avg,
        #tl-min, #tl-week, #tl-n, #ch-daily-up(-empty), #ch-daily-ev(-empty),
        #ch-hourly(-empty)
   Backend: GET /api/stats/timeline?days=7|30 (uzun davr); qolgani state.stats dan
            (/api/stats/dashboard — dashboard.js yuklaydi)

   Qoidalar / tuzoqlar:
     - Ranglar CSS o'zgaruvchilaridan (var(--accent) ...) — mavzu almashsa moslashadi.
     - Chizish haqiqiy pikselda (viewBox = element kengligi); oyna o'lchami
       o'zgarsa (faqat dashboard ochiq bo'lsa) 200 ms dan keyin qayta chiziladi.
     - "period:changed" hodisasini overview.js yuboradi (davr tugmalari).
     - Ilgari shu faylda turgan hodisalar lentasi/qo'ng'iroq endi
       layout/notifications.js da, "Tizim holati" va 15 s avto-yangilash —
       dashboard/dashboard.js da.
   ========================================================================== */
import { $, esc, state } from "../core/state.js";

/* ---------- Grafiklar (SVG, kutubxonasiz) ----------
   Ranglar CSS o'zgaruvchilaridan olinadi — mavzu almashsa moslashadi. */

export class ChartTooltip {
  constructor() {
    this.el = $("chart-tip");
  }

  show(value, label, cx, cy) {
    const chTip = this.el;
    chTip.querySelector(".v").textContent = value;
    chTip.querySelector(".l").textContent = label;
    chTip.style.display = "block";
    const r = chTip.getBoundingClientRect();
    let x = cx + 14, y = cy - r.height - 12;
    if (x + r.width > innerWidth - 8) x = cx - r.width - 14;
    if (y < 8) y = cy + 16;
    chTip.style.left = x + "px";
    chTip.style.top = y + "px";
  }

  hide() { this.el.style.display = "none"; }
}

export const chartTooltip = new ChartTooltip();

export function chTipShow(value, label, cx, cy) { chartTooltip.show(value, label, cx, cy); }
export function chTipHide() { chartTooltip.hide(); }

/* Kirish animatsiyasi har grafikda faqat BIR marta: dashboard har 15 s da
   qayta chiziladi, har safar o'ynasa ko'zni charchatadi. */
const animated = new Set();
export function firstDraw(id) {
  if (animated.has(id)) return false;
  animated.add(id);
  return !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* Ma'lumot yo'q ustun uchun shtrix naqsh — "0" bilan adashmasin. */
export function hatchDef(id) {
  return '<pattern id="' + id + '" width="6" height="6" patternUnits="userSpaceOnUse" ' +
    'patternTransform="rotate(45)"><rect width="6" height="6" style="fill:var(--surface-2)"/>' +
    '<line x1="0" y1="0" x2="0" y2="6" style="stroke:var(--faint);stroke-width:1.5;opacity:.45"/></pattern>';
}

/* Ustuncha balandligi uchun "chiroyli" yuqori chegara: 4, 5, 10, 20, 50… */
function niceMax(v) {
  if (v <= 4) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

/* Usti 4px yumaloq, asosi tekis ustuncha (dataviz spetsifikatsiyasi). */
function colPath(x, w, yTop, yBase) {
  const r = Math.min(4, w / 2, Math.max(0, yBase - yTop));
  return "M" + x.toFixed(1) + "," + yBase.toFixed(1) +
    " L" + x.toFixed(1) + "," + (yTop + r).toFixed(1) +
    " Q" + x.toFixed(1) + "," + yTop.toFixed(1) + " " + (x + r).toFixed(1) + "," + yTop.toFixed(1) +
    " L" + (x + w - r).toFixed(1) + "," + yTop.toFixed(1) +
    " Q" + (x + w).toFixed(1) + "," + yTop.toFixed(1) + " " + (x + w).toFixed(1) + "," + (yTop + r).toFixed(1) +
    " L" + (x + w).toFixed(1) + "," + yBase.toFixed(1) + " Z";
}

const UZ_MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun",
                   "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const UZ_WDAYS = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];
function fmtDayLabel(dt) { return dt.getDate() + "-" + UZ_MONTHS[dt.getMonth()]; }

export class Charts {
  constructor() {
    this.chResizeTimer = null;

    document.addEventListener("period:changed", () => this.loadTimeline());

    /* Oyna o'lchami o'zgarsa grafiklar yangi kenglikka qayta chiziladi. */
    window.addEventListener("resize", () => {
      if (state.tab !== "dash") return;
      clearTimeout(this.chResizeTimer);
      this.chResizeTimer = setTimeout(() => {
        this.renderTimeline(); this.renderDailyCharts(); this.renderHourly();
      }, 200);
    });
  }

  /* Sahifa davri (Bugun / 7 / 30 kun): bugun — 5 daqiqalik suratlar, uzun
     davr — soatlik o'rtacha (/stats/timeline). */
  async loadTimeline() {
    if (state.period > 1) {
      try {
        state.longTimeline = await (await fetch("/api/stats/timeline?days=" + state.period,
                                                { credentials: "same-origin" })).json();
      } catch (e) { state.longTimeline = null; }
    }
    this.renderTimeline();
  }

  /* Tanlangan davrdagi onlayn darajasi — maydonli chiziq, kursorda qiymat. */
  renderTimeline() {
    const svg = $("ch-timeline"), empty = $("ch-timeline-empty");
    // Tanlangan davr: so'nggi N soatlik o'lchovlar.
    const long = state.period > 1;
    const src = long ? ((state.longTimeline && state.longTimeline.points) || [])
                     : ((state.stats && state.stats.timeline) || []);
    const cutoff = Date.now() - (long ? state.period * 24 : state.tlHours) * 3600e3;
    const data = src
      .filter((p) => p.total > 0 && Date.parse(p.ts) >= cutoff)
      .map((p) => ({ t: Date.parse(p.ts), online: p.online, total: p.total }));
    $("tl-sub").textContent = long
      ? "So'nggi " + state.period + " kun · soatlik o'rtacha · shtrix — kuzatuv yo'q"
      : "So'nggi 24 soat · 5 daqiqalik o'lchovlar";
    // Grafik ustidagi yig'ma ko'rsatkichlar: hozir / o'rtacha / eng past / o'lchov soni.
    const pcts = data.map((p) => (p.online / p.total) * 100);
    const fmtPct = (v) => Math.round(v) + "%";
    const setStat = (id, v, cls) => {
      const el = $(id); el.textContent = v; el.className = "v" + (cls ? " " + cls : "");
    };
    if (pcts.length) {
      const cur = pcts[pcts.length - 1], avg = pcts.reduce((a, b) => a + b, 0) / pcts.length,
            min = Math.min(...pcts);
      setStat("tl-now", fmtPct(cur), cur >= 90 ? "ok" : cur < 60 ? "bad" : "");
      setStat("tl-avg", fmtPct(avg), avg >= 90 ? "ok" : avg < 60 ? "bad" : "");
      setStat("tl-min", fmtPct(min), min < 60 ? "bad" : "");
      setStat("tl-n", String(pcts.length));
      // 7 kunlik o'rtacha — kunlik tarixdan (o'lchovsiz kunlar hisobga olinmaydi).
      const days = ((state.stats && state.stats.daily) || []).filter((d) => d.uptime != null);
      const wk = days.length ? days.reduce((s, d) => s + d.uptime, 0) / days.length : null;
      setStat("tl-week", wk == null ? "—" : fmtPct(wk),
              wk == null ? "" : wk >= 90 ? "ok" : wk < 60 ? "bad" : "");
    } else {
      ["tl-now", "tl-avg", "tl-min", "tl-week", "tl-n"].forEach((id) => setStat(id, "—"));
    }
    if (data.length < 2) {
      svg.innerHTML = "";
      empty.textContent = "Tarix yig'ilmoqda — grafik dastlabki o'lchovlar to'plangach (~10 daqiqa) chiziladi.";
      empty.style.display = "flex";
      return;
    }
    empty.style.display = "none";
    const W = Math.max(320, Math.round(svg.clientWidth) || 640), H = 210;
    const L = 40, R = 18, T = 14, B = 26;
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    const t0 = data[0].t, t1 = data[data.length - 1].t;
    const x = (t) => L + (W - L - R) * (t - t0) / Math.max(1, t1 - t0);
    const pctOf = (p) => (p.online / p.total) * 100;
    const y = (v) => T + (H - T - B) * (1 - v / 100);
    let out = "";
    [0, 25, 50, 75, 100].forEach((v) => {
      out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) +
             '" y2="' + y(v).toFixed(1) + '" stroke="var(--line-2)"/>';
      if (v % 50 === 0) out += '<text class="ch-tick" x="' + (L - 8) + '" y="' +
        (y(v) + 3.5).toFixed(1) + '" text-anchor="end">' + v + "%</text>";
    });
    // Vaqt belgilari qadami oraliqqa moslashadi: tarix hali qisqa bo'lsa
    // (server yangi ishga tushgan) 5-15 daqiqalik, to'liq sutkada 4 soatlik.
    const MIN = 60000, DAY = 1440 * MIN;
    const step = [5 * MIN, 15 * MIN, 30 * MIN, 60 * MIN, 2 * 60 * MIN,
                  4 * 60 * MIN, 6 * 60 * MIN, DAY, 2 * DAY, 5 * DAY]
      .find((s) => (t1 - t0) / s <= 7) || 5 * DAY;
    const pd2 = (n) => String(n).padStart(2, "0");
    const tz = new Date().getTimezoneOffset() * MIN;
    for (let t = Math.ceil((t0 - tz) / step) * step + tz; t <= t1; t += step) {
      const d = new Date(t);
      out += '<text class="ch-tick" x="' + x(t).toFixed(1) + '" y="' + (H - 8) +
        '" text-anchor="middle">' + (step >= DAY ? pd2(d.getDate()) + "." + pd2(d.getMonth() + 1)
                                               : pd2(d.getHours()) + ":" + pd2(d.getMinutes())) +
        "</text>";
    }
    // Kuzatuv bo'shliqlari: o'lchovlar orasi odatdagidan 3 barobar uzun bo'lsa —
    // chiziq uziladi va o'sha joy shtrixlanadi (bo'shliq "silliq" tutashtirilmaydi).
    const gaps = [];
    const dts = data.slice(1).map((p, i) => p.t - data[i].t).sort((a, b) => a - b);
    const typical = dts[Math.floor(dts.length / 2)] || 5 * MIN;
    for (let i = 1; i < data.length; i++)
      if (data[i].t - data[i - 1].t > typical * 3) gaps.push([data[i - 1].t, data[i].t, i]);
    out = out.replace("</defs>", hatchDef("tl-hatch") + "</defs>");
    gaps.forEach(([a, b]) => {
      out += '<rect x="' + x(a).toFixed(1) + '" y="' + T + '" width="' + (x(b) - x(a)).toFixed(1) +
        '" height="' + (H - T - B) + '" style="fill:url(#tl-hatch);opacity:.55"/>';
    });
    // Chiziq bo'shliqlarda uziladi: har uzluksiz bo'lak alohida.
    const cuts = [0, ...gaps.map((g) => g[2]), data.length];
    const runs = cuts.slice(1).map((end, k) => data.slice(cuts[k], end)).filter((r) => r.length);
    const ptsOf = (run) => run.map((p) => x(p.t).toFixed(1) + "," + y(pctOf(p)).toFixed(1)).join(" ");
    const pts = ptsOf(data);
    // Maydon: tepada to'yinganroq, pastga qarab yo'qoladi — chiziq "suzib" turadi.
    out = '<defs><linearGradient id="tl-grad" x1="0" x2="0" y1="0" y2="1">' +
      '<stop offset="0" style="stop-color:var(--accent);stop-opacity:.32"/>' +
      '<stop offset="1" style="stop-color:var(--accent);stop-opacity:0"/></linearGradient></defs>' + out;
    // Maqsad: 95% onlayn. Undan pastdagi joylar darhol ko'zga tashlanadi.
    const goal = 95;
    out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(goal).toFixed(1) + '" y2="' +
      y(goal).toFixed(1) + '" class="ch-goal"/>' +
      '<text class="ch-goal-l" x="' + (W - R) + '" y="' + (y(goal) - 5).toFixed(1) +
      '" text-anchor="end">maqsad ' + goal + "%</text>";
    const drawCls = firstDraw("timeline") ? "ch-draw" : "";
    runs.forEach((run) => {
      const rp = ptsOf(run), a = run[0].t, b = run[run.length - 1].t;
      if (run.length > 1)
        out += '<polygon points="' + x(a).toFixed(1) + "," + y(0).toFixed(1) + " " + rp +
          " " + x(b).toFixed(1) + "," + y(0).toFixed(1) + '" fill="url(#tl-grad)"/>';
      out += '<polyline class="' + drawCls + '" pathLength="1" points="' + rp +
        '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    });
    const last = data[data.length - 1];
    out += '<circle cx="' + x(last.t).toFixed(1) + '" cy="' + y(pctOf(last)).toFixed(1) +
      '" r="4" fill="var(--accent)" stroke="var(--surface-2)" stroke-width="2"/>';
    // Eng past nuqta alohida belgilanadi — muammo qachon bo'lganini ko'rsatadi.
    let lowI = 0;
    for (let i = 1; i < data.length; i++) if (pctOf(data[i]) < pctOf(data[lowI])) lowI = i;
    const lowP = data[lowI];
    if (data.length > 3 && pctOf(lowP) < pctOf(last) - 0.5) {
      const lx2 = x(lowP.t), ly2 = y(pctOf(lowP));
      const side = lx2 > W * 0.7 ? -1 : 1;
      out += '<circle cx="' + lx2.toFixed(1) + '" cy="' + ly2.toFixed(1) +
        '" r="4" fill="var(--danger)" stroke="var(--surface-2)" stroke-width="2"/>';
      out += '<text class="ch-cap" x="' + (lx2 + side * 9).toFixed(1) + '" y="' +
        (ly2 + 4).toFixed(1) + '" text-anchor="' + (side > 0 ? "start" : "end") +
        '" fill="var(--danger)">eng past ' + Math.round(pctOf(lowP)) + "%</text>";
    }
    out += '<line class="ch-cx" y1="' + T + '" y2="' + y(0).toFixed(1) +
      '" stroke="var(--faint)" style="display:none"/>';
    out += '<circle class="ch-dot" r="4" fill="var(--accent)" stroke="var(--surface-2)" ' +
      'stroke-width="2" style="display:none"/>';
    out += '<rect class="ch-hit" x="' + L + '" y="' + T + '" width="' + (W - L - R) +
      '" height="' + (H - T - B) + '" fill="transparent"/>';
    svg.innerHTML = out;

    // Kursor eng yaqin o'lchovga "yopishadi" — 2px chiziqni mo'ljallash shart emas.
    const cx = svg.querySelector(".ch-cx"), dot = svg.querySelector(".ch-dot"),
          hit = svg.querySelector(".ch-hit");
    hit.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      const t = t0 + ((e.clientX - r.left) * (W / r.width) - L) / (W - L - R) * (t1 - t0);
      let best = 0;
      for (let i = 1; i < data.length; i++)
        if (Math.abs(data[i].t - t) < Math.abs(data[best].t - t)) best = i;
      const p = data[best], bx = x(p.t).toFixed(1);
      cx.setAttribute("x1", bx); cx.setAttribute("x2", bx); cx.style.display = "";
      dot.setAttribute("cx", bx); dot.setAttribute("cy", y(pctOf(p)).toFixed(1));
      dot.style.display = "";
      const d = new Date(p.t), pd = (n) => String(n).padStart(2, "0");
      chTipShow(Math.round(p.online) + "/" + Math.round(p.total) + " onlayn · " + Math.round(pctOf(p)) + "%",
                (long ? pd(d.getDate()) + "." + pd(d.getMonth() + 1) + " " : "") +
                pd(d.getHours()) + ":" + pd(d.getMinutes()), e.clientX, e.clientY);
    });
    hit.addEventListener("pointerleave", () => {
      cx.style.display = "none"; dot.style.display = "none"; chTipHide();
    });
  }

  /* Umumiy ustunli grafik: items — {label, value, cap, tipValue, tipLabel}. */
  renderColumns(svgId, emptyId, items, opts) {
    const svg = $(svgId), empty = $(emptyId);
    if (!items.some((it) => it.value != null)) {
      svg.innerHTML = "";
      empty.textContent = opts.emptyText;
      empty.style.display = "flex";
      return;
    }
    empty.style.display = "none";
    const W = Math.max(220, Math.round(svg.clientWidth) || 300);
    // Balandlik — konteynerdan (qator balandligiga moslashadigan kartalarda), kamida 170.
    const H = Math.max(150, Math.round(svg.clientHeight) || 170);
    const L = 30, R = 8, T = 18, B = 24;
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    const max = opts.max || niceMax(Math.max(1, ...items.map((it) => it.value || 0)));
    const y = (v) => T + (H - T - B) * (1 - v / max);
    let out = "";
    (opts.max === 100 ? [0, 50, 100] : [0, max / 2, max]).forEach((v) => {
      out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) +
        '" y2="' + y(v).toFixed(1) + '" stroke="var(--line-2)"/>' +
        '<text class="ch-tick" x="' + (L - 7) + '" y="' + (y(v) + 3.5).toFixed(1) +
        '" text-anchor="end">' + Math.round(v) + (opts.unit || "") + "</text>";
    });
    const slot = (W - L - R) / items.length;
    const barW = Math.min(24, slot * 0.62);
    const grow = firstDraw(svgId);
    const gid = svgId + "-g", hid = svgId + "-h";
    out = '<defs><linearGradient id="' + gid + '" x1="0" x2="0" y1="0" y2="1">' +
      '<stop offset="0" style="stop-color:var(--' + (opts.hiColor || "accent") + ')"/>' +
      '<stop offset="1" style="stop-color:var(--' + (opts.hiColor || "accent") + ');stop-opacity:.55"/>' +
      "</linearGradient>" + hatchDef(hid) + "</defs>" + out;
    items.forEach((it, i) => {
      const cxm = L + slot * i + slot / 2;
      // Urg'u — bitta ustun (bugun / cho'qqi) to'liq rangda, qolganlari xira:
      // ko'z birinchi bo'lib aynan o'sha ustunga tushadi.
      const hi = opts.highlight == null || opts.highlight === i;
      if (it.value != null && it.value > 0)
        out += '<path class="ch-col' + (grow ? " ch-grow" : "") + '" data-i="' + i + '" d="' +
          colPath(cxm - barW / 2, barW, y(it.value), y(0)) + '" style="fill:' +
          (hi ? "url(#" + gid + ")" : "var(--col-dim)") +
          (grow ? ";animation-delay:" + (i * 40) + "ms" : "") + '"/>';
      else if (it.value == null && opts.ghost)
        // Kuzatuv bo'lmagan kun — balandligi to'liq, shtrixli: "0" emas, "ma'lumot yo'q".
        out += '<rect x="' + (cxm - barW / 2).toFixed(1) + '" y="' + T + '" width="' + barW.toFixed(1) +
          '" height="' + (H - T - B) + '" rx="4" style="fill:url(#' + hid + ');opacity:.6"/>';
      if (opts.capLabels && it.value != null && it.cap)
        out += '<text class="ch-cap' + (hi ? " hi" : "") + '" x="' + cxm.toFixed(1) + '" y="' +
          (y(it.value) - 5).toFixed(1) + '" text-anchor="middle">' + esc(it.cap) + "</text>";
      if (it.label)
        out += '<text class="ch-tick" x="' + cxm.toFixed(1) + '" y="' + (H - 8) +
          '" text-anchor="middle">' + esc(it.label) + "</text>";
      out += '<rect class="ch-slot" data-i="' + i + '" x="' + (L + slot * i).toFixed(1) +
        '" y="' + T + '" width="' + slot.toFixed(1) + '" height="' + (H - T - B) +
        '" fill="transparent"/>';
    });
    svg.innerHTML = out;
    svg.querySelectorAll(".ch-slot").forEach((rect) => {
      const i = Number(rect.dataset.i);
      const bar = svg.querySelector('.ch-col[data-i="' + i + '"]');
      rect.addEventListener("pointermove", (e) => {
        if (bar) bar.classList.add("hov");
        chTipShow(items[i].tipValue, items[i].tipLabel, e.clientX, e.clientY);
      });
      rect.addEventListener("pointerleave", () => {
        if (bar) bar.classList.remove("hov");
        chTipHide();
      });
    });
  }

  /* 7 kunlik kesim: o'rtacha onlayn % va uzilishlar soni — ikkita alohida panel. */
  renderDailyCharts() {
    const daily = (state.stats && state.stats.daily) || [];
    const items = daily.map((d, i) => ({
      d,
      dt: new Date(d.date + "T00:00:00"),
      last: i === daily.length - 1,
    }));
    this.renderColumns("ch-daily-up", "ch-daily-up-empty", items.map((it) => ({
      label: it.last ? "Bugun" : UZ_WDAYS[it.dt.getDay()] + " " + it.dt.getDate(),
      value: it.d.uptime,
      cap: it.d.uptime == null ? "" : Math.round(it.d.uptime) + "%",
      tipValue: it.d.uptime == null ? "kuzatuv yo'q"
        : it.d.uptime.toFixed(1).replace(".", ",") + "% onlayn",
      tipLabel: fmtDayLabel(it.dt),
    })), { max: 100, unit: "%", capLabels: true, ghost: true, highlight: items.length - 1,
           emptyText: "Kunlik tarix hali yig'ilmagan — server ishlagan sari to'lib boradi." });
    this.renderColumns("ch-daily-ev", "ch-daily-ev-empty", items.map((it) => ({
      label: it.last ? "Bugun" : UZ_WDAYS[it.dt.getDay()] + " " + it.dt.getDate(),
      // O'sha kunga surat ham, hodisa ham yo'q — "0" emas, "ma'lumot yo'q".
      value: it.d.uptime == null && !it.d.events ? null : it.d.events,
      cap: String(it.d.events),
      tipValue: it.d.uptime == null && !it.d.events ? "kuzatuv yo'q" : it.d.events + " ta uzilish",
      tipLabel: fmtDayLabel(it.dt),
    })), { capLabels: true, ghost: true, highlight: items.length - 1, hiColor: "danger",
           emptyText: "Kunlik tarix hali yig'ilmagan." });
  }

  /* Bugungi uzilishlar soat kesimida — muammo qaysi payt bo'lganini ko'rsatadi. */
  renderHourly() {
    const svg = $("ch-hourly"), empty = $("ch-hourly-empty");
    const hours = (state.stats && state.stats.hourly_today) || [];
    if (!hours.some((v) => v > 0)) {
      svg.innerHTML = "";
      empty.textContent = state.stats
        ? "Bugun uzilish qayd etilmadi." : "Tarix yig'ilmoqda…";
      empty.style.display = "flex";
      return;
    }
    const pd = (n) => String(n).padStart(2, "0");
    const peak = hours.indexOf(Math.max(...hours));
    this.renderColumns("ch-hourly", "ch-hourly-empty", hours.map((n, h) => ({
      label: h % 6 === 0 ? pd(h) : "",
      value: n,
      cap: h === peak ? pd(h) + ":00 · " + n : "",
      tipValue: n + " ta uzilish",
      tipLabel: pd(h) + ":00 – " + pd(h) + ":59",
    })), { emptyText: "", capLabels: true, highlight: peak, hiColor: "danger" });
  }
}

export const charts = new Charts();

export function loadTimeline() { return charts.loadTimeline(); }
export function renderTimeline() { charts.renderTimeline(); }
export function renderDailyCharts() { charts.renderDailyCharts(); }
export function renderHourly() { charts.renderHourly(); }
