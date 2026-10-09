"""OpenStreetMap'dan O'zbekiston va viloyatlar chegaralarini yuklab olish (Overpass API).

Natija — xom JSON: O'zbekiston relation'i (196240, admin_level=2) va uning
ichidagi barcha viloyat relation'lari (12 viloyat, Qoraqalpog'iston, Toshkent
shahri) a'zolari bilan (`out body`, outer/inner rollari), so'ng ularning
barcha a'zo yo'llari geometriyasi (`out geom`) — umumiy chegara yo'li bir
marta keladi. Hajmi ~3 MB. Loyihaga qo'shilmaydi — `build_boundaries.py`
shundan `frontend/public/assets/uz_regions.geojson` va `frontend/public/assets/uz.geojson`
yasaydi.

Ma'lumot © OpenStreetMap contributors (ODbL). Xarita plitkalari ham OSM
asosida, shuning uchun chegara chiziqlari plitkadagi chegaraga aniq tushadi.

Ishlatish:
    python backend/scripts/fetch_osm_boundaries.py [natija.json]
"""
from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_OUT = Path(__file__).resolve().parents[2] / "osm_boundaries.json"
UZ_RELATION = 196240
# Viloyatlar ikki yo'l bilan olinadi (birlashmasi): 196240 ning a'zo
# relation'lari (subarea, teg filtrisiz) va hudud ichidagi admin_level=4
# relation'lar — Qoraqalpog'iston (196241) area so'rovida chiqmaydi.
QUERY = f"""[out:json][timeout:600];
rel({UZ_RELATION})->.uz;
rel(r.uz:"subarea")->.sub;
area["ISO3166-1"="UZ"][admin_level=2]->.uza;
rel(area.uza)["boundary"="administrative"]["admin_level"="4"]["ISO3166-2"~"^UZ-"]->.inarea;
(.uz; .sub; .inarea;)->.all;
.all out body;
way(r.all);
out geom;"""
MIRRORS = ["https://overpass-api.de/api/interpreter",
           "https://overpass.kumi.systems/api/interpreter",
           "https://overpass.private.coffee/api/interpreter"]


def fetch(out: Path, rounds: int = 3) -> int:
    for attempt in range(rounds):
        if attempt:
            print("60 s kutib, qayta urinish...")
            time.sleep(60)
        count = _try_mirrors(out)
        if count:
            return count
    raise SystemExit("Hech bir Overpass ko'zgusi javob bermadi")


def _try_mirrors(out: Path) -> int:
    for url in MIRRORS:
        try:
            t0 = time.time()
            req = urllib.request.Request(
                url, data=urllib.parse.urlencode({"data": QUERY}).encode(),
                headers={"User-Agent": "nigoh-railway-build/1.0 (admin tool)"})
            with urllib.request.urlopen(req, timeout=700) as resp:
                data = resp.read()
            elements = json.loads(data).get("elements", [])
            if not any(e.get("id") == UZ_RELATION for e in elements):
                raise ValueError(f"javobda {UZ_RELATION} relation'i yo'q")
            out.write_bytes(data)
            print(f"OK {url}: {len(data) / 1e6:.1f} MB, {len(elements)} element, "
                  f"{time.time() - t0:.0f} s -> {out}")
            return len(elements)
        except Exception as exc:                       # keyingi ko'zgu
            print(f"XATO {url}: {type(exc).__name__}: {str(exc)[:120]}")
    return 0


if __name__ == "__main__":
    fetch(Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT)
