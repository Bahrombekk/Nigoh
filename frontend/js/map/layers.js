/* ==========================================================================
   map/layers.js — Toolbar / Qatlamlar, Map/LayersPopover (02.05), Map/LegendChip
   --------------------------------------------------------------------------
   Vazifasi:
     * Toolbar (o'ng-yuqori): "Temir yoʻllar", "Hudud chegaralari" (Map/Control,
       Active = yoqilgan) va "Barcha qatlamlar" → popover; yonida
       Toolbar / Tizim (layout/notifications.js mountSysbar).
     * Qatlamlar menyusi: LayerRow'lar (butun qator bosiladi, darhol
       qo'llanadi): Temir yoʻllar (+ Manba: Yangi · OSM / Eski), Hudud
       chegaralari, Kamera klasterlari; Xarita turi: Sxema / Gibrid.
       Tanlov prefs "layers" da (kirgan foydalanuvchida profilga yoziladi).
     * Legend (pastda): Onlayn / Tasvirsiz / Uzilgan + "?" → to'liq legend.

   Eksport: Layers, layers, initLayers()
   Bog'liqliklar: ../core/state.js, ../core/prefs.js, ../core/icons.js, ../core/ui.js,
                  ../layout/notifications.js (mountSysbar), ./map.js (layerState, mapView),
                  ./railways.js (railLayer)
   DOM: #mp-toolbar, #mp-layers, #ly-rail, #ly-regions, #ly-all, #mp-legend, #mp-legend-more
   Hodisalar: "rails:loaded" (railways.js), "prefs:loaded" (prefs.js)
   ========================================================================== */
import { $ } from "../core/state.js";
import { prefs } from "../core/prefs.js";
import { icon } from "../core/icons.js";
import { closePopovers, popover } from "../core/ui.js";
import { mountSysbar } from "../layout/notifications.js";
import { layerState, mapView } from "./map.js";
import { railLayer } from "./railways.js";

const ROWS = [
  { key: "rail", icon: "train", title: "Temir yoʻllar", meta: "Faol liniyalar" },
  { key: "regions", icon: "map", title: "Hudud chegaralari", meta: "Viloyatlar" },
  { key: "clusters", icon: "circle-nodes", title: "Kamera klasterlari", meta: "Uzoqlashtirilganda birlashadi" },
];

export class Layers {
  constructor() { this.pop = null; this.railsOk = true; this.hybridOk = null; }

  init() {
    mountSysbar($("mp-toolbar"));
    $("ly-rail").addEventListener("click", () => this.set("rail", !layerState.rail));
    $("ly-regions").addEventListener("click", () => this.set("regions", !layerState.regions));
    $("ly-all").addEventListener("click", () => this.open());
    $("mp-legend-more").addEventListener("click", (e) => this.legend(e.currentTarget));
    document.addEventListener("rails:loaded", (e) => {
      this.railsOk = e.detail.ok;
      if (e.detail.ok && e.detail.source) layerState.railSrc = e.detail.source;
      this.paint();
    });
    document.addEventListener("prefs:loaded", () => {
      const p = prefs.get("layers", {}) || {};
      Object.keys(p).forEach((k) => { if (p[k] !== layerState[k]) { layerState[k] = p[k]; this.apply(k); } });
      this.paint();
    });
    this.paint();
    this.checkHybrid();
  }

  /* "Gibrid" (Esri World Imagery) — sahifa CSP'si img-src da server.arcgisonline.com
     ga ruxsat bermasa plitkalar bloklanadi (konsolda xato). Shuning uchun avval
     sarlavha tekshiriladi; ruxsat yo'q — tugma o'chiq, xarita Sxemada qoladi. */
  async checkHybrid() {
    try {
      // Statik fayl (brauzer keshida) — javobda sahifa bilan bir xil CSP sarlavhasi.
      const r = await fetch("/assets/uz.geojson", { credentials: "same-origin" });
      const csp = r.headers.get("content-security-policy") || "";
      const img = (csp.match(/img-src([^;]*)/) || [])[1];
      this.hybridOk = !csp || !img || /arcgisonline|\*(\s|$)|https:(\s|$)/.test(img);
    } catch (e) { this.hybridOk = false; }
    if (this.hybridOk && layerState.base === "hybrid") mapView.setBase("hybrid");
    if (!this.hybridOk && layerState.base === "hybrid") layerState.base = "scheme";
    this.paint();
  }

  set(key, val) {
    if (key === "base" && val === "hybrid" && !this.hybridOk) return;
    layerState[key] = val;
    this.apply(key);
    prefs.set("layers", Object.assign({}, layerState));
    this.paint();
  }

  apply(key) {
    const v = layerState[key];
    if (key === "rail") railLayer.setVisible(v !== false);
    else if (key === "regions") mapView.setRegionsVisible(v !== false);
    else if (key === "clusters") mapView.setClusters(v !== false);
    else if (key === "base") mapView.setBase(v);
    else if (key === "railSrc") railLayer.setSource(v);
  }

