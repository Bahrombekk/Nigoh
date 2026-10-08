# Nigoh — oʻzbekcha interfeys lugʻati

Interfeys manba tili — oʻzbek (lotin). Bu fayl atama va yozuv qoidalarini belgilaydi; yangi matn
qoʻshganda shunga amal qiling. ru/en lugʻatlari (`frontend/js/core/i18n/ru.js`, `en.js`) kaliti —
aynan oʻzbekcha satr: manba matni oʻzgarsa, ikkala lugʻatdagi kalit ham yangilanadi.

## Yozuv

| Qoida | Toʻgʻri | Notoʻgʻri |
|---|---|---|
| Oʻ, gʻ — U+02BB (ʻ) | oʻchirish, tarmogʻi | o'chirish, o‘chirish |
| Tutuq belgisi — U+02BC (ʼ) | maʼlumot, sunʼiy, Caps Lockʼni | ma'lumot, Caps Lock’ni |
| Yorliq — gap shaklida (faqat birinchi harf katta) | Kamera qoʻshish | Kamera Qoʻshish |
| Lotin va kirill aralashmaydi | | |

## Son, birlik, foiz

- Son + ot birlikda: **5 kamera**, 3 hudud (koʻplik qoʻshimchasisiz). Jumlada "5 ta kamera" ham joiz.
- Jadval katagi, KPI qiymati, roʻyxat raqamida — faqat son: `29`, `1 519` ("29 ta" emas).
  Hodisa soni yonida birlik kerak boʻlsa — **marta**: "5 marta".
- Kasr — vergul: `3,5`; foiz — boʻsh joysiz: `96,2%`; minglik — boʻsh joy: `1 377`.
- Davomiylik (qisqa katakda): `45 s` · `7 daq` · `1,8 soat` · `6 kun`. Matnda toʻliq: "2 daqiqadan uzun".
- Ulush izohi: "kameralarning 85 foizi", "uzilishlarning 90 foizi — 2 soat ichida".

## Holatlar (bitta nom)

| Holat | Maʼnosi |
|---|---|
| **Onlayn** | oqim ochiladi, kadr keladi |
| **Tasvirsiz** | port javob beradi, kadr yoʻq |
| **Uzilgan** | port javob bermaydi |
| **Oʻchirilgan** | administrator oʻchirgan, kuzatilmaydi |
| **Nomaʼlum** | hali tekshirilmagan yoki IP manzil yoʻq |
| **Hech ulanmagan** | kuzatuv davomida bir marta ham onlayn boʻlmagan ("koʻrilmagan" emas) |

## Hodisalar

| Atama | Maʼnosi | Ishlatilmaydi |
|---|---|---|
| **uzilish** | 2 daqiqadan uzun yoki hali davom etayotgan aloqa yoʻqligi | haqiqiy uzilish |
| **qisqa uzilish** | 2 daqiqadan qisqa, oʻzi tiklangan uzilish; alohida sanaladi | sakrash, blip |
| **tasvir toʻxtashi** | port ochiq, lekin kadr kelmay qoldi; uzilishga kirmaydi | muzlash |
| **qayta ulanish**, **tiklanish** | kamera yana onlayn | |

## Koʻrsatkichlar (asosiy yorliq — oʻzbekcha, xalqaro atama — faqat izohda)

| Yorliq | Izohda | Ishlatilmaydi |
|---|---|---|
| **Ishlash ulushi** | Uptime — kuzatilgan vaqtda onlayn boʻlgan ulush | Uptime (sarlavhada) |
| **Ishlamagan vaqt** | kameralar onlayn boʻlmagan vaqt (kamera-soat) | oʻchiq vaqt, oʻchiq soat |
| **Tiklanish vaqti** | MTTR — uzilishdan tiklanishgacha, mediana | MTTR (sarlavhada) |
| **Uzilishlar orasidagi vaqt** | MTBF — bitta kamerada ikki uzilish orasidagi oʻrtacha vaqt | MTBF (sarlavhada) |
| **Uzilish (har kameraga)** | uzilishlar soni ÷ kameralar soni | Uzilish / kam. |
| **Kuzatuv qamrovi** | server oʻlchov yozgan vaqt ulushi | |
| **Onlaynlik darajasi** | maʼlum lahzadagi onlayn kameralar ulushi | |
| **Ochilish vaqti** | oqim bosilgandan birinchi kadrgacha | |
| **kamera-soat** | kameralar × soat | |
| **mediana**, **95 foizi** | | median, p95 |

## Obyektlar va boʻlimlar

- **kamera**, **registrator (NVR)**, **hudud**, **guruh**, **video devor** (qisqartirib "devor" emas),
  **oqim** (asosiy / qoʻshimcha — "sub oqim" emas), **kadr**, **surat**, **kodek**,
  **oʻgirish** (H.265 → H.264), **uzatish usuli** (TCP/UDP — "transport" emas),
  **proshivka** ("firmware" emas), **seans** ("sessiya" emas), **tizim jurnali** ("loglar" emas),
  **oʻzgarishlar jurnali**, **kameralar** ("park" emas), **JONLI** belgisi ("LIVE" emas).
- Boʻlimlar: **Dashboard** (Hozir · Trend · Tahlil), **Xarita**, **Video devor**, **Boshqaruv**, **Sozlamalar**.
  "Dashboard" va "Trend" — Figma nomi, oʻzlashgan soʻz sifatida qoladi.
- Rollar: **Administrator**, **Operator**, **Kuzatuvchi**. Mavzular: **Oq**, **Qaymoq**, **Qorongʻi**.

## Oʻzgarmaydigan texnik belgilar

H.264, H.265, RTSP, HLS, WebRTC, MediaMTX, IP, URL, CSV, Excel, NVR/DVR, TCP/UDP, API, ONVIF,
km, fps, Mbit/s, MB/GB, UTC, IANA vaqt zonalari.

## Kalka va gʻaliz iboralardan qoching

| Oʻrniga | Yozing |
|---|---|
| kameralar parki, parkning 5% | kameralar, kameralarning 5 foizi |
| taʼsirlangan kameralar | uzilish boʻlgan kameralar |
| H.265 xom, H.264 toʻgʻridan | H.265 (oʻgirilmaydi), H.264 (oʻgirishsiz) |
| kamera boshiga | har bir kamera uchun |
| kameralar oʻrtachasi | barcha kameralar boʻyicha |
| tarmoqda, tasvirsiz | aloqa bor, kadr yoʻq |
| uzluksiz (kuzatuv) | kuzatuv toʻliq |
| 6 hududda (sarlavha ostida) | 157 kamera · 6 hudud |

Maʼlumot (kamera, hudud, foydalanuvchi nomlari) oʻzgartirilmaydi.
