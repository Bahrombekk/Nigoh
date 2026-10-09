"""OpenStreetMap'dan O'zbekiston temir yo'llarini yuklab olish (Overpass API).

Natija — xom JSON (`out geom`): har yo'l `railway=rail` (va qurilayotgan
temir yo'l) uchun geometriya va teglar (usage, service, electrified,
maxspeed, bridge, tunnel, name ...). Hajmi ~10 MB, ~13 ming yo'l, ~100 ming
nuqta. Loyihaga qo'shilmaydi — `build_railways_v2.py` shundan
`frontend/public/assets/railways-v2.geojson` yasaydi.

Ma'lumot © OpenStreetMap contributors (ODbL). Xarita plitkalari ham OSM
asosida, shuning uchun chiziqlar xaritadagi yo'lga aniq tushadi.

Ishlatish:
    python backend/scripts/fetch_osm_railways.py [natija.json]
"""
from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_OUT = Path(__file__).resolve().parents[2] / "osm_rail.json"
QUERY = """[out:json][timeout:600];
area["ISO3166-1"="UZ"][admin_level=2]->.uz;
(
  way["railway"="rail"](area.uz);
  way["railway"="construction"]["construction"="rail"](area.uz);
);
out geom tags;"""
MIRRORS = ["https://overpass-api.de/api/interpreter",
           "https://overpass.kumi.systems/api/interpreter",
           "https://overpass.private.coffee/api/interpreter"]


def fetch(out: Path) -> int:
    for url in MIRRORS:
        try:
            t0 = time.time()
            req = urllib.request.Request(
                url, data=urllib.parse.urlencode({"data": QUERY}).encode(),
                headers={"User-Agent": "nigoh-railway-build/1.0 (admin tool)"})
            with urllib.request.urlopen(req, timeout=700) as resp:
                data = resp.read()
            count = len(json.loads(data).get("elements", []))
            out.write_bytes(data)
            print(f"OK {url}: {len(data) / 1e6:.1f} MB, {count} yo'l, {time.time() - t0:.0f} s -> {out}")
            return count
        except Exception as exc:                       # keyingi ko'zgu
            print(f"XATO {url}: {type(exc).__name__}: {str(exc)[:120]}")
    raise SystemExit("Hech bir Overpass ko'zgusi javob bermadi")


if __name__ == "__main__":
    fetch(Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT)