  paint() {
    [["ly-rail", "rail"], ["ly-regions", "regions"]].forEach(([id, key]) => {
      const on = layerState[key] !== false;
      $(id).classList.toggle("is-on", on);
      $(id).setAttribute("aria-pressed", String(on));
    });
    $("ly-rail").hidden = !this.railsOk;
    if (!this.pop || !document.contains(this.pop)) return;
    this.pop.querySelectorAll(".mp-lrow").forEach((r) => {
      const on = layerState[r.dataset.layer] !== false;
      r.setAttribute("aria-checked", String(on));
      r.querySelector(".switch").setAttribute("aria-checked", String(on));
      r.classList.toggle("is-on", on);
    });
    this.pop.querySelectorAll("[data-src]").forEach((b) =>
      b.classList.toggle("is-on", b.dataset.src === (railLayer.source || layerState.railSrc)));
    this.pop.querySelectorAll("[data-base]").forEach((b) => {
      b.classList.toggle("is-on", b.dataset.base === (layerState.base === "hybrid" ? "hybrid" : "scheme"));
      if (b.dataset.base === "hybrid") {
        b.setAttribute("aria-disabled", String(!this.hybridOk));
        if (!this.hybridOk) b.dataset.tip = "Sunʼiy yoʻldosh plitkalari serverda ruxsat etilmagan";
        else delete b.dataset.tip;
      }
    });
    const sub = this.pop.querySelector(".mp-lp__src");
    if (sub) sub.hidden = layerState.rail === false || !this.railsOk;
  }

  /* 02.05 — toolbar tagida, o'ng chetga tekis. */
  open() {
    const row = (r) =>
      '<button class="mp-lrow" role="switch" data-layer="' + r.key + '"' + (r.key === "rail" && !this.railsOk ? " hidden" : "") + ">" +
        '<span class="mp-lrow__ic">' + icon(r.icon) + "</span>" +
        '<span class="mp-lrow__txt"><span class="label-md">' + r.title + '</span><span class="body-xs t-tertiary">' + r.meta + "</span></span>" +
        '<span class="switch" aria-hidden="true"></span></button>' +
      (r.key === "rail" ? '<div class="mp-lp__src"><span class="body-xs t-tertiary">Manba</span>' +
        '<div class="seg seg--sm seg--inline"><button data-src="v2">Yangi · OSM</button><button data-src="v1">Eski</button></div></div>' : "");
    const html =
      '<div class="mp-lp" role="dialog" aria-label="Qatlamlar">' +
        '<div class="mp-lp__head"><span class="heading-sm">Qatlamlar</span>' +
          '<button class="icon-btn icon-btn--sm" data-close-lp data-tip="Yopish">' + icon("xmark", "sm") + "</button></div>" +
        ROWS.map(row).join("") +
        '<div class="mp-lp__sep"></div>' +
        '<div class="mp-lp__type"><span class="label-sm t-secondary">Xarita turi</span>' +
          '<div class="seg seg--sm mp-lp__base"><button data-base="scheme">Sxema</button><button data-base="hybrid">Gibrid</button></div></div>' +
      "</div>";
    const el = popover($("ly-all"), html, { place: "bottom-end", offset: 10, cls: "mp-lp-pop",
      onClose: () => { this.pop = null; } });
    if (!el) return;
    // O'ng cheti toolbar guruhi bilan tekis.
    const g = $("mp-layers").getBoundingClientRect();
    el.style.left = Math.max(8, Math.min(innerWidth - el.offsetWidth - 8, g.right - el.offsetWidth)) + "px";
    this.pop = el;
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-close-lp]")) { closePopovers(); $("ly-all").focus(); return; }
      const r = e.target.closest(".mp-lrow");
      if (r) { this.set(r.dataset.layer, layerState[r.dataset.layer] === false); return; }
      const s = e.target.closest("[data-src]");
      if (s) { this.set("railSrc", s.dataset.src); return; }
      const b = e.target.closest("[data-base]");
      if (b) this.set("base", b.dataset.base);
    });
    this.paint();
  }

  /* Map/LegendChip "?" → to'liq legend. */
  legend(anchor) {
    const mk = (st, ic) => '<span class="mp-lg__mk"><span class="mp-mk" data-status="' + st + '">' + icon(ic, "xs") + "</span></span>";
    const item = (sym, text) => '<div class="mp-lg__row">' + sym + '<span class="body-sm t-secondary">' + text + "</span></div>";
    const html =
      '<div class="mp-lg" role="dialog" aria-label="Shartli belgilar">' +
        '<div class="mp-lp__head"><span class="heading-sm">Shartli belgilar</span>' +
          '<button class="icon-btn icon-btn--sm" data-close-lp data-tip="Yopish">' + icon("xmark", "sm") + "</button></div>" +
        '<div class="overline">Kamera holati</div>' +
        item(mk("online", "camera"), "Onlayn — oqim ochiladi, kadr keladi") +
        item(mk("no-video", "camera"), "Tasvirsiz — port javob beradi, kadr yoʻq") +
        item(mk("offline", "camera-slash"), "Uzilgan — port javob bermaydi") +
        item(mk("disabled", "camera"), "Oʻchirilgan — kuzatilmaydi") +
        '<div class="overline">Xarita</div>' +
        item('<span class="mp-lg__cl"><span class="mp-cl is-alert"><span class="mp-cl__n">12</span><span class="mp-cl__badge">3</span></span></span>',
          "Klaster: jami kamera · qizil — ichidagi uzilganlar") +
        item('<span class="mp-lg__line mp-lg__line--rail"></span>', "Temir yoʻl") +
        item('<span class="mp-lg__line mp-lg__line--region"></span>', "Hudud chegarasi") +
        item('<span class="mp-lg__mask"></span>', "Oʻzbekiston tashqarisi") +
      "</div>";
    const el = popover(anchor, html, { place: "top-start", offset: 10, cls: "mp-lp-pop" });
    if (!el) return;
    el.addEventListener("click", (e) => { if (e.target.closest("[data-close-lp]")) { closePopovers(); anchor.focus(); } });
  }
}

export const layers = new Layers();
export function initLayers() { layers.init(); }
