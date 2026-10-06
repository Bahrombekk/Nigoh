"""Kamera va oqim hodisalari jurnali repozitoriysi (camera_events jadvali).

Ikki manba yozadi:

  * kamera uzildi/qaytdi (`online` / `offline`) — camera/monitoring/health.py;
  * oqim muzladi/tiklandi (`stalled` / `resumed`), MediaMTX qayta ishga
    tushdi (`mediamtx`), RTSP transporti almashdi (`transport`) —
    camera/media/reconciler.py va camera/media/transport.py. Bularni TCP tekshiruvi
    ko'rmaydi: port ochiq bo'lsa ham tasvir kelmasligi mumkin.

Tarix kameraga `camera_id` bilan bog'langan (nom yoki slug o'zgarsa ham
yo'qolmaydi), `path` — qaysi oqim yo'li (asosiy, `_sub`, `_h264`).
Uzilishlar tahlili (uptime, MTTR, soatlik profil) shu yozuvlardan —
stats/admin_api.py. Jurnal RETENTION_DAYS (30) kundan keyin tozalanadi.

Tarkibi:
    EventRepository             hodisalar jurnali (holatsiz, `db` oladi)
        .add(db, kind, camera_id=, path=, detail=)  bitta hodisa; camera_id
                                berilmasa yo'l nomidan (`_sub`/`_h264` qirqilib) topiladi
        .prune(db)              RETENTION_DAYS dan eskilarini o'chiradi
        .transitions(db, camera_id, since)  kameraning online/offline o'tishlari
        .transitions_all(db, since)  barcha kameralarniki (camera_id, ts tartibida)
        .offline_times(db, since, camera_id)  uzilish vaqtlari
        .for_camera(db, camera_id, start, end, limit)  kameraning barcha hodisalari, yangisi birinchi
        .recent(db, limit)      so'nggi hodisalar kamera manzili bilan (boshqaruv paneli)
    RETENTION_DAYS              saqlash muddati (30 kun)

Jadvallar: camera_events (+ o'qishda cameras, camera_details)
Kim ishlatadi: camera/monitoring/health.py, camera/media/reconciler.py va
transport.py (add, prune), camera/api/admin.py (transitions),
camera/api/mediamtx.py (recent), stats/admin_api.py (transitions,
transitions_all, offline_times, for_camera).
"""
from __future__ import annotations

from datetime import datetime

RETENTION_DAYS = 30


class EventRepository:
    """Kamera/oqim hodisalari jurnali (camera_events) — uptime manbai.

    Holatsiz: har metod birinchi argument sifatida ulanishni (`db`) oladi —
    tranzaksiya chegarasini chaqiruvchi `with get_db() as db:` bilan belgilaydi.
    """

    RETENTION_DAYS = RETENTION_DAYS

    def add(self, db, kind: str, *, camera_id: int | None = None, path: str | None = None,
            detail: str | None = None) -> None:
        """Bitta hodisa yozadi. `camera_id` berilmasa yo'l nomidan topiladi."""
        db.execute(
            "INSERT INTO camera_events (kind, camera_id, path, detail) VALUES "
            "(%s, COALESCE(%s, (SELECT id FROM cameras "
            "  WHERE slug = regexp_replace(%s, '_(sub|h264)$', ''))), %s, %s)",
            (kind, camera_id, path, path, detail or None),
        )

    def prune(self, db) -> None:
        """Eski hodisalarni o'chiradi — jurnal cheksiz o'smasin."""
        db.execute("DELETE FROM camera_events WHERE ts < now() - make_interval(days => %s)",
                   (RETENTION_DAYS,))

    def transitions(self, db, camera_id: int, since: datetime) -> list:
        """Kameraning online/offline o'tishlari, vaqt tartibida."""
        return db.execute(
            "SELECT ts, kind FROM camera_events WHERE camera_id = %s "
            "AND kind IN ('online', 'offline') AND ts >= %s ORDER BY ts, id",
            (camera_id, since)).fetchall()

    def transitions_all(self, db, since: datetime) -> list:
        """Barcha kameralarning online/offline o'tishlari (camera_id, ts tartibida)."""
        return db.execute(
            "SELECT camera_id, ts, kind FROM camera_events "
            "WHERE kind IN ('online', 'offline') AND ts >= %s AND camera_id IS NOT NULL "
            "ORDER BY camera_id, ts, id", (since,)).fetchall()

    def offline_times(self, db, since: datetime, camera_id: int | None = None) -> list:
        sql = "SELECT ts FROM camera_events WHERE kind = 'offline' AND ts >= %s"
        params: list = [since]
        if camera_id is not None:
            sql += " AND camera_id = %s"
            params.append(camera_id)
        return db.execute(sql, params).fetchall()

    def for_camera(self, db, camera_id: int, start: datetime, end: datetime, limit: int = 200) -> list:
        """Kameraning barcha hodisalari (har uchala yo'l) — oxirgisi birinchi."""
        return db.execute(
            "SELECT ts, kind, detail, path FROM camera_events WHERE camera_id = %s "
            "AND ts >= %s AND ts < %s ORDER BY ts DESC, id DESC LIMIT %s",
            (camera_id, start, end, limit)).fetchall()

    def recent(self, db, limit: int) -> list:
        """So'nggi hodisalar (boshqaruv paneli uchun), kamera manzili bilan."""
        return db.execute(
            "SELECT e.ts, e.kind, d.ip, d.port, e.path AS slug, e.detail "
            "FROM camera_events e LEFT JOIN camera_details d ON d.id = e.camera_id "
            "ORDER BY e.id DESC LIMIT %s", (limit,)).fetchall()
