"use strict";

const state = {
  cameras: [],
  byId: new Map(),
  vendors: [],
  admin: null,
  tab: "map",
  filter: "all",
  q: "",
  selectedId: null,
  listOpen: true,
  openRegions: {},
  pinned: [],                 // "Devorga qo'shish" bilan tanlanganlar
  wallSize: 3,
  wallRegion: "",             // devorda faqat shu hudud ("" — hammasi)
  wallFit: "contain",         // contain — butun kadr, cover — katakni to'ldirish
  wallPage: 0,
  wallAuto: false,            // sahifalarni avtomatik aylantirish
  wallHidden: new Set(),      // devordan vaqtincha olib tashlanganlar
  openTimes: [],              // shu seansda o'lchangan ochilish vaqtlari (ms)
  openByCam: new Map(),       // kamera → oxirgi ochilish vaqti (ms)
  events: [],                 // shu seans hodisalari (oqim ochildi va h.k.)
  stats: null,                // /api/stats/dashboard javobi — tarixiy grafiklar
  editingId: null,
  sourceType: "rtsp",
  picking: null,
  pickMarker: null,
  adminQuery: "",
  adminOffset: 0,
  adminTotal: 0,
  adminCameras: [],
  adminSize: 50,
  tlHours: 24,                // asosiy grafik davri (soat)
  listView: "cams",           // chap panel: "cams" yoki "regs"
  wallInterval: 12,           // avto-almashish oralig'i (soniya)
  apiOk: true,                // oxirgi so'rov muvaffaqiyatli bo'ldimi
  streamOk: null,             // oqim manzili olindimi (null — hali sinalmagan)
  adminFilters: { status: "", region: "", codec: "", mode: "" },
  adminSort: { key: "", dir: 1 }
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

/* Qabul buferi (soniya) — WebRTC tasvirni ko'rsatishdan oldin shuncha
   ushlab turadi.

   Nima uchun kerak: kamera kanalida paket yo'qolsa, RTSP/TCP uni qayta
   yuborishni kutadi va oqim to'xtab qoladi, keyin to'p-to'p bo'lib
   quvib yetadi. Bufersiz brauzer aynan shu tebranishni ko'rsatadi —
   tasvir qotib-qotib ketadi. O'lchov (A1 kamerasi, kanalida ~3% paket
   yo'qolishi bor):

       bufersiz  — 30 soniyada 14 marta qotish, vaqtning 33-45 %i
       0,5 s     — 10 marta, 14 %
       1,0 s     —  3 marta,  3 %
       1,5 s     —  3 marta,  4 %

   Sog'lom kanaldagi kameraga zarari yo'q (A7: 0 qotish, 600/600 kadr).
   Narxi — tasvir bir soniya kechikadi; kuzatuv uchun bu sezilmaydi,
   shuning uchun silliqlik afzal ko'rilgan. */
const PLAYOUT_DELAY = 1.0;

/* Brauzer H.265 (HEVC) ni o'zi o'qiy oladimi? Olsa — server oqimni
   o'girmaydi, xom holda beradi va GPU umuman ishlatilmaydi.

   DIQQAT: bu savol WebRTC uchun so'raladi. Sababi — server bitta yo'l
   qaytaradi, pleyer esa avval WebRTC'ni sinaydi. Brauzerning HLS (MSE)
   tomoni H.265 ni bilishi, WebRTC tomoni esa ko'rsatmasligi mumkin;
   Windows'dagi Edge aynan shunday. Ilgari "ikkisidan biri bilsa yetadi"
   deb hisoblanardi — natijada xom H.265 WebRTC'ga berilib, baytlar oqib
   turgan holda tasvir birinchi kadrda qotib qolardi. Endi WebRTC bor
   bo'lsa hukmni faqat u chiqaradi. */
const HEVC_OK = (() => {
  try {
    const caps = RTCRtpReceiver.getCapabilities("video");
    if (caps) return caps.codecs.some((c) => /H265|hevc/i.test(c.mimeType));
  } catch (e) { /* WebRTC yo'q — quyida HLS bo'yicha hal qilinadi */ }
  const type = 'video/mp4; codecs="hvc1.1.6.L93.B0"';
  try {
    if (window.MediaSource && MediaSource.isTypeSupported(type)) return true;
  } catch (e) { /* eskirgan brauzer */ }
  return document.createElement("video").canPlayType(type) === "probably";
})();

/* ---------- API ---------- */
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body ? { "Content-Type": "application/json" } : {},
    ...options
  });
  // Login so'rovining 401 i — noto'g'ri parol, sessiya tugashi emas:
  // u pastda serverning o'z xabari bilan qaytadi.
  if (res.status === 401 && !path.startsWith("/api/auth/login")) {
    setAdmin(null);
    openModal("login-modal");
    throw new Error("Sessiya tugadi — qaytadan kiring");
  }
  if (!res.ok) {
    state.apiOk = false;
    let detail = "Xatolik yuz berdi";
    try { detail = (await res.json()).detail || detail; } catch (e) {}
    throw new Error(detail);
  }
  state.apiOk = true;
  return res.status === 204 ? null : res.json();
}

/* ---------- Ikonkalar (inline SVG) ---------- */
const svg = (d, extra) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + d + "</svg>";
const ICO = {
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/>' +
           '<path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/>' +
           '<path d="M20 12h2"/><path d="m4.9 19.1 1.4-1.4"/><path d="m17.7 6.3 1.4-1.4"/>'),
  moon: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  star: svg('<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>'),
  pin: svg('<circle cx="12" cy="12" r="7"/><path d="M12 2v3"/><path d="M12 19v3"/>' +
           '<path d="M2 12h3"/><path d="M19 12h3"/>'),
  down: svg('<path d="M12 4v10"/><path d="m8 11 4 4 4-4"/><path d="M4 19h16"/>'),
  full: svg('<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/>' +
            '<path d="M16 21h3a2 2 0 0 0 2-2v-3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/>'),
  close: svg('<path d="m6 6 12 12"/><path d="m18 6-12 12"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  play: svg('<path d="m7 4 12 8-12 8z"/>'),
  trash: svg('<path d="M3 6h18"/><path d="m6 6 1 14h10l1-14"/><path d="M10 6V4h4v2"/>'),
  map: svg('<path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>'),
  server: svg('<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01"/><path d="M7 16.5h.01"/>'),
  db: svg('<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'),
  net: svg('<path d="M5 12.5a9.5 9.5 0 0 1 14 0"/><path d="M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1.4"/>'),
  cast: svg('<path d="m7 4 12 8-12 8z"/><circle cx="12" cy="12" r="9"/>'),
};

/* ---------- Mavzu ---------- */
function setTheme(theme, persist = true) {
  document.documentElement.dataset.theme = theme;
  if (persist) localStorage.setItem("nigoh-theme", theme);
  const tb = $("theme-btn");
  tb.innerHTML = theme === "dark" ? ICO.sun : ICO.moon;
  tb.title = theme === "dark" ? "Yorug' mavzuga o'tish" : "Tungi mavzuga o'tish";
  if (!tiles) setTiles();
  // Hudud pardasi va chegara rangi ham mavzuga moslashadi.
  if (uzMask) uzMask.setStyle(uzMaskStyle());
  if (uzBorder) uzBorder.setStyle(uzBorderStyle());
}
$("theme-btn").addEventListener("click", () =>
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

/* ---------- Xarita ---------- */
// maxZoom shu yerda shart: markercluster xaritadan so'raydi, tile-qatlam
// esa keyinroq (mavzu tanlangach) qo'shiladi.
// Xarita O'zbekiston atrofida ushlanadi: juda uzoqlashtirib yoki surib
// yuborilsa mamlakat kichik nuqtaga aylanib, markerlar "chiqib ketadi".
const map = L.map("map", {
  zoomControl: false, maxZoom: 19, minZoom: 5,
  maxBounds: [[33.5, 52.0], [49.0, 77.5]], maxBoundsViscosity: 0.8
}).setView([41.35, 64.6], 6);
/* Ikki qatlam: pastda butun xarita xira (blur, rangsiz) — qo'shni davlatlar;
   ustida xuddi shu plitkalar tiniq, lekin O'zbekiston chegarasi bo'yicha
   kesilgan (clip-path, applyUzClip). SVG parda orqadagi plitkalarni
   xiralashtira olmaydi — shuning uchun ikkinchi qatlam. Brauzer bir xil
   manzilli plitkani keshdan oladi, trafik ikki baravar oshmaydi. */
map.createPane("uzSharp").style.zIndex = 250;   // tilePane (200) va overlayPane (400) orasi
let tiles = null;
let tilesUz = null;
function setTiles() {
  if (tiles) map.removeLayer(tiles);
  if (tilesUz) map.removeLayer(tilesUz);
  // OSM plitkalari — kalit talab qilmaydi (CARTO endi kalitsiz "API KEY
  // REQUIRED" chizadi). Tungi mavzu CSS filtr bilan olinadi (style.css).
  const url = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  tiles = L.tileLayer(url, {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19, className: "tiles-out"
  }).addTo(map);
  tilesUz = L.tileLayer(url, { maxZoom: 19, pane: "uzSharp", className: "tiles-uz" })
    .addTo(map);
}

/* Tiniq qatlamni O'zbekiston shakli bo'yicha kesadi. Yo'l qatlam
   koordinatalarida (pane'ning o'z koordinatasi) — ular faqat zoom'da
   o'zgaradi, surishda emas. Zoom animatsiyasida yangi masshtab oldindan
   hisoblanadi, aks holda bir lahzaga kesim xaritadan ajralib qoladi. */
function applyUzClip(zoom, center) {
  if (!uzRings) return;
  const pt = zoom == null
    ? (ll) => map.latLngToLayerPoint(ll)
    : (ll) => map._latLngToNewLayerPoint(L.latLng(ll), zoom, center);
  const d = uzRings.map((ring) => "M" + ring.map((ll) => {
    const p = pt(ll);
    return Math.round(p.x) + " " + Math.round(p.y);
  }).join("L") + "Z").join("");
  map.getPane("uzSharp").style.clipPath = "path('" + d + "')";
}
map.on("zoomanim", (e) => applyUzClip(e.zoom, e.center));
map.on("zoomend viewreset", () => applyUzClip());

/* O'zbekiston hududini ajratib ko'rsatish: chegara urg'u rangida chiziladi,
   tashqi hududlar esa yarim shaffof parda bilan xiralashtiriladi. */
let uzMask = null;
let uzBorder = null;

function uzMaskStyle() {
  const dark = document.documentElement.dataset.theme === "dark";
  // Tashqi hudud allaqachon xira (blur) — parda faqat ohangni tushiradi.
  return { fillColor: dark ? "#02050b" : "#5b6b85",
           fillOpacity: dark ? 0.4 : 0.14 };
}
function uzBorderStyle() {
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue("--accent").trim() || "#1668d6";
  return { color: accent, weight: 1.8, opacity: 0.85 };
}

async function loadUzBoundary() {
  try {
    // Aniq chegara (geoBoundaries ADM0) — loyihaning o'zida saqlanadi,
    // internetga bog'liq emas. Anklavlar ham alohida poligon sifatida bor.
    const res = await fetch("/static/uz.geojson");
    const gj = await res.json();
    const geom = gj.features[0].geometry;
    const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
    const rings = polys.map((p) => p[0].map(([lng, lat]) => [lat, lng]));
    uzRings = rings;
    applyUzClip();

    // Butun dunyoni qoplaydigan tashqi halqa + O'zbekiston "teshik" sifatida.
    const world = [[-89.9, -179.9], [-89.9, 179.9], [89.9, 179.9], [89.9, -179.9]];
    uzMask = L.polygon([world, ...rings], Object.assign({
      stroke: false, fillRule: "evenodd", interactive: false
    }, uzMaskStyle())).addTo(map);
    uzBorder = L.polygon(rings, Object.assign({
      fill: false, interactive: false
    }, uzBorderStyle())).addTo(map);
  } catch (e) { /* chegara fayli yuklanmasa — xarita oddiy qoladi */ }
}
let uzRings = null;     // [[lat, lng], ...] halqalar — tiniq qatlam kesimi
loadUzBoundary();

/* Klaster belgisi kameralarning O'RTACHA nuqtasiga qo'yiladi. Kameralar egri
   chiziq bo'ylab (Toshkent — Jizzax — Samarqand) tizilganda bu nuqta
   chegaradan tashqariga, qo'shni davlat ustiga tushib qoladi. Belgi
   o'rtachaga eng yaqin HAQIQIY kamera (yoki ichki klaster) joyiga suriladi.
   _wLatLng (guruhlash hisobi) o'zgarmaydi — faqat ko'rinadigan joy. */
(function snapClustersToCameras() {
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
})();

/* Bitta ustunda ikki kamera (".. (2)") yoki NVR kanallari deyarli bir
   nuqtada turadi. Guruhlash hech qaysi masshtabda o'chirilmaydi —
   o'chirilsa ular ustma-ust tushib, birini bosib bo'lmasdi. Buning
   o'rniga radius yaqinlashgan sari kichrayadi (bir necha metr naridagilar
   oxirida alohida ko'rinadi), juda yaqinlari esa bosilganda yoyiladi. */
const cluster = L.markerClusterGroup({
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

const markersById = new Map();

function visibleCams() {
  const q = state.q.trim().toLowerCase();
  return state.cameras.filter((c) => {
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
const hasGeo = (c) => c.lat != null && c.lng != null && !(c.lat === 0 && c.lng === 0);

function rebuildMarkers() {
  const cams = visibleCams().filter(hasGeo);
  markersById.clear();
  const markers = cams.map((cam) => {
    const m = L.marker([cam.lat, cam.lng], {
      icon: camIcon(cam), title: cam.name, camDown: cam.online === false,
      iconKey: iconKey(cam)
    });
    m.on("click", () => selectCamera(cam.id, false));
    m.on("mouseover", () => prewarm(cam));
    markersById.set(cam.id, m);
    return m;
  });
  cluster.clearLayers();
  cluster.addLayers(markers);
}

/* Holat yangilanganda markerlar qayta chizilmaydi — faqat holati yoki
   tanlanganligi o'zgarganlarning belgisi almashadi (minglab marker
   bo'lganda ham 60 soniyalik yangilanish sezilmaydi). */
function refreshMarkerIcons() {
  let dirty = false;
  markersById.forEach((m, id) => {
    const cam = state.byId.get(id);
    if (!cam) return;
    const key = iconKey(cam);
    if (m.options.iconKey === key) return;
    m.options.iconKey = key;
    const down = cam.online === false;
    if (m.options.camDown !== down) { m.options.camDown = down; dirty = true; }
    m.setIcon(camIcon(cam));
  });
  if (dirty && cluster.refreshClusters) cluster.refreshClusters();
}

/* ---------- Ma'lumot yuklash va yangilash ---------- */
async function loadCameras() {
  const res = await api("/api/cameras");
  applyCameras(res);
  rebuildMarkers();
}

function applyCameras(res) {
  // Uzildi/ulandi hodisalarini server o'zi yozib boradi (core/stats.py) —
  // dashboard ularni /api/stats/dashboard dan oladi, bu yerda takrorlamaymiz.
  state.cameras = res.cameras;
  state.byId = new Map(res.cameras.map((c) => [c.id, c]));
  // Tanlangan kamera o'chirilgan bo'lsa panel yopiladi.
  if (state.selectedId && !state.byId.has(state.selectedId)) closeSel();
  renderList();
  renderStrip();
  renderSystem();
  // Dashboard faqat ochiq bo'lsa chiziladi — yashirin oynaga statistika
  // so'rab, grafik chizib o'tirmaymiz.
  if (state.tab === "dash") renderDash();
  updateSelHead();
}

let refreshing = false;
async function refreshStatus() {
  if (refreshing || document.hidden) return;
  refreshing = true;
  let res;
  try { res = await api("/api/cameras"); } catch (e) { refreshing = false; return; }
  refreshing = false;
  const changed = res.cameras.length !== state.cameras.length ||
                  res.cameras.some((c) => !state.byId.has(c.id));
  applyCameras(res);
  if (changed) rebuildMarkers(); else refreshMarkerIcons();
  // Devorda holati o'zgargan kamera plitkasi yangilanadi (diff — qolganlar
  // qayta ulanmaydi).
  if (state.tab === "wall") buildWall();
  // Boshqaruv jadvali ochiq bo'lsa, undagi Holat ustuni ham yangilanadi.
  if (state.tab === "admin" && state.admin) {
    loadAdminCameras(state.adminOffset).catch(() => {});
  }
}
setInterval(refreshStatus, 30000);
// Yashirin oynada yangilanish to'xtaydi; qaytib kelinganda darhol yangilanadi.
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshStatus(); });

/* ---------- Chap ro'yxat ---------- */

/* Ma'lumot o'zgarmagan bo'lsa ro'yxat qayta chizilmaydi — 60 soniyalik
   yangilanish foydalanuvchi qarab turgan ro'yxatni "sakratmaydi". */
let lastListSig = "";

/* Faqat tanlov o'zgarganda butun ro'yxat qayta chizilmaydi — `.sel`
   belgisi ko'chiriladi. */
function syncListSel() {
  document.querySelectorAll("#list-body .cam-row").forEach((row) => {
    row.classList.toggle("sel", Number(row.dataset.id) === state.selectedId);
  });
}

function renderList(force) {
  const cams = visibleCams();
  const q = state.q.trim();
  const sig = [state.filter, q, state.listView,
    state.cameras.map((c) => c.id + (c.online === false ? "d" : c.online ? "u" : "?")).join("")
  ].join("|");
  if (!force && sig === lastListSig) { syncListSel(); return; }
  lastListSig = sig;

  $("list-count").textContent = cams.length + " / " + state.cameras.length + " kamera";

  // Filtr tugmalarida jonli hisob ko'rinadi.
  const onCount = state.cameras.filter((c) => c.online === true).length;
  const offCount = state.cameras.filter((c) => c.online === false).length;
  const fLabels = { all: "Barchasi " + state.cameras.length,
                    online: "Onlayn " + onCount, offline: "Uzilgan " + offCount };
  document.querySelectorAll("#filters button").forEach((b) => {
    b.textContent = fLabels[b.dataset.filter];
  });

  if (state.listView === "regs") { renderRegionList(cams); renderFootStats(); return; }

  const regions = [...new Set(cams.map((c) => c.region))];
  const body = $("list-body");
  body.innerHTML = regions.length ? "" :
    '<div class="empty">Kamera topilmadi.</div>';

  regions.forEach((region) => {
    const list = cams.filter((c) => c.region === region);
    const down = list.filter((c) => c.online === false).length;
    const known = list.some((c) => c.online === true);
    const grp = document.createElement("div");
    // Qidiruv paytida guruhlar ochiq — topilgan kamera darhol ko'rinadi.
    grp.className = "grp" + (state.openRegions[region] || q ? " open" : "");

    const headRow = document.createElement("div");
    headRow.className = "grp-row";
    headRow.innerHTML =
      '<button class="grp-head">' +
        '<span class="caret">&#9654;</span>' +
        '<span class="st' + (down ? " down" : known ? "" : " unk") + '"></span>' +
        '<span class="rg">' + esc(region) + "<i>" + list.length + " kamera</i></span>" +
        '<span class="bdg"><span>' + (list.length - down) + "</span>" +
          (down ? '<span class="d">' + down + "</span>" : "") + "</span>" +
      "</button>" +
      '<button class="grp-fly" title="Xaritada ko\'rsatish">&#9678;</button>';
    headRow.querySelector(".grp-head").addEventListener("click", () => {
      state.openRegions[region] = !state.openRegions[region];
      grp.classList.toggle("open", state.openRegions[region]);
    });
    headRow.querySelector(".grp-fly").addEventListener("click", () => flyToRegion(region));
    grp.appendChild(headRow);

    const wrap = document.createElement("div");
    wrap.className = "grp-cams";
    list.forEach((cam) => {
      const row = document.createElement("button");
      row.dataset.id = cam.id;
      // "Tirik, lekin oqimsiz" — alohida holat. Kameraning porti ochiq
      // (health uni ONLINE deb belgilaydi), ammo RTSP kodek bermagan:
      // login/parol yoki yo'l xato. Bunday kamera hech qachon ochilmaydi.
      // Ilgari u ro'yxatda oddiy yashil bo'lib turardi va foydalanuvchi
      // bosib, kutib, sababsiz xato olardi — servisda 4 tasi shunday.
      const oqimsiz = cam.online !== false && !cam.codec;
      row.className = "cam-row" + (cam.online === false ? " down" : "") +
                      (oqimsiz ? " nostream" : "") +
                      (cam.id === state.selectedId ? " sel" : "");
      if (oqimsiz) {
        row.title = "Tarmoqda ko'rinadi, lekin oqim bermayapti — "
                  + "RTSP login/parol yoki yo'l xato bo'lishi mumkin";
      }
      row.innerHTML =
        '<span class="dot"></span>' +
        '<span class="nm">' + esc(cam.name) + "</span>" +
        '<span class="cdx">' + esc(cam.codec || "oqim yo'q") + "</span>";
      row.addEventListener("click", () => { hideCamTip(); selectCamera(cam.id, true); });
      row.addEventListener("mouseenter", (e) => { prewarm(cam); showCamTip(cam, row); });
      row.addEventListener("mouseleave", hideCamTip);
      wrap.appendChild(row);
    });
    grp.appendChild(wrap);
    body.appendChild(grp);
  });

  renderFootStats();
}

/* Hududdagi barcha kameralar sig'adigan qilib xaritani yaqinlashtiradi. */
function flyToRegion(region) {
  const pts = state.cameras.filter((c) => c.region === region && hasGeo(c))
    .map((c) => [c.lat, c.lng]);
  if (!pts.length) return;
  if (pts.length === 1) map.flyTo(pts[0], 13, { duration: 0.6 });
  else map.flyToBounds(L.latLngBounds(pts).pad(0.3), { duration: 0.6 });
}

/* Hammasini ochish/yopish */
$("list-exp").addEventListener("click", () => {
  const regions = [...new Set(state.cameras.map((c) => c.region))];
  const anyClosed = regions.some((r) => !state.openRegions[r]);
  regions.forEach((r) => { state.openRegions[r] = anyClosed; });
  $("list-exp").textContent = anyClosed ? "Hammasini yopish" : "Hammasini ochish";
  renderList(true);
});

/* Chap paneldagi ikki ko'rinish: kameralar daraxti / hududlar ro'yxati. */
document.querySelectorAll(".lh-tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    state.listView = b.dataset.lview;
    document.querySelectorAll(".lh-tabs button").forEach((x) => x.classList.toggle("on", x === b));
    renderList(true);
  }));

/* Hududlar ko'rinishi — har biri bitta qator, bosilsa xaritada ochiladi. */
function renderRegionList(cams) {
  const regions = [...new Set(cams.map((c) => c.region))].sort();
  const body = $("list-body");
  if (!regions.length) { body.innerHTML = '<div class="empty">Hudud topilmadi.</div>'; return; }
  body.innerHTML = regions.map((r) => {
    const list = cams.filter((c) => c.region === r);
    const down = list.filter((c) => c.online === false).length;
    return '<button class="cam-row rgrow" data-region="' + esc(r) + '">' +
      '<span class="dot' + (down ? " d" : "") + '"></span>' +
      '<span class="nm">' + esc(r) + "</span>" +
      '<span class="bdg"><span>' + (list.length - down) + "</span>" +
        (down ? '<span class="d">' + down + "</span>" : "") + "</span></button>";
  }).join("");
  body.querySelectorAll(".rgrow").forEach((row) =>
    row.addEventListener("click", () => flyToRegion(row.dataset.region)));
}

/* ---------- Kamera surat-ko'rinishi (hover tooltip) ---------- */
function showCamTip(cam, row) {
  const tip = $("cam-tip");
  const img = tip.querySelector("img");
  img.hidden = false;
  img.onerror = () => { img.hidden = true; };
  // 8 soniyalik server keshi bilan mos — bir xil manzil qayta so'ralmaydi.
  img.src = "/api/cameras/" + cam.id + "/snapshot?t=" + Math.floor(Date.now() / 8000);
  tip.querySelector(".cap").textContent = cam.online === false
    ? "O'chiq · oxirgi onlayn: " + fmtLastSeen(cam.last_seen)
    : [cam.codec, cam.always_on ? "doim tayyor" : "jonli"].filter(Boolean).join(" · ");
  const r = row.getBoundingClientRect();
  tip.style.left = (r.right + 10) + "px";
  tip.style.top = Math.max(80, Math.min(r.top - 40, innerHeight - 200)) + "px";
  tip.style.display = "block";
}
function hideCamTip() { $("cam-tip").style.display = "none"; }
$("list-body").addEventListener("scroll", hideCamTip);

function renderFootStats() {
  const t = state.openTimes;
  $("stat-open").innerHTML = t.length
    ? (t.reduce((s, v) => s + v, 0) / t.length / 1000).toFixed(2).replace(".", ",") + "s"
    : "&mdash;";
  // Faqat chindan o'ynayotgan oqimlar sanaladi.
  const live = [selPlayer, ...wallPlayers]
    .filter((p) => p && p.video && !p.video.paused).length;
  $("stat-live").textContent = live + "/" + state.cameras.length;
}

/* Tor ekran: ro'yxat va tafsilotlar paneli xarita ustida suzadi. */
const MOBILE = window.matchMedia("(max-width:820px)");

function setListOpen(open) {
  state.listOpen = open;
  $("list-panel").hidden = !open;
}
$("list-close").addEventListener("click", () => setListOpen(false));

function setFilter(f) {
  state.filter = f;
  document.querySelectorAll("#filters button").forEach((x) =>
    x.classList.toggle("on", x.dataset.filter === f));
  // Pastki chiplarda ham qaysi filtr faol ekani ko'rinadi.
  $("chip-on").classList.toggle("on", f === "online");
  $("chip-off").classList.toggle("on", f === "offline");
  $("chip-all").classList.toggle("on", f === "all");
  renderList();
  rebuildMarkers();
}
document.querySelectorAll("#filters button").forEach((b) =>
  b.addEventListener("click", () => setFilter(b.dataset.filter)));

/* Pastki chiplar ham filtr sifatida ishlaydi. */
function chipFilter(f) {
  if (state.tab !== "map") showTab("map");
  setFilter(f);
  setListOpen(true);
}
$("chip-on").addEventListener("click", () => chipFilter("online"));
$("chip-off").addEventListener("click", () => chipFilter("offline"));
$("chip-all").addEventListener("click", () => chipFilter("all"));

/* ---------- Qidiruv ---------- */
let qTimer = null;
/* Ikkita qidiruv maydoni (tepa qator va chap panel) bitta holatni boshqaradi. */
function setQuery(v, from, now) {
  state.q = v;
  if (from !== "top") $("q-input").value = v;
  if (from !== "list") $("q-list").value = v;
  clearTimeout(qTimer);
  const run = () => { renderList(); rebuildMarkers(); };
  if (now) run(); else qTimer = setTimeout(run, 300);
}
["q-input", "q-list"].forEach((id) => {
  const from = id === "q-input" ? "top" : "list";
  $(id).addEventListener("input", (e) => setQuery(e.target.value, from));
  $(id).addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !e.target.value) return;
    e.stopPropagation();
    setQuery("", null, true);
  });
});
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    $("q-input").focus();
    $("q-input").select();
  }
});

