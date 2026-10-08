# Nigoh — tizimni 0 dan tushunish

Bu hujjat loyiha egasi uchun: hech qanday tayyorgarliksiz o'qib, tizim
nima, qanday ishlaydi va nega aynan shunday qurilganini to'liq tushunish
uchun. Boshqa hujjatlar rol bo'yicha: [DEPLOY.md](DEPLOY.md) (serverga
qo'yish), [BACKEND.md](BACKEND.md), [FRONTEND.md](FRONTEND.md),
[STATS_API.md](STATS_API.md) (statistika API). Kod xaritasi:
[backend/README.md](../backend/README.md), [frontend/README.md](../frontend/README.md).

---

## 1. Nigoh nima?

**Bir jumlada:** IP kameralarni bitta joyga yig'ib, xaritada ko'rsatib,
jonli tasvirini brauzerda ochib beradigan servis.

**Qanday muammoni hal qiladi:** IP kamera tasvirni **RTSP** degan eski
protokolda beradi — brauzer uni tushunmaydi. Kameralar minglab bo'lishi,
har xil zavodniki (Hikvision, Dahua, Huawei...), har xil kodekda ishlashi
mumkin. Nigoh mana shu tartibsizlikni bitta oddiy HTTP API ga aylantiradi:
frontendchi "kamera №5 ning videosini ber" deydi, qolgan hamma murakkablik
servis ichida qoladi.

---

## 2. Asosiy tushunchalar (0 dan)

Bularni bilsangiz qolgan hammasi oson tushuniladi.

**IP kamera** — tarmoqqa ulangan kamera. O'z IP manzili, login/paroli bor.
Tasvirni so'ragan tomonga RTSP orqali uzatadi.

**NVR (registrator)** — bir nechta kamera ulanadigan quti. Tashqaridan
bitta IP ko'rinadi, kanallari raqam bilan so'raladi (1-kanal, 2-kanal...).
1000 ta kamera odatda 20–40 ta NVR ortida turadi.

**RTSP** — kameraning "ona tili". `rtsp://login:parol@192.168.1.10:554/yo'l`
ko'rinishida so'raladi. Brauzer buni **o'qiy olmaydi** — shuning uchun
o'rtada tarjimon kerak.

**Kodek** — videoni siqish usuli. Ikkitasi muhim:
- **H.264** — eski, hamma joyda ishlaydi;
- **H.265 (HEVC)** — yangiroq, 2 barobar tejamkor, lekin Firefox o'qimaydi.
  O'qimaydigan brauzer uchun H.264 ga **o'girish (transcode)** kerak — bu
  qimmat ish (protsessor/GPU yeydi), shuning uchun faqat ilojsiz qolganda
  qilinadi.

**HLS** — videoni oddiy HTTP fayllar (`.m3u8` + segmentlar) qilib berish.
Hamma brauzerda ishlaydi, kechikishi 1–2 soniya.

**WebRTC** — brauzerning jonli video texnologiyasi. Eng tez yo'l
(~0,5 soniya), lekin H.265 ni bilmaydi.

**MediaMTX** — tayyor ochiq-kodli media-server (bitta .exe fayl). Aynan u
RTSP'ni oladi va HLS/WebRTC qilib tarqatadi. Nigoh'ning "video dvijoki" shu.

**FFmpeg** — video bilan hamma narsani qiladigan universal vosita. Nigoh'da
faqat bitta ish uchun: H.265 → H.264 o'girish (kerak bo'lganda).

**Keyframe** — videoning "to'liq surat" kadri (qolgan kadrlar faqat farqni
saqlaydi). Ijro faqat keyframe'dan boshlanadi; kameralar uni 2–4 soniyada
bir yuboradi — ochilish tezligining asosiy chegarasi shu.

---

## 3. Katta rasm

Tizim ikki qatlamdan iborat — bu bo'linish butun loyihaning asosi:

