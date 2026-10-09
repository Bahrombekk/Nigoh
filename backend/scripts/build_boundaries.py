"""Viloyat va davlat chegaralari: OpenStreetMap relation'laridan GeoJSON.

Muammo (2026-10-08): eski `uz_regions.geojson` juda dag'al edi (Samarqand —
202 nuqta, 4 xona) — xaritadagi uzuq ko'k chiziq plitkadagi haqiqiy
chegaradan yuzlab metr, ba'zan kilometrlab chetda yurardi.

Yechim: geometriya OSM'dan (xarita plitkalari ham OSM — chiziq plitkadagi
chegaraga aniq tushadi), `fetch_osm_boundaries.py` yuklagan xom JSON'dan.

Qadamlar:
  1. Relation a'zolari (outer/inner rollari) va yo'llar o'qiladi. Viloyat
     relation'lari ISO3166-2 kodi bo'yicha loyihadagi nomlarga moslanadi
     (`NAMES` — bu nomlar bazadagi kamera hududlari va frontend bilan bir xil
     bo'lishi SHART).
  2. Topologiyani saqlab soddalashtirish: yo'llar "tugun"larda bo'linadi
     (yo'l uchlari va bir nechta yo'lda uchraydigan nuqtalar — hech qachon
     o'chirilmaydi), har bo'lak Duglas–Pekker bilan (`TOLERANCE_M`) BIR
     MARTA soddalashtiriladi (kalit — tugun id'lari, yo'nalish
     kanoniklashtiriladi). Qo'shni viloyatlar umumiy chegarani aynan bir xil
     nuqtalar bilan oladi — oraliq/ustma-ust tushish (sliver) bo'lmaydi.
  3. Har relation outer va inner yo'llari uch tugunlari bo'yicha yopiq
     halqalarga yig'iladi (yo'nalish farqi, ko'p bo'lakli multipolygon,
     eksklavlar — So'x, Shohimardon — outer roli bilan; qo'shni davlat
     anklavlari — inner roli bilan teshik). Inner halqa uni o'z ichiga olgan
     outer'ga biriktiriladi. Outer — soat strelkasiga teskari, inner — soat
     strelkasi bo'yicha (RFC 7946).
  4. Koordinatalar 6 xonagacha yaxlitlanadi (~0,1 m).

Natija: `frontend/public/assets/uz_regions.geojson` (properties: name) va
`frontend/public/assets/uz.geojson` (properties: shapeName, shapeISO, shapeType,
source). Ma'lumot © OpenStreetMap contributors (ODbL).

Ishlatish:
    python backend/scripts/fetch_osm_boundaries.py            # bir marta
    python backend/scripts/build_boundaries.py [osm.json]
"""
from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OSM = ROOT / "osm_boundaries.json"
ASSETS = ROOT / "frontend" / "public" / "assets"
DST_REGIONS = ASSETS / "uz_regions.geojson"
DST_COUNTRY = ASSETS / "uz.geojson"

UZ_RELATION = 196240
TOLERANCE_M = 12.0
DIGITS = 6

# ISO3166-2 -> loyihadagi nom (tartib — eski fayldagidek). O'ZGARTIRMANG:
# bazadagi kamera hududlari, admin_areas va frontend (camera-form.js
# regionAt, map.js regionByName) shu nomlar bilan ishlaydi.
NAMES = {
    "UZ-AN": "Andijon",
    "UZ-NG": "Namangan",
    "UZ-FA": "Farg'ona",
    "UZ-QR": "Qoraqalpog'iston",
    "UZ-XO": "Xorazm",
    "UZ-NW": "Navoiy",
    "UZ-SU": "Surxondaryo",
    "UZ-SA": "Samarqand",
    "UZ-TO": "Toshkent viloyati",
    "UZ-SI": "Sirdaryo",
    "UZ-JI": "Jizzax",
    "UZ-BU": "Buxoro",
    "UZ-QA": "Qashqadaryo",
    "UZ-TK": "Toshkent shahri",
}

M_PER_DEG_LAT = 110_574.0
M_PER_DEG_LON = 111_320.0 * math.cos(math.radians(41.0))


# ---------- soddalashtirish ----------

