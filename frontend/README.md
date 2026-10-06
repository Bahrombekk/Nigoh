# Nigoh — frontend

Xarita, video devor, dashboard va boshqaruv paneli. Oddiy HTML + CSS + ES
modullar: **build qadami yo'q** (webpack/vite kerak emas) — fayl o'zgarsa
sahifani yangilash kifoya.

## Ishga tushirish

Eng oson: backendni ishga tushiring (`../backend/README.md`) — u shu
papkani o'zi beradi: http://localhost:8010

Alohida server bilan ishlash (masalan nginx yoki o'z dev serveringiz):
backendni `FRONTEND_DIR=` (bo'sh) bilan ishga tushiring, bu papkani istalgan
statik server bilan bering va `/api/` ni backendga (8010) proksi qiling.
Barcha so'rovlar nisbiy manzilga (`/api/...`) ketadi, ya'ni CORS kerak emas.

## Tuzilma

```
frontend/
├─ index.html              butun sahifa: kirish ekrani, 4 bo'lim, modal oynalar
├─ css/style.css           mavzular (qorong'i/yorug'), moslashuv (telefon)
├─ assets/                 O'zbekiston va viloyat chegaralari (geojson), fon rasmi
└─ js/
   ├─ main.js              kirish nuqtasi — ishga tushirish ketma-ketligi, Escape
   ├─ core/                umumiy infratuzilma (hamma bo'lim ishlatadi)
   │  ├─ state.js          `state` (butun holat), `$`, `esc`, `toast`, HEVC_OK, PLAYOUT_DELAY
   │  ├─ api.js            backend bilan aloqa: api(path, options), 401 -> kirish oynasi
   │  ├─ data.js           kameralar ro'yxatini yuklash (/api/cameras) va 30 s da yangilash
   │  ├─ modals.js         modal oynalarni ochish/yopish
   │  ├─ theme.js          qorong'i/yorug' mavzu, xarita qatlamlarini moslash
   │  └─ icons.js          inline SVG ikonkalar (ICO) — ma'lumot moduli
   ├─ auth/
   │  └─ auth.js           kirish ekrani, sessiya, rol (admin/operator), mehmon rejimi
   ├─ layout/
   │  ├─ tabs.js           bo'limlar orasida o'tish (#hash), yon menyu, yordam, soat, kontur
   │  └─ notifications.js  hodisalar lentasi (addEvent) va qo'ng'iroq paneli
   ├─ map/
   │  ├─ map.js            Leaflet: plitkalar, chegara, markerlar, klasterlar, xarita tugmalari
   │  ├─ camera-list.js    chap panel: ro'yxat, qidiruv, filtrlar, hover surati, pastki chiziqcha
   │  └─ selection.js      tanlangan kamera paneli (jonli video, tafsilotlar)
   ├─ player/
   │  └─ player.js         video pleyer: WebRTC (WHEP) -> HLS zaxira; WebRTC sog'ligi; prewarm
   ├─ wall/
   │  └─ video-wall.js     video devor: setka, sifat tanlovi, sahifalar, avto-almashish
   ├─ dashboard/
   │  ├─ dashboard.js      dashboard: KPI, donut, hududlar, texnik kesim, tizim holati, tezkor amallar
   │  ├─ overview.js       ishonchlilik hisoboti, liniya sxemasi, uzilishlar xaritasi, ma'lumot sifati
   │  └─ charts.js         SVG grafiklar (kutubxonasiz): onlaynlik chizig'i, ustunlar, tooltip
   └─ admin/
      ├─ admin.js          boshqaruv jadvali va MediaMTX oynasi
      ├─ camera-form.js    kamera qo'shish/tahrirlash shakli, xaritadan joy tanlash, viloyatni aniqlash
      └─ nvr.js            registrator (NVR) kanallarini ommaviy qo'shish
```

Har bir fayl tepasida sarlavha izohi bor: vazifasi, eksportlari (har biri bir
qator), bog'liqliklari (importlar va global `L` / `Hls`), ishlatadigan DOM
elementlari (id) va backend yo'llari, muhim qoidalar/tuzoqlar. Umumiy holat
bitta joyda — `core/state.js` dagi `state` obyekti.

## Klasslar

Har bir bo'lim modulida bitta (ba'zan ikki) klass bor; u o'z holatini
(taymerlar, keshlar, bayroqlar) maydonlarida saqlaydi va DOM tugmalarini
konstruktorida ulaydi.

| Klass | Fayl | Vazifasi |
|---|---|---|
| `ApiClient` | core/api.js | `/api/...` so'rovlari, xato xabari, 401 da kirish oynasi |
| `CameraStore` | core/data.js | kameralar ro'yxatini yuklash/yangilash, bog'liq ko'rinishlarni chizdirish |
| `Modals` | core/modals.js | modal oynalarni ochish/yopish |
| `ThemeSwitcher` | core/theme.js | mavzu almashtirish va saqlash |
| `Auth` | auth/auth.js | login/logout, rol, mehmon rejimi, kirishni kutish |
| `Tabs` | layout/tabs.js | bo'limlar orasida o'tish, #hash, yopiq bo'limlar |
| `AppShell` | layout/tabs.js | yon menyu, yordam, soat, sarlavha konturlari |
| `Notifications` | layout/notifications.js | hodisalar lentasi va qo'ng'iroq |
| `MapView` | map/map.js | Leaflet xarita, qatlamlar, markerlar, klasterlar |
| `CameraList` | map/camera-list.js | chap ro'yxat, qidiruv, filtrlar, pastki chiziqcha |
| `SelectionPanel` | map/selection.js | tanlangan kamera paneli va uning pleyeri |
| `Player` | player/player.js | bitta `<video>` da oqim: WebRTC -> HLS |
| `WebRtcHealth` | player/player.js | WebRTC jim qolishini sanash (seans bo'yicha HLS'ga o'tish) |
| `StreamPrewarmer` | player/player.js | hover'da kamerani oldindan uyg'otish (oqim ochmasdan) |
| `VideoWall` | wall/video-wall.js | devor setkasi, plitkalar (diff), sozlamalar |
| `Dashboard` | dashboard/dashboard.js | dashboard bloklari, statistika, 15 s avto-yangilash |
| `OverviewReport` | dashboard/overview.js | ishonchlilik hisoboti va liniya sxemasi |
| `Charts` | dashboard/charts.js | vaqt grafiklari (chiziq, ustunlar) |
| `ChartTooltip` | dashboard/charts.js | grafiklar uchun umumiy maslahat oynasi |
| `AdminTable` | admin/admin.js | boshqaruv jadvali: sahifalash, filtr, saralash, eksport |
| `MediaMtxPanel` | admin/admin.js | MediaMTX konfiguratsiyasini ko'rish/qo'llash |
| `CameraForm` | admin/camera-form.js | kamera shakli, skaner, xaritadan joy tanlash |
| `NvrImport` | admin/nvr.js | NVR kanallarini ommaviy qo'shish |

Klass emas (ataylab): `core/state.js` (`state` oddiy obyekt va mayda
yordamchilar), `core/icons.js` (ma'lumot), `main.js` (ishga tushirish
ketma-ketligi), sof formatlovchi funksiyalar (`fmtLastSeen`, `hasGeo`,
`visibleCams`, `saveSnapshot`, `firstDraw`, `hatchDef` ...).

## Konvensiyalar

- **Yagona nusxa + nomli eksportlar.** Har modul o'z klassining bitta
  nusxasini yaratadi va eski funksiya nomlarini yupqa o'ram sifatida
  eksport qiladi:
  ```js
  export class MapView { ... }
  export const mapView = new MapView();
  export function rebuildMarkers() { mapView.rebuildMarkers(); }
  ```
  Boshqa modullar odatda o'ramni (`rebuildMarkers`) import qiladi. O'ramlar
  `function` e'lonlari — ular ko'tariladi (hoisting), shuning uchun aylanma
  importlarda ham nomning o'zi doim mavjud.
- **Jonli eksportlar.** `tiles`, `uzMask`, `uzBorder` (map.js), `selPlayer`
  (selection.js), `wallPlayers` (video-wall.js) — `export let`; klass
  maydoni bilan bir joyda birga yoziladi.
- **Konstruktorda faqat o'z moduli.** Konstruktor `$`, `state`, `document`,
  `L` va o'z metodlarini ishlatadi. Boshqa bo'lim moduliga murojaat faqat
  hodisa ishlovchilari ichida (ya'ni hamma modul yuklangandan keyin).
  Aylanma importlar bor (masalan data.js <-> dashboard.js), shuning uchun
  import paytida boshqa modul nusxasiga tegish TDZ xatosiga olib keladi.
- **Ishga tushirish tartibi (main.js).** 1) importlar baholanadi — har
  modul nusxasini yaratadi va tugmalarni ulaydi; 2) `xaritaTanlashniUlash()`
  va `initOverview()` — boshqa modullarga bog'liq ulashlar, hamma modul
  yuklangach; 3) `start()`: mavzu, soat, `/api/auth/me`, kerak bo'lsa kirishni
  kutish, `/api/cameras`, #hash bo'limi, splash yopiladi. main.js dagi
  "faqat yon ta'sir uchun" importlarni (`import "./admin/nvr.js"` va h.k.)
  olib tashlamang — ular tugmalarni ulaydi.
