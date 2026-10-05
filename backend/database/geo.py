"""Oddiy geometriya: nuqta GeoJSON ko'pburchak ichidami.

PostGIS o'rnatilgach bu hisob bazaga (ST_Contains) o'tadi; hozircha hudud
chegaralari bir necha o'nta va Python'da yetarli tez.
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
