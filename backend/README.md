# Nigoh — backend

FastAPI ilova: foydalanuvchilar va rollar, kamera bazasi, MediaMTX orqali
video tarqatish, holat kuzatuvi, dashboard statistikasi. Interfeys
(`../frontend/`) shu server orqali beriladi, lekin u alohida ham ishlay oladi.

## Ishga tushirish

```bash
python -m venv ../venv
../venv/Scripts/python -m pip install -r requirements.txt     # Linux: ../venv/bin/python
../venv/Scripts/python main.py                                 # http://localhost:8010
```

- Sozlamalar repo ildizidagi `.env` da (namuna: `../.env.example`). Muhit
  o'zgaruvchilari `.env` dan ustun turadi.
- MediaMTX dasturi `../mediamtx/mediamtx(.exe)` da bo'lishi kerak — backend
  uni o'zi ishga tushiradi, kuzatadi va yiqilsa qayta ko'taradi.
- Baza — PostgreSQL (`DATABASE_URL`, `.env`). Ko'tarish:
  PostgreSQL 17 servisi + `backend/database/sql/setup-roles.sql` (`docs/DEPLOY.md`). Eski `cameras.db` dan
  ko'chirish: `python database/scripts/migrate_sqlite_to_postgres.py --apply`.
- Fayllar (kalit `secret.key`, loglar, `mediamtx.yml`, suratlar) standart
  holda repo ildizida, `NIGOH_DATA` bilan boshqa joyga.
  **`secret.key` yo'qolsa kamera parollari ochilmaydi** — bazadan alohida
  zaxiralang (`backend/database/scripts/backup.sh` ikkalasini birga oladi).
- Testlar alohida `nigoh_test` bazasida (`TEST_DATABASE_URL`), har seansda
  tozalanadi.
- Admin paroli: `python main.py --admin-parol YangiParol`.

## Tuzilma

