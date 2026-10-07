/* ==========================================================================
   map/railways.js — temir yo'l tarmog'i qatlami
   --------------------------------------------------------------------------
   Vazifasi:
     O'zbekiston temir yo'llarini (/assets/railways.geojson — 7 ta hududiy
     bo'linma, MultiLineString) xaritada chizadi. Ikki daraja aniqlik:
       * uzoqdan (z < DETAIL_ZOOM) — "overview": birlashtirilgan, silliq,
         stansiya yo'llarisiz toza tarmoq;
       * yaqindan — "detail": har bir yo'l va strelka.
     Har yo'l to'rt qatlam: o'z rangidagi keng xira nur (glow), to'q "yostiq",
     rangli chiziq va yaqindan (z >= 14) oq shpallar; nur faqat uzoqdan (z < 11).
     Kamera belgilari ostida, O'zbekiston tashqarisidagi parda (uzMask) ostida
     turadi. Chiziq ustiga kelinsa bo'linma nomi va uzunligi ko'rinadi.
     Afsonada (#map-legend) yoqish/o'chirish va bo'linmalar ro'yxati.

   Eksport:
     RailLayer     — klass: load, restyle, setVisible
     railLayer     — yagona nusxa
     initRailways(map) — main.js / map.js dan bir marta

   Bog'liqliklar:
     import: ../core/state.js ($, esc)
     global: L (canvas renderer, polyline)

   DOM: #ml-rail (yoqish), #ml-rail-list (bo'linmalar), <html data-theme>
   Backend: GET /assets/railways.geojson (backend/scripts/build_railways.py yasaydi)

   Qoidalar / tuzoqlar:
     - Canvas renderer: 35 ming nuqtali 21 ta polyline SVG'da xaritani
       sekinlashtirardi; canvas'da silliq.
     - Ranglar kamera holati ranglaridan (yashil/qizil) ataylab farq qiladi —
       uzilgan kamera "qizil yo'l" bilan adashtirilmasin.
     - Yoqilgan/o'chirilgan holat brauzerda eslab qolinadi (try/catch).
   ========================================================================== */
import { $, esc } from "../core/state.js";

/* Bo'linma ranglari — qorong'i va yorug' xaritada ko'rinadigan, holat
   ranglari (yashil/qizil) bilan adashmaydigan. */
const COLORS = {
  toshkent: "#f59e0b", buxoro: "#a78bfa", qoqon: "#22d3ee", qarshi: "#f472b6",
  termiz: "#94a3b8", qongirot: "#facc15", boshqa: "#2dd4bf",
};
const STORE = "nigoh.rails";
const DETAIL_ZOOM = 10;          // shundan boshlab to'liq geometriya

/* Masshtabga qarab qalinlik: uzoqdan ingichka tarmoq, yaqindan aniq yo'l. */
/* Yaqin masshtabda ingichkaroq: stansiyalarda parallel yo'llar bir-biridan
   bir necha metr naridan o'tadi — qalin chiziqda ular bitta dog'ga qo'shilardi. */
function widthFor(z) {
  return z <= 6 ? 2.2 : z <= 8 ? 2.8 : z <= 10 ? 3.2 : z <= 13 ? 2.8 : z <= 15 ? 3.2 : 4;
}

export class RailLayer {
  constructor() {
    this.map = null;
    this.features = [];
    this.layers = [];             // { glow, casing, core, ties, branch, lod }
    this.shownLod = null;
    this.visible = true;
    try { this.visible = localStorage.getItem(STORE) !== "0"; } catch (e) { /* xotira yopiq */ }
  }

  init(map) {
    if (this.map) return;
    this.map = map;
    // Plitkalar (200) va tiniq O'zbekiston qatlami (250) ustida, parda va
    // chegara (overlayPane, 400) ostida — tashqaridagi yo'llar xiralashadi.
    map.createPane("rails").style.zIndex = 380;
    this.renderer = L.canvas({ pane: "rails", padding: 0.4, tolerance: 6 });
    map.on("zoomend", () => this.restyle());
    // Mavzu almashinuvi (theme.js <html data-theme> ni o'zgartiradi).
    new MutationObserver(() => this.restyle())
      .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    $("ml-rail").addEventListener("click", () => this.setVisible(!this.visible));
    this.load();
  }

