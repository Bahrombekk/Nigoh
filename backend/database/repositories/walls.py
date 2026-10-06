"""Video devor (mozaika) registri repozitoriysi — video_walls jadvali.

Devor kalit (`key`) bo'yicha saqlanadi; registr cheklangan — `limit` dan
oshganda eng uzoq ishlatilmaganlari o'chadi. Tartib `seq` bo'yicha (har
yozishda yangi raqam), `created_at` bo'yicha emas: bir lahzada yozilgan
devorlar teng chiqib, aynan ishlatilayotgani o'chib ketishi mumkin edi.

Tarkibi:
    WallRepository              devor registri (holatsiz, `db` oladi)
        .save(db, key, camera_ids, cols, rows, limit)  yozadi/yangilaydi, eskilarini kesadi
        .load(db, key)          (camera_ids, cols, rows) yoki None
        .clear(db)              hammasini o'chiradi (testlar)

Jadvallar: video_walls (+ video_walls_seq)
Kim ishlatadi: walls/registry.py (save, load), tests/test_walls.py (clear).
"""
from __future__ import annotations

from psycopg.types.json import Jsonb


class WallRepository:
    """Video devor registri (video_walls).

    Holatsiz: har metod birinchi argument sifatida ulanishni (`db`) oladi —
    tranzaksiya chegarasini chaqiruvchi `with get_db() as db:` bilan belgilaydi.
    """

    def save(self, db, key: str, camera_ids: list[int], cols: int, rows: int, limit: int) -> None:
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

    def load(self, db, key: str):
        return db.execute("SELECT camera_ids, cols, rows FROM video_walls WHERE key = %s",
                          (key,)).fetchone()

    def clear(self, db) -> None:
        db.execute("DELETE FROM video_walls")