/* ---------- Pastki chiziqcha ---------- */
function renderStrip() {
  const total = state.cameras.length;
  const on = state.cameras.filter((c) => c.online === true).length;
  const off = state.cameras.filter((c) => c.online === false).length;
  $("strip-total").textContent = total;
  $("strip-on").textContent = on;
  $("strip-off").textContent = off;
  $("strip-reg").textContent = new Set(state.cameras.map((c) => c.region)).size;
  $("strip-on-sub").textContent = total ? Math.round((on / total) * 100) + "% faol" : "Faol kameralar";
  $("strip-off-sub").textContent = off ? "Tekshirish kerak" : "Aloqa yo'q";
  renderBell();
}

/* WebRTC serverda umuman ishlamasligi mumkin — va bu tasodifiy emas.

   MediaMTX ICE nomzodlari sifatida faqat o'z interfeys manzillarini
   (127.0.0.1, 192.168.x, docker0) e'lon qilsa, internetdagi brauzer
   ularning birortasiga yeta olmaydi: signalizatsiya muvaffaqiyatli
   o'tadi, kadr esa hech qachon kelmaydi. Serverda o'lchandi — 5 ta
   kameradan 5 tasi 12 soniyada bitta ham kadr bermadi.

   Bunda har ochilish 6 soniyani behuda kutishga sarflardi: pleyer
   WebRTC'ni sinaydi, jim qoladi, keyin HLS'ga tushadi. Kamera almashsa
   yana 6 soniya. Ketma-ket ikki marta jim qolgandan keyin bu seansda
   WebRTC sinalmaydi — HLS darhol boshlanadi.

   Bir marta jim qolish sabab emas: kamera ayni damda uyg'onayotgan
   bo'lishi mumkin. Muvaffaqiyatli ochilish hisobni nolga qaytaradi.

   Bekor qilingan urinish (foydalanuvchi boshqa kamerani bosdi) HECH QACHON
   sanalmaydi. Ilgari sanalardi: kameralarni ketma-ket ko'rib chiqqan
   foydalanuvchida WebRTC ikki bosishda o'chib, butun seans 7-17 s lik
   HLS'ga tushardi (lokal o'lchov: WebRTC 15 dan 14 kamerada 3-7 s da
   ochiladi). Kadr bermaydigan kamera ham sanalmaydi — ICE ulangan bo'lsa
   aybdor tarmoq emas. O'chgan WebRTC ham 2 daqiqadan keyin qayta
   sinaladi — bitta yomon daqiqa butun ish kunini sekinlashtirmasin. */
const WEBRTC_JIM_CHEGARA = 2;
const WEBRTC_QAYTA_SINASH = 120000;           // ms
let webrtcJim = 0;
let webrtcJimAt = 0;

function webrtcDead() {
  if (webrtcJim < WEBRTC_JIM_CHEGARA) return false;
  if (Date.now() - webrtcJimAt > WEBRTC_QAYTA_SINASH) { webrtcJim = 0; return false; }
  return true;
}

function noteWebRtc(ok) {
  if (ok) { webrtcJim = 0; return; }
  webrtcJim++;
  webrtcJimAt = Date.now();
  if (webrtcJim === WEBRTC_JIM_CHEGARA) {
    console.warn("Nigoh: WebRTC kadr bermayapti — bu seansda faqat HLS " +
                 "ishlatiladi. Serverda webrtcAdditionalHosts sozlanmagan " +
                 "yoki ICE porti yopiq bo'lishi mumkin.");
  }
}

/* ---------- Video pleyer (WebRTC -> HLS) ----------
   Har bir pleyer o'z holatini olib yuradi — devorda bir nechta birga ishlaydi. */

const FAIL_MSG = "Oqim ochilmadi — MediaMTX ishlayaptimi va kamera ulanganmi tekshiring";

function createPlayer(video, msgEl) {
  const p = { video, msgEl, hls: null, pc: null, token: 0, onOpen: null, last: null };
  msgEl.classList.add("pmsg");

  /* Xabar turi: "wait" — aylanma bilan; "fail" — bosilsa qayta uriniladi. */
  const setMsg = (text, kind) => {
    msgEl.textContent = text;
    msgEl.classList.toggle("wait", kind === "wait");
    msgEl.classList.toggle("fail", kind === "fail");
  };
  p.setMsg = setMsg;
  msgEl.addEventListener("click", (e) => {
    if (!msgEl.classList.contains("fail") || !p.last) return;
    e.stopPropagation();
    p.open(...p.last);
  });

  p.stop = () => {
    p.token++;
    // Kutish yozuvining taymerlari — pleyer yopilgach xabar yangilanmasin.
    if (p.onCleanup) { p.onCleanup(); p.onCleanup = null; }
    if (p.hls) { p.hls.destroy(); p.hls = null; }
    if (p.pc) { p.pc.close(); p.pc = null; }
    video.pause();
    video.removeAttribute("src");
    video.srcObject = null;
    video.load();
    setMsg("");
  };

  p.open = (cam, useHevc, quality) => {
    p.stop();
    p.last = [cam, useHevc, quality];
    const my = ++p.token;
    const stale = () => p.token !== my;
    const t0 = performance.now();
    setMsg("Ulanmoqda…", "wait");
    if (!video.poster) video.poster = "/api/cameras/" + cam.id + "/snapshot";

    const opened = () => {
      if (stale()) return;
      setMsg("");
      const ms = performance.now() - t0;
      state.openTimes.push(ms);
      if (state.openTimes.length > 50) state.openTimes.shift();
      state.openByCam.set(cam.id, ms);   // dashboard: kamera kesimida oxirgi o'lchov
      renderFootStats();
      renderDashMetrics();
      if (p.onOpen) p.onOpen(ms, p.mode);
    };
    video.addEventListener("playing", opened, { once: true });

    api("/api/cameras/" + cam.id + "/stream?hevc=" + (useHevc ? 1 : 0) +
        (quality ? "&quality=" + quality : ""))
      .then((urls) => {
        if (stale()) return;
        state.streamOk = Boolean(urls.webrtc_url || urls.stream_url);
        p.mode = urls.mode;
        // Sub oqim ishlamasa — asosiyga; xom H.265 amalda o'qilmasa —
        // bir marta o'girilganiga qaytamiz.
        const onFail = urls.mode === "sub"
          ? () => { if (!stale()) p.open(cam, useHevc); }
          : urls.mode === "raw"
            ? () => { if (!stale()) p.open(cam, false); }
            : () => { if (!stale()) setMsg(FAIL_MSG, "fail"); };
        attach(urls, stale, onFail);
      })
      .catch((e) => { if (!stale()) setMsg(e.message, "fail"); });

    function attach(urls, staleFn, onFail) {
      if (urls.webrtc_url && !webrtcDead()) {
        playWebRtc(urls.webrtc_url, staleFn).then(() => {
          if (!staleFn()) noteWebRtc(true);
        }).catch((err) => {
          // Boshqa kamera bosilgan — bu WebRTC'ning aybi emas.
          if (staleFn()) return;
          // Faqat tarmoq darajasidagi jimlik sanaladi (ICE ulanmagan).
          if (!(err && err.iceOk)) noteWebRtc(false);
          if (err && err.noSource) {
            // Sub oqim yo'q bo'lsa — asosiyga (onFail shuni qiladi);
            // asosiy oqimning manbasi ochilmasa — darhol aniq xabar.
            if (urls.mode === "sub") onFail();
            else setMsg("Kamera oqim bermayapti — kamera yoki registratorni tekshiring", "fail");
            return;
          }
          setMsg("Zaxira yo'l orqali ulanmoqda…", "wait");
          playHls(urls.stream_url, staleFn, onFail);
        });
        return;
      }
      if (!urls.stream_url) { setMsg("Oqim manzili sozlanmagan", "fail"); return; }
      playHls(urls.stream_url, staleFn, onFail);
    }

    async function playWebRtc(whepUrl, staleFn) {
      const pc = new RTCPeerConnection({ iceServers: [] });
      p.pc = pc;
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.ontrack = (e) => {
        if (staleFn()) return;
        // jitterBufferTarget — yangi nom (ms), playoutDelayHint — eskisi
        // (soniya). Ikkisi ham beriladi: brauzer bilganini oladi.
        try { e.receiver.jitterBufferTarget = PLAYOUT_DELAY * 1000; } catch (x) { /* qo'llamaydi */ }
        try { e.receiver.playoutDelayHint = PLAYOUT_DELAY; } catch (x) { /* qo'llamaydi */ }
        pc.__stream = e.streams[0];
        video.srcObject = e.streams[0];
        video.play().catch(() => {});
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await new Promise((resolve) => {          // ICE (ko'pi bilan 900 ms)
        if (pc.iceGatheringState === "complete") return resolve();
        const done = () => { pc.removeEventListener("icegatheringstatechange", check); resolve(); };
        const check = () => { if (pc.iceGatheringState === "complete") done(); };
        pc.addEventListener("icegatheringstatechange", check);
        setTimeout(done, 900);
      });
      const res = await fetch(whepUrl, {
        method: "POST", headers: { "Content-Type": "application/sdp" },
        body: pc.localDescription.sdp
      });
      if (!res.ok) {
        pc.close();
        // MediaMTX manbani ocholmadi (kamera oqim bermayapti) — tarmoq
        // emas, kamera. HLS ham shu manbadan oladi, unga o'tish yana
        // 30+ soniya behuda kutish bo'lardi.
        const body = await res.text().catch(() => "");
        throw Object.assign(new Error("WHEP " + res.status),
          { iceOk: true, noSource: /timed out|no stream|not ready/i.test(body) });
      }
      const answer = await res.text();
      if (staleFn()) { pc.close(); return; }
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
      await new Promise((resolve, reject) => {  // 6 s da tasvir kelmasa — HLS
        // srcObject/"connected" yetarli emas: ular kadr kelmasa ham paydo
        // bo'ladi (masalan, server UDP tashqariga yopiq bo'lsa). Haqiqiy
        // belgi — vaqt yurishi, ya'ni dekodlangan kadrlar oqib kelyapti.
        //
        // Kadr kelishi bilan DARHOL hal bo'ladi. Ilgari faqat 6-soniyada
        // tekshirilardi: shu oraliqda boshqa kamera bosilsa, taymer
        // yangi (hali bo'sh) videoga qarab eski urinishni "jim" deb
        // sanardi va WebRTC butun seansga o'chib qolardi.
        const t0 = performance.now();
        const poll = setInterval(() => {
          if (staleFn()) { clearInterval(poll); reject(new Error("bekor")); return; }
          if (video.srcObject === pc.__stream && video.currentTime > 0) {
            clearInterval(poll); resolve(); return;
          }
          if (performance.now() - t0 > 6000) {
            clearInterval(poll);
            // ICE ulangan-u kadr yo'q — tarmoq emas, kameraning o'zi
            // (oqim bermayapti). Bunday holat WebRTC'ni o'chirishga
            // sanalmaydi: aks holda ikkita nosoz kamera ketma-ket ochilsa
            // butun seans sekin HLS'ga tushardi.
            const iceOk = ["connected", "completed"].includes(pc.iceConnectionState);
            pc.close();
            reject(Object.assign(new Error("WebRTC jim"), { iceOk }));
          }
        }, 100);
        pc.addEventListener("connectionstatechange", () => {
          if (pc.connectionState === "failed") { clearInterval(poll); pc.close(); reject(new Error("WebRTC uzildi")); }
        });
      });
    }

    function playHls(url, staleFn, onFail) {
      if (!url) { setMsg(FAIL_MSG, "fail"); return; }
      // WebRTC'dan qolgan srcObject `src`dan ustun turadi — tozalanmasa
      // brauzer o'lik oqimni ko'rsatishda davom etadi va HLS ulanmaydi.
      video.srcObject = null;
      const isHls = url.includes(".m3u8");
      if (isHls && window.Hls && Hls.isSupported()) {
        // Zaxira: WebRTC'dagi PLAYOUT_DELAY ning HLS'dagi muqobili.
        // Ilgari `liveSyncDurationCount: 1` va `maxBufferLength: 6` edi —
        // ya'ni bir segmentlik (~1 s) zaxira. Kanal uzuq bo'lgan kamerada
        // bu yetmaydi: pleyer to'xtaydi, keyin jonli chekkaga sakraydi.
        // Sovuq start byudjeti. Ilgari bu yerda 25 000 ms turardi va
        // izohda "sovuq start 5 soniyagacha cho'ziladi" deb yozilgandi.
        // Ishlab chiqarishda o'lchandi — haqiqat boshqa: talab bo'yicha
        // ochilayotgan yo'lda birinchi pleylist 14-65 soniyada keladi
        // (MediaMTX manbani <1 s da ochadi, vaqt HLS muxeri birinchi
        // segmentni yopishiga ketadi — kameraning keyframe oralig'i uzun).
        //
        // 25 s chegara shu taqsimotning o'rtasidan kesib o'tardi: sekin
        // kameralar UMUMAN ochilmasdi va foydalanuvchiga "xato" deb
        // ko'rinardi, holbuki oqim yo'lda edi. Byudjet kengaytirildi va
        // kutish jim emas — quyida holat yozuvi yangilanib turadi.
        const hls = new Hls({
          lowLatencyMode: true, maxBufferLength: 12, backBufferLength: 6,
          liveSyncDurationCount: 3,
          manifestLoadingTimeOut: 30000,
          manifestLoadingMaxRetry: 2,
          manifestLoadingRetryDelay: 2000
        });
        p.hls = hls;
        // Uzoq kutishda ekran jim qolmasin: birinchi ochilish sekinligi
        // nosozlik emas, kamerani uyg'otish narxi. Buni aytib turish
        // "ishlamayapti" degan xulosaning oldini oladi.
        const bosqichlar = [
          [6000, "Kamera uyg'otilmoqda…"],
          [15000, "Kamera uyg'onmoqda — birinchi ochilish sekinroq…"],
          [30000, "Hali ham kutilmoqda (uzoq keyframe oralig'i)…"]
        ];
        const kutishTimerlari = bosqichlar.map(([ms, matn]) =>
          setTimeout(() => { if (!staleFn()) setMsg(matn, "wait"); }, ms));
        const kutishniTozala = () => kutishTimerlari.forEach(clearTimeout);
        p.onCleanup = kutishniTozala;

        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          kutishniTozala();
          if (!staleFn()) video.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_, d) => {
          if (!d.fatal || staleFn()) return;
          kutishniTozala();
          // Sub oqimda har qanday jiddiy xato — asosiyga qaytish sababi
          // (sub yo'l NVR'da o'chirilgan bo'lishi mumkin).
          if (onFail && (d.type === Hls.ErrorTypes.MEDIA_ERROR || p.mode === "sub")) {
            hls.destroy(); onFail(); return;
          }
          setMsg(FAIL_MSG, "fail");
        });
      } else if (isHls && video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        video.addEventListener("loadedmetadata", () => {
          if (!staleFn()) video.play().catch(() => {});
        }, { once: true });
        video.onerror = () => { if (!staleFn()) setMsg(FAIL_MSG, "fail"); };
      } else {
        video.src = url;
        video.onerror = () => { if (!staleFn()) setMsg(FAIL_MSG, "fail"); };
        video.play().catch(() => {});
      }
    }
  };
  return p;
}

