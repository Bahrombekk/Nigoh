"""Nigoh — dashboard statistikasi API'si (GET /stats/*).

Ma'lumot manbai — stats/recorder.py yozib boradigan ikki jadval:
`availability_snapshots` (5 daqiqalik hudud suratlari) va `status_changes`
(uzilish/qaytish), hamda `camera_events` (uzilishlar va kuzatuv
bo'shliqlari — `stats/reporting/` orqali).

Ikki xil endpoint:

  * /dashboard, /timeline, /overview — hozirgi dashboard'ning yig'ma
    javoblari (sahifa bitta so'rov bilan chizadi);
  * qolganlari — har biri bitta ko'rsatkich. Hisob `stats/reporting/`
    qatlamida, bir xil qoidalar bilan (kuzatuv bo'shlig'i "o'chiq" emas;
    2 daqiqadan qisqa uzilish — "qisqa sakrash").

Ko'rsatkich endpointlarining umumiy parametrlari: `days=1..30` (oxirgi N
kun, standart 1 = 24 soat) yoki `from=YYYY-MM-DD&to=` (mahalliy sanalar);
`area_id=…` — hudud(lar), tumanlari bilan, takrorlash mumkin. Operator
faqat o'z hududlarini ko'radi: begona area_id — 403. Mahalliy sana —
NIGOH_TZ zonasi (database/connection.py).

Yozuvchi (stats/recorder.py) har daqiqada kameralarning yagona holatini
(`camera.state.camera_state`) oladi — xaritadagi rang bilan bir xil manba.

Endpointlar (router require_user bilan ulanadi — mehmonga yopiq;
prefiks /api/v1/stats, eski /api/stats):
    GET  /api/v1/stats/dashboard        24 soatlik chiziq, 7 kunlik kesim,
                                        hududlar, bugungi soatlar, so'nggi hodisalar
    GET  /api/v1/stats/timeline         onlaynlik grafigi, soatlik o'rtacha (7/30 kun)
    GET  /api/v1/stats/overview         uzoq davrli ishonchlilik (stats/overview.py)
    GET  /api/v1/stats/summary          hozirgi holat bo'yicha kameralar soni
                                        (?compare=1 — previous: davr oldingi surat)
    GET  /api/v1/stats/availability     davrdagi onlaynlik va uptime taqsimoti
                                        (?compare=1 — previous: oldingi teng davr)
    GET  /api/v1/stats/coverage         kuzatuv qamrovi va bo'shliqlari
    GET  /api/v1/stats/series           onlaynlik qatori (step: 5m / hour / 6h / day)
    GET  /api/v1/stats/sla              `goal` foizga muvofiqlik va "qarz"
    GET  /api/v1/stats/outages/summary  uzilish turlari, MTTR, MTBF, eng uzuni
    GET  /api/v1/stats/outages          uzilishlar jurnali (sahifalab)
    GET  /api/v1/stats/daily            kunlik kesim (mahalliy sana)
    GET  /api/v1/stats/hourly           sutka soatlari kesimi (yoki bitta `day`)
    GET  /api/v1/stats/heatmap          sana × soat yoki hafta kuni × soat
    GET  /api/v1/stats/regions          hudud kesimi — eng yomoni birinchi
    GET  /api/v1/stats/vendors          kamera markalari va modellari kesimi
    GET  /api/v1/stats/ranking          muammoli kameralar reytingi (`by`)
    GET  /api/v1/stats/cameras/{id}     bitta kamera: onlaynlik, uzilishlar, MTTR
    GET  /api/v1/stats/rail             temir yo'l liniyasi bo'ylab holatlar (`bin_km`)
    GET  /api/v1/stats/quality          ma'lumot sifati (to'ldirilmagan maydonlar)
    GET  /api/v1/stats/feed             holat o'zgarishlari lentasi (`before_id`)

Tarkibi:
    router              APIRouter(prefix="/stats", tags=["stats"])
    period_params()     days / from / to -> Period (noto'g'ri davr — 422)
    scope_params()      area_id -> ruxsat etilgan hudud id'lari (begona — 403)
    Window, Scope       shu ikkisining Annotated dependency turlari

Ishlatadi: stats.reporting (engine, metrics, period), stats.overview,
    database (areas, cameras, rail, stats), camera.state, users.access.
Kim ishlatadi: app/factory.py (require_user bilan ulanadi); frontend —
    /stats/dashboard, /stats/timeline, /stats/overview; qolganlari tashqi
    mijozlar uchun (docs/STATS_API.md); tests/test_stats_api.py,
    tests/test_overview.py, tests/test_roles.py.
"""
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from camera.state import camera_state
from database import areas, cameras, get_db
from database import rail as rail_db
from database import stats as stats_db
from stats.overview import overview, quality, states_of
from stats.reporting import engine, metrics
from stats.reporting.period import (
    MAX_DAYS,
    TZ,
    Period,
    between,
    last_days,
    local_day,
    pct,
    today_local,
)
from users.access import allowed_areas, check_area

