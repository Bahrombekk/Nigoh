"""Dashboard: uzoq davrli ishonchlilik hisoboti (GET /stats/overview).

Hozirgi dashboard bitta so'rov bilan chizadi — bu javob alohida
ko'rsatkich endpointlarining (stats/api.py) yig'indisi, hisob esa
`stats/reporting/` qatlamida. Hisob `reporting.engine` da 60 s
keshlanadi — dashboard har necha soniyada so'rasa ham bazaga og'irlik
tushmaydi.

Javob bo'limlari:

  * coverage — kuzatuv qamrovi va bo'shliqlari (server ishlamagan vaqt);
  * fleet    — butun park: uptime, haqiqiy uzilishlar, qisqa sakrashlar, MTTR;
  * regions  — hudud kesimi;
  * vendors  — kamera markalari va modellari kesimi;
  * most_offline / most_flapping — muammoli kameralar reytingi;
  * heatmap  — kun x soat uzilishlar xaritasi;
  * quality  — ma'lumot sifati (tuzatilishi kerak bo'lgan yozuvlar).

Tarkibi:
    overview(days, area_ids)   to'liq hisobot (days 1..MAX_DAYS ga keltiriladi)
    states_of(rows)            kamera id -> jonli holat (camera_state)
    quality(area_ids, rows)    ma'lumot sifati: har tur bo'yicha soni va
                               50 tagacha namuna
    BLIP_SECONDS               qisqa sakrash chegarasi (engine'dan)
    TOP_N                      reytinglardagi kameralar soni (10)

Ishlatadi: stats.reporting (engine, metrics, period), database.reports,
    camera.state, camera.monitoring.health.
Kim ishlatadi: stats/api.py (/overview; states_of va quality — /summary,
    /regions, /ranking, /rail, /quality), tests/test_overview.py.
"""
from __future__ import annotations

from camera.monitoring import health
from camera.state import camera_state
from database import get_db, reports
from stats.reporting import engine, metrics
from stats.reporting.period import MAX_DAYS, last_days

BLIP_SECONDS = engine.BLIP_SECONDS
TOP_N = 10


def states_of(rows) -> dict[int, str]:
    return {r["id"]: camera_state(r) for r in rows}


def quality(area_ids: list[int] | None, rows) -> dict:
    scope = None if area_ids is None else [r["id"] for r in rows]
    with get_db() as db:
        found = reports.data_quality(db, scope)
    return {k: {"count": len(v), "items": v[:50]} for k, v in found.items()}


def _compute(days: int, area_ids: list[int] | None) -> dict:
    snap = engine.snapshot(last_days(days), area_ids)
    states = states_of(snap.rows)
    avail = metrics.availability(snap)
    summary = metrics.outage_summary(snap)
    cov = metrics.coverage(snap, min_gap_minutes=60)
    heat = metrics.heatmap(snap, mode="date", kind="all")
    return {
        "days": days,
        "from": snap.period.since, "to": snap.period.until,
        "coverage": {"pct": cov["pct"], "gaps": cov["gaps"]},
        "fleet": {
            "cameras": avail["cameras"],
            "uptime_pct": avail["uptime_pct"],
            "outages": summary["outages"],
            "blips": summary["blips"],
            "stalls": summary["stalls"],
            "never_down": avail["never_down"],
            "mttr_median_s": summary["mttr"]["median_s"],
            "mttr_p90_s": summary["mttr"]["p90_s"],
            "blip_threshold_s": BLIP_SECONDS,
        },
        "regions": [{"region": g["region"], "cameras": g["cameras"], "outages": g["outages"],
                     "blips": g["blips"], "uptime_pct": g["uptime_pct"]}
                    for g in metrics.regions(snap, states)],
        "vendors": metrics.vendors(snap, states),
        "most_offline":metrics.ranking(snap, states, "offline_time", TOP_N)["items"],
        "most_flapping": metrics.ranking(snap, states, "flapping", TOP_N)["items"],
        "heatmap": [{"date": r["key"], "hours": r["hours"], "coverage_pct": r["coverage_pct"]}
                    for r in heat["rows"]],
        "quality": quality(area_ids, snap.rows),
        "health_checked": health.sweep_stats().get("at"),
    }


def overview(days: int, area_ids: list[int] | None) -> dict:
    """Hisob `reporting.engine` da 60 s keshlanadi — dashboard har necha
    soniyada so'rasa ham bazaga og'irlik tushmaydi."""
    return _compute(max(1, min(int(days), MAX_DAYS)), area_ids)
