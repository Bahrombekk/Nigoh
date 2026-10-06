"""Strukturali log yozish — butun backend uchun yagona kirish nuqtasi.

Bu fayl yupqa qatlam: hamma ish `core/logs/` paketida (toifalar, kunlik
fayllar, maxfiy ma'lumotni yashirish, request_id, konsol). Kod faqat shu
funksiyani chaqiradi:

    from core.log import log
    log("reconciler", "mediamtx_restarted", node="Asosiy")
    log("health", "sweep_failed", level="error", error=str(exc))
    log("app", "unexpected", level="error", exc_info=True)   # traceback bilan

`service` — qaysi xizmat yozyapti; undan toifa (papka) aniqlanadi:
health/reconciler/snapshots/passport/transport -> camera, auth -> security,
stats -> stats, watchdog/app -> app ... (core/logs/config.py, SERVICE_CATEGORY).
`event` — qisqa, mashina o'qiydigan nom (snake_case); matn emas.
`fields` — kontekst: camera_id, node, error ... (parol/token avtomatik yashiriladi).

Tarkibi:
    log(service, event, level="info", exc_info=None, **fields)
    LOG_DIR       loglar papkasi (standart DATA_DIR/logs)

Kim ishlatadi: app/{bootstrap,deps,system_api}.py, users/api.py,
    stats/recorder.py, core/watchdog.py, camera/api/admin.py,
    camera/media/{reconciler,transport}.py,
    camera/monitoring/{health,passport,snapshots}.py, database/schema.py.
"""
from core.logs.config import LOG_DIR
from core.logs.setup import log

__all__ = ["LOG_DIR", "log"]
