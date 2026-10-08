"""v3: kirish va profil, kuzatuvchi (viewer) roli, vaqtinchalik parol.

Qulflanadigan qoidalar:
  * /public/info kirishsiz: sayt nomi, versiya, public_view = guest_view;
  * /auth/me qo'shimcha maydonlari (full_name, prefs, session_hours, poll_s, version);
  * prefs birlashtiriladi, 16 KB dan katta — 413, kirmagan — 401;
  * o'z parolini almashtirish: xato joriy — 400 (aniq matn), audit, boshqa
    sessiyalar bekor, joriysi qoladi;
  * remember=true — sessiya 30 kun;
  * kuzatuvchi o'z hududini ko'radi, guruh yarata/o'zgartira olmaydi,
    boshqaruv va sozlamalar yopiq;
  * reset-password — 12 belgili vaqtinchalik parol, eskisi ishlamaydi, audit.
"""
import pytest
from fastapi.testclient import TestClient

from app import deps
from app.factory import create_app
from core.version import VERSION
from users import api as auth

KEY = {"X-API-Key": "test-kalit"}
PAROL = "sinov-parol-123"


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app()) as c:
        yield c


@pytest.fixture(autouse=True)
def _toza():
    deps._key_throttle._fails.clear()
    auth._login_throttle._fails.clear()
    yield


def _user(client, login, role="operator", regions=(), full_name=""):
    r = client.post("/api/v1/admin/users", headers=KEY, json={
        "username": login, "password": PAROL, "role": role, "regions": list(regions),
        "full_name": full_name})
    assert r.status_code == 201, r.text
    return r.json()


def _login(login, password=PAROL, **extra):
    c = TestClient(create_app())
    r = c.post("/api/v1/auth/login", json={"username": login, "password": password, **extra})
    assert r.status_code == 200, r.text
    return c, r


def test_public_info_kirishsiz(client):
    body = TestClient(create_app()).get("/api/v1/public/info").json()
    assert body == {"site_name": "NIGOH", "version": VERSION,
                    "public_view": False, "guest_view": False}
    assert client.get("/api/public/info").status_code == 200        # eski prefiks ham


def test_me_qoshimcha_maydonlar(client):
    _user(client, "v3-me", full_name="Ali Valiyev")
    c, _ = _login("v3-me")
    me = c.get("/api/v1/auth/me").json()
    assert me["authenticated"] and me["full_name"] == "Ali Valiyev"
    assert me["prefs"] == {} and me["session_hours"] == 12 and me["poll_s"] == 30
    assert me["version"] == VERSION


def test_prefs_birlashtiriladi(client):
    _user(client, "v3-prefs")
    c, _ = _login("v3-prefs")
    r = c.patch("/api/v1/auth/me/prefs", json={"theme": "cream", "layers": {"rail": True}})
    assert r.status_code == 200 and r.json() == {"theme": "cream", "layers": {"rail": True}}
    r = c.patch("/api/v1/auth/me/prefs", json={"lang": "ru", "theme": "dark"})
    assert r.json() == {"theme": "dark", "layers": {"rail": True}, "lang": "ru"}
    assert c.get("/api/v1/auth/me").json()["prefs"]["lang"] == "ru"
    # 16 KB chegarasi — butun prefs bo'yicha.
    assert c.patch("/api/v1/auth/me/prefs", json={"big": "x" * 17000}).status_code == 413
    assert "big" not in c.get("/api/v1/auth/me").json()["prefs"]
    # Obyekt bo'lmagan tana — 422; kirmagan — 401; kalit (foydalanuvchisiz) — 401.
    assert c.patch("/api/v1/auth/me/prefs", json=[1, 2]).status_code == 422
    assert TestClient(create_app()).patch("/api/v1/auth/me/prefs",
                                          json={"a": 1}).status_code == 401
    assert client.patch("/api/v1/auth/me/prefs", headers=KEY, json={"a": 1}).status_code == 401


def test_parol_almashtirish(client):
    _user(client, "v3-pw")
    c, _ = _login("v3-pw")
    boshqa, _ = _login("v3-pw")                       # ikkinchi qurilma
    r = c.post("/api/v1/auth/password", json={"current": "xato", "new": "yangi-parol-1"})
    assert r.status_code == 400 and r.json() == {"detail": "Joriy parol notoʻgʻri"}
    assert c.post("/api/v1/auth/password",
                  json={"current": PAROL, "new": "123"}).status_code == 400
    r = c.post("/api/v1/auth/password", json={"current": PAROL, "new": "yangi-parol-1"})
    assert r.status_code == 204
    assert c.get("/api/v1/auth/me").json()["authenticated"]           # joriy sessiya qoldi
    assert not boshqa.get("/api/v1/auth/me").json()["authenticated"]  # boshqasi bekor
    assert TestClient(create_app()).post("/api/v1/auth/login", json={
        "username": "v3-pw", "password": PAROL}).status_code == 401
    _login("v3-pw", "yangi-parol-1")
    items = client.get("/api/v1/admin/audit?entity=user", headers=KEY).json()["items"]
    assert any(i["action"] == "user.password" and i["actor"] == "v3-pw" for i in items)
    assert "yangi-parol-1" not in str(items)
    assert TestClient(create_app()).post("/api/v1/auth/password", json={
        "current": "a", "new": "bbbbbbb"}).status_code == 401


