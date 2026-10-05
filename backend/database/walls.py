"""Video devor (mozaika) registri — video_walls jadvali."""
from __future__ import annotations

from psycopg.types.json import Jsonb


def save(db, key: str, camera_ids: list[int], cols: int, rows: int, limit: int) -> None:
    """Devorni yozadi va eng eskilarini `limit` dan oshganda o'chiradi.

    `seq` har yozishda yangi raqam oladi — bu aniq "oxirgi ishlatilgan"
    tartibi. `created_at` bo'yicha emas: bir lahzada yozilgan devorlar teng
    chiqib, aynan ishlatilayotgani o'chib ketishi mumkin edi.
    """
    db.execute(
        "INSERT INTO video_walls (key, camera_ids, cols, rows) "
        "VALUES (%s, %s, %s, %s) ON CONFLICT (key) DO UPDATE SET "
        "camera_ids = EXCLUDED.camera_ids, cols = EXCLUDED.cols, "
        "rows = EXCLUDED.rows, seq = nextval('video_walls_seq'), created_at = now()",
        (key, Jsonb(camera_ids), cols, rows),
    )
    db.execute(
        "DELETE FROM video_walls WHERE seq < ("
        "  SELECT MIN(seq) FROM ("
        "    SELECT seq FROM video_walls ORDER BY seq DESC LIMIT %s) newest)",
        (limit,),
    )


def load(db, key: str):
    return db.execute("SELECT camera_ids, cols, rows FROM video_walls WHERE key = %s",
                      (key,)).fetchone()


def clear(db) -> None:
    db.execute("DELETE FROM video_walls")