def _seg_dist2(p, a, b) -> float:
    """p nuqtadan [a, b] kesmagacha masofa kvadrati (m², tekis yaqinlashuv)."""
    px, py = p[0] * M_PER_DEG_LON, p[1] * M_PER_DEG_LAT
    ax, ay = a[0] * M_PER_DEG_LON, a[1] * M_PER_DEG_LAT
    bx, by = b[0] * M_PER_DEG_LON, b[1] * M_PER_DEG_LAT
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0.0 if L == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L))
    qx, qy = ax + t * dx - px, ay + t * dy - py
    return qx * qx + qy * qy


def douglas_peucker(pts: list, tol_m: float) -> list:
    """Uchlari saqlanadigan Duglas–Pekker (iterativ). Yopiq bo'lak (bosh = oxir)
    avval boshdan eng uzoq nuqtada ikkiga bo'linadi."""
    n = len(pts)
    if n <= 2:
        return list(pts)
    if pts[0] == pts[-1]:
        far = max(range(1, n - 1), key=lambda i: _seg_dist2(pts[i], pts[0], pts[0]))
        a = douglas_peucker(pts[:far + 1], tol_m)
        b = douglas_peucker(pts[far:], tol_m)
        return a[:-1] + b
    tol2 = tol_m * tol_m
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        best, idx = -1.0, -1
        for k in range(i + 1, j):
            d = _seg_dist2(pts[k], pts[i], pts[j])
            if d > best:
                best, idx = d, k
        if idx >= 0 and best > tol2:
            keep[idx] = True
            stack.append((i, idx))
            stack.append((idx, j))
    return [p for p, k in zip(pts, keep) if k]


class Simplifier:
    """Yo'llarni tugunlarda bo'lib, har bo'lakni bir marta soddalashtiradi."""

    def __init__(self, ways: dict[int, dict], tol_m: float):
        self.ways = ways
        self.tol = tol_m
        use = defaultdict(int)
        for w in ways.values():
            for nid in set(w["nodes"]):
                use[nid] += 1
        self.fixed = {nid for nid, c in use.items() if c > 1}
        for w in ways.values():
            self.fixed.add(w["nodes"][0])
            self.fixed.add(w["nodes"][-1])
        self.cache: dict[tuple, list] = {}
        self._way_cache: dict[int, tuple[list, list]] = {}

    def _piece(self, nids: list, coords: list) -> list:
        key = tuple(nids)
        rev = key[::-1]
        if rev < key:                                  # kanonik yo'nalish
            return self._piece(list(rev), coords[::-1])[::-1]
        if key not in self.cache:
            self.cache[key] = douglas_peucker(coords, self.tol)
        return self.cache[key]

    def way(self, wid: int) -> tuple[list, list]:
        """Soddalashtirilgan yo'l: (nuqtalar, boshlang'ich/oxirgi tugun id)."""
        if wid not in self._way_cache:
            w = self.ways[wid]
            nids, coords = w["nodes"], w["coords"]
            out = [coords[0]]
            start = 0
            for i in range(1, len(nids)):
                if nids[i] in self.fixed or i == len(nids) - 1:
                    out.extend(self._piece(nids[start:i + 1], coords[start:i + 1])[1:])
                    start = i
            self._way_cache[wid] = (out, [nids[0], nids[-1]])
        return self._way_cache[wid]


# ---------- halqalarni yig'ish ----------

def build_rings(way_ids: list[int], simp: Simplifier, label: str) -> list[list]:
    """Yo'llarni uch tugunlari bo'yicha yopiq halqalarga ulaydi."""
    segs = []
    for wid in way_ids:
        pts, (a, b) = simp.way(wid)
        segs.append([a, b, pts])
    by_end = defaultdict(list)
    for i, (a, b, _) in enumerate(segs):
        by_end[a].append(i)
        by_end[b].append(i)
    used = [False] * len(segs)
    rings = []
    for i, (a, b, pts) in enumerate(segs):
        if used[i]:
            continue
        used[i] = True
        start, cur, ring = a, b, list(pts)
        while cur != start:
            nxt = next((j for j in by_end[cur] if not used[j]), None)
            if nxt is None:
                raise SystemExit(f"{label}: halqa yopilmadi (tugun {cur})")
            used[nxt] = True
            ja, jb, jpts = segs[nxt]
            if ja == cur:
                ring.extend(jpts[1:])
                cur = jb
            else:
                ring.extend(jpts[::-1][1:])
                cur = ja
        if len(ring) >= 4:
            rings.append(ring)
    return rings


def signed_area(ring: list) -> float:
    return sum(ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
               for i in range(len(ring) - 1)) / 2


