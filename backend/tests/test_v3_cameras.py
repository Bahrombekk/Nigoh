"""v3: kameralar — yumshoq o'chirish (savat), boshqaruvda server tomonda filtr,
ommaviy amallar, eksport, fps/online_since, 24 soatlik lenta, ochilish vaqti,
statistika taqqoslash.

Ma'lumot "Qoraqalpog'iston" va "Toshkent viloyati" hududlarida.

Qulflanadigan qoidalar:
  * o'chirilgan kamera hamma joydan chiqadi (xarita, holat, boshqaruv, statistika,
    MediaMTX, health, guruhlar), 30 kun ichida qaytadi, keyin butunlay o'chadi;
    o'sha manzil/external_id bilan qayta qo'shish mumkin;
  * filtr va saralash butun bazada; counts — holat filtrisiz; facets;
  * bulk: test/delete/enable/disable, topilmagani ok: false;
  * eksport csv (BOM, parolsiz) va xlsx;
  * timeline_24h — 48 blok, eng yomon holat; availability_24h.
"""
import csv
import io
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import deps
from app.factory import create_app
from camera import trash
from camera.api.cameras import timeline_24h
from camera.media.mapping import cameras_for_mediamtx
from camera.monitoring import health, open_times
from core import security
from database import areas, cameras, get_db
from stats.reporting import engine
from stats.reporting.period import TZ
from tests.factories import add_camera, add_event

KEY = {"X-API-Key": "test-kalit"}
NOW = datetime.now(timezone.utc)
IPS = [f"10.82.0.{i}" for i in range(1, 7)]


@pytest.fixture(scope="module")
def data():
    with get_db() as db:
        f = "Qoraqalpog'iston"
        ids = {
            "on": add_camera(db, "v3c_on", name="3500/1 km Qo'qon", region=f, ip=IPS[0],
                             codec="H264", password_enc=security.encrypt("maxfiy-parol")),
            "off": add_camera(db, "v3c_off", name="Marg'ilon", region=f, ip=IPS[1], codec="H265"),
            "st": add_camera(db, "v3c_st", name="Quva", region=f, ip=IPS[2], codec="H264",
                             always_on=True),
            "dis": add_camera(db, "v3c_dis", name="Rishton", region=f, ip=IPS[3], enabled=False),
            "tv": add_camera(db, "v3c_tv", name="Chirchiq", region="Toshkent viloyati",
                             ip=IPS[4], external_id="v3c-ext"),
        }
        line = db.execute("SELECT id FROM rail_lines WHERE code = 'main'").fetchone()[0]
        db.execute("UPDATE cameras SET rail_line_id = %s, km = 3500, picket = 1 WHERE id = %s",
                   (line, ids["on"]))
        db.execute("UPDATE camera_status SET fps = 25 WHERE camera_id = %s", (ids["on"],))
        cameras.set_probe_result(db, ids["st"], error="parol: Login yoki parol noto'g'ri")
        area = areas.id_by_name(db, f)
    for ip in (IPS[0], IPS[2], IPS[4]):
        health.service._statuses[(ip, 554)] = True
    health.service._statuses[(IPS[1], 554)] = False
    engine.clear_cache()
    yield {**ids, "area": area}
    for ip in IPS:
        health.service._statuses.pop((ip, 554), None)
    with get_db() as db:
        for cid in ids.values():
            cameras.delete(db, cid)
        db.execute("DELETE FROM cameras WHERE slug LIKE 'v3c%%'")


@pytest.fixture(scope="module")
def client(data):
    with TestClient(create_app()) as c:
        yield c


@pytest.fixture(autouse=True)
def _toza():
    deps._key_throttle._fails.clear()
    yield


def _admin(client, **params):
    params.setdefault("region", "Qoraqalpog'iston")
    r = client.get("/api/v1/admin/cameras", headers=KEY, params=params)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- boshqaruv ro'yxati ----------

