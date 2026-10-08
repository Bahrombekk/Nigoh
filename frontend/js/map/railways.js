/* ==========================================================================
   map/railways.js — temir yo'l tarmog'i qatlami (v3, Figma "faol temir yo'l overlay")
   --------------------------------------------------------------------------
   Vazifasi:
     O'zbekiston temir yo'llarini xaritada chizadi. Manba ikkita:
       * v2 (standart, "Yangi · OSM") — /assets/railways-v2.geojson: OpenStreetMap
         geometriyasi; toifalar: asosiy, tarmoq, sanoat, stansiya yo'llari;
         tezyurar liniyalar alohida (qo'sh chiziq);
       * v1 ("Eski") — /assets/railways.geojson — solishtirish uchun; v2
         yuklanmasa avtomatik shunga tushadi.
     Ikki daraja aniqlik: uzoqdan (z < DETAIL_ZOOM) "overview" — birlashtirilgan
     asosiy tarmoq; yaqindan "detail" — har yo'l, sanoat va stansiya yo'llari
     z >= MINOR_ZOOM dan.
     Figma ko'rinishi: bitta rang `--map-line-rail` (3px) + yostiq
     `--map-line-rail-casing` + shpallar `--map-line-rail-tie`. Ranglar
     tokenlardan o'qiladi va "theme:changed" da qayta o'qiladi.

   Eksport:
     RailLayer         — klass: init, load, setSource, setVisible, restyle
     railLayer         — yagona nusxa
     initRailways(map) — map.js dan bir marta

   Bog'liqliklar:
     import: ../core/state.js (esc), ./util.js (cssColor)
     global: L (canvas renderer, polyline)
   Backend: GET /assets/railways-v2.geojson, /assets/railways.geojson

   Qoidalar / tuzoqlar:
     - Canvas renderer: yuz minglab nuqta SVG'da xaritani sekinlashtirardi.
     - Yoqilganlik va manba endi map/layers.js da (prefs "layers") saqlanadi;
       ?rails=v1|v2 manzil parametri manbani bir martalik bekor qiladi.
     - Faqat asosiy/tarmoq yo'llari sichqoncha bilan so'raladi (tooltip).
     - Hodisa "rails:loaded" (detail: {ok, source}) — qatlamlar menyusi
       manba tugmalarini yangilaydi; ok=false — hech bir manba yo'q.
   ========================================================================== */
import { esc } from "../core/state.js";
import { cssColor } from "./util.js";

const SOURCES = { v2: "/assets/railways-v2.geojson", v1: "/assets/railways.geojson" };
const DETAIL_ZOOM = 10;          // shundan boshlab to'liq geometriya
const MINOR_ZOOM = 12;           // sanoat va stansiya yo'llari shundan boshlab

/* Toifa: chizish tartibi (kichigi pastda), qalinlik ulushi, nom. */
const KIND = {
  yard: { rank: 0, scale: 0.55, label: "stansiya yoʻllari" },
  industrial: { rank: 1, scale: 0.6, label: "sanoat tarmogʻi" },
  other: { rank: 2, scale: 0.8, label: "temir yoʻl" },
  branch: { rank: 3, scale: 0.85, label: "tarmoq liniya" },
  main: { rank: 4, scale: 1, label: "asosiy liniya" },
};
const MINOR = new Set(["yard", "industrial"]);

/* Figma: chiziq 3px. Uzoqdan biroz ingichka, juda yaqindan qalinroq. */
function widthFor(z) {
  return z <= 6 ? 2.2 : z <= 8 ? 2.6 : z <= 14 ? 3 : 4;
}

export class RailLayer {
  constructor() {
    this.map = null;
    this.features = [];
    this.layers = [];             // { casing, core, ties, lod, kind, hs, rank }
    this.shownKey = null;
    this.visible = true;
    this.source = "v2";
    this.available = true;
    this.token = 0;               // eskirgan yuklashni bekor qilish
    const q = new URLSearchParams(location.search).get("rails");
    this.forced = q === "v1" || q === "v2" ? q : null;
  }

  init(map, opts = {}) {
    if (this.map) return;
    this.map = map;
    if (opts.source) this.source = opts.source;
    if (this.forced) this.source = this.forced;
    if (opts.visible != null) this.visible = opts.visible;
    // Plitkalar (200) va tiniq O'zbekiston qatlami (250) ustida, parda va
    // chegara (overlayPane, 400) ostida — tashqaridagi yo'llar xiralashadi.
    map.createPane("rails").style.zIndex = 380;
    this.renderer = L.canvas({ pane: "rails", padding: 0.4, tolerance: 6 });
    map.on("zoomend", () => this.restyle());
    document.addEventListener("theme:changed", () => this.restyle());
    this.load();
  }

