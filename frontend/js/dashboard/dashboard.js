/* ==========================================================================
   dashboard/dashboard.js — dashboard sahifasi (boshqaruvchi klass)
   --------------------------------------------------------------------------
   Vazifasi:
     Dashboard bo'limini yig'adi va yangilab turadi: KPI kartalar va ularning
     mini-grafiklari, holat donuti, hududlar jadvali (hozir / davr), texnik
     kesim, bugungi tahlil, diqqat talab qiladigan kameralar, sekin ochilgan
     oqimlar, "Tizim holati" bloki, tezkor amallar, CSV eksport va
     "JONLI" tugmasi. Grafiklar — charts.js, hisobot — overview.js,
     hodisalar lentasi — layout/notifications.js.

   Eksport:
     Dashboard            — klass: render, renderMetrics, renderUptimeKpi, loadStats,
                            renderRegions, renderSystem, ... ; konstruktor tugmalar,
                            15 s avto-yangilash va "overview:loaded" hodisasini ulaydi
     dashboard            — yagona nusxa
     renderDash()         — butun dashboardni chizish + statistika/hisobotni so'rash
     renderDashMetrics()  — faqat KPI qatori (pleyer har ochilishda chaqiradi)
     renderUptimeKpi()    — uptime KPI (hisobotdan)
     loadStats()          — /api/stats/dashboard va /api/metrics/open ni olish, bog'liq bloklarni chizish
     renderRegions()      — hududlar jadvali
     renderSystem()       — "Tizim holati" (faqat haqiqiy signallardan)

   Bog'liqliklar:
     import: ../core/state.js, ../core/api.js, ../core/icons.js (ICO), ../core/data.js (refreshStatus),
             ../map/map.js (hasGeo, map), ../map/camera-list.js (setQuery),
             ../map/selection.js (selectCamera),
             ./charts.js (renderDailyCharts, renderHourly, renderTimeline),
             ../layout/notifications.js (renderEvents), ../layout/tabs.js (showTab),
             ./overview.js (loadOverview, renderLine, renderOverview),
             ../admin/camera-form.js (openCameraForm — tezkor amal)
     global: L (L.latLngBounds — hudud qatori bosilganda)

   DOM: #m-total, #m-total-note, #m-total-spark, #m-online(-n,-note,-bar,-d,-spark),
        #m-down(-pct,-bar,-note,-spark), #m-ev(-d,-note,-spark), #m-up(-note,-d,-spark),
        #m-open-note, #dash-upd, #dash-refresh, #donut, #donut-legend, #donut-wrap,
        #region-rows, #reg-sub, #reg-mode, #reg-csv, #tech-rows, #today-facts,
        #att-rows, #att-count, #slow-rows, #sys-list, #qa-add, #qa-mtx, #sync-btn
   Backend: GET /api/stats/dashboard, GET /api/metrics/open (loadStats); boshqalari overview.js/charts.js orqali

   Qoidalar / tuzoqlar:
     - Dashboard faqat ochiq bo'lsa (state.tab === "dash") chiziladi va har
       15 s da o'zi yangilanadi (yashirin oynada emas).
     - loadStats bir vaqtda bitta (statsLoading). Endpoint bo'lmasa — jonli
       qism (kameralar ro'yxatidan hisoblanadigan bloklar) ishlayveradi.
     - Taqqoslash (▲/▼) faqat haqiqiy tarixdan; ma'lumot yo'q bo'lsa bo'sh.
     - Hisobot (overview.js) davr tugmalarini o'zi ulaydi: initOverview()
       main.js dan chaqiriladi (aylanma import tufayli import paytida emas).
   ========================================================================== */
import { $, esc, state, toast } from "../core/state.js";
import { api } from "../core/api.js";
import { hasGeo, map } from "../map/map.js";
import { setQuery } from "../map/camera-list.js";
import { selectCamera } from "../map/selection.js";
import { renderDailyCharts, renderHourly, renderTimeline } from "./charts.js";
import { renderEvents } from "../layout/notifications.js";
import { showTab } from "../layout/tabs.js";
import { loadOverview, renderLine, renderOverview } from "./overview.js";
import { refreshStatus } from "../core/data.js";
import { ICO } from "../core/icons.js";
import { openCameraForm } from "../admin/camera-form.js";

/* KPI qiymati: ma'lumot bo'lmasa "—" yoziladi va yonidagi birlik
   ("s", "ta") yashiriladi — "— s" degan g'alati yozuv chiqmasin. */
function setKpi(id, value) {
  const el = $(id);
  el.textContent = value == null ? "—" : value;
  const unit = el.nextElementSibling;
  if (unit && unit.classList.contains("u")) unit.hidden = value == null;
}

