"""Oddiy geometriya: nuqta GeoJSON ko'pburchak ichidami.

PostGIS o'rnatilgach bu hisob bazaga (ST_Contains) o'tadi; hozircha hudud
chegaralari bir necha o'nta va Python'da yetarli tez. Bazaga murojaat
yo'q — boshqa repozitoriylar bilan bir qatorda turishi shu kelajak uchun.

Tarkibi:
    point_in_geometry(lng, lat, geom)  GeoJSON Polygon/MultiPolygon ichidami
                                (teshiklar hisobga olinadi)
    GeoRepository               shu funksiyaning repozitoriy ko'rinishi
        .point_in_geometry(...)  staticmethod
    _point_in_ring(lng, lat, ring)  nur kesish (ray casting) algoritmi

Kim ishlatadi: repositories/areas.py (point_in_geometry — hudud aniqlash).
`geo` nusxasi database/__init__.py dan eksport qilinadi, lekin hozircha
tashqarida chaqirilmaydi.
"""


def _point_in_ring(lng: float, lat: float, ring: list) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and \
                lng < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def point_in_geometry(lng: float, lat: float, geom: dict) -> bool:
    """GeoJSON Polygon/MultiPolygon ichidami (teshiklar hisobga olinadi)."""
    polygons = ([geom["coordinates"]] if geom["type"] == "Polygon"
                else geom["coordinates"] if geom["type"] == "MultiPolygon" else [])
    for rings in polygons:
        if rings and _point_in_ring(lng, lat, rings[0]) and \
                not any(_point_in_ring(lng, lat, hole) for hole in rings[1:]):
            return True
    return False


class GeoRepository:
    """Geometriya yordamchilari (nuqta hudud ichidami).

    Holatsiz: har metod birinchi argument sifatida ulanishni (`db`) oladi —
    tranzaksiya chegarasini chaqiruvchi `with get_db() as db:` bilan belgilaydi.
    """

    point_in_geometry = staticmethod(point_in_geometry)


