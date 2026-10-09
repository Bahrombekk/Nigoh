/* pages/map/MapController.ts — xarita (Leaflet) — v3 map/map.js + tools.js/groups.js ning
   Leaflet qismlari. Figma 02 "Map/Base", "Map/Marker", "Map/Cluster".
   React komponenti (MapPage) uni useEffect ichida yaratadi va destroy() bilan yo'q qiladi.

   Qatlamlar tartibi (Figma): plitkalar → O'zbekiston tashqarisi pardasi → chegara →
   temir yo'l → hudud chegaralari → markerlar/klasterlar.
     * Plitkalar: "Sxema" — OSM (`--map-tiles-filter`), "Gibrid" — Esri World Imagery +
       nomlar qatlami. Ikki qatlam: tashqarisi xira (tiles-out), O'zbekiston bo'yicha
       kesilgan tiniq (tiles-uz, clip-path).
     * Markerlar 28px (holat rangi + kamera ikonkasi), hover 38, tanlangan 40;
       klasterlar 36/48px, uzilganlar qizil nishonda, puls.
     * Qidiruvda mos markerlar "hover" holatida, qolganlari 35% shaffof.

   Tuzoqlar (v3 izohlaridan):
     - Bitta ustundagi kameralar deyarli bir nuqtada: guruhlash hech qachon to'liq
       o'chmaydi — z >= 9 da radius kichrayadi, ustma-ustlar bosilganda yoyiladi.
     - Klaster belgisi o'rtacha nuqtasi O'zbekistondan TASHQARIDA bo'lsagina eng yaqin
       haqiqiy kameraga suriladi (patchClusterPosition, prototipga bir marta).
     - Holat yangilanganda markerlar qayta chizilmaydi — faqat kaliti o'zgarganlar.
     - Lasso paytida xarita surilmaydi (dragging o'chiriladi). */
import L from "./leaflet";
import { ICONS } from "@/components/icons";
import type { Camera, UiStatus } from "@/lib/types";
import { prewarm } from "@/player/player.js";
import { RailLayer, type RailSrc } from "./railways";
import { camStatus, cssColor, hasGeo, norm } from "./util";

export type Base = "scheme" | "hybrid";
export interface LayerState { rail: boolean; regions: boolean; clusters: boolean; base: Base; railSrc: RailSrc }
export const LAYER_DEFAULTS: LayerState = { rail: true, regions: true, clusters: true, base: "scheme", railSrc: "v2" };

export interface MapCallbacks {
  markerClick: (id: number) => void;
  markerHover: (id: number | null) => void;
  mapClick: () => void;
  measureChange: (pts: L.LatLng[]) => void;
  measureEnd: () => void;
  lassoDone: (ids: number[]) => void;
  lassoEnd: () => void;
  railsLoaded: (ok: boolean, source?: RailSrc) => void;
  toast: (text: string, tone: "info" | "error" | "success") => void;
  locateState: (s: "busy" | "on" | "off") => void;
}

/** SVG ikonka satri (Leaflet divIcon uchun) — components/Icon bilan bir xil belgilash. */
export function iconHtml(name: string, size: "xs" | "sm" | "md" | "lg" = "md"): string {
  const d = ICONS[name] || ICONS["circle"];
  const sw = size === "xs" || size === "sm" ? 2 : 1.5;
  return '<svg class="i' + (size === "md" ? "" : " " + size) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + "</svg>";
}

export function uzMaskStyle(): L.PathOptions {
  const m = cssColor("--map-mask", "#2556eb14");
  return { fillColor: m.color, fillOpacity: m.opacity };
}
export function uzBorderStyle(): L.PathOptions {
  return { color: cssColor("--map-region-border", "#3b67f5").color, weight: 2, opacity: 0.9 };
}
function regionStyle(): L.PathOptions {
  const c = cssColor("--map-region-border", "#3b67f5").color;
  return { color: c, weight: 1, opacity: 0.55, dashArray: "4 4", fill: false };
}