/* O'zgarish belgisi: musbat/manfiy va yaxshi/yomon tomon. `higherIsBetter`
   onlaynlik uchun true, uzilishlar uchun false. Ma'lumot yo'q bo'lsa bo'sh. */
function setDelta(id, diff, unit, higherIsBetter) {
  const el = $(id);
  if (diff == null || !isFinite(diff)) { el.textContent = ""; el.className = "kp-d"; return; }
  const rounded = Math.round(diff);
  if (rounded === 0) {
    el.textContent = "o'zgarishsiz";
    el.className = "kp-d flat";
    return;
  }
  const good = higherIsBetter ? rounded > 0 : rounded < 0;
  el.textContent = (rounded > 0 ? "▲ +" : "▼ ") + rounded + unit;
  el.className = "kp-d " + (good ? "up" : "down");
}

/* Holat taqsimoti — donut + batafsil legenda.

   Holatlar server qoidasidan (camera/state.py): "tasvirsiz" — port ochiq,
   lekin tasvir olinmayapti (parol/oqim xatosi, ~30 daqiqa kadr yo'q yoki
   ochiq oqim muzlagan); "tekshirilmagan" — server hali tekshirmagan yoki IP
   yo'q; "o'chirilgan" — admin o'chirgan, foizga kirmaydi va faqat bor
   bo'lsa ko'rinadi. Segmentlar yumaloq uchli, orasida havo; markazda
   onlayn ulushi (o'chirilganlarsiz). */
const DONUT_STATES = [
  { key: "online", label: "Onlayn", color: "var(--ok)", hint: "Tarmoq va tasvir bor" },
  { key: "stalled", label: "Tasvirsiz", color: "var(--warn)", hint: "Tarmoqda, lekin tasvir olinmayapti" },
  { key: "offline", label: "Uzilgan", color: "var(--danger)", hint: "Tarmoqdan javob yo'q" },
  { key: "unknown", label: "Tekshirilmagan", color: "var(--faint)", hint: "Server hali tekshirmagan yoki IP yo'q" },
  { key: "disabled", label: "O'chirilgan", color: "var(--surface-3)", hint: "Administrator o'chirgan", optional: true },
];

function camStateOf(c) {
  if (c.state) return c.state;
  return c.online === true ? "online" : c.online === false ? "offline" : "unknown";
}

/* Hududlar jadvali. "Hozir" — joriy onlaynlik, "Davr" — tanlangan davrdagi
   uptime (hisobotdan). Rang chegara bo'yicha: >=99 yashil, >=95 sariq,
   undan pasti qizil — bir qarashda qaysi hudud yomonligi ko'rinadi. */
const pctColor = (v) => v == null ? "var(--faint)" : v >= 99 ? "var(--ok)" : v >= 95 ? "var(--warn)" : "var(--danger)";

/* Necha vaqtdan beri uzilgan: "7 soat", "2 kun". */
function fmtDuration(iso) {
  const t = Date.parse(iso);
  // last_seen bo'sh — kuzatuv boshlanganidan beri bir marta ham onlayn bo'lmagan.
  if (!t) return "ko'rilmagan";
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 60) return min + " daqiqa";
  if (min < 1440) return Math.round(min / 60) + " soat";
  return Math.round(min / 1440) + " kun";
}

/* KPI mini-grafigi: maydonli chiziq, oxirgi nuqta ajratilgan (dataviz: trend). */
function spark(id, values, color) {
  const el = $(id);
  if (!el) return;
  const data = values.filter((v) => v != null && isFinite(v));
  if (data.length < 2) { el.innerHTML = ""; return; }
  // Haqiqiy pikselda: cho'zilganda oxirgi nuqta ellips bo'lib qolmasin.
  const W = Math.max(60, Math.round(el.clientWidth) || 120), H = Math.max(24, Math.round(el.clientHeight) || 34), P = 4;
  const max = Math.max(...data), min = Math.min(...data);
  const x = (i) => P + (W - 2 * P) * i / (data.length - 1);
  const y = (v) => max === min ? H / 2 : H - P - (H - 2 * P) * (v - min) / (max - min);
  const pts = data.map((v, i) => x(i).toFixed(1) + "," + y(v).toFixed(1)).join(" ");
  const gid = id + "-g";
  el.setAttribute("viewBox", "0 0 " + W + " " + H);
  el.innerHTML = '<defs><linearGradient id="' + gid + '" x1="0" x2="0" y1="0" y2="1">' +
    '<stop offset="0" style="stop-color:' + color + ';stop-opacity:.35"/>' +
    '<stop offset="1" style="stop-color:' + color + ';stop-opacity:0"/></linearGradient></defs>' +
    '<polygon points="' + P + "," + H + " " + pts + " " + x(data.length - 1).toFixed(1) + "," + H +
      '" style="fill:url(#' + gid + ')"/>' +
    '<polyline points="' + pts + '" vector-effect="non-scaling-stroke" style="fill:none;stroke:' + color +
      ';stroke-width:2;stroke-linejoin:round;stroke-linecap:round"/>' +
    '<circle cx="' + x(data.length - 1).toFixed(1) + '" cy="' + y(data[data.length - 1]).toFixed(1) +
      '" r="3" style="fill:' + color + '"/>';
}

