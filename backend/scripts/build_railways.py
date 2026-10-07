"""Temir yo'l chiziqlarini xarita uchun tayyorlash: railway-lines.json -> frontend/assets/railways.geojson.

Manba (railway-lines.json, loyiha ildizida): 8165 ta LineString, 70 mingga
yaqin nuqta, har birida `color` — temir yo'lning hududiy bo'linmasi (MTU).
Brauzerda 8 mingta alohida chiziq xaritani sekinlashtiradi, shuning uchun:

  * bir xil rangdagi chiziqlar bitta MultiLineString'ga birlashtiriladi
    (7 ta obyekt);
  * nuqtalar Douglas–Peucker bilan soddalashtiriladi (TOLERANCE ≈ 4 m —
    eng yaqin masshtabda ham farq ko'rinmaydi) va 5 xona aniqlikda yoziladi;
  * har bo'linmaga nom va uzunlik (km) qo'shiladi;
  * uzoq ko'rinish uchun alohida geometriya (`lod: "overview"`): bo'laklar
    uzluksiz yo'llarga birlashtiriladi, stansiya yo'llari va mayda tarmoqlar
    olib tashlanadi, kuchli silliqlanadi — mamlakat masshtabida toza chiziq.
    Yaqin ko'rinish — `lod: "detail"` (to'liq).

Rang -> bo'linma: chiziqlar joylashuvi bo'yicha aniqlangan (2026-10-07):
darkred Toshkent–Sirdaryo–Jizzax, black Navoiy–Buxoro, brown
Qoraqalpog'iston, red Farg'ona vodiysi, orange Qashqadaryo, grey
Surxondaryo. Nomlar taxminiy — kerak bo'lsa BRANCHES da tuzatiladi.

Ishlatish:
    python backend/scripts/build_railways.py [manba.json] [natija.geojson]
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "railway-lines.json"
DST = ROOT / "frontend" / "assets" / "railways.geojson"
TOLERANCE = 0.00004            # daraja ≈ 4 m (yaqin ko'rinish)
# Uzoq ko'rinish (z < 10): silliq va toza. ~90 m dan mayda egrilik, 0,5 km dan
# qisqa bo'lak (stansiya yo'llari) va 3 km dan kichik alohida tarmoq (sanoat
# tarmoqlari) chizilmaydi.
OVERVIEW_TOLERANCE = 0.0009
OVERVIEW_MIN_PART_KM = 0.5
OVERVIEW_MIN_NETWORK_KM = 3.0

# Manbadagi rang -> (kalit, nom). Tartib — xarita afsonasidagi tartib.
BRANCHES = {
    "darkred": ("toshkent", "Toshkent MTU"),
    "black": ("buxoro", "Buxoro MTU"),
    "red": ("qoqon", "Qo'qon MTU"),
    "orange": ("qarshi", "Qarshi MTU"),
    "grey": ("termiz", "Termiz MTU"),
    "brown": ("qongirot", "Qo'ng'irot MTU"),
    "green": ("boshqa", "Boshqa"),
}


def _perp(p, a, b) -> float:
    """p nuqtadan a–b kesmagacha masofa (daraja, kenglikka tuzatilgan)."""
    k = math.cos(math.radians(p[1]))
    px, py, ax, ay, bx, by = p[0] * k, p[1], a[0] * k, a[1], b[0] * k, b[1]
    dx, dy = bx - ax, by - ay
    if dx == dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def simplify(points: list, tol: float) -> list:
    """Douglas–Peucker (takrorlanuvchi, chuqur rekursiyasiz)."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i, j = stack.pop()
        best, idx = 0.0, -1
        for k in range(i + 1, j):
            d = _perp(points[k], points[i], points[j])
            if d > best:
                best, idx = d, k
        if best > tol:
            keep[idx] = True
            stack += [(i, idx), (idx, j)]
    return [p for p, k in zip(points, keep) if k]


def length_km(line: list) -> float:
    return sum(math.hypot((x2 - x1) * math.cos(math.radians(y1)) * 111.32, (y2 - y1) * 110.57)
               for (x1, y1), (x2, y2) in zip(line, line[1:]))


