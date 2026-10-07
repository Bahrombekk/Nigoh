"""Super-admin sozlamalari, audit jurnali va foydalanuvchini bloklash.

Qulflanadigan qoidalar:
  * sozlama tekshiriladi (tur, chegara); bittasi xato bo'lsa hech biri
    saqlanmaydi; null — standartga qaytaradi;
  * o'zgarish server qayta ishga tushmasdan qo'llanadi (/auth/me, sessiya
    muddati, muzlash chegarasi);
  * har o'zgarish audit jurnaliga yoziladi, parol hech qachon yozilmaydi;
  * audit yozuvi bor foydalanuvchini o'chirish mumkin (audit_log FK);
  * bloklangan foydalanuvchi kira olmaydi, ochiq sessiyasi yopiladi;
    o'zini va oxirgi faol adminni bloklab bo'lmaydi;
  * sozlamalar va audit faqat adminga.
"""
import pytest
from fastapi.testclient import TestClient

from app import deps
from app.factory import create_app
from app.settings import site_settings

KEY = {"X-API-Key": "test-kalit"}
PAROL = "sinov-parol-123"


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app()) as c:
        yield c


@pytest.fixture(autouse=True)
def _toza(client):
    deps._key_throttle._fails.clear()
    yield
    client.put("/api/v1/admin/settings", headers=KEY, json={"values": {
        "site_name": None, "session_hours": None, "stall_after_s": None}})


def _put(client, values):
    return client.put("/api/v1/admin/settings", headers=KEY, json={"values": values})


def _setting(client, key):
    items = client.get("/api/v1/admin/settings", headers=KEY).json()["settings"]
    return next(s for s in items if s["key"] == key)


def test_royxat_va_standart(client):
    s = _setting(client, "stall_after_s")
    assert s["value"] == s["default"] == 20 and not s["changed"]
    assert (s["min"], s["max"], s["unit"]) == (10, 300, "s")


def test_tekshiruv_hammasi_yoki_hech_biri(client):
    r = _put(client, {"site_name": "Temir yo'l", "stall_after_s": 5})
    assert r.status_code == 422 and "10–300" in r.json()["detail"]
    assert _setting(client, "site_name")["value"] == "NIGOH"       # birinchisi ham saqlanmadi
    assert _put(client, {"session_hours": "12"}).status_code == 422
    assert _put(client, {"public_view": 1}).status_code == 422
    assert _put(client, {"noma_lum": 1}).status_code == 422


def test_jonli_qollanadi_va_standartga_qaytadi(client):
    r = _put(client, {"site_name": "  Temir yo'l nazorati ", "stall_after_s": 45})
    assert r.status_code == 200 and r.json()["changed"] == ["site_name", "stall_after_s"]
    assert client.get("/api/v1/auth/me").json()["site_name"] == "Temir yo'l nazorati"
    assert site_settings.get("stall_after_s") == 45                   # reconciler shu qiymatni oladi
    s = _setting(client, "site_name")
    assert s["changed"] and s["updated_by"] == "api-kalit"
    _put(client, {"site_name": None})
    assert client.get("/api/v1/auth/me").json()["site_name"] == "NIGOH"


def test_sessiya_muddati_yangi_kirishga(client):
    client.post("/api/v1/admin/users", headers=KEY, json={
        "username": "set-op", "password": PAROL, "role": "operator"})
    _put(client, {"session_hours": 2})
    c = TestClient(create_app())
    r = c.post("/api/v1/auth/login", json={"username": "set-op", "password": PAROL})
    assert r.status_code == 200
    assert "Max-Age=7200" in r.headers["set-cookie"]


def test_audit_va_parol_yozilmaydi(client):
    _put(client, {"stall_after_s": 30})
    u = client.post("/api/v1/admin/users", headers=KEY, json={
        "username": "set-audit", "password": PAROL, "role": "operator", "full_name": "Sinov"}).json()
    client.put(f"/api/v1/admin/users/{u['id']}", headers=KEY, json={
        "username": "set-audit", "password": "yangi-parol-456", "role": "operator", "full_name": "Sinov"})
    items = client.get("/api/v1/admin/audit?limit=20", headers=KEY).json()["items"]
    acts = [(i["action"], i["entity_id"]) for i in items]
    assert ("settings.update", None) in acts and ("user.create", str(u["id"])) in acts
    upd = next(i for i in items if i["action"] == "user.update")
    assert upd["after"]["password"] == "o'zgartirildi"
    assert PAROL not in str(items) and "yangi-parol-456" not in str(items)
    assert upd["actor"] == "api-kalit"
    # Audit yozuvi bor foydalanuvchi o'chiriladi (FK olib tashlangan).
    assert client.delete(f"/api/v1/admin/users/{u['id']}", headers=KEY).status_code == 204
    assert client.get("/api/v1/admin/audit?entity=user", headers=KEY).json()["items"][0]["action"] == "user.delete"


def test_bloklash(client):
    u = client.post("/api/v1/admin/users", headers=KEY, json={
        "username": "set-blok", "password": PAROL, "role": "operator"}).json()
    c = TestClient(create_app())
    assert c.post("/api/v1/auth/login", json={"username": "set-blok", "password": PAROL}).status_code == 200
    assert c.get("/api/v1/auth/me").json()["authenticated"]
    r = client.put(f"/api/v1/admin/users/{u['id']}", headers=KEY, json={
        "username": "set-blok", "role": "operator", "is_active": False})
    assert r.status_code == 200 and r.json()["is_active"] is False
    assert not c.get("/api/v1/auth/me").json()["authenticated"]      # sessiya yopildi
    assert c.post("/api/v1/auth/login", json={"username": "set-blok", "password": PAROL}).status_code == 401


def test_ozini_va_oxirgi_adminni_bloklab_bolmaydi(client):
    client.post("/api/v1/admin/users", headers=KEY, json={
        "username": "set-admin", "password": PAROL, "role": "admin"})
    a = TestClient(create_app())
    assert a.post("/api/v1/auth/login", json={"username": "set-admin", "password": PAROL}).status_code == 200
    me = next(u for u in a.get("/api/v1/admin/users").json()["users"] if u["username"] == "set-admin")
    r = a.put(f"/api/v1/admin/users/{me['id']}", json={
        "username": "set-admin", "role": "admin", "is_active": False})
    assert r.status_code == 400 and "O'z" in r.json()["detail"]


def test_faqat_admin(client):
    client.post("/api/v1/admin/users", headers=KEY, json={
        "username": "set-op2", "password": PAROL, "role": "operator"})
    op = TestClient(create_app())
    op.post("/api/v1/auth/login", json={"username": "set-op2", "password": PAROL})
    assert op.get("/api/v1/admin/settings").status_code == 403
    assert op.put("/api/v1/admin/settings", json={"values": {"site_name": "x"}}).status_code == 403
    assert op.get("/api/v1/admin/audit").status_code == 403
    assert TestClient(create_app()).get("/api/v1/admin/settings").status_code == 401
