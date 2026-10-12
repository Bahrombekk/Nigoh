#!/usr/bin/env python3
"""Mahalliy (internetsiz) xarita: O'zbekiston OSM plitkalarini bitta PMTiles faylga olish.

Xarita "Mahalliy" rejimida plitkalarni tashqi serverdan emas, Nigoh'ning o'zidan
oladi (`/tiles/uz.pmtiles`, DATA_DIR/tiles). Fayl Protomaps'ning kunlik OSM
yig'masidan (build.protomaps.com, ODbL) KESIB olinadi — butun dunyo emas, faqat
O'zbekiston va qo'shnilarning chekkasi; `pmtiles extract` faqat kerakli
bo'laklarni HTTP Range bilan yuklaydi (~680 MB, 0-15 masshtab — binolar bilan).

Nega tile.openstreetmap.org'dan yuklab olinmaydi: OSM plitka serverining
foydalanish qoidasi ommaviy yuklab olishni (scraping) taqiqlaydi.

Talab: `pmtiles` CLI (https://github.com/protomaps/go-pmtiles/releases) PATH'da
yoki `--pmtiles` bilan yo'li berilsin.

Ishlatish (oyiga bir marta yetarli):
    python backend/scripts/fetch_map_tiles.py                     # bugungi yig'ma
    python backend/scripts/fetch_map_tiles.py --date 20261012 --out data/tiles/uz.pmtiles

Yangi fayl avval vaqtinchalik nom bilan yoziladi va tayyor bo'lgach eskisining
o'rniga qo'yiladi — yuklash paytida xarita ishlab turaveradi.
"""
import argparse
import datetime as dt
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUILDS = "https://build.protomaps.com/{date}.pmtiles"
# O'zbekiston + chekka (qo'shnilar xira fon bo'lib ko'rinadi)
BBOX = "55.5,36.8,73.8,46.0"
MAXZOOM = 15


def latest_build(days: int = 10) -> str:
    """Oxirgi mavjud kunlik yig'ma (YYYYMMDD) — bugundan orqaga qarab."""
    today = dt.date.today()
    for i in range(days):
        d = (today - dt.timedelta(days=i)).strftime("%Y%m%d")
        req = urllib.request.Request(BUILDS.format(date=d), method="HEAD")
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                if r.status == 200:
                    return d
        except (urllib.error.URLError, OSError):
            continue
    raise SystemExit(f"So'nggi {days} kunda yig'ma topilmadi ({BUILDS.format(date='YYYYMMDD')})")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--date", default="", help="Yig'ma sanasi YYYYMMDD (standart: eng so'nggisi)")
    ap.add_argument("--out", default=str(ROOT / "data" / "tiles" / "uz.pmtiles"))
    ap.add_argument("--pmtiles", default=shutil.which("pmtiles") or "", help="pmtiles CLI yo'li")
    ap.add_argument("--bbox", default=BBOX)
    ap.add_argument("--maxzoom", type=int, default=MAXZOOM)
    args = ap.parse_args()

    if not args.pmtiles or not os.path.exists(args.pmtiles):
        ap.error("pmtiles CLI topilmadi — PATH'ga qo'shing yoki --pmtiles bering")
    date = args.date or latest_build()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".yangi.pmtiles")
    print(f"yig'ma {date} -> {out} (bbox {args.bbox}, 0-{args.maxzoom})")
    subprocess.run([args.pmtiles, "extract", BUILDS.format(date=date), str(tmp),
                    f"--bbox={args.bbox}", f"--maxzoom={args.maxzoom}",
                    "--download-threads=8"], check=True)
    os.replace(tmp, out)
    print(f"Tayyor: {out} ({out.stat().st_size / 1e6:.0f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