def merge_lines(lines: list) -> list:
    """Uchlari ulangan bo'laklarni uzluksiz chiziqlarga birlashtiradi.

    Manbada yo'l har strelkada bo'lingan (o'rtacha bo'lak 0,4 km) — uzoqdan
    chizilganda uchma-uch ulanish joylari "tishli" ko'rinadi. Faqat darajasi 2
    bo'lgan tugunlar (oddiy davomi) birlashtiriladi; tarmoqlanish joylari qoladi.
    """
    def key(p):
        return (round(p[0], 5), round(p[1], 5))
    ends: dict[tuple, list] = {}
    for i, ln in enumerate(lines):
        for end in (0, -1):
            ends.setdefault(key(ln[end]), []).append(i)
    used = [False] * len(lines)
    out = []

    def extend(chain: list, tail_key) -> None:
        while True:
            nxt = [j for j in ends.get(tail_key, []) if not used[j]]
            if len(ends.get(tail_key, [])) != 2 or len(nxt) != 1:
                return
            j = nxt[0]
            used[j] = True
            seg = lines[j] if key(lines[j][0]) == tail_key else lines[j][::-1]
            chain.extend(seg[1:])
            tail_key = key(seg[-1])

    for i, ln in enumerate(lines):
        if used[i]:
            continue
        used[i] = True
        chain = list(ln)
        extend(chain, key(chain[-1]))
        chain.reverse()
        extend(chain, key(chain[-1]))
        out.append(chain)
    return out


def components_km(lines: list) -> list[float]:
    """Har chiziq tegishli bog'langan tarmoq bo'lagining umumiy uzunligi."""
    def key(p):
        return (round(p[0], 4), round(p[1], 4))
    parent = list(range(len(lines)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    seen: dict[tuple, int] = {}
    for i, ln in enumerate(lines):
        for p in (ln[0], ln[-1]):
            k = key(p)
            if k in seen:
                parent[find(i)] = find(seen[k])
            else:
                seen[k] = i
    total: dict[int, float] = {}
    for i, ln in enumerate(lines):
        total[find(i)] = total.get(find(i), 0.0) + length_km(ln)
    return [total[find(i)] for i in range(len(lines))]


def overview(lines: list) -> list:
    """Uzoqdan ko'rinish uchun: birlashtirilgan, kuchli silliqlangan, mayda
    tarmoqlarsiz (stansiya yo'llari, kirish yo'llari, alohida sanoat tarmoqlari)."""
    merged = merge_lines(lines)
    comp = components_km(merged)
    keep = [ln for ln, c in zip(merged, comp) if c >= OVERVIEW_MIN_NETWORK_KM and length_km(ln) >= OVERVIEW_MIN_PART_KM]
    return [[[round(x, 4), round(y, 4)] for x, y in simplify(ln, OVERVIEW_TOLERANCE)] for ln in keep]


def build(src: Path, dst: Path) -> dict:
    data = json.loads(src.read_text(encoding="utf-8"))
    groups: dict[str, list] = {}
    raw: dict[str, list] = {}
    before = after = 0
    for f in data["features"]:
        geom = f.get("geometry") or {}
        if geom.get("type") != "LineString":
            continue
        color = (f.get("properties") or {}).get("color", "")
        line = geom["coordinates"]
        raw.setdefault(color, []).append(line)
        before += len(line)
        line = [[round(x, 5), round(y, 5)] for x, y in simplify(line, TOLERANCE)]
        after += len(line)
        groups.setdefault(color, []).append(line)

    order = list(BRANCHES)
    features = []
    for color in sorted(groups, key=lambda c: order.index(c) if c in order else 99):
        key, name = BRANCHES.get(color, (color, color))
        lines = groups[color]
        props = {"branch": key, "name": name, "source_color": color,
                 "km": round(sum(length_km(ln) for ln in lines))}
        ov = overview(raw[color])
        features.append({"type": "Feature", "properties": {**props, "lod": "detail", "parts": len(lines)},
                         "geometry": {"type": "MultiLineString", "coordinates": lines}})
        if ov:
            features.append({"type": "Feature", "properties": {**props, "lod": "overview", "parts": len(ov)},
                             "geometry": {"type": "MultiLineString", "coordinates": ov}})
    out = {"type": "FeatureCollection", "features": features}
    dst.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return {"nuqtalar": f"{before} -> {after}", "hajm_kb": round(dst.stat().st_size / 1024),
            "bo'linmalar": [(f["properties"]["name"], f["properties"]["lod"], f["properties"]["parts"],
                              sum(len(ln) for ln in f["geometry"]["coordinates"])) for f in features]}


if __name__ == "__main__":
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else SRC
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else DST
    print(build(src, dst))
