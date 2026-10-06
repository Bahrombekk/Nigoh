"""Hisobot davri va kuzatuv qamrovi.

Davr — [since, until) oralig'i, mahalliy zonada (TZ = NIGOH_TZ,
database/connection.py dagi VAQT_ZONASI). Hodisalar jurnali 30 kun
saqlanadi — undan uzoq davr so'ralsa "ma'lumot yo'q" "uzilish bo'lmagan"
bo'lib ko'rinardi, shuning uchun hamma davr MAX_DAYS bilan cheklanadi.

Tarkibi:
    Period(since, until, rolling)     davr; rolling — "oxirgi N kun"
        .seconds .days .as_dict()     davomiylik va javob uchun from/to/days
    last_days(days)                   oxirgi N kun (1..MAX_DAYS)
    local_day(day)                    bitta mahalliy sutka (bugun — hozirgacha)
    between(date_from, date_to)       mahalliy sanalar oralig'i, ikkala chet
                                      kiradi; kelajak yoki 30 kundan eski — ValueError
    today_local()                     bugungi mahalliy sana
    overlap(a, b, c, d)               ikki oraliq kesishmasi, soniyada
    covered_seconds(a, b, gaps)       [a, b) ning kuzatuv bo'lgan qismi
    pct(part, whole)                  foiz (2 xona); whole = 0 bo'lsa None
    MAX_DAYS, TZ                      30; mahalliy zona

Kim ishlatadi: stats/api.py, stats/overview.py,
    stats/reporting/{engine,metrics}.py, tests/test_stats_api.py.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from database.connection import VAQT_ZONASI

# Hodisalar jurnali 30 kun saqlanadi — undan uzoq davr so'ralsa "ma'lumot
# yo'q" "uzilish bo'lmagan" bo'lib ko'rinardi.
MAX_DAYS = 30
TZ = ZoneInfo(VAQT_ZONASI)


@dataclass(frozen=True)
class Period:
    since: datetime
    until: datetime
    rolling: bool = True          # "oxirgi N kun" (keshlash kaliti shunga qarab)

    @property
    def seconds(self) -> float:
        return max(0.0, (self.until - self.since).total_seconds())

    @property
    def days(self) -> float:
        return round(self.seconds / 86400, 2)

    def as_dict(self) -> dict:
        return {"from": self.since, "to": self.until, "days": self.days}


def last_days(days: int, now: datetime | None = None) -> Period:
    now = now or datetime.now(TZ)
    days = max(1, min(int(days), MAX_DAYS))
    return Period(now - timedelta(days=days), now)


def local_day(day: date, now: datetime | None = None) -> Period:
    """Bitta mahalliy sutka (NIGOH_TZ); bugun bo'lsa — hozirgacha."""
    now = now or datetime.now(TZ)
    start = datetime.combine(day, time(0), TZ)
    return Period(start, min(start + timedelta(days=1), now), rolling=False)


def between(date_from: date, date_to: date, now: datetime | None = None) -> Period:
    """Mahalliy sanalar oralig'i, ikkala chet ham kiradi."""
    now = now or datetime.now(TZ)
    if date_to < date_from:
        raise ValueError("date_to date_from dan oldin")
    start = datetime.combine(date_from, time(0), TZ)
    end = min(datetime.combine(date_to + timedelta(days=1), time(0), TZ), now)
    if start >= now:
        raise ValueError("davr kelajakda")
    if now - start > timedelta(days=MAX_DAYS, hours=1):
        raise ValueError(f"ma'lumot {MAX_DAYS} kun saqlanadi")
    return Period(start, end, rolling=False)


def today_local(now: datetime | None = None) -> date:
    return (now or datetime.now(TZ)).date()


# ---------- oraliqlar ----------

def overlap(a: datetime, b: datetime, c: datetime, d: datetime) -> float:
    return max(0.0, (min(b, d) - max(a, c)).total_seconds())


def covered_seconds(a: datetime, b: datetime, gaps) -> float:
    """[a, b) ning kuzatuv bo'lgan qismi (bo'shliqlar chiqariladi)."""
    total = max(0.0, (b - a).total_seconds())
    return max(0.0, total - sum(overlap(a, b, g0, g1) for g0, g1 in gaps))


def pct(part: float, whole: float) -> float | None:
    return round(100 * part / whole, 2) if whole > 0 else None
