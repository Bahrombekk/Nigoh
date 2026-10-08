/* ==========================================================================
   map/map.js — xarita (Leaflet) — Figma 02 "Map/Base", "Map/Marker", "Map/Cluster"
   --------------------------------------------------------------------------
   Vazifasi:
     Rail ostida butun ekran Leaflet xaritasi. Qatlamlar tartibi (Figma):
     plitkalar → O'zbekiston tashqarisi pardasi → chegara → temir yo'l →
     hudud chegaralari → markerlar/klasterlar.
       * Plitkalar: "Sxema" — OSM (mavzuga `--map-tiles-filter` bilan bo'yaladi),
         "Gibrid" — Esri World Imagery + nomlar qatlami. Ikki qatlam: tashqarisi
         xira (tiles-out), O'zbekiston bo'yicha kesilgan tiniq (tiles-uz).
       * Parda `--map-mask`, chegara va viloyatlar `--map-region-border`.
       * Markerlar 28px (holat rangi + kamera ikonkasi), hover 38, tanlangan 40
         + brand halqa; klasterlar 36/48px, uzilganlar qizil nishonda, puls.
       * Qidiruvda mos markerlar "hover" holatida, qolganlari 35% shaffof.

   Eksport:
     MapView, mapView, map (L.Map)
     tiles, uzMask, uzBorder — JONLI eksport (eski API)
     setTiles(), uzMaskStyle(), uzBorderStyle()
     visibleCams()         — guruh va holat filtridan o'tgan kameralar (xarita + ro'yxat)
     hasGeo(cam)           — ./util.js dan qayta eksport
     rebuildMarkers()      — markerlarni to'liq qayta qurish
     refreshMarkerIcons()  — faqat holati/tanlovi/qidiruvi o'zgarganlarni yangilash
     layerState            — joriy qatlam tanlovi (prefs "layers" bilan)

   Bog'liqliklar:
     import: ../core/state.js, ../core/prefs.js, ../core/icons.js, ../player/player.js (prewarm),
             ./railways.js, ./util.js, ./selection.js (openCard — marker bosilganda)
     global: L (Leaflet 1.9 + markercluster 1.5 — index.html da CDN dan)
   DOM: #map, #map-view (klasslar: mp-stale)
   Backend: /assets/uz.geojson, /assets/uz_regions.geojson; plitkalar OSM / Esri

   Qoidalar / tuzoqlar:
     - Xarita modul yuklanishida yaratiladi (L.map("map")) — #map va Leaflet
       main.js dan OLDIN yuklangan bo'lishi shart.
     - Bitta ustundagi kameralar (".. (2)") deyarli bir nuqtada: guruhlash hech
       qachon to'liq o'chmaydi — z ≥ 9 da radius kichrayadi, ustma-ustlar
       bosilganda yoyiladi (spiderfy). "Kamera klasterlari" o'chirilsa —
       oddiy qatlam (klastersiz).
     - markercluster prototipiga yamoq (patchClusterPosition) global — bir marta.
     - Xaritaga "click" ni (joy tanlash) admin/camera-form.js ham ulaydi.
   ========================================================================== */
import { $, state } from "../core/state.js";
import { prefs } from "../core/prefs.js";
import { icon } from "../core/icons.js";
import { prewarm } from "../player/player.js";
import { initRailways } from "./railways.js";
import { camStatus, cssColor, hasGeo, norm } from "./util.js";
import { openCard } from "./selection.js";

export { hasGeo };

export let tiles = null;
export let uzMask = null;
export let uzBorder = null;

/* Qatlam tanlovi — foydalanuvchi bo'yicha (prefs "layers"). */
export const layerState = Object.assign(
  { rail: true, regions: true, clusters: true, base: "scheme", railSrc: "v2" },
  prefs.get("layers", {}) || {});

export function uzMaskStyle() {
  const m = cssColor("--map-mask", "#2556eb14");
  return { fillColor: m.color, fillOpacity: m.opacity };
}
export function uzBorderStyle() {
  return { color: cssColor("--map-region-border", "#3b67f5").color, weight: 2, opacity: 0.9 };
}
function regionStyle() {
  const c = cssColor("--map-region-border", "#3b67f5").color;
  return { color: c, weight: 1, opacity: 0.55, dashArray: "4 4", fill: false };
}

/* Klaster belgisi kameralarning O'RTACHA nuqtasiga qo'yiladi — egri chiziqda
   tizilganda u chegaradan tashqariga tushib qoladi. Belgi o'rtachaga eng yaqin
   HAQIQIY kamera (yoki ichki klaster) joyiga suriladi. */
