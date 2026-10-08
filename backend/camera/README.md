# camera/ — kamera qatlami

Kamera bilan bog'liq hamma narsa: qo'shish va tekshirish, MediaMTX
boshqaruvi, fon kuzatuvi va brauzerga oqim berish. Har faylning
boshidagi docstring — o'sha fayl uchun batafsil xarita (vazifasi,
"nima uchun"lari, ochiq funksiyalari va kim chaqirishi).

## Tuzilma

```
camera/
├── __init__.py          paket xaritasi; `camera.sync` = camera.media.sync
├── schemas.py           so'rov modellari: CameraIn, EnabledIn, NvrIn, NodeIn, ProbeIn, ScanIn
├── state.py             camera_state() — yagona holat; resolve_ref() — id yoki ext:...
├── streaming.py         stream_urls() — WebRTC/HLS manzillari + chipta; node_info()
├── views.py             public_camera(), admin_camera(), mask_config()
├── trash.py             savat: yumshoq o'chirilganlar 30 kundan keyin butunlay o'chadi (health ilgagi)
├── api/                 HTTP endpointlar (/api/v1 va /api ostida)
│   ├── cameras.py       /cameras — xarita ro'yxati (fps, online_since), status, stream, snapshot,
│   │                    sub-bad, details (timeline_24h, availability_24h)
│   ├── streams.py       /streams — devor uchun batch oqim chiptalari
│   ├── events.py        /events — holat o'zgarishlari SSE
│   ├── metrics.py       /metrics/open — pleyer ochilish vaqti (?camera_id= — bitta kamera)
│   ├── devices.py       /devices — fon skani (job + SSE), qurilma pasporti
│   ├── admin.py         /admin/cameras CRUD (filtr/saralash/counts/facets serverda; o'chirish
│   │                    yumshoq + restore, deleted, bulk, export), NVR import, scan, probe,
│   │                    detect-sub, enabled, uptime, keyframe
│   ├── nodes.py         /admin/nodes — MediaMTX tugunlari, tugun konfiguratsiyasi
│   └── mediamtx.py      /admin/events, /admin/mediamtx/sync, /admin/mediamtx/config
├── media/               MediaMTX qatlami
│   ├── sync.py          mediamtx.yml, Control API (ensure_path, push_to_api), FFmpeg argumentlari, issiq yo'llar
│   ├── reconciler.py    Reconciler — har 30 s yo'llarni kelishtiradi, MediaMTX'ni ko'taradi; har 5 s muzlash, sub salomatligi
│   ├── launcher.py      MediaMTX chaqiradigan jarayon: _h264 o'girish, relay, wall_ mozaika
│   ├── transport.py     kamera uchun TCP/UDP ni o'lchab tanlash (rtsp_udp)
│   ├── fast_start.py    ONVIF/ISAPI keyframe so'rovi, HTTP/RTSP surat, kanal raqami
│   └── mapping.py       baza qatori -> MediaMTX lug'ati (camera_for_mediamtx)
├── monitoring/          fon xizmatlari (klass + yagona `service` + aliaslar)
│   ├── health.py        HealthMonitor — TCP tiriklik har 60 s, SSE `state`, latency_ms, ilgaklar
│   ├── snapshots.py     SnapshotService — diskdagi suratlar, issiq/sovuq yangilash, SSE `snapshot`
│   ├── passport.py      PassportChecker — bo'sh kodek/model'ni fonda to'ldirish
│   └── open_times.py    ochilish vaqti namunalari, p50/p95 (/health)
└── probe/               qurilmani bir martalik tekshirish
    ├── rtsp_probe.py    probe() — tarmoq -> RTSP -> parol -> SETUP; SDP tahlili; sub yo'l nomzodlari
    ├── device_info.py   ONVIF/ISAPI pasport: manufacturer, model, firmware, serial, mac
    └── detect.py        detect_codec(), detect_sub_path(), channel_path() — vendor shablonlari
```

Tashqarida: `backend/stream_launcher.py` (MediaMTX chaqiradigan yupqa
qobiq -> `camera.media.launcher.main`), `mediamtx/` dasturi (repo
ildizi), `mediamtx.yml` (DATA_DIR, standart — repo ildizi).

## Kamera hayot sikli

```
 qo'shish ─► tekshirish ─► MediaMTX yo'li ─► kuzatuv ─► brauzerga oqim
```

