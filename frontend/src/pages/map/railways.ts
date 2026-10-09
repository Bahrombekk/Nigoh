/* pages/map/railways.ts — temir yo'l tarmog'i qatlami (v3 map/railways.js dan).
   Manba: v2 (standart, "Yangi · OSM") — /assets/railways-v2.geojson; v1 ("Eski") —
   /assets/railways.geojson; v2 yuklanmasa avtomatik v1. Ikki daraja aniqlik: uzoqdan
   (z < DETAIL_ZOOM) "overview", yaqindan "detail"; sanoat va stansiya yo'llari z >= MINOR_ZOOM.
   Ko'rinish: `--map-line-rail` (3px) + yostiq `--map-line-rail-casing` + shpallar
   `--map-line-rail-tie`; ranglar mavzu almashganda qayta o'qiladi (restyle).
   Canvas renderer — yuz minglab nuqta SVG'da xaritani sekinlashtirardi.
   ?rails=v1|v2 manzil parametri manbani bir martalik bekor qiladi. */
import L from "./leaflet";
import { cssColor } from "./util";

const SOURCES = { v2: "/assets/railways-v2.geojson", v1: "/assets/railways.geojson" } as const;
export type RailSrc = keyof typeof SOURCES;
const DETAIL_ZOOM = 10;
const MINOR_ZOOM = 12;

const KIND: Record<string, { rank: number; scale: number; label: string }> = {
  yard: { rank: 0, scale: 0.55, label: "stansiya yoʻllari" },
  industrial: { rank: 1, scale: 0.6, label: "sanoat tarmogʻi" },
  other: { rank: 2, scale: 0.8, label: "temir yoʻl" },
  branch: { rank: 3, scale: 0.85, label: "tarmoq liniya" },
  main: { rank: 4, scale: 1, label: "asosiy liniya" },
};
const MINOR = new Set(["yard", "industrial"]);

function widthFor(z: number) {
  return z <= 6 ? 2.2 : z <= 8 ? 2.6 : z <= 14 ? 3 : 4;
}