/* Kamerani oldindan uyg'otish — sichqoncha kelganda yo'l va surat tayyorlanadi.
   Ikkita qoida bor, ikkalasi ham tasvir qotishiga qarshi:

   1. Oqimning O'ZI bu yerda ochilmaydi. Ilgari HLS pleylisti ham so'ralardi;
      MediaMTX esa talab bo'yicha yo'lni shu so'rovda tortishni boshlaydi va
      keyin uni ushlab turadi. Natijada markerlar yoki ro'yxat ustidan
      sichqoncha o'tib ketishining o'zi o'nlab to'liq sifatli oqimni ochib
      yuborardi: WAN kanali to'yinadi, registrator RTP paketlarini tashlaydi
      va hamma kamerada tasvir qotadi. Chipta so'rovi esa arzon — u faqat
      yo'lni sozlaydi va kameradan keyframe so'raydi.

   2. Kutish (hover intent): sichqoncha shunchaki o'tib ketsa hech narsa
      qilinmaydi — faqat bir joyda to'xtalganda uyg'otiladi. */
const warmed = new Map();
let warmTimer = null;
const PREWARM_DELAY = 350;                    // ms — shunchaki o'tib ketish sanalmaydi

function prewarm(cam) {
  clearTimeout(warmTimer);                    // oldingi nishon bekor qilinadi
  warmTimer = setTimeout(() => {
    const last = warmed.get(cam.id) || 0;
    if (Date.now() - last < 30000) return;
    warmed.set(cam.id, Date.now());
    fetch("/api/cameras/" + cam.id + "/snapshot", { cache: "no-store" }).catch(() => {});
    api("/api/cameras/" + cam.id + "/stream?hevc=" + (HEVC_OK ? 1 : 0)).catch(() => {});
  }, PREWARM_DELAY);
}

/* ---------- Tanlangan kamera paneli ---------- */
let selPlayer = null;

function fmtLastSeen(iso) {
  if (!iso) return "ma'lum emas";
  const t = new Date(iso);
  if (isNaN(t)) return "ma'lum emas";
  const diff = (Date.now() - t.getTime()) / 1000;
  if (diff < 90) return "hozirgina";
  if (diff < 3600) return Math.round(diff / 60) + " daqiqa oldin";
  if (diff < 86400) return Math.round(diff / 3600) + " soat oldin";
  const p = (n) => String(n).padStart(2, "0");
  return p(t.getDate()) + "." + p(t.getMonth() + 1) + "." + t.getFullYear() +
         " " + p(t.getHours()) + ":" + p(t.getMinutes());
}

function selectCamera(id, fly) {
  state.selectedId = id;
  const cam = state.byId.get(id);
  if (!cam) return;
  // Boshqa tab'dan kelinsa avval xaritaga o'tamiz — showTab o'zi qayta chaqiradi.
  if (state.tab !== "map") { showTab("map"); return; }
  if (fly !== false && hasGeo(cam)) map.flyTo([cam.lat, cam.lng], Math.max(map.getZoom(), 13), { duration: 0.6 });

  setSelOpen(true);
  if (MOBILE.matches) setListOpen(false);
  updateSelHead();
  renderList();
  refreshMarkerIcons();

  const video = $("sel-video");
  video.poster = "";
  video.poster = "/api/cameras/" + cam.id + "/snapshot?" + Date.now();
  if (!selPlayer) selPlayer = createPlayer(video, $("sel-msg"));
  selPlayer.onOpen = (ms, mode) => {
    $("sel-f-open").textContent = (ms / 1000).toFixed(2).replace(".", ",") + " s";
    const modeText = { raw: "xom H.265", direct: "to'g'ridan-to'g'ri",
                       transcode: "H.264 ga o'girilgan", manual: "tashqi oqim" }[mode] || mode;
    $("sel-f-mode").textContent = cam.always_on ? "doim tayyor" : modeText;
    addEvent(cam.name + " — oqim ochildi (" + (ms / 1000).toFixed(1) + " s)", "ok");
  };
  $("sel-f-open").innerHTML = "&mdash;";
  selPlayer.open(cam, HEVC_OK);
  // O'chiq kamera — kutish o'rniga darhol sabab ko'rsatiladi (oqim baribir
  // sinab ko'riladi: tekshiruv 60 soniya eskirgan bo'lishi mumkin).
  if (cam.online === false) {
    selPlayer.setMsg("Kamera o'chiq · oxirgi onlayn: " + fmtLastSeen(cam.last_seen), "wait");
  }
  renderFootStats();
}

/* Keng ekranda panel doim ko'rinadi: tanlov bo'lmasa o'rniga yo'riqnoma
   turadi. Tor ekranda u xarita ustida suzadi — faqat tanlov bo'lsa
   ko'rinadi (body.has-sel, style.css). */
function setSelOpen(open) {
  $("sel-body").hidden = !open;
  $("sel-empty").hidden = open;
  document.body.classList.toggle("has-sel", open);
}

function updateSelHead() {
  const cam = state.byId.get(state.selectedId);
  if (!cam) { setSelOpen(false); return; }
  const down = cam.online === false;
  $("sel-name").textContent = cam.name;
  $("sel-sub").textContent = "ID " + cam.id + (cam.external_id ? " · " + cam.external_id : "");
  document.querySelector(".sp-st").classList.toggle("down", down);
  $("sel-badge").classList.toggle("down", down);
  $("sel-badge-tx").textContent = down ? "Uzilgan" : "Onlayn";
  $("sel-badge-2").textContent = down ? "OFFLINE" : "LIVE";
  $("sel-f-region").textContent = cam.region || "—";
  $("sel-f-res").textContent = cam.resolution || "—";
  $("sel-f-seen").textContent = down ? fmtLastSeen(cam.last_seen) : "hozirgina";
  $("sel-f-codec").textContent = cam.codec || "—";
  $("sel-f-mode").textContent = cam.always_on ? "doim tayyor" : "so'rov bo'yicha";
  const p = (n) => String(n).padStart(2, "0");
  const now = new Date();
  $("sel-stamp").textContent = p(now.getDate()) + "-" + p(now.getMonth() + 1) + "-" +
    now.getFullYear() + " " + p(now.getHours()) + ":" + p(now.getMinutes());
}

function closeSel() {
  state.selectedId = null;
  setSelOpen(false);
  if (selPlayer) selPlayer.stop();
  renderList();
  refreshMarkerIcons();
  renderFootStats();
}
$("sel-close").addEventListener("click", closeSel);

$("sel-full").addEventListener("click", () => {
  const v = $("sel-video");
  (v.requestFullscreen || v.webkitEnterFullscreen || function(){}).call(v);
});

$("sel-shot").addEventListener("click", () => {
  const cam = state.byId.get(state.selectedId);
  if (cam) saveSnapshot(cam);
});
$("sel-edit").addEventListener("click", async () => {
  const cam = state.byId.get(state.selectedId);
  if (!cam) return;
  if (!state.admin) { toast("Avval super-admin sifatida kiring", true); return; }
  // Shakl to'liq yozuvni talab qiladi (IP, login, yo'l) — uni admin API dan
  // nomi bo'yicha qidirib olamiz; topilmasa boshqaruv bo'limiga o'tkazamiz.
  try {
    const res = await api("/api/admin/cameras?q=" + encodeURIComponent(cam.name) +
                          "&limit=50&offset=0");
    const full = (res.cameras || []).find((c) => c.id === cam.id);
    if (full) { openCameraForm(full); return; }
  } catch (e) { /* pastda boshqaruvga o'tamiz */ }
  toast("Kamera yozuvi topilmadi — boshqaruv bo'limidan tahrirlang", true);
  showTab("admin");
});
$("sel-center").addEventListener("click", () => {
  const cam = state.byId.get(state.selectedId);
  if (cam && hasGeo(cam)) map.flyTo([cam.lat, cam.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
  else if (cam) toast("Bu kameraga koordinata kiritilmagan", true);
});

$("sel-wall").addEventListener("click", () => {
  const id = state.selectedId;
  if (id && !state.pinned.includes(id)) state.pinned.push(id);
  showTab("wall");
});

/* ---------- Video devor ---------- */
let wallPlayers = [];
let wallAutoTimer = null;
const wallTiles = new Map();   // kamera id → { tile, player, down }

/* Devor sozlamalari brauzerda saqlanadi — qayta ochilganda tiklanadi. */
function saveWallPrefs() {
  try {
    localStorage.setItem("nigoh-wall", JSON.stringify({
      size: state.wallSize, fit: state.wallFit, interval: state.wallInterval,
      region: state.wallRegion, auto: state.wallAuto
    }));
  } catch (e) {}
}
function loadWallPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem("nigoh-wall") || "{}");
    if ([2, 3, 4, 6, 8].includes(p.size)) state.wallSize = p.size;
    if (p.fit === "cover" || p.fit === "contain") state.wallFit = p.fit;
    if (typeof p.region === "string") state.wallRegion = p.region;
    if (Number(p.interval) >= 5) state.wallInterval = Number(p.interval);
    state.wallAuto = !!p.auto;
  } catch (e) {}
  document.querySelectorAll("#wall-sizes button").forEach((b) =>
    b.classList.toggle("on", Number(b.dataset.wsize) === state.wallSize));
}
loadWallPrefs();

/* Devorga tushadigan kameralar: biriktirilganlar oldinda, keyin qolganlar. */
function wallCams() {
  const seen = new Set();
  const out = [];
  const fits = (cam) =>
    !state.wallHidden.has(cam.id) &&
    (!state.wallRegion || cam.region === state.wallRegion);
  state.pinned.forEach((id) => {
    const cam = state.byId.get(id);
    if (cam && !seen.has(id) && fits(cam)) { seen.add(id); out.push(cam); }
  });
  state.cameras.forEach((cam) => {
    if (!seen.has(cam.id) && cam.online !== false && fits(cam)) {
      seen.add(cam.id); out.push(cam);
    }
  });
  return out;
}

function fillWallRegions() {
  const sel = $("wall-region");
  const regions = [...new Set(state.cameras.map((c) => c.region))].sort();
  const cur = state.wallRegion;
  sel.innerHTML = '<option value="">Barcha hududlar</option>' +
    regions.map((r) => '<option value="' + esc(r) + '"' +
      (r === cur ? " selected" : "") + ">" + esc(r) + "</option>").join("");
  if (cur && !regions.includes(cur)) { state.wallRegion = ""; sel.value = ""; }
}

function buildWall() {
  clearInterval(wallAutoTimer);
  wallAutoTimer = null;
  fillWallRegions();
  const all = wallCams();
  const slots = state.wallSize * state.wallSize;
  const pages = Math.max(1, Math.ceil(all.length / slots));
  state.wallPage = Math.min(state.wallPage, pages - 1);
  const cams = all.slice(state.wallPage * slots, state.wallPage * slots + slots);

  const grid = $("wall-grid");
  grid.classList.toggle("cover", state.wallFit === "cover");
  // Setka kamera soniga moslashadi: 2 ta kamera 2×2 katakka qisilmaydi,
  // butun ekranni to'ldiradi. Tanlangan o'lcham — yuqori chegara.
  const n = Math.max(1, cams.length);
  const cols = Math.min(state.wallSize, Math.ceil(Math.sqrt(n)));
  const rows = Math.min(state.wallSize, Math.ceil(n / cols));
  grid.style.gridTemplateColumns = "repeat(" + cols + ",1fr)";
  grid.style.gridTemplateRows = "repeat(" + rows + ",1fr)";

  $("wall-label").textContent = state.wallSize + "×" + state.wallSize + " setka · " +
    all.length + " kamera" +
    (state.wallRegion ? " · " + state.wallRegion : "") +
    (state.pinned.length ? " · " + state.pinned.length + " biriktirilgan" : "");
  $("wall-page").textContent = (state.wallPage + 1) + " / " + pages;
  $("wall-prev").disabled = state.wallPage === 0;
  $("wall-next").disabled = state.wallPage >= pages - 1;
  $("wall-fit").textContent = state.wallFit === "cover" ? "Katakni to'ldirish" : "Butun ko'rinish";
  $("wall-auto").classList.toggle("on", state.wallAuto);
  $("wall-auto").setAttribute("aria-checked", state.wallAuto ? "true" : "false");
  $("wall-interval").value = String(state.wallInterval);
  const upNow = cams.filter((c) => c.online !== false).length;
  $("wall-live").textContent = "Sahifada " + upNow + " / " + cams.length + " onlayn";
  const bad = cams.length - upNow;
  const conn = $("wall-conn");
  conn.textContent = bad === 0 ? "Ulanish barqaror"
    : bad === cams.length ? "Ulanish yo'q" : bad + " ta kamerada uzilish";
  const p2 = (x) => String(x).padStart(2, "0");
  const nw = new Date();
  $("wall-upd").textContent = p2(nw.getHours()) + ":" + p2(nw.getMinutes()) + ":" + p2(nw.getSeconds());

  // Diff: bor plitkalar qayta ishlatiladi (oqim uzilmaydi), ketganlari
  // to'xtatiladi, yangilari yaratiladi, tartib DOM'da to'g'rilanadi.
  const want = new Set(cams.map((c) => c.id));
  wallTiles.forEach((t, id) => {
    const cam = state.byId.get(id);
    const stillOk = want.has(id) && cam && (cam.online === false) === t.down;
    if (!stillOk) { if (t.player) t.player.stop(); t.tile.remove(); wallTiles.delete(id); }
  });
  grid.querySelectorAll(".empty").forEach((e) => e.remove());
  if (!cams.length) {
    grid.insertAdjacentHTML("beforeend",
      '<div class="empty" style="grid-column:1/-1">Ko‘rsatiladigan kamera yo‘q.</div>');
  }

  cams.forEach((cam, i) => {
    let t = wallTiles.get(cam.id);
    if (!t) { t = makeTile(cam); wallTiles.set(cam.id, t); }
    // Yengil yangilanishlar: biriktirilganlik va tanlanganlik.
    t.tile.querySelector('[data-w="pin"]').classList.toggle("on", state.pinned.includes(cam.id));
    t.tile.classList.toggle("sel", cam.id === state.selectedId);
    if (grid.children[i] !== t.tile) grid.insertBefore(t.tile, grid.children[i] || null);
  });
  wallPlayers = [...wallTiles.values()].map((t) => t.player).filter(Boolean);
  renderFootStats();
  syncWallAuto();
}

/* Kamera suratini faylga saqlash (plitka va tafsilot panelidan). */
async function saveSnapshot(cam) {
  try {
    const blob = await (await fetch("/api/cameras/" + cam.id + "/snapshot")).blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = cam.name.replace(/[^\w\-]+/g, "_") + ".jpg";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Surat saqlandi");
  } catch (e) { toast("Surat olinmadi", true); }
}

