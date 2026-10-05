"""Dashboard tarixi: hudud kesimidagi suratlar va holat o'zgarishlari.

  * availability_snapshots — har 5 daqiqada: tashkilot va hudud kesimida
    nechta kamera kuzatildi, nechtasi onlayn edi;
  * status_changes — kamera uzildi/qaytdi (dashboard lentasi).

Hudud nomi saqlanmaydi — admin_areas'dan olinadi; kamera nomi ham
cameras'dan (o'chirilgan kameraning lenta yozuvlari u bilan birga ketadi).
"""
from __future__ import annotations

from datetime import datetime

from .areas import UNASSIGNED

KEEP_DAYS = 30


def add_status_changes(db, items: list[tuple[datetime, int, str]]) -> None:
    """[(ts, camera_id, 'online'|'offline')]"""
    db.executemany("INSERT INTO status_changes (ts, camera_id, kind) VALUES (%s, %s, %s)",
                   items)


def add_snapshot(db, ts: datetime, rows: list[tuple[int, int | None, int, int]]) -> None:
    """[(organization_id, admin_area_id, total, online)] — bir lahzalik surat."""
    db.executemany(
        "INSERT INTO availability_snapshots (ts, organization_id, admin_area_id, total, online) "
        "VALUES (%s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
        [(ts, *r) for r in rows])


def prune(db, cutoff: datetime) -> None:
    db.execute("DELETE FROM availability_snapshots WHERE ts < %s", (cutoff,))
    db.execute("DELETE FROM status_changes WHERE ts < %s", (cutoff,))


def timeline(db, since: datetime) -> list:
    return db.execute(
        "SELECT ts, SUM(online) AS online, SUM(total) AS total FROM availability_snapshots "
        "WHERE ts >= %s GROUP BY ts ORDER BY ts", (since,)).fetchall()


def daily_uptime(db, since: datetime) -> list:
    """Mahalliy sana bo'yicha (ulanish zonasi — NIGOH_TZ)."""
    return db.execute(
        "SELECT to_char(ts, 'YYYY-MM-DD') AS d, SUM(online) AS online, SUM(total) AS total "
        "FROM availability_snapshots WHERE ts >= %s GROUP BY d", (since,)).fetchall()


def daily_outages(db, since: datetime) -> list:
    return db.execute(
        "SELECT to_char(ts, 'YYYY-MM-DD') AS d, COUNT(*) AS n FROM status_changes "
        "WHERE kind = 'offline' AND ts >= %s GROUP BY d", (since,)).fetchall()


def today(db):
    return db.execute("SELECT CURRENT_DATE").fetchone()[0]


def outages_today_by_region(db) -> list:
    return db.execute(
        "SELECT d.region, COUNT(*) AS n FROM status_changes s "
        "JOIN camera_details d ON d.id = s.camera_id "
        "WHERE s.kind = 'offline' AND s.ts::date = CURRENT_DATE GROUP BY d.region").fetchall()


def uptime_by_region(db, since: datetime) -> list:
    return db.execute(
        "SELECT COALESCE(a.name, %s) AS region, SUM(s.online) AS online, SUM(s.total) AS total "
        "FROM availability_snapshots s LEFT JOIN admin_areas a ON a.id = s.admin_area_id "
        "WHERE s.ts >= %s GROUP BY 1", (UNASSIGNED, since)).fetchall()


def outages_today_by_hour(db) -> list:
    return db.execute(
        "SELECT extract(hour FROM ts)::int AS h, COUNT(*) AS n FROM status_changes "
        "WHERE kind = 'offline' AND ts::date = CURRENT_DATE GROUP BY h").fetchall()


def recent_changes(db, limit: int = 40) -> list:
    return db.execute(
        "SELECT s.ts, d.name, d.region, s.kind FROM status_changes s "
        "JOIN camera_details d ON d.id = s.camera_id ORDER BY s.id DESC LIMIT %s",
        (limit,)).fetchall()
