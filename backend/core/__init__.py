"""Nigoh — umumiy infratuzilma: kamerani ham, HTTP'ni ham bilmaydi.

Bu paketni hamma qatlamlar ishlatadi (app/, camera/, stats/, users/,
walls/, database/, scripts/). O'zi faqat `database` ga tayanadi
(security.py — foydalanuvchi sessiyalari uchun).

    env.py        `.env` ni muhitga yuklaydi (import qilinishining o'zi kifoya)
    paths.py      BACKEND_DIR, ROOT_DIR, DATA_DIR
    log.py        log(service, event, ...) — yagona kirish nuqtasi
    logs/         log tizimi: toifalar (logs/<toifa>/), kunlik fayllar, request_id,
                  maxfiy ma'lumotni yashirish, qidiruv (docs/LOGGING.md)
    bus.py        jarayon ichidagi pub/sub — SSE abonentlari uchun
    throttle.py   xato urinishlarni ip bo'yicha sekinlashtirish
    watchdog.py   "jarayon tirik, port o'lik" holatidan chiqish
    security.py   parollar (scrypt), kamera parollari (Fernet), sessiyalar,
                  oqim chiptalari, HLS CDN kaliti
    alerts.py     Telegram ogohlantirishlari (ixtiyoriy)
    version.py    VERSION — yagona manba

Mashinaga xos fayllar (secret.key, logs/, mediamtx.yml, suratlar)
DATA_DIR da (standart — repo ildizi) qoladi — paket ko'chsa ham yo'llar
o'zgarmaydi. Ma'lumotlarning o'zi PostgreSQL'da (`database/`).
"""