```
                    FOYDALANUVCHI (brauzer)
                      │                │
        metadata (JSON)│                │video (HLS/WebRTC)
                      ▼                ▼
   ┌─────────── NIGOH BACKEND ─┐   ┌── MEDIAMTX ──────────┐
   │  BOSHQARUV QATLAMI (8010) │   │  MEDIA QATLAMI       │
   │  · kameralar bazasi       │──▶│  (8888 HLS,          │
   │  · login, rollar          │API│   8889 WebRTC)       │
   │  · monitoring, hodisalar  │   │                      │
   │  · REST API /api/v1       │   │  RTSP'ni o'zi tortadi│
   └───────────────────────────┘   └──────────┬───────────┘
                                              │ RTSP
                                       ┌──────┴──────┐
                                       │  KAMERALAR  │
                                       └─────────────┘
```

Uchta muhim qoida:

1. **Video backend orqali o'tmaydi.** Brauzer videoni to'g'ridan-to'g'ri
   MediaMTX'dan oladi. Backend faqat "manzil beruvchi" — shuning uchun
   1000 kamera bo'lsa ham backend yengil qoladi.
2. **Kamera faqat kimdir ko'rayotganda ulanadi** (on-demand). 1000 kamera,
   3 tomoshabin = 3 ta faol oqim. Qolgan 997 tasi hech narsa sarflamaydi.
3. **Baza — yagona haqiqat manbai.** MediaMTX'dagi holat har 30 soniyada
   baza bilan solishtirilib tuzatiladi (reconciler). MediaMTX yiqilsa ham,
   qayta ko'tarilib o'zini tiklaydi — qo'lda hech narsa qilinmaydi.

---

## 4. Bitta bosishda nima bo'ladi (qadam-baqadam)

Foydalanuvchi xaritada kamerani bosdi. Ichkarida shu ketma-ketlik yuradi:

```
1. Brauzer:  GET /api/v1/cameras/5/snapshot
   → kamera SURATI darhol ko'rinadi (~0,2 s) — "ochildi" hissi

2. Brauzer:  GET /api/v1/cameras/5/stream
   Backend shu payt:
   a) ruxsatni tekshiradi (operator bo'lsa — hududi to'g'rimi)
   b) MediaMTX'da bu kamera yo'li borligiga ishonch hosil qiladi
   c) kameraga "hozir keyframe yubor" buyrug'ini yuboradi (tezlik uchun)
   d) 1 soatlik imzoli CHIPTA yasab, manzillarga qo'shadi
   → javob: {"webrtc_url": "...?token=...", "stream_url": "...?token=..."}

3. Brauzer WebRTC manzilga ulanadi (ishlamasa — HLS)

4. MediaMTX chiptani backend'dan tekshirtiradi (401 bo'lsa video yo'q)

5. MediaMTX kameraga RTSP bilan ulanadi (agar hali ulanmagan bo'lsa)
   → video keladi. Tomoshabin ketgach 1 daqiqada kamera qo'yib yuboriladi.
```

Foydalanuvchi uchun bu "bosdim — ochildi". Servis uchun — 5 bosqichli,
har biri himoyalangan jarayon.

---

## 5. Papkalar: nima qayerda va nega

Loyiha ikki qismga bo'lingan: **backend** (server) va **frontend**
(interfeys). Ikkalasi bir-biri bilan faqat HTTP (`/api/...`) orqali
gaplashadi. Backend ichida kod **mavzu bo'yicha** bo'lingan: har papkada
o'sha mavzuning hamma narsasi — endpointlari, xizmatlari, bazaga murojaati.

