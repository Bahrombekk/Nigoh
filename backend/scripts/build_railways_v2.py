"""Temir yo'l tarmog'i v2: OpenStreetMap geometriyasi + bo'linma (MTU) ranglari.

Muammo (2026-10-07): railway-lines.json (8165 bo'lak, 70 ming nuqta) chala edi:
12 925 ta uchning 9 953 tasi hech narsaga ulanmagan, 2 961 ta kesma 500 m dan
uzun (egri joylar to'g'ri chiziq bilan kesilgan, eng uzuni 27 km) — chiziq
xaritadagi yo'ldan chetga chiqib, bo'shliqlar qolgan.

Yechim: haqiqiy geometriya OSM'dan (xarita plitkalari ham OSM — chiziq yo'lga
aniq tushadi), bo'linma (MTU) ranglari esa eski fayldan olinadi.

Qadamlar:
  1. OSM yo'llari (`fetch_osm_railways.py` yuklagan) o'qiladi.
  2. Bo'linma: har yo'l eski fayldagi eng yaqin rangli chiziqdan ovoz bilan
     (120 m ichida) aniqlanadi; topilmaganlariga tarmoq bo'ylab (umumiy
     uchlar) tarqatiladi, qolganlariga eng yaqin rangli yo'ldan.
  3. Toifa (kind): main — asosiy liniya; branch — tarmoq; other — teglanmagan
     jamoat yo'li; industrial — sanoat tarmog'i (spur); yard — stansiya
     yo'llari (yard/siding/crossover). Tezyurar (hs): maxspeed >= 160 yoki
     nomida "tezyurar".
  4. Bir guruhdagi (bo'linma, toifa, hs) bo'laklar uzluksiz yo'llarga ulanadi;
     1,5 m dan kichik bo'shliqlar yopiladi; OSM'dagi 15 m gacha uzilishlar
     ko'prik segmenti bilan to'ldiriladi.
  5. Ikki daraja: detail — to'liq geometriya (uzun to'g'ri kesmalarga 100 m
     dan oshmasligi uchun oraliq nuqtalar qo'shiladi); overview — faqat
     main/branch/other, birlashtirilgan, silliqlangan, mayda tarmoqlarsiz.
  6. Tekshiruv: eski fayl bilan solishtirish va kameralarning yo'lga
     masofasi (hisobot `docs/RAILWAYS.md` uchun chop etiladi).

Ishlatish:
    python backend/scripts/fetch_osm_railways.py            # bir marta
    python backend/scripts/build_railways_v2.py [osm.json] [natija.geojson]
"""
from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_railways import BRANCHES, length_km, merge_lines, simplify  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OSM = ROOT / "osm_rail.json"
OLD = ROOT / "railway-lines.json"
DST = ROOT / "frontend" / "assets" / "railways-v2.geojson"

VOTE_RADIUS_KM = 0.12          # bo'linma ovozi uchun eski chiziqqacha masofa
BRIDGE_GAP_KM = 0.015          # shundan kichik uzilishlar to'ldiriladi
DENSIFY_KM = 0.1               # detail'da kesma shundan uzun bo'lmasin
DETAIL_TOL = 0.000004          # daraja ≈ 0,45 m
OVERVIEW_TOL = 0.0006          # ≈ 65 m
OVERVIEW_MIN_NETWORK_KM = 10.0
KINDS = ("main", "branch", "other", "industrial", "yard")
OVERVIEW_KINDS = ("main", "branch", "other")
COS41 = math.cos(math.radians(41.0))


# ---------- geometriya yordamchilari (tekis yaqinlashuv, kenglikka tuzatilgan) ----------

def xy(p):
    """lon/lat -> km (O'zbekiston kengligida yetarli aniq)."""
    return p[0] * 111.32 * COS41, p[1] * 110.57


def dist_km(a, b) -> float:
    ax, ay = xy(a)
    bx, by = xy(b)
    return math.hypot(ax - bx, ay - by)


def seg_dist(p, a, b) -> float:
    px, py = xy(p)
    ax, ay = xy(a)
    bx, by = xy(b)
    dx, dy = bx - ax, by - ay
    if dx == dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


