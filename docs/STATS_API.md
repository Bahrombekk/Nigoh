# Statistika API

Nigoh kameralari bo'yicha statistika: hozirgi holat, davrdagi onlaynlik,
uzilishlar, hududlar, muammoli kameralar, liniya va ma'lumot sifati.
Har bir ko'rsatkich — alohida endpoint, har biri bitta savolga javob beradi.

Interaktiv hujjat ishlab turgan serverda: **`/docs`** (Swagger) va `/redoc`.
Kod: hisob — [`backend/stats/reporting/`](../backend/stats/reporting/), HTTP —
[`backend/stats/api.py`](../backend/api/stats.py), testlar —
[`backend/tests/test_stats_api.py`](../backend/tests/test_stats_api.py).

## Mundarija

| Endpoint | Qaysi savolga javob beradi |
|---|---|
| [`GET /stats/summary`](#summary) | Hozir nechta kamera ishlayapti? |
| [`GET /stats/availability`](#availability) | Davr davomida kameralar qancha vaqt onlayn bo'ldi? |
| [`GET /stats/coverage`](#coverage) | Bu davrning qancha qismi kuzatilgan (server ishlaganmi)? |
| [`GET /stats/series`](#series) | Onlaynlik vaqt bo'yicha qanday o'zgardi? |
| [`GET /stats/sla`](#sla) | Maqsad (masalan 95%) qancha vaqt bajarildi? |
| [`GET /stats/outages/summary`](#outages-summary) | Nechta uzilish bo'ldi, qancha vaqtda tiklandi? |
| [`GET /stats/outages`](#outages) | Qaysi uzilishlar bo'ldi (jurnal)? |
| [`GET /stats/daily`](#daily) | Har kuni ahvol qanday bo'ldi? |
| [`GET /stats/hourly`](#hourly) | Sutkaning qaysi soatlarida ko'p uziladi? |
| [`GET /stats/heatmap`](#heatmap) | Uzilishlar kun × soat (yoki hafta kuni × soat) bo'yicha qanday taqsimlangan? |
| [`GET /stats/regions`](#regions) | Qaysi hudud eng yomon? |
| [`GET /stats/vendors`](#vendors) | Qaysi kamera markasi / modeli yaxshi, qaysi biri ko'p uziladi? |
| [`GET /stats/ranking`](#ranking) | Qaysi kameralar eng ko'p muammo beryapti? |
| [`GET /stats/cameras/{id}`](#camera) | Bitta kameraning tarixi qanday? |
| [`GET /stats/rail`](#rail) | Temir yo'l liniyasining qaysi km'larida muammo bor? |
| [`GET /stats/quality`](#quality) | Qaysi kameralarning ma'lumoti chala yoki noto'g'ri? |
| [`GET /stats/feed`](#feed) | So'nggi holat o'zgarishlari qanday? |

Hozirgi dashboard ishlatadigan yig'ma endpointlar ham bor:
`/stats/dashboard`, `/stats/timeline`, `/stats/overview` — ular shu
ko'rsatkichlarning yig'indisi, yangi integratsiyada yuqoridagilarni ishlating.

---

## Umumiy qoidalar

### Manzil va kirish

* Asosiy manzil: `/api/v1/stats/...`. Eski `/api/stats/...` ham ishlaydi
  (hujjatda ko'rinmaydi).
* Kirish — faqat kirgan foydalanuvchi yoki kalit:
  * brauzer: cookie sessiya (`POST /api/v1/auth/login`);
  * tashqi tizim: `X-API-Key: <NIGOH_API_KEY>` sarlavhasi.
* Kirmagan so'rov — `401`.
* **Operator** faqat o'ziga biriktirilgan hududlarni ko'radi: barcha
  javoblar avtomatik shu hududlar bilan cheklanadi. Begona `area_id`
  so'rasa — `403`. Admin va kalit — hamma hudud.

```bash
curl -H "X-API-Key: $NIGOH_API_KEY" "http://192.168.1.155:8010/api/v1/stats/summary"
```

### Davr parametrlari

Davr bilan ishlaydigan endpointlar (`availability`, `coverage`, `series`,
`sla`, `outages*`, `daily`, `hourly`, `heatmap`, `regions`, `ranking`,
`cameras/{id}`) bir xil parametrlarni oladi:

| Parametr | Ma'nosi | Standart |
|---|---|---|
| `days` | Oxirgi N kun, `1..30` (1 = oxirgi 24 soat) | `1` |
| `from`, `to` | Aniq oraliq, mahalliy sana `YYYY-MM-DD`, ikkala chet kiradi. `to` berilmasa — bugun. `days` o'rniga ishlatiladi | — |

* Ma'lumot **30 kun** saqlanadi: undan uzoq davr — `422`.
* `to < from` yoki kelajak sanasi — `422`.
* Vaqtlar mahalliy zonada (`NIGOH_TZ`, standart `Asia/Tashkent`, `+05:00`),
  ISO 8601 ko'rinishida.
* Har javobda davr qaytadi: `from`, `to`, `days`.

### Hudud parametri

| Parametr | Ma'nosi |
|---|---|
| `area_id` | Hudud id (`/api/v1/admin/regions` dan). Takrorlash mumkin: `?area_id=3&area_id=9`. Viloyat berilsa — tumanlari ham kiradi |

### Hisoblash qoidalari (hamma ko'rsatkichda bir xil)

1. **Kuzatuv bo'shlig'i hisobga kirmaydi.** Server o'lchov yozmagan vaqt
   (90 daqiqadan uzun sukunat) "kamera o'chiq" ham, "onlayn" ham emas —
   "ma'lumot yo'q". Aks holda server o'chiq turgan kunlar uptime'ni
   yolg'on tushirardi. Qanchasi kuzatilgani — `coverage_pct`.
2. **Uzilish turlari.**
   * `blip` (qisqa sakrash) — 2 daqiqadan (`blip_threshold_s` = 120) qisqa
     va tugagan uzilish: tarmoqdagi lip-lip, qayta ulanish;
   * `outage` (haqiqiy uzilish) — undan uzun yoki hali davom etayotgani.
   Ular aralashsa minglab sakrash bitta jiddiy uzilishni ko'rinmas qiladi.
3. **MTTR** (o'rtacha tiklanish vaqti) faqat tiklangan haqiqiy
   uzilishlardan hisoblanadi; davom etayotgani kirmaydi.
4. **Onlaynlik foizi** kamera-soat bo'yicha: `(kuzatilgan − o'chiq) / kuzatilgan`.
5. **Hozirgi holat** (`state`) — xaritadagi rang bilan bir xil manba:
   `online` · `stalled` (tarmoqda, lekin video kelmayapti) · `offline` ·
   `unknown` (hali tekshirilmagan) · `disabled` (admin o'chirgan).
   Foizlar faqat holati o'lchanadiganlardan (`online + stalled + offline`).
6. Davrdagi ko'rsatkichlar faqat **yoqiq RTSP** kameralardan; hozirgi
   holat va hudud sanog'i — barcha kameralardan.

### Tezlik va kesh

Davr hisobi 60 s keshlanadi: dashboard bir nechta endpointni ketma-ket
so'rasa ham baza bir marta o'qiladi. 157 kamerada 30 kunlik hisob
~0,4 s. Natija ko'pi bilan 1 daqiqa eski bo'lishi mumkin.

### Xatolar

| Kod | Qachon |
|---|---|
| `401` | Kirilmagan / kalit yo'q |
| `403` | Operator begona hududni yoki kamerani so'radi |
| `404` | Kamera topilmadi |
| `409` | Kamera kuzatilmaydi (o'chirilgan yoki RTSP emas) — `cameras/{id}` |
| `422` | Parametr noto'g'ri: `days` > 30, noto'g'ri sana, noma'lum `by`/`mode` |

---

<a id="summary"></a>
## `GET /stats/summary` — hozirgi holat

**Savol:** hozir nechta kamera ishlayapti?

Parametrlar: `area_id`. Davr yo'q — joriy lahza.

```bash
curl -H "X-API-Key: $KEY" "$HOST/api/v1/stats/summary"
```

```json
{
  "at": "2026-10-06T09:51:54+05:00",
  "total": 157,
  "by_state": {"online": 141, "stalled": 2, "offline": 14, "unknown": 0, "disabled": 0},
  "measured": 157,
  "online_pct": 89.81,
  "by_source": {"rtsp": 157},
  "with_location": 145,
  "with_km": 149
}
```

| Maydon | Ma'nosi |
|---|---|
| `by_state` | Holat bo'yicha kameralar soni |
| `measured` | Holati o'lchanadiganlar (`online + stalled + offline`) |
| `online_pct` | `online / measured`, % |
| `with_location`, `with_km` | Koordinatasi / km'i bor kameralar |

**Qayerda ishlatiladi:** KPI kartalari, sarlavhadagi "141 / 157 onlayn".

---

<a id="availability"></a>
## `GET /stats/availability` — davrdagi onlaynlik

**Savol:** kameralar davr davomida qancha vaqt ishladi?

Parametrlar: davr, `area_id`.

```bash
curl -H "X-API-Key: $KEY" "$HOST/api/v1/stats/availability?days=7"
```

```json
{
  "from": "2026-09-29T09:51:54+05:00", "to": "2026-10-06T09:51:54+05:00", "days": 7.0,
  "cameras": 157,
  "coverage_pct": 39.54,
  "uptime_pct": 95.17,
  "camera_hours_observed": 10428.6,
  "camera_hours_offline": 503.6,
  "never_down": 9,
  "distribution": [
    {"band": "100%", "cameras": 9},
    {"band": "99–100%", "cameras": 49},
    {"band": "95–99%", "cameras": 72},
    {"band": "90–95%", "cameras": 11},
    {"band": "<90%", "cameras": 16}
  ]
}
```

| Maydon | Ma'nosi |
|---|---|
| `uptime_pct` | Kuzatilgan vaqtdagi onlaynlik, % |
| `coverage_pct` | Davrning qancha qismi kuzatilgan. Past bo'lsa — `uptime_pct` faqat shu qismga tegishli |
| `camera_hours_*` | Kuzatilgan va o'chiq kamera-soatlar |
| `never_down` | Davrda bir marta ham uzilmagan kameralar |
| `distribution` | Kameralar uptime oraliqlari bo'yicha — "nechta kamera 99% dan yuqori?" |

---

<a id="coverage"></a>
## `GET /stats/coverage` — kuzatuv qamrovi

**Savol:** davrning qancha qismida server o'lchov yozgan? Qachon yozmagan?

Parametrlar: davr, `area_id`, `min_gap_minutes` (0..1440, shundan qisqa
bo'shliqlar ro'yxatga chiqmaydi; standart 0).

```bash
curl -H "X-API-Key: $KEY" "$HOST/api/v1/stats/coverage?days=7&min_gap_minutes=60"
```

```json
{
  "from": "...", "to": "...", "days": 7.0,
  "pct": 39.54,
  "observed_hours": 66.4,
  "missing_hours": 101.6,
  "gaps": [
    {"from": "2026-09-29T09:51:54+05:00", "to": "2026-10-02T15:27:32+05:00", "hours": 77.59}
  ]
}
```

**Qayerda ishlatiladi:** grafiklarda bo'shliqni shtrixlash, "ma'lumot
to'liq emas" ogohlantirishi. Boshqa ko'rsatkichlarni o'qishdan oldin shuni
tekshiring: qamrov 40% bo'lsa, 30 kunlik uptime aslida ~12 kunlikdir.

---

<a id="series"></a>
## `GET /stats/series` — onlaynlik qatori

**Savol:** onlaynlik vaqt bo'yicha qanday o'zgardi? (chiziqli grafik)

Parametrlar: davr, `area_id`, `step`:

| `step` | Nuqta | Tavsiya etilgan davr |
|---|---|---|
| `5m` | Har 5 daqiqalik o'lchov (xom) | 1 kun |
| `hour` | Soatlik o'rtacha | 7 kun |
| `day` | Kunlik o'rtacha (mahalliy sana) | 30 kun |

```bash
curl -H "X-API-Key: $KEY" "$HOST/api/v1/stats/series?days=1&step=hour"
```

```json
{
  "from": "...", "to": "...", "days": 1.0, "step": "hour",
  "points": [
    {"ts": "2026-10-05T09:00:00+05:00", "online": 142.5, "total": 157.0, "pct": 90.76},
    {"ts": "2026-10-05T10:00:00+05:00", "online": 136.75, "total": 157.0, "pct": 87.1}
  ]
}
```

Kuzatuv bo'lmagan oraliq **qaytmaydi** — grafikda chiziqni uzing va
bo'shliqni ko'rsating, nolga tushirmang. `hour`/`day` da `online`/`total`
o'rtacha bo'lgani uchun kasr bo'lishi mumkin.

---

<a id="sla"></a>
## `GET /stats/sla` — maqsadga muvofiqlik

**Savol:** onlaynlik maqsaddan (masalan 95%) qancha vaqt past bo'ldi va
qancha kamera-soat yetishmadi?

Parametrlar: davr, `area_id`, `goal` (0..100, standart 95), `step`
(`5m` | `hour`, standart `5m`).

```bash
curl -H "X-API-Key: $KEY" "$HOST/api/v1/stats/sla?days=1&goal=95"
```

```json
{
  "from": "...", "to": "...", "days": 1.0,
  "goal_pct": 95.0, "step": "5m",
  "observed_slots": 257,
  "in_goal_slots": 0,
  "in_goal_pct": 0.0,
  "below_goal_seconds": 77100,
  "deficit_camera_hours": 219.0,
  "avg_pct": 88.49,
  "worst": {"ts": "2026-10-05T17:13:56+05:00", "pct": 19.11}
}
```

| Maydon | Ma'nosi |
|---|---|
| `in_goal_pct` | O'lchovlarning necha foizida maqsad bajarilgan |
| `below_goal_seconds` | Maqsaddan past o'tgan vaqt |
| `deficit_camera_hours` | Maqsadga yetishmagan kamera-soatlar ("qarz"): har o'lchovda `goal × total − online` |
| `worst` | Eng past nuqta |

---

<a id="outages-summary"></a>
## `GET /stats/outages/summary` — uzilishlar xulosasi

**Savol:** nechta uzilish bo'ldi, qancha tez tiklandi, eng uzuni qaysi?

Parametrlar: davr, `area_id`.

```bash
curl -H "X-API-Key: $KEY" "$HOST/api/v1/stats/outages/summary?days=7"
```

```json
{
  "from": "...", "to": "...", "days": 7.0,
  "outages": 830,
  "blips": 639,
  "blip_threshold_s": 120,
  "stalls": 76,
  "open_now": 5,
  "affected_cameras": 147,
  "offline_camera_hours": 503.6,
  "mttr": {"median_s": 262, "p90_s": 1574, "mean_s": 1228, "recovered": 825},
  "mtbf_s": 45232,
  "longest": {
    "camera_id": 64, "name": "3449/10 km", "region": "Sirdaryo", "km": 3449, "picket": 10,
    "start": "2026-09-29T09:51:54+05:00", "end": null, "open": true,
    "seconds": 239127, "kind": "outage"
  }
}
```

| Maydon | Ma'nosi |
|---|---|
| `outages` / `blips` | Haqiqiy uzilishlar / qisqa sakrashlar soni |
| `stalls` | Tasvir to'xtashlari (port ochiq, video yo'q) — uzilishga kirmaydi |
| `open_now` | Hali tiklanmagan uzilishlar |
| `affected_cameras` | Kamida bitta haqiqiy uzilishi bo'lgan kameralar |
| `mttr` | Tiklanish vaqti: median, 90-persentil, o'rtacha (soniya). Median — "odatda", p90 — "yomon holatda" |
| `mtbf_s` | Uzilishlar orasidagi o'rtacha vaqt (park bo'yicha, kuzatilgan kamera-vaqt / uzilishlar) |
| `longest` | Eng uzun uzilish. `start` davr boshiga teng bo'lsa — uzilish davrdan oldin boshlangan |

---

<a id="outages"></a>
## `GET /stats/outages` — uzilishlar jurnali

**Savol:** aynan qaysi uzilishlar bo'ldi?

Parametrlar: davr, `area_id`, va:

| Parametr | Qiymatlar | Standart |
|---|---|---|
| `kind` | `outage` · `blip` · `all` | `outage` |
| `open_only` | `true` — faqat hali tiklanmaganlar | `false` |
| `camera_id` | Bitta kamera | — |
| `sort` | `start` (yangisi birinchi) · `duration` (uzuni birinchi) | `start` |
| `limit` | 1..1000 | 100 |
| `offset` | Sahifalash | 0 |

```bash
# Hozir davom etayotgan uzilishlar
curl -H "X-API-Key: $KEY" "$HOST/api/v1/stats/outages?open_only=true"
# Haftaning eng uzun 20 ta uzilishi
curl -H "X-API-Key: $KEY" "$HOST/api/v1/stats/outages?days=7&sort=duration&limit=20"
```

```json
{
  "from": "...", "to": "...", "days": 1.0,
  "total": 514, "limit": 2, "offset": 0,
  "items": [
    {"camera_id": 36, "name": "3400/2 km", "region": "Toshkent viloyati", "km": 3400, "picket": 2,
     "start": "2026-10-06T09:49:07+05:00", "end": "2026-10-06T09:51:13+05:00",
     "open": false, "seconds": 125, "kind": "outage"}
  ]
}
```

`seconds` — faqat kuzatilgan qismi. `end: null` — hali davom etmoqda.

---

<a id="daily"></a>
## `GET /stats/daily` — kunlik kesim

**Savol:** har kuni ahvol qanday bo'ldi?

Parametrlar: davr, `area_id`. Kunlar — mahalliy sana; davr chetidagi
kunlar qisman bo'ladi.

```bash
curl -H "X-API-Key: $KEY" "$HOST/api/v1/stats/daily?days=30"
```

```json
{
  "from": "...", "to": "...",
  "days": [
    {"date": "2026-10-04", "coverage_pct": 100.0, "uptime_pct": 96.68,
     "outages": 212, "blips": 215, "offline_camera_hours": 125.1}
  ]
}
```

Uzilish yarim tunni kesib o'tsa, uning vaqti ikkala kunga ulushi bilan
tushadi; soni esa boshlangan kunda sanaladi.

---

<a id="hourly"></a>
## `GET /stats/hourly` — sutka soatlari

**Savol:** sutkaning qaysi soatlarida ko'p uziladi? Texnik xizmatni
qachonga rejalashtirish kerak?

Parametrlar: davr, `area_id`, yoki `day=YYYY-MM-DD` — bitta mahalliy kun
(oxirgi 30 kun ichida).

```bash
curl -H "X-API-Key: $KEY" "$HOST/api/v1/stats/hourly?days=7"
curl -H "X-API-Key: $KEY" "$HOST/api/v1/stats/hourly?day=2026-10-05"
```

```json
{
  "from": "...", "to": "...", "days": 7.0,
  "outages": [15, 10, 8, 6, 9, 1, "... 24 ta"],
  "blips":   ["... 24 ta"],
  "offline_camera_minutes": ["... 24 ta"],
  "peak": {"from_hour": 17, "to_hour": 20, "outages": 355}
}
```

| Maydon | Ma'nosi |
|---|---|
| `outages[h]` | `h` soatda boshlangan haqiqiy uzilishlar (0 = 00:00–01:00) |
| `offline_camera_minutes[h]` | `h` soatda o'chiq o'tgan kamera-daqiqalar |
| `peak` | Eng zich uch soatlik oyna (yarim tundan o'tishi mumkin: 23→02) |

---

<a id="heatmap"></a>
## `GET /stats/heatmap` — uzilishlar xaritasi

**Savol:** uzilishlar kunlar va soatlar bo'yicha qanday taqsimlangan?

Parametrlar: davr, `area_id`, va:

| Parametr | Qiymatlar | Standart |
|---|---|---|
| `mode` | `date` — har sana bitta qator · `weekday` — hafta kuni (1 = dushanba), kunlik o'rtacha | `date` |
| `kind` | `outage` — haqiqiy uzilishlar · `all` — sakrashlar bilan | `outage` |

```bash
curl -H "X-API-Key: $KEY" "$HOST/api/v1/stats/heatmap?days=30&mode=weekday"
```

```json
{
  "from": "...", "to": "...", "days": 30.0, "mode": "weekday", "kind": "outage",
  "rows": [
    {"key": 1, "days": 4, "hours": [1.5, 0.5, 0.5, "... 24 ta"]}
  ]
}
```

* `mode=date`: `key` — sana, `hours` — soni, `coverage_pct` — o'sha kunning
  qamrovi (past bo'lsa katakni xira yoki shtrixli ko'rsating).
* `mode=weekday`: `days` — shu hafta kunidan nechta kuzatilgan kun bor;
  `hours` — kunlik o'rtacha, kuzatilgan kun bo'lmasa `null`.

---

<a id="regions"></a>
## `GET /stats/regions` — hududlar

**Savol:** qaysi hudud eng yomon ishlayapti?

Parametrlar: davr, `area_id`. Tartib: davrdagi onlaynlik bo'yicha, eng
yomoni birinchi.

```bash
curl -H "X-API-Key: $KEY" "$HOST/api/v1/stats/regions?days=7"
```

```json
{
  "from": "...", "to": "...", "days": 7.0,
  "regions": [
    {"region": "Sirdaryo", "admin_area_id": 11, "cameras": 30,
     "now": {"online": 26, "stalled": 0, "offline": 4, "unknown": 0, "disabled": 0},
     "online_now_pct": 86.67,
     "uptime_pct": 91.2, "outages": 140, "blips": 96, "offline_hours": 63.4}
  ]
}
```

`now` va `online_now_pct` — hozirgi lahza; `uptime_pct`, `outages`,
`offline_hours` — davr bo'yicha. Hududi aniqlanmagan kameralar
`"Belgilanmagan"` (`admin_area_id: null`) guruhida.

---

<a id="vendors"></a>
## `GET /stats/vendors` — kamera markalari

**Savol:** qaysi marka (va model) yaxshi ishlayapti, qaysi biri ko'p uziladi?

Parametrlar: davr, `area_id`. Tartib: kamerasi ko'p marka birinchi;
`models` ichida ham shunday.

```bash
curl -H "X-API-Key: $KEY" "$HOST/api/v1/stats/vendors?days=7"
```

```json
{
  "from": "...", "to": "...", "days": 7.0,
  "vendors": [
    {"vendor": "dahua", "cameras": 99,
     "now": {"online": 73, "stalled": 0, "offline": 26, "unknown": 0, "disabled": 0},
     "online_now_pct": 73.74,
     "uptime_pct": 94.63, "outages": 570, "blips": 213, "stalls": 106,
     "offline_hours": 378.9, "outages_per_camera": 5.76, "mttr_median_s": 262,
     "codecs": {"H264": 59, "H265": 34, "unknown": 6},
     "transcode": 29, "udp": 0, "no_model": 20,
     "models": [
       {"model": "DH-SD49425XB-HNR-S3", "cameras": 35, "now": {"...": 0},
        "online_now_pct": 80.0, "uptime_pct": 95.0, "outages": 209, "blips": 40,
        "stalls": 30, "offline_hours": 101.2, "outages_per_camera": 5.97,
        "mttr_median_s": 240},
       {"model": null, "cameras": 20, "...": "..."}
     ]}
  ]
}
```

- `vendor` — `dahua`, `hikvision`, `holowits`, `boshqa`; marka yozilmagan
  bo'lsa `unknown`. `model: null` — model hali aniqlanmagan (passport
  tekshiruvi to'ldiradi).
- Markalarda kamera soni har xil, shuning uchun taqqoslash uchun
  **`outages_per_camera`** (davrdagi haqiqiy uzilishlar ÷ kameralar) va
  `uptime_pct` dan foydalaning — mutlaq `outages` soni ko'p kamerali
  markani noheq yomon ko'rsatadi.
- `now`, `online_now_pct` — hozirgi lahza; `uptime_pct`, `outages`, `blips`,
  `stalls`, `offline_hours`, `mttr_median_s` — davr bo'yicha (kuzatiladigan
  yoqiq RTSP kameralar).
- `codecs`, `transcode` (H.265 → H.264 o'girilayotganlar), `udp` (RTSP UDP
  orqali olinayotganlar), `no_model` — texnik kesim, faqat marka darajasida.

Dashboard'dagi "Kamera markalari" kartasi shu ma'lumotni `/stats/overview`
javobining `vendors` bo'limidan oladi.

---

<a id="ranking"></a>
## `GET /stats/ranking` — muammoli kameralar

**Savol:** qaysi kameralarni birinchi navbatda tuzatish kerak?

Parametrlar: davr, `area_id`, `limit` (1..500, standart 10), `by`:

| `by` | Saralash | Nimani topadi |
|---|---|---|
| `offline_time` | O'chiq vaqt | Uzoq vaqt ishlamagan kameralar |
| `outages` | Haqiqiy uzilishlar soni | Tez-tez jiddiy uziladiganlar |
| `blips` | Qisqa sakrashlar soni | Beqaror tarmoq / ulanish |
| `flapping` | Uzilish + sakrash | Umuman beqarorlar |
| `stalls` | Tasvir to'xtashlari | Tarmoqda, lekin video bermaydiganlar |

```bash
curl -H "X-API-Key: $KEY" "$HOST/api/v1/stats/ranking?days=7&by=flapping&limit=20"
```

```json
{
  "from": "...", "to": "...", "days": 7.0, "by": "flapping", "total": 148,
  "items": [
    {"id": 36, "name": "3400/2 km", "region": "Toshkent viloyati", "admin_area_id": 9,
     "km": 3400, "picket": 2, "uptime_pct": 93.29, "offline_seconds": 16048,
     "outages": 42, "blips": 100, "stalls": 1,
     "last_offline_at": "2026-10-06T09:49:07+05:00", "state": "online"}
  ]
}
```

Ro'yxatga faqat ko'rsatkichi noldan katta kameralar kiradi; `total` — ular soni.
Bitta piketdagi ikki kamera bir vaqtda uzilsa (yuqoridagi 36 va 39) —
sabab odatda kamerada emas, umumiy kommutator yoki kanalda.

---

<a id="camera"></a>
## `GET /stats/cameras/{id}` — bitta kamera

**Savol:** shu kamera davr davomida qanday ishladi?

Parametrlar: `id` (ichki kamera id), davr.

```bash
curl -H "X-API-Key: $KEY" "$HOST/api/v1/stats/cameras/16?days=7"
```

```json
{
  "from": "...", "to": "...", "days": 7.0,
  "id": 16, "name": "3374/10 km", "region": "Toshkent shahri", "admin_area_id": 14,
  "km": 3374, "picket": 10,
  "uptime_pct": 99.92, "offline_seconds": 196, "outages": 1, "blips": 1, "stalls": 0,
  "last_offline_at": "2026-10-05T18:21:09+05:00",
  "state": "online", "coverage_pct": 39.54,
  "mttr_median_s": 131, "longest_s": 131,
  "items": [
    {"camera_id": 16, "start": "2026-10-05T18:21:09+05:00", "end": "2026-10-05T18:23:20+05:00",
     "open": false, "seconds": 131, "kind": "outage", "...": "..."}
  ]
}
```

Batafsilroq tarix (kalendar, 15 daqiqalik chiziq, harakatlar jurnali)
admin uchun: `GET /api/v1/admin/cameras/{ref}/history`.

---

<a id="rail"></a>
## `GET /stats/rail` — liniya bo'ylab holat

**Savol:** temir yo'lning qaysi km'larida kameralar ishlamayapti?

Parametrlar: `area_id`, `bin_km` (oraliq kengligi, km; 0..100, standart 1).
Davr yo'q — hozirgi holat.

```bash
curl -H "X-API-Key: $KEY" "$HOST/api/v1/stats/rail?bin_km=5"
```

```json
{
  "bin_km": 1.0,
  "lines": [
    {"rail_line_id": 1, "name": "Asosiy yo'nalish", "cameras": 149,
     "km_min": 6.2, "km_max": 3718.6,
     "bins": [
       {"from_km": 3400.0, "to_km": 3401.0, "online": 2, "stalled": 0, "offline": 0,
        "unknown": 0, "disabled": 0, "region": "Toshkent viloyati"}
     ]}
  ]
}
```

Kamera km'i = `km + piket / 10` (3400/2 km → 3400,2). Bo'sh oraliqlar
qaytmaydi. `region` — oraliqdagi kameralarning ko'pchiligi joylashgan hudud.
Kamera ko'p bo'lsa `bin_km` ni kattalashtiring (5000 kamerada 5–10 km).

---

<a id="quality"></a>
## `GET /stats/quality` — ma'lumot sifati

**Savol:** qaysi kameralarning yozuvi chala yoki noto'g'ri, va nega?

Parametrlar: `area_id`.

```bash
curl -H "X-API-Key: $KEY" "$HOST/api/v1/stats/quality"
```

```json
{
  "no_location":   {"count": 12, "items": [{"id": 58, "name": "3432/2 km", "region": "Toshkent viloyati"}]},
  "probe_failed":  {"count": 7,  "items": [{"id": 56, "name": "3429/2 km", "region": "Toshkent viloyati",
                                            "detail": "parol: Login yoki parol noto'g'ri"}]},
  "vendor_mismatch":  {"count": 0, "items": []},
  "km_name_mismatch": {"count": 0, "items": []},
  "...": "..."
}
```

Har tekshiruvda `count` va 50 tagacha `items`:

| Kalit | Muammo | Odatdagi sabab va yechim |
|---|---|---|
| `no_location` | Koordinata yo'q | Excel'da bo'lmagan / NVR kanali — joyida o'lchab kiriting |
| `no_region` | Hudud yo'q | Koordinata ham, qo'shni km ham yo'q — hududni qo'lda tanlang |
| `no_km` | km yo'q (RTSP) | Liniyada bo'lmagan kamera (NVR kanali) uchun normal |
| `no_codec` | Kodek noma'lum | Kamera javob bermagan — sababi `probe_failed` da |
| `no_model` | Model noma'lum | Qurilma ONVIF/ISAPI pasport bermaydi — zarar yo'q |
| `never_seen` | Hech qachon javob bermagan | IP noto'g'ri yoki kamera nosoz — joyida tekshiring |
| `probe_failed` | Pasport tekshiruvi xatosi, `detail` da sabab | `parol:` — parol noto'g'ri; `oqim:` — RTSP yo'li noto'g'ri; `tarmoq:` — javob yo'q |
| `vendor_mismatch` | Ishlab chiqaruvchi modelga mos emas | Import paytidagi taxmin xatosi — vendorni tuzating |
| `km_name_mismatch` | Nomdagi km o'qilmagan yoki bazadagiga mos emas | Nomni `3428/1 km` ko'rinishiga keltiring |

Kodek va model bo'sh kameralar fonda har 10 daqiqada qayta tekshiriladi
(muvaffaqiyatsiz bo'lsa — 6 soatdan keyin), natija `probe_failed` ga
yoziladi. Batafsil: [Kamera ma'lumotlari sifati](#data-quality-history).

---

<a id="feed"></a>
## `GET /stats/feed` — holat o'zgarishlari lentasi

**Savol:** so'nggi paytda qaysi kameralar uzildi yoki qaytdi?

Parametrlar: `area_id`, va:

| Parametr | Ma'nosi | Standart |
|---|---|---|
| `limit` | 1..500 | 40 |
| `before_id` | Sahifalash: shu id dan eskilari | — |
| `kind` | `online` · `offline` | ikkalasi |
| `camera_id` | Bitta kamera | — |

```bash
curl -H "X-API-Key: $KEY" "$HOST/api/v1/stats/feed?limit=40"
# keyingi sahifa
curl -H "X-API-Key: $KEY" "$HOST/api/v1/stats/feed?limit=40&before_id=6414"
```

```json
{
  "items": [
    {"id": 6415, "ts": "2026-10-06T09:51:15+05:00", "camera_id": 39, "name": "3400/2 km (2)",
     "region": "Toshkent viloyati", "km": 3400, "picket": 2, "kind": "online"}
  ],
  "next_before_id": 6414
}
```

`next_before_id: null` — boshqa sahifa yo'q. Jonli yangilanish kerak bo'lsa
lenta o'rniga SSE oqimini ishlating: `GET /api/v1/events`.

---

## Namunalar

**Dashboard "bugun" ko'rinishi** — 5 ta so'rov, hammasi bitta keshdan:

```bash
H="X-API-Key: $KEY"; B="$HOST/api/v1/stats"
curl -H "$H" "$B/summary"
curl -H "$H" "$B/series?days=1&step=5m"
curl -H "$H" "$B/outages/summary?days=1"
curl -H "$H" "$B/regions?days=1"
curl -H "$H" "$B/ranking?days=1&by=offline_time&limit=10"
```

**Oylik hisobot (aniq oy)**:

```bash
curl -H "$H" "$B/availability?from=2026-09-07&to=2026-10-06"
curl -H "$H" "$B/daily?from=2026-09-07&to=2026-10-06"
curl -H "$H" "$B/sla?from=2026-09-07&to=2026-10-06&goal=95&step=hour"
```

**Bitta viloyat (tumanlari bilan)**:

```bash
curl -H "$H" "$B/availability?days=7&area_id=9"
```

**JavaScript (brauzer, sessiya cookie bilan)**:

```js
const r = await fetch("/api/v1/stats/outages/summary?days=7", { credentials: "same-origin" });
const { outages, blips, mttr } = await r.json();
```

---

<a id="data-quality-history"></a>
## Kamera ma'lumotlari sifati: 2026-10-06 tahlili

Tahlil vaqtida 157 kameradan: 21 tasida kodek, 40 tasida model, 14 tasida
koordinata va hudud yo'q edi, 6 tasi hech qachon javob bermagan. Bu
kamchiliklar eski SQLite bazada ham aynan shunday bo'lgan — PostgreSQL'ga
ko'chirishda paydo bo'lmagan.

| Kamchilik | Sabab | Tuzatish | Endi qanday oldi olinadi |
|---|---|---|---|
| Kodek/model yo'q | Faqat kamera qo'shilgan lahzada bir marta so'ralardi; o'sha paytda javob bermasa maydon abadiy bo'sh qolardi, sababi yozilmasdi | Qayta tekshirildi: kodek 21 → 7, model 40 → 28 | `camera/monitoring/passport.py` fonda qayta urinadi; natija `camera_status.probe_at / probe_error` ga yoziladi (3-migratsiya) |
| Ishlab chiqaruvchi xato (9 kamera) | Import ishlab chiqaruvchini RTSP yo'lidan taxmin qilgan. Holowits kamera (3400/2 km (2)) dahua yo'li bilan yozilgan — videosi umuman ochilmagan | Vendor modelga ko'ra tuzatildi; 3400/2 km (2) ning yo'li `/LiveMedia/ch1/Media1` ga o'zgardi va video ochildi | `quality.vendor_mismatch`, fon tekshiruvi logga `vendor_mismatch` yozadi |
| "3606/8/10 km" — km yo'q | Nom o'qilmagan, kamera jimgina km'siz saqlangan va liniyada ko'rinmagan | Koordinatasi bo'yicha 3606/10 km | API bunday nomni `422` bilan rad etadi; `quality.km_name_mismatch` |
| Koordinata/hudud yo'q | Excel'da koordinata bo'lmagan; hudud faqat koordinatadan aniqlanardi | Egizak kameradan koordinata (2 ta), qo'shni km'dan hudud (4 ta) | Koordinatasiz kameraga hudud qo'shni km kameralaridan beriladi |

Tuzatish skripti: `python backend/database/scripts/fix_camera_data.py` (ko'rish),
`--apply` (yozish). Takror yuritish xavfsiz, har o'zgarish kamera izohiga
(`note`) yoziladi. Tuzatishdan oldingi zaxira: `backups/nigoh-2026-10-06-oldin-tuzatish.dump`.

**Qo'lda hal qilinadiganlar** (kod bilan tuzatib bo'lmaydi):

* hech qachon javob bermagan 6 kamera: 3374/10 km (2), 3381/9 km,
  3565/7 km, 3617/8 km, 3627/2 km, 3634/3 km — IP manzil yoki kamera
  joyida tekshirilishi kerak;
* 3429/2 km — Hikvision, parol noto'g'ri: to'g'ri parolni kiriting;
* 3432/2, 3437/3, 3706/2, 3706/4 km — koordinata noma'lum (hududi bor);
* "Toshkent 1–9-kanal" (NVR) — koordinata va hudud noma'lum.
