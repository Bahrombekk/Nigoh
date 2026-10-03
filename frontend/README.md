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
├─ index.html          butun sahifa: kirish ekrani, 4 bo'lim, modal oynalar
├─ css/style.css       mavzular (qorong'i/yorug'), moslashuv (telefon)
├─ assets/             O'zbekiston va viloyat chegaralari (geojson), fon rasmi
└─ js/
   ├─ main.js          kirish nuqtasi — ishga tushirish ketma-ketligi
   ├─ holat.js         `state` (butun holat), `$`, `esc`, `toast` — hamma shuni oladi
   ├─ api.js           backend bilan aloqa: api(path, options)
   ├─ auth.js          kirish ekrani, sessiya, rol, mehmon rejimi
   ├─ malumot.js       kameralar ro'yxatini yuklash va 30 s da yangilash
   ├─ xarita.js        Leaflet: plitkalar, chegara, markerlar, klasterlar
   ├─ royxat.js        chap panel: ro'yxat, qidiruv, filtrlar
   ├─ tanlov.js        tanlangan kamera paneli
   ├─ pleyer.js        video pleyer: WebRTC (WHEP) -> HLS zaxira
   ├─ devor.js         video devor: setka, sifat tanlovi, avto-almashish
   ├─ dashboard.js     dashboard ma'lumotlari va bloklari
   ├─ grafiklar.js     SVG grafiklar (kutubxonasiz)
   ├─ tablar.js        bo'limlar orasida o'tish, yon menyu, bildirishnomalar
   ├─ admin.js         boshqaruv jadvali
   ├─ kamera-shakli.js kamera qo'shish/tahrirlash shakli
   ├─ nvr.js           registrator kanallarini ommaviy qo'shish
   ├─ modallar.js mavzu.js ikonkalar.js
```

Har bir fayl tepasida nima qilishi yozilgan; bog'liqliklar `import` qatorlarida
ko'rinadi. Umumiy holat bitta joyda — `holat.js` dagi `state` obyekti.

## Tashqi kutubxonalar (CDN)

Leaflet 1.9 + markercluster (xarita), hls.js (HLS video), Google Fonts.
Ular `index.html` da ulanadi; ruxsat etilgan manbalar backenddagi CSP
ro'yxatida (`backend/api/__init__.py`, `_CSP`) — yangi CDN qo'shsangiz
o'sha ro'yxatga ham qo'shing.

## Video qanday ochiladi

1. `GET /api/cameras/{id}/stream?hevc=0|1` — chiptali manzillar
   (`webrtc_url`, `stream_url`, `mode`).
2. Avval WebRTC (WHEP): kadr 6 s ichida kelmasa — HLS (hls.js).
3. Kamera javob bermasa (WHEP 400 "source timed out") — darhol xabar,
   HLS'ga o'tilmaydi.
4. Devorda past sifatli 2-oqim (`quality=sub`), to'liq ekranda asosiy oqim.

API yo'llarining to'liq ro'yxati: ishlab turgan serverda `/docs`.