  async load() {
    const token = ++this.token;
    let data;
    try {
      const res = await fetch(SOURCES[this.source]);
      if (!res.ok) throw new Error(res.status);
      data = (await res.json()).features;
    } catch (e) {
      if (token !== this.token) return;
      if (this.source === "v2") { this.source = "v1"; this.load(); return; }   // v2 yo'q — eskisi
      this.available = false;
      document.dispatchEvent(new CustomEvent("rails:loaded", { detail: { ok: false } }));
      return;
    }
    if (token !== this.token) return;
    this.clear();
    this.features = data;
    data.forEach((f) => this.addFeature(f));
    this.layers.sort((a, b) => a.rank - b.rank);
    this.hasOverview = this.layers.some((l) => l.lod === "overview");
    this.available = true;
    this.setVisible(this.visible);
    document.dispatchEvent(new CustomEvent("rails:loaded", { detail: { ok: true, source: this.source } }));
  }

  addFeature(f) {
    const lines = f.geometry.coordinates.map((ln) => ln.map(([lng, lat]) => [lat, lng]));
    const p = f.properties || {};
    const kind = p.kind || "main";
    const minor = MINOR.has(kind);
    const base = { renderer: this.renderer, interactive: false, smoothFactor: 1.2,
                   lineCap: "round", lineJoin: "round" };
    const casing = L.polyline(lines, { ...base });
    // Bosish xaritaga o'tadi (bubbling): masofa o'lchash va joy tanlash yo'l ustida ham ishlaydi.
    const core = L.polyline(lines, { ...base, interactive: !minor, bubblingMouseEvents: true });
    const ties = L.polyline(lines, { ...base, lineCap: "butt" });
    if (!minor && p.name) {
      const elec = p.elec_km != null && p.km ? Math.round((p.elec_km / p.km) * 100) : null;
      core.bindTooltip(
        "<b>" + esc(p.name) + "</b> · " + esc((KIND[kind] || KIND.main).label) + (p.hs ? " · tezyurar" : "") +
        (p.km ? "<br><span>" + Math.round(p.km).toLocaleString("ru-RU") + " km" +
          (elec != null ? " · elektrlashtirilgan " + elec + "%" : "") + "</span>" : ""),
        { sticky: true, className: "mp-rail-tip" });
    }
    this.layers.push({ casing, core, ties, lod: p.lod || "detail", kind, hs: !!p.hs,
                       rank: (KIND[kind] || KIND.main).rank + (p.hs ? 0.5 : 0) });
  }

  parts(l) { return [l.casing, l.core, l.ties]; }

  clear() {
    this.layers.forEach((l) => this.parts(l).forEach((x) => x.remove()));
    this.layers = [];
    this.shownKey = null;
  }

  setSource(src) {
    if (src !== "v1" && src !== "v2") return;
    this.forced = null;
    if (src === this.source) return;
    this.source = src;
    if (this.map) this.load();
  }

  /* Masshtabga mos daraja va toifalar: qatlamlar faqat o'zgarganda qo'shiladi/olinadi. */
  syncLod() {
    if (!this.visible) return;
    const z = this.map.getZoom();
    const want = this.hasOverview && z < DETAIL_ZOOM ? "overview" : "detail";
    const minor = z >= MINOR_ZOOM;
    const key = want + (minor ? "+minor" : "");
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.layers.forEach((l) => this.parts(l).forEach((x) => x.remove()));
    const on = (l) => l.lod === want && (minor || !MINOR.has(l.kind));
    // Canvas qo'shilish tartibida chizadi: avval hamma yostiqlar, keyin
    // chiziqlar, shpallar — bir yo'lning yostig'i boshqasining chizig'ini bosmasin.
    ["casing", "core", "ties"].forEach((part) =>
      this.layers.forEach((l) => { if (on(l)) l[part].addTo(this.map); }));
  }

  restyle() {
    if (!this.map || !this.layers.length || !this.visible) return;
    this.syncLod();
    const z = this.map.getZoom();
    const rail = cssColor("--map-line-rail");
    const casingC = cssColor("--map-line-rail-casing", "#ffffff");
    const tie = cssColor("--map-line-rail-tie", "#ffffff");
    this.layers.forEach(({ casing, core, ties, kind, hs }) => {
      const w = widthFor(z) * (KIND[kind] || KIND.main).scale;
      casing.setStyle({ color: casingC.color, weight: w + (z >= 11 ? 2 : 2.5), opacity: 0.9 });
      core.setStyle({ color: rail.color, weight: w, opacity: MINOR.has(kind) ? 0.75 : 1 });
      if (hs) {
        // Tezyurar — qo'sh yo'l: chiziq ichida uzluksiz o'zak.
        ties.setStyle({ color: tie.color, weight: Math.max(0.8, w * 0.34), opacity: z >= 7 ? 0.95 : 0,
                        dashArray: null, lineCap: "round" });
      } else {
        // Shpallar: chiziq ustida kalta ko'ndalang belgilar; uzoqdan siyrakroq.
        ties.setStyle({ color: tie.color, weight: Math.max(1, w - 1), lineCap: "butt",
                        opacity: z >= 8 && !MINOR.has(kind) ? 0.85 : 0,
                        dashArray: z >= 14 ? "1.5 10" : "1 8" });
      }
    });
  }

  setVisible(on) {
    this.visible = !!on;
    this.shownKey = null;
    if (!this.map) return;
    if (!this.visible) this.layers.forEach((l) => this.parts(l).forEach((x) => x.remove()));
    else this.restyle();
  }
}

export const railLayer = new RailLayer();
export function initRailways(map, opts) { railLayer.init(map, opts); }