- Izohlar o'zbekcha (lotin), fayl/papka nomlari inglizcha.

## Tekshirish (build yo'q — qo'lda)

```
# har fayl: sintaksis va takroriy e'lonlar (oddiy `node --check` ni emas, shuni ishlating)
for f in $(find js -name "*.js"); do node --input-type=module --check < "$f" || echo "XATO: $f"; done
```

Yangi import qo'shsangiz: nisbiy yo'l to'g'riligini va nom haqiqatan
eksport qilinganini tekshiring — xato bo'lsa sahifa yuklanish ekranida
qolib ketadi (brauzer konsolida SyntaxError).

## Tashqi kutubxonalar (CDN)

Leaflet 1.9 + markercluster (xarita), hls.js (HLS video), Google Fonts.
Ular `index.html` da ulanadi; ruxsat etilgan manbalar backenddagi CSP
ro'yxatida (`backend/app/factory.py`, `_CSP`) — yangi CDN qo'shsangiz
o'sha ro'yxatga ham qo'shing.

## Video qanday ochiladi

1. `GET /api/cameras/{id}/stream?hevc=0|1` — chiptali manzillar
   (`webrtc_url`, `stream_url`, `mode`).
2. Avval WebRTC (WHEP): kadr 6 s ichida kelmasa — HLS (hls.js).
3. Kamera javob bermasa (WHEP 400 "source timed out") — darhol xabar,
   HLS'ga o'tilmaydi.
4. Devorda past sifatli 2-oqim (`quality=sub`), to'liq ekranda asosiy oqim.

API yo'llarining to'liq ro'yxati: ishlab turgan serverda `/docs`.
