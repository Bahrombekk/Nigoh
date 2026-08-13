# Nigoh — kamera xaritasi

Xaritaga biriktirilgan IP kameralarni kuzatish tizimi. Markerga bosilganda
o'sha hududdagi kameralar ro'yxati ochiladi va tanlangan kameraning jonli
tasviri ko'rsatiladi. Kameralar super-admin panelidan — IP, login, parol
kiritib — qo'shiladi.

## Ishga tushirish

Eng oson yo'l: **`ishga-tushirish.bat`** faylini ikki marta bosing. U MediaMTX
va saytni birga ishga tushiradi, brauzerni ochadi.

Qo'lda:

```powershell
venv\Scripts\python.exe -m pip install -r requirements.txt
start mediamtx\mediamtx.exe mediamtx.yml     # video oqimlar
venv\Scripts\python.exe main.py              # sayt
```

Brauzerda: **http://localhost:8010**

Port band bo'lsa (Windows'da 8000/8080 ni ko'pincha Docker Desktop yoki tizim
xizmatlari egallaydi — `WinError 10013` shundan chiqadi):

```powershell
$env:PORT = "8020"; venv\Scripts\python.exe main.py
```

## Super-admin

Birinchi ishga tushirishda admin yaratiladi va paroli konsolga chiqadi.
Parolni istalgan payt almashtirish mumkin:

```powershell
venv\Scripts\python.exe main.py --admin-parol YangiParol
```

Login sahifadagi **"Super admin"** tugmasi orqali. Kirgach chapda boshqaruv
paneli ochiladi: kamera qo'shish, tahrirlash, ulanishni tekshirish, o'chirish.

## Kamera qo'shish