/* Faqat o'rtacha nuqta O'zbekistondan TASHQARIDA bo'lsa suriladi: aks holda
   har klasterni eng yaqin kameraga tortish qo'shni klasterlarni bir-biriga
   yaqinlashtirib, belgilar ustma-ust tushardi (Samarqand: "4" va "7"). */
let uzRingsForPatch = null;
function insideUz(lat, lng) {
  const rings = uzRingsForPatch;
  if (!rings) return true;
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [yi, xi] = ring[i], [yj, xj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function patchClusterPosition() {
  const P = L.MarkerCluster && L.MarkerCluster.prototype;
  if (!P || !P._recalculateBounds) return;
  const orig = P._recalculateBounds;
  P._recalculateBounds = function () {
    orig.call(this);
    const c = this._wLatLng;
    if (!c || insideUz(c.lat, c.lng)) return;
    let best = null, bestD = Infinity;
    const consider = (ll) => {
      if (!ll) return;
      const d = (ll.lat - c.lat) ** 2 + (ll.lng - c.lng) ** 2;
      if (d < bestD) { bestD = d; best = ll; }
    };
    this._markers.forEach((m) => consider(m.getLatLng()));
    this._childClusters.forEach((ch) => consider(ch._latlng));
    if (best) this._latlng = L.latLng(best.lat, best.lng);
  };
}

export function visibleCams() {
  const group = state.groupMembers;
  const f = state.filters;
  return state.cameras.filter((c) => {
    if (group && !group.has(c.id)) return false;
    if (f && f.size && !f.has(camStatus(c))) return false;
    return true;
  });
}

/* Ikonka "kaliti": holat + tanlanganlik + qidiruv rejimi. O'zgarmasa DOM'ga tegilmaydi. */
function iconKey(cam, view) {
  const ids = view.searchIds;
  return camStatus(cam) + (cam.id === state.selectedId ? "s" : "") +
    (ids ? (ids.has(cam.id) ? "h" : "d") : "");
}

function fmtCount(n) {
  return n > 999 ? (n / 1000).toFixed(1).replace(".0", "") + "k" : String(n);
}

const TILE = {
  scheme: { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
  hybrid: { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            labels: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
            attribution: "Tiles &copy; Esri — Esri, Maxar, Earthstar Geographics" },
};

/* ---------- Xarita ---------- */
export class MapView {
  constructor() {
    const map = this.map = L.map("map", {
      zoomControl: false, attributionControl: false, maxZoom: 19, minZoom: innerWidth < 700 ? 4 : 5,
      maxBounds: [[33.5, 52.0], [49.0, 77.5]], maxBoundsViscosity: 0.8,
      zoomSnap: 0.25, wheelPxPerZoomLevel: 90,
    }).setView([41.35, 64.6], 6);
    this.home();
    L.control.attribution({ position: "bottomleft", prefix: false }).addTo(map);

    map.createPane("uzLand").style.zIndex = 240;      // O'zbekiston quruqligi (--map-base-land) — tiniq plitkalar ostida
    map.createPane("uzSharp").style.zIndex = 250;     // tilePane (200) va overlayPane (400) orasi
    map.createPane("regions").style.zIndex = 390;     // temir yo'l (380) ustida, parda ostida
    map.createPane("labels").style.zIndex = 395;      // gibrid nomlari
    map.getPane("labels").style.pointerEvents = "none";
    this.tiles = null; this.tilesUz = null; this.labels = null;
    // Gibrid — faqat server CSP Esri plitkalariga ruxsat bersa (layers.js tekshiradi).
    this.base = "scheme";

    map.on("zoomanim", (e) => this.applyUzClip(e.zoom, e.center));
    map.on("zoomend viewreset", () => this.applyUzClip());

    this.uzMask = null; this.uzBorder = null; this.uzRings = null;
    this.loadUzBoundary();
    this.regions = null; this.regionsOn = layerState.regions !== false;
    this.focusRegion = null;
    this.loadRegions();
    initRailways(map, { visible: layerState.rail !== false, source: layerState.railSrc === "v1" ? "v1" : "v2" });

    this.searchIds = null;      // qidiruvga mos kameralar (Set) — null: qidiruv yo'q
    this.markersById = new Map();
    this.clustersOn = layerState.clusters !== false;

    const cluster = this.cluster = L.markerClusterGroup({
      // Radius klaster belgisidan (36 px + 6 px halqa = 48 px) katta bo'lishi
      // shart: aks holda qo'shni klasterlar bir-birining ustiga tushadi (ikkita
      // "4" Samarqand yonida ustma-ust chiqardi). Yaqinlashganda kichrayadi —
      // oxirida faqat bitta ustundagi kameralar birga qoladi.
      maxClusterRadius: (z) => (z < 10 ? 64 : z < 14 ? 56 : z < 17 ? 44 : 24),
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

    /* Klaster bosilganda (Figma): zoom +2. Kameralar bir nuqtada (≤ 40 m)
       yoki oxirgi masshtabda bo'lsa — aylana bo'ylab yoyiladi. */
    cluster.on("clusterclick", (e) => {
      const c = e.layer;
      const b = c.getBounds();
      const tiny = map.distance(b.getSouthWest(), b.getNorthEast()) <= 40;
      if (tiny || map.getZoom() >= map.getMaxZoom() - 1) { c.spiderfy(); return; }
      map.setView(c.getLatLng(), Math.min(map.getZoom() + 2, map.getMaxZoom()));
    });

    this.setBase(this.base);
    document.addEventListener("theme:changed", () => this.restyle());
  }

  /* Boshlang'ich ko'rinish: butun O'zbekiston panel va toolbar'dan bo'sh joyda. */
  home(animate) {
    const w = innerWidth;
    const panel = w >= 1440 ? 360 : 320;
    const tl = w > 640 ? [w >= 1024 ? 88 + panel + 16 : 88, 72] : [8, 64];
    const br = w > 640 ? [76, 24] : [8, 136];
    this.map.fitBounds([[37.15, 55.95], [45.6, 73.15]], { paddingTopLeft: tl, paddingBottomRight: br, animate: !!animate });
  }

  /* ---------- Plitkalar ---------- */
  setBase(kind) {
    this.base = kind === "hybrid" ? "hybrid" : "scheme";
    const map = this.map;
    [this.tiles, this.tilesUz, this.labels].forEach((t) => { if (t) map.removeLayer(t); });
    const t = TILE[this.base];
    tiles = this.tiles = L.tileLayer(t.url, { attribution: t.attribution, maxZoom: 19, className: "tiles-out" }).addTo(map);
    this.tilesUz = L.tileLayer(t.url, { maxZoom: 19, pane: "uzSharp", className: "tiles-uz" }).addTo(map);
    this.labels = t.labels ? L.tileLayer(t.labels, { maxZoom: 19, pane: "labels", className: "tiles-labels" }).addTo(map) : null;
    map.getContainer().classList.toggle("mp-map--hybrid", this.base === "hybrid");
  }

  /* Tiniq qatlamni O'zbekiston shakli bo'yicha kesadi (clip-path qatlam
     koordinatalarida; zoom animatsiyasida yangi masshtab oldindan hisoblanadi). */
  applyUzClip(zoom, center) {
    if (!this.uzRings) return;
    const map = this.map;
    const pt = zoom == null
      ? (ll) => map.latLngToLayerPoint(ll)
      : (ll) => map._latLngToNewLayerPoint(L.latLng(ll), zoom, center);
    const d = this.uzRings.map((ring) => "M" + ring.map((ll) => {
      const p = pt(ll);
      return Math.round(p.x) + " " + Math.round(p.y);
    }).join("L") + "Z").join("");
    map.getPane("uzSharp").style.clipPath = "path('" + d + "')";
  }

  async loadUzBoundary() {
    try {
      const gj = await (await fetch("/assets/uz.geojson")).json();
      const geom = gj.features[0].geometry;
      const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
      const rings = polys.map((p) => p[0].map(([lng, lat]) => [lat, lng]));
      this.uzRings = rings;
      uzRingsForPatch = rings;
      if (this.cluster && this.cluster.refreshClusters) this.cluster.refreshClusters();
      this.applyUzClip();
      const world = [[-89.9, -179.9], [-89.9, 179.9], [89.9, 179.9], [89.9, -179.9]];
      uzMask = this.uzMask = L.polygon([world, ...rings], Object.assign({
        stroke: false, fillRule: "evenodd", interactive: false }, uzMaskStyle())).addTo(this.map);
      // Dark: tiniq qatlam "screen" bilan shu fon ustiga tushadi (map.css) — quruqlik
      // Figma'dagidek --map-base-land, qora emas.
      this.uzLand = L.polygon(rings, { pane: "uzLand", stroke: false, fillOpacity: 1, interactive: false,
        fillColor: cssColor("--map-base-land", "#f8fafc").color }).addTo(this.map);
      uzBorder = this.uzBorder = L.polygon(rings, Object.assign({
        fill: false, interactive: false }, uzBorderStyle())).addTo(this.map);
    } catch (e) { /* chegara fayli yuklanmasa — xarita oddiy qoladi */ }
  }

  /* ---------- Hudud chegaralari (viloyatlar) ---------- */
  async loadRegions() {
    try {
      const gj = await (await fetch("/assets/uz_regions.geojson")).json();
      this.regionByName = new Map();
      this.regions = L.geoJSON(gj, {
        pane: "regions", interactive: false, style: regionStyle,
        onEachFeature: (f, layer) => this.regionByName.set(norm(f.properties.name), layer),
      });
      if (this.regionsOn) this.regions.addTo(this.map);
      this.setFocusRegion(this.focusRegion);
    } catch (e) { /* fayl yo'q — qatlam bo'lmaydi */ }
  }

  setRegionsVisible(on) {
    this.regionsOn = !!on;
    if (!this.regions) return;
    if (on) this.regions.addTo(this.map); else this.regions.remove();
  }

  /* Tanlangan hudud yengil bo'yaladi (`--map-region-fill`). */
  setFocusRegion(name) {
    this.focusRegion = name || null;
    if (!this.regions) return;
    const fill = cssColor("--map-region-fill", "#2556eb14");
    const key = name ? norm(name) : null;
    this.regionByName.forEach((layer, k) => {
      const on = key && k === key;
      layer.setStyle(Object.assign(regionStyle(), on
        ? { fill: true, fillColor: fill.color, fillOpacity: fill.opacity, opacity: 0.9, dashArray: null, weight: 1.5 }
        : {}));
    });
  }

  restyle() {
    if (this.uzMask) this.uzMask.setStyle(uzMaskStyle());
    if (this.uzBorder) this.uzBorder.setStyle(uzBorderStyle());
    if (this.uzLand) this.uzLand.setStyle({ fillColor: cssColor("--map-base-land", "#f8fafc").color });
    this.setFocusRegion(this.focusRegion);
    if (this.cluster.refreshClusters) this.cluster.refreshClusters();
  }

  /* ---------- Markerlar ---------- */
  markerIcon(cam) {
    const st = camStatus(cam);
    const sel = cam.id === state.selectedId;
    const ids = this.searchIds;
    const mode = ids ? (ids.has(cam.id) ? " is-hl" : " is-dim") : "";
    return L.divIcon({
      className: "mp-mk-wrap" + (sel ? " is-sel" : "") + mode,
      html: '<span class="mp-mk" data-status="' + st + '">' +
            icon(st === "offline" ? "camera-slash" : "camera", "xs") + "</span>",
      iconSize: [44, 44], iconAnchor: [22, 22],
    });
  }

  clusterIcon(c) {
    const kids = c.getAllChildMarkers();
    const n = kids.length;
    let down = 0, hl = 0;
    const regions = new Map();
    const ids = this.searchIds;
    kids.forEach((m) => {
      const o = m.options;
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
              (size === 48 ? " mp-cl--lg" : "") + '" data-tip="' + tip.replace(/"/g, "&quot;") + '">' +
            (down ? '<span class="mp-cl__halo"></span>' : "") +
            '<span class="mp-cl__n">' + fmtCount(n) + "</span>" +
            (down ? '<span class="mp-cl__badge">' + (down > 99 ? "99+" : down) + "</span>" : "") + "</span>",
      className: "mp-cl-wrap", iconSize: [size + 12, size + 12], iconAnchor: [(size + 12) / 2, (size + 12) / 2],
    });
  }

  get group() { return this.clustersOn ? this.cluster : this.plain; }

  rebuildMarkers() {
    const cams = visibleCams().filter(hasGeo);
    this.markersById.clear();
    const markers = cams.map((cam) => {
      const m = L.marker([cam.lat, cam.lng], {
        icon: this.markerIcon(cam), keyboard: false, riseOnHover: true,
        camId: cam.id, camStatus: camStatus(cam), camRegion: cam.region || "",
        iconKey: iconKey(cam, this), zIndexOffset: cam.id === state.selectedId ? 1000 : 0,
      });
      m.on("click", () => openCard(cam.id));
      m.on("mouseover", () => {
        if (camStatus(cam) !== "offline") prewarm(cam);
        document.dispatchEvent(new CustomEvent("map:hover", { detail: { id: cam.id } }));
      });
      m.on("mouseout", () => document.dispatchEvent(new CustomEvent("map:hover", { detail: { id: null } })));
      this.markersById.set(cam.id, m);
      return m;
    });
    this.cluster.clearLayers();
    this.plain.clearLayers();
    if (this.clustersOn) this.cluster.addLayers(markers);
    else markers.forEach((m) => this.plain.addLayer(m));
    this.map.getContainer().classList.add("mp-ready");
  }

  /* Holat yangilanganda markerlar qayta chizilmaydi — faqat kaliti
     o'zgarganlarning belgisi almashadi. */
  refreshMarkerIcons() {
    let dirty = false;
    this.markersById.forEach((m, id) => {
      const cam = state.byId.get(id);
      if (!cam) return;
      const key = iconKey(cam, this);
      if (m.options.iconKey === key) return;
      m.options.iconKey = key;
      const st = camStatus(cam);
      if (m.options.camStatus !== st) { m.options.camStatus = st; dirty = true; }
      m.setZIndexOffset(id === state.selectedId ? 1000 : 0);
      m.setIcon(this.markerIcon(cam));
    });
    if (dirty && this.clustersOn && this.cluster.refreshClusters) this.cluster.refreshClusters();
  }

  setClusters(on) {
    on = !!on;
    if (on === this.clustersOn) return;
    this.map.removeLayer(this.group);
    this.clustersOn = on;
    this.map.addLayer(this.group);
    this.rebuildMarkers();
  }

  /* Qidiruv: mos markerlar ajratiladi, qolganlari 35%. fit — natijalarga moslash. */
  setSearch(ids, fit) {
    this.searchIds = ids;
    this.refreshMarkerIcons();
    if (this.clustersOn && this.cluster.refreshClusters) this.cluster.refreshClusters();
    if (fit && ids && ids.size) this.fitCams([...ids].map((id) => state.byId.get(id)).filter(Boolean));
  }

  /* Ro'yxat qatori hover ↔ marker hover (sinxron). */
  setHover(id) {
    if (this.hoverId != null) {
      const old = this.markersById.get(this.hoverId);
      if (old && old._icon) old._icon.classList.remove("is-hover");
    }
    this.hoverId = id;
    const m = id != null && this.markersById.get(id);
    if (m && m._icon) m._icon.classList.add("is-hover");
  }

  fitCams(cams, opts = {}) {
    const pts = cams.filter((c) => c && hasGeo(c)).map((c) => [c.lat, c.lng]);
    if (!pts.length) return false;
    if (pts.length === 1) this.map.flyTo(pts[0], Math.max(this.map.getZoom(), opts.zoom || 13), { duration: 0.6 });
    else this.map.flyToBounds(L.latLngBounds(pts).pad(0.25), { duration: 0.6, maxZoom: opts.maxZoom || 13, paddingTopLeft: this.padTL(), paddingBottomRight: [16, 16] });
    return true;
  }

  /* Panel ochiq bo'lsa natija uning ostida qolmasin. */
  padTL() {
    const panel = $("mp-panel");
    const w = panel && !panel.hidden && window.innerWidth >= 1024 && !document.getElementById("map-view").classList.contains("mp-collapsed")
      ? panel.getBoundingClientRect().right + 16 : 88;
    return [w, 16];
  }

  /* Klaster ichidagi markerni ko'rinadigan qilish (karta ochish uchun). */
  reveal(id, cb) {
    const m = this.markersById.get(id);
    if (!m) { cb && cb(null); return; }
    if (this.clustersOn && this.cluster.hasLayer(m) && !m._icon) {
      // Bir ustundagi (≤ 40 m) kameralar — joyida yoyiladi; aks holda yaqinlashadi.
      const parent = this.cluster.getVisibleParent(m);
      if (parent && parent !== m && parent.spiderfy) {
        const b = parent.getBounds();
        if (this.map.distance(b.getSouthWest(), b.getNorthEast()) <= 40) {
          parent.spiderfy();
          setTimeout(() => cb && cb(m), 60);
          return;
        }
      }
      this.cluster.zoomToShowLayer(m, () => cb && cb(m));
    } else cb && cb(m);
  }

  setStale(on) {
    $("map-view").classList.toggle("mp-stale", !!on);
  }
}

patchClusterPosition();

export const mapView = new MapView();
export const map = mapView.map;

export function setTiles() { mapView.setBase(mapView.base); }
export function rebuildMarkers() { mapView.rebuildMarkers(); }
export function refreshMarkerIcons() { mapView.refreshMarkerIcons(); }
