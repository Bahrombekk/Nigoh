"""MediaMTX tugunlari repozitoriysi (media_nodes jadvali).

Kameralar bir necha manzilda bo'lsa, har joyga alohida MediaMTX qo'yiladi —
kamera trafigi lokal tarmoqda qoladi. 1-tugun — backend bilan bitta
mashinadagi asosiy tugun, uni database/schema.py har doim yaratadi.

Tarkibi:
    MediaNodeRepository         tugunlar (holatsiz, `db` oladi)
        .get(db, node_id)       bitta tugun
        .list_enabled(db)       yoqilgan tugunlar, id tartibida
        .list_with_counts(db)   hamma tugunlar + har biridagi kameralar soni
        .names(db)              {id: nom}
        .create(db, data)       yangi tugun (_COLUMNS maydonlari) -> qator
        .update(db, node_id, data)  tugun sozlamasi -> qator
        .camera_count(db, node_id)  tugundagi kameralar soni (o'chirishdan oldin)
        .delete(db, node_id)    o'chirildimi

Jadvallar: media_nodes (+ sanash uchun cameras)
Kim ishlatadi: camera/api/nodes.py (CRUD), camera/api/mediamtx.py,
camera/media/reconciler.py va app/system_api.py (list_enabled),
camera/streaming.py (get), stats/admin_api.py (names).
"""
from __future__ import annotations

_COLUMNS = ("name", "api_base", "public_host", "rtsp_port", "hls_port",
            "webrtc_port", "enabled")


class MediaNodeRepository:
    """MediaMTX tugunlari (media_nodes).

    Holatsiz: har metod birinchi argument sifatida ulanishni (`db`) oladi —
    tranzaksiya chegarasini chaqiruvchi `with get_db() as db:` bilan belgilaydi.
    """

    def get(self, db, node_id: int):
        return db.execute("SELECT * FROM media_nodes WHERE id = %s", (node_id,)).fetchone()

    def list_enabled(self, db) -> list:
        return db.execute("SELECT * FROM media_nodes WHERE enabled ORDER BY id").fetchall()

    def list_with_counts(self, db) -> list:
        return db.execute(
            "SELECT n.*, (SELECT COUNT(*) FROM cameras c WHERE c.media_node_id = n.id "
            "AND c.deleted_at IS NULL) "
            "AS cameras FROM media_nodes n ORDER BY n.id").fetchall()

    def names(self, db) -> dict[int, str]:
        return {r[0]: r[1] for r in db.execute("SELECT id, name FROM media_nodes")}

    def create(self, db, data: dict):
        cols = ", ".join(_COLUMNS)
        return db.execute(
            f"INSERT INTO media_nodes ({cols}) VALUES ({', '.join(['%s'] * len(_COLUMNS))}) "
            "RETURNING *", tuple(data[c] for c in _COLUMNS)).fetchone()

    def update(self, db, node_id: int, data: dict):
        assignments = ", ".join(f"{c} = %s" for c in _COLUMNS)
        return db.execute(f"UPDATE media_nodes SET {assignments} WHERE id = %s RETURNING *",
                          (*(data[c] for c in _COLUMNS), node_id)).fetchone()

    def camera_count(self, db, node_id: int) -> int:
        return db.execute("SELECT COUNT(*) FROM cameras WHERE media_node_id = %s",
                          (node_id,)).fetchone()[0]

    def delete(self, db, node_id: int) -> bool:
        return db.execute("DELETE FROM media_nodes WHERE id = %s", (node_id,)).rowcount > 0
