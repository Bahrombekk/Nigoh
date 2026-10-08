"""Bildirishnomalar repozitoriysi: tizim bildirishnomalari, kamera uzilish lentasi
va foydalanuvchi bo'yicha o'qilganlik.

Ikki manba bitta lentaga qo'shiladi (notifications/service.py):

  * kamera hodisalari — `camera_events` dagi online/offline o'tishlari
    (health yozadi); id `e<camera_events.id>`; o'chirilgan (savatdagi)
    kameralar `camera_details` orqali o'z-o'zidan chiqib ketadi;
  * tizim bildirishnomalari — `system_alerts` (disk, MediaMTX, baza ...),
    holat o'zgarganda bitta yozuv; id `s<system_alerts.id>`.

O'qilganlik: `users.notif_read_before` ("hammasini o'qildi" vaqti) va
`notification_reads` (alohida belgilangan id'lar). Sahifalash kursori —
(ts, manba, id): bitta tranzaksiyada yozilgan hodisalarning vaqti bir xil
bo'ladi (bitta NVR ortidagi o'nlab kamera), faqat ts bo'yicha kesilsa ular
yo'qolardi.

Tarkibi:
    NotificationRepository
      tizim bildirishnomalari:
        .alert_states(db)           {kalit: oxirgi holat (active)}
        .add_alert(db, key, active, severity, title, text) -> id
        .prune(db, days)            eski tizim bildirishnomalari va o'qilganlik belgilari
      lenta:
        .camera_items(db, area_ids, cursor, limit, user_id)  kamera hodisalari
        .system_items(db, cursor, limit, user_id)
        .item_cursor(db, item_id)   "e123"/"s7" -> (ts, manba, id) yoki None
        .unread_counts(db, user_id, area_ids, since, outage)  {"outage", "system"}
        .mark_read(db, user_id, item_ids)

Jadvallar: system_alerts, notification_reads (0006_v3.py), camera_events,
users.notif_read_before; view camera_details
Kim ishlatadi: notifications/service.py, notifications/alerts.py.
"""
from __future__ import annotations

from datetime import datetime

# Manba tartibi kursorda: bir xil vaqtda tizim bildirishnomasi kamera
# hodisasidan "yangiroq" hisoblanadi (yuqorida turadi).
CAMERA, SYSTEM = 0, 1

_READ = ("(%(rb)s::timestamptz IS NOT NULL AND {ts} <= %(rb)s) OR EXISTS ("
         "SELECT 1 FROM notification_reads r WHERE r.user_id = %(uid)s AND r.item_id = {item})")


