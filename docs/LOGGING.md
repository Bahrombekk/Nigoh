# Loglar

Nigoh'ning hamma logi bitta **`logs/`** papkasida (DATA_DIR ichida, standart
— repo ildizi), mavzu bo'yicha ajratilgan. Kod: [`backend/core/logs/`](../backend/core/logs/),
API: [`backend/app/logs_api.py`](../backend/app/logs_api.py).

```
logs/
├─ app/        app-2026-10-06.jsonl        ilova: ishga tushish, sozlama, uvicorn, watchdog
├─ camera/     camera-2026-10-06.jsonl     health, reconciler, snapshots, passport, transport
├─ stats/      stats-2026-10-06.jsonl      statistika yozuvchisi
├─ security/   security-2026-10-06.jsonl   kirish, rad etish, kalit urinishlari
├─ database/   database-2026-10-06.jsonl   migratsiyalar
├─ access/     access-2026-10-06.jsonl     HTTP so'rovlar
├─ errors/     errors-2026-10-06.jsonl     YIG'MA: hamma toifadan WARNING va undan yuqori
├─ mediamtx/   mediamtx.log + arxivlar     MediaMTX dasturining o'z chiqishi (matn)
└─ archive/    eski nigoh.log fayllari     (2.1.1 gacha)
```

Birinchi qaraladigan joy — **`errors/`**: unda hamma toifadagi muammolar
bitta joyda, vaqt tartibida.

## Yozuv ko'rinishi

Har satr — bitta JSON obyekt (JSON Lines):

```json
{"ts": "2026-10-06T10:47:00.123+05:00", "level": "WARNING", "category": "camera",
 "service": "snapshots", "event": "backlog", "due": 117, "limit": 96}
```

| Maydon | Ma'nosi |
|---|---|
| `ts` | Mahalliy vaqt (`NIGOH_TZ`), millisekund va zona bilan |
| `level` | `DEBUG` · `INFO` · `WARNING` · `ERROR` · `CRITICAL` |
| `category` | Papka (toifa) |
| `service` | Qaysi xizmat yozdi (`health`, `reconciler`, `auth`, `http` ...) |
| `event` | Qisqa mashina o'qiydigan nom (`mediamtx_restarted`, `login_failed`) |
| `request_id` | HTTP so'rov davomida yozilgan bo'lsa — o'sha so'rovning ID'si |
| `error_type`, `traceback` | Istisno bo'lsa |
| boshqalar | Hodisa konteksti (`camera_id`, `node`, `error` ...) |

Access yozuvi:

```json
{"ts": "...", "level": "INFO", "category": "access", "service": "http", "event": "request",
 "request_id": "a1b2c3d4e5f6", "method": "GET", "path": "/api/v1/cameras",
 "status": 200, "ms": 38.4, "ip": "192.168.1.20", "auth": "session"}
```