# Prefiks nisbiy — create_app uni /api/v1 (asosiy) va /api (eski) ostida ulaydi.
router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/dashboard")
def dashboard_stats():
    now = datetime.now(timezone.utc)
    since24 = now - timedelta(hours=24)
    since7 = now - timedelta(days=8)   # 7 kunlik oynaga zaxira bilan

    with get_db() as db:
        # 24 soatlik chiziq: har bir surat vaqtida jami nechta onlayn edi.
        timeline = [
            {"ts": r["ts"], "online": r["online"], "total": r["total"]}
            for r in stats_db.timeline(db, since24)
        ]

        # Kunlik kesim (mahalliy sana bo'yicha): o'rtacha onlayn ulushi
        # va uzilish hodisalari soni. "Mahalliy" — ulanish zonasi
        # (NIGOH_TZ, database/connection.py): `ts::date` va CURRENT_DATE
        # shu zonada hisoblanadi.
        daily_up = {
            r["d"]: (r["online"], r["total"])
            for r in stats_db.daily_uptime(db, since7)
        }
        daily_ev = {
            r["d"]: r["n"]
            for r in stats_db.daily_outages(db, since7)
        }
        today = stats_db.today(db)
        daily = []
        for i in range(6, -1, -1):
            d = (today - timedelta(days=i)).isoformat()
            online, total = daily_up.get(d, (0, 0))
            daily.append({
                "date": d,
                "uptime": round(100 * online / total, 1) if total else None,
                "events": daily_ev.get(d, 0),
            })

        # Hudud kesimi: 24 soatlik o'rtacha onlayn ulushi va bugungi uzilishlar.
        reg_ev = {
            r["region"]: r["n"]
            for r in stats_db.outages_today_by_region(db)
        }
        regions = [
            {
                "region": r["region"],
                "uptime24": round(100 * r["online"] / r["total"], 1)
                            if r["total"] else None,
                "events_today": reg_ev.get(r["region"], 0),
            }
            for r in stats_db.uptime_by_region(db, since24)
        ]

        # Bugungi uzilishlar soat kesimida — 24 katakli ustuncha uchun.
        hourly = [0] * 24
        for r in stats_db.outages_today_by_hour(db):
            if 0 <= r["h"] <= 23:
                hourly[r["h"]] = r["n"]

        # So'nggi hodisalar — sahifa yangilansa ham yo'qolmaydigan lenta.
        events = [
            {"ts": r["ts"], "id": r["camera_id"], "name": r["name"],
             "region": r["region"], "km": r["km"], "picket": r["picket"],
             "kind": r["kind"]}
            for r in stats_db.recent_changes(db, 40)
        ]

    return {
        "timeline": timeline,
        "daily": daily,
        "regions": regions,
        "hourly_today": hourly,
        "events_today": sum(hourly),
        "events": events,
    }


