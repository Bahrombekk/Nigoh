"""Ko'rsatkichlar — har biri bitta savolga javob beradi va alohida
endpoint bo'lib chiqadi (stats/api.py).

Funksiyalar sof: kirish — `engine.Snapshot` (davrdagi uzilishlar), jonli
holatlar (`states`: kamera id -> holat) yoki bazadan olingan qatorlar.
HTTP, ruxsat va keshlash bu yerda yo'q. Kunlik/soatlik kesimlar mahalliy
zonada (TZ); oraliq kun yoki soat chegarasini kesib o'tsa ulushi bilan
taqsimlanadi va faqat kuzatilgan qismi sanaladi.

Tarkibi:
    summary_now(rows, states)          hozir: holatlar bo'yicha soni; foiz faqat
                                       o'lchanadiganlardan (online+stalled+offline)
    availability(snap)                 davrdagi onlaynlik (kamera-soat) va
                                       uptime taqsimoti (UPTIME_BANDS)
    coverage(snap, min_gap_minutes)    kuzatuv qamrovi va bo'shliqlari
    outage_summary(snap)               uzilishlar, sakrashlar, to'xtashlar, MTTR
                                       (median/p90/o'rtacha), MTBF, eng uzuni
    outage_list(snap, ...)             uzilishlar jurnali: kind, open_only,
                                       camera_id, sort, limit/offset
    regions(snap, states)              hudud kesimi — eng yomoni birinchi
    vendors(snap, states)              marka kesimi: holat, onlaynlik, uzilish/kamera,
                                       kodek, o'girish, UDP va modellar
    ranking(snap, states, by, limit)   muammoli kameralar (RANKINGS bo'yicha)
    camera_detail(snap, cam, state)    bitta kamera: onlaynlik, uzilishlar, MTTR
    daily(snap)                        kunlik kesim
    hourly(snap)                       sutka soatlari kesimi + eng zich 3 soat
    heatmap(snap, mode, kind)          sana × soat yoki hafta kuni × soat
                                       (kuzatuvsiz kunlar o'rtachaga kirmaydi)
    series(points, step)               onlaynlik qatori (bo'sh nuqtalarsiz)
    sla(points, step, goal)            maqsadga muvofiqlik va "qarz" kamera-soatlari
    rail(rows, states, names, bin_km)  temir yo'l liniyasi bo'ylab holatlar
                                       (km + piket/10)
    STATES, UPTIME_BANDS, RANKINGS, STEP_SECONDS   holatlar, uptime
                                       chegaralari, reyting mezonlari, qadamlar

Ishlatadi: stats.reporting.engine, stats.reporting.period.
Kim ishlatadi: stats/api.py, stats/overview.py.
"""
from __future__ import annotations

import statistics
from collections import Counter
from datetime import date, datetime, time, timedelta

from stats.reporting.engine import BLIP_SECONDS, CameraStats, Outage, Snapshot
from stats.reporting.period import TZ, covered_seconds, pct

STATES = ("online", "stalled", "offline", "unknown", "disabled")
# Uptime taqsimoti: kameralar shu chegaralar bo'yicha guruhlanadi.
UPTIME_BANDS = ((100.0, "100%"), (99.0, "99–100%"), (95.0, "95–99%"),
                (90.0, "90–95%"), (0.0, "<90%"))


def _local(t: datetime) -> datetime:
    return t.astimezone(TZ)


def _percentile(sorted_vals: list[float], q: float) -> float | None:
    if not sorted_vals:
        return None
    return sorted_vals[min(len(sorted_vals) - 1, int(q * len(sorted_vals)))]


def _spread(intervals, edges: list[datetime], gaps) -> list[float]:
    """Oraliqlarni uyalarga bo'lib taqsimlaydi (faqat kuzatilgan qismi):
    yarim tunni kesib o'tgan uzilish ikkala kunga ulushi bilan tushadi."""
    out = [0.0] * (len(edges) - 1)
    for start, end in intervals:
        for i in range(len(out)):
            lo, hi = max(start, edges[i]), min(end, edges[i + 1])
            if hi > lo:
                out[i] += covered_seconds(lo, hi, gaps)
    return out


