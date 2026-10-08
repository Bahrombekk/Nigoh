"""v3: bildirishnomalar — kamera uzilishlari + tizim bildirishnomalari, o'qilganlik.

Ma'lumot "Surxondaryo" va "Qoraqalpog'iston" hududlarida (boshqa testlarga aralashmasin).

Qulflanadigan qoidalar:
  * matnlar: hali uzilgan — "N kundan/soatdan beri javob yoʻq", tiklangan online —
    "<hudud> · N daqiqa uzilish";
  * operator faqat o'z hududi kamera hodisalarini ko'radi (tizim — hammaga);
  * o'qilganlik foydalanuvchi bo'yicha: ids yoki all; unread/counts — 7 kun;
  * type filtri, `before` bilan sahifalash (bir xil vaqtli hodisalar yo'qolmaydi);
  * notify_outage o'chiq — kamera hodisalari yo'q; savatdagi kamera hodisalari yo'q.
"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import deps
from app.factory import create_app
from database import cameras, get_db, notifications
from notifications.service import duration_text
from tests.factories import add_camera, add_event

KEY = {"X-API-Key": "test-kalit"}
PAROL = "sinov-parol-123"
NOW = datetime.now(timezone.utc)


@pytest.fixture(scope="module")
def data():
    with get_db() as db:
        db.execute("DELETE FROM camera_events")
        db.execute("DELETE FROM system_alerts")
        a = add_camera(db, "nt_a", name="3403/6 km", region="Surxondaryo", ip="10.81.0.1")
        b = add_camera(db, "nt_b", name="Jarqo'rg'on", region="Surxondaryo", ip="10.81.0.2")
        c = add_camera(db, "nt_c", name="Nukus", region="Qoraqalpog'iston", ip="10.81.0.3")
        add_event(db, "offline", "nt_a", NOW - timedelta(days=17))          # hali uzilgan
        add_event(db, "offline", "nt_b", NOW - timedelta(hours=3))
        add_event(db, "online", "nt_b", NOW - timedelta(hours=3) + timedelta(seconds=70))
        add_event(db, "offline", "nt_c", NOW - timedelta(hours=2))
        add_event(db, "stalled", "nt_c", NOW - timedelta(hours=1))           # lentaga kirmaydi
        s = notifications.add_alert(db, "disk", True, "warning", "Disk 85% band", "Joy kam")
        # 8 kun oldingi hodisa — lentada bor, unread'ga kirmaydi.
        add_event(db, "offline", "nt_c", NOW - timedelta(days=8))
    yield {"a": a, "b": b, "c": c, "s": s}
    with get_db() as db:
        for cid in (a, b, c):
            cameras.delete(db, cid)
        db.execute("DELETE FROM system_alerts")


@pytest.fixture(scope="module")
def client(data):
    with TestClient(create_app()) as c:
        c.post("/api/v1/admin/users", headers=KEY, json={
            "username": "nt-op", "password": PAROL, "role": "operator",
            "regions": ["Surxondaryo"]})
        c.post("/api/v1/admin/users", headers=KEY, json={
            "username": "nt-admin", "password": PAROL, "role": "admin"})
        yield c


@pytest.fixture(autouse=True)
def _toza(client):
    deps._key_throttle._fails.clear()
    yield
    client.put("/api/v1/admin/settings", headers=KEY, json={"values": {"notify_outage": None}})


def _kir(login):
    c = TestClient(create_app())
    assert c.post("/api/v1/auth/login", json={"username": login, "password": PAROL}).status_code == 200
    return c


def test_davomiylik_matni():
    assert duration_text(30) == "1 daqiqa"
    assert duration_text(70) == "1 daqiqa"
    assert duration_text(3 * 3600 + 5) == "3 soat"
    assert duration_text(17 * 86400) == "17 kun"


def test_lenta_va_matnlar(client, data):
    ad = _kir("nt-admin")
    body = ad.get("/api/v1/notifications").json()
    items = {i["id"]: i for i in body["items"]}
    sys_item = items[f"s{data['s']}"]
    assert sys_item["type"] == "system" and sys_item["camera_id"] is None
    assert sys_item["severity"] == "warning" and sys_item["title"] == "Disk 85% band"
    a = next(i for i in body["items"] if i["camera_id"] == data["a"])
    assert a["type"] == "offline" and a["severity"] == "error"
    assert a["title"] == "3403/6 km uzildi"
    assert a["text"] == "Surxondaryo · 17 kundan beri javob yoʻq"
    b = [i for i in body["items"] if i["camera_id"] == data["b"]]
    assert [i["type"] for i in b] == ["online", "offline"]          # yangisi birinchi
    assert b[0]["text"] == "Surxondaryo · 1 daqiqa uzilish" and b[0]["severity"] == "success"
    assert b[1]["text"] == "Surxondaryo · 1 daqiqadan keyin tiklandi"
    assert all(set(i) == {"id", "type", "title", "text", "ts", "camera_id", "severity", "read"}
               for i in body["items"])
    assert not any(i["type"] == "stalled" for i in body["items"])
    # 7 kunlik unread: b×2, c (2 soat) + tizim = 4; 17 kunlik a va 8 kunlik c kirmaydi.
    assert body["counts"] == {"all": 4, "outage": 3, "system": 1} and body["unread"] == 4
    assert len(body["items"]) == 6


def test_operator_oz_hududi(client, data):
    op = _kir("nt-op")
    body = op.get("/api/v1/notifications").json()
    cams = {i["camera_id"] for i in body["items"] if i["camera_id"]}
    assert cams == {data["a"], data["b"]}
    assert body["counts"] == {"all": 3, "outage": 2, "system": 1}


def test_type_filtri_va_sahifalash(client, data):
    ad = _kir("nt-admin")
    assert {i["type"] for i in ad.get("/api/v1/notifications?type=system").json()["items"]} == {"system"}
    assert "system" not in {i["type"] for i in
                            ad.get("/api/v1/notifications?type=outage").json()["items"]}
    seen, before = [], None
    while True:
        url = "/api/v1/notifications?limit=2" + (f"&before={before}" if before else "")
        page = ad.get(url).json()["items"]
        if not page:
            break
        seen += [i["id"] for i in page]
        before = page[-1]["id"]
    assert len(seen) == len(set(seen)) == 6
    assert ad.get("/api/v1/notifications?before=x1").status_code == 422
    assert ad.get("/api/v1/notifications?before=e999999999").json()["items"] == []


def test_oqilganlik_foydalanuvchi_boyicha(client, data):
    op = _kir("nt-op")
    first = op.get("/api/v1/notifications").json()["items"][0]
    r = op.post("/api/v1/notifications/read", json={"ids": [first["id"]]})
    assert r.status_code == 200 and r.json() == {"unread": 2}
    items = {i["id"]: i for i in op.get("/api/v1/notifications").json()["items"]}
    assert items[first["id"]]["read"] is True
    # Boshqa foydalanuvchida o'qilmagan.
    ad = _kir("nt-admin")
    assert ad.get("/api/v1/notifications").json()["unread"] == 4
    assert op.post("/api/v1/notifications/read", json={"all": True}).json() == {"unread": 0}
    body = op.get("/api/v1/notifications").json()
    assert body["unread"] == 0 and all(i["read"] for i in body["items"])
    assert op.post("/api/v1/notifications/read", json={}).status_code == 422
    assert op.post("/api/v1/notifications/read", json={"ids": ["zzz"]}).status_code == 422
    # Yangi hodisa — yana o'qilmagan.
    with get_db() as db:
        add_event(db, "online", "nt_a")
    assert op.get("/api/v1/notifications").json()["unread"] == 1


def test_mehmonga_yopiq_kalit_ochiq(client):
    assert TestClient(create_app()).get("/api/v1/notifications").status_code == 401
    assert client.get("/api/v1/notifications", headers=KEY).status_code == 200


def test_notify_outage_ochiq_emas(client, data):
    client.put("/api/v1/admin/settings", headers=KEY, json={"values": {"notify_outage": False}})
    body = _kir("nt-admin").get("/api/v1/notifications").json()
    assert {i["type"] for i in body["items"]} == {"system"}
    assert body["counts"]["outage"] == 0


def test_savatdagi_kamera_hodisalari_yoq(client, data):
    ad = _kir("nt-admin")
    assert client.delete(f"/api/v1/admin/cameras/{data['c']}", headers=KEY).status_code == 200
    try:
        body = ad.get("/api/v1/notifications").json()
        assert data["c"] not in {i["camera_id"] for i in body["items"]}
    finally:
        assert client.post(f"/api/v1/admin/cameras/{data['c']}/restore",
                           headers=KEY).status_code == 200