`auth`: `key` (X-API-Key), `session` (cookie) yoki `guest`. Statik fayllar
(`/css`, `/js`, `/assets`) yozilmaydi — `LOG_ACCESS_STATIC=1` bilan yoziladi.
Daraja: 5xx — `ERROR`, 4xx — `WARNING` (401 va 404 bundan mustasno — ular
odatiy oqim, `errors/` ni to'ldirmasin), qolgani — `INFO`.

## Konsol (start.bat oynasi)

```
10:47:00 WARN  camera/snapshots   backlog · due=117 limit=96
10:47:05 INFO  app/server         Uvicorn running on http://0.0.0.0:8010
```

Konsolga HTTP so'rovlardan faqat muammolilari (4xx/5xx) chiqadi —
ilgari har bir 200/304 javob oynani to'ldirib, muhim xabarni yashirardi.
Terminalda ogohlantirish sariq, xato qizil.

## Request ID — bitta so'rovning butun zanjiri

Har javobda `X-Request-ID` sarlavhasi bor (so'rovda o'zingiz bersangiz —
o'shasi ishlatiladi, faqat `A-Z a-z 0-9 _ . -`, 64 belgigacha). Shu so'rov
davomida qaysi modul log yozsa, yozuvda o'sha ID bo'ladi:

```
GET /api/v1/admin/logs?category=access&request_id=a1b2c3d4e5f6
GET /api/v1/admin/logs?category=errors&request_id=a1b2c3d4e5f6
```

## Maxfiylik

Yozishdan **oldin**, bitta joyda ([`redact.py`](../backend/core/logs/redact.py)) yashiriladi:

* kalit nomida `password`, `parol`, `token`, `secret`, `api_key`,
  `authorization`, `cookie`, `session` ... bo'lsa — qiymat `***`;
* URL ichidagi login:parol — `rtsp://admin:12345@10.0.0.5` → `rtsp://admin:***@10.0.0.5`;
* so'rov qatorida `token=`, `key=`, `password=` — `***`.

Bu xabar matni va traceback'ga ham qo'llanadi. Yangi super-admin paroli
(birinchi ishga tushishda) faylga emas, faqat konsolga chiqadi.

## Aylanish va saqlash

Fayllar **qayta nomlanmaydi** (Windows'da ochiq faylni qayta nomlab bo'lmaydi —
eski tizimda `nigoh.log` va `mediamtx.log` shu sababli cheksiz o'sgan):

* har kun — yangi sanali fayl;
* fayl `LOG_MAX_MB` (50) dan oshsa — `camera-2026-10-06.1.jsonl`, `.2` ...;
* saqlash muddatidan eski fayllar soatiga bir tekshiriladi va o'chiriladi.

| Toifa | Saqlash |
|---|---|
| app, camera, stats | `LOG_RETENTION_DAYS` (30) |
| security, database, errors | 90 kun (yoki undan ko'p) |
| access | 14 kun (yoki undan kam) |
| mediamtx | 30 kun; joriy fayl 50 MB dan oshsa arxivga (copytruncate) |

## Sozlamalar (`.env`)

| O'zgaruvchi | Standart | Ma'nosi |
|---|---|---|
| `LOG_DIR` | `logs` | Papka (nisbiy — DATA_DIR ga nisbatan) |
| `LOG_LEVEL` | `INFO` | Faylga yoziladigan eng past daraja |
| `LOG_CONSOLE_LEVEL` | `INFO` | Konsolga chiqadigan daraja |
| `LOG_RETENTION_DAYS` | `30` | Umumiy saqlash muddati |
| `LOG_MAX_MB` | `50` | Bitta fayl chegarasi |
| `LOG_ACCESS_STATIC` | `0` | `1` — statik fayl so'rovlari ham access logga |

## API (faqat admin / kalit)

| Endpoint | Vazifasi |
|---|---|
| `GET /api/v1/admin/logs` | Qidiruv. `category` (standart `errors`), `level` (shundan yuqori), `service`, `event`, `q` (erkin matn), `request_id`, `hours` yoki `since`/`until`, `limit` (≤2000) |
| `GET /api/v1/admin/logs/summary?hours=24` | Toifa × daraja sonlari va eng ko'p takrorlangan muammolar |
| `GET /api/v1/admin/logs/files` | Toifalar, fayllar, hajm, saqlash muddatlari |
| `GET /api/v1/admin/logs/files/{toifa}/{fayl}` | Faylni yuklab olish |

```bash
curl -H "X-API-Key: $KEY" "$HOST/api/v1/admin/logs?category=errors&hours=24"
curl -H "X-API-Key: $KEY" "$HOST/api/v1/admin/logs?category=security&event=login_failed"
curl -H "X-API-Key: $KEY" "$HOST/api/v1/admin/logs?category=mediamtx&level=ERROR"
curl -H "X-API-Key: $KEY" "$HOST/api/v1/admin/logs/summary?hours=24"
```

Javoblar eng yangisidan boshlanadi; fayl oxiridan o'qiladi, katta faylda ham tez.

## Kod yozganda

```python
from core.log import log

log("snapshots", "backlog", level="warning", due=117, limit=96)
log("auth", "login_failed", level="warning", user=name, ip=ip)
try:
    ...
except Exception:
    log("reconciler", "sync_failed", level="error", exc_info=True)   # traceback bilan
```

* `service` dan toifa aniqlanadi (`core/logs/config.py`, `SERVICE_CATEGORY`);
  yangi xizmat qo'shsangiz — o'sha ro'yxatga ham yozing, aks holda `app` ga tushadi.
* `event` — `snake_case` nom, gap emas: qidiruv va hisob shu bo'yicha.
* Ushlanmagan istisnolar (fon thread'lari ham) avtomatik `CRITICAL` bilan
  traceback'i bilan yoziladi.

## Tashqi tizimga ulash

Fayllar JSON Lines — Promtail/Loki, Filebeat/OpenSearch, Vector to'g'ridan-
to'g'ri o'qiydi: `logs/*/*.jsonl` ni kuzating, `category`, `level`,
`service` ni yorliq (label) qiling.
