"""Tashqi dastur yozadigan log fayli (MediaMTX) — joylashuvi va aylantirilishi.

MediaMTX o'z chiqishini (stdout/stderr) biz ochib bergan faylga yozadi:
reconciler faylni ochadi va handle'ni jarayonga beradi. MediaMTX o'zi
faylni aylantirmaydi, Windows esa ochiq faylni qayta nomlashga yo'l
qo'ymaydi — shuning uchun ilgari `mediamtx.log` cheksiz o'sardi
(2026-10-06: 12,8 MB).

Yechim — "copytruncate": hajm chegaradan oshsa, joriy mazmun sanali
arxiv faylga NUSXALANADI va asl fayl 0 ga qisqartiriladi. MediaMTX
handle'ni append rejimida ushlagani uchun keyingi yozuvlari yangi
boshlangan faylga tushadi. Nusxa va qisqartirish orasida yozilgan bir
necha satr yo'qolishi mumkin — matnli diagnostika logi uchun maqbul.

    logs/mediamtx/mediamtx.log                    joriy (MediaMTX yozadi)
    logs/mediamtx/mediamtx-2026-10-06-1047.log    arxiv

Tarkibi:
    MEDIAMTX_LOG                    joriy fayl yo'li
    open_for_child() -> file        MediaMTX'ga beriladigan handle (append)
    rotate_if_large(max_bytes) -> bool   copytruncate; aylantirilgan bo'lsa True
    cleanup(retention_days) -> int  eski arxivlarni o'chiradi
    tail(n_bytes) -> str            oxirgi qism (o'lim sababini topish uchun)
    migrate_legacy(root)            ildizdagi eski mediamtx.log ni ko'chiradi

Kim ishlatadi: camera/media/reconciler.py.
"""
from __future__ import annotations

import os
import shutil
import time
from datetime import datetime, timedelta
from pathlib import Path

from core.logs import config

MEDIAMTX_DIR = config.LOG_DIR / "mediamtx"
MEDIAMTX_LOG = MEDIAMTX_DIR / "mediamtx.log"


def open_for_child():
    MEDIAMTX_DIR.mkdir(parents=True, exist_ok=True)
    return open(MEDIAMTX_LOG, "ab")


def rotate_if_large(max_bytes: int = config.MAX_BYTES) -> bool:
    try:
        if not MEDIAMTX_LOG.exists() or MEDIAMTX_LOG.stat().st_size < max_bytes:
            return False
        stamp = datetime.now().strftime("%Y-%m-%d-%H%M")
        archive = MEDIAMTX_DIR / f"mediamtx-{stamp}.log"
        shutil.copyfile(MEDIAMTX_LOG, archive)
        with open(MEDIAMTX_LOG, "r+b") as f:
            f.truncate(0)
        return True
    except OSError:
        return False


def cleanup(retention_days: int = config.RETENTION_DAYS) -> int:
    cutoff = time.time() - timedelta(days=retention_days).total_seconds()
    removed = 0
    for f in MEDIAMTX_DIR.glob("mediamtx-*.log"):
        try:
            if f.stat().st_mtime < cutoff:
                f.unlink()
                removed += 1
        except OSError:
            pass
    return removed


def tail(n_bytes: int = 8192) -> str:
    try:
        with open(MEDIAMTX_LOG, "rb") as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - n_bytes))
            return f.read().decode("utf-8", errors="replace")
    except OSError:
        return ""


def migrate_legacy(root: Path) -> None:
    """Ildizdagi eski mediamtx.log -> logs/mediamtx/mediamtx-legacy.log.

    Eski MediaMTX jarayoni hali ishlayotgan bo'lsa fayl band — keyingi
    ishga tushishda qayta uriniladi."""
    old = Path(root) / "mediamtx.log"
    if not old.exists():
        return
    MEDIAMTX_DIR.mkdir(parents=True, exist_ok=True)
    try:
        shutil.move(str(old), str(MEDIAMTX_DIR / "mediamtx-legacy.log"))
    except OSError:
        pass
