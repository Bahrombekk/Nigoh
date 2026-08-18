# Nigoh — backendchi uchun qo'llanma

Bu hujjat kameralar bilan **hech qachon ishlamagan** backendchi uchun.
Nigoh — tayyor kamera mikroservisi: siz uni o'z tizimingizga oddiy REST
servis sifatida ulaysiz, kamera protokollari (RTSP, kodeklar, oqimlar)
uning ichida qoladi.

Interaktiv API hujjati: **`http://SERVER:8010/docs`** (Swagger) va `/redoc`.

## Servis nima qiladi (1 daqiqada)

```
Sizning tizimingiz ──REST──▶ Nigoh (8010)
                                │  boshqaruv qatlami: kameralar bazasi,
                                │  auth, rollar, monitoring
                                ▼
                             MediaMTX ──▶ brauzerga video (8888/8889)
                                ▲
                                └── IP kameralar (RTSP)
```

- **Siz gaplashadigan yagona narsa — 8010-portdagi REST API.**
- MediaMTX — ichki video dvijok. Uning API'si (9997) faqat 127.0.0.1 da,
  unga to'g'ridan-to'g'ri murojaat qilmang: Nigoh uni o'zi boshqaradi
  (har 30 soniyada bazadagi holat bilan kelishtiradi, yiqilsa qayta
  ko'taradi — bunga aralashish shart emas).
- Video trafik sizning backend orqali **o'tmaydi** — brauzer media
  portlariga to'g'ridan ulanadi. Sizning API faqat metadata beradi.

## API tuzilishi

Hammasi `/api/v1` ostida, resource-based:

| Prefiks | Kirish | Nima bor |
|---|---|---|
| `/api/v1/cameras` | ochiq* | ro'yxat (bbox filtri), oqim manzili, surat |
| `/api/v1/stats` | ochiq* | dashboard tarixi |
| `/api/v1/auth` | — | login/logout/me; `/auth/stream` ni MediaMTX chaqiradi |
| `/api/v1/admin` | faqat `admin` roli | kameralar CRUD, NVR import, skaner, foydalanuvchilar, tugunlar, holat, hodisalar |

\* `PUBLIC_VIEW=0` bo'lsa ochiq bo'lim ham sessiya talab qiladi.

Eski `/api/...` manzillari ham ishlaydi (ichki test UI uchun), lekin yangi
integratsiyada faqat `/api/v1` ni ishlating.

## Autentifikatsiya modeli

- Sessiya **httponly cookie** (`nigoh_session`), 12 soat. Login:
  `POST /api/v1/auth/login {"username", "password"}`.
- Ikki rol: `admin` (hammasi) va `operator` (faqat biriktirilgan
  hududlardagi kameralar — ro'yxat, oqim, surat avtomatik filtrlanadi).
- Operatorlar `POST /api/v1/admin/users` bilan yaratiladi:
  ```json
  {"username": "op1", "password": "...", "role": "operator",
   "regions": ["Toshkent", "Buxoro"]}
  ```
- Server-to-server chaqiriqlar uchun ham shu login ishlatiladi: bitta
  texnik admin hisobi oching, login qilib cookie'ni saqlang (12 soat),
  401 kelganda qayta login qiling.

**Oqim xavfsizligi haqida bilib qo'ying:** video portlari (8888/8889) ham
himoyalangan — MediaMTX har bir tomosha so'rovini Nigoh'dan tekshirtiradi.
`/api/v1/cameras/{id}/stream` bergan manzil ichida 1 soatlik imzoli chipta
bo'ladi. Shu sababli oqim manzillarini **keshlab bo'lmaydi** — har ochishda
yangisini so'rang.

## Kamera qo'shish yo'llari

Uchta yo'l bor, uchalasi ham parolni shifrlab saqlaydi va MediaMTX'ga
o'zi ulaydi (restart yo'q):

1. **Bitta kamera:** `POST /api/v1/admin/cameras` — IP, login, parol,
   vendor. Servis saqlashdan oldin kamerani o'zi tekshiradi (kodek,
   o'lcham aniqlanadi).
2. **NVR/registrator (ommaviy):** `POST /api/v1/admin/nvr/import` —
   bitta qurilmadagi 16–64 kanal birdaniga, parallel tekshiruv bilan.
   Avval `"dry_run": true` bilan chaqirib natijani ko'ring.
3. **Skaner:** `POST /api/v1/admin/scan` — IP+login yetadi, servis
   ishlab chiqaruvchini va jonli kanallarni o'zi topadi.

Tekshirish alohida ham bor: `POST /api/v1/admin/probe` — kamera javob
beryaptimi, parol to'g'rimi, kodek/o'lcham/FPS qanday.

## Monitoring — nimani kuzatish kerak

| Endpoint | Nima beradi |
|---|---|
| `GET /api/v1/admin/status` | bir qarashda: MediaMTX tirikmi, health sweep, muzlagan oqimlar, tugunlar holati |
| `GET /api/v1/admin/nodes` | har tugun: `status` (`online/degraded/offline`), tayyor oqimlar, tomoshabinlar, trafik |
| `GET /api/v1/admin/events` | media hodisalari: oqim muzladi/tiklandi, MediaMTX qayta ko'tarildi |
| har kamerada `state` | `online / offline / stalled / unknown / disabled` |

Webhook hozircha yo'q — hodisalarni `/admin/events` dan so'rab turing
(polling) yoki Telegram ogohlantirishlarini yoqing (`.env` da
`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`).

Loglar: `/data/nigoh.log` — JSON satrlar
(`{"ts", "level", "service", "event", ...}`), Loki/OpenSearch'ga
to'g'ridan yuborsa bo'ladi. Prometheus metrics: konteyner ichida
`127.0.0.1:9998/metrics` (MediaMTX'niki).

## Ma'lumotlar qayerda

Hammasi `/data` volume'ida (compose'da `./data`):

| Fayl | Nima | Ehtiyot |
|---|---|---|
| `cameras.db` | SQLite: kameralar, foydalanuvchilar, hodisalar | zaxiralang |
| `secret.key` | kamera parollarini ochadigan kalit | **yo'qolsa parollar tiklanmaydi**; zaxiralang, hech kimga bermang |
| `mediamtx.yml` | avto-yaratiladi | qo'lda tahrirlamang — qayta yoziladi |
| `nigoh.log`, `mediamtx.log` | loglar (aylanma) | — |

Bazaga to'g'ridan-to'g'ri SQL bilan yozmang — API orqali ishlang, aks
holda MediaMTX bilan sinxronlik buziladi (o'qish mumkin, lekin sxema
o'zgarishi mumkinligini hisobga oling).

## O'zingizning servisingizga ulash namunasi

Nigoh'ni gateway ortiga oddiy upstream sifatida qo'ying:

```python
import requests

s = requests.Session()
s.post("http://nigoh:8010/api/v1/auth/login",
       json={"username": "texnik", "password": "..."})

# kameralar ro'yxati
cams = s.get("http://nigoh:8010/api/v1/cameras").json()["cameras"]

# salomatlik — o'z monitoringingizga qo'shing
status = s.get("http://nigoh:8010/api/v1/admin/status").json()
assert status["mediamtx"], "video dvijok yiqilgan!"
```

## Muhit o'zgaruvchilari

To'liq ro'yxat izohlari bilan: **`.env.example`**. Eng muhimlari:
`ADMIN_PAROL` (birinchi ishga tushishda), `PUBLIC_VIEW` (anonim ko'rish),
`MEDIA_HOST` (server NAT/domen ortida bo'lsa).

## Nimalarga tegmaslik kerak

- MediaMTX API (9997) va uning konfiguratsiyasi — Nigoh o'zi boshqaradi.
- `secret.key` va `cameras.db` sxemasi.
- Oqim chiptalari formati — ichki mexanizm, o'zingiz yasamang.