1. **"+ Yangi kamera"** → shakl ochiladi.
2. Nomi va hududini yozing.
3. **"Xaritadan tanlash"** → xaritada joyni bosing (yoki koordinatani qo'lda kiriting).
4. Ishlab chiqaruvchini tanlang — RTSP yo'li avtomatik to'ldiriladi.
5. IP, login va parolni kiriting.
6. **"Ulanishni tekshirish"** — kamera javob beryaptimi, parol to'g'rimi va
   qaysi kodekda ishlayotganini aytadi.
7. **Saqlash** → keyin **"MediaMTX"** tugmasi orqali oqimlarni qo'llang.

Hudud nomi bir xil yozilgan kameralar bitta guruh hisoblanadi.

## Tizim qanday ishlaydi

```
Kamera (RTSP)
   ↓  MediaMTX chaqiradi: stream_launcher.py <kamera>
   ↓  Launcher bazadan IP/login/parolni oladi
   ↓  FFmpeg: H.264 bo'lsa shunchaki uzatadi, H.265 bo'lsa o'giradi
   ↓  MediaMTX WebRTC va HLS'da tarqatadi
Brauzer — avval WebRTC, ishlamasa HLS
```

### Kameralar soni cheklanmagan

`mediamtx.yml` ichida kameralar ro'yxati **yo'q**. Bitta shablon yo'l bor,
u chaqirilganda `stream_launcher.py` bazadan kerakli kamerani topadi.

1000 ta kamera bilan o'lchangan:

| Amal | Vaqt | Hajm |
|---|---|---|
| Xarita ro'yxati (1000 ta) | 37 ms | 91 KB |
| Bitta hudud (bbox bo'yicha) | 14 ms | 0,9 KB |
| Admin ro'yxati (100 tadan) | 6 ms | 54 KB |
| Qidiruv | 4 ms | — |
| `mediamtx.yml` | 1 ms | **36 qator** |

Konfiguratsiya 3 ta kamerada ham, 1000 tada ham 36 qator — shuning uchun
yangi kamera qo'shilganda MediaMTX'ni qayta ishga tushirish **shart emas**,
u darhol ishlaydi.

Resurs kameralar soniga emas, **ayni damda ko'rilayotganlar soniga** qarab
sarflanadi. 1000 ta kamera bo'lib, 3 kishi ko'rayotgan bo'lsa — 3 ta oqim
ishlaydi, qolgan 997 tasi hech narsa yemaydi.

### Ommaviy qo'shish

1000 ta kamerani qo'lda kiritib bo'lmaydi. Boshqaruv panelidagi **NVR**
tugmasi bitta registratordagi barcha kanallarni birdaniga qo'shadi:
manzil, login/parol va kanallar oralig'ini (`1-64`) berasiz, tizim ularni
**parallel** tekshiradi (16 kanal ≈ 0,1 s) va faqat javob berganlarini
saqlaydi. Nuqtalar bir-birini bosmasligi uchun spiral bo'ylab tarqatiladi;
keyin har birini xaritada aniq joyiga surish mumkin.

### Kodeklar — o'girish deyarli hech qachon kerak emas

Zamonaviy brauzerlar H.265 (HEVC) ni ham o'qiy oladi. Sayt buni ochilishda
tekshiradi va imkoni bo'lsa oqimni **o'girmasdan** beradi.

Bitta 1440p kamerada o'lchangan:

| | Xom H.265 | H.265 → H.264 |
|---|---|---|
| GPU koder | **0%** | 4% |
| Xotira | 221 MB | 436 MB |
| Tarmoq | 1,4 Mbit/s | 2,5 Mbit/s |
| NVENC sessiyasi | **band qilmaydi** | 1 ta |

Xom oqim har jihatdan arzon. Eng muhimi — NVENC sessiyalarini band
qilmaydi: GeForce kartalarda ular 8 ta bilan cheklangan, ya'ni o'girish
bilan bir vaqtda 8 tadan ortiq kamerani ko'rib bo'lmasdi. Xom oqimda bunday
chegara yo'q.

Qaysi yo'l tanlanishi brauzerga bog'liq:

| Brauzer | H.265 | Natija |
|---|---|---|
| Chrome / Edge (Windows, apparatli dekodlash) | ha | o'girilmaydi |
| Safari (Mac, iPhone) | ha | o'girilmaydi |
| Firefox | yo'q | H.264 ga o'giriladi |

O'girish faqat zaxira sifatida qoladi. Brauzer "o'qiy olaman" desa-yu amalda
uddalay olmasa, sayt buni sezadi va o'zi o'girilgan oqimga qaytadi.

Bir nuance: xom H.265 faqat HLS orqali beriladi (WebRTC H.265 ni bilmaydi),
shuning uchun ochilishi ~1 soniya sekinroq. Tezlik muhim bo'lgan kameralarda
"doim tayyor" ni yoqing yoki NVR'da H.264 ga o'ting — u holda WebRTC ham,
o'girishsiz uzatish ham birga ishlaydi.

### Tezlik

| Holat | Ochilish |
|---|---|
| "Doim tayyor" yoqilgan | darhol |
| Yaqinda ko'rilgan (60 s ichida) | ~15 ms |
| Sovuq start | ~5 s |

Sovuq startdagi 5 soniyaning katta qismi — **kameradan keyframe kutish**.
Bu bizning tarafda emas: o'girishsiz oddiy uzatishda ham xuddi shuncha
ketadi. Qisqartirish uchun NVR'da I-frame oralig'ini kamaytiring
(`I Frame Interval: 25`).

Sayt buni yashirish uchun kamera nomiga sichqoncha kelganda oqimni
jimgina oldindan boshlaydi — bosgungizcha tayyor bo'ladi.

**"Doim tayyor tursin"** belgisi standart holda **o'chiq**: yoqilsa kamera
doimo ulanib turadi va resurs egallaydi. Faqat eng ko'p ishlatiladigan bir
necha kamerada yoqing.

## Fayllar

| Fayl | Vazifasi |
|---|---|
| `main.py` | FastAPI — API, autentifikatsiya, kamera boshqaruvi |
| `db.py` | SQLite sxemasi va migratsiya |
| `security.py` | Admin paroli (scrypt), kamera parollari (Fernet), sessiyalar |
| `rtsp_probe.py` | Kamerani tekshirish: tarmoq, RTSP, login/parol, kodek |
| `mediamtx_sync.py` | `mediamtx.yml` ni yaratish, FFmpeg buyruqlari |
| `stream_launcher.py` | MediaMTX chaqiradi: bitta kamera oqimini ochadi |
| `import_mediamtx.py` | Qo'lda yozilgan `mediamtx.yml` ni bazaga ko'chirish |
| `static/index.html` | Xarita (Leaflet), WebRTC/HLS player, admin panel |
| `ishga-tushirish.bat` | Hammasini birga ishga tushirish |

## Maxfiylik

Bu fayllar **hech qachon** repozitoriyga tushmasligi kerak (`.gitignore` da):

- `secret.key` — kamera parollarini ochadigan kalit
- `cameras.db` — kameralar va shifrlangan parollar
- `mediamtx.yml` — ichida **ochiq** RTSP login/parollar (MediaMTX shunday talab qiladi)

Kamera parollari bazada shifrlangan holda yotadi va brauzerga hech qachon
qaytarilmaydi — admin panelida ham faqat `•••` ko'rinadi.

## Boshqa tarmoqdan ochish

Sayt `0.0.0.0` da tinglaydi, ya'ni LAN'dagi boshqa qurilmalar
`http://SERVER_IP:8010` orqali kira oladi. Brauzer MediaMTX'ga ham to'g'ridan
ulanadi (8888 va 8889-portlar), shuning uchun ular ham ochiq bo'lsin.

MediaMTX boshqa kompyuterda bo'lsa:

```powershell
$env:MEDIA_HOST = "192.168.1.50"; venv\Scripts\python.exe main.py
```

## Keyingi qadamlar

- HTTPS (nginx + sertifikat) — parollar ochiq tarmoqdan o'tmasligi uchun
- Kamera ko'payganda SQLite o'rniga PostgreSQL
- Kameralarni yozib borish (MediaMTX `record: yes`)
