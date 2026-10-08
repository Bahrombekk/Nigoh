/* ==========================================================================
   dashboard/dashboard.js — Dashboard sahifasi: qobiq va tablar (Figma 03)
   --------------------------------------------------------------------------
   Vazifasi:
     Sahifa sarlavhasi (3 tabda bir xil): Segmented tablar Hozir / Trend /
     Tahlil (URL `#dash/hozir|trend|tahlil`, prefs `dashTab`), davr Bugun /
     7 kun / 30 kun (prefs `dashPeriod`, barcha kartalarga qo'llanadi) va
     Toolbar / Tizim (mountSysbar). Faol tabni chizadi, mavzu va o'lcham
     o'zgarganda grafiklarni qayta chizadi, "Qayta urinish" tugmalarini ulaydi.
     Tablarning o'zi: hozir.js, trend.js, overview.js (Tahlil; reyting va
     taqsimot kartalari — ranking.js). Har tab ichida bo'limlar Overline
     sarlavha bilan ajratilgan (v2 dagi barcha vidjetlar 3 tabga taqsimlangan).

   Eksport:
     DashboardPage, dashboardPage
     renderDash(sub?)     — sub berilsa (registerPage show) — o'sha tabni ochadi;
                            berilmasa (data.js har 30 s) — joriy tabni yangilaydi
     renderDashMetrics()  — pleyer oqim ochganda (player.js) — hodisalar lentasi
     renderSystem()       — v2 mosligi (tizim holati endi sysbar'da) — bo'sh
     loadStats(), renderUptimeKpi(), renderRegions() — v2 mosligi

   Bog'liqliklar: ../core/state.js, ../core/prefs.js, ../layout/tabs.js (setSub),
     ../layout/notifications.js (mountSysbar), ./hozir.js, ./trend.js, ./overview.js, ./common.js
   Qoidalar:
     - Faqat ko'rinib turgan tab chiziladi (yashirin panelda kenglik 0).
     - Davr ma'lumoti 55 s keshlanadi (common.load) — 30 s avto-yangilash
       serverni ortiqcha so'ramaydi; kameralar ro'yxatiga bog'liq qism har safar.
     - Delta (▲/▼) faqat backend `previous` bersa (?compare=1), aks holda yashirin.
   ========================================================================== */
import { $, state } from "../core/state.js";
import { prefs } from "../core/prefs.js";
import { setSub } from "../layout/tabs.js";
import { mountSysbar } from "../layout/notifications.js";
import { hozir } from "./hozir.js";
import { trend } from "./trend.js";
import { overviewReport } from "./overview.js";
import { invalidate } from "./common.js";
import { chTipHide } from "./charts.js";

const SUBS = ["hozir", "trend", "tahlil"];
const PERIODS = [1, 7, 30];

export class DashboardPage {
  constructor() {
    const t = prefs.get("dashTab"), p = Number(prefs.get("dashPeriod"));
    this.sub = SUBS.includes(t) ? t : "hozir";
    this.days = PERIODS.includes(p) ? p : 1;
    this.sysbarMounted = false;
    this.resizeTimer = 0;

    const tabsEl = $("db-tabs");
    tabsEl.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-sub]");
      if (b) this.open(b.dataset.sub, true);
    });
    // Klaviatura: ← / → tablar orasida.
    tabsEl.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const i = SUBS.indexOf(this.sub) + (e.key === "ArrowRight" ? 1 : -1);
      const next = SUBS[(i + SUBS.length) % SUBS.length];
      this.open(next, true);
      tabsEl.querySelector('[data-sub="' + next + '"]').focus();
      e.preventDefault();
    });
    $("db-period").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-p]");
      if (!b) return;
      this.days = Number(b.dataset.p);
      prefs.set("dashPeriod", this.days);
      this.paintHead();
      this.refresh();
    });
    $("dash-view").addEventListener("click", (e) => {
      if (!e.target.closest("[data-db-retry]")) return;
      invalidate();
      this.refresh(true);
    });
    document.addEventListener("theme:changed", () => { if (this.visible()) this.redraw(); });
    addEventListener("resize", () => {
      if (!this.visible()) return;
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.redraw(), 150);
    });
    // Kirgach serverdagi afzalliklar kelishi mumkin.
    document.addEventListener("prefs:loaded", () => {
      const pp = Number(prefs.get("dashPeriod"));
      if (PERIODS.includes(pp) && pp !== this.days) { this.days = pp; if (this.visible()) { this.paintHead(); this.refresh(); } }
    });
  }

  visible() { return state.tab === "dash" && !$("dash-view").hidden; }

  /* registerPage show(sub): "" — saqlangan tab. */
  show(sub) {
    if (!this.sysbarMounted) {
      mountSysbar($("db-sysbar"), { flat: true });
      this.sysbarMounted = true;
    }
    this.open(SUBS.includes(sub) ? sub : this.sub, false);
  }

  open(sub, user) {
    if (!SUBS.includes(sub)) sub = "hozir";
    this.sub = sub;
    if (user || prefs.get("dashTab") !== sub) prefs.set("dashTab", sub);
    setSub(sub);
    chTipHide();
    this.paintHead();
    this.refresh();
  }

  paintHead() {
    $("db-tabs").querySelectorAll("button").forEach((b) => {
      const on = b.dataset.sub === this.sub;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", on);
      b.tabIndex = on ? 0 : -1;
    });
    $("db-period").querySelectorAll("button").forEach((b) => {
      const on = Number(b.dataset.p) === this.days;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", on);
    });
    SUBS.forEach((s) => { $("db-" + s).hidden = s !== this.sub; });
  }

  refresh(force) {
    state.period = this.days;
    if (this.sub === "hozir") hozir.refresh(this.days, force);
    else if (this.sub === "trend") trend.refresh(this.days, force);
    else overviewReport.refresh(this.days, force);
  }

  /* data.js (kameralar yangilandi) — joriy tab. */
  update() {
    if (!this.visible()) return;
    this.refresh();
  }

  redraw() {
    if (this.sub === "hozir") hozir.renderAll();
    else if (this.sub === "trend") trend.redraw();
    else overviewReport.redraw();
  }
}

export const dashboardPage = new DashboardPage();

export function renderDash(sub) {
  if (sub === undefined) dashboardPage.update();
  else dashboardPage.show(sub);
}
export function renderDashMetrics() {
  hozir.noteOpen();
  if (dashboardPage.visible() && dashboardPage.sub === "tahlil") overviewReport.renderOpen();
}
export function renderSystem() {}
export function loadStats() { dashboardPage.update(); return Promise.resolve(); }
export function renderUptimeKpi() {}
export function renderRegions() {}
/* v2 nomi bilan import qiluvchilar uchun */
export const dashboard = { render: () => dashboardPage.update(), renderMetrics: renderDashMetrics };