class SegmentGrid:
    """Kesmalar uchun katakli indeks: eng yaqin kesmagacha masofa so'rovi."""

    def __init__(self, cell: float = 0.005):
        self.cell = cell
        self.cells: dict[tuple[int, int], list] = defaultdict(list)

    def _c(self, v: float) -> int:
        return int(math.floor(v / self.cell))

    def add(self, a, b, owner=None) -> None:
        x0, x1 = sorted((self._c(a[0]), self._c(b[0])))
        y0, y1 = sorted((self._c(a[1]), self._c(b[1])))
        if (x1 - x0 + 1) * (y1 - y0 + 1) > 400:          # juda uzun kesma: ketma-ket bo'lib qo'shiladi
            steps = max(2, int(dist_km(a, b) / 0.4))
            pts = [(a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps) for i in range(steps + 1)]
            for p, q in zip(pts, pts[1:]):
                self.add(p, q, owner)
            return
        for cx in range(x0, x1 + 1):
            for cy in range(y0, y1 + 1):
                self.cells[(cx, cy)].append((a, b, owner))

    def nearest(self, p, max_km: float):
        """(masofa km, owner) — max_km ichida eng yaqini, aks holda (None, None)."""
        rings = max(1, int(math.ceil(max_km / (self.cell * 100.0))))
        cx, cy = self._c(p[0]), self._c(p[1])
        best, who = max_km, None
        for dx in range(-rings, rings + 1):
            for dy in range(-rings, rings + 1):
                for a, b, owner in self.cells.get((cx + dx, cy + dy), ()):
                    d = seg_dist(p, a, b)
                    if d < best:
                        best, who = d, owner
        return (best, who) if who is not None or best < max_km else (None, None)


def sample(line, step_km: float = 0.1):
    """Chiziq bo'ylab ~step_km oralig'ida nuqtalar."""
    out = [line[0]]
    carry = 0.0
    for a, b in zip(line, line[1:]):
        d = dist_km(a, b)
        pos = step_km - carry
        while pos < d:
            t = pos / d
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
            pos += step_km
        carry = (carry + d) % step_km
    out.append(line[-1])
    return out


def densify(line, max_km: float):
    out = [line[0]]
    for a, b in zip(line, line[1:]):
        d = dist_km(a, b)
        if d > max_km:
            n = int(math.ceil(d / max_km))
            out += [(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(1, n)]
        out.append(b)
    return out


def chaikin(line, rounds: int = 1):
    """Burchaklarni yumshatish (uzoq ko'rinish uchun); uchlar o'zgarmaydi."""
    for _ in range(rounds):
        if len(line) < 3:
            return line
        new = [line[0]]
        for a, b in zip(line, line[1:]):
            new.append((0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]))
            new.append((0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]))
        new.append(line[-1])
        line = new
    return line


# ---------- ma'lumot yuklash va tasniflash ----------

def load_osm(path: Path) -> list[dict]:
    ways = []
    for e in json.loads(path.read_text(encoding="utf-8"))["elements"]:
        geom = e.get("geometry") or []
        pts = [(round(g["lon"], 7), round(g["lat"], 7)) for g in geom]
        if e.get("type") == "way" and len(pts) >= 2:
            ways.append({"id": e["id"], "pts": pts, "tags": e.get("tags", {})})
    return ways


def load_old(path: Path) -> list[tuple[str, list]]:
    return [(f["properties"]["color"], [tuple(c) for c in f["geometry"]["coordinates"]])
            for f in json.loads(path.read_text(encoding="utf-8"))["features"]]


def classify(tags: dict) -> str:
    service, usage = tags.get("service"), tags.get("usage")
    if service in ("yard", "siding", "crossover"):
        return "yard"
    if service == "spur" or usage == "industrial":
        return "industrial"
    if usage == "main":
        return "main"
    if usage == "branch":
        return "branch"
    return "other"


def is_high_speed(tags: dict) -> bool:
    try:
        if float(str(tags.get("maxspeed", "0")).split()[0]) >= 160:
            return True
    except ValueError:
        pass
    return "tezyurar" in (tags.get("name") or "").lower()


def key6(p):
    return (round(p[0], 6), round(p[1], 6))