/* Bitta plitka: video, ustki/ostki yozuvlar, tugmalar va pleyer. */
function makeTile(cam) {
  const down = cam.online === false;
  const tile = document.createElement("div");
  tile.className = "tile" + (down ? " down" : "");
  tile.innerHTML =
    '<video muted playsinline poster="/api/cameras/' + cam.id + '/snapshot"></video>' +
    '<div class="t-msg"></div>' +
    '<div class="t-head"><i></i><span class="nm">' + esc(cam.name) + "</span>" +
      // Ba'zi bazalarda hudud nomi kamera nomi bilan bir xil — ikki marta yozmaymiz.
      (cam.region && cam.region !== cam.name
        ? '<span class="rg">' + esc(cam.region) + "</span>" : "") +
      '<span class="st">' + (down ? "OFFLINE" : "LIVE") + "</span></div>" +
    '<div class="t-btns">' +
      '<button data-w="pin" title="Devorga biriktirish">' + ICO.star + "</button>" +
      '<button data-w="map" title="Xaritada ko\'rsatish">' + ICO.pin + "</button>" +
      '<button data-w="shot" title="Suratini yuklab olish">' + ICO.down + "</button>" +
      '<button data-w="full" title="To\'liq ekran">' + ICO.full + "</button>" +
      '<button data-w="x" title="Devordan olish">' + ICO.close + "</button>" +
    "</div>" +
    '<div class="t-foot"><span>' + esc(cam.codec || "") + "</span>" +
      '<span style="margin-left:auto"></span></div>';

  const on = (act, fn) => tile.querySelector('[data-w="' + act + '"]')
    .addEventListener("click", (e) => { e.stopPropagation(); fn(); });
  on("pin", () => {
    state.pinned = state.pinned.includes(cam.id)
      ? state.pinned.filter((x) => x !== cam.id) : [cam.id, ...state.pinned];
    buildWall();
  });
  on("map", () => selectCamera(cam.id, true));
  on("shot", () => saveSnapshot(cam));
  // Plitkaning o'zi to'liq ekranga chiqadi — nomi, LIVE belgisi va
  // pastki ma'lumotlar saqlanib qoladi. Qayta bosish/ESC — chiqish.
  const goFull = () => {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    const v = tile.querySelector("video");
    if (tile.requestFullscreen) tile.requestFullscreen();
    else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
  };
  on("full", goFull);
  on("x", () => {
    state.wallHidden.add(cam.id);
    state.pinned = state.pinned.filter((x) => x !== cam.id);
    buildWall();
  });
  // Bir bosish — devorda ajratib ko'rsatish (xaritaga o'tmaydi, oqimlar
  // uzilmaydi); ikki bosish — to'liq ekran; xaritaga «◎» tugmasi.
  tile.addEventListener("click", () => {
    state.selectedId = cam.id;
    wallTiles.forEach((t, id) => t.tile.classList.toggle("sel", id === cam.id));
    refreshMarkerIcons();
  });
  tile.addEventListener("dblclick", goFull);

  let player = null;
  if (!down) {
    player = createPlayer(tile.querySelector("video"), tile.querySelector(".t-msg"));
    const msEl = tile.querySelector(".t-foot span:last-child");
    player.onOpen = (ms) => { msEl.textContent = (ms / 1000).toFixed(2) + "s"; };
    // Setkada past sifatli 2-oqim (sub) — 16 plitka tarmoqni bo'g'masin.
    // Sub bo'lmasa server asosiysini beradi; to'liq ekranda asosiyga o'tiladi.
    player.open(cam, HEVC_OK, "sub");
    tile.addEventListener("fullscreenchange", () => {
      player.open(cam, HEVC_OK, document.fullscreenElement === tile ? "" : "sub");
    });
  } else {
    tile.querySelector(".t-msg").textContent = "ulanish yo'q";
  }
  return { tile, player, down };
}

function stopWall() {
  wallTiles.forEach((t) => { if (t.player) t.player.stop(); t.tile.remove(); });
  wallTiles.clear();
  wallPlayers = [];
  clearInterval(wallAutoTimer);
  wallAutoTimer = null;
  renderFootStats();
}

/* Avto-aylanish: bir necha sahifa bo'lsa, har 12 soniyada keyingisiga o'tadi. */
function syncWallAuto() {
  clearInterval(wallAutoTimer);
  wallAutoTimer = null;
  if (!state.wallAuto || state.tab !== "wall") return;
  wallAutoTimer = setInterval(() => {
    const pages = Math.max(1, Math.ceil(wallCams().length /
      (state.wallSize * state.wallSize)));
    if (pages < 2) return;
    state.wallPage = (state.wallPage + 1) % pages;
    buildWall();
  }, Math.max(5, state.wallInterval) * 1000);
}

document.querySelectorAll("#wall-sizes button").forEach((b) =>
  b.addEventListener("click", () => {
    state.wallSize = Number(b.dataset.wsize);
    state.wallPage = 0;
    document.querySelectorAll("#wall-sizes button").forEach((x) =>
      x.classList.toggle("on", x === b));
    saveWallPrefs();
    buildWall();
  }));
$("wall-region").addEventListener("change", (e) => {
  state.wallRegion = e.target.value;
  state.wallPage = 0;
  saveWallPrefs();
  buildWall();
});
$("wall-fit").addEventListener("click", () => {
  state.wallFit = state.wallFit === "cover" ? "contain" : "cover";
  saveWallPrefs();
  buildWall();
});
$("wall-auto").addEventListener("click", () => {
  state.wallAuto = !state.wallAuto;
  saveWallPrefs();
  buildWall();
});
$("wall-interval").addEventListener("change", (e) => {
  state.wallInterval = Number(e.target.value) || 12;
  saveWallPrefs();
  syncWallAuto();
});
/* Devorni to'liq ekranga chiqarish — sarlavha va boshqaruvlar bilan birga. */
$("wall-fs").addEventListener("click", () => {
  if (document.fullscreenElement) { document.exitFullscreen(); return; }
  const el = $("wall-view");
  if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
});
$("wall-prev").addEventListener("click", () => {
  state.wallPage = Math.max(0, state.wallPage - 1);
  buildWall();
});
$("wall-next").addEventListener("click", () => {
  state.wallPage++;
  buildWall();
});
// Devorda ← → sahifalarni almashtiradi (matn maydonida bo'lmasa).
document.addEventListener("keydown", (e) => {
  if (state.tab !== "wall" || document.querySelector(".backdrop.open, .login-screen.open")) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
  if (e.key === "ArrowRight" && !$("wall-next").disabled) $("wall-next").click();
  if (e.key === "ArrowLeft" && !$("wall-prev").disabled) $("wall-prev").click();
});

/* ---------- Dashboard ---------- */
function addEvent(text, kind) {
  state.events.unshift({ t: Date.now(), text, kind });
  if (state.events.length > 50) state.events.pop();
  renderEvents();
}

/* KPI qiymati: ma'lumot bo'lmasa "—" yoziladi va yonidagi birlik
   ("s", "ta") yashiriladi — "— s" degan g'alati yozuv chiqmasin. */
function setKpi(id, value) {
  const el = $(id);
  el.textContent = value == null ? "—" : value;
  const unit = el.nextElementSibling;
  if (unit && unit.classList.contains("u")) unit.hidden = value == null;
}

/* O'zgarish belgisi: musbat/manfiy va yaxshi/yomon tomon. `higherIsBetter`
   onlaynlik uchun true, uzilishlar uchun false. Ma'lumot yo'q bo'lsa bo'sh. */
function setDelta(id, diff, unit, higherIsBetter) {
  const el = $(id);
  if (diff == null || !isFinite(diff)) { el.textContent = ""; el.className = "kp-d"; return; }
  const rounded = Math.round(diff);
  if (rounded === 0) {
    el.textContent = "o'zgarishsiz";
    el.className = "kp-d flat";
    return;
  }
  const good = higherIsBetter ? rounded > 0 : rounded < 0;
  el.textContent = (rounded > 0 ? "▲ +" : "▼ ") + rounded + unit;
  el.className = "kp-d " + (good ? "up" : "down");
}

function renderDashMetrics() {
  const total = state.cameras.length;
  const on = state.cameras.filter((c) => c.online === true).length;
  const off = state.cameras.filter((c) => c.online === false).length;
  $("m-total").textContent = total;
  $("m-total-note").textContent = new Set(state.cameras.map((c) => c.region)).size + " hududda";
  const pctOn = total ? Math.round((on / total) * 100) : 0;
  $("m-online").textContent = total ? pctOn + "%" : "—";
  $("m-online-n").textContent = on;
  $("m-online-note").textContent = "Hozirda faol kameralar";
  $("m-online-bar").style.width = pctOn + "%";
  const pctOff = total ? Math.round((off / total) * 100) : 0;
  $("m-down-pct").textContent = total ? pctOff + "%" : "—";
  $("m-down-bar").style.width = pctOff + "%";
  setKpi("m-ev", state.stats ? state.stats.events_today : null);

  // Taqqoslashlar faqat haqiqiy tarixdan: onlaynlik 24 soat oldingi
  // o'lchov bilan, bugungi uzilishlar kechagi kun bilan solishtiriladi.
  const tlAll = (state.stats && state.stats.timeline) || [];
  const first = tlAll.find((p) => p.total > 0);
  setDelta("m-online-d", first
    ? pctOn - Math.round((first.online / first.total) * 100) : null, "%", true);
  const d = (state.stats && state.stats.daily) || [];
  const yest = d.length > 1 ? d[d.length - 2].events : null;
  setDelta("m-ev-d", yest == null || !state.stats
    ? null : state.stats.events_today - yest, "", false);
  $("m-ev-note").textContent = state.stats
    ? (state.stats.events_today ? "bugun qayd etilgan" : "bugun uzilish yo'q")
    : "tarix yuklanmoqda…";
  const now = new Date(), pd = (n) => String(n).padStart(2, "0");
  $("dash-upd").textContent = pd(now.getHours()) + ":" + pd(now.getMinutes()) + ":" + pd(now.getSeconds());
  const t = state.openTimes;
  setKpi("m-open", t.length
    ? (t.reduce((s, v) => s + v, 0) / t.length / 1000).toFixed(2).replace(".", ",")
    : null);
  $("m-open-note").textContent = t.length
    ? "shu seansda " + t.length + " o'lchov" : "hali oqim ochilmadi";
  $("m-down").textContent = off;
  $("m-down-note").textContent = off ? "Tekshirish talab qiladi"
    : state.stats ? "bugun " + state.stats.events_today + " ta uzilish"
    : "hammasi joyida";
  renderDonut();
  renderSpark();
}

/* Holat taqsimoti — donut. Markazda bosh ko'rsatkich: onlayn foizi. */
function renderDonut() {
  const on = state.cameras.filter((c) => c.online === true).length;
  const off = state.cameras.filter((c) => c.online === false).length;
  const unk = state.cameras.length - on - off;
  const total = state.cameras.length || 1;
  const parts = [
    { label: "Onlayn", n: on, color: "var(--ok)" },
    { label: "Uzilgan", n: off, color: "var(--danger)" },
    { label: "Noma'lum", n: unk, color: "var(--faint)" },
  ].filter((p) => p.n > 0);

  const R = 46, C = 2 * Math.PI * R;
  const gap = parts.length > 1 ? 3 : 0;   // segmentlar orasidagi "havo"
  let acc = 0;
  const segs = parts.map((p) => {
    const frac = p.n / total;
    const len = Math.max(C * frac - gap, 0.5);
    const s = '<circle cx="60" cy="60" r="' + R + '" fill="none" pathLength="' + C.toFixed(2) +
      '" style="stroke:' + p.color + ';stroke-width:13" stroke-dasharray="' +
      len.toFixed(2) + " " + C.toFixed(2) + '" stroke-dashoffset="' + (-acc - gap / 2).toFixed(2) +
      '" transform="rotate(-90 60 60)"><title>' + p.label + ": " + p.n + " ta</title></circle>";
    acc += C * frac;
    return s;
  }).join("");
  const pct = Math.round((on / total) * 100);
  $("donut").innerHTML = segs +
    '<text x="60" y="58" text-anchor="middle" style="font:700 23px var(--font),sans-serif;fill:var(--text)">' + pct + "%</text>" +
    '<text x="60" y="76" text-anchor="middle" style="font:700 8.5px var(--font),sans-serif;letter-spacing:.1em;fill:var(--faint)">ONLAYN</text>';
  $("donut-legend").innerHTML = parts.map((p) =>
    '<div class="dl"><i style="background:' + p.color + '"></i>' + p.label +
    " <b>" + p.n + " ta</b></div>").join("");
}

/* Ochilish vaqtlari sparkline'i — seansdagi so'nggi 24 o'lchov. */
function renderSpark() {
  const el = $("m-open-spark");
  const data = state.openTimes.slice(-24);
  if (data.length < 2) { el.innerHTML = ""; return; }
  const W = 200, H = 30, P = 4;
  const max = Math.max(...data), min = Math.min(...data);
  const x = (i) => P + (W - 2 * P) * i / (data.length - 1);
  const y = (v) => max === min ? H / 2 : H - P - (H - 2 * P) * (v - min) / (max - min);
  const pts = data.map((v, i) => x(i).toFixed(1) + "," + y(v).toFixed(1)).join(" ");
  const lx = x(data.length - 1).toFixed(1), ly = y(data[data.length - 1]).toFixed(1);
  el.innerHTML =
    '<polygon points="' + P + "," + (H - P) + " " + pts + " " + lx + "," + (H - P) +
      '" style="fill:var(--accent);opacity:.1"/>' +
    '<polyline points="' + pts + '" vector-effect="non-scaling-stroke" ' +
      'style="fill:none;stroke:var(--accent);stroke-width:2;stroke-linejoin:round;stroke-linecap:round"/>' +
    '<circle cx="' + lx + '" cy="' + ly + '" r="3.5" style="fill:var(--accent);stroke:var(--surface-2);stroke-width:2"/>';
}

function renderDash() {
  renderDashMetrics();
  renderSystem();
  renderAttention();
  renderToday();
  renderFlapping();
  renderRegions();
  renderTech();
  renderSlow();
  renderEvents();
  renderTimeline();
  renderDailyCharts();
  renderHourly();
  loadStats();
}

/* Tarixiy statistika serverdan olinadi — kelgach grafiklar qayta chiziladi. */
let statsLoading = false;
async function loadStats() {
  if (statsLoading) return;
  statsLoading = true;
  try {
    state.stats = await api("/api/stats/dashboard");
    if (state.tab === "dash") {
      renderDashMetrics();
      renderRegions();
      renderEvents();
      renderTimeline();
      renderDailyCharts();
      renderHourly();
    }
  } catch (e) { /* endpoint bo'lmasa — jonli qism ishlayveradi */ }
  statsLoading = false;
}

/* Hududlar jadvali: joriy holat + 24 soatlik o'rtacha + bugungi uzilishlar. */
function renderRegions() {
  // Tartib: ko'p uzilgani tepada — operator muammodan boshlaydi.
  const downBy = new Map();
  state.cameras.forEach((c) => {
    if (c.online === false) downBy.set(c.region, (downBy.get(c.region) || 0) + 1);
  });
  const regions = [...new Set(state.cameras.map((c) => c.region))]
    .sort((x, y) => (downBy.get(y) || 0) - (downBy.get(x) || 0) || x.localeCompare(y, "uz"));
  const rstats = new Map(
    ((state.stats && state.stats.regions) || []).map((r) => [r.region, r]));
  const head = '<div class="rrow head"><span class="nn">#</span><span class="rg">Hudud</span>' +
    '<span class="bar-h">Onlaynlik</span><span class="lb">Onlayn</span>' +
    '<span class="lb2" title="24 soatlik o\'rtacha onlayn">24s</span>' +
    '<span class="lb2" title="Bugungi uzilish hodisalari">Uzil.</span></div>';
  $("region-rows").innerHTML = head + regions.map((region, idx) => {
    const list = state.cameras.filter((c) => c.region === region);
    const up = list.filter((c) => c.online !== false).length;
    const pct = list.length ? Math.round((up / list.length) * 100) : 0;
    const color = pct === 100 ? "var(--ok)" : pct >= 60 ? "var(--accent)" : "var(--danger)";
    const st = rstats.get(region);
    const up24 = st && st.uptime24 != null ? Math.round(st.uptime24) + "%" : "—";
    const ev = st ? st.events_today : null;
    return '<div class="rrow click" data-region="' + esc(region) + '">' +
      '<span class="nn">' + (idx + 1) + "</span>" +
      '<span class="rg">' + esc(region) + "</span>" +
      '<div class="bar"><i style="width:' + pct + "%;background:" + color + '"></i></div>' +
      '<span class="lb">' + up + "/" + list.length + " · " + pct + "%</span>" +
      '<span class="lb2">' + up24 + "</span>" +
      '<span class="lb2' + (ev ? " bad" : "") + '">' +
        (ev == null ? "—" : ev ? ev + "&darr;" : "0") + "</span></div>";
  }).join("");
  // Hudud qatori bosilsa — xaritaga o'tib, o'sha hudud kameralari ko'rsatiladi.
  document.querySelectorAll("#region-rows .rrow.click").forEach((row) =>
    row.addEventListener("click", () => {
      const region = row.dataset.region;
      showTab("map");
      setQuery(region, null, true);
      const pts = state.cameras.filter((c) => c.region === region && hasGeo(c));
      if (pts.length) {
        const b = L.latLngBounds(pts.map((c) => [c.lat, c.lng]));
        map.fitBounds(b.pad(0.35));
      }
    }));
}

/* Texnik kesim: kodeklar, o'girish va rejimlar taqsimoti. */
function renderTech() {
  const total = state.cameras.length || 1;
  // Bitta o'lchov (ulush) — bitta rang: qatorlar yorliq bilan farqlanadi.
  const groups = [
    ["H.265 xom (o'girishsiz)", state.cameras.filter((c) => /h265|hevc/i.test(c.codec || "") && !c.transcode).length, "var(--accent)"],
    ["H.265 → H.264 o'girish", state.cameras.filter((c) => c.transcode).length, "var(--accent)"],
    ["H.264 to'g'ridan-to'g'ri", state.cameras.filter((c) => /h264|avc/i.test(c.codec || "") && !c.transcode).length, "var(--accent)"],
    ["Doim tayyor rejimda", state.cameras.filter((c) => c.always_on).length, "var(--accent)"],
  ];
  $("tech-rows").innerHTML = groups.map(([label, n, color]) => {
    const pct = Math.round((n / total) * 100);
    return '<div class="rrow"><span class="rg wide">' + label + "</span>" +
      '<div class="bar"><i style="width:' + pct + "%;background:" + color + '"></i></div>' +
      '<span class="lb">' + n + " ta · " + pct + "%</span></div>";
  }).join("");
}

/* Bugungi tahlil: KPI'larda yo'q, xulosa talab qiladigan faktlar. */
function renderToday() {
  const box = $("today-facts");
  const st = state.stats;
  if (!st) { box.innerHTML = '<div class="empty">Tarix yuklanmoqda\u2026</div>'; return; }
  const p2 = (n) => String(n).padStart(2, "0");

  // Eng ko'p uzilish qayd etilgan soat.
  const hrs = st.hourly_today || [];
  let peakH = -1;
  hrs.forEach((v, i) => { if (v > 0 && (peakH < 0 || v > hrs[peakH])) peakH = i; });

  // Eng ko'p uzilish bo'lgan hudud.
  const worst = (st.regions || []).filter((x) => x.events_today)
    .sort((x, y) => y.events_today - x.events_today)[0];

  // Bugun qayta ulangan kameralar (hodisalar lentasidan).
  const today = new Date().toDateString();
  const back = (st.events || []).filter((e) =>
    e.kind !== "offline" && new Date(e.ts).toDateString() === today).length;

  // Sutkadagi eng past onlaynlik nuqtasi.
  const tl = (st.timeline || []).filter((x) => x.total > 0);
  let low = null;
  tl.forEach((x) => {
    const v = x.online / x.total;
    if (!low || v < low.v) low = { v: v, ts: x.ts };
  });
  const lowD = low ? new Date(low.ts) : null;

  const facts = [
    ["Eng ko'p uzilish soati",
     peakH < 0 ? "Uzilish yo'q" : p2(peakH) + ":00",
     peakH < 0 ? "ok" : "warn",
     peakH < 0 ? "" : hrs[peakH] + " ta uzilish"],
    ["Eng muammoli hudud", worst ? worst.region : "Yo'q", worst ? "bad" : "ok",
     worst ? worst.events_today + " ta uzilish" : ""],
    ["Bugun qayta ulandi", back + " ta", back ? "ok" : "", "hodisalar lentasidan"],
    ["Sutkadagi eng past nuqta", low ? Math.round(low.v * 100) + "%" : "\u2014",
     low && low.v < 0.6 ? "bad" : "",
     lowD ? p2(lowD.getHours()) + ":" + p2(lowD.getMinutes()) + " da" : ""],
  ];
  box.innerHTML = facts.map((f) =>
    '<div class="fact"><div class="f-k">' + f[0] + "</div>" +
    '<div class="f-v ' + (f[2] || "") + '">' + esc(String(f[1])) + "</div>" +
    (f[3] ? '<div class="f-n">' + esc(f[3]) + "</div>" : "") + "</div>").join("");
}

