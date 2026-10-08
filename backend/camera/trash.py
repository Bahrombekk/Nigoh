"""Kameralar savati: yumshoq o'chirilganlarni muddati o'tgach butunlay o'chirish.

`DELETE /admin/cameras/{id}` kamerani darhol o'chirmaydi — `cameras.deleted_at`
qo'yiladi va kamera `camera_details` ko'rinishidan (ya'ni ro'yxatlar,
statistika, MediaMTX va health'dan) chiqadi. KEEP_DAYS (30) kun ichida
`POST /admin/cameras/{id}/restore` bilan qaytariladi; undan keyin shu modul
uni hodisalar tarixi va guruh a'zoligi bilan birga butunlay o'chiradi.

Tozalash health sikliga ilgak bo'lib ulanadi (app/bootstrap.py ->
`health.add_hook`), lekin soatiga bir martadan ko'p ishlamaydi.

Tarkibi:
    KEEP_DAYS                   savatda saqlanish muddati (30 kun)
    restore_until(deleted_at)   qaytarish mumkin bo'lgan oxirgi vaqt
    purge(force=False)          muddati o'tganlarni o'chiradi -> soni (None — navbati emas)

Ishlatadi: database (cameras, get_db), core.log.
Kim ishlatadi: app/bootstrap.py (ilgak), camera/api/admin.py (restore_until, KEEP_DAYS).
"""
import threading
import time
from datetime import datetime, timedelta

from core.log import log
from database import cameras, get_db

KEEP_DAYS = 30
PURGE_EVERY = 3600.0          # soniya — tozalash soatiga bir

_last = [0.0]
_lock = threading.Lock()


def restore_until(deleted_at: datetime) -> datetime:
    return deleted_at + timedelta(days=KEEP_DAYS)


def purge(force: bool = False) -> int | None:
    """Savatda KEEP_DAYS kundan uzoq turganlarni butunlay o'chiradi."""
    now = time.monotonic()
    with _lock:
        if not force and _last[0] and now - _last[0] < PURGE_EVERY:
            return None
        _last[0] = now
    with get_db() as db:
        n = cameras.purge_deleted(db, KEEP_DAYS)
    if n:
        log("app", "cameras_purged", count=n, keep_days=KEEP_DAYS)
    return n
