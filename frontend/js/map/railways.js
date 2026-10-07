/* ==========================================================================
   map/railways.js — temir yo'l tarmog'i qatlami
   --------------------------------------------------------------------------
   Vazifasi:
     O'zbekiston temir yo'llarini xaritada chizadi. Manba ikkita:
       * v2 (standart) — /assets/railways-v2.geojson: OpenStreetMap
         geometriyasi (xarita plitkalari bilan bir xil yo'l, ~160 ming nuqta)
         + bo'linma (MTU) ranglari; toifalar: asosiy, tarmoq, sanoat, stansiya
         yo'llari; tezyurar liniyalar alohida ko'rinadi;
       * v1 (eski) — /assets/railways.geojson (railway-lines.json, 70 ming
         nuqta, chala) — solishtirish uchun afsonadan yoqiladi; v2 yuklanmasa
         avtomatik shunga tushadi.
     Ikki daraja aniqlik: uzoqdan (z < DETAIL_ZOOM) "overview" — birlashtirilgan,
     silliq asosiy tarmoq; yaqindan "detail" — har yo'l, sanoat va stansiya
     yo'llari z >= MINOR_ZOOM dan.
     Har yo'l to'rt qatlam: nur (glow), to'q yostiq, rangli chiziq, shpallar.
     Tezyurar — qo'sh yo'l ko'rinishida (rangli chiziq ichida oq o'zak).

   Eksport:
     RailLayer     — klass: init, load, setSource, setVisible, restyle
     railLayer     — yagona nusxa
     initRailways(map) — map.js dan bir marta

   Bog'liqliklar:
     import: ../core/state.js ($, esc)
     global: L (canvas renderer, polyline)

   DOM: #ml-rail (yoqish), #ml-rail-src (manba tugmalari), #ml-rail-list,
        #ml-rail-box, <html data-theme>
   Backend: GET /assets/railways-v2.geojson, /assets/railways.geojson
            (backend/scripts/build_railways_v2.py va build_railways.py yasaydi)

   Qoidalar / tuzoqlar:
     - Canvas renderer: yuz minglab nuqta SVG'da xaritani sekinlashtirardi.
     - Ranglar kamera holati ranglaridan (yashil/qizil) ataylab farq qiladi —
       uzilgan kamera "qizil yo'l" bilan adashtirilmasin.
     - Manba va yoqilgan holat brauzerda eslab qolinadi (try/catch);
       ?rails=v1|v2 manzil parametri ularni bir martalik bekor qiladi.
     - Faqat asosiy/tarmoq yo'llari sichqoncha bilan so'raladi (tooltip);
       sanoat va stansiya yo'llari interaktiv emas — canvas tez qoladi.
   ========================================================================== */
import { $, esc } from "../core/state.js";

/* Bo'linma ranglari — qorong'i va yorug' xaritada ko'rinadigan, holat
   ranglari (yashil/qizil) bilan adashmaydigan. */
const COLORS = {
  toshkent: "#f59e0b", buxoro: "#a78bfa", qoqon: "#22d3ee", qarshi: "#f472b6",
  termiz: "#94a3b8", qongirot: "#facc15", boshqa: "#2dd4bf",
};
const SOURCES = { v2: "/assets/railways-v2.geojson", v1: "/assets/railways.geojson" };
const STORE = "nigoh.rails";
const STORE_SRC = "nigoh.rails-src";
const DETAIL_ZOOM = 10;          // shundan boshlab to'liq geometriya
const MINOR_ZOOM = 12;           // sanoat va stansiya yo'llari shundan boshlab

/* Toifa: chizish tartibi (kichigi pastda), qalinlik ulushi, nom. */
const KIND = {
  yard: { rank: 0, scale: 0.5, label: "stansiya yo'llari" },
  industrial: { rank: 1, scale: 0.55, label: "sanoat tarmog'i" },
  other: { rank: 2, scale: 0.8, label: "temir yo'l" },
  branch: { rank: 3, scale: 0.85, label: "tarmoq liniya" },
  main: { rank: 4, scale: 1, label: "asosiy liniya" },
};
const MINOR = new Set(["yard", "industrial"]);