```
kamera-xarita/
├── backend/                 SERVER (backend/README.md)
│   ├── main.py              kirish nuqtasi: bootstrap + uvicorn
│   ├── stream_launcher.py   MediaMTX chaqiradigan yupqa qobiq
│   ├── app/                 ilovani yig'ish: create_app (factory.py), bootstrap,
│   │                        sozlamalar, kirish darajalari, /health
│   ├── database/            BAZA — PostgreSQL bilan bog'liq hamma narsa:
│   │                        ulanish, migratsiyalar, repozitoriylar, skriptlar, zaxiralar
│   ├── camera/              KAMERA: endpointlar (camera/api/), MediaMTX (camera/media/),
│   │                        fon kuzatuvi (camera/monitoring/), tekshiruv (camera/probe/)
│   ├── stats/               STATISTIKA: /stats/*, dashboard, uptime hisobi
│   ├── users/               FOYDALANUVCHILAR: /auth/*, rollar, operator hududlari
│   ├── walls/               VIDEO DEVOR: server tomonidagi mozaika
│   ├── core/                umumiy: env, paths, log, bus, security, alerts, watchdog ...
│   ├── tests/               pytest
│   └── scripts/             yordamchi skriptlar (geo import, benchmarklar ...)
│
├── frontend/                INTERFEYS (frontend/README.md) — build qadamisiz ES modullar
│   ├── index.html  css/  assets/
│   └── js/                  main.js + core/ auth/ layout/ map/ player/ wall/ dashboard/ admin/
│
├── mediamtx/                MediaMTX dasturining o'zi (git'da yo'q, yuklab olinadi)
├── deploy/                  update.sh, nginx izohi (deploy/README.md)
├── docs/                    hujjatlar (shu fayl ham)
├── Dockerfile               backend + MediaMTX + FFmpeg — bitta image
├── docker-compose.yml       ishga tushirish retsepti
├── .env.example             barcha sozlamalar izohlari bilan
└── start.bat                Windows'da bir bosishda ishga tushirish
```

Har papkaning batafsil xaritasi o'z README'sida:
[backend/app](../backend/app/README.md),
[backend/database](../backend/database/README.md),
[backend/camera](../backend/camera/README.md),
[backend/stats](../backend/stats/README.md),
[backend/users](../backend/users/README.md),
[backend/walls](../backend/walls/README.md),
[frontend](../frontend/README.md).

Bog'lanish yo'nalishi ataylab bir tomonlama: `core/` hech kimga bog'liq
emas; `database/` faqat `core/` ga; mavzu papkalari (`camera/`, `stats/`,
`users/`, `walls/`) `database/` va `core/` ga; `app/` hammasini yig'adi.
Bazaga faqat `database/` orqali murojaat qilinadi
(`from database import cameras, get_db`) — SQL boshqa joyda yozilmaydi.
MediaMTX bilan aloqa faqat `camera/media/` da: ertaga MediaMTX o'rniga
boshqa dvijok qo'yilsa, asosan shu papka o'zgaradi.

### Ma'lumot qayerda — eng qimmat narsalar