@router.get("/timeline")
def stats_timeline(days: int = Query(default=7, ge=1, le=30)):
    """Onlaynlik grafigi uzun davr uchun — soatlik o'rtacha (7 yoki 30 kun)."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    with get_db() as db:
        return {"days": days, "points": [
            {"ts": r["ts"], "online": round(r["online"], 2), "total": round(r["total"], 2)}
            for r in stats_db.timeline_hourly(db, since)]}


@router.get("/overview")
def stats_overview(request: Request, days: int = Query(default=30, ge=1, le=30)):
    """Uzoq davrli ishonchlilik: SLA, uzilish turlari, muammoli kameralar,
    kun x soat xaritasi, ma'lumot sifati (stats/overview.py). Operator faqat
    o'z hududlari bo'yicha ko'radi."""
    return overview(days, allowed_areas(request))


# ---------- ko'rsatkichlar: har biri alohida endpoint ----------
#
# Umumiy parametrlar:
#   days=1..30          — oxirgi N kun (standart 1 = oxirgi 24 soat);
#   from=YYYY-MM-DD&to= — aniq oraliq mahalliy sanalarda (days o'rniga);
#   area_id=…           — hudud(lar), tumanlari bilan; takrorlash mumkin.
# Operator faqat o'z hududlarini ko'radi: begona area_id — 403.

def period_params(
    days: int = Query(default=1, ge=1, le=MAX_DAYS, description="Oxirgi N kun"),
    date_from: date | None = Query(default=None, alias="from",
                                   description="Boshlanish sanasi (mahalliy)"),
    date_to: date | None = Query(default=None, alias="to",
                                 description="Tugash sanasi, kiradi (standart — bugun)"),
) -> Period:
    if date_from is None:
        return last_days(days)
    try:
        return between(date_from, date_to or today_local())
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


def scope_params(request: Request,
                 area_id: list[int] | None = Query(default=None,
                                                   description="Hudud id (tumanlari bilan)")
                 ) -> list[int] | None:
    allowed = allowed_areas(request)
    if not area_id:
        return allowed
    if allowed is not None and not set(area_id) <= set(allowed):
        raise HTTPException(403, "Bu hududni koʻrishga ruxsat yoʻq")
    with get_db() as db:
        wanted = areas.with_descendants(db, area_id)
    return wanted if allowed is None else [a for a in wanted if a in allowed]


Scope = Annotated[list[int] | None, Depends(scope_params)]
Window = Annotated[Period, Depends(period_params)]


def _snap(period: Period, area_ids):
    return engine.snapshot(period, area_ids)


def _scoped_rows(area_ids):
    with get_db() as db:
        rows = cameras.list_all(db)
    return [r for r in rows if area_ids is None or r["admin_area_id"] in area_ids]


def previous_period(period: Period) -> Period:
    """Oldingi teng davr: [since - davomiylik, since)."""
    length = period.until - period.since
    return Period(period.since - length, period.since, rolling=False)


@router.get("/summary")
def stat_summary(area_ids: Scope, period: Window,
                 compare: bool = Query(default=False, description="previous — davr oldingi holat")):
    """Hozirgi holat: nechta kamera onlayn / tasvirsiz / uzilgan / noma'lum / o'chirilgan.

    `compare=1` — `previous`: davr uzunligi (days, standart 1 kun) oldingi
    5 daqiqalik suratdan {at, measured, online, online_pct}; surat bo'lmasa null.
    (Tarixda holatlar kesimi saqlanmaydi — faqat kuzatilgan/onlayn.)
    """
    rows = _scoped_rows(area_ids)
    out = {"at": datetime.now(TZ), **metrics.summary_now(rows, states_of(rows))}
    if compare:
        at = datetime.now(timezone.utc) - (period.until - period.since)
        with get_db() as db:
            snap = stats_db.snapshot_near(db, at, area_ids)
        out["previous"] = None if snap is None else {
            "at": snap["ts"], "measured": int(snap["total"]), "online": int(snap["online"]),
            "online_pct": pct(snap["online"], snap["total"])}
    return out


