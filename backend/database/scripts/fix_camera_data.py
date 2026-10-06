"""Kameralar ma'lumotidagi kamchiliklarni tuzatish (2026-10-06 tahlili).

    python database/scripts/fix_camera_data.py           # faqat ko'rsatadi
    python database/scripts/fix_camera_data.py --apply   # bazaga yozadi

Takror yuritish xavfsiz: tuzatilgan yozuv qayta tanlanmaydi. Har o'zgarish
kamera izohiga (`note`) yoziladi — nima va nega o'zgargani yozuvda qoladi.

Topilgan kamchiliklar va sabablari:

  1. Kodek (21) / model (40) yo'q. Ular faqat kamera qo'shilgan lahzada
     so'ralardi; o'sha paytda kamera javob bermagan bo'lsa (VPN o'chiq,
     kamera qayta yuklanayotgan) maydon abadiy bo'sh qolardi. Ko'pchiligi
     hozir javob beradi. Endi `camera/monitoring/passport.py` fonda qayta urinadi.
  2. Ishlab chiqaruvchi xato. Import RTSP yo'lidan taxmin qilgan
     (`/cam/realmonitor` -> dahua). Holowits kamera (3400/2 km (2)) dahua deb
     yozilgan va dahua yo'li bilan — videosi hech qachon ochilmagan.
     Model bo'yicha ishlab chiqaruvchi tuzatiladi; yo'l faqat yangi yo'l
     haqiqatan video bersa almashtiriladi.
  3. Koordinata va hudud yo'q (14). Excel'da koordinata bo'lmagan (6) va
     NVR kanallari (8) — hudud faqat koordinatadan aniqlanardi. Egizak
     kamera (bitta piketdagi "(2)") koordinatasi olinadi; qolganlariga hudud
     qo'shni km'lardan. Endi API ham shunday qiladi.
  4. "3606/8/10 km" — nom o'qilmagan, kamera km'siz qolgan. Koordinatasi
     3606/9 dan ~270 m g'arbda (km o'sgan sari g'arbga) -> 3606/10.
     Endi API bunday nomni 422 bilan rad etadi.

Kod bilan tuzatib bo'lmaydiganlar (oxirida ro'yxat chiqadi): hech qachon
javob bermagan kameralar (IP yoki kamera nosoz), noto'g'ri parol,
koordinatasi umuman noma'lum kameralar.

--apply bilan avval init_db() (0003: probe_at / probe_error ustunlari),
oxirida "oldin -> keyin" sifat hisoboti (reports.data_quality) chiqadi.

Tarkibi:
    main()                      qadamlar 1, 1b, 2, 3, 4 va natija hisoboti
    plan_vendor(db)             model bo'yicha ishlab chiqaruvchi xato kameralar
                                (+ yangi yo'l, agar u haqiqatan video bersa)
    plan_path(db)               kodeki yo'q kamera: joriy yo'lda video yo'q, standart yo'lda bor
    plan_location(db)           koordinatasiz kameralar: egizakdan koordinata
                                yoki qo'shni km'lardan hudud
    _quality()                  sifat hisoboti (0003 qo'llanmagan bo'lsa — bo'sh)
    EXPLICIT                    dalil bilan aniqlangan alohida tuzatishlar ("3606/8/10 km")
    DEFAULT_PATH                ishlab chiqaruvchi -> standart RTSP yo'li (app.config.VENDORS)
    TWIN                        egizak kamera nomi: "... (2)"

Ishlatadi: app.config (VENDORS), camera.monitoring.passport (run_once),
camera.probe.rtsp_probe (probe), core.security (decrypt),
database (cameras, rail, reports, get_db, init_db)
Kim ishlatadi: faqat qo'lda (tests/test_camera_data.py u tayangan repozitoriy
metodlarini — fix_record, set_vendor, data_quality — alohida tekshiradi).
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

# .env (DATABASE_URL) boshqa modullardan OLDIN yuklansin.
from core import env  # noqa: E402,F401

# isort: split
from psycopg.errors import UndefinedColumn  # noqa: E402

from app.config import VENDORS  # noqa: E402
from camera.monitoring import passport  # noqa: E402
from camera.probe.rtsp_probe import probe  # noqa: E402
from core import security  # noqa: E402
from database import cameras, get_db, init_db, rail, reports  # noqa: E402

DEFAULT_PATH = {v["id"]: v["path"] for v in VENDORS}
DEFAULT_PATH.setdefault("holowits", "/LiveMedia/ch1/Media1")
TWIN = re.compile(r"^(.*\S)\s*\(\d+\)\s*$")

# Dalil bilan aniqlangan, umumiy qoidaga sig'maydigan tuzatishlar.
EXPLICIT = {
    # (eski nom) -> (yangi nom, km, piket, sabab)
    "3606/8/10 km": ("3606/10 km", 3606, 10,
                     "nom '3606/8/10 km' edi; koordinata 3606/9 dan ~270 m g'arbda -> 3606/10"),
}


def plan_vendor(db) -> list[tuple]:
    out = []
    for r in cameras.list_rtsp(db, enabled_only=False):
        expected = cameras.vendor_for_model(r["model"])
        if not expected or expected == r["vendor"]:
            continue
        password = security.decrypt(r["password_enc"])
        current = probe(r["ip"], r["port"] or 554, r["rtsp_path"] or "", r["username"] or "",
                        password)
        new_path = None
        if not current.get("ok") and current.get("stage") == "oqim":
            path = DEFAULT_PATH.get(expected)
            if path and probe(r["ip"], r["port"] or 554, path, r["username"] or "",
                              password).get("ok"):
                new_path = path
        out.append((r, expected, new_path, current))
    return out


def plan_path(db) -> list[tuple]:
    """Kodeki yo'q kamera: joriy yo'lda video yo'q, ishlab chiqaruvchining
    standart yo'lida bor -> (qator, yangi yo'l). Kamera o'sha lahzada
    tarmoqda bo'lmasa tanlanmaydi — keyingi yurishda qayta tekshiriladi."""
    out = []
    for r in cameras.list_rtsp(db, enabled_only=True):
        path = DEFAULT_PATH.get(r["vendor"])
        if r["codec"] is not None or not path or path == r["rtsp_path"]:
            continue
        password = security.decrypt(r["password_enc"])
        args = (r["ip"], r["port"] or 554)
        login = (r["username"] or "", password)
        if probe(*args, r["rtsp_path"] or "", *login).get("stage") != "oqim":
            continue
        if probe(*args, path, *login).get("ok"):
            out.append((r, path))
    return out


