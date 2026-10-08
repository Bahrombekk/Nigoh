"""7-migratsiya: viloyat chegaralari OpenStreetMap'dan (aniq).

Avvalgi `data/uz_regions.geojson` past aniqlikda edi (masalan Samarqand —
202 nuqta): chegara xaritadagi haqiqiy chegaradan 10 km gacha (Orol
tomonda 120 km gacha) farq qilardi va koordinatadan hududni aniqlash
(`areas.id_for_point`) chegaraga yaqin kameralarda adashardi. Yangi fayl
`scripts/build_boundaries.py` bilan OSM'dan qurilgan (docs/BOUNDARIES.md):
~25 ming nuqta, OSM'dan farqi <= 12 m, qo'shni viloyatlar umumiy chegarasi
bir xil nuqtalardan iborat.

Faqat `admin_areas.boundary` (level = 'region') yangilanadi — nom bo'yicha.
Kameralarning `admin_area_id` si O'ZGARMAYDI: kamera hududi bazada qanday
yozilgan bo'lsa shunday qoladi (masalan Jizzax–Sirdaryo chegarasidagi
temir yo'l ustidagi "26/5 km" kameralari Jizzaxda qoladi). Yangi chegara
faqat hududi ko'rsatilmagan yangi kameralar uchun ishlatiladi.

Tarkibi:
    VERSION = 7
    apply(db)

Jadvallar: admin_areas (boundary)
Kim ishlatadi: database/migrations/__init__.py (load) -> database/schema.py.
"""
import json
from pathlib import Path

VERSION = 7

REGIONS_GEOJSON = Path(__file__).resolve().parent.parent / "data" / "uz_regions.geojson"


def apply(db) -> None:
    if not REGIONS_GEOJSON.exists():
        return
    data = json.loads(REGIONS_GEOJSON.read_text(encoding="utf-8"))
    for feature in data["features"]:
        db.execute(
            "UPDATE admin_areas SET boundary = %s "
            "WHERE level = 'region' AND lower(name) = lower(%s)",
            (json.dumps(feature["geometry"]), feature["properties"]["name"]))