def _outage_dict(o: Outage, cam: CameraStats) -> dict:
    row = cam.row
    return {"camera_id": o.camera_id, "name": row["name"], "region": row["region"],
            "km": row["km"], "picket": row["picket"],
            "start": o.start, "end": None if o.open else o.end, "open": o.open,
            "seconds": int(o.seconds), "kind": o.kind}


# ---------- hozirgi holat (davrsiz) ----------

def summary_now(rows, states: dict[int, str]) -> dict:
    """Hozir: nechta kamera qaysi holatda. Foiz faqat holati o'lchanadigan
    kameralardan (onlayn + tasvirsiz + uzilgan) olinadi."""
    counts = Counter(states.get(r["id"], "unknown") for r in rows)
    by_state = {s: counts.get(s, 0) for s in STATES}
    measured = by_state["online"] + by_state["stalled"] + by_state["offline"]
    return {
        "total": len(rows),
        "by_state": by_state,
        "measured": measured,
        "online_pct": pct(by_state["online"], measured),
        "by_source": dict(Counter(r["source_type"] for r in rows)),
        "with_location": sum(1 for r in rows if r["lat"] is not None),
        "with_km": sum(1 for r in rows if r["km"] is not None),
    }


# ---------- davr bo'yicha ----------

def availability(snap: Snapshot) -> dict:
    """Davrdagi onlaynlik: kamera-soat bo'yicha, kuzatuv bo'lgan vaqtdan."""
    n = len(snap.cameras)
    observed = n * snap.covered_s
    offline = sum(c.offline_s for c in snap.cameras)
    bands = Counter()
    for c in snap.cameras:
        up = c.uptime_pct
        if up is None:
            continue
        bands[next(label for limit, label in UPTIME_BANDS if up >= limit)] += 1
    return {
        **snap.period.as_dict(),
        "cameras": n,
        "coverage_pct": pct(snap.covered_s, snap.period.seconds),
        "uptime_pct": pct(observed - offline, observed),
        "camera_hours_observed": round(observed / 3600, 1),
        "camera_hours_offline": round(offline / 3600, 1),
        "never_down": sum(1 for c in snap.cameras if not c.outages),
        "distribution": [{"band": label, "cameras": bands.get(label, 0)}
                         for _, label in UPTIME_BANDS],
    }


def coverage(snap: Snapshot, min_gap_minutes: int = 0) -> dict:
    """Kuzatuv qamrovi: server o'lchov yozmagan oraliqlar."""
    gaps = [(a, b) for a, b in snap.gaps if (b - a).total_seconds() >= min_gap_minutes * 60]
    return {
        **snap.period.as_dict(),
        "pct": pct(snap.covered_s, snap.period.seconds),
        "observed_hours": round(snap.covered_s / 3600, 1),
        "missing_hours": round((snap.period.seconds - snap.covered_s) / 3600, 1),
        "gaps": [{"from": a, "to": b, "hours": round((b - a).total_seconds() / 3600, 2)}
                 for a, b in gaps],
    }