interface RailPart { casing: L.Polyline; core: L.Polyline; ties: L.Polyline; lod: string; kind: string; hs: boolean; rank: number }
interface RailFeature {
  geometry: { coordinates: [number, number][][] };
  properties?: { kind?: string; name?: string; km?: number; elec_km?: number; hs?: boolean; lod?: string };
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export class RailLayer {
  map: L.Map;
  layers: RailPart[] = [];
  shownKey: string | null = null;
  visible = true;
  source: RailSrc = "v2";
  available = true;
  hasOverview = false;
  token = 0;
  forced: RailSrc | null;
  renderer: L.Canvas;
  t: (s: string) => string;
  onLoaded: (ok: boolean, source?: RailSrc) => void;
  private onZoom = () => this.restyle();

  constructor(map: L.Map, opts: { visible: boolean; source: RailSrc; t: (s: string) => string; onLoaded: (ok: boolean, source?: RailSrc) => void }) {
    this.map = map;
    this.t = opts.t;
    this.onLoaded = opts.onLoaded;
    const q = new URLSearchParams(location.search).get("rails") || new URLSearchParams(location.hash.split("?")[1] || "").get("rails");
    this.forced = q === "v1" || q === "v2" ? q : null;
    this.source = this.forced || opts.source;
    this.visible = opts.visible;
    // Plitkalar (200) va tiniq O'zbekiston qatlami (250) ustida, parda va chegara (400) ostida.
    map.createPane("rails").style.zIndex = "380";
    this.renderer = L.canvas({ pane: "rails", padding: 0.4, tolerance: 6 });
    map.on("zoomend", this.onZoom);
    this.load();
  }

  destroy() {
    this.token++;
    this.map.off("zoomend", this.onZoom);
    this.clear();
  }

  async load() {
    const token = ++this.token;
    let data: RailFeature[];
    try {
      const res = await fetch(SOURCES[this.source]);
      if (!res.ok) throw new Error(String(res.status));
      data = (await res.json()).features;
    } catch {
      if (token !== this.token) return;
      if (this.source === "v2") { this.source = "v1"; this.load(); return; }
      this.available = false;
      this.onLoaded(false);
      return;
    }
    if (token !== this.token) return;
    this.clear();
    data.forEach((f) => this.addFeature(f));
    this.layers.sort((a, b) => a.rank - b.rank);
    this.hasOverview = this.layers.some((l) => l.lod === "overview");
    this.available = true;
    this.setVisible(this.visible);
    this.onLoaded(true, this.source);
  }

  addFeature(f: RailFeature) {
    const lines = f.geometry.coordinates.map((ln) => ln.map(([lng, lat]) => [lat, lng] as L.LatLngTuple));
    const p = f.properties || {};
    const kind = p.kind || "main";
    const minor = MINOR.has(kind);
    const base: L.PolylineOptions = { renderer: this.renderer, interactive: false, smoothFactor: 1.2, lineCap: "round", lineJoin: "round" };
    const casing = L.polyline(lines, { ...base });
    // Bosish xaritaga o'tadi (bubbling): masofa o'lchash yo'l ustida ham ishlaydi.
    const core = L.polyline(lines, { ...base, interactive: !minor, bubblingMouseEvents: true });
    const ties = L.polyline(lines, { ...base, lineCap: "butt" });
    if (!minor && p.name) {
      const t = this.t;
      const elec = p.elec_km != null && p.km ? Math.round((p.elec_km / p.km) * 100) : null;
      const head = " · " + (KIND[kind] || KIND.main).label + (p.hs ? " · tezyurar" : "");
      const sub = p.km ? Math.round(p.km).toLocaleString("ru-RU") + " km" + (elec != null ? " · elektrlashtirilgan " + elec + "%" : "") : "";
      // Matn tugunlari v3 dagidek tarjima qilinadi (nom — ma'lumot, tarjima qilinmaydi).
      core.bindTooltip(() => "<b>" + escHtml(p.name!) + "</b>" + escHtml(t(head)) +
        (sub ? "<br><span>" + escHtml(t(sub)) + "</span>" : ""), { sticky: true, className: "mp-rail-tip" });
    }
    this.layers.push({ casing, core, ties, lod: p.lod || "detail", kind, hs: !!p.hs,
      rank: (KIND[kind] || KIND.main).rank + (p.hs ? 0.5 : 0) });
  }

  parts(l: RailPart) { return [l.casing, l.core, l.ties]; }

  clear() {
    this.layers.forEach((l) => this.parts(l).forEach((x) => x.remove()));
    this.layers = [];
    this.shownKey = null;
  }

  setSource(src: RailSrc) {
    if (src !== "v1" && src !== "v2") return;
    this.forced = null;
    if (src === this.source) return;
    this.source = src;
    this.load();
  }

  syncLod() {
    if (!this.visible) return;
    const z = this.map.getZoom();
    const want = this.hasOverview && z < DETAIL_ZOOM ? "overview" : "detail";
    const minor = z >= MINOR_ZOOM;
    const key = want + (minor ? "+minor" : "");
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.layers.forEach((l) => this.parts(l).forEach((x) => x.remove()));
    const on = (l: RailPart) => l.lod === want && (minor || !MINOR.has(l.kind));
    // Canvas qo'shilish tartibida chizadi: avval yostiqlar, keyin chiziqlar, shpallar.
    (["casing", "core", "ties"] as const).forEach((part) =>
      this.layers.forEach((l) => { if (on(l)) l[part].addTo(this.map); }));
  }

  restyle() {
    if (!this.layers.length || !this.visible) return;
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
        ties.setStyle({ color: tie.color, weight: Math.max(0.8, w * 0.34), opacity: z >= 7 ? 0.95 : 0,
          dashArray: undefined, lineCap: "round" });
      } else {
        ties.setStyle({ color: tie.color, weight: Math.max(1, w - 1), lineCap: "butt",
          opacity: z >= 8 && !MINOR.has(kind) ? 0.85 : 0, dashArray: z >= 14 ? "1.5 10" : "1 8" });
      }
    });
  }

  setVisible(on: boolean) {
    this.visible = !!on;
    this.shownKey = null;
    if (!this.visible) this.layers.forEach((l) => this.parts(l).forEach((x) => x.remove()));
    else this.restyle();
  }
}