def test_filtr_counts_facets(client, data):
    body = _admin(client)
    assert body["counts"] == {"all": 4, "online": 1, "offline": 1, "stalled": 1,
                              "disabled": 1, "unknown": 0}
    assert body["total"] == 4 and body["limit"] == 100
    assert "Qoraqalpog'iston" in body["facets"]["regions"] and "Toshkent viloyati" in body["facets"]["regions"]
    assert {"h264", "h265", "unknown"} <= set(body["facets"]["codecs"])
    assert set(body["facets"]["modes"]) == {"always", "ondemand"}

    st = _admin(client, status="online,stalled")
    assert {c["name"] for c in st["cameras"]} == {"3500/1 km Qo'qon", "Quva"}
    assert st["counts"]["all"] == 4                       # counts holat filtrisiz
    assert {c["state"] for c in st["cameras"]} == {"online", "stalled"}

    assert [c["name"] for c in _admin(client, q="3500/1")["cameras"]] == ["3500/1 km Qo'qon"]
    assert [c["name"] for c in _admin(client, q=IPS[1])["cameras"]] == ["Marg'ilon"]
    assert _admin(client, q="v3c_st")["total"] == 1      # slug (URL'da ham bor)
    assert [c["name"] for c in _admin(client, codec="h265")["cameras"]] == ["Marg'ilon"]
    assert [c["name"] for c in _admin(client, mode="always")["cameras"]] == ["Quva"]
    both = _admin(client, region="Qoraqalpog'iston,Toshkent viloyati", q="v3c")
    assert both["total"] == 5


def test_saralash_va_sahifalash(client, data):
    names = [c["name"] for c in _admin(client, sort="name")["cameras"]]
    assert names == sorted(names, key=str.lower)
    assert [c["name"] for c in _admin(client, sort="-name")["cameras"]] == names[::-1]
    states = [c["state"] for c in _admin(client, sort="state")["cameras"]]
    assert states == ["online", "stalled", "offline", "disabled"]
    page = _admin(client, sort="name", limit=2, offset=2)
    assert [c["name"] for c in page["cameras"]] == names[2:4] and page["total"] == 4
    assert client.get("/api/v1/admin/cameras?sort=ip", headers=KEY).status_code == 422


# ---------- eksport ----------

