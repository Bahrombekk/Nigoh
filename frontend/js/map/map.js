/* ==========================================================================
   map/map.js — xarita (Leaflet)
   --------------------------------------------------------------------------
   Vazifasi:
     Leaflet xaritasi: OSM plitkalari (ikki qatlam — xira tashqi va O'zbekiston
     bo'yicha kesilgan tiniq), chegara va tashqi parda, kamera markerlari va
     klasterlar, xarita boshqaruv tugmalari (zoom, hammasini ko'rsatish,
     to'liq ekran).

   Eksport:
     MapView               — klass: xarita, qatlamlar, markerlar, klasterlar
     mapView               — yagona nusxa
     map                   — Leaflet L.Map obyekti (mapView.map) — boshqa modullar flyTo/fitBounds qiladi
     tiles, uzMask, uzBorder — JONLI eksport (let): mavzu almashganda theme.js o'qiydi
     setTiles()            — plitka qatlamlarini (qayta) yaratish
     uzMaskStyle()         — tashqi parda uslubi (mavzuga qarab)
     uzBorderStyle()       — chegara chizig'i uslubi (--accent rangi)
     visibleCams()         — joriy filtr va qidiruvdan o'tgan kameralar
     hasGeo(cam)           — kamerada haqiqiy koordinata bormi (0/0 emas)
     rebuildMarkers()      — markerlarni to'liq qayta qurish
     refreshMarkerIcons()  — faqat holati/tanlovi o'zgargan markerlar ikonkasini almashtirish

   Bog'liqliklar:
     import: ../core/state.js ($, state), ../player/player.js (prewarm),
             ../map/selection.js (selectCamera)
     global: L (Leaflet 1.9 + Leaflet.markercluster 1.5 — index.html da CDN dan)

   DOM: #map, #z-in, #z-out, #fit-all, #map-fs, #map-card
   Backend: GET /assets/uz.geojson (statik fayl, kirish talab qilmaydi);
            plitkalar: tile.openstreetmap.org

   Qoidalar / tuzoqlar:
     - Xarita modul yuklanishida yaratiladi (L.map("map")) — #map elementi va
       Leaflet skripti main.js dan OLDIN yuklangan bo'lishi shart (index.html).
     - Plitka qatlami bu yerda emas, birinchi setTheme chaqiruvida qo'shiladi.
     - Xaritaga "click" hodisasini (joy tanlash) camera-form.js ulaydi —
       main.js dan, hamma modul yuklangandan keyin (aylanma import tufayli).
     - tiles/uzMask/uzBorder ham klass maydonida, ham jonli eksportda turadi;
       ular faqat shu fayldagi bitta joyda birga yoziladi.
     - markercluster prototipiga yamoq (patchClusterPosition) global — bir marta.
   ========================================================================== */
import { $, state } from "../core/state.js";
import { prewarm } from "../player/player.js";
import { selectCamera } from "./selection.js";

/* Jonli eksportlar — theme.js mavzu almashganda o'qiydi. Qiymati MapView
   maydonlari bilan birga yoziladi. */
export let tiles = null;
export let uzMask = null;
export let uzBorder = null;

/* O'zbekiston hududini ajratib ko'rsatish: chegara urg'u rangida chiziladi,
   tashqi hududlar esa yarim shaffof parda bilan xiralashtiriladi. */
export function uzMaskStyle() {
  const dark = document.documentElement.dataset.theme === "dark";
  // Tashqi hudud allaqachon xira (blur) — parda faqat ohangni tushiradi.
  return { fillColor: dark ? "#02050b" : "#5b6b85",
           fillOpacity: dark ? 0.4 : 0.14 };
}
export function uzBorderStyle() {
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue("--accent").trim() || "#1668d6";
  return { color: accent, weight: 1.8, opacity: 0.85 };
}

