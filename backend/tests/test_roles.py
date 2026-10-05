"""Rollar va ko'rinish: admin, operator (hududlar), mehmon (PUBLIC_VIEW).

Servis asosiy tizimga qo'shilgach kirish uch yo'l bilan bo'ladi — kalit,
sessiya, mehmon. Bu testlar o'sha chegaralarni qulflaydi:

  * operator faqat o'z hududini ko'radi — ro'yxat, holat, oqim, surat,
    batch oqim va devor bir xil cheklovda;
  * operator boshqaruvga kira olmaydi, dashboard esa unga ochiq;
  * mehmon (PUBLIC_VIEW=1) faqat ko'radi, dashboard va boshqaruv yopiq;
  * mikroservisdan qolgan 1-migratsiya rollar/statistika jadvallarini
    endi o'chirmaydi.
"""
import pytest
from fastapi.testclient import TestClient

from api import config, create_app, deps, helpers
from database import get_db, init_db, users

KEY = {"X-API-Key": "test-kalit"}
PAROL = "sinov-parol-123"


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app()) as c:
        yield c


@pytest.fixture(autouse=True)
def _toza_hisob():
    deps._key_throttle._fails.clear()
    yield
    deps._key_throttle._fails.clear()


def _kamera(client, nom, hudud):
    r = client.post("/api/v1/admin/cameras", headers=KEY, json={
        "name": nom, "region": hudud, "source_type": "manual",
        "stream_url": f"https://misol.uz/{nom}.m3u8",
    })
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _foydalanuvchi(client, login, rol, hududlar=()):
    r = client.post("/api/v1/admin/users", headers=KEY, json={
        "username": login, "password": PAROL, "role": rol,
        "regions": list(hududlar),
    })
    assert r.status_code == 201, r.text
    return r.json()


def _kir(login):
    """Alohida mijoz — cookie boshqa testlarga o'tib ketmasin."""
    c = TestClient(create_app())
    r = c.post("/api/v1/auth/login", json={"username": login, "password": PAROL})
    assert r.status_code == 200, r.text
    return c


@pytest.fixture(scope="module")
def hududlar(client):
    """Ikki hududda bittadan kamera va bitta operator (faqat Andijon)."""
    a = _kamera(client, "rol-andijon", "Andijon")
    b = _kamera(client, "rol-buxoro", "Buxoro")
    _foydalanuvchi(client, "rol-operator", "operator", ["Andijon"])
    return {"andijon": a, "buxoro": b}


def test_operator_faqat_oz_hududini_koradi(client, hududlar):
    op = _kir("rol-operator")
    me = op.get("/api/v1/auth/me").json()
    assert me["role"] == "operator" and me["regions"] == ["Andijon"]

    nomlar = {c["name"] for c in op.get("/api/v1/cameras").json()["cameras"]}
    assert nomlar == {"rol-andijon"}

    holat = op.get("/api/v1/cameras/status?all=1").json()["cameras"]
    assert {c["id"] for c in holat} == {hududlar["andijon"]}


def test_operator_begona_kameraga_403(client, hududlar):
    op = _kir("rol-operator")
    begona, oz = hududlar["buxoro"], hududlar["andijon"]
    assert op.get(f"/api/v1/cameras/{begona}/stream").status_code == 403
    # Surat: manual kamerada surat yo'q (404) — hudud cheklovi IP'li
    # kamerada xuddi shu check_region orqali ishlaydi.
    assert op.post(f"/api/v1/cameras/{begona}/sub-bad").status_code == 403
    # O'z kamerasi ochiladi (manual — tayyor oqim manzili qaytadi).
    assert op.get(f"/api/v1/cameras/{oz}/stream").status_code == 200

    javob = op.post("/api/v1/streams", json={"ids": [begona, oz]}).json()
    assert javob["streams"][str(begona)] == {"error": "ruxsat yo'q"}
    assert "error" not in javob["streams"][str(oz)]


def test_operator_boshqaruvga_kirolmaydi(client, hududlar):
    op = _kir("rol-operator")
    assert op.get("/api/v1/admin/cameras").status_code == 403
    assert op.get("/api/v1/admin/users").status_code == 403
    assert op.get("/api/v1/admin/nodes").status_code == 403
    assert op.post("/api/v1/devices/scan", json={"ip": "10.0.0.1"}).status_code == 403
    # Dashboard — kirgan har kimga ochiq.
    assert op.get("/api/v1/stats/dashboard").status_code == 200