def outage_summary(snap: Snapshot) -> dict:
    """Uzilishlar: soni, turlari, tiklanish vaqti (MTTR), eng uzuni."""
    outages = snap.outages
    real = [o for o in outages if o.kind == "outage"]
    recovered = sorted(o.seconds for o in real if not o.open)
    longest = max(real, key=lambda o: o.seconds, default=None)
    cams = {c.id: c for c in snap.cameras}
    n_real = len(real)
    return {
        **snap.period.as_dict(),
        "outages": n_real,
        "blips": len(outages) - n_real,
        "blip_threshold_s": BLIP_SECONDS,
        "stalls": sum(c.stalls for c in snap.cameras),
        "open_now": sum(1 for o in real if o.open),
        "affected_cameras": len({o.camera_id for o in real}),
        "offline_camera_hours": round(sum(o.seconds for o in outages) / 3600, 1),
        "mttr": {
            "median_s": int(statistics.median(recovered)) if recovered else None,
            "p90_s": int(_percentile(recovered, 0.9)) if recovered else None,
            "mean_s": int(statistics.fmean(recovered)) if recovered else None,
            "recovered": len(recovered),
        },
        # MTBF — park bo'yicha: kuzatilgan kamera-vaqt / haqiqiy uzilishlar soni.
        "mtbf_s": int(len(snap.cameras) * snap.covered_s / n_real) if n_real else None,
        "longest": _outage_dict(longest, cams[longest.camera_id]) if longest else None,
    }


def outage_list(snap: Snapshot, *, kind: str = "outage", open_only: bool = False,
                camera_id: int | None = None, sort: str = "start",
                limit: int = 100, offset: int = 0) -> dict:
    """Uzilishlar jurnali. kind: outage | blip | all; sort: start | duration."""
    items = []
    for cam in snap.cameras:
        if camera_id is not None and cam.id != camera_id:
            continue
        for o in cam.outages:
            if kind != "all" and o.kind != kind:
                continue
            if open_only and not o.open:
                continue
            items.append((o, cam))
    key = (lambda p: -p[0].seconds) if sort == "duration" else (lambda p: -p[0].start.timestamp())
    items.sort(key=key)
    return {**snap.period.as_dict(), "total": len(items), "limit": limit, "offset": offset,
            "items": [_outage_dict(o, c) for o, c in items[offset:offset + limit]]}


def regions(snap: Snapshot, states: dict[int, str]) -> list[dict]:
    """Hudud kesimi: hozirgi holat va davrdagi onlaynlik — eng yomoni birinchi."""
    groups: dict[str, dict] = {}
    for row in snap.rows:
        g = groups.setdefault(row["region"], {
            "region": row["region"], "admin_area_id": row["admin_area_id"], "cameras": 0,
            "now": {s: 0 for s in STATES}, "outages": 0, "blips": 0,
            "_observed": 0.0, "_offline": 0.0})
        g["cameras"] += 1
        g["now"][states.get(row["id"], "unknown")] += 1
    for cam in snap.cameras:
        g = groups[cam.row["region"]]
        g["outages"] += len(cam.real)
        g["blips"] += len(cam.blips)
        g["_observed"] += cam.covered_s
        g["_offline"] += cam.offline_s
    out = []
    for g in groups.values():
        observed, offline = g.pop("_observed"), g.pop("_offline")
        measured = g["now"]["online"] + g["now"]["stalled"] + g["now"]["offline"]
        g["online_now_pct"] = pct(g["now"]["online"], measured)
        g["uptime_pct"] = pct(observed - offline, observed)
        g["offline_hours"] = round(offline / 3600, 1)
        out.append(g)
    out.sort(key=lambda g: (g["uptime_pct"] is None, g["uptime_pct"] or 0))
    return out


def _codec_family(codec: str | None) -> str:
    c = (codec or "").lower()
    if "265" in c or "hevc" in c:
        return "H265"
    if "264" in c or "avc" in c:
        return "H264"
    return "unknown"


