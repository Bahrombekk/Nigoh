"""Kamera va oqim hodisalari jurnali (camera_events jadvali).

Ikki manba yozadi:

  * kamera uzildi/qaytdi (`online` / `offline`) — camera/health.py;
  * oqim muzladi/tiklandi (`stalled` / `resumed`), MediaMTX qayta ishga
    tushdi (`mediamtx`), RTSP transporti almashdi (`transport`) —
    camera/reconciler.py va camera/transport.py. Bularni TCP tekshiruvi
    ko'rmaydi: port ochiq bo'lsa ham tasvir kelmasligi mumkin.

Tarix kameraga `camera_id` bilan bog'langan (nom yoki slug o'zgarsa ham
yo'qolmaydi), `path` — qaysi oqim yo'li (asosiy, `_sub`, `_h264`).
Uzilishlar tahlili (uptime, MTTR, soatlik profil) shu yozuvlardan —
api/analytics.py.
"""
from __future__ import annotations

from datetime import datetime

RETENTION_DAYS = 30


def add(db, kind: str, *, camera_id: int | None = None, path: str | None = None,
        detail: str | None = None) -> None:
    """Bitta hodisa yozadi. `camera_id` berilmasa yo'l nomidan topiladi."""
    db.execute(
        "INSERT INTO camera_events (kind, camera_id, path, detail) VALUES "
        "(%s, COALESCE(%s, (SELECT id FROM cameras "
        "  WHERE slug = regexp_replace(%s, '_(sub|h264)$', ''))), %s, %s)",
        (kind, camera_id, path, path, detail or None),
    )


def prune(db) -> None:
    """Eski hodisalarni o'chiradi — jurnal cheksiz o'smasin."""
    db.execute("DELETE FROM camera_events WHERE ts < now() - make_interval(days => %s)",
               (RETENTION_DAYS,))


def transitions(db, camera_id: int, since: datetime) -> list:
    """Kameraning online/offline o'tishlari, vaqt tartibida."""
    return db.execute(
        "SELECT ts, kind FROM camera_events WHERE camera_id = %s "
        "AND kind IN ('online', 'offline') AND ts >= %s ORDER BY ts, id",
        (camera_id, since)).fetchall()


def transitions_all(db, since: datetime) -> list:
    """Barcha kameralarning online/offline o'tishlari (camera_id, ts tartibida)."""
    return db.execute(
        "SELECT camera_id, ts, kind FROM camera_events "
        "WHERE kind IN ('online', 'offline') AND ts >= %s AND camera_id IS NOT NULL "
        "ORDER BY camera_id, ts, id", (since,)).fetchall()


def offline_times(db, since: datetime, camera_id: int | None = None) -> list:
    sql = "SELECT ts FROM camera_events WHERE kind = 'offline' AND ts >= %s"
    params: list = [since]
    if camera_id is not None:
        sql += " AND camera_id = %s"
        params.append(camera_id)
    return db.execute(sql, params).fetchall()


def for_camera(db, camera_id: int, start: datetime, end: datetime, limit: int = 200) -> list:
    """Kameraning barcha hodisalari (har uchala yo'l) — oxirgisi birinchi."""
    return db.execute(
        "SELECT ts, kind, detail, path FROM camera_events WHERE camera_id = %s "
        "AND ts >= %s AND ts < %s ORDER BY ts DESC, id DESC LIMIT %s",
        (camera_id, start, end, limit)).fetchall()


def recent(db, limit: int) -> list:
    """So'nggi hodisalar (boshqaruv paneli uchun), kamera manzili bilan."""
    return db.execute(
        "SELECT e.ts, e.kind, d.ip, d.port, e.path AS slug, e.detail "
        "FROM camera_events e LEFT JOIN camera_details d ON d.id = e.camera_id "
        "ORDER BY e.id DESC LIMIT %s", (limit,)).fetchall()