/* ---------- Dashboard ---------- */
export class Dashboard {
  constructor() {
    this.donutAnimated = false;
    this.statsLoading = false;
    this.regMode = "now";

    document.querySelectorAll("#reg-mode button").forEach((b) =>
      b.addEventListener("click", () => {
        this.regMode = b.dataset.m;
        document.querySelectorAll("#reg-mode button").forEach((x) => x.classList.toggle("on", x === b));
        this.renderRegions();
      }));

    /* Hisobot yuklanganda unga bog'liq bloklar yangilanadi. */
    document.addEventListener("overview:loaded", () => {
      if (state.tab !== "dash") return;
      this.renderUptimeKpi();
      this.renderRegions();
    });

    /* Jonli belgi bosilsa — darhol yangilash. */
    $("dash-refresh").addEventListener("click", async () => {
      const b = $("dash-refresh");
      b.disabled = true;
      await refreshStatus();
      await this.loadStats();
      this.render();
      b.disabled = false;
    });

    /* Hududlar jadvalini CSV faylga chiqarish. */
    $("reg-csv").addEventListener("click", () => this.exportRegionsCsv());

    /* Tezkor amallar: kamera qo'shish va MediaMTX konfiguratsiyasi
       (kirilmagan bo'lsa boshqaruv bo'limi kirish oynasini ochadi). */
    $("qa-add").addEventListener("click", () => {
      if (!state.admin) { showTab("admin"); return; }
      openCameraForm(null);
    });
    $("qa-mtx").addEventListener("click", () => {
      if (!state.admin) { showTab("admin"); return; }
      $("sync-btn").click();
    });

    /* Dashboard ochiq turganda har 15 soniyada o'zi yangilanadi. */
    setInterval(() => {
      if (state.tab === "dash" && !document.hidden) this.render();
    }, 15000);
  }

  renderMetrics() {
    const total = state.cameras.length;
    // Donut bilan bir qoida (camera/state.py): onlayn — tasvir ham bor;
    // foiz o'chirilganlarsiz.
    const by = (k) => state.cameras.filter((c) => camStateOf(c) === k).length;
    const on = by("online"), noImage = by("stalled");
    const off = state.cameras.filter((c) => c.online === false).length;
    const active = total - by("disabled");
    $("m-total").textContent = total;
    $("m-total-note").textContent = new Set(state.cameras.map((c) => c.region)).size + " hududda";
    const pctOn = active ? Math.round((on / active) * 100) : 0;
    $("m-online").textContent = total ? pctOn + "%" : "—";
    $("m-online-n").textContent = on;
    $("m-online-note").textContent = noImage ? noImage + " ta tarmoqda, lekin tasvirsiz" : "Tarmoq va tasvir bor";
    $("m-online-bar").style.width = pctOn + "%";
    const pctOff = total ? Math.round((off / total) * 100) : 0;
    $("m-down-pct").textContent = total ? pctOff + "%" : "—";
    $("m-down-bar").style.width = pctOff + "%";
    setKpi("m-ev", state.stats ? state.stats.events_today : null);

    // Taqqoslashlar faqat haqiqiy tarixdan: onlaynlik 24 soat oldingi
    // o'lchov bilan, bugungi uzilishlar kechagi kun bilan solishtiriladi.
    const tlAll = (state.stats && state.stats.timeline) || [];
    const first = tlAll.find((p) => p.total > 0);
    setDelta("m-online-d", first
      ? pctOn - Math.round((first.online / first.total) * 100) : null, "%", true);
    const d = (state.stats && state.stats.daily) || [];
    const yest = d.length > 1 ? d[d.length - 2].events : null;
    setDelta("m-ev-d", yest == null || !state.stats
      ? null : state.stats.events_today - yest, "", false);
    $("m-ev-note").textContent = state.stats
      ? (state.stats.events_today ? "bugun qayd etilgan" : "bugun uzilish yo'q")
      : "tarix yuklanmoqda…";
    const now = new Date(), pd = (n) => String(n).padStart(2, "0");
    $("dash-upd").textContent = pd(now.getHours()) + ":" + pd(now.getMinutes()) + ":" + pd(now.getSeconds());
    this.renderUptimeKpi();
    $("m-down").textContent = off;
    $("m-down-note").textContent = off ? "Tekshirish talab qiladi"
      : state.stats ? "bugun " + state.stats.events_today + " ta uzilish"
      : "hammasi joyida";
    this.renderDonut();
    this.renderKpiSparks();
    renderLine();
  }

