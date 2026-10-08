# v3 (Figma "Nigoh vision") — backend shartnomasi

Frontend v3 shu shakllarga tayanadi. Hamma yo'llar `/api/v1/...` va `/api/...`
(ikkalasi ham, `factory.py` kabi). Mavjud javoblarga maydon **qo'shiladi**, eski
maydonlar o'chirilmaydi (v2 testlari o'tishi kerak).

**Holat: backend'da to'liq bajarilgan** (versiya `3.0.0`, migratsiya `0006_v3.py`,
testlar `backend/tests/test_v3_*.py`). Har bo'lim ostidagi **"Backend aniqlashtirishi"** —
shartnomada ochiq qolgan joylar bo'yicha qabul qilingan qaror; shakldan yagona chetlanish —
8-bo'limdagi `mediamtx_uptime_s` (sababi o'sha yerda).

## 1. Kirish va profil

| So'rov | Javob / o'zgarish |
|---|---|
| `GET /api/public/info` (kirishsiz) | `{site_name, version, public_view, guest_view}` — kirish kartasi footeri va mehmon tugmasi |
| `GET /api/auth/me` | mavjudlariga qo'shiladi: `full_name`, `prefs` (obyekt, kirilmagan bo'lsa `{}`), `session_hours`, `poll_s`, `version` |
| `PATCH /api/auth/me/prefs` | tana — qisman obyekt (`{"theme":"cream"}`), mavjudiga **birlashtiriladi**; javob — to'liq `prefs`. Faqat kirganlar. Hajm ≤ 16 KB. `users.prefs JSONB NOT NULL DEFAULT '{}'` |
| `POST /api/auth/password` | `{current, new}` → 204; noto'g'ri joriy parol → 400 `{"detail": "Joriy parol notoʻgʻri"}`; audit yoziladi |
| `POST /api/auth/login` | tana: `{username, password, remember?: bool}`. `remember=true` → sessiya **30 kun**, aks holda `session_hours`. Xato: 401 `{"detail": "Login yoki parol notoʻgʻri", "remaining": 2}`. Siyosat: **5 ta noto'g'ri urinish → 5 daqiqa blok** (login+IP bo'yicha): 429 `{"detail": "5 daqiqadan keyin qayta urinib koʻring", "retry_after": 300}` |

`prefs` kalitlari (frontend kelishuvi, backend tekshirmaydi): `theme` (white/cream/dark), `lang`,
`layers`, `onboarding`, `panel`, `wall`, `dashTab`, `dashPeriod`.

Backend aniqlashtirishi:
- `/auth/me` kirmaganda ham yangi maydonlarni beradi: `{"authenticated": false, "full_name": "", "prefs": {},
  "public_view", "site_name", "session_hours", "poll_s", "version"}`. `poll_s` = `ui_poll_s` sozlamasi.
- `prefs` birlashtirish **yuqori daraja kalitlari bo'yicha** (`{"layers": {...}}` yuborilsa `layers` butunlay
  almashadi — ichki obyekt chuqur birlashtirilmaydi). > 16 KB (butun prefs, JSON) → 413; tana obyekt
  bo'lmasa → 422; kirmagan (yoki faqat API kaliti) → 401.
- `POST /auth/password`: yangi parol < 6 belgi → 400 `"Parol kamida 6 belgidan iborat bo'lsin"`; kirmagan → 401.
  Shu foydalanuvchining **boshqa** sessiyalari bekor bo'ladi, joriy sessiya qoladi. Audit: `user.password`.
- Login: 401 javobdagi `remaining` — blokgacha qolgan urinishlar (5-xatoda `0`); keyingi urinish 429.
  `retry_after` — blok tugashigacha qolgan soniya (≤ 300), xuddi shu qiymat `Retry-After` sarlavhasida.
  Blok kaliti — (login kichik harfda, IP). Blok davomida parol tekshirilmaydi va blok uzaymaydi.
  Muvaffaqiyatli javob o'zgarmagan: `{"username", "role"}`.

## 2. Tizim holati (hamma uchun: admin, operator, kuzatuvchi, mehmon — `public_view` yoqiq bo'lsa)

`GET /api/system/state` →
```json
{"state": "ok" | "degraded" | "down",
 "label": "Tizim barqaror" | "Qisman nosozlik" | "Tizim ishlamayapti",
 "services": [{"key": "api"|"db"|"mediamtx"|"health"|"disk"|"network", "name": "...", "state": "ok"|"warn"|"error", "detail": "..."}],
 "checked_at": "ISO"}
```
Ichki manzil/IP/yo'l **bermaydi** (mehmon ham ko'radi).

