"""Temir yo'l: yo'nalishlar va bo'g'inlar (uzel -> stansiya/peregon)."""
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


def default_line_id(db) -> int | None:
    """Yo'nalish ko'rsatilmagan km uchun: asosiy yo'nalish (code='main')."""
    row = db.execute("SELECT id FROM rail_lines WHERE code = 'main'").fetchone()
    return row[0] if row else None


def unit_for_km(db, line_id: int | None, km: int | None) -> int | None:
    """Km qaysi stansiya/peregon oralig'ida (eng tor oraliq)."""
    if line_id is None or km is None:
        return None
    row = db.execute(
        "SELECT id FROM rail_units WHERE rail_line_id = %s AND km_start <= %s "
        "AND km_end >= %s ORDER BY km_end - km_start, id LIMIT 1",
        (line_id, km, km)).fetchone()
    return row[0] if row else None