@router.get("/availability")
def stat_availability(period: Window, area_ids: Scope,
                      compare: bool = Query(default=False, description="previous — oldingi teng davr")):
    """Davrdagi onlaynlik (kamera-soat bo'yicha, faqat kuzatilgan vaqtdan) va
    kameralarning uptime oraliqlari bo'yicha taqsimoti. `compare=1` —
    `previous`: oldingi teng davr uchun xuddi shu hisob (hodisalar 30 kun
    saqlanadi — undan eski qismi kuzatilmagan, coverage_pct shuni ko'rsatadi)."""
    out = metrics.availability(_snap(period, area_ids))
    if compare:
        out["previous"] = metrics.availability(_snap(previous_period(period), area_ids))
    return out


@router.get("/coverage")
def stat_coverage(period: Window, area_ids: Scope,
                  min_gap_minutes: int = Query(default=0, ge=0, le=1440)):
    """Kuzatuv qamrovi: server o'lchov yozmagan oraliqlar (90 daqiqadan uzun sukunat)."""
    return metrics.coverage(_snap(period, area_ids), min_gap_minutes)


@router.get("/series")
def stat_series(period: Window, area_ids: Scope,
                step: Literal["5m", "hour", "6h", "day"] = "5m"):
    """Onlaynlik qatori: har nuqtada kuzatilgan va onlayn kameralar soni.
    Kuzatuv bo'lmagan oraliqlar qaytmaydi (bo'shliq)."""
    with get_db() as db:
        points = stats_db.series(db, period.since, period.until, step, area_ids)
    return {**period.as_dict(), **metrics.series(points, step)}


@router.get("/sla")
def stat_sla(period: Window, area_ids: Scope,
             goal: float = Query(default=95.0, gt=0, le=100),
             step: Literal["5m", "hour"] = "5m"):
    """Maqsadga muvofiqlik: onlaynlik `goal` foizdan past bo'lgan vaqt va
    maqsadga yetishmagan kamera-soatlar."""
    with get_db() as db:
        points = stats_db.series(db, period.since, period.until, step, area_ids)
    return {**period.as_dict(), **metrics.sla(points, step, goal)}


@router.get("/outages/summary")
def stat_outage_summary(period: Window, area_ids: Scope):
    """Uzilishlar: haqiqiy / qisqa sakrash / tasvir to'xtashi, davom etayotganlar,
    MTTR (median, p90, o'rtacha), MTBF va eng uzun uzilish."""
    return metrics.outage_summary(_snap(period, area_ids))


@router.get("/outages")
def stat_outages(period: Window, area_ids: Scope,
                 kind: Literal["outage", "blip", "all"] = "outage",
                 open_only: bool = False,
                 camera_id: int | None = None,
                 sort: Literal["start", "duration"] = "start",
                 limit: int = Query(default=100, ge=1, le=1000),
                 offset: int = Query(default=0, ge=0)):
    """Uzilishlar jurnali (sahifalab). `open_only` — hali tiklanmaganlar."""
    return metrics.outage_list(_snap(period, area_ids), kind=kind, open_only=open_only,
                               camera_id=camera_id, sort=sort, limit=limit, offset=offset)


@router.get("/daily")
def stat_daily(period: Window, area_ids: Scope):
    """Kunlik kesim (mahalliy sana): onlaynlik, uzilishlar, sakrashlar, qamrov."""
    snap = _snap(period, area_ids)
    return {**period.as_dict(), "days": metrics.daily(snap)}


@router.get("/hourly")
def stat_hourly(area_ids: Scope, period: Window,
                day: date | None = Query(default=None,
                                         description="Bitta mahalliy kun (davr o'rniga)")):
    """Sutka soatlari kesimi: uzilishlar boshlanishi, o'chiq kamera-daqiqalar
    va eng zich uch soatlik oyna."""
    if day is not None:
        if not timedelta(0) <= today_local() - day <= timedelta(days=MAX_DAYS - 1):
            raise HTTPException(422, f"day oxirgi {MAX_DAYS} kun ichida boʻlsin")
        period = local_day(day)
    return metrics.hourly(_snap(period, area_ids))