def test_admin_hammasini_koradi(client, hududlar):
    _foydalanuvchi(client, "rol-admin", "admin")
    ad = _kir("rol-admin")
    nomlar = {c["name"] for c in ad.get("/api/v1/cameras").json()["cameras"]}
    assert {"rol-andijon", "rol-buxoro"} <= nomlar
    assert ad.get("/api/v1/admin/users").status_code == 200


def test_foydalanuvchi_hududlari_saqlanadi(client):
    u = _foydalanuvchi(client, "rol-op2", "operator", ["Namangan", "Andijon", "andijon"])
    assert u["regions"] == ["Andijon", "Namangan"]
    # Hudud — faqat ro'yxatdagi nom; erkin matn rad etiladi.
    xato = client.post("/api/v1/admin/users", headers=KEY, json={
        "username": "rol-op3", "password": PAROL, "role": "operator",
        "regions": ["Andijon", "Yo'q-hudud"]})
    assert xato.status_code == 400 and "Yo'q-hudud" in xato.json()["detail"]
    r = client.put(f"/api/v1/admin/users/{u['id']}", headers=KEY,
                   json={"username": "rol-op2", "role": "admin",
                         "regions": ["Andijon"]})
    # Admin bo'lgach hududlar ahamiyatsiz — tozalanadi.
    assert r.status_code == 200 and r.json()["regions"] == []
    noto_g_ri = client.post("/api/v1/admin/users", headers=KEY, json={
        "username": "rol-x", "password": PAROL, "role": "superadmin"})
    assert noto_g_ri.status_code == 422


def test_mehmon_public_view(client, hududlar, monkeypatch):
    # O'chiq: kalit ham, sessiya ham yo'q — ko'rish yopiq.
    assert client.get("/api/v1/cameras").status_code == 401

    monkeypatch.setattr(deps, "PUBLIC_VIEW", True)
    monkeypatch.setattr(helpers, "PUBLIC_VIEW", True)
    mehmon = TestClient(create_app())
    nomlar = {c["name"] for c in mehmon.get("/api/v1/cameras").json()["cameras"]}
    assert {"rol-andijon", "rol-buxoro"} <= nomlar
    assert mehmon.get(f"/api/v1/cameras/{hududlar['buxoro']}/stream").status_code == 200
    # Mehmon faqat ko'radi.
    assert mehmon.get("/api/v1/stats/dashboard").status_code == 401
    assert mehmon.get("/api/v1/admin/cameras").status_code == 401


def test_me_public_view_bayrogi(client, monkeypatch):
    assert client.get("/api/v1/auth/me").json()["public_view"] is False
    from api import auth
    monkeypatch.setattr(auth, "PUBLIC_VIEW", True)
    assert client.get("/api/v1/auth/me").json()["public_view"] is True
    assert config.PUBLIC_VIEW is False      # conftest: PUBLIC_VIEW=0


def test_dashboard_kalitsiz_yopiq(client):
    assert client.get("/api/v1/stats/dashboard").status_code == 401
    assert client.get("/api/v1/stats/dashboard", headers=KEY).status_code == 200


def test_init_db_takror_chaqirilsa_hech_narsa_buzilmaydi():
    """Migratsiyalar bir martalik: ikkinchi `init_db` ma'lumotga tegmaydi,
    barcha jadvallar joyida va versiya oxirgi migratsiyada turadi."""
    from database.schema import latest_version

    init_db()
    init_db()
    with get_db() as db:
        jadvallar = {r[0] for r in db.execute(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public'")}
        assert {"organizations", "users", "sessions", "user_admin_areas",
                "user_rail_units", "admin_areas", "rail_lines", "rail_units",
                "devices", "cameras", "camera_status", "camera_events",
                "status_changes", "availability_snapshots", "media_nodes",
                "video_walls", "audit_log", "schema_version"} <= jadvallar
        assert db.execute("SELECT MAX(version) FROM schema_version"
                          ).fetchone()[0] == latest_version()
        uid = db.execute("SELECT id FROM users LIMIT 1").fetchone()[0]
        assert users.set_regions(db, uid, ["Jizzax", "Jizzax"]) == []
        assert users.region_names(db, uid) == ["Jizzax"]
        assert users.set_regions(db, uid, []) == []