def plan_location(db) -> list[tuple]:
    """(qator, lat, lng, hudud, izoh) — koordinatasiz kameralar uchun."""
    rows = db.execute("SELECT * FROM camera_details ORDER BY id").fetchall()
    by_pos = {}
    for r in rows:
        if r["km"] is not None and r["lat"] is not None:
            by_pos.setdefault((r["rail_line_id"], r["km"], r["picket"]), r)
    out = []
    for r in rows:
        if r["lat"] is not None:
            continue
        twin = by_pos.get((r["rail_line_id"], r["km"], r["picket"])) if TWIN.match(r["name"]) else None
        if twin is not None:
            out.append((r, twin["lat"], twin["lng"], twin["admin_area_id"],
                        f"koordinata egizak kameradan: {twin['name']} (id {twin['id']})"))
        elif r["admin_area_id"] is None:
            area = rail.area_for_km(db, r["rail_line_id"], r["km"])
            if area is not None:
                out.append((r, None, None, area, "hudud qo'shni km kameralaridan"))
    return out


def _quality() -> dict:
    """Sifat hisoboti; 0003 migratsiyasi hali qo'llanmagan bo'lsa (ko'rish
    rejimi) — bo'sh."""
    try:
        with get_db() as db:
            return reports.data_quality(db, None)
    except UndefinedColumn:
        return {}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="bazaga yozish")
    args = ap.parse_args()
    mode = "YOZILADI" if args.apply else "ko'rish (--apply bilan yoziladi)"
    print(f"== Kamera ma'lumotlarini tuzatish — {mode}\n")

    if args.apply:
        init_db()                       # 0003: probe_at / probe_error ustunlari

    before = {k: len(v) for k, v in _quality().items()}
    with get_db() as db:
        line = rail.default_line_id(db)

        print("-- 1. Ishlab chiqaruvchi modelga mos emas")
        for r, vendor, path, cur in plan_vendor(db):
            what = f"vendor {r['vendor']} -> {vendor}"
            if path:
                what += f", yo'l -> {path} (eski yo'lda video yo'q, yangisida bor)"
            elif not cur.get("ok"):
                what += f" (yo'l o'zgarmaydi: {cur.get('stage')}: {cur.get('message', '')[:50]})"
            print(f"   {r['id']:>4} {r['name']:<20} {r['model']}: {what}")
            if args.apply:
                cameras.set_vendor(db, r["id"], vendor)
                cameras.fix_record(db, r["id"], rtsp_path=path,
                                   note=f"Tuzatildi 2026-10-06: {what}")

        print("-- 1b. RTSP yo'lida video yo'q, standart yo'lda bor")
        for r, path in plan_path(db):
            what = f"yo'l {r['rtsp_path']} -> {path} (eski yo'lda video yo'q, yangisida bor)"
            print(f"   {r['id']:>4} {r['name']:<20} {what}")
            if args.apply:
                cameras.fix_record(db, r["id"], rtsp_path=path,
                                   note=f"Tuzatildi 2026-10-06: {what}")

        print("-- 2. Nomdagi km o'qilmagan")
        for r in db.execute("SELECT * FROM camera_details WHERE name = ANY(%s)",
                            (list(EXPLICIT),)).fetchall():
            name, km, picket, why = EXPLICIT[r["name"]]
            print(f"   {r['id']:>4} {r['name']} -> {name} ({why})")
            if args.apply:
                cameras.fix_record(db, r["id"], name=name, rail_line_id=r["rail_line_id"] or line,
                                   km=km, picket=picket, note=f"Tuzatildi 2026-10-06: {why}")

        print("-- 3. Koordinata / hudud")
        for r, lat, lng, area, why in plan_location(db):
            print(f"   {r['id']:>4} {r['name']:<20} {why}")
            if args.apply:
                cameras.fix_record(db, r["id"], lat=lat, lng=lng, admin_area_id=area,
                                   note=f"Tuzatildi 2026-10-06: {why}")

    print("-- 4. Kodek / model qayta tekshiruvi (barcha bo'sh kameralar)")
    if args.apply:
        results = passport.run_once(limit=1000, only_online=False)
        filled = sum(1 for x in results if x["codec"] or x["model"])
        print(f"   tekshirildi {len(results)}, to'ldirildi {filled}, "
              f"xato {sum(1 for x in results if x['error'])}")
    else:
        print("   --apply bilan yuritiladi")

    after = _quality()
    print("\n-- Natija (oldin -> keyin)")
    for k, v in after.items():
        print(f"   {k:<17} {before.get(k, '-'):>4} -> {len(v)}")
    print("\n-- Qo'lda hal qilinadiganlar")
    for key, title in (("never_seen", "hech qachon javob bermagan (IP/kamera nosoz)"),
                       ("probe_failed", "tekshiruv xatosi"),
                       ("no_location", "koordinata noma'lum")):
        for i in after.get(key, []):
            print(f"   [{title}] {i['id']:>4} {i['name']:<20} {i.get('detail') or ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
