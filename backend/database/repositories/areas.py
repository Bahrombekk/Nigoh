"""Ma'muriy hududlar repozitoriysi (viloyat -> tuman): nom bo'yicha topish,
koordinatadan aniqlash va ruxsat uchun ichki bo'g'inlarni yoyish.

Hudud chegaralari (GeoJSON) bazadan bir marta o'qilib jarayon xotirasida
saqlanadi — avval tumanlar (aniqroq), keyin viloyatlar; chegara
o'zgarsa `clear_cache()` chaqiriladi.

Tarkibi:
    AreaRepository              hududlar va chegaralar (holatsiz, `db` oladi)
        .list_regions(db)       viloyatlar [{id, name}] (formalar, operator ruxsatlari)
        .id_by_name(db, name)   nom bo'yicha id (katta-kichik harfga qaramaydi), yo'q — None
        .ids_by_names(db, names)  -> (topilgan id'lar, topilmagan nomlar)
        .id_for_point(db, lat, lng)  koordinata ichida yotgan eng aniq hudud
        .resolve(db, name, lat, lng)  kamera hududi: nom berilsa o'sha, aks holda koordinatadan
        .with_descendants(db, ids)  hududlar + barcha ichki bo'g'inlari (rekursiv)
    clear_cache()               chegaralar keshini tozalaydi
    UNASSIGNED                  "Belgilanmagan" — hududi yo'q kamera yorlig'i

Jadvallar: admin_areas
Ishlatadi: database.repositories.geo (point_in_geometry)
Kim ishlatadi: camera/api/admin.py (resolve), users/admin_api.py (list_regions),
stats/api.py (with_descendants), stats/reporting/engine.py (clear_cache),
repositories/users.py (ids_by_names, with_descendants), repositories/stats.py
(UNASSIGNED), tests/.
"""
from __future__ import annotations

import threading

from database.repositories.geo import point_in_geometry

UNASSIGNED = "Belgilanmagan"

_cache_lock = threading.Lock()
_boundaries: list[tuple[int, dict]] | None = None


def clear_cache() -> None:
    global _boundaries
    with _cache_lock:
        _boundaries = None


class AreaRepository:
    """Ma'muriy hududlar (viloyat -> tuman) va ularning chegaralari.

    Holatsiz: har metod birinchi argument sifatida ulanishni (`db`) oladi —
    tranzaksiya chegarasini chaqiruvchi `with get_db() as db:` bilan belgilaydi.
    """

    UNASSIGNED = UNASSIGNED
    clear_cache = staticmethod(clear_cache)

    def list_regions(self, db) -> list[dict]:
        """Viloyatlar ro'yxati (formalar va operator ruxsatlari uchun)."""
        return [dict(r) for r in db.execute(
            "SELECT id, name FROM admin_areas WHERE level = 'region' ORDER BY name")]

    def id_by_name(self, db, name: str | None) -> int | None:
        """Nom bo'yicha hudud (katta-kichik harfga qaramaydi). Topilmasa None."""
        name = (name or "").strip()
        if not name or name.lower() == UNASSIGNED.lower():
            return None
        row = db.execute("SELECT id FROM admin_areas WHERE lower(name) = lower(%s) "
                         "ORDER BY level = 'region' DESC, id LIMIT 1", (name,)).fetchone()
        return row[0] if row else None

    def ids_by_names(self, db, names: list[str]) -> tuple[list[int], list[str]]:
        """Nomlar ro'yxati -> (topilgan id'lar, topilmagan nomlar)."""
        found, unknown = [], []
        for name in dict.fromkeys(n.strip() for n in names if n and n.strip()):
            area = self.id_by_name(db, name)
            (found.append(area) if area else unknown.append(name))
        return found, unknown

    def _load_boundaries(self, db) -> list[tuple[int, dict]]:
        global _boundaries
        with _cache_lock:
            if _boundaries is None:
                # Avval tumanlar (aniqroq), keyin viloyatlar.
                _boundaries = [(r[0], r[1]) for r in db.execute(
                    "SELECT id, boundary FROM admin_areas WHERE boundary IS NOT NULL "
                    "ORDER BY level = 'district' DESC, id")]
            return _boundaries

    def id_for_point(self, db, lat: float | None, lng: float | None) -> int | None:
        """Koordinata qaysi hudud chegarasi ichida (eng aniq bo'g'in)."""
        if lat is None or lng is None:
            return None
        for area_id, geom in self._load_boundaries(db):
            if point_in_geometry(lng, lat, geom):
                return area_id
        return None

    def resolve(self, db, name: str | None, lat: float | None, lng: float | None) -> int | None:
        """Kamera hududi: nom aniq berilgan bo'lsa o'sha, aks holda koordinatadan."""
        return self.id_by_name(db, name) or self.id_for_point(db, lat, lng)

    def with_descendants(self, db, area_ids: list[int]) -> list[int]:
        """Berilgan hududlar va ularning barcha ichki bo'g'inlari (viloyat -> tumanlar)."""
        if not area_ids:
            return []
        return [r[0] for r in db.execute(
            "WITH RECURSIVE t AS ("
            "  SELECT id FROM admin_areas WHERE id = ANY(%s)"
            "  UNION SELECT a.id FROM admin_areas a JOIN t ON a.parent_id = t.id)"
            " SELECT id FROM t", (list(area_ids),))]