Kod **mavzu bo'yicha** bo'lingan: har papkada o'sha mavzuning hamma narsasi —
API endpointlari, xizmatlari va (kerak bo'lsa) bazaga murojaati. Har papkada
o'z `README.md` si, har fayl tepasida vazifasi, tarkibi (klass/funksiyalar),
endpointlari va bog'liqliklari yozilgan.

```
backend/
├─ main.py               kirish nuqtasi (uvicorn)
├─ stream_launcher.py    MediaMTX chaqiradigan qobiq (mediamtx.yml shu yo'lni ko'rsatadi)
├─ app/                  ILOVANI YIG'ISH
│  ├─ factory.py         create_app: routerlar (/api/v1 + /api), CSP, frontend
│  ├─ __init__.py        ataylab bo'sh (aylanma importning oldini oladi)
│  ├─ bootstrap.py       ishga tushirish: migratsiya, fon xizmatlari
│  ├─ config.py deps.py  sozlamalar (.env); kirish: sessiya / X-API-Key / mehmon
│  ├─ network.py         ishonchli proksi, mijoz IP manzili
│  ├─ health.py          /health
│  ├─ system_api.py      /admin/runtime, /admin/status
│  └─ logs_api.py        /admin/logs — qidiruv, xulosa, fayllar
├─ database/             BAZA — bazaga tegishli hamma narsa (database/README.md)
│  ├─ connection.py      ulanishlar hovuzi, get_db() (tranzaksiya), qator turi
│  ├─ schema.py          migratsiyalarni qo'llash, versiya, jadval statistikasi
│  ├─ migrations/        0001_initial, 0002_schema_v2, 0003_camera_probe
│  ├─ repositories/      har jadval guruhi — klass: CameraRepository, UserRepository, ...
│  ├─ api.py             /admin/db — baza holati, versiya, hajm
│  ├─ sql/               setup-roles.sql (rollar va ruxsatlar)
│  ├─ scripts/           backup.sh, migrate_sqlite_to_postgres.py, fix_camera_data.py, move_pgdata.ps1
│  ├─ data/              uz_regions.geojson (viloyat chegaralari)
│  ├─ backups/           zaxiralar (git'da emas)
│  └─ pgdata/            PostgreSQL ma'lumot katalogi — ko'chirilgandan keyin (git'da emas)
├─ camera/               KAMERA (camera/README.md)
│  ├─ api/               /cameras, /streams, /events (SSE), /metrics, /devices,
│  │                     /admin/cameras, /admin/nodes, /admin/mediamtx
│  ├─ media/             MediaMTX: sync, Reconciler, launcher, transport, fast_start, mapping
│  ├─ monitoring/        fon xizmatlari: HealthMonitor, SnapshotService, PassportChecker, open_times
│  ├─ probe/             RTSP tekshiruv, ONVIF/ISAPI pasport, saqlashda kodek/sub aniqlash
│  └─ schemas.py state.py streaming.py views.py
├─ stats/                STATISTIKA (stats/README.md)
│  ├─ api.py             /stats/* — har ko'rsatkich alohida (docs/STATS_API.md)
│  ├─ overview.py        /stats/overview (dashboard yig'masi)
│  ├─ admin_api.py       /admin/uptime, /admin/outages/hourly, kamera tarixi
│  ├─ recorder.py        StatsRecorder — 5 daqiqalik suratlar, holat o'zgarishlari
│  └─ reporting/         sof hisob: period, engine (uzilishlar), metrics
├─ users/                FOYDALANUVCHILAR: api (/auth/*), admin_api (/admin/users),
│                        access (rollar, operator hududlari), schemas
├─ walls/                VIDEO DEVOR: api (/walls), registry, mosaic
├─ core/                 umumiy: env, paths, bus, throttle, watchdog, security, alerts, version
│  ├─ log.py             log(service, event, ...) — yagona kirish nuqtasi
│  └─ logs/              log tizimi: toifalar, kunlik fayllar, request_id, maxfiylik (docs/LOGGING.md)
├─ tests/                pytest
└─ scripts/              yordamchi skriptlar (acceptance_test, geo_import, benchmarklar ...)
```

Qoidalar:

* Bazaga faqat `database/` orqali murojaat qilinadi: `from database import cameras, get_db`
  va `with get_db() as db: cameras.get(db, 42)`. SQL boshqa joyda yozilmaydi.
* Fon xizmatlari klass, modulda bitta nusxa (`service`) va ommaviy nomlar:
  `health.online(ip, port)`, `snapshots.start()`.
* `core/` hech kimga bog'liq emas; `database/` faqat `core/` ga; mavzu
  papkalari (`camera/`, `stats/`, `users/`, `walls/`) `database/` va `core/` ga;
  `app/` hammasini yig'adi.

## Kirish (autentifikatsiya)

| Yo'l | Kim | Qanday |
|---|---|---|
| Cookie sessiya | sayt foydalanuvchisi | `POST /api/v1/auth/login` -> `nigoh_session` cookie (12 soat) |
| `X-API-Key` | tashqi backend | `.env` dagi `NIGOH_API_KEY`; admin darajasida |
| Mehmon | hamma | faqat `PUBLIC_VIEW=1` bo'lsa, faqat ko'rish yo'llari |

Rollar: `admin` — hammasi; `operator` — faqat o'ziga biriktirilgan
hududlardagi kameralar (ro'yxat, oqim, surat, devor, SSE shu cheklov bilan).

## API

To'liq hujjat ishlab turgan serverda: **`/docs`** (Swagger) va `/redoc`.
Hamma yo'l `/api/v1/...` da; `/api/...` — o'sha yo'llarning eski nomi
(interfeys va MediaMTX shu bilan ishlaydi).

| Bo'lim | Yo'llar | Kirish |
|---|---|---|
| auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | ochiq |
| | `POST /auth/stream`, `GET /auth/hls` — MediaMTX/nginx chaqiradi | ochiq (chipta) |
| ko'rish | `GET /cameras`, `GET /cameras/status`, `GET /cameras/{ref}/stream`, `GET /cameras/{ref}/snapshot`, `GET /cameras/{ref}/details` (pasport, 7 kunlik ishonchlilik, tarix), `POST /streams`, `POST /walls`, `GET /events` (SSE), `POST /metrics/open`, `GET /metrics/open` (kamera kesimida ochilish vaqti), `GET /vendors` | kirgan / kalit / mehmon |
| dashboard | `GET /stats/dashboard`, `/stats/timeline`, `/stats/overview` | kirgan / kalit |
| statistika | `GET /stats/summary`, `/availability`, `/coverage`, `/series`, `/sla`, `/outages`, `/outages/summary`, `/daily`, `/hourly`, `/heatmap`, `/regions`, `/ranking`, `/cameras/{id}`, `/rail`, `/quality`, `/feed` | kirgan / kalit |
| boshqaruv | `/admin/cameras` (CRUD, enabled, uptime, keyframe, detect-sub), `/admin/users`, `/admin/nvr/import`, `/admin/scan`, `/admin/probe`, `/admin/nodes`, `/admin/status`, `/admin/events`, `/admin/mediamtx/*`, `/admin/uptime`, `/admin/outages/hourly`, `/devices/*` | admin / kalit |
| salomatlik | `GET /health` (prefikssiz) | ochiq |

`{ref}` — kamera id (`123`) yoki tashqi id (`ext:cam-014`).

To'liq qo'llanma: [docs/STATS_API.md](../docs/STATS_API.md).
Statistika endpointlarining umumiy parametrlari: `days=1..30` (oxirgi N kun,
standart 1) yoki `from=YYYY-MM-DD&to=YYYY-MM-DD` (mahalliy sanalar), va
`area_id` (takrorlanadi, tumanlari bilan). Operator faqat o'z hududlarini
ko'radi — begona `area_id` 403. Kuzatuv bo'shlig'i (server ishlamagan vaqt)
uptime'ga kirmaydi; 2 daqiqadan qisqa tugagan uzilish — "sakrash" (`blip`).

Kamera holati (`state`): `disabled / unknown / offline / stalled / online`.

## Tekshirish

```bash
../venv/Scripts/python -m pytest tests -q      # 241 test
../venv/Scripts/python -m ruff check .
python scripts/acceptance_test.py                   # toza konteynerga qarshi (ichida yo'riqnoma)
```

## Miqyos (5000+ kamera)

O'lchangan: `/cameras` ro'yxati 5000 kamerada gzip bilan ~140 KB; MediaMTX
yo'llari faqat ko'rilayotgan kameralar uchun yaratiladi (oqim so'rovi
6-30 ms); holat tekshiruvi 256 parallel TCP ulanish bilan. Asosiy cheklov
— serverdan chiquvchi video trafik (har tomoshabin 2-5 Mbit/s).