def point_in_ring(x: float, y: float, ring: list) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def relation_geometry(rel: dict, simp: Simplifier) -> dict:
    label = rel["tags"].get("name", rel["id"])
    role_ways = defaultdict(list)
    for m in rel["members"]:
        if m["type"] == "way" and m["ref"] in simp.ways:
            role_ways["inner" if m["role"] == "inner" else "outer"].append(m["ref"])
    outers = build_rings(role_ways["outer"], simp, f"{label} outer")
    inners = build_rings(role_ways["inner"], simp, f"{label} inner")
    outers = [r if signed_area(r) > 0 else r[::-1] for r in outers]
    inners = [r if signed_area(r) < 0 else r[::-1] for r in inners]
    outers.sort(key=lambda r: -abs(signed_area(r)))
    polys = [[o] for o in outers]
    for inner in inners:
        # Inner halqaning tugunda bo'lmagan nuqtasi (chegarada yotmasin)
        x, y = inner[len(inner) // 2]
        host = [p for p in polys if point_in_ring(x, y, p[0])]
        if not host:
            raise SystemExit(f"{label}: inner halqa hech bir outer ichida emas")
        min(host, key=lambda p: abs(signed_area(p[0]))).append(inner)
    rnd = lambda ring: [[round(x, DIGITS), round(y, DIGITS)] for x, y in ring]  # noqa: E731
    polys = [[rnd(r) for r in p] for p in polys]
    if len(polys) == 1:
        return {"type": "Polygon", "coordinates": polys[0]}
    return {"type": "MultiPolygon", "coordinates": polys}


def count_points(geom: dict) -> int:
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    return sum(len(r) for p in polys for r in p)


def dump(path: Path, features: list) -> None:
    text = json.dumps({"type": "FeatureCollection", "features": features},
                      ensure_ascii=False, separators=(",", ":"))
    path.write_text(text, encoding="utf-8")
    print(f"  -> {path.relative_to(ROOT)}: {len(text.encode()) / 1e3:.0f} KB")


def main(src: Path) -> None:
    raw = json.loads(src.read_text(encoding="utf-8"))
    stamp = (raw.get("osm3s") or {}).get("timestamp_osm_base", "")[:10]
    rels = {e["id"]: e for e in raw["elements"] if e["type"] == "relation"}
    ways = {e["id"]: {"nodes": e["nodes"],
                      "coords": [(g["lon"], g["lat"]) for g in e["geometry"]]}
            for e in raw["elements"] if e["type"] == "way"}
    if UZ_RELATION not in rels:
        raise SystemExit(f"{src}: {UZ_RELATION} relation'i yo'q")

    by_iso = {}
    for r in rels.values():
        iso = r["tags"].get("ISO3166-2", "")
        if iso in NAMES:
            by_iso[iso] = r
    missing = [iso for iso in NAMES if iso not in by_iso]
    if missing:
        raise SystemExit(f"Topilmagan viloyatlar: {missing}")

    # Faqat kerakli relation'lar yo'llari — tugunlar ular bo'yicha aniqlanadi
    needed = {m["ref"] for r in [rels[UZ_RELATION], *by_iso.values()]
              for m in r["members"] if m["type"] == "way"}
    simp = Simplifier({w: ways[w] for w in needed if w in ways}, TOLERANCE_M)
    raw_pts = sum(len(ways[w]["coords"]) for w in simp.ways)
    print(f"OSM ({stamp}): {len(simp.ways)} yo'l, {raw_pts} nuqta, "
          f"{len(simp.fixed)} tugun; tolerans {TOLERANCE_M} m")

    features = []
    for iso, name in NAMES.items():
        geom = relation_geometry(by_iso[iso], simp)
        features.append({"type": "Feature", "properties": {"name": name}, "geometry": geom})
        n = 1 if geom["type"] == "Polygon" else len(geom["coordinates"])
        print(f"  {name:20s} {geom['type']:12s} {n} qism, {count_points(geom)} nuqta")
    dump(DST_REGIONS, features)

    geom = relation_geometry(rels[UZ_RELATION], simp)
    print(f"  O'zbekiston          {geom['type']:12s} "
          f"{len(geom['coordinates'])} qism, {count_points(geom)} nuqta")
    dump(DST_COUNTRY, [{"type": "Feature", "properties": {
        "shapeName": "Uzbekistan", "shapeISO": "UZB", "shapeType": "ADM0",
        "source": f"OpenStreetMap relation {UZ_RELATION} ({stamp}), "
                  f"© OpenStreetMap contributors, ODbL"}, "geometry": geom}])


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else OSM)