/* Klaster belgisi kameralarning O'RTACHA nuqtasiga qo'yiladi. Kameralar egri
   chiziq bo'ylab (Toshkent — Jizzax — Samarqand) tizilganda bu nuqta
   chegaradan tashqariga, qo'shni davlat ustiga tushib qoladi. Belgi
   o'rtachaga eng yaqin HAQIQIY kamera (yoki ichki klaster) joyiga suriladi.
   _wLatLng (guruhlash hisobi) o'zgarmaydi — faqat ko'rinadigan joy. */
function patchClusterPosition() {
  const P = L.MarkerCluster && L.MarkerCluster.prototype;
  if (!P || !P._recalculateBounds) return;
  const orig = P._recalculateBounds;
  P._recalculateBounds = function () {
    orig.call(this);
    const c = this._wLatLng;
    if (!c) return;
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

function camIcon(cam) {
  const off = cam.online === false;
  const sel = cam.id === state.selectedId;
  return L.divIcon({
    className: "",
    html: '<div class="mk' + (off ? " off" : "") + (sel ? " sel" : "") +
          '"><span class="r"></span><span class="c"></span></div>',
    iconSize: [24, 24], iconAnchor: [12, 12]
  });
}

export function visibleCams() {
  const q = state.q.trim().toLowerCase();
  // Guruh filtri (map/groups.js) — xarita ham, ro'yxat ham faqat shu guruh.
  const group = state.groupMembers;
  return state.cameras.filter((c) => {
    if (group && !group.has(c.id)) return false;
    if (state.filter === "online" && c.online === false) return false;
    if (state.filter === "offline" && c.online !== false) return false;
    if (!q) return true;
    return (c.name + " " + c.region).toLowerCase().includes(q);
  });
}

/* Ikonka "kaliti": holat + tanlanganlik. Kalit o'zgarmasa DOM'ga tegilmaydi. */
const iconKey = (cam) => (cam.online === false ? "d" : "u") + (cam.id === state.selectedId ? "s" : "");

/* Koordinata ixtiyoriy: berilmagan kamera bazada 0/0 bo'lib turadi.
   Uni xaritaga qo'yib bo'lmaydi — aks holda Afrika qirg'og'ida (0°, 0°)
   soxta klaster paydo bo'ladi va uzoqlashtirganda ko'rinib qoladi. */
export function hasGeo(c) {
  return c.lat != null && c.lng != null && !(c.lat === 0 && c.lng === 0);
}

/* ---------- Xarita ---------- */
export class MapView {
  constructor() {
    // maxZoom shu yerda shart: markercluster xaritadan so'raydi, tile-qatlam
    // esa keyinroq (mavzu tanlangach) qo'shiladi.
    // Xarita O'zbekiston atrofida ushlanadi: juda uzoqlashtirib yoki surib
    // yuborilsa mamlakat kichik nuqtaga aylanib, markerlar "chiqib ketadi".
    const map = this.map = L.map("map", {
      zoomControl: false, maxZoom: 19, minZoom: 5,
      maxBounds: [[33.5, 52.0], [49.0, 77.5]], maxBoundsViscosity: 0.8
    }).setView([41.35, 64.6], 6);
    /* Ikki qatlam: pastda butun xarita xira (blur, rangsiz) — qo'shni davlatlar;
       ustida xuddi shu plitkalar tiniq, lekin O'zbekiston chegarasi bo'yicha
       kesilgan (clip-path, applyUzClip). SVG parda orqadagi plitkalarni
       xiralashtira olmaydi — shuning uchun ikkinchi qatlam. Brauzer bir xil
       manzilli plitkani keshdan oladi, trafik ikki baravar oshmaydi. */
    map.createPane("uzSharp").style.zIndex = 250;   // tilePane (200) va overlayPane (400) orasi
    this.tiles = null;
    this.tilesUz = null;

    map.on("zoomanim", (e) => this.applyUzClip(e.zoom, e.center));
    map.on("zoomend viewreset", () => this.applyUzClip());

    this.uzMask = null;
    this.uzBorder = null;
    this.uzRings = null;     // [[lat, lng], ...] halqalar — tiniq qatlam kesimi
    this.loadUzBoundary();

    /* Bitta ustunda ikki kamera (".. (2)") yoki NVR kanallari deyarli bir
       nuqtada turadi. Guruhlash hech qaysi masshtabda o'chirilmaydi —
       o'chirilsa ular ustma-ust tushib, birini bosib bo'lmasdi. Buning
       o'rniga radius yaqinlashgan sari kichrayadi (bir necha metr naridagilar
       oxirida alohida ko'rinadi), juda yaqinlari esa bosilganda yoyiladi. */
    const cluster = this.cluster = L.markerClusterGroup({
      maxClusterRadius: (z) => (z >= 18 ? 18 : z >= 16 ? 30 : z >= 14 ? 45 : 60),
      showCoverageOnHover: false,
      animate: false,               // kamera ko'p bo'lganda brauzerni bo'g'masin
      chunkedLoading: true,
      chunkInterval: 120,
      zoomToBoundsOnClick: false,   // o'zimiz hal qilamiz — pastda, clusterclick
      spiderfyDistanceMultiplier: 1.6,
      spiderLegPolylineOptions: { weight: 1.5, color: "#4a90f7", opacity: 0.8 },
      iconCreateFunction: (c) => {
        const n = c.getChildCount();
        // Ilgari bitta uzilgan kamera ham butun klasterni qizil halqaga o'rardi:
        // kameralarning 9% i uzilganda ham klasterlarning 75% i "xavf" bo'lib
        // ko'rinardi. Endi uzilganlar soni kichik nishonda yoziladi — rang emas,
        // raqam gapiradi.
        const down = c.getAllChildMarkers().filter((m) => m.options.camDown).length;
        const size = n > 999 ? 54 : n > 99 ? 46 : n > 9 ? 40 : 32;
        return L.divIcon({
          html: '<div class="mk-cluster" style="width:' + size +
                'px;height:' + size + 'px;font-size:' + (size > 40 ? 15 : 13) + 'px">' +
                (n > 999 ? (n / 1000).toFixed(1) + "k" : n) + "</div>" +
                (down ? '<span class="mk-badge" title="' + down + ' ta uzilgan">' +
                        (down > 99 ? "99+" : down) + "</span>" : ""),
          className: "mk-cl", iconSize: [size, size], iconAnchor: [size / 2, size / 2]
        });
      }
    });
    map.addLayer(cluster);

    /* Klaster bosilganda: kameralari bir-biriga juda yaqin bo'lsa (≤ 40 m —
       bitta ustun/bino) yoki xarita oxirgi masshtabda bo'lsa, ular aylana
       bo'ylab yoyiladi; aks holda xarita ularga yaqinlashadi. */
    cluster.on("clusterclick", (e) => {
      const c = e.layer;
      const b = c.getBounds();
      const tiny = map.distance(b.getSouthWest(), b.getNorthEast()) <= 40;
      if (tiny || map.getZoom() >= map.getMaxZoom()) c.spiderfy();
      else c.zoomToBounds({ padding: [40, 40] });
    });

    this.markersById = new Map();

    this.bindControls();
  }

  setTiles() {
    const map = this.map;
    if (this.tiles) map.removeLayer(this.tiles);
    if (this.tilesUz) map.removeLayer(this.tilesUz);
    // OSM plitkalari — kalit talab qilmaydi (CARTO endi kalitsiz "API KEY
    // REQUIRED" chizadi). Tungi mavzu CSS filtr bilan olinadi (style.css).
    const url = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
    tiles = this.tiles = L.tileLayer(url, {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19, className: "tiles-out"
    }).addTo(map);
    this.tilesUz = L.tileLayer(url, { maxZoom: 19, pane: "uzSharp", className: "tiles-uz" })
      .addTo(map);
  }

  /* Tiniq qatlamni O'zbekiston shakli bo'yicha kesadi. Yo'l qatlam
     koordinatalarida (pane'ning o'z koordinatasi) — ular faqat zoom'da
     o'zgaradi, surishda emas. Zoom animatsiyasida yangi masshtab oldindan
     hisoblanadi, aks holda bir lahzaga kesim xaritadan ajralib qoladi. */
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
      // Aniq chegara (geoBoundaries ADM0) — loyihaning o'zida saqlanadi,
      // internetga bog'liq emas. Anklavlar ham alohida poligon sifatida bor.
      const res = await fetch("/assets/uz.geojson");
      const gj = await res.json();
      const geom = gj.features[0].geometry;
      const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
      const rings = polys.map((p) => p[0].map(([lng, lat]) => [lat, lng]));
      this.uzRings = rings;
      this.applyUzClip();

      // Butun dunyoni qoplaydigan tashqi halqa + O'zbekiston "teshik" sifatida.
      const world = [[-89.9, -179.9], [-89.9, 179.9], [89.9, 179.9], [89.9, -179.9]];
      uzMask = this.uzMask = L.polygon([world, ...rings], Object.assign({
        stroke: false, fillRule: "evenodd", interactive: false
      }, uzMaskStyle())).addTo(this.map);
      uzBorder = this.uzBorder = L.polygon(rings, Object.assign({
        fill: false, interactive: false
      }, uzBorderStyle())).addTo(this.map);
    } catch (e) { /* chegara fayli yuklanmasa — xarita oddiy qoladi */ }
  }

  rebuildMarkers() {
    const cams = visibleCams().filter(hasGeo);
    this.markersById.clear();
    const markers = cams.map((cam) => {
      const m = L.marker([cam.lat, cam.lng], {
        icon: camIcon(cam), title: cam.name, camDown: cam.online === false,
        iconKey: iconKey(cam)
      });
      m.on("click", () => selectCamera(cam.id, false));
      m.on("mouseover", () => prewarm(cam));
      this.markersById.set(cam.id, m);
      return m;
    });
    this.cluster.clearLayers();
    this.cluster.addLayers(markers);
  }

  /* Holat yangilanganda markerlar qayta chizilmaydi — faqat holati yoki
     tanlanganligi o'zgarganlarning belgisi almashadi (minglab marker
     bo'lganda ham 60 soniyalik yangilanish sezilmaydi). */
  refreshMarkerIcons() {
    let dirty = false;
    this.markersById.forEach((m, id) => {
      const cam = state.byId.get(id);
      if (!cam) return;
      const key = iconKey(cam);
      if (m.options.iconKey === key) return;
      m.options.iconKey = key;
      const down = cam.online === false;
      if (m.options.camDown !== down) { m.options.camDown = down; dirty = true; }
      m.setIcon(camIcon(cam));
    });
    if (dirty && this.cluster.refreshClusters) this.cluster.refreshClusters();
  }

  /* ---------- Xarita boshqaruvlari ---------- */
  bindControls() {
    const map = this.map;
    $("z-in").addEventListener("click", () => map.zoomIn());
    $("z-out").addEventListener("click", () => map.zoomOut());
    $("fit-all").addEventListener("click", () => {
      try {
        const b = this.cluster.getBounds();
        if (b.isValid()) { map.fitBounds(b.pad(0.2)); return; }
      } catch (e) {}
      map.setView([41.35, 64.6], 6);
    });
    // Xarita kartasini to'liq ekranga chiqarish.
    $("map-fs").addEventListener("click", () => {
      if (document.fullscreenElement) { document.exitFullscreen(); return; }
      const el = $("map-card");
      if (el.requestFullscreen) el.requestFullscreen().then(() =>
        setTimeout(() => map.invalidateSize(), 120)).catch(() => {});
    });
    document.addEventListener("fullscreenchange", () => {
      if (state.tab === "map") setTimeout(() => map.invalidateSize(), 120);
    });
  }
}

patchClusterPosition();

export const mapView = new MapView();
export const map = mapView.map;

export function setTiles() { mapView.setTiles(); }
export function rebuildMarkers() { mapView.rebuildMarkers(); }
export function refreshMarkerIcons() { mapView.refreshMarkerIcons(); }