def test_remember_30_kun(client):
    _user(client, "v3-rem")
    _, r = _login("v3-rem", remember=True)
    assert f"Max-Age={30 * 86400}" in r.headers["set-cookie"]
    _, r = _login("v3-rem")
    assert "Max-Age=43200" in r.headers["set-cookie"]


@pytest.fixture(scope="module")
def kuzatuvchi(client):
    a = client.post("/api/v1/admin/cameras", headers=KEY, json={
        "name": "v3-sam", "region": "Samarqand", "source_type": "manual",
        "stream_url": "https://misol.uz/v3-sam.m3u8"}).json()["id"]
    b = client.post("/api/v1/admin/cameras", headers=KEY, json={
        "name": "v3-sir", "region": "Sirdaryo", "source_type": "manual",
        "stream_url": "https://misol.uz/v3-sir.m3u8"}).json()["id"]
    u = _user(client, "v3-viewer", role="viewer", regions=["Samarqand"])
    yield {"sam": a, "sir": b, "user": u}
    for cid in (a, b):
        client.delete(f"/api/v1/admin/cameras/{cid}", headers=KEY)


def test_kuzatuvchi_ozini_hududini_koradi(client, kuzatuvchi):
    assert kuzatuvchi["user"]["role"] == "viewer"
    assert kuzatuvchi["user"]["regions"] == ["Samarqand"]
    c, _ = _login("v3-viewer")
    me = c.get("/api/v1/auth/me").json()
    assert me["role"] == "viewer" and me["regions"] == ["Samarqand"]
    names = {x["name"] for x in c.get("/api/v1/cameras").json()["cameras"]}
    assert names == {"v3-sam"}
    assert c.get(f"/api/v1/cameras/{kuzatuvchi['sir']}/stream").status_code == 403
    assert c.get(f"/api/v1/cameras/{kuzatuvchi['sam']}/stream").status_code == 200
    assert c.get("/api/v1/stats/summary").status_code == 200           # dashboard ochiq
    assert c.post("/api/v1/walls", json={"camera_ids": [kuzatuvchi["sir"]]}).status_code == 404


def test_kuzatuvchi_faqat_koradi(client, kuzatuvchi):
    c, _ = _login("v3-viewer")
    assert c.get("/api/v1/groups").status_code == 200
    assert c.post("/api/v1/groups", json={"name": "Meniki"}).status_code == 403
    gid = client.post("/api/v1/groups", headers=KEY, json={
        "name": "v3-umumiy", "shared": True, "camera_ids": [kuzatuvchi["sam"]]}).json()["id"]
    try:
        assert c.patch(f"/api/v1/groups/{gid}", json={"name": "x"}).status_code == 403
        assert c.post(f"/api/v1/groups/{gid}/cameras",
                      json={"camera_ids": [kuzatuvchi["sam"]]}).status_code == 403
        assert c.delete(f"/api/v1/groups/{gid}").status_code == 403
        assert any(g["id"] == gid for g in c.get("/api/v1/groups").json()["groups"])
    finally:
        client.delete(f"/api/v1/groups/{gid}", headers=KEY)
    for path in ("/api/v1/admin/cameras", "/api/v1/admin/users", "/api/v1/admin/settings",
                 "/api/v1/admin/status"):
        assert c.get(path).status_code == 403, path


def test_reset_password(client):
    u = _user(client, "v3-reset")
    c, _ = _login("v3-reset")
    r = client.post(f"/api/v1/admin/users/{u['id']}/reset-password", headers=KEY)
    assert r.status_code == 200
    temp = r.json()["password"]
    assert len(temp) == 12 and temp.isalnum()
    assert not c.get("/api/v1/auth/me").json()["authenticated"]       # sessiyalar bekor
    assert TestClient(create_app()).post("/api/v1/auth/login", json={
        "username": "v3-reset", "password": PAROL}).status_code == 401
    _login("v3-reset", temp)
    items = client.get("/api/v1/admin/audit?entity=user", headers=KEY).json()["items"]
    assert any(i["action"] == "user.password_reset" and i["entity_id"] == str(u["id"])
               for i in items)
    assert temp not in str(items)
    assert client.post("/api/v1/admin/users/999999/reset-password",
                       headers=KEY).status_code == 404
    assert c.post(f"/api/v1/admin/users/{u['id']}/reset-password").status_code == 401
