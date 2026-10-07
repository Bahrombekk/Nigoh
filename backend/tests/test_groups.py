"""Foydalanuvchi kamera guruhlari (groups/api.py).

Qulflanadigan qoidalar:
  * guruh egasiniki: boshqa operator ko'rmaydi, umumiy (shared) bo'lsa
    ko'radi, lekin o'zgartira olmaydi; admin hammasini boshqaradi;
  * operator guruhga faqat o'z hududidagi kamerani qo'sha oladi (403);
  * umumiy guruhda operator faqat o'z hududidagi kameralarni ko'radi,
    qolganlari `hidden` da; `set` ularni o'chirib yubormaydi;
  * a'zolar tartibi saqlanadi, takror qo'shilmaydi; nom egada yagona;
  * mehmon (sessiyasiz) guruhlarga kira olmaydi.

Hududlar (Surxondaryo, Farg'ona) faqat shu modulniki.
"""
import pytest
from fastapi.testclient import TestClient

from app import deps
from app.factory import create_app

KEY = {"X-API-Key": "test-kalit"}
PAROL = "sinov-parol-123"
SURX, FAR = "Surxondaryo", "Farg'ona"


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app()) as c:
        yield c


@pytest.fixture(autouse=True)
def _toza_hisob():
    deps._key_throttle._fails.clear()
    yield


