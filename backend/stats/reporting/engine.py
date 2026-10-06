"""Davrdagi har kameraning uzilishlari — barcha ko'rsatkichlar shu bitta hisobdan chiqadi.

Bitta dashboard sahifasi o'nlab endpointni deyarli bir vaqtda so'raydi;
har biri hodisalar jurnalini qaytadan o'qisa baza bekorga yuklanadi.
Shuning uchun natija (davr daqiqasi + hudud kesimi) bo'yicha 60 s
keshlanadi: birinchi so'rov hisoblaydi, qolganlari tayyorini oladi
(kesh 64 yozuvdan oshsa eskirganlari tashlanadi).

Qoidalar:
  * kuzatiladigan kamera — yoqiq va RTSP manbali;
  * ketma-ket ikki `offline` (orada `online` yo'q) — bitta uzilish;
    davr oxirigacha tiklanmagani — ochiq (`open`);
  * uzilishning faqat kuzatuv bo'lgan qismi sanaladi; butunlay bo'shliqqa
    tushgan uzilish umuman sanalmaydi;
  * BLIP_SECONDS (120 s) dan qisqa, tugagan uzilish — "blip" (qisqa sakrash).

Tarkibi:
    Outage                      bitta uzilish: camera_id, start, end, open, seconds
        .kind                   "blip" yoki "outage"
    CameraStats                 kameraning davrdagi hisobi: row, covered_s,
                                outages, stalls
        .id .offline_s .real .blips .uptime_pct
        .brief()                kamera ro'yxatlari uchun qisqa ko'rinish
    Snapshot                    davr hisobi: period, area_ids, rows, gaps,
                                covered_s, cameras
        .outages                barcha kameralarning uzilishlari
        .camera(camera_id)      bitta kamera hisobi yoki None
    snapshot(period, area_ids)  keshdan yoki hisoblab Snapshot qaytaradi
    clear_cache()               keshni tozalaydi (testlar)
    BLIP_SECONDS, CACHE_TTL     120 s, 60 s

Ishlatadi: database (cameras, reports), stats.reporting.period.
Kim ishlatadi: stats/api.py, stats/overview.py, stats/reporting/metrics.py,
    tests/test_stats_api.py.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from datetime import datetime

from database import cameras, get_db, reports
from stats.reporting.period import Period, covered_seconds, pct

BLIP_SECONDS = 120          # shundan qisqa, tugagan uzilish — "qisqa sakrash"
CACHE_TTL = 60.0
_CACHE_MAX = 64

_cache: dict[tuple, tuple[float, Snapshot]] = {}
_lock = threading.Lock()


@dataclass(frozen=True)
class Outage:
    camera_id: int
    start: datetime
    end: datetime
    open: bool               # hali tiklanmagan
    seconds: float           # kuzatuv bo'lgan qismi

    @property
    def kind(self) -> str:
        return "blip" if not self.open and self.seconds < BLIP_SECONDS else "outage"


@dataclass
class CameraStats:
    row: object
    covered_s: float
    outages: list[Outage] = field(default_factory=list)
    stalls: int = 0

    @property
    def id(self) -> int:
        return self.row["id"]

    @property
    def offline_s(self) -> float:
        return sum(o.seconds for o in self.outages)

    @property
    def real(self) -> list[Outage]:
        return [o for o in self.outages if o.kind == "outage"]

    @property
    def blips(self) -> list[Outage]:
        return [o for o in self.outages if o.kind == "blip"]

    @property
    def uptime_pct(self) -> float | None:
        return pct(self.covered_s - self.offline_s, self.covered_s)

    def brief(self) -> dict:
        """Kamera ro'yxatlari uchun umumiy ko'rinish."""
        row = self.row
        last = max((o.start for o in self.outages), default=None)
        return {
            "id": row["id"], "name": row["name"], "region": row["region"],
            "admin_area_id": row["admin_area_id"], "km": row["km"], "picket": row["picket"],
            "uptime_pct": self.uptime_pct,
            "offline_seconds": int(self.offline_s),
            "outages": len(self.real), "blips": len(self.blips), "stalls": self.stalls,
            "last_offline_at": last,
        }


@dataclass
class Snapshot:
    period: Period
    area_ids: list[int] | None
    rows: list                         # hudud kesimidagi barcha kameralar
    gaps: list[tuple[datetime, datetime]]
    covered_s: float
    cameras: list[CameraStats]         # kuzatiladigan (yoqiq RTSP) kameralar

    @property
    def outages(self) -> list[Outage]:
        return [o for c in self.cameras for o in c.outages]

    def camera(self, camera_id: int) -> CameraStats | None:
        return next((c for c in self.cameras if c.id == camera_id), None)


def _intervals(rows, since: datetime, until: datetime):
    """Bitta kameraning o'tishlaridan o'chiq oraliqlar: [(boshi, oxiri, ochiqmi)].

    Ketma-ket ikki `offline` (orada `online` yo'q) — bitta uzilish.
    """
    out, start = [], None
    for r in rows:
        t = max(r["ts"], since)
        if r["kind"] == "offline" and start is None:
            start = t
        elif r["kind"] == "online" and start is not None:
            if t > start:
                out.append((start, t, False))
            start = None
    if start is not None:
        out.append((start, until, True))
    return out


def _compute(period: Period, area_ids: list[int] | None) -> Snapshot:
    since, until = period.since, period.until
    with get_db() as db:
        rows = [r for r in cameras.list_all(db)
                if area_ids is None or r["admin_area_id"] in area_ids]
        scope = None if area_ids is None else [r["id"] for r in rows]
        gaps = reports.monitoring_gaps(db, since, until)
        transitions = reports.transitions(db, since, scope, until)
        stalls = reports.stall_counts(db, since, until)

    covered = covered_seconds(since, until, gaps)
    by_camera: dict[int, list] = {}
    for t in transitions:
        by_camera.setdefault(t["camera_id"], []).append(t)

    stats = []
    for row in rows:
        if not row["enabled"] or row["source_type"] != "rtsp":
            continue
        cam = CameraStats(row=row, covered_s=covered, stalls=stalls.get(row["id"], 0))
        for start, end, still_open in _intervals(by_camera.get(row["id"], []), since, until):
            dur = covered_seconds(start, end, gaps)
            if dur > 0:                        # butunlay bo'shliqda bo'lsa — sanalmaydi
                cam.outages.append(Outage(row["id"], start, end, still_open, dur))
        stats.append(cam)
    return Snapshot(period, area_ids, rows, gaps, covered, stats)


def snapshot(period: Period, area_ids: list[int] | None) -> Snapshot:
    key = (int(period.since.timestamp() // 60), int(period.until.timestamp() // 60),
           None if area_ids is None else tuple(sorted(area_ids)))
    now = time.monotonic()
    with _lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            return hit[1]
    result = _compute(period, area_ids)
    with _lock:
        if len(_cache) >= _CACHE_MAX:
            for k in [k for k, (exp, _) in _cache.items() if exp <= now] or list(_cache)[:8]:
                _cache.pop(k, None)
        _cache[key] = (now + CACHE_TTL, result)
    return result


def clear_cache() -> None:
    with _lock:
        _cache.clear()
