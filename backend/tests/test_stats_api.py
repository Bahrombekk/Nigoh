"""Statistika ko'rsatkichlari: har biri alohida endpoint (stats/api.py,
hisob — reporting/).

Ma'lumot boshqa testlarga aralashmasin deb hammasi "Andijon" hududida
va so'rovlar `area_id` bilan shu hududga cheklanadi.

Qulflanadigan qoidalar:
  * kuzatuv bo'shlig'i uptime'ga ham, uzilish davomiyligiga ham kirmaydi;
  * 2 daqiqadan qisqa, tugagan uzilish — sakrash; davom etayotgani — uzilish;
  * kunlik/soatlik kesimlar jamisi umumiy hisob bilan mos;
  * operator begona hududni so'rasa — 403.
"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.factory import create_app
from database import areas, get_db
from stats.reporting import engine
from tests.factories import add_camera, add_event

NOW = datetime.now(timezone.utc)
KEY = {"X-API-Key": "test-kalit"}


def _ago(**kw) -> datetime:
    return NOW - timedelta(**kw)


@pytest.fixture(scope="module")
def data():
    with get_db() as db:
        area = areas.id_by_name(db, "Andijon")
        # Oxirgi 6 soat kuzatilgan: 5 daqiqalik suratlar (Andijon: 3 kameradan 2 tasi onlayn).
        t = _ago(hours=6)
        while t <= NOW:
            db.execute("INSERT INTO availability_snapshots (ts, organization_id, admin_area_id, "
                       "total, online) VALUES (%s, 1, %s, 3, 2) ON CONFLICT DO NOTHING", (t, area))
            t += timedelta(minutes=5)
        a = add_camera(db, "st_a", region="Andijon", ip="10.78.0.1")
        b = add_camera(db, "st_b", region="Andijon", ip="10.78.0.2")
        c = add_camera(db, "st_c", region="Andijon", ip="10.78.0.3")
        line = db.execute("SELECT id FROM rail_lines WHERE code = 'main'").fetchone()[0]
        db.execute("UPDATE cameras SET rail_line_id = %s, km = 100, picket = 5 WHERE id = %s",
                   (line, a))
        db.execute("UPDATE cameras SET rail_line_id = %s, km = 101 WHERE id = %s", (line, b))
        # A: 60 s sakrash va 1 soatlik haqiqiy uzilish.
        add_event(db, "offline", "st_a", _ago(hours=5))
        add_event(db, "online", "st_a", _ago(hours=5) + timedelta(seconds=60))
        add_event(db, "offline", "st_a", _ago(hours=3))
        add_event(db, "online", "st_a", _ago(hours=2))
        # B: 1 soat oldin uzilgan, hali qaytmagan.
        add_event(db, "offline", "st_b", _ago(hours=1))
        # C: tasvir to'xtashi (uzilish emas).
        add_event(db, "stalled", "st_c", _ago(hours=2))
        for ts, cam, kind in ((_ago(hours=3), a, "offline"), (_ago(hours=2), a, "online"),
                              (_ago(hours=1), b, "offline")):
            db.execute("INSERT INTO status_changes (ts, camera_id, kind) VALUES (%s, %s, %s)",
                       (ts, cam, kind))
    engine.clear_cache()
    return {"area": area, "a": a, "b": b, "c": c}


@pytest.fixture(scope="module")
def client(data):
    with TestClient(create_app()) as c:
        yield c


def _in_area(data) -> int:
    """Hududdagi kameralar soni — boshqa testlar ham shu hududga qo'shishi mumkin."""
    with get_db() as db:
        return db.execute("SELECT COUNT(*) FROM cameras WHERE admin_area_id = %s",
                          (data["area"],)).fetchone()[0]


def get(client, data, path, **params):
    params.setdefault("area_id", data["area"])
    r = client.get("/api/v1/stats/" + path, params=params, headers=KEY)
    assert r.status_code == 200, r.text
    return r.json()


def test_summary_hozirgi_holat(client, data):
    body = get(client, data, "summary")
    assert body["total"] == _in_area(data)
    assert sum(body["by_state"].values()) == body["total"]
    assert body["with_km"] == 2


def test_availability_kuzatilgan_vaqtdan(client, data):
    body = get(client, data, "availability")
    assert body["cameras"] == 3
    assert 20 <= body["coverage_pct"] <= 30
    observed = body["camera_hours_observed"]
    # A: 1 soat + 60 s, B: 1 soat — jami ~2,02 kamera-soat o'chiq.
    assert body["camera_hours_offline"] == pytest.approx(2.0, abs=0.1)
    assert body["uptime_pct"] == pytest.approx(100 * (1 - 2.017 / observed), abs=0.3)
    assert sum(b["cameras"] for b in body["distribution"]) == 3
    assert body["never_down"] == 1