/* Masshtabga qarab qalinlik: uzoqdan ingichka tarmoq, yaqindan aniq yo'l.
   Yaqin masshtabda ingichkaroq: stansiyalarda parallel yo'llar bir-biridan
   bir necha metr naridan o'tadi — qalin chiziqda ular bitta dog'ga qo'shilardi. */
function widthFor(z) {
  return z <= 6 ? 2.2 : z <= 8 ? 2.8 : z <= 10 ? 3.2 : z <= 13 ? 2.8 : z <= 15 ? 3.2 : 4;
}

export class RailLayer {
  constructor() {
    this.map = null;
    this.features = [];
    this.layers = [];             // { glow, casing, core, ties, branch, lod, kind, hs }
    this.shownKey = null;
    this.visible = true;
    this.source = "v2";
    this.token = 0;               // eskirgan yuklashni bekor qilish
    try {
      this.visible = localStorage.getItem(STORE) !== "0";
      this.source = localStorage.getItem(STORE_SRC) === "v1" ? "v1" : "v2";
    } catch (e) { /* xotira yopiq */ }
    const q = new URLSearchParams(location.search).get("rails");
    if (q === "v1" || q === "v2") this.source = q;
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
    $("ml-rail-src").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-src]");
      if (b) this.setSource(b.dataset.src);
    });
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
      if (this.source === "v2") { this.source = "v1"; this.load(); return; }   // v2 yo'q — eskisi
      $("ml-rail-box").hidden = true;          // hech biri yo'q — afsonadan ham olib tashlanadi
      return;
    }
    if (token !== this.token) return;
    this.clear();
    this.features = data;
    data.forEach((f) => this.addFeature(f));
    // Chizish tartibi: kichik toifalar pastda, asosiy tepada.
    this.layers.sort((a, b) => a.rank - b.rank);
    // Eski asset (lod'siz) — bitta daraja.
    this.hasOverview = this.layers.some((l) => l.lod === "overview");
    this.renderLegend();
    this.setVisible(this.visible, true);
  }

  addFeature(f) {
    const lines = f.geometry.coordinates.map((ln) => ln.map(([lng, lat]) => [lat, lng]));
    const p = f.properties;
    const kind = p.kind || "main";
    const color = COLORS[p.branch] || "#94a3b8";
    const minor = MINOR.has(kind);
    const base = { renderer: this.renderer, interactive: false, smoothFactor: 1.2,
                   lineCap: "round", lineJoin: "round" };
    const glow = L.polyline(lines, { ...base, color, opacity: 0.18 });
    const casing = L.polyline(lines, { ...base, color: "#0b1220" });
    const core = L.polyline(lines, { ...base, color, opacity: 1, interactive: !minor, bubblingMouseEvents: false });
    const ties = L.polyline(lines, { ...base, color: "#ffffff", lineCap: "butt", dashArray: "1 9" });
    if (!minor) {
      const elec = p.elec_km != null && p.km ? Math.round((p.elec_km / p.km) * 100) : null;
      core.bindTooltip(
        "<b>" + esc(p.name) + "</b> · " + esc((KIND[kind] || KIND.main).label) + (p.hs ? " · tezyurar" : "") +
        "<br><span>" + Math.round(p.km).toLocaleString("ru-RU") + " km" +
        (elec != null ? " · elektrlashtirilgan " + elec + "%" : "") + "</span>",
        { sticky: true, className: "rail-tip" });
    }
    this.layers.push({ glow, casing, core, ties, branch: p.branch, lod: p.lod || "detail", kind, hs: !!p.hs,
                       rank: (KIND[kind] || KIND.main).rank + (p.hs ? 0.5 : 0) });
  }

  clear() {
    this.layers.forEach((l) => [l.glow, l.casing, l.core, l.ties].forEach((x) => x.remove()));
    this.layers = [];
    this.shownKey = null;
  }

  setSource(src) {
    if (src === this.source) return;
    this.source = src;
    try { localStorage.setItem(STORE_SRC, src); } catch (e) { /* xotira yopiq */ }
    this.load();
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
    this.layers.forEach((l) => [l.glow, l.casing, l.core, l.ties].forEach((x) => x.remove()));
    const on = (l) => l.lod === want && (minor || !MINOR.has(l.kind));
    // Canvas qo'shilish tartibida chizadi: avval hamma nurlar, keyin yostiqlar,
    // chiziqlar, shpallar — bir bo'linmaning nuri boshqasining chizig'ini bosmasin.
    ["glow", "casing", "core", "ties"].forEach((part) =>
      this.layers.forEach((l) => { if (on(l)) l[part].addTo(this.map); }));
  }

  restyle() {
    if (!this.map || !this.layers.length) return;
    this.syncLod();
    const z = this.map.getZoom();
    const dark = document.documentElement.dataset.theme !== "light";
    this.layers.forEach(({ glow, casing, core, ties, kind, hs }) => {
      const w = widthFor(z) * (KIND[kind] || KIND.main).scale;
      // Nur faqat uzoqdan (tarmoq ko'rinishi); yaqindan u yo'llarni qo'shib yuboradi.
      // Tezyurar nuri kuchliroq — butun mamlakat ko'rinishida ajralib turadi.
      glow.setStyle({ weight: w * 3.2 + 4, opacity: z >= 11 ? 0 : (hs ? 0.38 : 0.2) * (dark ? 1 : 0.6) });
      casing.setStyle({ weight: w + (z >= 11 ? 1.6 : 2.4), opacity: dark ? 0.9 : 0.45 });
      core.setStyle({ weight: w });
      if (hs) {
        // Qo'sh yo'l: rangli chiziq ichida uzluksiz oq o'zak.
        ties.setStyle({ weight: Math.max(1, w * 0.34), opacity: z >= 7 ? 0.95 : 0, dashArray: null, lineCap: "round" });
      } else {
        // Shpallar faqat yaqindan: uzoqda chiziqni "iflos" ko'rsatadi.
        ties.setStyle({ weight: Math.max(1, w - 1.6), opacity: z >= 14 && !MINOR.has(kind) ? 0.8 : 0,
                        dashArray: z >= 15 ? "1.5 11" : "1 9", lineCap: "butt" });
      }
    });
  }

  setVisible(on, initial) {
    this.visible = on;
    if (!initial) { try { localStorage.setItem(STORE, on ? "1" : "0"); } catch (e) { /* xotira yopiq */ } }
    $("ml-rail").classList.toggle("on", on);
    $("ml-rail").setAttribute("aria-checked", String(on));
    $("ml-rail-list").hidden = !on;
    $("ml-rail-src").hidden = !on;
    this.shownKey = null;
    if (!on) this.layers.forEach((l) => [l.glow, l.casing, l.core, l.ties].forEach((x) => x.remove()));
    else this.restyle();
  }

  renderLegend() {
    document.querySelectorAll("#ml-rail-src button").forEach((b) =>
      b.classList.toggle("on", b.dataset.src === this.source));
    // Bo'linma bo'yicha jami km (toifalar yig'iladi); kichik bo'linmalar ko'rsatilmaydi.
    const by = new Map();
    this.features.filter((f) => (f.properties.lod || "detail") === "detail").forEach((f) => {
      const p = f.properties;
      const cur = by.get(p.branch) || { name: p.name, km: 0 };
      cur.km += p.km;
      by.set(p.branch, cur);
    });
    const items = [...by.entries()].filter(([, v]) => v.km >= 50).map(([branch, v]) =>
      '<div class="ml-rr"><i style="background:' + (COLORS[branch] || "#94a3b8") + '"></i>' +
      esc(v.name.replace(" MTU", "")) + "</div>");
    if (this.features.some((f) => f.properties.hs)) {
      items.push('<div class="ml-rr hs"><i></i>Tezyurar</div>');
    }
    $("ml-rail-list").innerHTML = items.join("");
  }
}

export const railLayer = new RailLayer();
export function initRailways(map) { railLayer.init(map); }
