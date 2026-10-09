"""Nigoh log tizimi — hamma log bitta `logs/` papkasida, toifalarga ajratilgan.

    logs/
    ├─ app/        app-YYYY-MM-DD.jsonl        ilova, sozlama, uvicorn, watchdog
    ├─ camera/     camera-YYYY-MM-DD.jsonl     health, reconciler, snapshots, passport ...
    ├─ stats/      stats-YYYY-MM-DD.jsonl      statistika yozuvchisi
    ├─ security/   security-YYYY-MM-DD.jsonl   kirish, rad etish (90 kun)
    ├─ database/   database-YYYY-MM-DD.jsonl   migratsiya, ulanish (90 kun)
    ├─ access/     access-YYYY-MM-DD.jsonl     HTTP so'rovlar (14 kun)
    ├─ errors/     errors-YYYY-MM-DD.jsonl     YIG'MA: hamma toifadan WARNING+ (90 kun)
    ├─ mediamtx/   mediamtx.log (+ arxivlar)   MediaMTX'ning o'z chiqishi
    └─ archive/    eski nigoh.log fayllari

Asosiy imkoniyatlar:
  * JSON Lines — `jq`, Loki, OpenSearch to'g'ridan-to'g'ri o'qiydi;
  * har HTTP so'rovga `request_id` (javobda `X-Request-ID`) — shu so'rov
    davomidagi hamma yozuvlar bog'lanadi;
  * maxfiy maydonlar (parol, token, URL ichidagi login:parol) yozishdan
    oldin avtomatik yashiriladi;
  * Windows'ga mos aylantirish: qayta nomlash yo'q, sana nomli fayllar,
    hajm bo'yicha bo'linish, saqlash muddati;
  * ushlanmagan istisnolar (fon thread'lari ham) traceback bilan yoziladi;
  * admin API: /api/v1/admin/logs (qidiruv), /admin/logs/summary, /admin/logs/files.

Kod yozganda faqat bitta funksiya kerak (toifa service nomidan aniqlanadi):

    from core.log import log
    log("snapshots", "backlog", level="warning", due=117, limit=96)
    log("auth", "login_failed", level="warning", user=name)

Modullar:
    config.py      papka, darajalar, toifalar, saqlash muddatlari (.env bilan)
    setup.py       configure(), log() — loggerlar daraxti, uvicorn, istisnolar
    handlers.py    DailyFileHandler — kunlik fayl, bo'linish, tozalash
    formatters.py  JsonFormatter, ConsoleFormatter
    context.py     request_id va boshqa kontekst maydonlari
    redact.py      maxfiy ma'lumotni yashirish
    reader.py      LogReader — qidiruv, xulosa (admin API uchun)
    external.py    MediaMTX logi: joylashuv, copytruncate aylantirish

Kim ishlatadi: core/log.py (facade), main.py (configure), app/factory.py
(access middleware), app/logs_api.py, camera/media/reconciler.py.
"""