1. **Qo'shish** — `POST /admin/cameras` (yoki NVR import, skan).
   `schemas.CameraIn` tekshiriladi; takror IP+port+yo'l yangi nusxa
   yaratmaydi (201 + o'sha kamera, `X-Nigoh-Existing: 1`). Joylashuv
   normallashtiriladi (hudud, km/piket), parol shifrlanib bazaga yoziladi.

2. **Tekshirish (probe)** — saqlashdan oldin `probe/detect.py` kameradan
   kodek, o'lcham, fps va sub yo'lni so'raydi (`rtsp_probe.probe`).
   H.265 bo'lsa `transcode` belgilanadi. Saqlangach `health.check_now`
   holatni darhol aniqlaydi, `device_info` pasportni fonda to'ldiradi.
   Kamera o'sha paytda javob bermasa — `monitoring/passport.py` keyinroq
   qayta urinadi.

3. **MediaMTX yo'li** — kameralar `mediamtx.yml` ga yozilmaydi.
   Kimdir kamerani ochganda (`GET /cameras/{ref}/stream`, `POST /streams`)
   `media.sync.ensure_path` yo'lni Control API orqali yaratadi (~9 ms),
   yo'l "issiq" belgilanadi va `fast_start` kameradan keyframe so'raydi.
   MediaMTX manbani o'zi tortadi; H.265 uchun `_h264` shablon yo'li,
   relay va devor mozaikasi uchun esa `launcher.py` (FFmpeg) chaqiriladi.
   `media/reconciler.py` har 30 s da tugunlarni kerakli holatga keltiradi
   (ishlatilmayotgan yo'llarni olib tashlaydi, MediaMTX yiqilsa ko'taradi).

4. **Kuzatuv** — fon xizmatlari (`app/bootstrap.py` ishga tushiradi):
   - `health` — TCP tiriklik har 60 s; o'zgarish -> `events` jadvali + SSE `state`;
   - `reconciler` — faol oqim baytlari: 20 s qo'zg'almasa `stalled`;
     ochilmayotgan yo'l uchun `transport` sinovi (TCP/UDP); sub salomatligi;
   - `snapshots` — suratlar diskda, issiq (10 s) / sovuq (>=10 daqiqa);
   - `passport` — bo'sh kodek/model'ni har 10 daqiqada to'ldirish.
   Bularning yig'indisi — `state.camera_state()`:
   `disabled / unknown / offline / stalled / online`.

5. **Brauzerga oqim** — `streaming.stream_urls` WebRTC (WHEP) va HLS
   manzillarini muddatli chipta bilan beradi; MediaMTX har ulanishda
   ruxsatni backend'dan so'raydi (`/api/auth/stream`). Pleyer avval
   WebRTC'ni, bo'lmasa HLS'ni sinaydi, poster sifatida
   `/cameras/{ref}/snapshot` ni qo'yadi va ochilish vaqtini
   `/metrics/open` ga yuboradi. Holat o'zgarishlari `/events` (SSE) orqali keladi.

## Asosiy klasslar va yagona nusxalar

| Klass | Fayl | Yagona nusxa va aliaslar |
|---|---|---|
| `Reconciler` | media/reconciler.py | `reconciler.service`; `start`, `stalled_paths`, `stalled_count`, `pending_count`, `foreign_nodes` |
| `HealthMonitor` | monitoring/health.py | `health.service`; `start`, `online`, `check_now`, `sweep_stats`, `set_streaming_probe` |
| `SnapshotService` | monitoring/snapshots.py | `snapshots.service`; `start`, `read`, `store_frame`, `capture`, `max_age`, `cycle_stats`, ... |
| `PassportChecker` | monitoring/passport.py | `passport.service`; `start`, `check`, `run_once` |
| `CameraIn` va boshqalar | schemas.py | Pydantic so'rov modellari |

Fon xizmatlari jarayonda bitta nusxada ishlaydi; tashqi kod modul
aliaslarini chaqiradi (`health.online(ip, port)`), klassning o'ziga
faqat testlar murojaat qiladi.

## Bog'liqliklar

- **Ishlatadi:** `core` (security, log, bus, paths), `database`
  (repositories: cameras, nodes, events, areas, rail), `users.access`
  (rollar, hudud cheklovi), `app.config`.
- **Kim ishlatadi:** `app` (routerlarni ulaydi, bootstrap, /health,
  system_api), `stats`, `walls`, `stream_launcher.py`, `scripts`, testlar.
- Reconciler va `sync` kameralarni `mapping.py` lug'ati ko'rinishida
  oladi; reconciler'ga ro'yxatni `app/bootstrap.py` `load_cameras`
  funksiyasi orqali uzatadi, health'ga esa oqim olayotgan manzillar
  manbasini `set_streaming_probe` bilan beradi.