/* Takroriy uzilishlar: hodisalar lentasida bir necha marta uchragan
   kameralar. Lenta 40 ta yozuvdan iborat, shuning uchun bu "eng ko'p
   uzilgan" emas, "so'nggi paytda takror uzilgan" ro'yxati. */
function renderFlapping() {
  const box = $("flap-rows");
  const evs = ((state.stats && state.stats.events) || []).filter((e) => e.kind === "offline");
  const cnt = new Map();
  evs.forEach((e) => {
    const key = e.name + " || " + (e.region || "");
    cnt.set(key, (cnt.get(key) || 0) + 1);
  });
  const rows = [...cnt.entries()].filter((p) => p[1] > 1)
    .sort((x, y) => y[1] - x[1]).slice(0, 8);
  if (!rows.length) {
    box.innerHTML = '<div class="empty">So\u2018nggi hodisalarda takror uzilgan kamera yo\u2018q.</div>';
    return;
  }
  const max = rows[0][1];
  box.innerHTML = rows.map((p) => {
    const name = p[0].split(" || ")[0];
    return '<div class="rrow"><span class="rg wide">' + esc(name) + "</span>" +
      '<div class="bar"><i style="width:' + Math.round((p[1] / max) * 100) +
      '%;background:var(--danger)"></i></div>' +
      '<span class="lb2 bad">' + p[1] + " marta</span></div>";
  }).join("");
}

/* Necha vaqtdan beri uzilgan: "7 soat", "2 kun". */
function fmtDuration(iso) {
  const t = Date.parse(iso);
  if (!t) return "noma'lum";
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 60) return min + " daqiqa";
  if (min < 1440) return Math.round(min / 60) + " soat";
  return Math.round(min / 1440) + " kun";
}

/* Diqqat talab qiladiganlar: uzilgan kameralar, eng uzoq turganidan
   boshlab. Operator ishini shu ro'yxatdan boshlaydi. */
function renderAttention() {
  const off = state.cameras.filter((c) => c.online === false)
    .sort((x, y) => (Date.parse(x.last_seen) || 0) - (Date.parse(y.last_seen) || 0));
  $("att-count").textContent = off.length ? off.length + " ta uzilgan" : "";
  if (!off.length) {
    $("att-rows").innerHTML =
      '<div class="empty">Hamma kamera onlayn — diqqat talab qiladigan kamera yo‘q.</div>';
    return;
  }
  $("att-rows").innerHTML = off.slice(0, 40).map((c) =>
    '<div class="rrow click att" data-id="' + c.id + '">' +
      '<span class="ln bad"></span>' +
      '<span class="tx"><b>' + esc(c.name) + "</b><i>" + esc(c.region || "") + "</i></span>" +
      '<span class="dur">' + fmtDuration(c.last_seen) + "</span></div>").join("");
  $("att-rows").querySelectorAll(".att").forEach((row) =>
    row.addEventListener("click", () => selectCamera(Number(row.dataset.id), true)));
}

/* Shu seansda o'lchangan oqim ochilish vaqtlari — sekinlari yuqorida. */
function renderSlow() {
  const rows = [...state.openByCam.entries()]
    .map(([id, ms]) => ({ cam: state.byId.get(id), ms }))
    .filter((r) => r.cam)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 8);
  const max = rows.length ? rows[0].ms : 1;
  $("slow-rows").innerHTML = rows.length ? rows.map((r) => {
    const sec = r.ms / 1000;
    const color = sec <= 2 ? "var(--ok)" : sec <= 5 ? "var(--warn)" : "var(--danger)";
    return '<div class="rrow"><span class="rg wide">' + esc(r.cam.name) + "</span>" +
      '<div class="bar"><i style="width:' + Math.max(6, Math.round((r.ms / max) * 100)) +
      "%;background:" + color + '"></i></div>' +
      '<span class="lb">' + sec.toFixed(2) + " s</span></div>";
  }).join("") : '<div class="empty">Hali oqim ochilmadi — kamera oching, o\'lchov shu yerda ko\'rinadi.</div>';
}

/* ---------- Grafiklar (SVG, kutubxonasiz) ----------
   Ranglar CSS o'zgaruvchilaridan olinadi — mavzu almashsa moslashadi. */

const chTip = $("chart-tip");
function chTipShow(value, label, cx, cy) {
  chTip.querySelector(".v").textContent = value;
  chTip.querySelector(".l").textContent = label;
  chTip.style.display = "block";
  const r = chTip.getBoundingClientRect();
  let x = cx + 14, y = cy - r.height - 12;
  if (x + r.width > innerWidth - 8) x = cx - r.width - 14;
  if (y < 8) y = cy + 16;
  chTip.style.left = x + "px";
  chTip.style.top = y + "px";
}
function chTipHide() { chTip.style.display = "none"; }

/* Ustuncha balandligi uchun "chiroyli" yuqori chegara: 4, 5, 10, 20, 50… */
function niceMax(v) {
  if (v <= 4) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

/* Usti 4px yumaloq, asosi tekis ustuncha (dataviz spetsifikatsiyasi). */
function colPath(x, w, yTop, yBase) {
  const r = Math.min(4, w / 2, Math.max(0, yBase - yTop));
  return "M" + x.toFixed(1) + "," + yBase.toFixed(1) +
    " L" + x.toFixed(1) + "," + (yTop + r).toFixed(1) +
    " Q" + x.toFixed(1) + "," + yTop.toFixed(1) + " " + (x + r).toFixed(1) + "," + yTop.toFixed(1) +
    " L" + (x + w - r).toFixed(1) + "," + yTop.toFixed(1) +
    " Q" + (x + w).toFixed(1) + "," + yTop.toFixed(1) + " " + (x + w).toFixed(1) + "," + (yTop + r).toFixed(1) +
    " L" + (x + w).toFixed(1) + "," + yBase.toFixed(1) + " Z";
}

/* Grafik davri tugmalari — 6 / 12 / 24 soat. */
document.querySelectorAll("#tl-range button").forEach((b) =>
  b.addEventListener("click", () => {
    state.tlHours = Number(b.dataset.h);
    document.querySelectorAll("#tl-range button").forEach((x) => x.classList.toggle("on", x === b));
    $("tl-sub").textContent = "So'nggi " + state.tlHours + " soat davomida tizim onlaynligi";
    renderTimeline();
  }));

/* Tanlangan davrdagi onlayn darajasi — maydonli chiziq, kursorda qiymat. */
function renderTimeline() {
  const svg = $("ch-timeline"), empty = $("ch-timeline-empty");
  // Tanlangan davr: so'nggi N soatlik o'lchovlar.
  const cutoff = Date.now() - state.tlHours * 3600e3;
  const data = ((state.stats && state.stats.timeline) || [])
    .filter((p) => p.total > 0 && Date.parse(p.ts) >= cutoff)
    .map((p) => ({ t: Date.parse(p.ts), online: p.online, total: p.total }));
  // Grafik ustidagi yig'ma ko'rsatkichlar: hozir / o'rtacha / eng past / o'lchov soni.
  const pcts = data.map((p) => (p.online / p.total) * 100);
  const fmtPct = (v) => Math.round(v) + "%";
  const setStat = (id, v, cls) => {
    const el = $(id); el.textContent = v; el.className = "v" + (cls ? " " + cls : "");
  };
  if (pcts.length) {
    const cur = pcts[pcts.length - 1], avg = pcts.reduce((a, b) => a + b, 0) / pcts.length,
          min = Math.min(...pcts);
    setStat("tl-now", fmtPct(cur), cur >= 90 ? "ok" : cur < 60 ? "bad" : "");
    setStat("tl-avg", fmtPct(avg), avg >= 90 ? "ok" : avg < 60 ? "bad" : "");
    setStat("tl-min", fmtPct(min), min < 60 ? "bad" : "");
    setStat("tl-n", String(pcts.length));
    // 7 kunlik o'rtacha — kunlik tarixdan (o'lchovsiz kunlar hisobga olinmaydi).
    const days = ((state.stats && state.stats.daily) || []).filter((d) => d.uptime != null);
    const wk = days.length ? days.reduce((s, d) => s + d.uptime, 0) / days.length : null;
    setStat("tl-week", wk == null ? "\u2014" : fmtPct(wk),
            wk == null ? "" : wk >= 90 ? "ok" : wk < 60 ? "bad" : "");
  } else {
    ["tl-now", "tl-avg", "tl-min", "tl-week", "tl-n"].forEach((id) => setStat(id, "—"));
  }
  if (data.length < 2) {
    svg.innerHTML = "";
    empty.textContent = "Tarix yig'ilmoqda — grafik dastlabki o'lchovlar to'plangach (~10 daqiqa) chiziladi.";
    empty.style.display = "flex";
    return;
  }
  empty.style.display = "none";
  const W = Math.max(320, Math.round(svg.clientWidth) || 640), H = 210;
  const L = 40, R = 18, T = 14, B = 26;
  svg.setAttribute("viewBox", "0 0 " + W + " " + H);
  const t0 = data[0].t, t1 = data[data.length - 1].t;
  const x = (t) => L + (W - L - R) * (t - t0) / Math.max(1, t1 - t0);
  const pctOf = (p) => (p.online / p.total) * 100;
  const y = (v) => T + (H - T - B) * (1 - v / 100);
  let out = "";
  [0, 25, 50, 75, 100].forEach((v) => {
    out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) +
           '" y2="' + y(v).toFixed(1) + '" stroke="var(--line-2)"/>';
    if (v % 50 === 0) out += '<text class="ch-tick" x="' + (L - 8) + '" y="' +
      (y(v) + 3.5).toFixed(1) + '" text-anchor="end">' + v + "%</text>";
  });
  // Vaqt belgilari qadami oraliqqa moslashadi: tarix hali qisqa bo'lsa
  // (server yangi ishga tushgan) 5-15 daqiqalik, to'liq sutkada 4 soatlik.
  const MIN = 60000;
  const step = [5 * MIN, 15 * MIN, 30 * MIN, 60 * MIN, 2 * 60 * MIN,
                4 * 60 * MIN, 6 * 60 * MIN]
    .find((s) => (t1 - t0) / s <= 6) || 6 * 60 * MIN;
  const pd2 = (n) => String(n).padStart(2, "0");
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
    const d = new Date(t);
    out += '<text class="ch-tick" x="' + x(t).toFixed(1) + '" y="' + (H - 8) +
      '" text-anchor="middle">' + pd2(d.getHours()) + ":" + pd2(d.getMinutes()) +
      "</text>";
  }
  const pts = data.map((p) => x(p.t).toFixed(1) + "," + y(pctOf(p)).toFixed(1)).join(" ");
  out += '<polygon points="' + x(t0).toFixed(1) + "," + y(0).toFixed(1) + " " + pts +
    " " + x(t1).toFixed(1) + "," + y(0).toFixed(1) + '" fill="var(--accent)" opacity=".1"/>';
  out += '<polyline points="' + pts + '" fill="none" stroke="var(--accent)" ' +
    'stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
  const last = data[data.length - 1];
  out += '<circle cx="' + x(last.t).toFixed(1) + '" cy="' + y(pctOf(last)).toFixed(1) +
    '" r="4" fill="var(--accent)" stroke="var(--surface-2)" stroke-width="2"/>';
  // Eng past nuqta alohida belgilanadi — muammo qachon bo'lganini ko'rsatadi.
  let lowI = 0;
  for (let i = 1; i < data.length; i++) if (pctOf(data[i]) < pctOf(data[lowI])) lowI = i;
  const lowP = data[lowI];
  if (data.length > 3 && pctOf(lowP) < pctOf(last) - 0.5) {
    const lx2 = x(lowP.t), ly2 = y(pctOf(lowP));
    const side = lx2 > W * 0.7 ? -1 : 1;
    out += '<circle cx="' + lx2.toFixed(1) + '" cy="' + ly2.toFixed(1) +
      '" r="4" fill="var(--danger)" stroke="var(--surface-2)" stroke-width="2"/>';
    out += '<text class="ch-cap" x="' + (lx2 + side * 9).toFixed(1) + '" y="' +
      (ly2 + 4).toFixed(1) + '" text-anchor="' + (side > 0 ? "start" : "end") +
      '" fill="var(--danger)">eng past ' + Math.round(pctOf(lowP)) + "%</text>";
  }
  out += '<line class="ch-cx" y1="' + T + '" y2="' + y(0).toFixed(1) +
    '" stroke="var(--faint)" style="display:none"/>';
  out += '<circle class="ch-dot" r="4" fill="var(--accent)" stroke="var(--surface-2)" ' +
    'stroke-width="2" style="display:none"/>';
  out += '<rect class="ch-hit" x="' + L + '" y="' + T + '" width="' + (W - L - R) +
    '" height="' + (H - T - B) + '" fill="transparent"/>';
  svg.innerHTML = out;

  // Kursor eng yaqin o'lchovga "yopishadi" — 2px chiziqni mo'ljallash shart emas.
  const cx = svg.querySelector(".ch-cx"), dot = svg.querySelector(".ch-dot"),
        hit = svg.querySelector(".ch-hit");
  hit.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect();
    const t = t0 + ((e.clientX - r.left) * (W / r.width) - L) / (W - L - R) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < data.length; i++)
      if (Math.abs(data[i].t - t) < Math.abs(data[best].t - t)) best = i;
    const p = data[best], bx = x(p.t).toFixed(1);
    cx.setAttribute("x1", bx); cx.setAttribute("x2", bx); cx.style.display = "";
    dot.setAttribute("cx", bx); dot.setAttribute("cy", y(pctOf(p)).toFixed(1));
    dot.style.display = "";
    const d = new Date(p.t), pd = (n) => String(n).padStart(2, "0");
    chTipShow(p.online + "/" + p.total + " onlayn · " + Math.round(pctOf(p)) + "%",
              pd(d.getHours()) + ":" + pd(d.getMinutes()), e.clientX, e.clientY);
  });
  hit.addEventListener("pointerleave", () => {
    cx.style.display = "none"; dot.style.display = "none"; chTipHide();
  });
}

/* Umumiy ustunli grafik: items — {label, value, cap, tipValue, tipLabel}. */
function renderColumns(svgId, emptyId, items, opts) {
  const svg = $(svgId), empty = $(emptyId);
  if (!items.some((it) => it.value != null)) {
    svg.innerHTML = "";
    empty.textContent = opts.emptyText;
    empty.style.display = "flex";
    return;
  }
  empty.style.display = "none";
  const W = Math.max(220, Math.round(svg.clientWidth) || 300), H = 170;
  const L = 30, R = 8, T = 18, B = 24;
  svg.setAttribute("viewBox", "0 0 " + W + " " + H);
  const max = opts.max || niceMax(Math.max(1, ...items.map((it) => it.value || 0)));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  let out = "";
  (opts.max === 100 ? [0, 50, 100] : [0, max / 2, max]).forEach((v) => {
    out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) +
      '" y2="' + y(v).toFixed(1) + '" stroke="var(--line-2)"/>' +
      '<text class="ch-tick" x="' + (L - 7) + '" y="' + (y(v) + 3.5).toFixed(1) +
      '" text-anchor="end">' + Math.round(v) + (opts.unit || "") + "</text>";
  });
  const slot = (W - L - R) / items.length;
  const barW = Math.min(24, slot * 0.62);
  items.forEach((it, i) => {
    const cxm = L + slot * i + slot / 2;
    if (it.value != null && it.value > 0)
      out += '<path class="ch-col" data-i="' + i + '" d="' +
        colPath(cxm - barW / 2, barW, y(it.value), y(0)) + '" fill="var(--accent)"/>';
    if (opts.capLabels && it.value != null && it.cap)
      out += '<text class="ch-cap" x="' + cxm.toFixed(1) + '" y="' +
        (y(it.value) - 5).toFixed(1) + '" text-anchor="middle">' + esc(it.cap) + "</text>";
    if (it.label)
      out += '<text class="ch-tick" x="' + cxm.toFixed(1) + '" y="' + (H - 8) +
        '" text-anchor="middle">' + esc(it.label) + "</text>";
    out += '<rect class="ch-slot" data-i="' + i + '" x="' + (L + slot * i).toFixed(1) +
      '" y="' + T + '" width="' + slot.toFixed(1) + '" height="' + (H - T - B) +
      '" fill="transparent"/>';
  });
  svg.innerHTML = out;
  svg.querySelectorAll(".ch-slot").forEach((rect) => {
    const i = Number(rect.dataset.i);
    const bar = svg.querySelector('.ch-col[data-i="' + i + '"]');
    rect.addEventListener("pointermove", (e) => {
      if (bar) bar.style.opacity = ".78";
      chTipShow(items[i].tipValue, items[i].tipLabel, e.clientX, e.clientY);
    });
    rect.addEventListener("pointerleave", () => {
      if (bar) bar.style.opacity = "";
      chTipHide();
    });
  });
}

const UZ_MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun",
                   "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const UZ_WDAYS = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];
function fmtDayLabel(dt) { return dt.getDate() + "-" + UZ_MONTHS[dt.getMonth()]; }

/* 7 kunlik kesim: o'rtacha onlayn % va uzilishlar soni — ikkita alohida panel. */
function renderDailyCharts() {
  const daily = (state.stats && state.stats.daily) || [];
  const items = daily.map((d, i) => ({
    d,
    dt: new Date(d.date + "T00:00:00"),
    last: i === daily.length - 1,
  }));
  renderColumns("ch-daily-up", "ch-daily-up-empty", items.map((it) => ({
    label: it.last ? "Bugun" : UZ_WDAYS[it.dt.getDay()] + " " + it.dt.getDate(),
    value: it.d.uptime,
    cap: it.d.uptime == null ? "" : Math.round(it.d.uptime) + "%",
    tipValue: it.d.uptime == null ? "ma'lumot yo'q"
      : it.d.uptime.toFixed(1).replace(".", ",") + "% onlayn",
    tipLabel: fmtDayLabel(it.dt),
  })), { max: 100, unit: "%", capLabels: true,
         emptyText: "Kunlik tarix hali yig'ilmagan — server ishlagan sari to'lib boradi." });
  renderColumns("ch-daily-ev", "ch-daily-ev-empty", items.map((it) => ({
    label: it.last ? "Bugun" : UZ_WDAYS[it.dt.getDay()] + " " + it.dt.getDate(),
    // O'sha kunga surat ham, hodisa ham yo'q — "0" emas, "ma'lumot yo'q".
    value: it.d.uptime == null && !it.d.events ? null : it.d.events,
    cap: String(it.d.events),
    tipValue: it.d.events + " ta uzilish",
    tipLabel: fmtDayLabel(it.dt),
  })), { capLabels: true, emptyText: "Kunlik tarix hali yig'ilmagan." });
}