def test_eksport_csv(client, data):
    r = client.get("/api/v1/admin/cameras/export", headers=KEY,
                   params={"format": "csv", "region": "Qoraqalpog'iston", "sort": "name"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    text = r.content.decode("utf-8")
    assert text.startswith("﻿")
    rows = list(csv.reader(io.StringIO(text.lstrip("﻿"))))
    assert rows[0][:4] == ["ID", "Nomi", "Hudud", "Holat"] and len(rows) == 5
    assert "maxfiy-parol" not in text and "password" not in text.lower()
    assert client.get("/api/v1/admin/cameras/export?format=pdf", headers=KEY).status_code == 422


def test_eksport_xlsx(client, data):
    openpyxl = pytest.importorskip("openpyxl")
    r = client.get("/api/v1/admin/cameras/export", headers=KEY,
                   params={"format": "xlsx", "region": "Qoraqalpog'iston"})
    assert r.status_code == 200
    ws = openpyxl.load_workbook(io.BytesIO(r.content)).active
    assert ws.max_row == 5 and ws.cell(1, 2).value == "Nomi"


# ---------- ommaviy amallar ----------

def test_bulk_enable_disable_test(client, data, monkeypatch):
    r = client.post("/api/v1/admin/cameras/bulk", headers=KEY, json={
        "action": "disable", "ids": [data["off"], 999999]})
    assert r.json()["results"] == [
        {"id": data["off"], "ok": True, "detail": "oʻchirildi"},
        {"id": 999999, "ok": False, "detail": "Kamera topilmadi"}]
    assert _admin(client, q="Marg'ilon")["cameras"][0]["enabled"] is False
    client.post("/api/v1/admin/cameras/bulk", headers=KEY, json={
        "action": "enable", "ids": [data["off"]]})
    assert _admin(client, q="Marg'ilon")["cameras"][0]["enabled"] is True

    calls = []

    def fake_probe(ip, port, path, user, pw):
        calls.append((ip, pw))
        return {"ok": ip == IPS[0], "message": "Ulandi" if ip == IPS[0] else "javob bermadi"}

    monkeypatch.setattr("camera.api.admin.probe", fake_probe)
    res = client.post("/api/v1/admin/cameras/bulk", headers=KEY, json={
        "action": "test", "ids": [data["on"], data["off"]]}).json()["results"]
    assert res == [{"id": data["on"], "ok": True, "detail": "Ulandi"},
                   {"id": data["off"], "ok": False, "detail": "javob bermadi"}]
    assert (IPS[0], "maxfiy-parol") in calls               # saqlangan parol ishlatildi
    assert client.post("/api/v1/admin/cameras/bulk", headers=KEY, json={
        "action": "test", "ids": list(range(1, 502))}).status_code == 422
    assert client.post("/api/v1/admin/cameras/bulk", headers=KEY, json={
        "action": "portlat", "ids": [1]}).status_code == 422


# ---------- yumshoq o'chirish ----------

def _hidden_everywhere(client, cid) -> list[str]:
    """Kamera hali ko'rinib turgan joylar ro'yxati (bo'sh — hamma joydan chiqqan)."""
    seen = []
    if cid in {c["id"] for c in client.get("/api/v1/cameras", headers=KEY).json()["cameras"]}:
        seen.append("cameras")
    if cid in {c["id"] for c in client.get("/api/v1/cameras/status?all=1",
                                           headers=KEY).json()["cameras"]}:
        seen.append("status")
    if cid in {c["id"] for c in _admin(client, region="", limit=500)["cameras"]}:
        seen.append("admin")
    if client.get(f"/api/v1/cameras/{cid}/details", headers=KEY).status_code != 404:
        seen.append("details")
    with get_db() as db:
        if cid in {r["id"] for r in cameras.list_rtsp(db)}:
            seen.append("health/list_rtsp")
        slug = db.execute("SELECT slug FROM cameras WHERE id = %s", (cid,)).fetchone()
        if slug and slug[0] in {c["slug"] for c in cameras_for_mediamtx(db)}:
            seen.append("mediamtx")
    return seen


def test_yumshoq_ochirish_va_tiklash(client, data):
    cid = data["tv"]
    gid = client.post("/api/v1/groups", headers=KEY, json={
        "name": "v3c-guruh", "camera_ids": [cid]}).json()["id"]
    engine.clear_cache()
    tv_area = areas_id("Toshkent viloyati")
    before = client.get(f"/api/v1/stats/summary?area_id={tv_area}", headers=KEY).json()["total"]
    try:
        r = client.delete(f"/api/v1/admin/cameras/{cid}", headers=KEY)
        assert r.status_code == 200
        body = r.json()
        until = datetime.fromisoformat(body["restore_until"])
        assert body["id"] == cid and timedelta(days=29) < until - NOW < timedelta(days=31)
        assert _hidden_everywhere(client, cid) == []
        groups = client.get("/api/v1/groups", headers=KEY).json()["groups"]
        assert next(g for g in groups if g["id"] == gid)["camera_ids"] == []
        engine.clear_cache()
        assert client.get(f"/api/v1/stats/summary?area_id={tv_area}",
                          headers=KEY).json()["total"] == before - 1
        assert client.delete(f"/api/v1/admin/cameras/{cid}", headers=KEY).status_code == 404
        trash_list = client.get("/api/v1/admin/cameras/deleted", headers=KEY).json()
        assert cid in {c["id"] for c in trash_list["cameras"]} and trash_list["keep_days"] == 30

        r = client.post(f"/api/v1/admin/cameras/{cid}/restore", headers=KEY)
        assert r.status_code == 200 and r.json()["id"] == cid
        assert _hidden_everywhere(client, cid) == ["cameras", "status", "admin", "details",
                                                   "health/list_rtsp", "mediamtx"]
        groups = client.get("/api/v1/groups", headers=KEY).json()["groups"]
        assert next(g for g in groups if g["id"] == gid)["camera_ids"] == [cid]
        assert client.post(f"/api/v1/admin/cameras/{cid}/restore", headers=KEY).status_code == 404
        acts = [i["action"] for i in client.get("/api/v1/admin/audit?entity=camera",
                                                headers=KEY).json()["items"]]
        assert "camera.delete" in acts and "camera.restore" in acts
    finally:
        client.delete(f"/api/v1/groups/{gid}", headers=KEY)


def areas_id(name):
    with get_db() as db:
        return areas.id_by_name(db, name)


def test_muddati_otgan_tiklanmaydi_va_tozalanadi(client):
    with get_db() as db:
        old = add_camera(db, "v3c_old", region="Qoraqalpog'iston", ip="10.82.0.9")
        new = add_camera(db, "v3c_new", region="Qoraqalpog'iston", ip="10.82.0.10")
        cameras.soft_delete(db, old)
        cameras.soft_delete(db, new)
        db.execute("UPDATE cameras SET deleted_at = now() - interval '31 days' WHERE id = %s",
                   (old,))
    assert client.post(f"/api/v1/admin/cameras/{old}/restore", headers=KEY).status_code == 404
    assert trash.purge(force=True) >= 1
    with get_db() as db:
        assert db.execute("SELECT 1 FROM cameras WHERE id = %s", (old,)).fetchone() is None
        assert cameras.get_deleted(db, new) is not None           # 30 kun to'lmagan — qoladi
        assert db.execute("SELECT 1 FROM devices WHERE host = '10.82.0.9'").fetchone() is None
        cameras.delete(db, new)
    assert trash.purge() is None                                  # soatiga bir


def test_ochirilgandan_keyin_qayta_qoshish(client):
    r = client.post("/api/v1/admin/cameras", headers=KEY, json={
        "name": "v3c qayta", "region": "Qoraqalpog'iston", "source_type": "manual",
        "stream_url": "https://misol.uz/v3c.m3u8", "external_id": "v3c-qayta"})
    first = r.json()["id"]
    assert client.delete(f"/api/v1/admin/cameras/{first}", headers=KEY).status_code == 200
    r = client.post("/api/v1/admin/cameras", headers=KEY, json={
        "name": "v3c qayta", "region": "Qoraqalpog'iston", "source_type": "manual",
        "stream_url": "https://misol.uz/v3c.m3u8", "external_id": "v3c-qayta"})
    assert r.status_code == 201, r.text
    second = r.json()["id"]
    assert second != first
    with get_db() as db:
        assert cameras.get_deleted(db, first) is None             # savatdagisi butunlay ketdi
        cameras.delete(db, second)


def test_bulk_delete(client):
    with get_db() as db:
        a = add_camera(db, "v3c_b1", region="Qoraqalpog'iston", ip="10.82.0.11")
    res = client.post("/api/v1/admin/cameras/bulk", headers=KEY, json={
        "action": "delete", "ids": [a]}).json()["results"]
    assert res[0]["ok"] and res[0]["detail"].startswith("savatda")
    with get_db() as db:
        assert cameras.get(db, a) is None and cameras.get_deleted(db, a) is not None
        cameras.delete(db, a)


# ---------- xarita ro'yxati va kamera paneli ----------

def test_fps_va_online_since(client, data):
    with get_db() as db:
        add_event(db, "offline", "v3c_on", NOW - timedelta(hours=2))
        add_event(db, "online", "v3c_on", NOW - timedelta(hours=1))
    cams = {c["id"]: c for c in client.get("/api/v1/cameras", headers=KEY).json()["cameras"]}
    on = cams[data["on"]]
    assert on["fps"] == 25.0
    assert abs(datetime.fromisoformat(on["online_since"]) - (NOW - timedelta(hours=1))) \
        < timedelta(seconds=5)
    assert cams[data["off"]]["fps"] is None and cams[data["off"]]["online_since"] is None
    assert on["state"] == "online" and cams[data["st"]]["state"] == "stalled"


def test_details_timeline_24h(client, data):
    body = client.get(f"/api/v1/cameras/{data['on']}/details", headers=KEY).json()
    tl = body["timeline_24h"]
    assert len(tl) == 48
    starts = [datetime.fromisoformat(b["t"]) for b in tl]
    assert all(b - a == timedelta(minutes=30) for a, b in zip(starts, starts[1:]))
    assert starts[-1] <= datetime.now(timezone.utc) < starts[-1] + timedelta(minutes=30)
    assert all(b["state"] in ("online", "stalled", "offline", "unknown") for b in tl)
    assert any(b["state"] == "offline" for b in tl)
    assert body["online_since"] is not None
    assert body["availability_24h"] is not None and body["availability_24h"] < 100


def test_timeline_eng_yomon_holat():
    now = datetime(2026, 10, 8, 12, 10, tzinfo=timezone.utc)
    with get_db() as db:
        cid = add_camera(db, "v3c_tl", region="Qoraqalpog'iston", ip="10.82.0.12")
        db.execute("UPDATE cameras SET created_at = %s WHERE id = %s",
                   (now - timedelta(days=2), cid))
        add_event(db, "online", "v3c_tl", now - timedelta(days=1, hours=1))
        add_event(db, "offline", "v3c_tl", now - timedelta(hours=2, minutes=5))
        add_event(db, "online", "v3c_tl", now - timedelta(hours=2))
        add_event(db, "stalled", "v3c_tl", now - timedelta(minutes=50))
        add_event(db, "resumed", "v3c_tl", now - timedelta(minutes=45))
        add_event(db, "stalled", "v3c_tl_sub", now - timedelta(minutes=5))   # sub — hisobga olinmaydi
        row = cameras.get(db, cid)
        tl, avail = timeline_24h(db, row, now)
        cameras.delete(db, cid)
    states = [b["state"] for b in tl]
    assert tl[-1]["t"] == "2026-10-08T12:00:00+00:00"
    assert states[-1] == "online"                       # 12:00–12:10, sub muzlashi emas
    assert states[-3] == "stalled"                      # 11:00–11:30 (11:20–11:25)
    assert states[-5] == "offline"                      # 10:00–10:30 (10:05–10:10)
    assert states.count("offline") == 1 and states.count("stalled") == 1
    assert avail == pytest.approx(100 * (1 - 300 / (24 * 3600 - 1200)), abs=0.1)


def test_metrics_open_camera_id(client, data):
    open_times.reset()
    for ms in (900, 1500, 1200):
        client.post("/api/v1/metrics/open", headers=KEY, json={
            "camera_id": data["on"], "transport": "webrtc", "total_ms": ms})
    body = client.get(f"/api/v1/metrics/open?camera_id={data['on']}", headers=KEY).json()
    assert body["camera_id"] == data["on"] and body["n"] == 3 and body["median_ms"] == 1200
    assert [o["total_ms"] for o in body["opens"]] == [1200, 1500, 900]     # yangisi birinchi
    empty = client.get(f"/api/v1/metrics/open?camera_id={data['off']}", headers=KEY).json()
    assert empty["n"] == 0 and empty["median_ms"] is None and empty["opens"] == []
    assert client.get("/api/v1/metrics/open?camera_id=999999", headers=KEY).status_code == 404
    open_times.reset()


# ---------- statistika ----------

def test_stats_compare_va_6h(client, data):
    with get_db() as db:
        for hours, online in ((26, 1), (24, 2), (6, 3), (3, 3)):
            db.execute("INSERT INTO availability_snapshots (ts, organization_id, admin_area_id, "
                       "total, online) VALUES (%s, 1, %s, 4, %s) ON CONFLICT DO NOTHING",
                       (NOW - timedelta(hours=hours, minutes=1), data["area"], online))
    engine.clear_cache()
    p = {"area_id": data["area"]}
    s = client.get("/api/v1/stats/summary", headers=KEY, params={**p, "compare": 1}).json()
    assert s["previous"]["measured"] == 4 and s["previous"]["online"] == 2
    assert s["previous"]["online_pct"] == 50.0
    assert "previous" not in client.get("/api/v1/stats/summary", headers=KEY, params=p).json()
    a = client.get("/api/v1/stats/availability", headers=KEY,
                   params={**p, "compare": 1}).json()
    assert set(a["previous"]) >= {"uptime_pct", "coverage_pct", "cameras", "from", "to"}
    assert datetime.fromisoformat(a["previous"]["to"]) == datetime.fromisoformat(a["from"])
    ser = client.get("/api/v1/stats/series", headers=KEY,
                     params={**p, "days": 2, "step": "6h"}).json()
    assert ser["step"] == "6h" and ser["points"]
    ts = [datetime.fromisoformat(x["ts"]) for x in ser["points"]]
    assert all(t.astimezone(TZ).hour % 6 == 0 and t.astimezone(TZ).minute == 0 for t in ts)