def vendors(snap: Snapshot, states: dict[int, str]) -> list[dict]:
    """Marka (vendor) kesimi: hozirgi holat, davrdagi onlaynlik, uzilishlar
    va kameraga to'g'ri keladigan uzilishlar (markalar soni har xil — adolatli
    taqqoslash uchun), kodek/o'girish/UDP va modellar bo'yicha bo'linish.
    Eng ko'p kamerali marka birinchi."""
    def bucket(key: str) -> dict:
        return {"cameras": 0, "now": {s: 0 for s in STATES}, "outages": 0, "blips": 0,
                "stalls": 0, "_observed": 0.0, "_offline": 0.0, "_recovered": []}

    groups: dict[str, dict] = {}
    models: dict[str, dict[str, dict]] = {}
    for row in snap.rows:
        v = row["vendor"] or "unknown"
        g = groups.setdefault(v, {**bucket(v), "vendor": v,
                                  "codecs": {"H264": 0, "H265": 0, "unknown": 0},
                                  "transcode": 0, "udp": 0, "no_model": 0})
        m = models.setdefault(v, {}).setdefault(row["model"] or "", bucket(v))
        st = states.get(row["id"], "unknown")
        for b in (g, m):
            b["cameras"] += 1
            b["now"][st] += 1
        g["codecs"][_codec_family(row["codec"])] += 1
        g["transcode"] += bool(row["transcode"])
        g["udp"] += bool(row["rtsp_udp"])
        g["no_model"] += not row["model"]
    for cam in snap.cameras:
        row = cam.row
        v = row["vendor"] or "unknown"
        for b in (groups[v], models[v][row["model"] or ""]):
            b["outages"] += len(cam.real)
            b["blips"] += len(cam.blips)
            b["stalls"] += cam.stalls
            b["_observed"] += cam.covered_s
            b["_offline"] += cam.offline_s
            b["_recovered"] += [o.seconds for o in cam.real if not o.open]

    def finish(b: dict) -> dict:
        observed, offline = b.pop("_observed"), b.pop("_offline")
        recovered = b.pop("_recovered")
        measured = b["now"]["online"] + b["now"]["stalled"] + b["now"]["offline"]
        b["online_now_pct"] = pct(b["now"]["online"], measured)
        b["uptime_pct"] = pct(observed - offline, observed)
        b["offline_hours"] = round(offline / 3600, 1)
        b["outages_per_camera"] = round(b["outages"] / b["cameras"], 2) if b["cameras"] else None
        b["mttr_median_s"] = int(statistics.median(recovered)) if recovered else None
        return b

    out = []
    for v, g in groups.items():
        finish(g)
        g["models"] = sorted(
            ({"model": name or None, **{k: b[k] for k in (
                "cameras", "now", "online_now_pct", "uptime_pct", "outages", "blips",
                "stalls", "offline_hours", "outages_per_camera", "mttr_median_s")}}
             for name, b in ((n, finish(b)) for n, b in models[v].items())),
            key=lambda m: (-m["cameras"], m["model"] or "~"))
        out.append(g)
    out.sort(key=lambda g: (-g["cameras"], g["vendor"]))
    return out


RANKINGS = {
    "offline_time": lambda c: c.offline_s,
    "outages": lambda c: len(c.real),
    "blips": lambda c: len(c.blips),
    "flapping": lambda c: len(c.outages),
    "stalls": lambda c: c.stalls,
}


def ranking(snap: Snapshot, states: dict[int, str], by: str = "offline_time",
            limit: int = 10) -> dict:
    """Muammoli kameralar reytingi (faqat ko'rsatkichi noldan katta bo'lganlar)."""
    score = RANKINGS[by]
    ranked = sorted((c for c in snap.cameras if score(c) > 0), key=lambda c: -score(c))
    return {**snap.period.as_dict(), "by": by, "total": len(ranked),
            "items": [{**c.brief(), "state": states.get(c.id, "unknown")}
                      for c in ranked[:limit]]}


def camera_detail(snap: Snapshot, cam: CameraStats, state: str) -> dict:
    """Bitta kamera: davrdagi onlaynlik, uzilishlar va tiklanish vaqti."""
    recovered = sorted(o.seconds for o in cam.real if not o.open)
    return {
        **snap.period.as_dict(),
        **cam.brief(),
        "state": state,
        "coverage_pct": pct(snap.covered_s, snap.period.seconds),
        "mttr_median_s": int(statistics.median(recovered)) if recovered else None,
        "longest_s": int(max((o.seconds for o in cam.outages), default=0)),
        "items": [_outage_dict(o, cam) for o in sorted(cam.outages, key=lambda o: o.start,
                                                       reverse=True)],
    }