/* Bugungi uzilishlar soat kesimida — muammo qaysi payt bo'lganini ko'rsatadi. */
function renderHourly() {
  const svg = $("ch-hourly"), empty = $("ch-hourly-empty");
  const hours = (state.stats && state.stats.hourly_today) || [];
  if (!hours.some((v) => v > 0)) {
    svg.innerHTML = "";
    empty.textContent = state.stats
      ? "Bugun uzilish qayd etilmadi." : "Tarix yig'ilmoqda…";
    empty.style.display = "flex";
    return;
  }
  const pd = (n) => String(n).padStart(2, "0");
  renderColumns("ch-hourly", "ch-hourly-empty", hours.map((n, h) => ({
    label: h % 6 === 0 ? pd(h) : "",
    value: n,
    tipValue: n + " ta uzilish",
    tipLabel: pd(h) + ":00 – " + pd(h) + ":59",
  })), { emptyText: "" });
}

/* Oyna o'lchami o'zgarsa grafiklar yangi kenglikka qayta chiziladi. */
let chResizeTimer = null;
window.addEventListener("resize", () => {
  if (state.tab !== "dash") return;
  clearTimeout(chResizeTimer);
  chResizeTimer = setTimeout(() => {
    renderTimeline(); renderDailyCharts(); renderHourly();
  }, 200);
});

/* Dashboard ochiq turganda har 15 soniyada o'zi yangilanadi. */
setInterval(() => {
  if (state.tab === "dash" && !document.hidden) renderDash();
}, 15000);

/* Hodisalar lentasi: server yozgan uzilishlar (doimiy) + shu seansdagi
   mahalliy hodisalar (oqim ochildi, MediaMTX va h.k.) bitta ro'yxatda. */
function fmtEvTime(t) {
  const d = new Date(t), p = (n) => String(n).padStart(2, "0");
  const sameDay = d.toDateString() === new Date().toDateString();
  return (sameDay ? "" : p(d.getDate()) + "." + p(d.getMonth() + 1) + " ") +
         p(d.getHours()) + ":" + p(d.getMinutes());
}

function renderEvents() {
  const colors = { ok: "var(--ok)", warn: "var(--warn)", danger: "var(--danger)" };
  const server = ((state.stats && state.stats.events) || []).map((e) => ({
    t: Date.parse(e.ts),
    text: e.name + " (" + e.region + ") — " +
          (e.kind === "offline" ? "uzildi" : "qayta ulandi"),
    kind: e.kind === "offline" ? "danger" : "ok",
  }));
  const all = state.events.concat(server).sort((a, b) => b.t - a.t).slice(0, 60);
  const row = (e) => {
    // Matn "Nomi (hudud) — sabab" ko'rinishida: nom qalin, sababi pastda.
    const m = /^(.*?) — (.*)$/.exec(e.text);
    const title = m ? m[1] : e.text;
    const note = m ? m[2] : "";
    return '<div class="erow">' +
      '<span class="ln" style="background:' + (colors[e.kind] || "var(--muted)") + '"></span>' +
      '<span class="tx"><b>' + esc(title) + "</b>" +
        (note ? "<i>" + esc(note) + "</i>" : "") + "</span>" +
      '<span class="tm">' + fmtEvTime(e.t) + "</span></div>";
  };
  $("events-list").innerHTML = all.length
    ? all.map(row).join("")
    : '<div class="empty">Hodisalar hali yo‘q.</div>';
  $("bp-list").innerHTML = all.length
    ? all.slice(0, 12).map(row).join("")
    : '<div class="empty">Yangi bildirishnoma yo‘q.</div>';
}

/* Qo'ng'iroqdagi hisob — hozir uzilgan kameralar soni. */
function renderBell() {
  const off = state.cameras.filter((c) => c.online === false).length;
  const el = $("bell-count");
  el.textContent = off > 99 ? "99+" : off;
  el.hidden = off === 0;
  $("bp-sub").textContent = off ? off + " ta uzilgan" : "hammasi joyida";
}
$("bell").addEventListener("click", (e) => {
  e.stopPropagation();
  const p = $("bell-panel");
  p.hidden = !p.hidden;
  if (!p.hidden) renderEvents();
});
document.addEventListener("click", (e) => {
  const p = $("bell-panel");
  if (!p.hidden && !p.contains(e.target)) p.hidden = true;
});

/* Tizim holati — faqat haqiqiy signallardan chiqariladi. */
function renderSystem() {
  const total = state.cameras.length;
  const on = state.cameras.filter((c) => c.online === true).length;
  const pct = total ? (on / total) * 100 : 0;
  const fresh = state.cameras.some((c) => c.last_seen &&
    Date.now() - Date.parse(c.last_seen) < 10 * 60000);
  const rows = [
    ["Video servislari", ICO.server, state.apiOk ? ["Faol", ""] : ["Uzilgan", "bad"]],
    ["Ma'lumotlar bazasi", ICO.db, state.apiOk ? ["Faol", ""] : ["Javob yo'q", "bad"]],
    ["Tarmoq ulanishi", ICO.net,
      !total ? ["Ma'lumot yo'q", "warn"]
        : pct >= 90 ? ["Barqaror", ""]
        : pct >= 60 ? ["Beqaror", "warn"] : ["Muammo", "bad"]],
    ["Holat kuzatuvi", ICO.cast,
      fresh ? ["Faol", ""] : total ? ["Eskirgan", "warn"] : ["Kutilmoqda", "warn"]],
    ["Oqim xizmatlari", ICO.play,
      state.streamOk === null ? ["Sinalmagan", "warn"]
        : state.streamOk ? ["Faol", ""] : ["Uzilgan", "bad"]],
  ];
  $("sys-list").innerHTML = rows.map(([name, icon, [tx, cls]]) =>
    '<div class="sysrow"><span class="si">' + icon + "</span>" +
    '<span class="sn">' + name + "</span>" +
    '<span class="sb ' + cls + '">' + tx + "</span></div>").join("");
}

/* ---------- Tab'lar ---------- */
/* Kirish talab qiladigan bo'limlar. */
const AUTH_TABS = ["dash", "admin"];

function showTab(tab) {
  // Dashboard va boshqaruv — faqat tizimga kirganlar uchun. Chuqur havola
  // (#dash) bilan ham ochilmaydi: kirish ekrani chiqadi, manzil tozalanadi.
  if (AUTH_TABS.includes(tab) && !state.admin) {
    state.pendingTab = tab;
    if (location.hash) history.replaceState(null, "", location.pathname);
    openLogin();
    return;
  }
  if (tab === "admin" && state.admin && state.admin.role === "operator") tab = "map";
  const prev = state.tab;
  state.tab = tab;
  document.querySelectorAll("#tabs button").forEach((b) =>
    b.classList.toggle("on", b.dataset.tab === tab));
  $("map-view").hidden = tab !== "map";
  $("wall-view").hidden = tab !== "wall";
  $("dash-view").hidden = tab !== "dash";
  $("admin-view").hidden = tab !== "admin";
  document.body.classList.remove("side-open");

  // Xarita yashirin turganda o'lchamini bilmaydi — ko'ringanda qayta o'lchaydi.
  if (tab === "map") setTimeout(() => map.invalidateSize(), 60);

  if (prev === "wall" && tab !== "wall") stopWall();
  if (prev === "map" && tab !== "map" && selPlayer) selPlayer.stop();

  if (tab === "wall") buildWall();
  if (tab === "dash") renderDash();
  if (tab === "admin") loadAdminCameras(0);
  if (tab === "map" && state.selectedId) selectCamera(state.selectedId, false);

  // Bo'lim manzilda saqlanadi — yangilansa yoki havola ulashilsa o'sha yerga qaytadi.
  const hash = tab === "map" ? "" : "#" + tab;
  if (location.hash !== hash) history.replaceState(null, "", location.pathname + hash);
}
window.addEventListener("hashchange", () => {
  const t = location.hash.replace("#", "") || "map";
  if (["map", "wall", "dash", "admin"].includes(t) && t !== state.tab) showTab(t);
});
document.querySelectorAll("#tabs button").forEach((b) =>
  b.addEventListener("click", () => showTab(b.dataset.tab)));
// Karta sarlavhalari va tezkor amallardagi havolalar.
document.querySelectorAll("[data-tab-go]").forEach((b) =>
  b.addEventListener("click", () => {
    if (b.id === "bell-panel" || b.closest("#bell-panel")) $("bell-panel").hidden = true;
    showTab(b.dataset.tabGo);
  }));

// Yon panel (tor ekranda) va yordam oynasi.
$("side-toggle").addEventListener("click", () => document.body.classList.toggle("side-open"));
// Tor ekranda menyu ochiq turganda qoraytirilgan fonga (body::after)
// bosish uni yopadi — psevdo-element bosilsa nishon body'ning o'zi bo'ladi.
document.addEventListener("click", (e) => {
  if (e.target === document.body && document.body.classList.contains("side-open")) {
    document.body.classList.remove("side-open");
  }
});
$("help-btn").addEventListener("click", () => openModal("help-modal"));
$("qa-add").addEventListener("click", () => {
  if (!state.admin) { showTab("admin"); return; }
  openCameraForm(null);
});
$("qa-mtx").addEventListener("click", () => {
  if (!state.admin) { showTab("admin"); return; }
  $("sync-btn").click();
});
$("map-fs").addEventListener("click", () => {
  if (document.fullscreenElement) { document.exitFullscreen(); return; }
  const el = $("map-card");
  if (el.requestFullscreen) el.requestFullscreen().then(() =>
    setTimeout(() => map.invalidateSize(), 120)).catch(() => {});
});
document.addEventListener("fullscreenchange", () => {
  if (state.tab === "map") setTimeout(() => map.invalidateSize(), 120);
});

/* Jonli belgi bosilsa \u2014 darhol yangilash. */
$("dash-refresh").addEventListener("click", async () => {
  const b = $("dash-refresh");
  b.disabled = true;
  await refreshStatus();
  await loadStats();
  renderDash();
  b.disabled = false;
});

/* Hududlar jadvalini CSV faylga chiqarish. */
$("reg-csv").addEventListener("click", () => {
  const rstats = new Map(((state.stats && state.stats.regions) || []).map((x) => [x.region, x]));
  const regions = [...new Set(state.cameras.map((c) => c.region))].sort();
  if (!regions.length) { toast("Eksport uchun ma'lumot yo'q", true); return; }
  const cell = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const head = ["Hudud", "Jami", "Onlayn", "Uzilgan", "Onlaynlik %", "24 soat %", "Bugungi uzilishlar"];
  const body = regions.map((rg) => {
    const list = state.cameras.filter((c) => c.region === rg);
    const up = list.filter((c) => c.online !== false).length;
    const st = rstats.get(rg);
    return [rg, list.length, up, list.length - up,
            list.length ? Math.round((up / list.length) * 100) : 0,
            st && st.uptime24 != null ? st.uptime24 : "",
            st ? st.events_today : ""].map(cell).join(",");
  });
  const blob = new Blob(["\ufeff" + [head.map(cell).join(","), ...body].join("\r\n")],
                        { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "nigoh-hududlar.csv";
  link.click();
  URL.revokeObjectURL(link.href);
  toast(regions.length + " ta hudud eksport qilindi");
});

/* Tepa qatordagi soat. */
function startClock() {
  const WD = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Jum", "Shan"];
  const MO = ["yanv", "fevr", "mart", "apr", "may", "iyun",
              "iyul", "avg", "sent", "okt", "noyab", "dek"];
  const p = (x) => String(x).padStart(2, "0");
  const tick = () => {
    const d = new Date();
    $("clock-date").textContent = WD[d.getDay()] + ", " + d.getDate() + " " +
      MO[d.getMonth()] + " " + d.getFullYear();
    $("clock-time").textContent = p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  };
  tick();
  setInterval(tick, 1000);
}

/* Sarlavhalardagi O'zbekiston konturi — uz.geojson dan chiziladi. */
async function drawHeadMaps() {
  const els = document.querySelectorAll(".ph-map");
  if (!els.length) return;
  let gj;
  try { gj = await (await fetch("/static/uz.geojson")).json(); } catch (e) { return; }
  const geom = gj.features[0].geometry;
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  let minX = 180, maxX = -180, minY = 90, maxY = -90;
  polys.forEach((poly) => poly[0].forEach(([x, y]) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }));
  // Ekvivalent to'rtburchak (equirectangular) proyeksiya: 41° kenglikda bir
  // daraja uzunlik bir daraja kenglikdan ~25% qisqa. Shu koeffitsiyentsiz
  // O'zbekiston yassilashib, keraksiz cho'zilgan bo'lib chiqadi.
  const kx = Math.cos(((minY + maxY) / 2) * Math.PI / 180);
  const wDeg = (maxX - minX) * kx, hDeg = maxY - minY;
  const W = 200, H = 100, pad = 3;
  const sc = Math.min((W - 2 * pad) / wDeg, (H - 2 * pad) / hDeg);
  const ox = (W - wDeg * sc) / 2, oy = (H - hDeg * sc) / 2;
  const px = (x) => (ox + (x - minX) * kx * sc).toFixed(1);
  const py = (y) => (oy + (maxY - y) * sc).toFixed(1);
  const d = polys.map((poly) =>
    "M" + poly[0].map(([x, y]) => px(x) + "," + py(y)).join("L") + "Z").join("");
  // Kameralar joylashuvidan bir nechta nuqta — bezak sifatida.
  const dots = state.cameras.filter(hasGeo)
    .filter((_, i) => i % Math.max(1, Math.ceil(state.cameras.length / 9)) === 0)
    .slice(0, 9)
    .map((c) => '<circle cx="' + px(c.lng) + '" cy="' + py(c.lat) + '" r="1.5"/>').join("");
  // viewBox chizilgan konturga qirqiladi — shakl ramkani to'ldiradi va
  // yon tomonlarda bo'sh joy qolmaydi (CSS balandlik beradi, eni o'zi chiqadi).
  const vb = [ox - pad, oy - pad, wDeg * sc + 2 * pad, hDeg * sc + 2 * pad]
    .map((v) => v.toFixed(1)).join(" ");
  els.forEach((el) => {
    el.setAttribute("viewBox", vb);
    el.innerHTML = '<path d="' + d + '"/>' + dots;
  });
}

/* ---------- Xarita boshqaruvlari ---------- */
$("z-in").addEventListener("click", () => map.zoomIn());
$("z-out").addEventListener("click", () => map.zoomOut());
$("fit-all").addEventListener("click", () => {
  try {
    const b = cluster.getBounds();
    if (b.isValid()) { map.fitBounds(b.pad(0.2)); return; }
  } catch (e) {}
  map.setView([41.35, 64.6], 6);
});

/* ---------- Modallar ---------- */
function openModal(id) { $(id).classList.add("open"); }
function closeModal(id) {
  $(id).classList.remove("open");
  if (id === "cam-modal") stopPicking(true);
  if (id === "login-modal") state.pendingTab = null;
}
document.querySelectorAll("[data-close]").forEach((b) =>
  b.addEventListener("click", () => closeModal(b.dataset.close)));
document.querySelectorAll(".backdrop").forEach((bd) =>
  bd.addEventListener("click", (e) => { if (e.target === bd) closeModal(bd.id); }));

/* ---------- Autentifikatsiya ---------- */
function setAdmin(admin) {
  state.admin = admin;
  if (admin) {
    $("user-av").textContent = admin.username.slice(0, 2).toUpperCase();
    $("user-name").textContent = admin.username;
    $("user-role").textContent = admin.role === "operator" ? "Operator" : "Tizim administratori";
    $("avatar").title = admin.username + " — chiqish uchun bosing";
  } else {
    $("user-av").textContent = "?";
    $("user-name").textContent = "—";
    $("user-role").textContent = "Kirilmagan";
    $("avatar").title = "Super-admin sifatida kirish";
    if (AUTH_TABS.includes(state.tab)) showTab("map");
    stopPicking(true);
  }
  // Kirilmagan holatda yopiq bo'limlar yon panelda qulf bilan belgilanadi.
  document.body.classList.toggle("anon", !admin);
  // Operator boshqaruv bo'limini ko'rmaydi — server ham 403 qaytaradi.
  document.body.classList.toggle("operator", !!admin && admin.role === "operator");
  if (admin && admin.role === "operator" && state.tab === "admin") showTab("map");
}

/* /api/auth/me javobini qo'llash. Kirilmagan bo'lsa interfeys ochilmaydi;
   server anonim ko'rishga ruxsat bersa (public_view) kirish ekranida
   "Mehmon sifatida davom etish" tugmasi chiqadi. */
function applyMe(me) {
  setAdmin(me && me.authenticated ? { username: me.username, role: me.role } : null);
  $("l-guest").hidden = !(me && !me.authenticated && me.public_view);
  $("ls-gate").hidden = !$("l-guest").hidden;
}

/* Kirish ekranini ochadi. Ko'rish uchun kirish shart bo'lsa, ma'lumot
   yuklash muvaffaqiyatli kirishgacha kutib turadi. */
let pendingStart = null;
function openLogin(focus) {
  $("login-err").classList.remove("show");
  $("l-pass").value = "";
  openModal("login-modal");
  if (focus !== false) setTimeout(() => $("l-pass").focus(), 80);
}

$("avatar").addEventListener("click", async () => {
  if (!state.admin) { openLogin(); return; }
  if (confirm("Chiqmoqchimisiz?")) {
    await api("/api/auth/logout", { method: "POST" });
    // Sahifa qaytadan yuklanadi: xotiradagi kameralar, oqimlar va
    // grafiklar ekranda qolib ketmaydi, kirish ekrani toza ochiladi.
    location.reload();
  }
});

$("l-eye").addEventListener("click", () => {
  const inp = $("l-pass");
  inp.type = inp.type === "password" ? "text" : "password";
  $("l-eye").classList.toggle("on", inp.type === "text");
  inp.focus();
});
// "Meni esda saqlash" — faqat loginni brauzerda saqlaydi, parolni emas.
try {
  const saved = localStorage.getItem("nigoh-login");
  if (saved) { $("l-user").value = saved; $("l-remember").checked = true; }
} catch (e) {}

$("l-submit").addEventListener("click", doLogin);
// Mehmon: server anonim ko'rishga ruxsat bergan bo'lsagina ko'rinadi.
$("l-guest").addEventListener("click", () => {
  closeModal("login-modal");
  if (pendingStart) { const go = pendingStart; pendingStart = null; go(); }
});
$("l-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });

async function doLogin() {
  const err = $("login-err");
  err.classList.remove("show");
  try {
    const me = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: $("l-user").value.trim(), password: $("l-pass").value })
    });
    setAdmin({ username: me.username, role: me.role });
    try {
      if ($("l-remember").checked) localStorage.setItem("nigoh-login", me.username);
      else localStorage.removeItem("nigoh-login");
    } catch (e) {}
    // closeModal pendingTab'ni tozalaydi — so'ralgan bo'lim avval olinadi.
    const tab = state.pendingTab;
    closeModal("login-modal");
    toast("Xush kelibsiz, " + me.username);
    // Mehmon sifatida yuklangan ro'yxat operator hududlariga mos kelmasligi
    // mumkin — kirgandan keyin kameralar qayta so'raladi.
    if (!pendingStart) loadCameras().catch(() => {});
    // Kirish kutilayotgan bo'lsa (ko'rish uchun kirish shart) — endi yuklanadi.
    if (pendingStart) { const go = pendingStart; pendingStart = null; go(); }
    if (tab) showTab(tab);
  } catch (e) {
    err.textContent = e.message;
    err.classList.add("show");
  }
}