@router.get("/heatmap")
def stat_heatmap(period: Window, area_ids: Scope,
                 mode: Literal["date", "weekday"] = "date",
                 kind: Literal["outage", "all"] = "outage"):
    """Uzilishlar xaritasi: sana × soat yoki hafta kuni × soat (kunlik o'rtacha)."""
    return metrics.heatmap(_snap(period, area_ids), mode, kind)


@router.get("/regions")
def stat_regions(period: Window, area_ids: Scope):
    """Hudud kesimi: hozirgi holat va davrdagi onlaynlik — eng yomoni birinchi."""
    snap = _snap(period, area_ids)
    return {**period.as_dict(), "regions": metrics.regions(snap, states_of(snap.rows))}


@router.get("/vendors")
def stat_vendors(period: Window, area_ids: Scope):
    """Kamera markalari kesimi: hozirgi holat, davrdagi onlaynlik, uzilishlar
    (kameraga nisbatan ham), MTTR, kodek/o'girish/UDP va modellar bo'yicha."""
    snap = _snap(period, area_ids)
    return {**period.as_dict(), "vendors": metrics.vendors(snap, states_of(snap.rows))}


@router.get("/ranking")
def stat_ranking(period: Window, area_ids: Scope,
                 by: Literal["offline_time", "outages", "blips", "flapping",
                             "stalls"] = "offline_time",
                 limit: int = Query(default=10, ge=1, le=500)):
    """Muammoli kameralar: o'chiq vaqt, uzilishlar, sakrashlar, beqarorlik
    (uzilish + sakrash) yoki tasvir to'xtashlari bo'yicha."""
    snap = _snap(period, area_ids)
    return metrics.ranking(snap, states_of(snap.rows), by, limit)


@router.get("/cameras/{camera_id}")
def stat_camera(camera_id: int, request: Request, period: Window):
    """Bitta kamera: davrdagi onlaynlik, uzilishlar ro'yxati, MTTR."""
    with get_db() as db:
        row = cameras.get(db, camera_id)
    if row is None:
        raise HTTPException(404, "Kamera topilmadi")
    check_area(row, allowed_areas(request))
    snap = _snap(period, None)
    cam = snap.camera(camera_id)
    if cam is None:
        raise HTTPException(409, "Kamera kuzatilmaydi (oʻchirilgan yoki RTSP emas)")
    return metrics.camera_detail(snap, cam, camera_state(row))


@router.get("/rail")
def stat_rail(area_ids: Scope, bin_km: float = Query(default=1.0, gt=0, le=100)):
    """Temir yo'l liniyasi bo'ylab hozirgi holat: har `bin_km` km da holatlar soni."""
    rows = _scoped_rows(area_ids)
    with get_db() as db:
        names = rail_db.line_names(db)
    return {"bin_km": bin_km, "lines": metrics.rail(rows, states_of(rows), names, bin_km)}


@router.get("/quality")
def stat_quality(area_ids: Scope):
    """Ma'lumot sifati: joylashuvi, hududi, km, kodeki, modeli yo'q yoki hech
    ko'rilmagan kameralar."""
    return quality(area_ids, _scoped_rows(area_ids))


@router.get("/feed")
def stat_feed(area_ids: Scope,
              limit: int = Query(default=40, ge=1, le=500),
              before_id: int | None = Query(default=None, description="Sahifalash: shu id dan eskilar"),
              kind: Literal["online", "offline"] | None = None,
              camera_id: int | None = None):
    """Holat o'zgarishlari lentasi (yangisi birinchi)."""
    with get_db() as db:
        rows = stats_db.changes(db, limit=limit, before_id=before_id, kind=kind,
                                camera_id=camera_id, area_ids=area_ids)
    items = [{"id": r["id"], "ts": r["ts"], "camera_id": r["camera_id"], "name": r["name"],
              "region": r["region"], "km": r["km"], "picket": r["picket"], "kind": r["kind"]}
             for r in rows]
    return {"items": items, "next_before_id": items[-1]["id"] if len(items) == limit else None}
