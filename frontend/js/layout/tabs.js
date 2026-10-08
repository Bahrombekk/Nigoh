/* ==========================================================================
   layout/tabs.js — bo'limlar (Nav rail) va manzil (#hash) bilan sinxron
   --------------------------------------------------------------------------
   Vazifasi:
     Rail tugmalari, #hash marshrutlash (#dash/trend, #settings/status ...),
     yopiq bo'limlarga kirish talabi, body[data-tab], sahifa ko'rinishini
     almashtirish. Har bo'lim moduli o'zini registerPage bilan ulaydi —
     tabs.js modullarni import qilmaydi (aylanma importlar bo'lmasin).

   Eksport:
     AUTH_TABS            — kirish talab qiladigan bo'limlar
     ADMIN_TABS           — faqat administrator
     registerPage(tab, { show(sub), hide(), el }) — bo'lim moduli ulanadi
     showTab(tab, sub?)   — bo'limga o'tish (sub — ichki bo'lim: "trend", "status" ...)
     currentSub()         — joriy ichki bo'lim
     setSub(sub)          — ichki bo'limni manzilga yozish (sahifa o'zi almashtiradi)
     tabs                 — klass nusxasi

   Sahifalar: #map-view, #dash-view, #wall-view, #admin-view, #settings-view
   Qoidalar:
     - Kirilmagan foydalanuvchi #dash/#admin/#settings ni ochmaydi: kirish
       ekrani, so'ralgan bo'lim state.pendingTab ga (kirgach ochiladi).
     - Admin bo'limlari operator/kuzatuvchiga — xarita.
   ========================================================================== */
import { $, state } from "../core/state.js";
import { openLogin } from "../auth/auth.js";

export const TABS = ["map", "dash", "wall", "admin", "settings"];
export const AUTH_TABS = ["dash", "admin", "settings"];
export const ADMIN_TABS = ["admin", "settings"];

const pages = new Map();
let sub = "";

export function registerPage(tab, handlers) { pages.set(tab, handlers || {}); }
export function currentSub() { return sub; }

function parseHash() {
  const h = location.hash.replace(/^#/, "");
  const [t, s] = h.split("/");
  return { tab: TABS.includes(t) ? t : "map", sub: s || "" };
}

export class Tabs {
  constructor() {
    window.addEventListener("hashchange", () => {
      const { tab, sub: s } = parseHash();
      if (tab !== state.tab || s !== sub) this.show(tab, s, true);
    });
    document.querySelectorAll("#rail [data-tab]").forEach((b) =>
      b.addEventListener("click", () => this.show(b.dataset.tab)));
    $("rail-logo").addEventListener("click", () => this.show("dash"));
    document.addEventListener("click", (e) => {
      const go = e.target.closest && e.target.closest("[data-tab-go]");
      if (go) { const [t, s] = go.dataset.tabGo.split("/"); this.show(t, s || ""); }
    });
  }

  show(tab, s = "", fromHash = false) {
    if (!TABS.includes(tab)) tab = "map";
    if (AUTH_TABS.includes(tab) && !state.admin) {
      state.pendingTab = tab;
      if (location.hash) history.replaceState(null, "", location.pathname);
      openLogin();
      return;
    }
    if (ADMIN_TABS.includes(tab) && state.admin && state.admin.role !== "admin") tab = "map";
    const prev = state.tab;
    const prevSub = sub;
    state.tab = tab;
    sub = s || "";
    document.body.dataset.tab = tab;
    document.querySelectorAll("#rail [data-tab]").forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle("is-on", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    TABS.forEach((t) => { const el = $(t + "-view"); if (el) el.hidden = t !== tab; });

    if (prev && prev !== tab) {
      const p = pages.get(prev);
      if (p && p.hide) p.hide();
    }
    const cur = pages.get(tab);
    if (cur && cur.show && (prev !== tab || prevSub !== sub || !fromHash)) cur.show(sub);

    const hash = tab === "map" ? "" : "#" + tab + (sub ? "/" + sub : "");
    if (location.hash !== hash && !(hash === "" && location.hash === "")) {
      history.replaceState(null, "", location.pathname + location.search + hash);
    }
  }
}

export const tabs = new Tabs();

export function showTab(tab, s) { tabs.show(tab, s || ""); }

/* Sahifa ichida (masalan dashboard tablari) ichki bo'lim almashganda manzilni yangilash. */
export function setSub(s) {
  sub = s || "";
  const hash = "#" + state.tab + (sub ? "/" + sub : "");
  if (state.tab !== "map" && location.hash !== hash) history.replaceState(null, "", location.pathname + location.search + hash);
}

/* Boshlang'ich marshrut: main.js chaqiradi. */
export function initialRoute() { return parseHash(); }

/* ---------- v2 mosligi ---------- */
export function startClock() {}
export function drawHeadMaps() { return Promise.resolve(); }