/* ---------- Klaster joyi yamog'i (global, bir marta) ---------- */
let uzRingsForPatch: [number, number][][] | null = null;
function insideUz(lat: number, lng: number): boolean {
  const rings = uzRingsForPatch;
  if (!rings) return true;
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [yi, xi] = ring[i], [yj, xj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

interface ClusterInternals {
  _recalculateBounds: () => void;
  _wLatLng?: L.LatLng;
  _latlng: L.LatLng;
  _markers: L.Marker[];
  _childClusters: { _latlng: L.LatLng }[];
}
let patched = false;
function patchClusterPosition() {
  if (patched) return;
  const MC = (L as unknown as { MarkerCluster?: { prototype: ClusterInternals } }).MarkerCluster;
  const P = MC && MC.prototype;
  if (!P || !P._recalculateBounds) return;
  patched = true;
  const orig = P._recalculateBounds;
  P._recalculateBounds = function (this: ClusterInternals) {
    orig.call(this);
    const c = this._wLatLng;
    if (!c || insideUz(c.lat, c.lng)) return;
    let best: L.LatLng | null = null, bestD = Infinity;
    const consider = (ll: L.LatLng | undefined) => {
      if (!ll) return;
      const d = (ll.lat - c.lat) ** 2 + (ll.lng - c.lng) ** 2;
      if (d < bestD) { bestD = d; best = ll; }
    };
    this._markers.forEach((m) => consider(m.getLatLng()));
    this._childClusters.forEach((ch) => consider(ch._latlng));
    if (best) this._latlng = L.latLng((best as L.LatLng).lat, (best as L.LatLng).lng);
  };
}

function inside(lat: number, lng: number, poly: L.LatLng[]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ai = poly[i].lat, bi = poly[i].lng, aj = poly[j].lat, bj = poly[j].lng;
    if ((bi > lng) !== (bj > lng) && lat < ((aj - ai) * (lng - bi)) / (bj - bi) + ai) hit = !hit;
  }
  return hit;
}

function fmtCount(n: number) {
  return n > 999 ? (n / 1000).toFixed(1).replace(".0", "") + "k" : String(n);
}
export function fmtDist(m: number) {
  if (m < 1000) return Math.round(m) + " m";
  return (m / 1000).toFixed(m < 10000 ? 2 : 1).replace(".", ",") + " km";
}

const TILE: Record<Base, { url: string; labels?: string; attribution: string }> = {
  scheme: { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
  hybrid: { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    labels: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri — Esri, Maxar, Earthstar Geographics" },
};

interface CamMarkerOpts extends L.MarkerOptions { camId: number; camStatus: UiStatus; camRegion: string; iconKey: string }
const optsOf = (m: L.Marker) => m.options as CamMarkerOpts;

type Cluster = L.MarkerCluster & { getBounds(): L.LatLngBounds; spiderfy(): void };

export class MapController {
  map: L.Map;
  cb: MapCallbacks;
  t: (s: string) => string;
  base: Base = "scheme";
  tiles: L.TileLayer | null = null;
  tilesUz: L.TileLayer | null = null;
  labels: L.TileLayer | null = null;
  uzMask: L.Polygon | null = null;
  uzBorder: L.Polygon | null = null;
  uzLand: L.Polygon | null = null;
  uzRings: [number, number][][] | null = null;
  regions: L.GeoJSON | null = null;
  regionByName = new Map<string, L.Path>();
  regionsOn: boolean;
  focusRegion: string | null = null;
  rail: RailLayer;
  cluster: L.MarkerClusterGroup;
  plain: L.LayerGroup;
  clustersOn: boolean;
  markersById = new Map<number, L.Marker>();
  byId = new Map<number, Camera>();
  visible: Camera[] = [];
  visibleSig = "";
  selectedId: number | null = null;
  searchIds: Set<number> | null = null;
  hoverId: number | null = null;
  measuring = false;
  measurePts: L.LatLng[] = [];
  measureLayer: L.LayerGroup | null = null;
  lassoOn = false;
  lassoLine: L.Polyline | null = null;
  me: L.LayerGroup | null = null;
  dead = false;
  private cleanups: (() => void)[] = [];

  constructor(el: HTMLElement, opts: { layers: LayerState; t: (s: string) => string; cb: MapCallbacks }) {
    patchClusterPosition();
    this.cb = opts.cb;
    this.t = opts.t;
    const ls = opts.layers;
    const map = this.map = L.map(el, {
      zoomControl: false, attributionControl: false, maxZoom: 19, minZoom: innerWidth < 700 ? 4 : 5,
      maxBounds: [[33.5, 52.0], [49.0, 77.5]], maxBoundsViscosity: 0.8,
      zoomSnap: 0.25, wheelPxPerZoomLevel: 90,
    }).setView([41.35, 64.6], 6);
    this.home();
    L.control.attribution({ position: "bottomleft", prefix: false }).addTo(map);

    map.createPane("uzLand").style.zIndex = "240";     // O'zbekiston quruqligi — tiniq plitkalar ostida
    map.createPane("uzSharp").style.zIndex = "250";    // tilePane (200) va overlayPane (400) orasi
    map.createPane("regions").style.zIndex = "390";    // temir yo'l (380) ustida, parda ostida
    map.createPane("labels").style.zIndex = "395";     // gibrid nomlari
    map.getPane("labels")!.style.pointerEvents = "none";

    map.on("zoomanim", (e) => this.applyUzClip((e as L.ZoomAnimEvent).zoom, (e as L.ZoomAnimEvent).center));
    map.on("zoomend viewreset", () => this.applyUzClip());

    this.loadUzBoundary();
    this.regionsOn = ls.regions !== false;
    this.loadRegions();
    this.rail = new RailLayer(map, { visible: ls.rail !== false, source: ls.railSrc === "v1" ? "v1" : "v2", t: this.t,
      onLoaded: (ok, src) => { if (!this.dead) this.cb.railsLoaded(ok, src); } });

    this.clustersOn = ls.clusters !== false;
    const cluster = this.cluster = L.markerClusterGroup({
      // Radius klaster belgisidan (36 + 6 halqa = 48 px) katta bo'lishi shart: aks holda
      // qo'shni klasterlar ustma-ust tushadi. Yaqinlashganda kichrayadi.
      maxClusterRadius: (z: number) => (z < 10 ? 64 : z < 14 ? 56 : z < 17 ? 44 : 24),
      showCoverageOnHover: false,
      animate: false,
      chunkedLoading: true,
      chunkInterval: 120,
      zoomToBoundsOnClick: false,
      spiderfyDistanceMultiplier: 1.8,
      spiderLegPolylineOptions: { weight: 1.5, color: cssColor("--map-cluster-bg").color, opacity: 0.7 },
      iconCreateFunction: (c) => this.clusterIcon(c),
    });
    this.plain = L.layerGroup();
    map.addLayer(this.clustersOn ? cluster : this.plain);

    /* Klaster bosilganda (Figma): zoom +2. Kameralar bir nuqtada (≤ 40 m) yoki oxirgi
       masshtabda — aylana bo'ylab yoyiladi. */
    cluster.on("clusterclick", (e) => {
      const c = (e as unknown as { layer: Cluster }).layer;
      const b = c.getBounds();
      const tiny = map.distance(b.getSouthWest(), b.getNorthEast()) <= 40;
      if (tiny || map.getZoom() >= map.getMaxZoom() - 1) { c.spiderfy(); return; }
      map.setView(c.getLatLng(), Math.min(map.getZoom() + 2, map.getMaxZoom()));
    });

    this.setBase(ls.base === "hybrid" ? "hybrid" : "scheme");

    // Xarita bosilishi: o'lchash nuqtasi yoki karta yopilishi.
    map.on("click", (e) => {
      if (this.measuring) this.addPoint((e as L.LeafletMouseEvent).latlng);
      else this.cb.mapClick();
    });
    map.on("dblclick", (e) => {
      if (this.measuring) { L.DomEvent.stop(e as unknown as Event); this.cb.measureEnd(); }
    });
    this.bindLasso();
  }

  destroy() {
    this.dead = true;
    this.cleanups.forEach((f) => f());
    this.rail.destroy();
    this.map.remove();
  }

  /* Boshlang'ich ko'rinish: butun O'zbekiston panel va toolbar'dan bo'sh joyda. */
  home(animate?: boolean) {
    const w = innerWidth;
    const panel = w >= 1440 ? 360 : 320;
    const tl: L.PointTuple = w > 640 ? [w >= 1024 ? 88 + panel + 16 : 88, 72] : [8, 64];
    const br: L.PointTuple = w > 640 ? [76, 24] : [8, 136];
    this.map.fitBounds([[37.15, 55.95], [45.6, 73.15]], { paddingTopLeft: tl, paddingBottomRight: br, animate: !!animate });
  }

  /* ---------- Plitkalar ---------- */
  setBase(kind: Base) {
    this.base = kind === "hybrid" ? "hybrid" : "scheme";
    const map = this.map;
    [this.tiles, this.tilesUz, this.labels].forEach((t) => { if (t) map.removeLayer(t); });
    const t = TILE[this.base];
    this.tiles = L.tileLayer(t.url, { attribution: t.attribution, maxZoom: 19, className: "tiles-out" }).addTo(map);
    this.tilesUz = L.tileLayer(t.url, { maxZoom: 19, pane: "uzSharp", className: "tiles-uz" }).addTo(map);
    this.labels = t.labels ? L.tileLayer(t.labels, { maxZoom: 19, pane: "labels", className: "tiles-labels" }).addTo(map) : null;
    map.getContainer().classList.toggle("mp-map--hybrid", this.base === "hybrid");
  }

  /* Tiniq qatlamni O'zbekiston shakli bo'yicha kesadi (clip-path qatlam koordinatalarida;
     zoom animatsiyasida yangi masshtab oldindan hisoblanadi). */
  applyUzClip(zoom?: number, center?: L.LatLng) {
    if (!this.uzRings) return;
    const map = this.map as L.Map & { _latLngToNewLayerPoint: (ll: L.LatLng, z: number, c: L.LatLng) => L.Point };
    const pt = zoom == null
      ? (ll: L.LatLngTuple) => map.latLngToLayerPoint(ll)
      : (ll: L.LatLngTuple) => map._latLngToNewLayerPoint(L.latLng(ll), zoom, center!);
    const d = this.uzRings.map((ring) => "M" + ring.map((ll) => {
      const p = pt(ll);
      return Math.round(p.x) + " " + Math.round(p.y);
    }).join("L") + "Z").join("");
    map.getPane("uzSharp")!.style.clipPath = "path('" + d + "')";
  }

  async loadUzBoundary() {
    try {
      const gj = await (await fetch("/assets/uz.geojson")).json();
      if (this.dead) return;
      const geom = gj.features[0].geometry;
      const polys: [number, number][][][] = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
      const rings = polys.map((p) => p[0].map(([lng, lat]) => [lat, lng] as [number, number]));
      this.uzRings = rings;
      uzRingsForPatch = rings;
      this.cluster.refreshClusters();
      this.applyUzClip();
      const world: L.LatLngTuple[] = [[-89.9, -179.9], [-89.9, 179.9], [89.9, 179.9], [89.9, -179.9]];
      this.uzMask = L.polygon([world, ...rings], { stroke: false, fillRule: "evenodd", interactive: false, ...uzMaskStyle() }).addTo(this.map);
      // Dark: tiniq qatlam "screen" bilan shu fon ustiga tushadi (map.css) — quruqlik Figma rangida.
      this.uzLand = L.polygon(rings, { pane: "uzLand", stroke: false, fillOpacity: 1, interactive: false,
        fillColor: cssColor("--map-base-land", "#f8fafc").color }).addTo(this.map);
      this.uzBorder = L.polygon(rings, { fill: false, interactive: false, ...uzBorderStyle() }).addTo(this.map);
    } catch { /* chegara fayli yuklanmasa — xarita oddiy qoladi */ }
  }

  /* ---------- Hudud chegaralari (viloyatlar) ---------- */
  async loadRegions() {
    try {
      const gj = await (await fetch("/assets/uz_regions.geojson")).json();
      if (this.dead) return;
      this.regionByName = new Map();
      this.regions = L.geoJSON(gj, {
        pane: "regions", interactive: false, style: regionStyle,
        onEachFeature: (f, layer) => this.regionByName.set(norm(f.properties.name), layer as L.Path),
      });
      if (this.regionsOn) this.regions.addTo(this.map);
      this.setFocusRegion(this.focusRegion);
    } catch { /* fayl yo'q — qatlam bo'lmaydi */ }
  }

  setRegionsVisible(on: boolean) {
    this.regionsOn = !!on;
    if (!this.regions) return;
    if (on) this.regions.addTo(this.map); else this.regions.remove();
  }

  /* Tanlangan hudud yengil bo'yaladi (`--map-region-fill`). */
  setFocusRegion(name: string | null) {
    this.focusRegion = name || null;
    if (!this.regions) return;
    const fill = cssColor("--map-region-fill", "#2556eb14");
    const key = name ? norm(name) : null;
    this.regionByName.forEach((layer, k) => {
      const on = key && k === key;
      layer.setStyle({ ...regionStyle(), ...(on
        ? { fill: true, fillColor: fill.color, fillOpacity: fill.opacity, opacity: 0.9, dashArray: undefined, weight: 1.5 }
        : {}) });
    });
  }

  restyle() {
    if (this.uzMask) this.uzMask.setStyle(uzMaskStyle());
    if (this.uzBorder) this.uzBorder.setStyle(uzBorderStyle());
    if (this.uzLand) this.uzLand.setStyle({ fillColor: cssColor("--map-base-land", "#f8fafc").color });
    this.setFocusRegion(this.focusRegion);
    this.cluster.refreshClusters();
    this.rail.restyle();
    this.drawMeasure();
  }

  /* ---------- Markerlar ---------- */
  iconKey(cam: Camera) {
    const ids = this.searchIds;
    return camStatus(cam) + (cam.id === this.selectedId ? "s" : "") + (ids ? (ids.has(cam.id) ? "h" : "d") : "");
  }

  markerIcon(cam: Camera) {
    const st = camStatus(cam);
    const sel = cam.id === this.selectedId;
    const ids = this.searchIds;
    const mode = ids ? (ids.has(cam.id) ? " is-hl" : " is-dim") : "";
    return L.divIcon({
      className: "mp-mk-wrap" + (sel ? " is-sel" : "") + mode,
      html: '<span class="mp-mk" data-status="' + st + '">' + iconHtml(st === "offline" ? "camera-slash" : "camera", "xs") + "</span>",
      iconSize: [44, 44], iconAnchor: [22, 22],
    });
  }

  clusterIcon(c: L.MarkerCluster) {
    const kids = c.getAllChildMarkers();
    const n = kids.length;
    let down = 0, hl = 0;
    const regions = new Map<string, number>();
    const ids = this.searchIds;
    kids.forEach((m) => {
      const o = optsOf(m);
      if (o.camStatus === "offline") down++;
      if (ids && ids.has(o.camId)) hl++;
      regions.set(o.camRegion, (regions.get(o.camRegion) || 0) + 1);
    });
    let region = "", best = 0;
    regions.forEach((v, k) => { if (v > best) { best = v; region = k; } });
    const size = n >= 100 ? 48 : 36;
    const dim = ids && !hl;
    const tip = (region ? region + " · " : "") + n + " kamera" + (down ? ", " + down + " uzilgan" : "");
    return L.divIcon({
      html: '<span class="mp-cl' + (down ? " is-alert" : "") + (dim ? " is-dim" : "") +
        (size === 48 ? " mp-cl--lg" : "") + '" data-tip="' + tip.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;") + '">' +
        (down ? '<span class="mp-cl__halo"></span>' : "") +
        '<span class="mp-cl__n">' + fmtCount(n) + "</span>" +
        (down ? '<span class="mp-cl__badge">' + (down > 99 ? "99+" : down) + "</span>" : "") + "</span>",
      className: "mp-cl-wrap", iconSize: [size + 12, size + 12], iconAnchor: [(size + 12) / 2, (size + 12) / 2],
    });
  }

  get group(): L.LayerGroup { return this.clustersOn ? this.cluster : this.plain; }

  /** Ko'rinadigan kameralar (guruh + holat filtridan o'tgan) — to'plam o'zgarsa qayta quriladi,
      aks holda faqat belgilari yangilanadi. */
  setCameras(visible: Camera[], byId: Map<number, Camera>) {
    this.byId = byId;
    this.visible = visible;
    const geo = visible.filter(hasGeo);
    const sig = geo.map((c) => c.id + ":" + c.lat + "," + c.lng).join("|");
    if (sig !== this.visibleSig) { this.visibleSig = sig; this.rebuildMarkers(); }
    else this.refreshMarkerIcons();
  }

  rebuildMarkers() {
    const cams = this.visible.filter(hasGeo);
    this.markersById.clear();
    const markers = cams.map((cam) => {
      const o: CamMarkerOpts = {
        icon: this.markerIcon(cam), keyboard: false, riseOnHover: true,
        camId: cam.id, camStatus: camStatus(cam), camRegion: cam.region || "",
        iconKey: this.iconKey(cam), zIndexOffset: cam.id === this.selectedId ? 1000 : 0,
      };
      const m = L.marker([cam.lat, cam.lng], o);
      m.on("click", () => this.onMarkerClick(cam.id));
      m.on("mouseover", () => {
        const c = this.byId.get(cam.id) || cam;
        if (camStatus(c) !== "offline") prewarm(c);
        this.cb.markerHover(cam.id);
      });
      m.on("mouseout", () => this.cb.markerHover(null));
      this.markersById.set(cam.id, m);
      return m;
    });
    this.cluster.clearLayers();
    this.plain.clearLayers();
    if (this.clustersOn) this.cluster.addLayers(markers);
    else markers.forEach((m) => this.plain.addLayer(m));
    this.map.getContainer().classList.add("mp-ready");
  }

  onMarkerClick(id: number) {
    const cam = this.byId.get(id);
    if (this.measuring) {
      if (cam && hasGeo(cam)) this.addPoint(L.latLng(cam.lat, cam.lng));
      return;
    }
    this.cb.markerClick(id);
  }

  refreshMarkerIcons() {
    let dirty = false;
    this.markersById.forEach((m, id) => {
      const cam = this.byId.get(id);
      if (!cam) return;
      const o = optsOf(m);
      const key = this.iconKey(cam);
      if (o.iconKey === key) return;
      o.iconKey = key;
      const st = camStatus(cam);
      if (o.camStatus !== st) { o.camStatus = st; dirty = true; }
      m.setZIndexOffset(id === this.selectedId ? 1000 : 0);
      m.setIcon(this.markerIcon(cam));
    });
    if (dirty && this.clustersOn) this.cluster.refreshClusters();
  }

  setSelected(id: number | null) {
    if (id === this.selectedId) return;
    this.selectedId = id;
    this.refreshMarkerIcons();
    this.setHover(this.hoverId);
  }

  setClusters(on: boolean) {
    on = !!on;
    if (on === this.clustersOn) return;
    this.map.removeLayer(this.group);
    this.clustersOn = on;
    this.map.addLayer(this.group);
    this.rebuildMarkers();
  }

  /* Qidiruv: mos markerlar ajratiladi, qolganlari 35%. fit — natijalarga moslash. */
  setSearch(ids: Set<number> | null, fit: boolean, padTL: L.PointTuple) {
    this.searchIds = ids;
    this.refreshMarkerIcons();
    if (this.clustersOn) this.cluster.refreshClusters();
    if (fit && ids && ids.size) this.fitCams([...ids].map((id) => this.byId.get(id)).filter((c): c is Camera => !!c), {}, padTL);
  }

  /* Ro'yxat qatori hover ↔ marker hover (sinxron). */
  setHover(id: number | null) {
    if (this.hoverId != null) {
      const old = this.markersById.get(this.hoverId);
      const el = old?.getElement();
      if (el) el.classList.remove("is-hover");
    }
    this.hoverId = id;
    const m = id != null ? this.markersById.get(id) : null;
    const el = m?.getElement();
    if (el) el.classList.add("is-hover");
  }

  fitCams(cams: Camera[], opts: { zoom?: number; maxZoom?: number } = {}, padTL: L.PointTuple = [88, 16]) {
    const pts = cams.filter((c) => c && hasGeo(c)).map((c) => [c.lat, c.lng] as L.LatLngTuple);
    if (!pts.length) return false;
    if (pts.length === 1) this.map.flyTo(pts[0], Math.max(this.map.getZoom(), opts.zoom || 13), { duration: 0.6 });
    else this.map.flyToBounds(L.latLngBounds(pts).pad(0.25), { duration: 0.6, maxZoom: opts.maxZoom || 13, paddingTopLeft: padTL, paddingBottomRight: [16, 16] });
    return true;
  }

  /* Klaster ichidagi markerni ko'rinadigan qilish (karta ochish uchun). */
  reveal(id: number, cb?: (m: L.Marker | null) => void) {
    const m = this.markersById.get(id);
    if (!m) { cb?.(null); return; }
    if (this.clustersOn && this.cluster.hasLayer(m) && !m.getElement()) {
      // Bir ustundagi (≤ 40 m) kameralar — joyida yoyiladi; aks holda yaqinlashadi.
      const parent = this.cluster.getVisibleParent(m) as unknown as Cluster | null;
      if (parent && (parent as unknown) !== m && parent.spiderfy) {
        const b = parent.getBounds();
        if (this.map.distance(b.getSouthWest(), b.getNorthEast()) <= 40) {
          parent.spiderfy();
          setTimeout(() => cb?.(m), 60);
          return;
        }
      }
      this.cluster.zoomToShowLayer(m, () => cb?.(m));
    } else cb?.(m);
  }

  /* ---------- Joylashuvim ---------- */
  locate() {
    if (!navigator.geolocation) { this.cb.toast("Brauzer joylashuvni aniqlay olmaydi", "error"); return; }
    this.cb.locateState("busy");
    navigator.geolocation.getCurrentPosition((pos) => {
      if (this.dead) return;
      this.cb.locateState("on");
      const ll: L.LatLngTuple = [pos.coords.latitude, pos.coords.longitude];
      if (this.me) this.me.remove();
      const brand = cssColor("--color-bg-brand").color;
      this.me = L.layerGroup([
        L.circle(ll, { radius: Math.min(pos.coords.accuracy || 0, 3000), color: brand, weight: 1, opacity: 0.4, fillOpacity: 0.08, interactive: false }),
        L.marker(ll, { interactive: false, keyboard: false,
          icon: L.divIcon({ className: "mp-me", html: '<span class="mp-me__dot pulse"></span>', iconSize: [24, 24], iconAnchor: [12, 12] }) }),
      ]).addTo(this.map);
      this.map.flyTo(ll, Math.max(this.map.getZoom(), 14), { duration: 0.6 });
    }, (err) => {
      if (this.dead) return;
      this.cb.locateState("off");
      this.cb.toast(err && err.code === 1 ? "Joylashuvga ruxsat berilmagan" : "Joylashuvni aniqlab boʻlmadi", "error");
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  /* ---------- Masofa o'lchash ---------- */
  setMeasure(on: boolean) {
    this.measuring = !!on;
    this.map.getContainer().classList.toggle("mp-measuring", this.measuring);
    if (this.measuring) this.map.doubleClickZoom.disable(); else this.map.doubleClickZoom.enable();
    if (!this.measuring) this.clearMeasure();
  }

  addPoint(ll: L.LatLng) {
    if (!this.measuring) return;
    this.measurePts = [...this.measurePts, ll];
    this.drawMeasure();
  }

  clearMeasure() {
    this.measurePts = [];
    this.drawMeasure();
  }

  measureTotal() {
    let total = 0;
    for (let i = 1; i < this.measurePts.length; i++) total += this.map.distance(this.measurePts[i - 1], this.measurePts[i]);
    return total;
  }

  drawMeasure() {
    if (this.measureLayer) { this.measureLayer.remove(); this.measureLayer = null; }
    this.cb.measureChange(this.measurePts);
    const pts = this.measurePts;
    if (!pts.length) return;
    const c = cssColor("--color-bg-brand").color;
    const halo = cssColor("--map-label-halo", "#ffffff").color;
    const g = this.measureLayer = L.layerGroup().addTo(this.map);
    if (pts.length > 1) {
      L.polyline(pts, { color: halo, weight: 6, opacity: 0.9, interactive: false }).addTo(g);
      L.polyline(pts, { color: c, weight: 3, dashArray: "8 6", interactive: false }).addTo(g);
    }
    pts.forEach((p, i) => {
      L.circleMarker(p, { radius: 5, color: c, weight: 2, fillColor: halo, fillOpacity: 1, interactive: false }).addTo(g);
      if (i > 0) {
        const a = pts[i - 1];
        const mid = L.latLng((a.lat + p.lat) / 2, (a.lng + p.lng) / 2);
        L.tooltip({ permanent: true, direction: "center", className: "mp-measure-tip", interactive: false })
          .setLatLng(mid).setContent(this.t(fmtDist(this.map.distance(a, p)))).addTo(g);
      }
    });
  }

  /* ---------- Xaritada soha chizish (lasso) ---------- */
  setLasso(on: boolean) {
    this.lassoOn = on;
    this.map.getContainer().classList.toggle("lasso", on);
    if (on) this.map.dragging.disable(); else this.map.dragging.enable();
    if (!on && this.lassoLine) { this.map.removeLayer(this.lassoLine); this.lassoLine = null; }
  }

  bindLasso() {
    const map = this.map;
    const el = map.getContainer();
    let pts: L.LatLng[] | null = null;
    let lastPx: [number, number] = [0, 0];
    const color = () => cssColor("--color-bg-brand").color || "#2556eb";
    const down = (e: PointerEvent) => {
      if (!this.lassoOn || e.button > 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
      pts = [map.mouseEventToLatLng(e as unknown as MouseEvent)];
      lastPx = [e.clientX, e.clientY];
      this.lassoLine = L.polyline(pts, { color: color(), weight: 2, dashArray: "6 5", interactive: false }).addTo(map);
    };
    const move = (e: PointerEvent) => {
      if (!pts) return;
      if (Math.hypot(e.clientX - lastPx[0], e.clientY - lastPx[1]) < 5) return;
      lastPx = [e.clientX, e.clientY];
      pts.push(map.mouseEventToLatLng(e as unknown as MouseEvent));
      this.lassoLine?.setLatLngs(pts);
    };
    const up = () => {
      if (!pts) return;
      const poly = pts;
      pts = null;
      this.setLasso(false);
      this.cb.lassoEnd();
      if (poly.length < 3) return;
      const ids = this.visible.filter((c) => hasGeo(c) && inside(c.lat!, c.lng!, poly)).map((c) => c.id);
      const shape = L.polygon(poly, { color: color(), weight: 2, fillOpacity: 0.08, interactive: false }).addTo(map);
      setTimeout(() => { if (!this.dead) map.removeLayer(shape); }, 900);
      this.cb.lassoDone(ids);
    };
    const cancel = () => { pts = null; if (this.lassoOn) { this.setLasso(false); this.cb.lassoEnd(); } };
    el.addEventListener("pointerdown", down, true);
    el.addEventListener("pointermove", move, true);
    el.addEventListener("pointerup", up, true);
    el.addEventListener("pointercancel", cancel, true);
    this.cleanups.push(() => {
      el.removeEventListener("pointerdown", down, true);
      el.removeEventListener("pointermove", move, true);
      el.removeEventListener("pointerup", up, true);
      el.removeEventListener("pointercancel", cancel, true);
    });
  }
}