/* ---------- Boshqaruv jadvali ---------- */
async function loadAdminCameras(offset) {
  const size = state.adminSize;
  const start = offset || 0;
  const query = encodeURIComponent(state.adminQuery || "");
  const res = await api("/api/admin/cameras?q=" + query +
                        "&limit=" + size + "&offset=" + start);
  state.adminCameras = res.cameras;
  state.adminOffset = start;
  state.adminTotal = res.total;

  const last = Math.min(start + res.cameras.length, res.total);
  $("admin-count").textContent = res.total
    ? (start + 1) + "–" + last + " / " + res.total + " ta kamera" : "Kamera yo'q";
  $("admin-total").textContent = "";
  $("adm-prev").disabled = start === 0;
  $("adm-next").disabled = start + size >= res.total;

  renderAdminPages(Math.ceil(res.total / size), Math.floor(start / size));
  renderAdminKpis();
  fillAdminRegions();
  renderAdminTable();
}

/* Raqamli sahifalar: 1 2 3 … oxirgi (joriy atrofida oyna). */
function renderAdminPages(pages, cur) {
  const box = $("adm-pages");
  if (pages < 2) { box.innerHTML = ""; return; }
  const want = new Set([0, pages - 1, cur, cur - 1, cur + 1]);
  if (cur <= 2) [1, 2, 3].forEach((i) => want.add(i));
  if (cur >= pages - 3) [pages - 2, pages - 3, pages - 4].forEach((i) => want.add(i));
  const list = [...want].filter((i) => i >= 0 && i < pages).sort((a, b) => a - b);
  let out = "", prev = -1;
  list.forEach((i) => {
    if (prev >= 0 && i - prev > 1) out += '<span class="gap">…</span>';
    out += '<button data-pg="' + i + '"' + (i === cur ? ' class="on"' : "") + ">" + (i + 1) + "</button>";
    prev = i;
  });
  box.innerHTML = out;
  box.querySelectorAll("[data-pg]").forEach((b) =>
    b.addEventListener("click", () => loadAdminCameras(Number(b.dataset.pg) * state.adminSize)));
}

/* Boshqaruv KPI kartalari va filtr tugmalaridagi hisoblar.
   Jami — admin ro'yxati (o'chirilganlar bilan), onlayn/oflayn — ochiq ro'yxatdan;
   o'chirilganlar soni ikkovining farqi (ochiq ro'yxatda ular ko'rinmaydi). */
function renderAdminKpis() {
  const total = state.adminTotal;
  const on = state.cameras.filter((c) => c.online === true).length;
  const off = state.cameras.filter((c) => c.online === false).length;
  const dis = Math.max(0, total - state.cameras.length);
  const pc = (v) => total ? Math.round((v / total) * 100) + "%" : "—";
  $("adm-k-total").textContent = total;
  $("adm-k-on").textContent = on;
  $("adm-k-on-pct").textContent = pc(on);
  $("adm-k-on-bar").style.width = (total ? (on / total) * 100 : 0) + "%";
  $("adm-k-off").textContent = off;
  $("adm-k-off-pct").textContent = pc(off);
  $("adm-k-off-bar").style.width = (total ? (off / total) * 100 : 0) + "%";
  $("adm-k-dis").textContent = dis;
  $("adm-c-all").textContent = total;
  $("adm-c-on").textContent = on;
  $("adm-c-off").textContent = off;
  $("adm-c-dis").textContent = dis;
}

$("adm-size").addEventListener("change", (e) => {
  state.adminSize = Number(e.target.value) || 50;
  loadAdminCameras(0);
});
$("adm-clear").addEventListener("click", () => {
  state.adminFilters = { status: "", region: "", codec: "", mode: "" };
  state.adminQuery = "";
  $("admin-search").value = "";
  ["adm-region", "adm-codec", "adm-mode"].forEach((id) => { $(id).value = ""; });
  document.querySelectorAll("#adm-status button").forEach((x) =>
    x.classList.toggle("on", x.dataset.st === ""));
  loadAdminCameras(0);
});
/* Export — joriy sahifadagi filtrlangan qatorlar CSV faylga. */
$("adm-export").addEventListener("click", () => {
  const rows = visibleAdminRows();
  if (!rows.length) { toast("Eksport uchun qator yo'q", true); return; }
  const head = ["Nomi", "Hudud", "Holat", "Manzil", "Kodek", "Rejim", "Faol"];
  const cell = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const body = rows.map((c) => [
    c.name, c.region, camStatus(c),
    c.source_type === "rtsp" ? c.ip + ":" + c.port + (c.rtsp_path || "") : (c.raw_stream_url || ""),
    (c.codec || "") + (c.transcode ? " -> H264" : ""),
    c.always_on ? "doim tayyor" : "so'rov bo'yicha",
    c.enabled ? "ha" : "yo'q",
  ].map(cell).join(","));
  // BOM — Excel CSV ni UTF-8 deb o'qishi uchun.
  const blob = new Blob(["\ufeff" + [head.map(cell).join(","), ...body].join("\r\n")],
                        { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "nigoh-kameralar.csv";
  a.click();
  URL.revokeObjectURL(a.href);
  toast(rows.length + " ta qator eksport qilindi");
});

/* Kamera holati filtrlash/saralash uchun yagona qiymatga keltiriladi. */
function camStatus(cam) {
  if (!cam.enabled) return "disabled";
  const pub = state.byId.get(cam.id);
  if (pub && pub.online === false) return "offline";
  if (pub && pub.online === true) return "online";
  return "unknown";
}
function camCodecKind(cam) {
  if (cam.transcode) return "trans";
  if (/h265|hevc/i.test(cam.codec || "")) return "h265raw";
  if (/h264|avc/i.test(cam.codec || "")) return "h264";
  return "";
}

function fillAdminRegions() {
  const sel = $("adm-region");
  const cur = sel.value;
  const regions = [...new Set(state.adminCameras.map((c) => c.region))].sort();
  sel.innerHTML = '<option value="">Barcha hududlar</option>' +
    regions.map((r) => '<option value="' + esc(r) + '"' +
      (r === cur ? " selected" : "") + ">" + esc(r) + "</option>").join("");
}

/* Joriy sahifadagi filtrlardan o'tgan qatorlar (jadval ham, eksport ham shundan). */
function visibleAdminRows() {
  const f = state.adminFilters;
  return state.adminCameras.filter((cam) =>
    (!f.status || camStatus(cam) === f.status) &&
    (!f.region || cam.region === f.region) &&
    (!f.codec || camCodecKind(cam) === f.codec) &&
    (!f.mode || (f.mode === "always") === !!cam.always_on));
}

function renderAdminTable() {
  let rows = visibleAdminRows();

  const s = state.adminSort;
  if (s.key) {
    const val = (cam) => s.key === "status" ? camStatus(cam)
      : s.key === "codec" ? camCodecKind(cam)
      : s.key === "mode" ? (cam.always_on ? "a" : "b")
      : String(cam[s.key] || "").toLowerCase();
    rows = [...rows].sort((a, b) => s.dir * val(a).localeCompare(val(b), "uz"));
  }
  document.querySelectorAll("#admin-table th.sortable").forEach((th) => {
    th.querySelector(".arr").textContent =
      th.dataset.key === s.key ? (s.dir > 0 ? "▲" : "▼") : "";
  });

  $("adm-shown").textContent = rows.length !== state.adminCameras.length
    ? rows.length + " / " + state.adminCameras.length + " ko'rsatilyapti" : "";

  const tbody = $("admin-tbody");
  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty">' +
      (state.adminCameras.length ? "Filtrlarga mos kamera topilmadi."
        : state.adminQuery ? "Qidiruvga mos kamera topilmadi."
        : "Hali kamera qo'shilmagan — «+ Kamera» dan boshlang.") +
      "</div></td></tr>";
    return;
  }
  rows.forEach((cam, i) => tbody.appendChild(adminRow(cam, state.adminOffset + i + 1)));
}

document.querySelectorAll("#adm-status button").forEach((b) =>
  b.addEventListener("click", () => {
    state.adminFilters.status = b.dataset.st;
    document.querySelectorAll("#adm-status button").forEach((x) =>
      x.classList.toggle("on", x === b));
    renderAdminTable();
  }));
$("adm-region").addEventListener("change", (e) => {
  state.adminFilters.region = e.target.value; renderAdminTable();
});
$("adm-codec").addEventListener("change", (e) => {
  state.adminFilters.codec = e.target.value; renderAdminTable();
});
$("adm-mode").addEventListener("change", (e) => {
  state.adminFilters.mode = e.target.value; renderAdminTable();
});
document.querySelectorAll("#admin-table th.sortable").forEach((th) =>
  th.addEventListener("click", () => {
    const key = th.dataset.key;
    if (state.adminSort.key === key) state.adminSort.dir *= -1;
    else state.adminSort = { key, dir: 1 };
    renderAdminTable();
  }));

function adminRow(cam, idx) {
  const tr = document.createElement("tr");
  const st = camStatus(cam);
  const stateInfo = { disabled: { tx: "O'chirilgan", cls: "dis" },
                      offline: { tx: "Oflayn", cls: "down" },
                      online: { tx: "Onlayn", cls: "" },
                      unknown: { tx: "Noma'lum", cls: "unk" } }[st];
  const addr = cam.source_type === "rtsp"
    ? cam.ip + ":" + cam.port + (cam.rtsp_path || "")
    : (cam.raw_stream_url || "—");

  tr.innerHTML =
    '<td class="num">' + idx + "</td>" +
    '<td><span class="st-chip ' + stateInfo.cls + '"><i></i>' + stateInfo.tx + "</span></td>" +
    '<td style="font-weight:600">' + esc(cam.name) + "</td>" +
    '<td style="color:var(--muted)">' + esc(cam.region) + "</td>" +
    '<td class="mono" style="font-size:11px;color:var(--muted);word-break:break-all">' + esc(addr) + "</td>" +
    "<td>" + (cam.codec
      ? '<span class="cdx-chip">' + esc(cam.codec) + (cam.transcode ? " → H264" : "") + "</span>"
      : '<span style="color:var(--faint)">—</span>') + "</td>" +
    '<td style="color:var(--muted);font-size:11.5px">' +
      (cam.always_on ? "doim tayyor" : "so'rov bo'yicha") + "</td>" +
    '<td style="text-align:right;white-space:nowrap">' +
      '<span class="tacts">' +
        '<button class="tbtn" data-act="edit">' + ICO.edit + "Tahrirlash</button>" +
        (cam.source_type === "rtsp" ? '<button class="tbtn ok" data-act="test">' + ICO.play + "Test</button>" : "") +
        '<button class="tbtn warn" data-act="find">' + ICO.map + "Xarita</button>" +
        '<button class="tbtn bad" data-act="del">' + ICO.trash + "O‘chirish</button>" +
      "</span><div class=\"adm-probe\"></div></td>";

  const out = tr.querySelector(".adm-probe");
  tr.querySelector('[data-act="edit"]').addEventListener("click", () => openCameraForm(cam));
  tr.querySelector('[data-act="del"]').addEventListener("click", () => deleteCamera(cam));
  tr.querySelector('[data-act="find"]').addEventListener("click", () => {
    showTab("map");
    if (hasGeo(cam)) map.setView([cam.lat, cam.lng], 15);
    else toast("Bu kameraga koordinata kiritilmagan", true);
    selectCamera(cam.id, false);
  });
  const testBtn = tr.querySelector('[data-act="test"]');
  if (testBtn) testBtn.addEventListener("click", async () => {
    testBtn.disabled = true;
    out.className = "adm-probe show wait";
    out.textContent = "Tekshirilmoqda…";
    try {
      const r = await api("/api/admin/probe", {
        method: "POST",
        body: JSON.stringify({
          ip: cam.ip, port: cam.port, username: cam.username,
          rtsp_path: cam.rtsp_path, camera_id: cam.id
        })
      });
      out.className = "adm-probe show " + (r.ok ? "ok" : "bad");
      out.textContent = r.message;
    } catch (e) {
      out.className = "adm-probe show bad";
      out.textContent = e.message;
    }
    testBtn.disabled = false;
  });
  return tr;
}

$("adm-prev").addEventListener("click", () =>
  loadAdminCameras(Math.max(0, state.adminOffset - state.adminSize)));
$("adm-next").addEventListener("click", () =>
  loadAdminCameras(state.adminOffset + state.adminSize));

let adminSearchTimer = null;
$("admin-search").addEventListener("input", (e) => {
  state.adminQuery = e.target.value;
  clearTimeout(adminSearchTimer);
  adminSearchTimer = setTimeout(() => loadAdminCameras(0), 250);
});

async function deleteCamera(cam) {
  if (!confirm('"' + cam.name + '" kamerasi butunlay o‘chirilsinmi?')) return;
  try {
    await api("/api/admin/cameras/" + cam.id, { method: "DELETE" });
    await loadAdminCameras(state.adminOffset);
    await loadCameras();
    addEvent(cam.name + " — o'chirildi", "warn");
    toast("Kamera o'chirildi");
  } catch (e) { toast(e.message, true); }
}

/* ---------- Kamera shakli ---------- */
async function loadVendors() {
  state.vendors = await api("/api/vendors");
  $("f-vendor").innerHTML = state.vendors
    .map((v) => '<option value="' + v.id + '">' + esc(v.name) + "</option>").join("");
}

function setSourceType(type) {
  state.sourceType = type;
  document.querySelectorAll(".seg button").forEach((b) =>
    b.classList.toggle("on", b.dataset.src === type));
  $("rtsp-block").hidden = type !== "rtsp";
  $("manual-block").hidden = type !== "manual";
}
document.querySelectorAll(".seg button").forEach((b) =>
  b.addEventListener("click", () => setSourceType(b.dataset.src)));

$("f-vendor").addEventListener("change", () => {
  const v = state.vendors.find((x) => x.id === $("f-vendor").value);
  if (!v) return;
  $("f-path").value = v.path;
  if (!$("f-port").value || $("f-port").value === "554") $("f-port").value = v.port;
  updatePreview();
});

["f-ip", "f-port", "f-user", "f-pass", "f-path"].forEach((id) =>
  $(id).addEventListener("input", updatePreview));

function updatePreview() {
  const ip = $("f-ip").value.trim() || "IP";
  const port = $("f-port").value || "554";
  const user = $("f-user").value.trim();
  const pass = $("f-pass").value ? "•••" : "";
  let path = $("f-path").value.trim();
  if (path && !path.startsWith("/")) path = "/" + path;
  const cred = user ? user + (pass ? ":" + pass : "") + "@" : "";
  $("f-preview").textContent = "rtsp://" + cred + ip + ":" + port + (path || "/");
}

function openCameraForm(cam) {
  // Vendor ro'yxati ishga tushishda yuklanmay qolgan bo'lsa — hozir yuklaymiz.
  if (!state.vendors.length) loadVendors().catch(() => {});
  state.editingId = cam ? cam.id : null;
  $("cam-title").textContent = cam ? "Kamerani tahrirlash" : "Yangi kamera";
  $("cam-err").classList.remove("show");
  $("f-probe").className = "probe-out";
  $("pass-hint").hidden = !cam;
  resetScan();

  setSourceType(cam ? cam.source_type : "rtsp");
  $("f-name").value = cam ? cam.name : "";
  $("f-region").value = cam ? cam.region : "";
  $("f-lat").value = cam ? cam.lat : "";
  $("f-lng").value = cam ? cam.lng : "";
  $("f-ip").value = cam ? cam.ip : "";
  $("f-port").value = cam ? cam.port : 554;
  $("f-user").value = cam ? cam.username : "";
  $("f-pass").value = "";
  $("f-path").value = cam ? cam.rtsp_path : "/stream1";
  $("f-vendor").value = cam ? cam.vendor : "boshqa";
  $("f-url").value = cam ? cam.raw_stream_url : "";
  $("f-note").value = cam ? cam.note : "";
  $("f-enabled").checked = cam ? cam.enabled : true;
  $("f-always").checked = cam ? cam.always_on : false;

  const out = $("f-probe");
  if (cam && cam.codec) {
    out.className = "probe-out show " + (cam.transcode ? "wait" : "ok");
    out.textContent = cam.transcode
      ? "Kodek " + cam.codec + " — brauzer o'qiy olmaydi, H.264 ga o'girib beriladi"
      : "Kodek " + cam.codec + " — to'g'ridan-to'g'ri uzatiladi";
  }

  updatePreview();
  openModal("cam-modal");
  setTimeout(() => $("f-name").focus(), 60);
}

$("new-cam").addEventListener("click", () => openCameraForm(null));

/* --- viloyatni koordinatadan aniqlash --- */
let regionGeo = null;
async function ensureRegionGeo() {
  if (regionGeo) return regionGeo;
  const r = await fetch("/static/uz_regions.geojson");
  if (!r.ok) throw new Error("chegara fayli yuklanmadi");
  regionGeo = await r.json();
  return regionGeo;
}

function pointInRing(lat, lng, ring) {
  // Nur usuli (ray casting); geojson koordinatasi [lng, lat] tartibida.
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function regionAt(lat, lng) {
  if (!regionGeo) return "";
  for (const f of regionGeo.features) {
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const poly of polys) {
      if (pointInRing(lat, lng, poly[0]) &&
          !poly.slice(1).some((hole) => pointInRing(lat, lng, hole)))
        return f.properties.name;
    }
  }
  return "";
}

function autoRegion(prefix) {
  const lat = parseFloat($(prefix + "-lat").value);
  const lng = parseFloat($(prefix + "-lng").value);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return;
  const fill = () => {
    const name = regionAt(lat, lng);
    if (name) $(prefix + "-region").value = name;
  };
  if (regionGeo) fill();
  else ensureRegionGeo().then(fill).catch(() => {});
}

["f", "n"].forEach((prefix) =>
  ["-lat", "-lng"].forEach((suffix) =>
    $(prefix + suffix).addEventListener("change", () => autoRegion(prefix))));

/* --- xaritadan koordinata tanlash --- */
$("f-pick").addEventListener("click", () => {
  $("cam-modal").classList.remove("open");
  state.picking = "cam";
  document.body.classList.add("picking");
  showTab("map");
  toast("Xaritada kerakli nuqtani bosing");
});

function stopPicking(removeMarker) {
  state.picking = null;
  document.body.classList.remove("picking");
  if (removeMarker && state.pickMarker) {
    map.removeLayer(state.pickMarker);
    state.pickMarker = null;
  }
}

map.on("click", (e) => {
  if (!state.picking) return;
  const target = state.picking === "nvr" ? "nvr-modal" : "cam-modal";
  const prefix = state.picking === "nvr" ? "n" : "f";
  $(prefix + "-lat").value = e.latlng.lat.toFixed(5);
  $(prefix + "-lng").value = e.latlng.lng.toFixed(5);
  autoRegion(prefix);
  if (state.pickMarker) map.removeLayer(state.pickMarker);
  state.pickMarker = L.marker(e.latlng, {
    icon: L.divIcon({ className: "",
      html: '<div class="mk sel"><span class="r"></span><span class="c"></span></div>',
      iconSize: [24, 24], iconAnchor: [12, 12] })
  }).addTo(map);
  stopPicking(false);
  openModal(target);
});

/* --- ulanishni tekshirish --- */
$("f-test").addEventListener("click", async () => {
  const out = $("f-probe");
  const show = (kind, tx) => { out.className = "probe-out show " + kind; out.textContent = tx; };
  if (!$("f-ip").value.trim()) { show("bad", "Avval IP manzilni kiriting"); return; }
  $("f-test").disabled = true;
  show("wait", "Tekshirilmoqda… (10 soniyagacha)");
  try {
    const r = await api("/api/admin/probe", {
      method: "POST",
      body: JSON.stringify({
        ip: $("f-ip").value.trim(),
        port: Number($("f-port").value) || 554,
        username: $("f-user").value.trim(),
        password: $("f-pass").value || null,
        rtsp_path: $("f-path").value.trim() || "/",
        camera_id: state.editingId
      })
    });
    show(r.ok ? "ok" : "bad", r.message);
  } catch (e) {
    show("bad", e.message);
  }
  $("f-test").disabled = false;
});

/* --- qurilmani avtomatik aniqlash --- */
function scanPicked() {
  if (!state.scan) return null;
  return state.scan.channels.filter((c) => {
    const cb = document.querySelector('#f-channels input[data-ch="' + c.channel + '"]');
    return cb ? cb.checked : true;
  });
}

function updateSaveLabel() {
  const picked = scanPicked();
  $("f-save").textContent = picked && picked.length > 1
    ? picked.length + " ta kamerani qo'shish"
    : "Saqlash";
}

function resetScan() {
  state.scan = null;
  $("f-channels").innerHTML = "";
  $("f-scan-out").className = "probe-out";
  updateSaveLabel();
}

function renderScanChannels(res) {
  const box = $("f-channels");
  if (res.channels.length < 2) { box.innerHTML = ""; return; }
  box.innerHTML =
    '<div class="section" style="margin-top:8px">' +
    '<div class="section-title">Topilgan kanallar — qo\'shiladiganlarini belgilang</div>' +
    res.channels.map((c) =>
      '<label style="display:flex;align-items:center;gap:9px;color:var(--text);' +
      'font-size:13px;font-weight:500;cursor:pointer">' +
      '<input type="checkbox" data-ch="' + c.channel + '" checked style="width:auto;margin:0">' +
      c.channel + "-kanal " +
      '<span class="cdx-chip">' + esc(c.codec || "?") + (c.needs_transcode ? " →H264" : "") + "</span>" +
      '<span class="mono" style="color:var(--muted);font-size:11px">' + esc(c.rtsp_path) + "</span>" +
      "</label>").join("") +
    '<div class="hint">Har biri alohida kamera bo\'lib qo\'shiladi: «Nomi 1-kanal», ' +
    "«Nomi 2-kanal»… Nuqtalar tanlangan joy atrofiga tarqatiladi, keyin har birini " +
    "xaritada o'z joyiga surish mumkin.</div></div>";
  box.querySelectorAll("input[data-ch]").forEach((cb) =>
    cb.addEventListener("change", updateSaveLabel));
}

$("f-scan").addEventListener("click", async () => {
  const out = $("f-scan-out");
  const show = (kind, tx) => { out.className = "probe-out show " + kind; out.textContent = tx; };
  const ip = $("f-ip").value.trim();
  if (!ip) { show("bad", "Avval IP manzilni kiriting"); return; }
  $("f-scan").disabled = true;
  state.scan = null;
  $("f-channels").innerHTML = "";
  updateSaveLabel();
  show("wait", "Qurilma aniqlanmoqda — shablonlar va kanallar tekshirilmoqda (~10-30 s)…");
  try {
    const res = await api("/api/admin/scan", {
      method: "POST",
      body: JSON.stringify({
        ip,
        port: Number($("f-port").value) || 554,
        username: $("f-user").value.trim(),
        password: $("f-pass").value || "",
        camera_id: state.editingId
      })
    });
    if (!res.found) { show("bad", res.message); }
    else {
      state.scan = res;
      const first = res.channels[0];
      $("f-vendor").value = res.vendor;
      $("f-path").value = first.rtsp_path;
      updatePreview();
      renderScanChannels(res);
      updateSaveLabel();
      show("ok", res.device === "nvr"
        ? res.vendor_name + " registrator (NVR) — " + res.channels.length +
          " ta jonli kanal topildi"
        : res.vendor_name + " — bitta kamera · kodek " + (first.codec || "noma'lum") +
          (first.needs_transcode ? " (H.264 ga o'girib beriladi)" : ""));
    }
  } catch (e) { show("bad", e.message); }
  $("f-scan").disabled = false;
});

/* --- saqlash --- */
$("f-save").addEventListener("click", async () => {
  const err = $("cam-err");
  err.classList.remove("show");
  const lat = parseFloat($("f-lat").value);
  const lng = parseFloat($("f-lng").value);

  const body = {
    name: $("f-name").value.trim(),
    region: $("f-region").value.trim(),
    lat, lng,
    source_type: state.sourceType,
    enabled: $("f-enabled").checked,
    always_on: $("f-always").checked,
    note: $("f-note").value.trim(),
    ip: $("f-ip").value.trim(),
    port: Number($("f-port").value) || 554,
    username: $("f-user").value.trim(),
    password: $("f-pass").value || null,
    rtsp_path: $("f-path").value.trim() || "/stream1",
    vendor: $("f-vendor").value,
    stream_url: $("f-url").value.trim()
  };

  const fail = (m) => { err.textContent = m; err.classList.add("show"); };
  if (!body.name || !body.region) return fail("Nomi va hududini to'ldiring");
  if (Number.isNaN(lat) || Number.isNaN(lng)) return fail("Koordinatani xaritadan tanlang yoki qo'lda kiriting");
  if (body.source_type === "rtsp" && !body.ip) return fail("IP manzilni kiriting");
  if (body.source_type === "manual" && !body.stream_url) return fail("Oqim manzilini kiriting");

  // Skaner bir nechta kanal topgan bo'lsa — har biri alohida kamera bo'ladi.
  const picked = state.sourceType === "rtsp" ? scanPicked() : null;
  if (!state.editingId && picked && picked.length > 1) {
    $("f-save").disabled = true;
    try {
      const res = await api("/api/admin/nvr/import", {
        method: "POST",
        body: JSON.stringify({
          ip: body.ip, port: body.port,
          username: body.username, password: $("f-pass").value || "",
          vendor: state.scan.vendor,
          channels: picked.map((c) => c.channel).join(","),
          region: body.region, name_prefix: body.name,
          lat, lng, spread_m: 60, stream: "main",
          enabled: body.enabled, probe: true, dry_run: false
        })
      });
      closeModal("cam-modal");
      resetScan();
      await loadCameras();
      if (state.tab === "admin") await loadAdminCameras(0);
      addEvent(body.name + " — " + res.created + " ta kamera qo'shildi", "ok");
      toast(res.created + " ta kamera qo'shildi");
    } catch (e) { fail(e.message); }
    $("f-save").disabled = false;
    return;
  }
  if (picked && picked.length === 1 && state.scan) {
    body.rtsp_path = picked[0].rtsp_path;
    body.vendor = state.scan.vendor;
  }

  $("f-save").disabled = true;
  try {
    if (state.editingId) {
      await api("/api/admin/cameras/" + state.editingId, { method: "PUT", body: JSON.stringify(body) });
    } else {
      await api("/api/admin/cameras", { method: "POST", body: JSON.stringify(body) });
    }
    closeModal("cam-modal");
    await loadCameras();
    if (state.tab === "admin") await loadAdminCameras(state.adminOffset);
    addEvent(body.name + (state.editingId ? " — tahrirlandi" : " — qo'shildi"), "ok");
    toast(state.editingId ? "O'zgarishlar saqlandi" : "Kamera qo'shildi");
    if (body.always_on) {
      toast("«Doim tayyor» o'zgardi — «MediaMTX» tugmasini bosing");
    }
  } catch (e) {
    fail(e.message);
  }
  $("f-save").disabled = false;
});

/* ---------- NVR dan ommaviy qo'shish ---------- */
$("nvr-btn").addEventListener("click", () => {
  $("nvr-err").classList.remove("show");
  $("n-out").className = "probe-out";
  $("n-table").innerHTML = "";
  $("n-save").disabled = true;
  $("n-vendor").innerHTML = $("f-vendor").innerHTML;
  $("n-vendor").value = "hikvision";
  openModal("nvr-modal");
});

$("n-pick").addEventListener("click", () => {
  $("nvr-modal").classList.remove("open");
  state.picking = "nvr";
  document.body.classList.add("picking");
  showTab("map");
  toast("Xaritada registrator joylashgan nuqtani bosing");
});

function nvrBody(dryRun) {
  return {
    ip: $("n-ip").value.trim(),
    port: Number($("n-port").value) || 554,
    username: $("n-user").value.trim(),
    password: $("n-pass").value,
    vendor: $("n-vendor").value,
    channels: $("n-channels").value.trim(),
    region: $("n-region").value.trim(),
    name_prefix: $("n-prefix").value.trim(),
    lat: parseFloat($("n-lat").value),
    lng: parseFloat($("n-lng").value),
    spread_m: Number($("n-spread").value) || 0,
    stream: $("n-stream").value,
    probe: true,
    dry_run: dryRun
  };
}

function nvrValidate(body) {
  const err = $("nvr-err");
  const fail = (m) => { err.textContent = m; err.classList.add("show"); return false; };
  err.classList.remove("show");
  if (!body.ip) return fail("NVR manzilini kiriting");
  if (!body.region) return fail("Hududni kiriting");
  if (Number.isNaN(body.lat) || Number.isNaN(body.lng))
    return fail("Koordinatani xaritadan tanlang yoki qo'lda kiriting");
  return true;
}

function showNvrOut(kind, tx) {
  const el = $("n-out");
  el.className = "probe-out show " + kind;
  el.textContent = tx;
}

async function nvrRun(dryRun) {
  const body = nvrBody(dryRun);
  if (!nvrValidate(body)) return;

  const btn = dryRun ? $("n-check") : $("n-save");
  btn.disabled = true;
  showNvrOut("wait", "Kanallar tekshirilmoqda — biroz kuting…");
  try {
    const res = await api("/api/admin/nvr/import", {
      method: "POST", body: JSON.stringify(body)
    });
    renderNvrTable(res.planned);
    const ok = res.reachable;
    if (dryRun) {
      showNvrOut(ok ? "ok" : "bad",
        res.planned.length + " ta kanaldan " + ok + " tasi javob berdi" +
        (ok ? " — «Qo'shish» tugmasini bosing" : ""));
      $("n-save").disabled = ok === 0;
    } else {
      showNvrOut("ok", res.created + " ta kamera qo'shildi");
      closeModal("nvr-modal");
      await loadCameras();
      if (state.tab === "admin") await loadAdminCameras(0);
      addEvent(body.region + " — NVR'dan " + res.created + " ta kamera qo'shildi", "ok");
      toast(res.created + " ta kamera qo'shildi — darhol ishlatsa bo'ladi");
    }
  } catch (e) {
    showNvrOut("bad", e.message);
  }
  btn.disabled = false;
}

function renderNvrTable(planned) {
  if (!planned || !planned.length) { $("n-table").innerHTML = ""; return; }
  const rows = planned.map((p) => {
    const mark = p.ok === null ? "·" : p.ok ? "✓" : "✕";
    const cls = p.ok === null ? "" : p.ok ? "ok" : "bad";
    return '<tr class="' + cls + '"><td>' + p.channel + "</td>" +
           "<td>" + mark + "</td>" +
           "<td>" + esc(p.codec || "—") + (p.transcode ? " →H264" : "") + "</td>" +
           '<td title="' + esc(p.message) + '">' + esc(p.message.slice(0, 44)) + "</td></tr>";
  }).join("");
  $("n-table").innerHTML =
    '<table class="nvr-table"><thead><tr><th>Kanal</th><th></th><th>Kodek</th>' +
    "<th>Holat</th></tr></thead><tbody>" + rows + "</tbody></table>";
}

$("n-scan").addEventListener("click", async () => {
  const ip = $("n-ip").value.trim();
  if (!ip) { showNvrOut("bad", "Avval NVR manzilini kiriting"); return; }
  $("n-scan").disabled = true;
  showNvrOut("wait", "Qurilma aniqlanmoqda — kanallar sanalmoqda…");
  try {
    const res = await api("/api/admin/scan", {
      method: "POST",
      body: JSON.stringify({
        ip,
        port: Number($("n-port").value) || 554,
        username: $("n-user").value.trim(),
        password: $("n-pass").value || ""
      })
    });
    if (!res.found) { showNvrOut("bad", res.message); }
    else {
      $("n-vendor").value = res.vendor;
      $("n-channels").value = res.channels.map((c) => c.channel).join(",");
      showNvrOut("ok", res.vendor_name + " — " + res.channels.length +
        " ta jonli kanal topildi; hudud va nuqtani belgilab «Qo'shish»ni bosing");
      $("n-save").disabled = false;
    }
  } catch (e) { showNvrOut("bad", e.message); }
  $("n-scan").disabled = false;
});

$("n-check").addEventListener("click", () => nvrRun(true));
$("n-save").addEventListener("click", () => nvrRun(false));

/* ---------- MediaMTX ---------- */
$("sync-btn").addEventListener("click", async () => {
  openModal("mtx-modal");
  $("mtx-text").textContent = "Yuklanmoqda…";
  try {
    const r = await api("/api/admin/mediamtx/config");
    $("mtx-text").textContent = r.text;
    $("mtx-lead").textContent = r.api_available
      ? "MediaMTX ishlab turibdi — o'zgarishlar qayta ishga tushirmasdan qo'llanadi."
      : "MediaMTX hozir ishlamayapti — fayl yoziladi, keyin MediaMTX'ni ishga tushiring.";
  } catch (e) {
    $("mtx-text").textContent = e.message;
  }
});

$("mtx-apply").addEventListener("click", async () => {
  $("mtx-apply").disabled = true;
  try {
    const r = await api("/api/admin/mediamtx/sync", { method: "POST" });
    closeModal("mtx-modal");
    toast(r.written + " ta kamera yozildi · " + r.live.message, !r.live.ok);
    addEvent("MediaMTX konfiguratsiyasi qo'llandi", "ok");
  } catch (e) {
    toast(e.message, true);
  }
  $("mtx-apply").disabled = false;
});

/* ---------- Umumiy ---------- */
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  // Kirish ekrani Escape bilan yopilmaydi — u majburiy.
  if (document.querySelector(".login-screen.open")) return;
  const open = document.querySelector(".backdrop.open");
  if (open) { closeModal(open.id); return; }
  if (state.picking) {
    const target = state.picking === "nvr" ? "nvr-modal" : "cam-modal";
    stopPicking(true);
    openModal(target);
    return;
  }
  if (!$("sel-body").hidden) { closeSel(); return; }
  if (state.tab !== "map") showTab("map");   // devor/dashboard/boshqaruvdan qaytish
});