class NotificationRepository:
    """Tizim bildirishnomalari, kamera uzilish lentasi va o'qilganlik."""

    CAMERA = CAMERA
    SYSTEM = SYSTEM

    # ---------- tizim bildirishnomalari ----------

    def alert_states(self, db) -> dict[str, bool]:
        return {r[0]: r[1] for r in db.execute(
            "SELECT DISTINCT ON (key) key, active FROM system_alerts ORDER BY key, id DESC")}

    def add_alert(self, db, key: str, active: bool, severity: str, title: str,
                  text: str = "") -> int:
        return db.execute(
            "INSERT INTO system_alerts (key, active, severity, title, text) "
            "VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (key, active, severity, title, text)).fetchone()[0]

    def prune(self, db, days: int) -> None:
        """Eski tizim bildirishnomalari (har kalitning oxirgisi qoladi — holat
        xotirasi) va o'qilganlik belgilari."""
        db.execute(
            "DELETE FROM system_alerts s WHERE ts < now() - make_interval(days => %s) "
            "AND id <> (SELECT max(id) FROM system_alerts x WHERE x.key = s.key)", (days,))
        db.execute("DELETE FROM notification_reads WHERE read_at < now() - make_interval(days => %s)",
                   (days,))

    # ---------- lenta ----------

    def camera_items(self, db, *, area_ids: list[int] | None, cursor: tuple | None,
                     limit: int, user_id: int | None, rb: datetime | None) -> list:
        """Kamera online/offline hodisalari (yangisi birinchi), qo'shni o'tish bilan:
        offline uchun keyingi o'tish (tiklandimi), online uchun oldingisi (uzilish
        qachon boshlangan)."""
        where = ["e.kind IN ('online', 'offline')"]
        params: dict = {"limit": limit, "uid": user_id, "rb": rb}
        if area_ids is not None:
            where.append("d.admin_area_id = ANY(%(ids)s)")
            params["ids"] = list(area_ids)
        if cursor is not None:
            where.append("(e.ts, 0, e.id) < (%(cts)s, %(csrc)s, %(cid)s)")
            params.update(cts=cursor[0], csrc=cursor[1], cid=cursor[2])
        read = _READ.format(ts="e.ts", item="'e' || e.id") if user_id else "false"
        return db.execute(
            "SELECT e.id, e.ts, e.kind, e.camera_id, d.name, d.region, "
            f"  ({read}) AS read, "
            "  nxt.ts AS next_ts, nxt.kind AS next_kind, prv.ts AS prev_ts, prv.kind AS prev_kind "
            "FROM camera_events e JOIN camera_details d ON d.id = e.camera_id "
            "LEFT JOIN LATERAL (SELECT n.ts, n.kind FROM camera_events n "
            "  WHERE n.camera_id = e.camera_id AND n.kind IN ('online', 'offline') "
            "  AND (n.ts, n.id) > (e.ts, e.id) ORDER BY n.ts, n.id LIMIT 1) nxt ON true "
            "LEFT JOIN LATERAL (SELECT p.ts, p.kind FROM camera_events p "
            "  WHERE p.camera_id = e.camera_id AND p.kind IN ('online', 'offline') "
            "  AND (p.ts, p.id) < (e.ts, e.id) ORDER BY p.ts DESC, p.id DESC LIMIT 1) prv ON true "
            f"WHERE {' AND '.join(where)} ORDER BY e.ts DESC, e.id DESC LIMIT %(limit)s",
            params).fetchall()

    def system_items(self, db, *, cursor: tuple | None, limit: int, user_id: int | None,
                     rb: datetime | None) -> list:
        where, params = ["TRUE"], {"limit": limit, "uid": user_id, "rb": rb}
        if cursor is not None:
            where.append("(s.ts, 1, s.id) < (%(cts)s, %(csrc)s, %(cid)s)")
            params.update(cts=cursor[0], csrc=cursor[1], cid=cursor[2])
        read = _READ.format(ts="s.ts", item="'s' || s.id") if user_id else "false"
        return db.execute(
            f"SELECT s.id, s.ts, s.key, s.active, s.severity, s.title, s.text, ({read}) AS read "
            f"FROM system_alerts s WHERE {' AND '.join(where)} "
            "ORDER BY s.ts DESC, s.id DESC LIMIT %(limit)s", params).fetchall()

    def item_cursor(self, db, item_id: str) -> tuple | None:
        """"e123" / "s7" -> (ts, manba, id) — sahifalash kursori; topilmasa None."""
        if len(item_id) < 2 or item_id[0] not in "es" or not item_id[1:].isdigit():
            return None
        num = int(item_id[1:])
        table, src = ("camera_events", CAMERA) if item_id[0] == "e" else ("system_alerts", SYSTEM)
        row = db.execute(f"SELECT ts FROM {table} WHERE id = %s", (num,)).fetchone()
        return (row[0], src, num) if row else None

    def unread_counts(self, db, *, user_id: int | None, rb: datetime | None,
                      area_ids: list[int] | None, since: datetime, outage: bool) -> dict:
        """O'qilmaganlar soni (`since` dan beri): {"outage": n, "system": n}."""
        params = {"uid": user_id, "rb": rb, "since": since, "ids": area_ids}
        flt = "" if area_ids is None else " AND d.admin_area_id = ANY(%(ids)s)"
        cam_unread = ("" if not user_id else
                      " AND NOT (" + _READ.format(ts="e.ts", item="'e' || e.id") + ")")
        sys_unread = ("" if not user_id else
                      " AND NOT (" + _READ.format(ts="s.ts", item="'s' || s.id") + ")")
        n_outage = 0
        if outage:
            n_outage = db.execute(
                "SELECT count(*) FROM camera_events e JOIN camera_details d ON d.id = e.camera_id "
                f"WHERE e.kind IN ('online', 'offline') AND e.ts >= %(since)s{flt}{cam_unread}",
                params).fetchone()[0]
        n_system = db.execute(
            f"SELECT count(*) FROM system_alerts s WHERE s.ts >= %(since)s{sys_unread}",
            params).fetchone()[0]
        return {"outage": n_outage, "system": n_system}

    def mark_read(self, db, user_id: int, item_ids: list[str]) -> None:
        db.executemany(
            "INSERT INTO notification_reads (user_id, item_id) VALUES (%s, %s) "
            "ON CONFLICT DO NOTHING", [(user_id, i) for i in item_ids])