  async load() {
    try {
      const res = await fetch("/assets/railways.geojson");
      if (!res.ok) throw new Error(res.status);
      this.features = (await res.json()).features;
    } catch (e) {
      $("ml-rail-box").hidden = true;          // fayl yo'q — afsonadan ham olib tashlanadi
      return;
    }
    this.features.forEach((f) => {
      const lines = f.geometry.coordinates.map((ln) => ln.map(([lng, lat]) => [lat, lng]));
      const p = f.properties;
      const color = COLORS[p.branch] || "#94a3b8";
      const base = { renderer: this.renderer, interactive: false, smoothFactor: 1.4,
                     lineCap: "round", lineJoin: "round" };
      const glow = L.polyline(lines, { ...base, color, opacity: 0.18 });
      const casing = L.polyline(lines, { ...base, color: "#0b1220" });
      const core = L.polyline(lines, { ...base, color, opacity: 1, interactive: true, bubblingMouseEvents: false });
      const ties = L.polyline(lines, { ...base, color: "#ffffff", lineCap: "butt", dashArray: "1 9" });
      core.bindTooltip(esc(p.name) + " · " + p.km.toLocaleString("ru-RU") + " km", { sticky: true, className: "rail-tip" });
      this.layers.push({ glow, casing, core, ties, branch: p.branch, lod: p.lod || "detail" });
    });
    // Eski asset (lod'siz) — bitta daraja.
    this.hasOverview = this.layers.some((l) => l.lod === "overview");
    this.renderLegend();
    this.setVisible(this.visible, true);
  }

  /* Masshtabga mos daraja: qatlamlar faqat daraja almashganda qo'shiladi/olinadi. */
  syncLod() {
    if (!this.visible) return;
    const want = this.hasOverview && this.map.getZoom() < DETAIL_ZOOM ? "overview" : "detail";
    if (want === this.shownLod) return;
    this.shownLod = want;
    this.layers.forEach((l) => [l.glow, l.casing, l.core, l.ties].forEach((x) => x.remove()));
    // Canvas qo'shilish tartibida chizadi: avval hamma nurlar, keyin yostiqlar,
    // chiziqlar, shpallar — bir bo'linmaning nuri boshqasining chizig'ini bosmasin.
    ["glow", "casing", "core", "ties"].forEach((kind) =>
      this.layers.forEach((l) => { if (l.lod === want) l[kind].addTo(this.map); }));
  }

  restyle() {
    if (!this.map || !this.layers.length) return;
    this.syncLod();
    const z = this.map.getZoom();
    const w = widthFor(z);
    const dark = document.documentElement.dataset.theme !== "light";
    this.layers.forEach(({ glow, casing, core, ties }) => {
      // Nur — qorong'i fonda yorqinroq, yorug'da yengil soya.
      // Nur faqat uzoqdan (tarmoq ko'rinishi); yaqindan u yo'llarni qo'shib yuboradi.
      glow.setStyle({ weight: w * 3.2 + 4, opacity: z >= 11 ? 0 : dark ? 0.2 : 0.12 });
      casing.setStyle({ weight: w + (z >= 11 ? 1.6 : 2.4), opacity: dark ? 0.9 : 0.45 });
      core.setStyle({ weight: w });
      // Shpallar faqat yaqindan: uzoqda chiziqni "iflos" ko'rsatadi.
      ties.setStyle({ weight: Math.max(1, w - 1.6), opacity: z >= 14 ? 0.8 : 0,
                      dashArray: z >= 15 ? "1.5 11" : "1 9" });
    });
  }

  setVisible(on, initial) {
    this.visible = on;
    if (!initial) { try { localStorage.setItem(STORE, on ? "1" : "0"); } catch (e) { /* xotira yopiq */ } }
    $("ml-rail").classList.toggle("on", on);
    $("ml-rail").setAttribute("aria-checked", String(on));
    $("ml-rail-list").hidden = !on;
    this.shownLod = null;
    if (!on) this.layers.forEach((l) => [l.glow, l.casing, l.core, l.ties].forEach((x) => x.remove()));
    else this.restyle();
  }

  renderLegend() {
    $("ml-rail-list").innerHTML = this.features.filter((f) => f.properties.km >= 50 &&
      (f.properties.lod || "detail") === "detail").map((f) =>
      '<div class="ml-rr"><i style="background:' + (COLORS[f.properties.branch] || "#94a3b8") + '"></i>' +
      esc(f.properties.name.replace(" MTU", "")) + "</div>").join("");
  }
}

export const railLayer = new RailLayer();
export function initRailways(map) { railLayer.init(map); }