  /* Uptime KPI — tanlangan davr bo'yicha (hisobotdan), o'zgarish — 7 kunlik
     kunlik grafikdagi kechagi kun bilan. */
  renderUptimeKpi() {
    const o = state.overview;
    const v = o ? o.fleet.uptime_pct : null;
    $("m-up").textContent = v == null ? "—" : v.toFixed(1).replace(".", ",") + "%";
    $("m-up-note").textContent = o
      ? (o.days === 1 ? "Bugun" : "So'nggi " + o.days + " kun") + " · kuzatuv qamrovi " +
        Math.round(o.coverage.pct || 0) + "%"
      : "Hisobot yuklanmoqda…";
    const d = ((state.stats && state.stats.daily) || []).filter((x) => x.uptime != null);
    setDelta("m-up-d", d.length > 1 ? d[d.length - 1].uptime - d[d.length - 2].uptime : null, "%", true);
  }

  /* "Jami kameralar": tekis chiziq hech narsa aytmasdi — holatlar ulushi
     bo'lingan chiziq bo'lib ko'rsatiladi (segmentlar orasida 2px havo). */
  renderStateBar() {
    const el = $("m-total-spark");
    const total = state.cameras.length;
    if (!total) { el.innerHTML = ""; return; }
    const counts = {};
    state.cameras.forEach((c) => { const k = camStateOf(c); counts[k] = (counts[k] || 0) + 1; });
    const W = Math.max(60, Math.round(el.clientWidth) || 200), H = Math.max(24, Math.round(el.clientHeight) || 34);
    const barH = 10, y = H - barH - 12, gap = 2;
    const parts = DONUT_STATES.map((st) => ({ ...st, n: counts[st.key] || 0 })).filter((p) => p.n);
    const free = W - gap * (parts.length - 1);
    let x = 0, html = "", lx = 0;
    parts.forEach((p) => {
      const w = Math.max(3, (p.n / total) * free);
      html += '<rect x="' + x.toFixed(1) + '" y="' + y + '" width="' + w.toFixed(1) + '" height="' + barH +
        '" rx="3" style="fill:' + p.color + '"><title>' + p.label + ": " + p.n + "</title></rect>";
      x += w + gap;
    });
    // Ostida qisqa izoh: har holat soni (matn — matn rangida, belgi — holat rangida).
    parts.forEach((p) => {
      html += '<circle cx="' + (lx + 4) + '" cy="' + (H - 4) + '" r="3" style="fill:' + p.color + '"/>' +
        '<text x="' + (lx + 11) + '" y="' + (H - 1) + '" class="kp-bar-l">' + p.n + " " + p.label.toLowerCase() + "</text>";
      lx += 18 + (String(p.n).length + p.label.length) * 5.6;
    });
    el.setAttribute("viewBox", "0 0 " + W + " " + H);
    el.innerHTML = html;
  }

  renderKpiSparks() {
    const tl = ((state.stats && state.stats.timeline) || []).filter((p) => p.total > 0);
    // 24 soatlik suratlar juda zich — 48 nuqtagacha siyraklashtiriladi.
    const step = Math.max(1, Math.floor(tl.length / 48));
    const thin = tl.filter((_, i) => i % step === 0);
    this.renderStateBar();
    spark("m-online-spark", thin.map((p) => p.online), "var(--ok)");
    spark("m-down-spark", thin.map((p) => p.total - p.online), "var(--danger)");
    spark("m-up-spark", ((state.stats && state.stats.daily) || []).map((d) => d.uptime), "var(--accent)");
    // Bugungi uzilishlar — soatma-soat yig'ilib boradi.
    let acc = 0;
    const hrs = (state.stats && state.stats.hourly_today) || [];
    const nowH = new Date().getHours();
    spark("m-ev-spark", hrs.slice(0, nowH + 1).map((n) => (acc += n)), "var(--warn)");
  }