def assign_branches(ways: list[dict], old: list) -> dict:
    """Har yo'lga bo'linma (rang) beradi. Qaytaradi: statistika."""
    grid = SegmentGrid(0.005)
    for color, line in old:
        for a, b in zip(line, line[1:]):
            grid.add(a, b, color)
    votes_stat = 0
    for w in ways:
        votes: dict[str, int] = defaultdict(int)
        for p in sample(w["pts"], 0.15)[:40]:
            _, color = grid.nearest(p, VOTE_RADIUS_KM)
            if color:
                votes[color] += 1
        w["color"] = max(votes, key=votes.get) if votes else None
        votes_stat += bool(w["color"])

    # Tarmoq bo'ylab tarqatish: umumiy uchlar orqali.
    at = defaultdict(list)
    for i, w in enumerate(ways):
        at[key6(w["pts"][0])].append(i)
        at[key6(w["pts"][-1])].append(i)
    queue = [i for i, w in enumerate(ways) if w["color"]]
    seen = set(queue)
    while queue:
        nxt = []
        for i in queue:
            for end in (ways[i]["pts"][0], ways[i]["pts"][-1]):
                for j in at[key6(end)]:
                    if j not in seen and not ways[j]["color"]:
                        ways[j]["color"] = ways[i]["color"]
                        seen.add(j)
                        nxt.append(j)
        queue = nxt
    propagated = sum(1 for w in ways if w["color"]) - votes_stat

    # Qolganlar: eng yaqin rangli yo'lning rangi (kengaygan halqalar bilan).
    labeled = SegmentGrid(0.1)
    for w in ways:
        if w["color"]:
            for p in sample(w["pts"], 2.0):
                labeled.add(p, p, w["color"])
    nearest = 0
    for w in ways:
        if w["color"]:
            continue
        mid = w["pts"][len(w["pts"]) // 2]
        found = None
        for km in (10, 40, 120, 400):
            _, found = labeled.nearest(mid, km)
            if found:
                break
        w["color"] = found or "green"
        nearest += 1
    return {"ovoz": votes_stat, "tarmoq_bo'ylab": propagated, "eng_yaqin": nearest}


def tangent(line, end):
    """Chiziq uchidagi yo'nalish (ichkaridan CHETGA)."""
    a, b = (line[0], line[min(3, len(line) - 1)]) if end == 0 else (line[-1], line[max(-4, -len(line))])
    return (a[0] - b[0]) * COS41, a[1] - b[1]


def angle(u, v) -> float:
    n = math.hypot(*u) * math.hypot(*v)
    if n == 0:
        return 180.0
    return math.degrees(math.acos(max(-1.0, min(1.0, (u[0] * v[0] + u[1] * v[1]) / n))))


def faces(p, q, t_p, t_q, max_deg: float = 55.0) -> bool:
    """Ikki erkin uch bir-biriga qaragan (davomi) mi — yonma-yon tupiklar emas."""
    to_q = ((q[0] - p[0]) * COS41, q[1] - p[1])
    to_p = (-to_q[0], -to_q[1])
    return angle(t_p, to_q) <= max_deg and angle(t_q, to_p) <= max_deg


def close_gaps(lines: list, max_km: float) -> tuple[list, int]:
    """Erkin uchlar orasidagi kichik bo'shliqlarni qisqa ko'prik bilan to'ldiradi.

    Faqat bir-biriga qaragan uchlar (yo'nalishi mos) ulanadi: stansiyada
    yonma-yon tupiklar bir-biriga noto'g'ri bog'lanib qolmasin. 2 m dan
    kichik bo'shliqlarda yo'nalish tekshirilmaydi (nuqtalar deyarli ustma-ust).
    """
    ends: dict[tuple, int] = defaultdict(int)
    for ln in lines:
        ends[key6(ln[0])] += 1
        ends[key6(ln[-1])] += 1
    loose = [(i, e) for i, ln in enumerate(lines) for e in (0, -1) if ends[key6(ln[e])] == 1]
    grid = SegmentGrid(0.001)
    for i, e in loose:
        p = lines[i][e]
        grid.add(p, p, (i, e))
    bridges, used = [], set()
    for i, e in loose:
        p = lines[i][e]
        if (i, e) in used:
            continue
        best, who = None, None
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for _, _, owner in grid.cells.get((grid._c(p[0]) + dx, grid._c(p[1]) + dy), ()):
                    j, f = owner
                    if j == i or owner in used:
                        continue
                    d = dist_km(p, lines[j][f])
                    if d > 0.002 and not faces(p, lines[j][f], tangent(lines[i], e), tangent(lines[j], f)):
                        continue
                    if 1e-6 < d <= max_km and (best is None or d < best):
                        best, who = d, owner
        if who:
            used.update({(i, e), who})
            bridges.append([p, lines[who[0]][who[1]]])
    return lines + bridges, len(bridges)


def components_km(lines: list) -> list[float]:
    parent = list(range(len(lines)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    seen: dict[tuple, int] = {}
    for i, ln in enumerate(lines):
        for p in (ln[0], ln[-1]):
            k = (round(p[0], 5), round(p[1], 5))
            if k in seen:
                parent[find(i)] = find(seen[k])
            else:
                seen[k] = i
    total: dict[int, float] = defaultdict(float)
    for i, ln in enumerate(lines):
        total[find(i)] += length_km([list(p) for p in ln])
    return [total[find(i)] for i in range(len(lines))]


def to_ll(line, digits: int):
    return [[round(x, digits), round(y, digits)] for x, y in line]


# ---------- yig'ish ----------

def build(osm_path: Path, old_path: Path, dst: Path) -> dict:
    ways = load_osm(osm_path)
    old = load_old(old_path)
    stat = {"osm_yo'llar": len(ways), "osm_nuqta": sum(len(w["pts"]) for w in ways)}
    stat["bo'linma"] = assign_branches(ways, old)

    groups: dict[tuple, list] = defaultdict(list)
    elec: dict[tuple, float] = defaultdict(float)
    structures = defaultdict(float)
    for w in ways:
        key = (w["color"], classify(w["tags"]), is_high_speed(w["tags"]))
        groups[key].append(w["pts"])
        length = length_km([list(p) for p in w["pts"]])
        if w["tags"].get("electrified") in ("contact_line", "yes"):
            elec[key] += length
        for s in ("bridge", "tunnel"):
            if w["tags"].get(s) in ("yes", "viaduct", "building_passage"):
                structures[s] += length

    order = list(BRANCHES)
    features, total_bridges, n_before, n_after = [], 0, 0, 0
    for key in sorted(groups, key=lambda k: (order.index(k[0]) if k[0] in order else 99, KINDS.index(k[1]), k[2])):
        color, kind, hs = key
        merged = merge_lines(groups[key])
        merged, nb = close_gaps(merged, BRIDGE_GAP_KM)
        total_bridges += nb
        branch, name = BRANCHES.get(color, (color, color))
        km = sum(length_km([list(p) for p in ln]) for ln in merged)
        n_before += sum(len(ln) for ln in merged)
        detail = []
        for ln in merged:
            ln = simplify([list(p) for p in ln], DETAIL_TOL)
            ln = densify([tuple(p) for p in ln], DENSIFY_KM)
            detail.append(to_ll(ln, 6))
            n_after += len(ln)
        props = {"branch": branch, "name": name, "kind": kind, "hs": hs, "km": round(km, 1),
                 "elec_km": round(elec[key], 1)}
        features.append({"type": "Feature", "properties": {**props, "lod": "detail", "parts": len(detail)},
                         "geometry": {"type": "MultiLineString", "coordinates": detail}})
        if kind in OVERVIEW_KINDS:
            comp = components_km(merged)
            ov = []
            for ln, c in zip(merged, comp):
                if c < OVERVIEW_MIN_NETWORK_KM or length_km([list(p) for p in ln]) < 0.5:
                    continue
                sm = simplify([list(p) for p in ln], OVERVIEW_TOL)
                ov.append(to_ll(chaikin([tuple(p) for p in sm], 2), 5))
            if ov:
                features.append({"type": "Feature", "properties": {**props, "lod": "overview", "parts": len(ov)},
                                 "geometry": {"type": "MultiLineString", "coordinates": ov}})
    out = {"type": "FeatureCollection",
           "attribution": "© OpenStreetMap contributors (ODbL); bo'linma ranglari — railway-lines.json",
           "features": features}
    dst.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    stat.update({"ko'prik_bo'shliqlari": total_bridges, "nuqta_oldin": n_before, "nuqta_detail": n_after,
                 "hajm_mb": round(dst.stat().st_size / 1e6, 2),
                 "km_toifa": {k: round(sum(f["properties"]["km"] for f in features
                                           if f["properties"]["lod"] == "detail" and f["properties"]["kind"] == k))
                              for k in KINDS},
                 "elektr_km": round(sum(f["properties"]["elec_km"] for f in features if f["properties"]["lod"] == "detail")),
                 "tezyurar_km": round(sum(f["properties"]["km"] for f in features
                                          if f["properties"]["lod"] == "detail" and f["properties"]["hs"])),
                 "ko'prik_km": round(structures["bridge"], 1), "tunnel_km": round(structures["tunnel"], 1),
                 "bo'linma_km": {f["properties"]["name"]: 0 for f in features}})
    per = defaultdict(float)
    for f in features:
        if f["properties"]["lod"] == "detail":
            per[f["properties"]["name"]] += f["properties"]["km"]
    stat["bo'linma_km"] = {k: round(v) for k, v in per.items()}
    return stat


# ---------- sifat tekshiruvi ----------

def compare(dst: Path, old_path: Path) -> dict:
    """Eski fayl bilan: qaysi qismi mos, nima qo'shildi, nima faqat eskida qoldi."""
    new = json.loads(dst.read_text(encoding="utf-8"))["features"]
    new_lines = [ln for f in new if f["properties"]["lod"] == "detail" for ln in f["geometry"]["coordinates"]]
    old_lines = [ln for _, ln in load_old(old_path)]
    g_new, g_old = SegmentGrid(0.005), SegmentGrid(0.005)
    for ln in new_lines:
        for a, b in zip(ln, ln[1:]):
            g_new.add(a, b)
    for ln in old_lines:
        for a, b in zip(ln, ln[1:]):
            g_old.add(a, b)

    def covered(lines, grid, tol):
        near = far = 0.0
        far_pts = []
        for ln in lines:
            for p in sample(ln, 0.1):
                d, _ = grid.nearest(p, tol)
                if d is None:
                    far += 0.1
                    far_pts.append(p)
                else:
                    near += 0.1
        return near, far, far_pts
    # eski yo'l OSM'ga qanchalik mos (50 m)
    near, far, far_pts = covered(old_lines, g_new, 0.05)
    # eski faylda 2 km dan uzun to'g'ri kesmalar — soxta "bo'shliq to'ldirgichlar"
    artefact = sum(dist_km(a, b) for ln in old_lines for a, b in zip(ln, ln[1:]) if dist_km(a, b) > 2.0)
    # OSM'da bor, eskida yo'q (qo'shilgan)
    n_near, n_far, _ = covered(new_lines, g_old, 0.05)
    # faqat eskida qolganlarni tumanlar bo'yicha guruhlash (~0,05° katak)
    clusters: dict = defaultdict(int)
    for p in far_pts:
        clusters[(round(p[0], 1), round(p[1], 1))] += 1
    top = sorted(clusters.items(), key=lambda kv: -kv[1])[:8]
    return {"eski_km_OSMga_mos(50m)": round(near), "eski_km_OSMda_yo'q": round(far),
            "eskidagi_2km+_to'g'ri_kesmalar_km": round(artefact),
            "yangi_km_eskida_yo'q": round(n_far), "yangi_km_eski_bilan_mos": round(n_near),
            "faqat_eskida_tumanlar(lon,lat,~km)": [(k, round(v * 0.1, 1)) for k, v in top]}


def camera_check(dst: Path) -> list:
    """Kameralarning (bazadagi) yangi chiziqqacha masofasi."""
    sys.path.insert(0, str(ROOT / "backend"))
    from core import env  # noqa: F401,E402
    from database import get_db  # noqa: E402
    new = json.loads(dst.read_text(encoding="utf-8"))["features"]
    grid = SegmentGrid(0.005)
    for f in new:
        if f["properties"]["lod"] == "detail" and f["properties"]["kind"] in ("main", "branch", "other"):
            for ln in f["geometry"]["coordinates"]:
                for a, b in zip(ln, ln[1:]):
                    grid.add(a, b)
    with get_db() as db:
        cams = db.execute("SELECT name, lat, lng, km FROM camera_details WHERE lat IS NOT NULL "
                          "AND NOT (lat = 0 AND lng = 0) ORDER BY km").fetchall()
    out = []
    for c in cams:
        d, _ = grid.nearest((c["lng"], c["lat"]), 5.0)
        out.append((c["name"], None if d is None else round(d * 1000)))
    return out


if __name__ == "__main__":
    osm = Path(sys.argv[1]) if len(sys.argv) > 1 else OSM
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else DST
    print(json.dumps(build(osm, OLD, dst), ensure_ascii=False, indent=1))
    print(json.dumps(compare(dst, OLD), ensure_ascii=False, indent=1))
    cams = camera_check(dst)
    far = [c for c in cams if c[1] is None or c[1] > 60]
    print(f"kameralar: {len(cams)}; chiziqdan <=60 m: {len(cams) - len(far)}; uzoq: {far}")