def _local_days(snap: Snapshot) -> list[tuple[str, datetime, datetime]]:
    """Davrdagi mahalliy sutkalar: (sana, boshi, oxiri) — davr chegarasida kesilgan."""
    day = _local(snap.period.since).date()
    last = _local(snap.period.until).date()
    out = []
    while day <= last:
        start = datetime.combine(day, time(0), TZ)
        a, b = max(start, snap.period.since), min(start + timedelta(days=1), snap.period.until)
        if b > a:
            out.append((day.isoformat(), a, b))
        day += timedelta(days=1)
    return out


def daily(snap: Snapshot) -> list[dict]:
    """Kunlik kesim: onlaynlik, uzilishlar, qamrov (mahalliy sana)."""
    days = _local_days(snap)
    edges = [d[1] for d in days] + [days[-1][2]] if days else []
    n = len(snap.cameras)
    offline_by_day = [0.0] * len(days)
    for cam in snap.cameras:
        for i, v in enumerate(_spread([(o.start, o.end) for o in cam.outages], edges, snap.gaps)):
            offline_by_day[i] += v
    starts = Counter((_local(o.start).date().isoformat(), o.kind) for o in snap.outages)
    out = []
    for i, (d, a, b) in enumerate(days):
        cov = covered_seconds(a, b, snap.gaps)
        observed = n * cov
        out.append({
            "date": d,
            "coverage_pct": pct(cov, (b - a).total_seconds()),
            "uptime_pct": pct(observed - offline_by_day[i], observed),
            "outages": starts.get((d, "outage"), 0),
            "blips": starts.get((d, "blip"), 0),
            "offline_camera_hours": round(offline_by_day[i] / 3600, 1),
        })
    return out


def hourly(snap: Snapshot) -> dict:
    """Sutka soatlari kesimi (mahalliy vaqt): uzilishlar boshlanishi va
    o'chiq kamera-daqiqalar. Davr bir necha kun bo'lsa — yig'indi."""
    starts = [0] * 24
    blips = [0] * 24
    for o in snap.outages:
        h = _local(o.start).hour
        (starts if o.kind == "outage" else blips)[h] += 1
    minutes = [0.0] * 24
    for d, a, b in _local_days(snap):
        day0 = datetime.combine(date.fromisoformat(d), time(0), TZ)
        edges = [day0 + timedelta(hours=h) for h in range(25)]
        for cam in snap.cameras:
            ivs = [(max(o.start, a), min(o.end, b)) for o in cam.outages
                   if o.start < b and o.end > a]
            for h, v in enumerate(_spread(ivs, edges, snap.gaps)):
                minutes[h] += v / 60
    best = max(range(24), key=lambda h: sum(starts[(h + i) % 24] for i in range(3)))
    return {**snap.period.as_dict(), "outages": starts, "blips": blips,
            "offline_camera_minutes": [round(m, 1) for m in minutes],
            "peak": {"from_hour": best, "to_hour": (best + 3) % 24,
                     "outages": sum(starts[(best + i) % 24] for i in range(3))}}


def heatmap(snap: Snapshot, mode: str = "date", kind: str = "outage") -> dict:
    """Uzilishlar boshlanishi: sana × soat yoki hafta kuni × soat (kunlik o'rtacha).

    kind: outage — faqat haqiqiy uzilishlar; all — sakrashlar bilan."""
    days = _local_days(snap)
    cnt: Counter = Counter()
    for o in snap.outages:
        if kind == "outage" and o.kind != "outage":
            continue
        t = _local(o.start)
        cnt[(t.date().isoformat(), t.hour)] += 1
    if mode == "date":
        rows = [{"key": d, "hours": [cnt.get((d, h), 0) for h in range(24)],
                 "coverage_pct": pct(covered_seconds(a, b, snap.gaps), (b - a).total_seconds())}
                for d, a, b in days]
    else:
        # Hafta kuni (1 = dushanba): shu kunlar soniga bo'lingan o'rtacha;
        # kuzatuvsiz kunlar o'rtachani tushirmasin — maxrajga kirmaydi.
        sums = {w: [0] * 24 for w in range(1, 8)}
        n_days = Counter()
        for d, a, b in days:
            if covered_seconds(a, b, snap.gaps) <= 0:
                continue
            w = datetime.fromisoformat(d).isoweekday()
            n_days[w] += 1
            for h in range(24):
                sums[w][h] += cnt.get((d, h), 0)
        rows = [{"key": w, "days": n_days[w],
                 "hours": [round(v / n_days[w], 2) if n_days[w] else None for v in sums[w]]}
                for w in range(1, 8)]
    return {**snap.period.as_dict(), "mode": mode, "kind": kind, "rows": rows}