  renderDonut() {
    const total = state.cameras.length;
    const counts = Object.fromEntries(DONUT_STATES.map((st) => [st.key, 0]));
    state.cameras.forEach((c) => { counts[camStateOf(c)] = (counts[camStateOf(c)] || 0) + 1; });
    // "O'chirilgan" faqat bor bo'lsa — aks holda afsonada bo'sh qator turmasin.
    const parts = DONUT_STATES.map((st) => ({ ...st, n: counts[st.key] || 0 }))
      .filter((p) => !p.optional || p.n > 0);
    const shown = parts.filter((p) => p.n > 0);

    const R = 50, SW = 11, C = 2 * Math.PI * R;
    // Yumaloq uch (round cap) segmentni ikki tomonga SW/2 cho'zadi — havo
    // shunga qo'shib hisoblanadi, aks holda segmentlar bir-biriga tegadi.
    const gap = shown.length > 1 ? SW + 4 : 0;
    const anim = !this.donutAnimated && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.donutAnimated = true;
    let acc = 0;
    const segs = shown.map((p, i) => {
      const len = Math.max((C * p.n) / (total || 1) - gap, 0.01);
      const off = -(acc + gap / 2);
      acc += (C * p.n) / (total || 1);
      return '<circle class="dn-seg' + (anim ? " dn-anim" : "") + '" data-k="' + p.key + '" cx="70" cy="70" r="' + R +
        '" fill="none" stroke-linecap="round" pathLength="' + C.toFixed(2) + '" style="stroke:' + p.color +
        ";stroke-width:" + SW + ";--len:" + len.toFixed(2) + ";--c:" + C.toFixed(2) +
        (anim ? ";animation-delay:" + i * 120 + "ms" : "") + '" stroke-dasharray="' + len.toFixed(2) + " " +
        C.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '" transform="rotate(-90 70 70)"/>';
    }).join("");
    const on = counts.online || 0;
    const active = total - (counts.disabled || 0);          // o'chirilganlar foizga kirmaydi
    const pct = active ? Math.round((on / active) * 100) : 0;
    $("donut").setAttribute("viewBox", "0 0 140 140");
    $("donut").innerHTML =
      '<circle cx="70" cy="70" r="' + R + '" fill="none" style="stroke:var(--surface-3);stroke-width:' + SW + '"/>' +
      segs +
      '<text x="70" y="70" text-anchor="middle" class="dn-pct">' + pct + '<tspan class="dn-unit" dx="1" dy="-11">%</tspan></text>' +
      '<text x="70" y="88" text-anchor="middle" class="dn-sub">' + on + " / " + active + "</text>";

    // Muammoli holatlarda qaysi kameralar va nima uchun — sichqoncha bilan.
    const why = (key) => {
      if (!["stalled", "unknown", "offline", "disabled"].includes(key)) return "";
      const list = state.cameras.filter((c) => camStateOf(c) === key);
      return list.slice(0, 15).map((c) => c.name + (c.state_reason ? " — " + c.state_reason : "")).join("\n") +
        (list.length > 15 ? "\n… va yana " + (list.length - 15) + " ta" : "");
    };
    $("donut-legend").innerHTML = parts.map((p) => {
      const share = total ? (p.n / total) * 100 : 0;
      const tip = p.n ? why(p.key) : "";
      return '<div class="dl' + (p.n ? "" : " zero") + '" data-k="' + p.key + '"' +
        (tip ? ' title="' + esc(tip) + '"' : "") + ">" +
        '<i style="background:' + p.color + '"></i>' +
        '<span class="dl-t"><b>' + p.label + "</b><em>" + p.hint + "</em></span>" +
        '<span class="dl-v"><b>' + p.n + '</b><u>' + (share ? share.toFixed(share < 10 ? 1 : 0).replace(".", ",") : "0") +
          "%</u></span>" +
        '<span class="dl-bar"><span style="width:' + share.toFixed(1) + "%;background:" + p.color + '"></span></span></div>';
    }).join("");

    // Segment va legenda qatori bir-birini ajratib ko'rsatadi.
    const wrap = $("donut-wrap");
    const focus = (k) => {
      wrap.classList.toggle("dn-focus", !!k);
      wrap.querySelectorAll("[data-k]").forEach((el) => el.classList.toggle("on", el.dataset.k === k));
    };
    wrap.querySelectorAll("[data-k]").forEach((el) => {
      el.onpointerenter = () => focus(el.dataset.k);
      el.onpointerleave = () => focus(null);
    });
  }

  render() {
    this.renderMetrics();
    this.renderSystem();
    this.renderAttention();
    this.renderToday();
    renderOverview();
    this.renderRegions();
    this.renderTech();
    this.renderSlow();
    renderEvents();
    renderTimeline();
    renderDailyCharts();
    renderHourly();
    this.loadStats();
    loadOverview();
  }

  /* Tarixiy statistika serverdan olinadi — kelgach grafiklar qayta chiziladi. */
  async loadStats() {
    if (this.statsLoading) return;
    this.statsLoading = true;
    try {
      state.stats = await api("/api/stats/dashboard");
      // Ochilish vaqti — barcha foydalanuvchilar va devorlar bo'yicha (server xotirasi).
      try { state.openServer = await api("/api/metrics/open?limit=8"); } catch (e) { /* eski server */ }
      if (state.tab === "dash") {
        this.renderSlow();
        this.renderMetrics();
        this.renderRegions();
        this.renderToday();
        renderEvents();
        renderTimeline();
        renderDailyCharts();
        renderHourly();
      }
    } catch (e) { /* endpoint bo'lmasa — jonli qism ishlayveradi */ }
    this.statsLoading = false;
  }