Backend aniqlashtirishi (`app/system_state.py`, natija 5 s keshlanadi):
- `services` har doim shu tartibda 6 ta: `api, db, mediamtx, health, disk, network`.
- `db` — `SELECT 1` > 500 ms → warn, xato → error; `mediamtx` — lokal API javob bermasa error;
  `health` — sweep hali bo'lmagan → warn, 3 intervaldan eski → error; `disk` — ma'lumot diski ≥ 80 % → warn,
  ≥ 95 % → error; `network` — tekshirilgan qurilmalardan birortasi javob bermasa → error, o'rtacha TCP
  vaqti > 200 ms → warn.
- Umumiy `state`: `db` yoki `mediamtx` error → `down`; boshqa har qanday warn/error → `degraded`; aks holda `ok`.
- Kirish: `require_viewer` — kalit, har qanday rol sessiyasi yoki (public_view yoqiq) mehmon; aks holda 401.

## 3. Bildirishnomalar

`GET /api/notifications?type=all|outage|system&limit=50&before=<id>` →
```json
{"items": [{"id": "e123" | "s7", "type": "offline"|"online"|"system",
            "title": "3403/6 km uzildi", "text": "Toshkent viloyati · 17 kundan beri javob yoʻq",
            "ts": "ISO", "camera_id": 89 | null, "severity": "error"|"warning"|"success"|"info",
            "read": false}],
 "unread": 13, "counts": {"all": 13, "outage": 11, "system": 2}}
```
- Kamera hodisalari — mavjud online/offline hodisalaridan (operator — faqat o'z hududlari).
  `offline` matnida davomiylik: hali uzilgan bo'lsa "N kundan/soatdan beri javob yoʻq", qayta
  ulangan bo'lsa `online` hodisa matni "Jizzax · 1 daqiqa uzilish".
- Tizim bildirishnomalari (`type=system`): disk ≥ 80 % band, MediaMTX ishlamayapti, baza sekin —
  holat o'zgarganda bir marta yoziladi (jadval `system_alerts`).
- `POST /api/notifications/read` tana `{"ids": [...]}` yoki `{"all": true}` → `{"unread": 0}`.
  O'qilganlik foydalanuvchi bo'yicha (`notification_reads` yoki `users.notif_read_before` + id to'plami).
- `unread`/`counts` faqat oxirgi 7 kun.

Backend aniqlashtirishi:
- Kamera manbai — `camera_events` dagi `online`/`offline` (health TCP tekshiruvi); `stalled` lentaga kirmaydi.
  Savatdagi (o'chirilgan) kamera hodisalari ko'rinmaydi. Kirish: kirganlar va API kaliti (mehmon — 401).
- Matnlar (`<hudud>` — kamera hududi nomi):
  - `offline`, sarlavha `"<kamera> uzildi"`, `severity: "error"`; matn: hali uzilgan —
    `"<hudud> · 17 kundan beri javob yoʻq"` (`daqiqadan`/`soatdan`/`kundan` — eng yirik butun birlik);
    tiklangan — `"<hudud> · 5 daqiqadan keyin tiklandi"`; ketidan yana `offline` kelgan — `"<hudud> · javob bermadi"`.
  - `online`, sarlavha `"<kamera> qayta ulandi"`, `severity: "success"`; matn `"<hudud> · 1 daqiqa uzilish"`
    (oldingi o'tish offline bo'lsa), aks holda `"<hudud> · qayta ulandi"`.
  - `system` — `system_alerts` dan: muammo paydo bo'lganda `severity` `warning`/`error` (`"Disk 86% band"`,
    `"MediaMTX ishlamayapti"`, `"Baza sekin javob bermoqda"`, `"Kamera tarmog'i javob bermayapti"`), o'tib
    ketganda alohida `success` yozuv (`"Diskda joy yetarli"`, `"MediaMTX qayta ishlayapti"` ...). Muammo ketma-ket
    2 tekshiruvda (health oralig'i, standart 60 s) ko'rinsagina yoziladi.
- `counts` — **o'qilmaganlar** soni turlar bo'yicha (`all` = `unread`). Tizim bildirishnomalari hammaga
  (operator/kuzatuvchi ham ko'radi).
- `before` — shu id dan eskilari; mavjud bo'lmagan id → bo'sh `items`; format xato → 422. Tartib — `ts` kamayishi.
- `POST /notifications/read`: `ids` ham, `all` ham berilmasa yoki id formati xato (`e123`/`s7` emas) → 422.
  Javob `{"unread": n}` (barcha turlar, 7 kun). API kaliti bilan o'qilganlik saqlanmaydi.
- `notify_outage = false` (7-bo'lim) — kamera hodisalari lentaga ham, sanoqqa ham kirmaydi
  (Telegram ogohlantirishlariga ta'sir qilmaydi).

## 4. Kameralar

- `GET /api/cameras` — har kameraga qo'shiladi: `fps` (passportdan, bo'lmasa `null`), `online_since`
  (joriy onlayn seriya boshlanishi ISO yoki `null`). `state` qiymatlari o'zgarmaydi:
  `online | stalled | offline | disabled | unknown` (frontend `stalled` → "Tasvirsiz").
- `GET /api/cameras/{ref}/details` — qo'shiladi:
  `timeline_24h: [{"t": "ISO (blok boshi)", "state": "online"|"stalled"|"offline"|"unknown"}]` — 48 ta 30 daqiqalik
  blok (blokdagi eng yomon holat), `availability_24h` (foiz, 1 kasr), `online_since`.
- `GET /api/metrics/open?camera_id=89` — shu kamera bo'yicha ochilish vaqtlari (oxirgi 10 + median).

Backend aniqlashtirishi:
- `online_since` — kamera tarmoqda tirik bo'lsagina (aks holda `null`): oxirgi online/offline hodisasi `online`
  bo'lsa uning vaqti; hodisa yo'q bo'lsa — server shu kamerani tirik ko'rgan birinchi payt. `fps` — son (float).
- `timeline_24h`: bloklar 30 daqiqaga tekislangan, **oxirgi blok hozirgi vaqtni o'z ichiga oladi** (48-blok —
  joriy yarim soat). Ustuvorlik `offline > stalled > online > unknown`. `stalled` faqat asosiy va `_h264` oqim
  muzlashidan (sub oqim emas). IP'siz (tayyor oqim) kamerada hammasi `unknown`, `availability_24h: null`.
- `availability_24h` = kuzatilgan (unknown bo'lmagan) vaqtning `offline` bo'lmagan qismi, % (stats `uptime_pct`
  qoidasi: `stalled` — kamera tarmoqda, mavjud hisoblanadi); kuzatuv bo'lmasa `null`.
- `metrics/open?camera_id=` javobi: `{"camera_id", "name", "region", "n", "median_ms": int|null,
  "opens": [{"total_ms", "transport", "at": "ISO"}]}` (yangisi birinchi, ko'pi bilan 10, server ishga
  tushganidan beri). Kamera yo'q → 404, begona hudud → 403. `camera_id` siz — eski javob.

## 5. Boshqaruv (admin)

`GET /api/admin/cameras?q=&status=online,offline,stalled,disabled&region=&codec=&mode=&sort=name|-name|region|-region|state|-state|codec&offset=0&limit=50`
→ mavjud javobga qo'shiladi: `counts: {"all", "online", "offline", "stalled", "disabled"}` (filtr **holatdan tashqari**
barcha shartlar bilan — chiplardagi sonlar), `facets: {"regions": [...], "codecs": [...], "modes": [...]}`.
Filtr va saralash **butun bazada** (sahifada emas). `q` — nom, IP, URL, km, hudud bo'yicha.

- `DELETE /api/admin/cameras/{id}` — endi **yumshoq o'chirish** (`cameras.deleted_at`); kamera ro'yxatlardan,
  statistikadan, MediaMTX'dan chiqadi. Javob `{"id", "restore_until": "ISO (+30 kun)"}`.
- `POST /api/admin/cameras/{id}/restore` → kamera qaytadi (30 kun ichida).
- 30 kundan eski o'chirilganlar fon vazifasida butunlay o'chiriladi.
- `POST /api/admin/cameras/bulk` `{"action": "test"|"delete"|"enable"|"disable", "ids": [..≤500]}`
  → `{"results": [{"id", "ok": bool, "detail"}]}`. `test` — mavjud ulanish tekshiruvi (parallel, ≤ 8).
- `GET /api/admin/cameras/export?format=csv|xlsx` (+ yuqoridagi filtrlar) → fayl. xlsx uchun kutubxona bo'lmasa — faqat csv.

Backend aniqlashtirishi:
- Javob: `{"total", "offset", "limit", "counts", "facets", "cameras": [...]}` — `total` filtrga (holat bilan)
  mos kameralar soni. `limit` standart **100** (v2 dagidek), ko'pi bilan 500.
- `counts` da qo'shimcha `"unknown"` kaliti ham bor (`all` — hammasining yig'indisi).
- `status`, `region`, `codec`, `mode` — vergul bilan bir nechta qiymat. `status`: `online, stalled, offline,
  disabled, unknown`. `region` — hudud **nomi** (`facets.regions` dagidek). `codec` — oila:
  `h264 | h265 | unknown | <boshqa kodek kichik harfda>`. `mode` — `always` (doim tayyor) | `ondemand`.
  `facets` — butun ro'yxatdan (filtrsiz), saralangan.
- `sort` `-codec` ni ham oladi; noma'lum `sort` → 422; berilmasa — hudud, nom (v2 tartibi).
  Holat bo'yicha tartib: `online, stalled, offline, unknown, disabled`.
- `q` — nom, IP, URL (RTSP yo'l yoki tayyor oqim), km (`"3428/1 km"` ko'rinishida), hudud, slug, izoh,
  external_id; katta-kichik harfsiz.
- `DELETE` endi **200** (v2 da 204 edi); qayta o'chirish → 404. `restore` javobi — admin kamera obyekti
  (`GET /admin/cameras` dagi element); savatda yo'q / muddati o'tgan → 404. Audit: `camera.delete`, `camera.restore`.
- Qo'shimcha: `GET /api/admin/cameras/deleted` → `{"keep_days": 30, "cameras": [{"id", "name", "region",
  "deleted_at", "restore_until"}]}` (savat).
- O'chirilgan kamera bilan bir xil manzil (IP+port+yo'l) yoki `external_id` bilan yangi kamera qo'shilsa,
  savatdagisi darhol butunlay o'chiriladi (qayta qo'shish bloklanmaydi).
- `bulk`: `ids` takrorlari olib tashlanadi, natija `ids` tartibida; topilmagan/o'chirilgan id →
  `{"ok": false, "detail": "Kamera topilmadi"}`. `test` — `POST /admin/probe` bilan bir xil (saqlangan parol bilan),
  `detail` — probe xabari; IP'siz kamera → ok false. `delete` detail `"savatda YYYY-MM-DD gacha"`.
  > 500 id yoki noma'lum `action` → 422. Audit: `camera.bulk_<action>` (test'dan tashqari).
- Eksport: csv — UTF-8 BOM bilan (Excel to'g'ri ochadi), vergul ajratuvchi; xlsx — `openpyxl` o'rnatilgan,
  bo'lmasa 400. Ustunlar: ID, Nomi, Hudud, Holat, Km, Piket, Kenglik, Uzunlik, Manba, IP, Port, RTSP yo'l,
  Oqim URL, Ishlab chiqaruvchi, Model, Kodek, Format, FPS, Rejim, Yoqilgan, Tashqi ID, Oxirgi onlayn, Izoh.
  Parol yo'q. Fayl nomi `nigoh-kameralar-YYYYMMDD-HHMM.csv|xlsx`.

## 6. Foydalanuvchilar

Rollar: `admin` (hammasi), `operator` (o'z hududlari: xarita, devor, guruhlar, tasdiq),
**`viewer`** — "Kuzatuvchi": o'z hududlarini faqat ko'radi (xarita, dashboard, devor); guruh yarata/
o'zgartira olmaydi, boshqaruv va sozlamalar yopiq. `UserIn.role` pattern kengayadi.
- `POST /api/admin/users/{id}/reset-password` → `{"password": "<vaqtinchalik 12 belgi>"}` (bir marta ko'rsatiladi), audit.

Backend aniqlashtirishi:
- Kuzatuvchi hududlari operatorniki kabi (`regions` — `UserIn` da, `/auth/me` va `/admin/users` javobida).
- Kuzatuvchi `POST/PATCH/DELETE /groups...` → 403 `"Kuzatuvchi guruh yarata yoki o'zgartira olmaydi"`;
  `GET /groups` ochiq. `/admin/*` → 403. Bildirishnomalar va `/system/state` ochiq.
- Vaqtinchalik parol — harf va raqamlar (o'xshash `0 O 1 l I` yo'q); foydalanuvchining barcha sessiyalari
  bekor bo'ladi. Audit: `user.password_reset` (parolning o'zi yozilmaydi). Foydalanuvchi yo'q → 404.

## 7. Sayt sozlamalari (`app/settings.py`)

Qo'shiladi: `timezone` (standart "Asia/Tashkent"), `language` (uz | uz-cyrl | ru | en, standart uz),
`ui_poll_s` (xarita va ro'yxat yangilanishi, 10–300, standart 30), `notify_outage` (bool, standart true),
`guest_view` = mavjud `public_view` (nom o'zgarmaydi). Diapazonlar Figma'ga moslanadi:
`stall_after_s` 10–300, `transport_check_after_s` 20–600, `health_interval_s` 30–600.

Backend aniqlashtirishi:
- `GET /admin/settings` dagi har sozlamada yangi `choices` maydoni (`null` yoki ro'yxat). `language` —
  `kind: "choice"`, `choices: ["uz", "uz-cyrl", "ru", "en"]`; boshqa qiymat → 422.
- `timezone` — IANA nomi, `zoneinfo` tekshiradi (noto'g'ri → 422). Faqat interfeys ko'rsatishi uchun:
  statistikadagi sana/soat guruhlash serverning `NIGOH_TZ` zonasida qoladi.
- `guest_view` alohida sozlama EMAS — faqat `/public/info` javobida `public_view` ning nusxasi.
- Ko'rsatilgan diapazonlar v2 da allaqachon shunday edi — o'zgarmadi.

## 8. Tizim holati (admin) — `GET /api/admin/status`

Qo'shiladi: ~~`mediamtx.uptime_s`~~ **`mediamtx_uptime_s`**, `network.latency_ms` (kamera tarmog'iga o'rtacha ping/TCP vaqti, oxirgi tekshiruv),
`disk.used_pct`, `disk.total_mb`, `update: {"current": "3.0.0", "latest": null}`.

**Chetlanish:** `mediamtx` v2 da `bool` (`true` — ishlayapti) va uni deploy hujjatlari, acceptance testi va v2
interfeysi tekshiradi — obyektga aylantirib bo'lmaydi ("eski maydonlar o'chirilmaydi"). Shuning uchun uptime
yuqori darajada: `"mediamtx": true, "mediamtx_uptime_s": 3600 | null` (`null` — hozir javob bermayapti yoki hali
tekshirilmagan). Uptime — backend MediaMTX'ni uzluksiz javob berayotgan deb ko'rgan vaqt (MediaMTX o'z ishga
tushgan vaqtini API'da bermaydi; backend qayta ishga tushsa noldan).

Backend aniqlashtirishi: `network` — `{"latency_ms": float|null, "checked", "online"}` (oxirgi sweep:
muvaffaqiyatli TCP ulanishlarning o'rtachasi, ms); `disk` ga `free_mb` ham qo'shildi; `used_pct`/`total_mb`/`free_mb`
— ma'lumot katalogi (suratlar, jurnal) joylashgan disk. `version` endi `"3.0.0"`.

## 9. Statistika (dashboard)

- `GET /api/stats/summary` va `GET /api/stats/availability` — `?compare=1` bo'lsa `previous: {...}` (oldingi teng davr) qo'shiladi.
- `GET /api/stats/series?step=6h` qo'llanadi (30 kun uchun).
- Operator/kuzatuvchi `GET /api/stats/*` da faqat o'z hududlari (mavjud qoida).

Backend aniqlashtirishi (batafsil: `docs/STATS_API.md`):
- `summary?compare=1` — `summary` davrsiz (joriy lahza), tarixda holatlar kesimi saqlanmaydi. `previous` —
  `days` (standart 1) oldingi eng yaqin 5 daqiqalik surat: `{"at", "measured", "online", "online_pct"}`
  (`by_state` yo'q); surat topilmasa `previous: null`.
- `availability?compare=1` — `previous` xuddi `availability` javobining shakli (o'z `from`/`to`/`days` bilan),
  davr `[from − davomiylik, from)`. Hodisalar 30 kun saqlanadi — uzoq davrda `previous.coverage_pct` past bo'ladi.
- `series?step=6h` — 6 soatlik o'rtacha, mahalliy 00/06/12/18 dan boshlanadi (`ts` — blok boshi); `5m|hour|6h|day`.
