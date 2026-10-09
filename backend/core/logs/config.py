"""Log tizimi sozlamalari: papka, darajalar, toifalar va saqlash muddatlari.

Hamma narsa muhitdan (`.env`) o'zgartiriladi — kodga tegmasdan:

    LOG_DIR             loglar papkasi (standart: DATA_DIR/logs)
    LOG_LEVEL           faylga yoziladigan eng past daraja (standart INFO)
    LOG_CONSOLE_LEVEL   konsolga (start.bat oynasi) chiqadigan daraja (INFO)
    LOG_RETENTION_DAYS  umumiy saqlash muddati, kun (30); toifa o'zinikini bersa — o'shasi
    LOG_MAX_MB          bitta kunlik faylning chegarasi; oshsa .1, .2 ... ga bo'linadi (50)
    LOG_ACCESS_STATIC   1 — /css, /js, /assets so'rovlari ham access logga (standart 0)

Toifalar (har biri o'z papkasida):

    app        ilova hayot sikli: ishga tushish, sozlama, watchdog, uvicorn xatolari
    camera     kamera va video: health, reconciler, snapshots, passport, transport
    stats      statistika yozuvchisi va hisobotlar
    security   kirish, rad etish, kalit/parol urinishlari — uzoqroq saqlanadi
    database   migratsiyalar, ulanish muammolari
    access     HTTP so'rovlar: usul, yo'l, holat, vaqt, IP, so'rov ID
    errors     YIG'MA: hamma toifadagi WARNING va undan yuqori — "nima buzildi?"
    mediamtx   MediaMTX dasturining o'z chiqishi (matn, JSON emas)

Tarkibi:
    LOG_DIR, LEVEL, CONSOLE_LEVEL, RETENTION_DAYS, MAX_BYTES, ACCESS_STATIC
    CATEGORIES               toifa -> {retention, description}
    SERVICE_CATEGORY         log(service, ...) dagi service -> toifa
    category_of(service)     noma'lum service -> "app"

Kim ishlatadi: core/logs/{setup,handlers,reader,external}.py, app/logs_api.py.
"""
from __future__ import annotations

import logging
import os

from core.paths import DATA_DIR


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _level(name: str, default: str) -> int:
    value = logging.getLevelName(os.environ.get(name, default).strip().upper())
    return value if isinstance(value, int) else logging.getLevelName(default)


# Nisbiy LOG_DIR — DATA_DIR ga nisbatan; mutlaq yo'l o'zicha (Path / mutlaq = mutlaq).
LOG_DIR = DATA_DIR / os.environ.get("LOG_DIR", "logs")
LEVEL = _level("LOG_LEVEL", "INFO")
CONSOLE_LEVEL = _level("LOG_CONSOLE_LEVEL", "INFO")
RETENTION_DAYS = _int("LOG_RETENTION_DAYS", 30)
MAX_BYTES = _int("LOG_MAX_MB", 50) * 1024 * 1024
ACCESS_STATIC = os.environ.get("LOG_ACCESS_STATIC", "0") == "1"

# Toifa -> saqlash muddati (kun) va tavsif. `errors` — yig'ma, alohida manba emas.
CATEGORIES: dict[str, dict] = {
    "app":      {"retention": RETENTION_DAYS, "description": "ilova hayot sikli, sozlama, uvicorn"},
    "camera":   {"retention": RETENTION_DAYS, "description": "kamera va video xizmatlari"},
    "stats":    {"retention": RETENTION_DAYS, "description": "statistika yozuvchisi"},
    "security": {"retention": max(RETENTION_DAYS, 90), "description": "kirish va rad etishlar"},
    "database": {"retention": max(RETENTION_DAYS, 90), "description": "migratsiya va ulanish"},
    "access":   {"retention": min(RETENTION_DAYS, 14), "description": "HTTP soʻrovlar"},
    "errors":   {"retention": max(RETENTION_DAYS, 90), "description": "hamma toifadan WARNING+"},
}

SERVICE_CATEGORY: dict[str, str] = {
    "app": "app", "watchdog": "app", "server": "app",
    "health": "camera", "reconciler": "camera", "snapshots": "camera",
    "passport": "camera", "transport": "camera", "media": "camera",
    "mediamtx": "camera", "devices": "camera", "walls": "camera",
    "stats": "stats", "reporting": "stats",
    "auth": "security", "security": "security", "throttle": "security",
    "database": "database", "db": "database",
    "http": "access",
}


def category_of(service: str) -> str:
    return SERVICE_CATEGORY.get(service, "app")