  renderRegions() {
    const regMode = this.regMode;
    const head = '<div class="rrow head"><span class="nn">#</span><span class="rg">Hudud</span>' +
      '<span class="bar-h">' + (regMode === "now" ? "Hozir onlayn" : "Davr uptime'i · 90–100%") + "</span>" +
      '<span class="lb">' + (regMode === "now" ? "Onlayn" : "Uptime") + "</span>" +
      '<span class="lb2" title="' + (regMode === "now" ? "Bugungi uzilishlar" : "Haqiqiy uzilishlar") +
      '">Uzil.</span></div>';
    let rows;
    if (regMode === "period" && state.overview) {
      rows = state.overview.regions.map((g) => ({
        region: g.region, pct: g.uptime_pct,
        bar: g.uptime_pct == null ? 0 : Math.max(2, (g.uptime_pct - 90) * 10),
        label: g.uptime_pct == null ? "—" : g.uptime_pct.toFixed(1).replace(".", ",") + "%",
        ev: g.outages,
      })).sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0));
      $("reg-sub").textContent = "Tanlangan davr · eng pasti yuqorida";
    } else {
      const rstats = new Map(((state.stats && state.stats.regions) || []).map((r) => [r.region, r]));
      rows = [...new Set(state.cameras.map((c) => c.region))].map((region) => {
        const list = state.cameras.filter((c) => c.region === region);
        const up = list.filter((c) => c.online !== false).length;
        const pct = list.length ? (up / list.length) * 100 : 0;
        const st = rstats.get(region);
        return { region, pct, bar: pct, label: up + "/" + list.length + " · " + Math.round(pct) + "%",
                 ev: st ? st.events_today : null };
      }).sort((a, b) => a.pct - b.pct || a.region.localeCompare(b.region, "uz"));
      $("reg-sub").textContent = "Hozirgi onlaynlik · eng pasti yuqorida";
    }
    $("region-rows").innerHTML = head + rows.map((r, idx) =>
      '<div class="rrow click" data-region="' + esc(r.region) + '">' +
        '<span class="nn">' + (idx + 1) + "</span>" +
        '<span class="rg">' + esc(r.region) + "</span>" +
        '<div class="bar"><i style="width:' + Math.min(100, r.bar) + "%;background:" + pctColor(r.pct) + '"></i></div>' +
        '<span class="lb">' + r.label + "</span>" +
        '<span class="lb2' + (r.ev ? " bad" : "") + '">' + (r.ev == null ? "—" : r.ev) + "</span></div>").join("");
    // Hudud qatori bosilsa — xaritaga o'tib, o'sha hudud kameralari ko'rsatiladi.
    document.querySelectorAll("#region-rows .rrow.click").forEach((row) =>
      row.addEventListener("click", () => {
        const region = row.dataset.region;
        showTab("map");
        setQuery(region, true);
        const pts = state.cameras.filter((c) => c.region === region && hasGeo(c));
        if (pts.length) {
          const b = L.latLngBounds(pts.map((c) => [c.lat, c.lng]));
          map.fitBounds(b.pad(0.35));
        }
      }));
  }

  /* Texnik kesim: kodeklar, o'girish va rejimlar taqsimoti. */
  renderTech() {
    const total = state.cameras.length || 1;
    // Bitta o'lchov (ulush) — bitta rang: qatorlar yorliq bilan farqlanadi.
    const groups = [
      ["H.265 xom (o'girishsiz)", state.cameras.filter((c) => /h265|hevc/i.test(c.codec || "") && !c.transcode).length, "var(--accent)"],
      ["H.265 → H.264 o'girish", state.cameras.filter((c) => c.transcode).length, "var(--accent)"],
      ["H.264 to'g'ridan-to'g'ri", state.cameras.filter((c) => /h264|avc/i.test(c.codec || "") && !c.transcode).length, "var(--accent)"],
      ["Doim tayyor rejimda", state.cameras.filter((c) => c.always_on).length, "var(--accent)"],
    ];
    $("tech-rows").innerHTML = groups.map(([label, n, color]) => {
      const pct = Math.round((n / total) * 100);
      return '<div class="rrow"><span class="rg wide">' + label + "</span>" +
        '<div class="bar"><i style="width:' + pct + "%;background:" + color + '"></i></div>' +
        '<span class="lb">' + n + " ta · " + pct + "%</span></div>";
    }).join("");
  }

  /* Bugungi tahlil: KPI'larda yo'q, xulosa talab qiladigan faktlar. */
  renderToday() {
    const box = $("today-facts");
    const st = state.stats;
    if (!st) { box.innerHTML = '<div class="empty">Tarix yuklanmoqda…</div>'; return; }
    const p2 = (n) => String(n).padStart(2, "0");

    // Eng ko'p uzilish qayd etilgan soat.
    const hrs = st.hourly_today || [];
    let peakH = -1;
    hrs.forEach((v, i) => { if (v > 0 && (peakH < 0 || v > hrs[peakH])) peakH = i; });

    // Eng ko'p uzilish bo'lgan hudud.
    const worst = (st.regions || []).filter((x) => x.events_today)
      .sort((x, y) => y.events_today - x.events_today)[0];

    // Bugun qayta ulangan kameralar (hodisalar lentasidan).
    const today = new Date().toDateString();
    const back = (st.events || []).filter((e) =>
      e.kind !== "offline" && new Date(e.ts).toDateString() === today).length;

    // Sutkadagi eng past onlaynlik nuqtasi.
    const tl = (st.timeline || []).filter((x) => x.total > 0);
    let low = null;
    tl.forEach((x) => {
      const v = x.online / x.total;
      if (!low || v < low.v) low = { v: v, ts: x.ts };
    });
    const lowD = low ? new Date(low.ts) : null;

    const facts = [
      ["Eng ko'p uzilish soati",
       peakH < 0 ? "Uzilish yo'q" : p2(peakH) + ":00",
       peakH < 0 ? "ok" : "warn",
       peakH < 0 ? "" : hrs[peakH] + " ta uzilish"],
      ["Eng muammoli hudud", worst ? worst.region : "Yo'q", worst ? "bad" : "ok",
       worst ? worst.events_today + " ta uzilish" : ""],
      ["Bugun qayta ulandi", back + " ta", back ? "ok" : "", "hodisalar lentasidan"],
      ["Sutkadagi eng past nuqta", low ? Math.round(low.v * 100) + "%" : "—",
       low && low.v < 0.6 ? "bad" : "",
       lowD ? p2(lowD.getHours()) + ":" + p2(lowD.getMinutes()) + " da" : ""],
    ];
    box.innerHTML = facts.map((f) =>
      '<div class="fact"><div class="f-k">' + f[0] + "</div>" +
      '<div class="f-v ' + (f[2] || "") + '">' + esc(String(f[1])) + "</div>" +
      (f[3] ? '<div class="f-n">' + esc(f[3]) + "</div>" : "") + "</div>").join("");
  }

  /* Diqqat talab qiladiganlar: uzilgan kameralar, eng uzoq turganidan
     boshlab. Operator ishini shu ro'yxatdan boshlaydi. */
  renderAttention() {
    const off = state.cameras.filter((c) => c.online === false)
      .sort((x, y) => (Date.parse(x.last_seen) || 0) - (Date.parse(y.last_seen) || 0));
    $("att-count").textContent = off.length ? off.length + " ta uzilgan" : "";
    if (!off.length) {
      $("att-rows").innerHTML =
        '<div class="empty">Hamma kamera onlayn — diqqat talab qiladigan kamera yo‘q.</div>';
      return;
    }
    $("att-rows").innerHTML = off.slice(0, 40).map((c) =>
      '<div class="rrow click att" data-id="' + c.id + '">' +
        '<span class="ln bad"></span>' +
        '<span class="tx"><b>' + esc(c.name) + "</b><i>" + esc(c.region || "") + "</i></span>" +
        '<span class="dur">' + fmtDuration(c.last_seen) + "</span></div>").join("");
    $("att-rows").querySelectorAll(".att").forEach((row) =>
      row.addEventListener("click", () => selectCamera(Number(row.dataset.id), true)));
  }

  /* Ochilish vaqti: serverdagi kamera kesimi (hamma foydalanuvchi va devorlar,
     server ishga tushganidan beri, har kameraning oxirgi 10 ochilishi medianasi);
     server bermasa — shu seans o'lchovlari. Sekinlari yuqorida. */
  renderSlow() {
    const srv = state.openServer;
    let rows, note;
    if (srv && srv.items && srv.items.length) {
      rows = srv.items.map((x) => ({ name: x.name, ms: x.median_ms,
        tip: x.n + " ochilish · oxirgisi " + (x.last_ms / 1000).toFixed(1) + " s · eng sekini " +
             (x.max_ms / 1000).toFixed(1) + " s · " + x.transport }));
      note = "Barcha foydalanuvchilar · " + srv.cameras + " kamera, " + srv.opens +
        " ochilish · median " + (srv.p50_ms / 1000).toFixed(1).replace(".", ",") + " s";
    } else {
      rows = [...state.openByCam.entries()]
        .map(([id, ms]) => ({ cam: state.byId.get(id), ms }))
        .filter((r) => r.cam)
        .map((r) => ({ name: r.cam.name, ms: r.ms, tip: "shu seans" }));
      const t = state.openTimes;
      note = t.length
        ? "Shu seans · o'rtacha " + (t.reduce((s, v) => s + v, 0) / t.length / 1000).toFixed(2)
            .replace(".", ",") + " s · sekinlari yuqorida"
        : "Hali hech kim kamera ochmagan";
    }
    rows = rows.sort((a, b) => b.ms - a.ms).slice(0, 8);
    $("m-open-note").textContent = note;
    const max = rows.length ? rows[0].ms : 1;
    $("slow-rows").innerHTML = rows.length ? rows.map((r) => {
      const sec = r.ms / 1000;
      const color = sec <= 2 ? "var(--ok)" : sec <= 5 ? "var(--warn)" : "var(--danger)";
      return '<div class="rrow" title="' + esc(r.tip) + '"><span class="rg wide">' + esc(r.name) + "</span>" +
        '<div class="bar"><i style="width:' + Math.max(6, Math.round((r.ms / max) * 100)) +
        "%;background:" + color + '"></i></div>' +
        '<span class="lb">' + sec.toFixed(2) + " s</span></div>";
    }).join("") : '<div class="empty">Server ishga tushganidan beri hech kim kamera ochmagan — ochilganda o‘lchov shu yerda ko‘rinadi.</div>';
  }

  /* Tizim holati — faqat haqiqiy signallardan chiqariladi. */
  renderSystem() {
    const total = state.cameras.length;
    const on = state.cameras.filter((c) => c.online === true).length;
    const pct = total ? (on / total) * 100 : 0;
    const fresh = state.cameras.some((c) => c.last_seen &&
      Date.now() - Date.parse(c.last_seen) < 10 * 60000);
    const rows = [
      ["Video servislari", ICO.server, state.apiOk ? ["Faol", ""] : ["Uzilgan", "bad"]],
      ["Ma'lumotlar bazasi", ICO.db, state.apiOk ? ["Faol", ""] : ["Javob yo'q", "bad"]],
      ["Tarmoq ulanishi", ICO.net,
        !total ? ["Ma'lumot yo'q", "warn"]
          : pct >= 90 ? ["Barqaror", ""]
          : pct >= 60 ? ["Beqaror", "warn"] : ["Muammo", "bad"]],
      ["Holat kuzatuvi", ICO.cast,
        fresh ? ["Faol", ""] : total ? ["Eskirgan", "warn"] : ["Kutilmoqda", "warn"]],
      ["Oqim xizmatlari", ICO.play,
        state.streamOk === null ? ["Sinalmagan", "warn"]
          : state.streamOk ? ["Faol", ""] : ["Uzilgan", "bad"]],
    ];
    $("sys-list").innerHTML = rows.map(([name, icon, [tx, cls]]) =>
      '<div class="sysrow"><span class="si">' + icon + "</span>" +
      '<span class="sn">' + name + "</span>" +
      '<span class="sb ' + cls + '">' + tx + "</span></div>").join("");
  }

  /* Hududlar jadvalini CSV faylga chiqarish. */
  exportRegionsCsv() {
    const rstats = new Map(((state.stats && state.stats.regions) || []).map((x) => [x.region, x]));
    const regions = [...new Set(state.cameras.map((c) => c.region))].sort();
    if (!regions.length) { toast("Eksport uchun ma'lumot yo'q", true); return; }
    const cell = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const head = ["Hudud", "Jami", "Onlayn", "Uzilgan", "Onlaynlik %", "24 soat %", "Bugungi uzilishlar"];
    const body = regions.map((rg) => {
      const list = state.cameras.filter((c) => c.region === rg);
      const up = list.filter((c) => c.online !== false).length;
      const st = rstats.get(rg);
      return [rg, list.length, up, list.length - up,
              list.length ? Math.round((up / list.length) * 100) : 0,
              st && st.uptime24 != null ? st.uptime24 : "",
              st ? st.events_today : ""].map(cell).join(",");
    });
    const blob = new Blob(["﻿" + [head.map(cell).join(","), ...body].join("\r\n")],
                          { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "nigoh-hududlar.csv";
    link.click();
    URL.revokeObjectURL(link.href);
    toast(regions.length + " ta hudud eksport qilindi");
  }
}

export const dashboard = new Dashboard();

export function renderDash() { dashboard.render(); }
export function renderDashMetrics() { dashboard.renderMetrics(); }
export function renderUptimeKpi() { dashboard.renderUptimeKpi(); }
export function loadStats() { return dashboard.loadStats(); }
export function renderRegions() { dashboard.renderRegions(); }
export function renderSystem() { dashboard.renderSystem(); }
