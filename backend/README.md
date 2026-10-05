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
  PostgreSQL 17 servisi + `deploy/postgres/setup-roles.sql` (`docs/DEPLOY.md`). Eski `cameras.db` dan
  ko'chirish: `python scripts/migrate_sqlite_to_postgres.py --apply`.
- Fayllar (kalit `secret.key`, loglar, `mediamtx.yml`, suratlar) standart
  holda repo ildizida, `NIGOH_DATA` bilan boshqa joyga.
  **`secret.key` yo'qolsa kamera parollari ochilmaydi** — bazadan alohida
  zaxiralang (`deploy/db-backup.sh` ikkalasini birga oladi).
- Testlar alohida `nigoh_test` bazasida (`TEST_DATABASE_URL`), har seansda
  tozalanadi.
- Admin paroli: `python main.py --admin-parol YangiParol`.

## Tuzilma

```
backend/
├─ main.py             kirish nuqtasi (uvicorn)
├─ stream_launcher.py  MediaMTX chaqiradigan qobiq (FFmpeg: o'girish, relay, devor)
├─ api/                HTTP qatlami — faqat so'rovni qabul qilish va javob berish
│  ├─ __init__.py      ilovani yig'ish: routerlar, kirish darajalari, frontend
│  ├─ config.py        sozlamalar (.env)
│  ├─ deps.py          kirish: sessiya / X-API-Key / mehmon (PUBLIC_VIEW)
│  ├─ helpers.py       rollar, operator hududlari, baza -> javob tarjimasi
│  ├─ auth.py          login, me, MediaMTX/nginx chipta tekshiruvi
│  ├─ cameras.py streams.py walls.py events.py metrics.py   ko'rish
│  ├─ stats.py         dashboard tarixi (+ har daqiqada yozuvchi)
│  └─ admin.py nodes.py devices.py analytics.py              boshqaruv
├─ camera/             kamera va video qatlami (HTTP'ni bilmaydi)
│  ├─ sync.py          MediaMTX konfiguratsiyasi va API (yo'llar talab bo'yicha)
│  ├─ reconciler.py    MediaMTX kuzatuvi, muzlagan oqimlar, sub tekshiruvi
│  ├─ health.py        kameralar tirikligi (TCP sweep, har 60 s)
│  ├─ rtsp_probe.py    RTSP tekshiruv: login, kodek, o'lcham
│  ├─ snapshots.py     suratlar (diskda, pog'onali yangilanadi)
│  ├─ fast_start.py device_info.py transport.py launcher.py mosaic.py walls.py
│  └─ events.py        media hodisalari jurnali (uptime manbai)
├─ database/           PostgreSQL qatlami — bazaga tegadigan umumiy kod shu yerda
│  ├─ connection.py    ulanishlar hovuzi, get_db() (tranzaksiya), qator turi
│  ├─ schema.py        jadvallar, cheklovlar, raqamlangan migratsiyalar
│  └─ cameras.py       slug va sub oqim yordamchilari
├─ core/               umumiy infratuzilma
│  ├─ env.py paths.py  .env yuklash; yo'llar (ROOT_DIR, DATA_DIR)
│  ├─ security.py      parollar (scrypt), kamera parollari (Fernet), sessiyalar, chiptalar
│  ├─ log.py bus.py throttle.py watchdog.py metrics.py
│  └─ stats.py alerts.py   dashboard tarixi, Telegram ogohlantirishlari
├─ tests/              pytest
└─ scripts/            yordamchi skriptlar (acceptance_test, migrate_sqlite_to_postgres, ...)
```

Qoida: `api/` -> `camera/` -> `core/` yo'nalishida bog'lanadi. `camera/`
HTTP'ni, `core/` esa kamerani bilmaydi.

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
| ko'rish | `GET /cameras`, `GET /cameras/status`, `GET /cameras/{ref}/stream`, `GET /cameras/{ref}/snapshot`, `POST /streams`, `POST /walls`, `GET /events` (SSE), `POST /metrics/open`, `GET /vendors` | kirgan / kalit / mehmon |
| dashboard | `GET /stats/dashboard` | kirgan / kalit |
| boshqaruv | `/admin/cameras` (CRUD, enabled, uptime, keyframe, detect-sub), `/admin/users`, `/admin/nvr/import`, `/admin/scan`, `/admin/probe`, `/admin/nodes`, `/admin/status`, `/admin/events`, `/admin/mediamtx/*`, `/admin/uptime`, `/admin/outages/hourly`, `/devices/*` | admin / kalit |
| salomatlik | `GET /health` (prefikssiz) | ochiq |

`{ref}` — kamera id (`123`) yoki tashqi id (`ext:cam-014`).

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