Ma'lumot ikki joyda yotadi: **PostgreSQL bazasi** (kameralar,
foydalanuvchilar, hodisalar, statistika) va **ma'lumot papkasi** `DATA_DIR`
(standart — repo ildizi, Docker'da `/data` volume, `NIGOH_DATA` bilan
o'zgartiriladi).

| Nima | Qayerda | Yo'qolsa nima bo'ladi |
|---|---|---|
| baza `nigoh` | PostgreSQL 17 servisi (Docker'da emas; manzil `.env` dagi `DATABASE_URL`) | hamma sozlama ketadi |
| `secret.key` | `DATA_DIR` — kamera parollarini ochadigan kalit | **parollar tiklanmaydi** — kameralarni qayta kiritish kerak |
| `mediamtx.yml` | `DATA_DIR`, avto-yaratiladi, tegilmaydi | o'zi qayta yoziladi (zarari yo'q) |
| `snapshots/` | `DATA_DIR`, kamera suratlari | qayta olinadi (zarari yo'q) |
| `logs/` | `DATA_DIR`, toifalarga ajratilgan loglar va MediaMTX logi (docs/LOGGING.md) | tarix ketadi (zarari kam) |

**Zaxira = baza dump'i + `secret.key`.** Ikkalasini birga
`backend/database/scripts/backup.sh` oladi (`pg_dump` + kalit nusxasi,
standart holda `backend/database/backups/` ga). Ishlab turgan baza
papkasidan olingan fayl nusxasi zaxira EMAS.

---

## 6. Baza: jadvallar

Baza — PostgreSQL 17 (2026-10-05 da SQLite'dan ko'chirildi). Asosiy
jadvallar (sxema v2):

| Jadval | Nima saqlaydi |
|---|---|
| `cameras` | kamera sozlamasi: nom, hudud, koordinata, ulanish, shifrlangan parol, qaysi tugun |
| `camera_status` | tez-tez yangilanadigan jonli holat: kodek, o'lcham, fps, `last_seen`, pasport tekshiruvi |
| `devices` | qurilmalar (kamera/NVR): IP, ishlab chiqaruvchi, model, pasport |
| `camera_details` | ko'rinish (view): kamera + qurilma + holat bitta qatorda — kamera o'qish shundan |
| `organizations` | har asosiy yozuvning egasi (hozircha bitta) |
| `admin_areas` | hududlar (viloyat/tuman) va chegaralari |
| `rail_lines`, `rail_units` | temir yo'l liniyalari va bo'linmalari (km/piket) |
| `users` | foydalanuvchilar: login, parol hash'i, rol (`admin`/`operator`/`viewer`), interfeys sozlamalari (`prefs`) |
| `user_admin_areas`, `user_rail_units` | operator/kuzatuvchi qaysi hududlarni ko'radi |
| `sessions` | kirish sessiyalari (12 soat) |
| `media_nodes` | MediaMTX tugunlari (bir nechta server bo'lsa) |
| `camera_events` | hodisalar: oqim muzladi/tiklandi, onlayn/oflayn (uptime manbai) |
| `status_changes`, `availability_snapshots` | dashboard tarixi: holat o'zgarishlari, 5 daqiqalik suratlar (30 kun) |
| `video_walls` | server tomonidagi video devor tanlovlari |
| `audit_log` | o'zgarmas o'zgarishlar jurnali |
| `system_alerts`, `notification_reads` | tizim bildirishnomalari va foydalanuvchi o'qiganlari (v3) |

Sxema migratsiyalar bilan yangilanadi: `backend/database/migrations/`
dagi `NNNN_*.py` fayllar backend ishga tushganda tartib bilan, bir marta
bajariladi. "Bazani qo'lda yangilash" degan tushuncha yo'q — yangi
o'zgarish yangi migratsiya fayli bilan kiritiladi. Batafsil:
[backend/database/README.md](../backend/database/README.md).

---

## 7. Xavfsizlik: to'rt qavat

**1-qavat. Kamera parollari** bazada Fernet shifrida yotadi (kalit —
`secret.key`). Ochiq holda faqat MediaMTX'ga RTSP manzil yasashda
ishlatiladi; brauzerga **hech qachon** qaytmaydi (admin panelda ham `•••`).

**2-qavat. Kirish.** Admin paroli qaytarilmas scrypt hash. Sessiya —
httponly cookie (sozlamadagi `session_hours`, "eslab qol" — 30 kun); 5 xato urinish —
5 daqiqa blok. Rollar: `admin` hammasini boshqaradi, `operator` faqat
biriktirilgan hududlarni ko'radi, `viewer` (Kuzatuvchi) — o'z hududlarini faqat ko'radi. `PUBLIC_VIEW=0`
qilinsa anonim odam umuman hech narsa ko'rmaydi.

**3-qavat. Oqim chiptalari.** Video portlari (8888/8889) ochiq bo'lsa ham
himoyalangan: MediaMTX **har bir** tomosha so'rovini backend'dan
tekshirtiradi. Backend faqat o'zi bergan imzoli, 1 soatlik, aynan shu
kameraga bog'langan chiptani qabul qiladi. Chiptasiz yo'l nomini bilgan
odam ham videoni ocholmaydi. Backend o'chiq bo'lsa MediaMTX hammani rad
etadi (yopiq holatda xavfsiz).

**4-qavat. Ichki portlar.** MediaMTX'ning boshqaruv API'si (9997) va
metrics (9998) faqat 127.0.0.1 da — tashqaridan umuman ko'rinmaydi.

---

## 8. O'z-o'zini boshqaradigan fon xizmatlari

Serverda uch asosiy "qorovul" doim aylanib turadi — shuning uchun qo'lda
deyarli hech narsa qilinmaydi (hammasini `backend/app/bootstrap.py` ishga
tushiradi):

**health (har 60 s, `camera/monitoring/health.py`).** Har kamera IP:portiga arzon TCP tekshiruv
(millisekundlar, trafik nol). Natija: xaritada yashil/qizil nuqta,
`last_seen`, Telegram xabari. Takror manzillar birlashtiriladi: 2000
kamera 40 NVR'da bo'lsa — 40 ta tekshiruv xolos.

**reconciler (har 30 s, `camera/media/reconciler.py`).** Uch ish: (1) bazadagi kerakli holatni
MediaMTX'dagi haqiqiy holat bilan solishtirib farqni tuzatadi — kamera
qo'shdingiz, 30 soniyada ishlaydi, restart yo'q; (2) lokal MediaMTX
yiqilgan bo'lsa qayta ishga tushiradi; (3) faol oqimlarning bayt hisobini
kuzatadi — 20 soniya bayt hisobi qo'zg'almagan oqim "muzlagan" (`stalled`)
deb belgilanadi. TCP tekshiruv buni ko'rmaydi: registrator portga javob
beraveradi, lekin kanal tasvir bermay qolgan bo'ladi.

**stats (`stats/recorder.py`, har 5 daqiqa).** Har kameraning holati
yozib boriladi (holat o'zgarishlari va 5 daqiqalik suratlar) — dashboard
grafiklari va uptime hisobi shu yozuvlardan chiziladi. 30 kundan eskisi
o'chadi.

Ularga yordamchi ikki xizmat qo'shiladi: **snapshots**
(`camera/monitoring/snapshots.py`) kamera suratlarini diskda yangilab
turadi, **passport** (`camera/monitoring/passport.py`) bo'sh qolgan
kodek/model maydonlarini fonda to'ldiradi.

Uchchalasining natijasi bitta maydonga jamlanadi — har kameradagi
**`state`**: `online / offline / stalled / unknown / disabled`.

---

## 9. Kodek siyosati: nega o'girish kam

O'girish (H.265→H.264) qimmat: har oqimga ~400 MB xotira, GPU sessiyasi
(GeForce'da jami 8 ta!). Shuning uchun tartib bunday:

| Holat | Nima bo'ladi | Narxi |
|---|---|---|
| Kamera H.264 | MediaMTX borligicha uzatadi | deyarli nol |
| Kamera H.265 + brauzer o'qiy oladi (Chrome/Edge/Safari) | xom holda HLS orqali | deyarli nol |
| Kamera H.265 + brauzer o'qiy olmaydi (Firefox) | FFmpeg o'giradi | GPU + xotira |
| "Tez ochilsin" belgisi | doimiy qisqa-GOP o'girish (1 s da ochiladi) | doimiy resurs |

Sayt brauzerning imkoniyatini o'zi aniqlab (`hevc=1`), eng arzon yo'lni
tanlaydi. Amalda o'girish faqat zaxira bo'lib qoladi.

---

## 9½. Tashqi tizimga ulanish modeli (asosiy ishlatilish)

Nigoh alohida backend+frontend'li tizimga mikroservis bo'lib ulanadi.
U tizimning o'z foydalanuvchilari, o'z rollari, o'z super-admini bo'ladi —
Nigoh bunga aralashmaydi:

```
Foydalanuvchi ─▶ Ularning frontend ─▶ Ularning backend (o'z rollari)
                                          │ X-API-Key (server-to-server)
                                          ▼
                                        NIGOH
                                          ▼
                     MediaMTX ──▶ video to'g'ridan brauzerga (chipta bilan)
```

- Ularning backend'i `.env` dagi `NIGOH_API_KEY` bilan to'liq kiradi;
  `PUBLIC_VIEW=0` qo'yiladi — Nigoh'ga to'g'ridan kirgan begona hech
  narsa ko'rmaydi.
- Ruxsatni ular o'z rollarida tekshiradi, keyin Nigoh'dan **chiptali oqim
  manzilini** olib frontend'iga uzatadi. Video baribir MediaMTX'dan
  to'g'ridan boradi, lekin chiptasiz ochilmaydi — himoya Nigoh'da qoladi.
- Kamera nomi/kategoriyasi/joyi kabi metadata'ni ular o'z bazasida
  yuritishi mumkin (`nigoh_camera_id` bog'lash bilan); Nigoh uchun
  majburiysi — ulanish ma'lumotlari (IP, parol, yo'l).
- Nigoh'ning ichki `operator` roli va o'z interfeysi (`frontend/`) bu rejimda ishlatilmaydi —
  ular Nigoh'ni mustaqil ishlatish va birinchi kunlarda kamera kiritish
  uchun turibdi.

Batafsil, kod namunasi bilan: [BACKEND.md](BACKEND.md).

## 10. Ko'p tugun: kameralar har xil joyda bo'lsa

Kameralar bir necha bino/shaharda bo'lsa, har joyga bitta MediaMTX
qo'yiladi (`media_nodes` jadvali):

```
      MARKAZ (Nigoh backend + asosiy MediaMTX)
        │ boshqaruv (9997, faqat markazga ochiq)
   ┌────┴─────────┐
Tugun-2 (B bino)  Tugun-3 (C shahar)
   │ RTSP lokal      │ RTSP lokal
 kameralar         kameralar
```

Foyda: kamera trafigi o'z binosida qoladi, magistralga faqat ayni damda
ko'rilayotgan oqim chiqadi. Brauzer videoni to'g'ridan-to'g'ri kerakli
tugundan oladi. Tugunga toza MediaMTX yetadi — konfiguratsiyani markaz
beradi (`GET /api/v1/admin/nodes/{id}/config`), yo'llarini API orqali
o'zi boshqaradi, salomatligini kuzatadi (`online/degraded/offline`).

Cheklov: o'girish faqat markazda ishlaydi — uzoq tugun kameralarini
H.264 da tuting.

---

## 11. Docker paketi: nega aynan shunday

**Nega bitta konteyner** (backend + MediaMTX + FFmpeg birga)? Ikki sabab:
o'girish launcher'i MediaMTX turgan mashinada ishlashi shart, va
reconciler MediaMTX jarayonini o'zi kuzatib qayta ko'taradi. Ajratilsa
shu ikkala mexanizm buziladi. Tashqaridan baribir bitta mikroservis.

**Nega host tarmog'i** (`network_mode: host`)? WebRTC video UDP orqali
yuradi va o'z IP'sini e'lon qiladi — port map qilinsa chalkashadi. Host
rejimida hammasi to'g'ridan ishlaydi.

**Nega `/data` volume?** Kod (image) va fayllar (volume) ajratilgan, baza esa
hostdagi PostgreSQL'da:
`docker compose up -d --build` bilan istalgan payt yangilaysiz — kameralar,
parollar, tarix joyida qoladi.

Yangi versiya chiqarish jarayoni:

```
kod o'zgardi → git commit → serverda: git pull (yoki papkani ko'chirish)
            → docker compose up -d --build   # ~1 daqiqa, ma'lumot saqlanadi
```

---

## 12. Kundalik amallar (shpargalka)

| Nima kerak | Buyruq / manzil |
|---|---|
| Ishga tushirish | `docker compose up -d --build` |
| Loglarni ko'rish | `GET /api/v1/admin/logs` yoki `logs/<toifa>/` (JSON); konsol: `docker logs nigoh` |
| Baza holati | `GET /api/v1/admin/db` (sxema versiyasi, hajm) |
| Salomatlik | `GET /api/v1/admin/status` yoki brauzerda `/#dash` |
| Admin parolini almashtirish | `docker exec nigoh python main.py --admin-parol Yangi123` |
| Operator ochish | `POST /api/v1/admin/users` (`role: operator`, `regions: [...]`) |
| Zaxira | `backend/database/scripts/backup.sh` (baza + `secret.key`) |
| API hujjati | `http://SERVER:8010/docs` |
| Yangilash | `docker compose up -d --build` |

---

## 13. Bir sahifalik xulosa

- **Nigoh = boshqaruv qatlami (FastAPI) + video dvijok (MediaMTX).**
- Baza — haqiqat manbai; MediaMTX unga har 30 soniyada moslanadi;
  tizim o'zini o'zi tiklaydi.
- Video backend orqali o'tmaydi; resurs kameralar soniga emas,
  **tomoshabinlar soniga** bog'liq.
- Xavfsizlik: shifrlangan parollar → rollar → oqim chiptalari →
  yopiq ichki portlar.
- Hamma qimmat narsa — PostgreSQL bazasi va `secret.key`; zaxirani ikkalasini
  birga `backend/database/scripts/backup.sh` oladi.
- Dasturchilarga bitta eshik: `/api/v1` + `/docs`. MediaMTX — ichki ish,
  unga hech kim tegmaydi.