def test_outages_summary_turlari(client, data):
    body = get(client, data, "outages/summary")
    assert (body["outages"], body["blips"], body["stalls"]) == (2, 1, 1)
    assert body["open_now"] == 1
    # MTTR faqat tiklangan haqiqiy uzilishdan (A: 1 soat).
    assert body["mttr"]["recovered"] == 1
    assert body["mttr"]["median_s"] == pytest.approx(3600, abs=5)
    assert body["longest"]["camera_id"] in (data["a"], data["b"])


def test_outages_jurnali_filtrlar(client, data):
    allx = get(client, data, "outages", kind="all")
    assert allx["total"] == 3
    blips = get(client, data, "outages", kind="blip")
    assert [i["camera_id"] for i in blips["items"]] == [data["a"]]
    open_ = get(client, data, "outages", open_only="true")
    assert [(i["camera_id"], i["end"]) for i in open_["items"]] == [(data["b"], None)]
    by_dur = get(client, data, "outages", kind="all", sort="duration", limit=1)
    assert by_dur["total"] == 3 and len(by_dur["items"]) == 1


def test_kunlik_va_soatlik_jami_mos(client, data):
    summary = get(client, data, "outages/summary")
    daily = get(client, data, "daily", days=2)["days"]
    assert sum(d["outages"] for d in daily) == summary["outages"]
    assert sum(d["blips"] for d in daily) == summary["blips"]
    hourly = get(client, data, "hourly")
    assert sum(hourly["outages"]) == summary["outages"]
    assert sum(hourly["offline_camera_minutes"]) == pytest.approx(121, abs=2)


def test_heatmap_rejimlari(client, data):
    by_date = get(client, data, "heatmap", days=2)
    assert all(len(r["hours"]) == 24 for r in by_date["rows"])
    assert sum(sum(r["hours"]) for r in by_date["rows"]) == 2
    week = get(client, data, "heatmap", days=7, mode="weekday", kind="all")
    assert [r["key"] for r in week["rows"]] == list(range(1, 8))


def test_regions_va_ranking(client, data):
    regions = get(client, data, "regions")["regions"]
    assert [r["region"] for r in regions] == ["Andijon"]
    assert regions[0]["outages"] == 2 and regions[0]["blips"] == 1
    top = get(client, data, "ranking", by="flapping")
    assert top["items"][0]["id"] == data["a"]
    stalls = get(client, data, "ranking", by="stalls")
    assert [i["id"] for i in stalls["items"]] == [data["c"]]


def test_series_va_sla(client, data):
    series = get(client, data, "series", step="hour")
    assert series["points"] and all(p["pct"] == pytest.approx(66.67, abs=0.01)
                                    for p in series["points"])
    sla = get(client, data, "sla", goal=95)
    assert sla["in_goal_slots"] == 0
    # Har 5 daqiqada maqsadga 3*0,95 - 2 = 0,85 kamera yetmaydi.
    assert sla["deficit_camera_hours"] == pytest.approx(0.85 * sla["observed_slots"] / 12,
                                                        abs=0.1)


def test_kamera_tafsiloti(client, data):
    r = client.get(f"/api/v1/stats/cameras/{data['a']}", headers=KEY)
    assert r.status_code == 200
    body = r.json()
    assert (body["outages"], body["blips"]) == (1, 1)
    assert len(body["items"]) == 2
    assert client.get("/api/v1/stats/cameras/999999", headers=KEY).status_code == 404


def test_rail_feed_quality(client, data):
    lines = get(client, data, "rail", bin_km=1)["lines"]
    bins = [b for line in lines for b in line["bins"]]
    assert [b["from_km"] for b in bins] == [100, 101]
    feed = get(client, data, "feed", limit=2)
    assert len(feed["items"]) == 2 and feed["next_before_id"] is not None
    rest = get(client, data, "feed", before_id=feed["next_before_id"])
    assert len(rest["items"]) == 1
    quality = get(client, data, "quality")
    ids = {i["id"] for i in quality["no_location"]["items"]}
    assert {data["a"], data["b"], data["c"]} <= ids


def test_parametr_chegaralari(client, data):
    h = KEY
    assert client.get("/api/v1/stats/availability?days=31", headers=h).status_code == 422
    assert client.get("/api/v1/stats/availability?from=2026-01-02&to=2026-01-01",
                      headers=h).status_code == 422
    assert client.get("/api/v1/stats/ranking?by=nimadir", headers=h).status_code == 422
    assert client.get("/api/v1/stats/hourly?day=2000-01-01", headers=h).status_code == 422
    assert client.get("/api/v1/stats/summary").status_code in (401, 403)


def test_aniq_sana_oraligi(client, data):
    from stats.reporting.period import today_local
    today = today_local().isoformat()
    body = get(client, data, "outages/summary", **{"from": today, "to": today})
    assert body["days"] <= 1