let toastTimer = null;
function toast(text, bad) {
  const t = $("toast");
  t.textContent = text;
  t.classList.toggle("bad", Boolean(bad));
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}

/* ---------- Ishga tushirish ----------
   Sahifa "booting" holatida ochiladi: ilova yashirin, o'rnida splash turadi.
   Kim ekanimiz aniqlanib, ma'lumot yuklangach interfeys ko'rsatiladi. */
function bootDone() {
  const el = document.getElementById("splash");
  document.documentElement.classList.remove("booting");
  if (!el || el.classList.contains("out")) return;
  // Ilova ko'rinadi, splash esa ustidan yumshoq so'nadi.
  el.classList.add("out");
  setTimeout(() => el.classList.remove("out"), 400);
}

/* Yuklanish ekranidagi holat matni. */
function bootStatus(text) {
  const el = document.getElementById("sp-status");
  if (el) el.textContent = text;
}
// Xavfsizlik uchun: kutilmagan xato bo'lsa ham sahifa abadiy splashda
// qolmasin. Kirish kutilayotganda taymer to'xtatiladi — aks holda kirgan
// zahoti bo'sh dashboard bir zumga ko'rinib ketadi.
let bootSafety = setTimeout(bootDone, 8000);


(async function start() {
  // index.html'dagi skript mavzuni allaqachon tanlagan (saqlangan yoki tizimniki).
  setTheme(document.documentElement.dataset.theme || "dark", false);
  startClock();
  setSelOpen(false);
  // Kontur darhol chiziladi — kirish sahifasidagi xarita bo'sh qolmasin.
  // Chegara fayli ochiq statik fayl, kirish talab qilmaydi; kamera
  // nuqtalari esa hozircha yo'q, ular ma'lumot kelgach qo'shiladi.
  drawHeadMaps();

  // Kirish ekrani — birinchi qadam. Kirilmagan bo'lsa u ochiladi: serverda
  // anonim ko'rish yoqiq bo'lsa "Mehmon sifatida davom etish" bilan o'tsa
  // bo'ladi, o'chiq bo'lsa yuklash kirishgacha kutadi.
  // Server hali ko'tarilmagan bo'lsa kirgan foydalanuvchiga ham kirish
  // ekrani chiqib qolmasin — javob kelguncha qayta so'raymiz.
  let me = null;
  bootStatus("Serverga ulanmoqda…");
  for (let attempt = 0; attempt < 30 && !me; attempt++) {
    try { me = await api("/api/auth/me"); }
    catch (e) { await new Promise((r) => setTimeout(r, 2000)); }
  }
  applyMe(me);

  // Chuqur havola: /#wall, /#dash, /#admin. Yopiq bo'lim so'ralgan bo'lsa-yu
  // kirilmagan bo'lsa — manzil tozalanadi, bo'lim umuman ochilmaydi.
  let hashTab = location.hash.replace("#", "");
  if (!["wall", "dash", "admin"].includes(hashTab)) hashTab = "";
  if (hashTab && AUTH_TABS.includes(hashTab) && !(me && me.authenticated)) {
    history.replaceState(null, "", location.pathname);
  }

  // Telefonda ro'yxat xaritani yopib qo'ymasin — chiplar orqali ochiladi.
  if (MOBILE.matches) setListOpen(false);

  if (!(me && me.authenticated)) {
    // Kirish majburiy (yoki mehmon sifatida o'tiladi) — tanlovgacha
    // hech narsa yuklanmaydi.
    bootStatus("Kirish kutilmoqda");
    clearTimeout(bootSafety);
    openLogin();
    await new Promise((resolve) => { pendingStart = resolve; });
    bootSafety = setTimeout(bootDone, 8000);
  }
  bootStatus("Kameralar yuklanmoqda…");

  // Server hali ko'tarilmagan bo'lsa (masalan, birga ishga tushirilganda)
  // sahifa bo'sh qolib ketmaydi — ulanguncha qayta urinamiz.
  for (let attempt = 0; ; attempt++) {
    try { await loadCameras(); break; }
    catch (e) {
      if (attempt === 0) {
        bootDone();          // xato bo'lsa ham interfeys ko'rinsin
        toast("Server bilan aloqa yo'q — qayta urinilmoqda…", true);
      }
      if (attempt >= 30) { toast("Server javob bermayapti: " + e.message, true); return; }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // Uzilgan kameralar birinchi ochilishda hodisalar ro'yxatiga tushadi.
  state.cameras.filter((c) => c.online === false).forEach((c) =>
    addEvent(c.name + " — uzilgan (oxirgi onlayn: " + fmtLastSeen(c.last_seen) + ")", "danger"));

  drawHeadMaps();
  if (hashTab) showTab(hashTab);
  // Interfeys to'liq tayyor bo'lgandan keyin ko'rsatiladi — yangilashda
  // bir zumga noto'g'ri bo'lim yoki yopiq dashboard ko'rinib ketmasin.
  bootDone();

  try { await loadVendors(); } catch (e) { /* shakl ochilganda qayta yuklanadi */ }
})();