# ---------- onlaynlik qatori va maqsad ----------

STEP_SECONDS = {"5m": 300, "hour": 3600, "6h": 21600, "day": 86400}


def series(points, step: str) -> dict:
    out = [{"ts": p["ts"], "online": round(p["online"], 2), "total": round(p["total"], 2),
            "pct": pct(p["online"], p["total"])} for p in points if p["total"]]
    return {"step": step, "points": out}


def sla(points, step: str, goal: float, total_now: int | None = None) -> dict:
    """Maqsadga muvofiqlik: onlaynlik `goal` foizdan past bo'lgan vaqt va
    maqsadga yetishmagan kamera-soatlar ("qarz")."""
    slot = STEP_SECONDS[step]
    obs = [p for p in points if p["total"]]
    below = [p for p in obs if 100 * p["online"] / p["total"] < goal]
    deficit = sum(max(0.0, goal / 100 * p["total"] - p["online"]) * slot / 3600 for p in obs)
    worst = min(obs, key=lambda p: p["online"] / p["total"], default=None)
    return {
        "goal_pct": goal, "step": step,
        "observed_slots": len(obs),
        "in_goal_slots": len(obs) - len(below),
        "in_goal_pct": pct(len(obs) - len(below), len(obs)),
        "below_goal_seconds": len(below) * slot,
        "deficit_camera_hours": round(deficit, 1),
        "avg_pct": pct(sum(p["online"] for p in obs), sum(p["total"] for p in obs)),
        "worst": {"ts": worst["ts"], "pct": pct(worst["online"], worst["total"])} if worst else None,
    }


# ---------- liniya (km) ----------

def rail(rows, states: dict[int, str], line_names: dict[int, str], bin_km: float) -> list[dict]:
    """Temir yo'l liniyasi bo'ylab: har `bin_km` km oraliqda holatlar soni.

    Kamera km = km + piket/10. Bo'sh oraliqlar qaytmaydi."""
    lines: dict = {}
    for r in rows:
        if r["km"] is None:
            continue
        pos = r["km"] + (r["picket"] or 0) / 10
        line = lines.setdefault(r["rail_line_id"], {
            "rail_line_id": r["rail_line_id"],
            "name": line_names.get(r["rail_line_id"], "Belgilanmagan"),
            "cameras": 0, "km_min": pos, "km_max": pos, "bins": {}})
        line["cameras"] += 1
        line["km_min"], line["km_max"] = min(line["km_min"], pos), max(line["km_max"], pos)
        b = int(pos // bin_km)
        cell = line["bins"].setdefault(b, {"from_km": round(b * bin_km, 2),
                                           "to_km": round((b + 1) * bin_km, 2),
                                           **{s: 0 for s in STATES}, "regions": Counter()})
        cell[states.get(r["id"], "unknown")] += 1
        cell["regions"][r["region"]] += 1
    out = []
    for line in lines.values():
        bins = []
        for _, cell in sorted(line["bins"].items()):
            cell["region"] = cell.pop("regions").most_common(1)[0][0]
            bins.append(cell)
        line["bins"] = bins
        out.append(line)
    out.sort(key=lambda x: -x["cameras"])
    return out
