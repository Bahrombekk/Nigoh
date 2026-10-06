"""Temir yo'l repozitoriysi: yo'nalishlar, bo'g'inlar (uzel -> stansiya/peregon), km/piket.

Kamera joyi nomidan o'qiladi: "3428/1 km" -> km=3428, piket=1 (piket
1-10). Nom km'ga o'xshasa-yu, formatga tushmasa ("3606/8/10 km") — bu
alohida aniqlanadi, chunki shunday kamera km'siz qolib ketgan edi.

Tarkibi:
    RailRepository              yo'nalishlar va bo'g'inlar (holatsiz, `db` oladi)
        .default_line_id(db)    yo'nalish ko'rsatilmagan km uchun asosiy yo'nalish (code='main')
        .unit_for_km(db, line_id, km)  km qaysi stansiya/peregon oralig'ida (eng tor oraliq)
        .line_names(db)         {id: nom}
        .area_for_km(db, line_id, km, max_km)  koordinatasiz kamera hududi — `max_km`
                                ichidagi eng yaqin qo'shnilardan, faqat ular bir
                                hududda bo'lsa (chegara yonidagi kamera noto'g'ri
                                viloyatga tushmasin)
        .parse_km_picket / .looks_like_km  quyidagi funksiyalar (staticmethod)
    parse_km_picket(name)       nomdan (km, piket); piket 1-10 dan tashqari — None
    looks_like_km(name)         nom km/piket yozuviga o'xshaydimi (format noto'g'ri bo'lsa ham)
    KM_PICKET, KM_LIKE          tegishli regex'lar

Jadvallar: rail_lines, rail_units (+ area_for_km uchun cameras)
Kim ishlatadi: camera/api/admin.py (km/piket, bo'g'in, hudud), stats/api.py
(line_names), repositories/reports.py (data_quality: km_name_mismatch),
database/scripts/fix_camera_data.py.
"""
from __future__ import annotations

import re

# "3428/1 km", "3717/8 km (2)" -> km=3428, piket=1
KM_PICKET = re.compile(r"^\s*(\d+)\s*/\s*(\d+)\s*km\b", re.IGNORECASE)


def parse_km_picket(name: str | None) -> tuple[int, int] | None:
    """Kamera nomidan km va piket. Piket 1-10 dan tashqarida bo'lsa — None."""
    m = KM_PICKET.match(name or "")
    if not m or not 1 <= int(m.group(2)) <= 10:
        return None
    return int(m.group(1)), int(m.group(2))


# Nom "km bo'lishi kerak"ga o'xshaydimi: "3606/8/10 km", "3606-8 km" ...
KM_LIKE = re.compile(r"^\s*\d+\s*[/\-.]\s*\d+.*\bkm\b", re.IGNORECASE)


def looks_like_km(name: str | None) -> bool:
    """Nom km/piket yozuviga o'xshaydi, lekin to'g'ri formatda bo'lmasligi mumkin."""
    return bool(KM_LIKE.match(name or ""))


class RailRepository:
    """Temir yo'l: yo'nalishlar, bo'g'inlar, km/piket.

    Holatsiz: har metod birinchi argument sifatida ulanishni (`db`) oladi —
    tranzaksiya chegarasini chaqiruvchi `with get_db() as db:` bilan belgilaydi.
    """

    KM_PICKET = KM_PICKET
    KM_LIKE = KM_LIKE
    parse_km_picket = staticmethod(parse_km_picket)
    looks_like_km = staticmethod(looks_like_km)

    def default_line_id(self, db) -> int | None:
        """Yo'nalish ko'rsatilmagan km uchun: asosiy yo'nalish (code='main')."""
        row = db.execute("SELECT id FROM rail_lines WHERE code = 'main'").fetchone()
        return row[0] if row else None

    def unit_for_km(self, db, line_id: int | None, km: int | None) -> int | None:
        """Km qaysi stansiya/peregon oralig'ida (eng tor oraliq)."""
        if line_id is None or km is None:
            return None
        row = db.execute(
            "SELECT id FROM rail_units WHERE rail_line_id = %s AND km_start <= %s "
            "AND km_end >= %s ORDER BY km_end - km_start, id LIMIT 1",
            (line_id, km, km)).fetchone()
        return row[0] if row else None

    def line_names(self, db) -> dict[int, str]:
        return {r[0]: r[1] for r in db.execute("SELECT id, name FROM rail_lines ORDER BY id")}

    def area_for_km(self, db, line_id: int | None, km: int | None, max_km: int = 5) -> int | None:
        """Koordinatasi yo'q kameraning hududi — o'sha yo'nalishdagi eng yaqin
        (km bo'yicha, `max_km` ichida) hududi ma'lum kameralardan.

        Yaqin qo'shnilar bir hududda bo'lsagina javob beriladi: chegara
        yonidagi kamera noto'g'ri viloyatga tushib qolmasin.
        """
        if line_id is None or km is None:
            return None
        rows = db.execute(
            "SELECT admin_area_id FROM cameras WHERE rail_line_id = %s AND km IS NOT NULL "
            "AND admin_area_id IS NOT NULL AND abs(km - %s) <= %s "
            "ORDER BY abs(km - %s), id LIMIT 4", (line_id, km, max_km, km)).fetchall()
        found = {r[0] for r in rows}
        return found.pop() if len(found) == 1 else None
