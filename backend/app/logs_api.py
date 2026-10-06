"""Loglar API'si — serverga kirmasdan loglarni ko'rish, qidirish va yuklab olish.

Faqat admin / API kalit (app/factory.py da key_guard bilan, bu yerda
require_admin). Loglar `logs/` papkasida, toifalarga ajratilgan
(core/logs/__init__.py). Maxfiy ma'lumot yozish paytidayoq yashirilgan.

Endpointlar:
    GET /api/v1/admin/logs                      qidiruv (eng yangisi birinchi)
        category  app|camera|stats|security|database|access|errors|mediamtx (standart errors)
        level     shu darajadan yuqori: DEBUG|INFO|WARNING|ERROR|CRITICAL
        service   aniq xizmat (health, reconciler, auth, http ...)
        event     hodisa nomida qism (backlog, login_failed ...)
        q         matn bo'yicha erkin qidiruv (butun yozuv ichida)
        request_id  bitta HTTP so'rovning butun zanjiri
        hours     oxirgi N soat (yoki since/until — ISO vaqt)
        limit     1..2000 (standart 200)
    GET /api/v1/admin/logs/summary?hours=24     toifa x daraja sonlari, eng ko'p muammolar
    GET /api/v1/admin/logs/files                toifalar, fayllar, hajm
    GET /api/v1/admin/logs/files/{category}/{name}   faylni yuklab olish

Misollar:
    /admin/logs?category=errors&hours=24                  so'nggi sutka xatolari
    /admin/logs?category=security&event=login_failed      muvaffaqiyatsiz kirishlar
    /admin/logs?category=access&request_id=a1b2c3d4e5f6   bitta so'rov
    /admin/logs?category=mediamtx&level=ERROR             MediaMTX xatolari

Ishlatadi: core.logs (config, reader), users.access.require_admin.
Kim ishlatadi: app/factory.py (router).
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from core.logs import config
from core.logs.reader import LEVELS, LogReader
from users.access import require_admin

router = APIRouter(prefix="/admin", tags=["logs"], dependencies=[Depends(require_admin)])

CATEGORY_NAMES = [*config.CATEGORIES, "mediamtx", "archive"]
_SAFE_NAME = re.compile(r"^[A-Za-z0-9_.-]+$")
_reader = LogReader(config.LOG_DIR)


def _time(value: str | None, name: str) -> datetime | None:
    if not value:
        return None
    try:
        t = datetime.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(422, f"{name}: ISO vaqt kerak (2026-10-06T10:00)") from exc
    return t if t.tzinfo else t.astimezone()


@router.get("/logs")
def logs_query(category: str = Query(default="errors"),
               level: str | None = None, service: str | None = None,
               event: str | None = None, q: str | None = None,
               request_id: str | None = None,
               hours: float | None = Query(default=None, gt=0, le=24 * 90),
               since: str | None = None, until: str | None = None,
               limit: int = Query(default=200, ge=1, le=2000)):
    """Loglarni qidirish — eng yangisi birinchi."""
    if category not in CATEGORY_NAMES:
        raise HTTPException(422, f"category: {', '.join(CATEGORY_NAMES)}")
    if level and level.upper() not in LEVELS:
        raise HTTPException(422, f"level: {', '.join(LEVELS)}")
    start = _time(since, "since")
    if hours and not start:
        start = datetime.now().astimezone() - timedelta(hours=hours)
    items = _reader.query(category, level=level, service=service, event=event, q=q,
                          request_id=request_id, since=start, until=_time(until, "until"),
                          limit=limit)
    return {"category": category, "count": len(items), "limit": limit, "items": items}


@router.get("/logs/summary")
def logs_summary(hours: int = Query(default=24, ge=1, le=24 * 30)):
    """Oxirgi N soatda toifa x daraja bo'yicha sonlar va eng ko'p takrorlangan muammolar."""
    return _reader.summary(hours)


@router.get("/logs/files")
def logs_files():
    """Toifalar va ulardagi fayllar (hajmi, oxirgi o'zgarish)."""
    return {"log_dir": str(config.LOG_DIR),
            "retention_days": {k: v["retention"] for k, v in config.CATEGORIES.items()},
            "categories": [{**c, "files_list": _reader.files(c["category"])}
                           for c in _reader.categories()]}


@router.get("/logs/files/{category}/{name}")
def logs_download(category: str, name: str):
    """Bitta log faylni yuklab olish (yo'l faqat logs/<toifa>/ ichida)."""
    if category not in CATEGORY_NAMES or not _SAFE_NAME.match(name):
        raise HTTPException(404, "Fayl topilmadi")
    path = (config.LOG_DIR / category / name).resolve()
    if path.parent != (config.LOG_DIR / category).resolve() or not path.is_file():
        raise HTTPException(404, "Fayl topilmadi")
    return FileResponse(path, media_type="text/plain; charset=utf-8", filename=name)
