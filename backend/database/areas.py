"""Ma'muriy hududlar (viloyat -> tuman): nom bo'yicha topish, koordinatadan
aniqlash va ruxsat uchun ichki bo'g'inlarni yoyish."""
from __future__ import annotations

import threading

from .geo import point_in_geometry

UNASSIGNED = "Belgilanmagan"

_cache_lock = threading.Lock()
_boundaries: list[tuple[int, dict]] | None = None


def list_regions(db) -> list[dict]:
    """Viloyatlar ro'yxati (formalar va operator ruxsatlari uchun)."""
    return [dict(r) for r in db.execute(
        "SELECT id, name FROM admin_areas WHERE level = 'region' ORDER BY name")]


def id_by_name(db, name: str | None) -> int | None:
    """Nom bo'yicha hudud (katta-kichik harfga qaramaydi). Topilmasa None."""
    name = (name or "").strip()
    if not name or name.lower() == UNASSIGNED.lower():
        return None
    row = db.execute("SELECT id FROM admin_areas WHERE lower(name) = lower(%s) "
                     "ORDER BY level = 'region' DESC, id LIMIT 1", (name,)).fetchone()
    return row[0] if row else None


def ids_by_names(db, names: list[str]) -> tuple[list[int], list[str]]:
    """Nomlar ro'yxati -> (topilgan id'lar, topilmagan nomlar)."""
    found, unknown = [], []
    for name in dict.fromkeys(n.strip() for n in names if n and n.strip()):
        area = id_by_name(db, name)
        (found.append(area) if area else unknown.append(name))
    return found, unknown


def _load_boundaries(db) -> list[tuple[int, dict]]:
    global _boundaries
    with _cache_lock:
        if _boundaries is None:
            # Avval tumanlar (aniqroq), keyin viloyatlar.
            _boundaries = [(r[0], r[1]) for r in db.execute(
                "SELECT id, boundary FROM admin_areas WHERE boundary IS NOT NULL "
                "ORDER BY level = 'district' DESC, id")]
        return _boundaries


def clear_cache() -> None:
    global _boundaries
    with _cache_lock:
        _boundaries = None


def id_for_point(db, lat: float | None, lng: float | None) -> int | None:
    """Koordinata qaysi hudud chegarasi ichida (eng aniq bo'g'in)."""
    if lat is None or lng is None:
        return None
    for area_id, geom in _load_boundaries(db):
        if point_in_geometry(lng, lat, geom):
            return area_id
    return None


def resolve(db, name: str | None, lat: float | None, lng: float | None) -> int | None:
    """Kamera hududi: nom aniq berilgan bo'lsa o'sha, aks holda koordinatadan."""
    return id_by_name(db, name) or id_for_point(db, lat, lng)


def with_descendants(db, area_ids: list[int]) -> list[int]:
    """Berilgan hududlar va ularning barcha ichki bo'g'inlari (viloyat -> tumanlar)."""
    if not area_ids:
        return []
    return [r[0] for r in db.execute(
        "WITH RECURSIVE t AS ("
        "  SELECT id FROM admin_areas WHERE id = ANY(%s)"
        "  UNION SELECT a.id FROM admin_areas a JOIN t ON a.parent_id = t.id)"
        " SELECT id FROM t", (list(area_ids),))]
