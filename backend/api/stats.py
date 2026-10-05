"""Nigoh — dashboard statistikasi: tarixni yozish va o'qish.

Ma'lumot manbai — core/stats.py yozib boradigan ikki jadval:
stats_region (5 daqiqalik hudud suratlari) va stats_event (uzilishlar).
Hammasi bitta endpointda — dashboard bitta so'rov bilan chizadi.

Yozuvchi (`start_recorder`) har daqiqada kameralarning yagona holatini
(`helpers.camera_state`) oladi — xaritadagi rang bilan bir xil manba.
"""
import threading
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter

from core import stats
from core.log import log
from database import cameras, get_db
from database import stats as stats_db

from .helpers import camera_state

# Prefiks nisbiy — create_app uni /api/v1 (asosiy) va /api (eski) ostida ulaydi.
router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/dashboard")
def dashboard_stats():
    now = datetime.now(timezone.utc)
    since24 = now - timedelta(hours=24)
    since7 = now - timedelta(days=8)   # 7 kunlik oynaga zaxira bilan

    with get_db() as db:
        # 24 soatlik chiziq: har bir surat vaqtida jami nechta onlayn edi.
        timeline = [
            {"ts": r["ts"], "online": r["online"], "total": r["total"]}
            for r in stats_db.timeline(db, since24)
        ]

        # Kunlik kesim (mahalliy sana bo'yicha): o'rtacha onlayn ulushi
        # va uzilish hodisalari soni. "Mahalliy" — ulanish zonasi
        # (NIGOH_TZ, database/connection.py): `ts::date` va CURRENT_DATE
        # shu zonada hisoblanadi.
        daily_up = {
            r["d"]: (r["online"], r["total"])
            for r in stats_db.daily_uptime(db, since7)
        }
        daily_ev = {
            r["d"]: r["n"]
            for r in stats_db.daily_outages(db, since7)
        }
        today = stats_db.today(db)
        daily = []
        for i in range(6, -1, -1):
            d = (today - timedelta(days=i)).isoformat()
            online, total = daily_up.get(d, (0, 0))
            daily.append({
                "date": d,
                "uptime": round(100 * online / total, 1) if total else None,
                "events": daily_ev.get(d, 0),
            })

        # Hudud kesimi: 24 soatlik o'rtacha onlayn ulushi va bugungi uzilishlar.
        reg_ev = {
            r["region"]: r["n"]
            for r in stats_db.outages_today_by_region(db)
        }
        regions = [
            {
                "region": r["region"],
                "uptime24": round(100 * r["online"] / r["total"], 1)
                            if r["total"] else None,
                "events_today": reg_ev.get(r["region"], 0),
            }
            for r in stats_db.uptime_by_region(db, since24)
        ]

        # Bugungi uzilishlar soat kesimida — 24 katakli ustuncha uchun.
        hourly = [0] * 24
        for r in stats_db.outages_today_by_hour(db):
            if 0 <= r["h"] <= 23:
                hourly[r["h"]] = r["n"]

        # So'nggi hodisalar — sahifa yangilansa ham yo'qolmaydigan lenta.
        events = [
            {"ts": r["ts"], "name": r["name"], "region": r["region"],
             "kind": r["kind"]}
            for r in stats_db.recent_changes(db, 40)
        ]

    return {
        "timeline": timeline,
        "daily": daily,
        "regions": regions,
        "hourly_today": hourly,
        "events_today": sum(hourly),
        "events": events,
    }


# ---------- tarixni yozib borish ----------

RECORD_INTERVAL = 60.0
_recorder_started = False


def _record_once() -> None:
    with get_db() as db:
        rows = cameras.list_all(db)
    snapshot = []
    for row in rows:
        state = camera_state(row)
        # unknown/disabled — holati o'lchanmaydi, foizlarga kirmaydi;
        # stalled — port ochiq-u tasvir yo'q, ya'ni ishlamayapti.
        online = None if state in ("unknown", "disabled") else state == "online"
        snapshot.append({"id": row["id"], "name": row["name"], "region": row["region"],
                         "organization_id": row["organization_id"],
                         "admin_area_id": row["admin_area_id"], "online": online})
    stats.record_states(snapshot)


def _recorder_loop() -> None:
    while True:
        time.sleep(RECORD_INTERVAL)   # birinchi sweep tugashiga vaqt beriladi
        try:
            _record_once()
        except Exception as exc:       # kuzatuv hech qachon yiqilmasin
            log("stats", "record_failed", level="error", error=str(exc))


def start_recorder() -> None:
    """Dashboard tarixini fonda yozib boradi (bir marta ishga tushadi)."""
    global _recorder_started
    if _recorder_started:
        return
    _recorder_started = True
    threading.Thread(target=_recorder_loop, name="stats-recorder",
                     daemon=True).start()
