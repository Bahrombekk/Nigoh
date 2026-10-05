"""MediaMTX tugunlari (media_nodes jadvali)."""
from __future__ import annotations

_COLUMNS = ("name", "api_base", "public_host", "rtsp_port", "hls_port",
            "webrtc_port", "enabled")


def get(db, node_id: int):
    return db.execute("SELECT * FROM media_nodes WHERE id = %s", (node_id,)).fetchone()


def list_enabled(db) -> list:
    return db.execute("SELECT * FROM media_nodes WHERE enabled ORDER BY id").fetchall()


def list_with_counts(db) -> list:
    return db.execute(
        "SELECT n.*, (SELECT COUNT(*) FROM cameras c WHERE c.media_node_id = n.id) "
        "AS cameras FROM media_nodes n ORDER BY n.id").fetchall()


def names(db) -> dict[int, str]:
    return {r[0]: r[1] for r in db.execute("SELECT id, name FROM media_nodes")}


def create(db, data: dict):
    cols = ", ".join(_COLUMNS)
    return db.execute(
        f"INSERT INTO media_nodes ({cols}) VALUES ({', '.join(['%s'] * len(_COLUMNS))}) "
        "RETURNING *", tuple(data[c] for c in _COLUMNS)).fetchone()


def update(db, node_id: int, data: dict):
    assignments = ", ".join(f"{c} = %s" for c in _COLUMNS)
    return db.execute(f"UPDATE media_nodes SET {assignments} WHERE id = %s RETURNING *",
                      (*(data[c] for c in _COLUMNS), node_id)).fetchone()


def camera_count(db, node_id: int) -> int:
    return db.execute("SELECT COUNT(*) FROM cameras WHERE media_node_id = %s",
                      (node_id,)).fetchone()[0]


def delete(db, node_id: int) -> bool:
    return db.execute("DELETE FROM media_nodes WHERE id = %s", (node_id,)).rowcount > 0