def _kamera(client, nom, hudud):
    r = client.post("/api/v1/admin/cameras", headers=KEY, json={
        "name": nom, "region": hudud, "source_type": "manual",
        "stream_url": f"https://misol.uz/{nom}.m3u8"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _kir(client, login, hududlar):
    r = client.post("/api/v1/admin/users", headers=KEY, json={
        "username": login, "password": PAROL, "role": "operator", "regions": hududlar})
    assert r.status_code == 201, r.text
    c = TestClient(create_app())
    assert c.post("/api/v1/auth/login", json={"username": login, "password": PAROL}).status_code == 200
    return c


@pytest.fixture(scope="module")
def d(client):
    cams = {n: _kamera(client, n, SURX) for n in ("gr-s1", "gr-s2", "gr-s3")}
    cams["gr-f1"] = _kamera(client, "gr-f1", FAR)
    return {"cam": cams, "op1": _kir(client, "gr-op1", [SURX]),
            "op2": _kir(client, "gr-op2", [SURX])}


def _groups(c):
    r = c.get("/api/v1/groups")
    assert r.status_code == 200, r.text
    return {g["name"]: g for g in r.json()["groups"]}


def test_yaratish_tartib_va_takror(d):
    s1, s2, s3 = (d["cam"][k] for k in ("gr-s1", "gr-s2", "gr-s3"))
    op1 = d["op1"]
    r = op1.post("/api/v1/groups", json={"name": "Kechki", "camera_ids": [s3, s1, s3]})
    assert r.status_code == 201, r.text
    g = r.json()
    assert g["camera_ids"] == [s3, s1] and g["mine"] and g["can_edit"] and not g["shared"]
    # Qo'shish — oxiriga, mavjudi takrorlanmaydi.
    g = op1.post(f"/api/v1/groups/{g['id']}/cameras", json={"camera_ids": [s1, s2]}).json()
    assert g["camera_ids"] == [s3, s1, s2]
    g = op1.post(f"/api/v1/groups/{g['id']}/cameras",
                 json={"camera_ids": [s1], "mode": "remove"}).json()
    assert g["camera_ids"] == [s3, s2]
    g = op1.post(f"/api/v1/groups/{g['id']}/cameras",
                 json={"camera_ids": [s2, s1], "mode": "set"}).json()
    assert g["camera_ids"] == [s2, s1]
    # Nom egada yagona (katta-kichik harf farqsiz) — 409.
    assert op1.post("/api/v1/groups", json={"name": " kechki "}).status_code == 409


def test_begona_hudud_kamerasi_qoshilmaydi(d):
    r = d["op1"].post("/api/v1/groups", json={"name": "Begona", "camera_ids": [d["cam"]["gr-f1"]]})
    assert r.status_code == 403
    assert d["op1"].post("/api/v1/groups", json={"name": "Yo'q", "camera_ids": [9_999_999]}).status_code == 422
    assert "Begona" not in _groups(d["op1"])


def test_shaxsiy_va_umumiy(d):
    op1, op2 = d["op1"], d["op2"]
    gid = _groups(op1)["Kechki"]["id"]
    assert "Kechki" not in _groups(op2)                       # shaxsiy — ko'rinmaydi
    assert op2.patch(f"/api/v1/groups/{gid}", json={"name": "x"}).status_code == 404
    assert op1.patch(f"/api/v1/groups/{gid}", json={"shared": True}).status_code == 200
    g = _groups(op2)["Kechki"]                                 # umumiy — ko'rinadi
    assert not g["mine"] and not g["can_edit"] and g["owner_name"] == "gr-op1"
    assert op2.patch(f"/api/v1/groups/{gid}", json={"name": "x"}).status_code == 403
    assert op2.delete(f"/api/v1/groups/{gid}").status_code == 403
    assert op2.post(f"/api/v1/groups/{gid}/cameras", json={"camera_ids": []}).status_code == 403


def test_admin_guruhida_operator_oz_kameralarini_koradi(client, d):
    s1, f1 = d["cam"]["gr-s1"], d["cam"]["gr-f1"]
    g = client.post("/api/v1/groups", headers=KEY,
                    json={"name": "Umumiy", "shared": True, "camera_ids": [f1, s1]}).json()
    seen = _groups(d["op1"])["Umumiy"]
    assert seen["camera_ids"] == [s1] and seen["hidden"] == 1 and seen["owner_name"] == "API"
    # Admin — hammasi; operator guruhini ham boshqaradi.
    allg = _groups(client.__class__(create_app(), headers=KEY))
    assert allg["Umumiy"]["camera_ids"] == [f1, s1] and allg["Kechki"]["can_edit"]
    # Admin hammasini ko'radi — `set` uning uchun to'liq almashtirish.
    r = client.post(f"/api/v1/groups/{g['id']}/cameras", headers=KEY,
                    json={"camera_ids": [s1], "mode": "set"})
    assert r.json()["camera_ids"] == [s1]


def test_set_korinmaydiganlarni_ochirmaydi(client, d):
    s1, s2, f1 = d["cam"]["gr-s1"], d["cam"]["gr-s2"], d["cam"]["gr-f1"]
    op1 = d["op1"]
    g = op1.post("/api/v1/groups", json={"name": "Aralash", "camera_ids": [s1]}).json()
    client.post(f"/api/v1/groups/{g['id']}/cameras", headers=KEY, json={"camera_ids": [f1]})
    g = op1.post(f"/api/v1/groups/{g['id']}/cameras", json={"camera_ids": [s2], "mode": "set"}).json()
    assert g["camera_ids"] == [s2] and g["hidden"] == 1      # f1 o'chmadi
    full = _groups(client.__class__(create_app(), headers=KEY))["Aralash"]
    assert full["camera_ids"] == [s2, f1]


def test_ochirish_va_mehmon(d):
    op1 = d["op1"]
    gid = op1.post("/api/v1/groups", json={"name": "Vaqtincha"}).json()["id"]
    assert op1.delete(f"/api/v1/groups/{gid}").status_code == 204
    assert "Vaqtincha" not in _groups(op1)
    assert TestClient(create_app()).get("/api/v1/groups").status_code == 401
    # Rang formati tekshiriladi.
    assert op1.post("/api/v1/groups", json={"name": "Rang", "color": "red"}).status_code == 422
    assert op1.post("/api/v1/groups", json={"name": "Rang", "color": "#22aa55"}).status_code == 201
