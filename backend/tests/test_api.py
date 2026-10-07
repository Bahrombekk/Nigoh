"""API testlari — FastAPI TestClient bilan (haqiqiy HTTP qatlami).

MediaMTX va kameralar kerak emas: manual (tayyor oqim) kameralar
ishlatiladi. Kalit conftest'da: X-API-Key: test-kalit.
"""
import pytest
from fastapi.testclient import TestClient

from app import deps
from app.factory import create_app
from database import get_db
from tests.factories import add_camera, count_at, delete_at

KEY = {"X-API-Key": "test-kalit"}


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app()) as c:
        yield c


def _yangi(client, nom, ext=""):
    r = client.post("/api/v1/admin/cameras", headers=KEY, json={
        "name": nom, "region": "Sinovobod", "source_type": "manual",
        "stream_url": f"https://misol.uz/{nom}.m3u8", "external_id": ext,
    })
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture(autouse=True)
def _toza_kalit_hisobi():
    """Kalit cheklovi hisobi har test uchun tozalanadi.

    Usiz testlar bir-birining hisobini meros qilib oladi va tartibga
    qarab goh 401, goh 429 chiqadi.
    """
    deps._key_throttle._fails.clear()
    yield
    deps._key_throttle._fails.clear()


def test_kalitsiz_401(client):
    for path in ("/api/v1/cameras", "/api/v1/cameras/status?all=1",
                 "/api/v1/admin/status", "/api/v1/events", "/api/v1/vendors"):
        assert client.get(path).status_code == 401, path
    assert client.post("/api/v1/streams",
                       json={"ids": [1]}).status_code == 401


def test_notogri_kalit_401(client):
    r = client.get("/api/v1/cameras", headers={"X-API-Key": "xato"})
    assert r.status_code == 401


def test_interfeys_va_login_ochiq(client):
    # Interfeys tizimning o'zida — ildiz sahifani beradi, login doim bor.
    r = client.get("/")
    assert r.status_code == 200 and "text/html" in r.headers["content-type"]
    assert client.post("/api/v1/auth/login",
                       json={"username": "a", "password": "b"}).status_code == 401
    me = client.get("/api/v1/auth/me").json()
    assert me == {"authenticated": False, "public_view": False, "site_name": "NIGOH"}


def test_xarita_geojson_fayllari(client):
    """Chegara va temir yo'l qatlamlari beriladi; ro'yxatdan tashqari nom — 404."""
    for name in ("uz", "railways"):
        r = client.get(f"/assets/{name}.geojson")
        assert r.status_code == 200, name
        assert r.json()["type"] == "FeatureCollection"
    rails = client.get("/assets/railways.geojson").json()["features"]
    assert {f["properties"]["branch"] for f in rails} >= {"toshkent", "buxoro", "qoqon"}
    assert all(f["geometry"]["type"] == "MultiLineString" for f in rails)
    assert client.get("/assets/maxfiy.geojson").status_code == 404


def test_kamera_crud_va_external_id(client):
    _yangi(client, "Ext sinov", ext="api-test-1")
    try:
        # ext: orqali oqim (1.1 qabul mezoni)
        r = client.get("/api/v1/cameras/ext:api-test-1/stream", headers=KEY)
        assert r.status_code == 200
        assert r.json()["stream_url"] == "https://misol.uz/Ext sinov.m3u8"

        # takror external_id -> 409
        r = client.post("/api/v1/admin/cameras", headers=KEY, json={
            "name": "Boshqa", "region": "S", "source_type": "manual",
            "stream_url": "https://x/1.m3u8", "external_id": "api-test-1"})
        assert r.status_code == 409

        # ext: bilan tahrirlash
        r = client.put("/api/v1/admin/cameras/ext:api-test-1", headers=KEY,
                       json={"name": "Ext sinov 2", "region": "Sinovobod",
                             "source_type": "manual",
                             "stream_url": "https://misol.uz/2.m3u8",
                             "external_id": "api-test-1"})
        assert r.status_code == 200 and r.json()["name"] == "Ext sinov 2"
    finally:
        assert client.delete("/api/v1/admin/cameras/ext:api-test-1",
                             headers=KEY).status_code == 204


def test_takror_ip_qoshilmaydi_lekin_201(client):
    """Bir xil IP+port+yo'l qayta yuborilsa: javob yangi qo'shilgandagidek
    (201 + kamera), lekin nusxa yaratilmaydi. Tashqi tizimning dev va prod
    muhitlari bitta Nigoh'ga ulanganda ikkinchisi 409 ga urilmasin.

    Kamera bazaga to'g'ridan yoziladi: takror yo'l probe'gacha qaytadi,
    ya'ni test tarmoqqa chiqmaydi.
    """
    with get_db() as db:
        add_camera(db, "takror_test", name="Takror", ip="10.255.255.9",
                   rtsp_path="/stream1")

    payload = {"name": "Boshqa nom", "region": "Boshqa", "source_type": "rtsp",
               "ip": "10.255.255.9", "port": 554, "rtsp_path": "/stream1",
               "external_id": "takror-ext-1"}
    try:
        r = client.post("/api/v1/admin/cameras", headers=KEY, json=payload)
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["name"] == "Takror"                 # mavjud kamera qaytdi
        assert body["external_id"] == "takror-ext-1"    # tashqi ID biriktirildi
        assert r.headers.get("X-Nigoh-Existing") == "1"

        # Ikkinchi takror ham xuddi shunday, external_id ham o'zgarmaydi.
        r2 = client.post("/api/v1/admin/cameras", headers=KEY,
                         json={**payload, "external_id": "takror-ext-2"})
        assert r2.status_code == 201
        assert r2.json()["id"] == body["id"]
        assert r2.json()["external_id"] == "takror-ext-1"

        with get_db() as db:
            soni = count_at(db, "10.255.255.9")
        assert soni == 1                                # nusxa yaratilmadi
    finally:
        with get_db() as db:
            delete_at(db, "10.255.255.9")


def test_takror_poyga_paytida_ham_nusxa_yaratilmaydi(client, monkeypatch):
    """Ikki so'rov BIR VAQTDA kelsa ham bitta kamera qoladi.

    Qo'shishdan oldingi tekshiruv o'zi yetmaydi: undan keyin RTSP
    probe'lari bir necha soniya ketadi va shu oraliqda kelgan ikkinchi
    so'rov ham tekshiruvdan o'tib ketardi (ishlab chiqarishda 195
    kameradan 30 tasi shunday ikkilangan). Oxirgi so'z bazada —
    `idx_cameras_rtsp`.

    Poyga shunday takrorlanadi: probe chaqirilgan payt "boshqa so'rov"
    o'sha kamerani bazaga yozib qo'yadi.
    """
    from camera.probe import detect as helpers

    haqiqiy = helpers.detect_codec

    def _probe_paytida_boshqasi_qoshadi(cam, password):
        with get_db() as db:
            add_camera(db, "poyga_test", name="Poyga g'olibi", ip="10.255.255.10",
                       rtsp_path="/stream1")
        monkeypatch.setattr("camera.api.admin.detect_codec", haqiqiy)
        return "H264", False, "", 0.0

    monkeypatch.setattr("camera.api.admin.detect_codec",
                        _probe_paytida_boshqasi_qoshadi)
    monkeypatch.setattr("camera.api.admin.detect_sub_path", lambda cam, pw: ("", ""))

    try:
        r = client.post("/api/v1/admin/cameras", headers=KEY, json={
            "name": "Kechikkan", "region": "Poyga", "source_type": "rtsp",
            "ip": "10.255.255.10", "port": 554, "rtsp_path": "/stream1",
            "external_id": "poyga-ext"})
        assert r.status_code == 201, r.text
        assert r.headers.get("X-Nigoh-Existing") == "1"
        assert r.json()["name"] == "Poyga g'olibi"      # birinchisi qoldi
        assert r.json()["external_id"] == "poyga-ext"   # ID unga biriktirildi

        with get_db() as db:
            soni = count_at(db, "10.255.255.10")
        assert soni == 1
    finally:
        with get_db() as db:
            delete_at(db, "10.255.255.10")


def test_yol_korsatilmagan_takror_ip_nusxa_yaratmaydi(client, monkeypatch):
    """Faqat IP yuborilsa (RTSP yo'l yo'q) — o'sha IP'dagi kamera qaytadi.

    Tashqi tizim kamerani IP bilan yuboradi, yo'lni Nigoh o'zi topib
    qo'ygan bo'ladi (dahua'da `/cam/realmonitor?...`). Qat'iy
    IP+port+yo'l solishtiruvi bunday so'rovni takror deb tanimasdi va
    o'sha kameraning `/stream1` li, oqim bermaydigan ikkinchi nusxasi
    paydo bo'lardi — konsolda bitta kamera ikkita bo'lib ko'rinardi.
    """
    with get_db() as db:
        add_camera(db, "yol_test", name="Dahua 1-kanal", ip="10.255.255.11",
                   rtsp_path="/cam/realmonitor?channel=1&subtype=0", codec="H264")
    try:
        r = client.post("/api/v1/admin/cameras", headers=KEY, json={
            "name": "16/9 (10.255.255.11)", "region": "16/9",
            "source_type": "rtsp", "ip": "10.255.255.11", "port": 554,
            "external_id": "yol-ext-1"})           # rtsp_path YUBORILMADI
        assert r.status_code == 201, r.text
        assert r.headers.get("X-Nigoh-Existing") == "1"
        assert r.json()["name"] == "Dahua 1-kanal"
        assert r.json()["external_id"] == "yol-ext-1"

        # Standart `/stream1` ni ATAYLAB yuborish ham xuddi shunday:
        # mijoz kodidagi standart qiymat hech qanday kanalni ko'rsatmaydi.
        r2 = client.post("/api/v1/admin/cameras", headers=KEY, json={
            "name": "Yana o'sha", "region": "16/9", "source_type": "rtsp",
            "ip": "10.255.255.11", "port": 554, "rtsp_path": "/stream1"})
        assert r2.status_code == 201
        assert r2.headers.get("X-Nigoh-Existing") == "1"

        # Boshqa ishlab chiqaruvchi shabloni bilan, lekin O'SHA kanal —
        # baribir bitta kamera (hikvision yozuvi ham 1-kanalni bildiradi).
        r3 = client.post("/api/v1/admin/cameras", headers=KEY, json={
            "name": "Hikvision uslubi", "region": "16/9",
            "source_type": "rtsp", "ip": "10.255.255.11", "port": 554,
            "rtsp_path": "/Streaming/Channels/101"})
        assert r3.status_code == 201
        assert r3.headers.get("X-Nigoh-Existing") == "1"

        # Aniq boshqa kanal esa boshqa kamera — u qo'shiladi.
        monkeypatch.setattr("camera.api.admin.detect_codec",
                            lambda cam, pw: ("H264", False, "", 0.0))
        monkeypatch.setattr("camera.api.admin.detect_sub_path", lambda cam, pw: ("", ""))
        monkeypatch.setattr("camera.api.admin._enrich_new_camera",
                            lambda *a, **k: None)
        r4 = client.post("/api/v1/admin/cameras", headers=KEY, json={
            "name": "2-kanal", "region": "YolTest", "source_type": "rtsp",
            "ip": "10.255.255.11", "port": 554,
            "rtsp_path": "/cam/realmonitor?channel=2&subtype=0"})
        assert r4.status_code == 201 and not r4.headers.get("X-Nigoh-Existing")

        with get_db() as db:
            soni = count_at(db, "10.255.255.11")
        assert soni == 2                            # 1 ta asl + 1 ta 2-kanal
    finally:
        with get_db() as db:
            delete_at(db, "10.255.255.11")


def test_batch_streams(client):
    a = _yangi(client, "Batch A", ext="b-a")
    b = _yangi(client, "Batch B")
    try:
        r = client.post("/api/v1/streams", headers=KEY, json={
            "ids": [a["id"], "ext:b-a", b["id"], 999999]})
        assert r.status_code == 200
        body = r.json()
        s = body["streams"]
        assert s[str(a["id"])]["hls"].endswith("Batch A.m3u8")
        assert s["ext:b-a"]["hls"] == s[str(a["id"])]["hls"]
        assert s["999999"] == {"error": "topilmadi"}
        assert body["egress_estimate_mbps"] > 0
        # 128 dan ortiq id — validatsiya xatosi
        r = client.post("/api/v1/streams", headers=KEY,
                        json={"ids": list(range(1, 200))})
        assert r.status_code == 422
    finally:
        client.delete(f"/api/v1/admin/cameras/{a['id']}", headers=KEY)
        client.delete(f"/api/v1/admin/cameras/{b['id']}", headers=KEY)


def test_batch_status(client):
    cam = _yangi(client, "Holat sinov", ext="st-api")
    try:
        r = client.get(f"/api/v1/cameras/status?ids={cam['id']},ext:st-api,777777",
                       headers=KEY)
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 2                       # takror + topilmagan
        fields = set(body["cameras"][0])
        assert fields == {"id", "external_id", "state", "codec", "sub_codec",
                          "resolution", "last_seen", "snapshot_at"}
        assert client.get("/api/v1/cameras/status",
                          headers=KEY).status_code == 400
    finally:
        client.delete(f"/api/v1/admin/cameras/{cam['id']}", headers=KEY)


def test_auth_stream_mediamtx(client):
    # MediaMTX nomidan: chiptasiz rad, ichki chipta bilan ruxsat
    r = client.post("/api/v1/auth/stream", json={
        "ip": "127.0.0.1", "action": "read", "path": "x", "query": ""})
    assert r.status_code == 401
    from core import security
    r = client.post("/api/v1/auth/stream", json={
        "ip": "127.0.0.1", "action": "publish", "path": "x_h264",
        "query": f"token={security.internal_token()}"})
    assert r.status_code == 200


def test_takroriy_notogri_kalit_sekinlashtiriladi(client):
    """Kalit bo'yicha ham cheklov bor — ilgari faqat kirish formasida edi.

    Kalit 64 belgili bo'lsa taxmin qilib bo'lmaydi, lekin u KALTA yoki
    sizib chiqqan bo'lishi mumkin; tekshiruvsiz endpoint cheksiz
    tezlikda urishga ochiq qolardi.
    """
    xato = {"X-API-Key": "xato"}
    for _ in range(deps._key_throttle.free):
        assert client.get("/api/v1/cameras", headers=xato).status_code == 401

    r = client.get("/api/v1/cameras", headers=xato)
    assert r.status_code == 429
    assert int(r.headers["Retry-After"]) >= 1


def test_togri_kalit_hisobni_tozalaydi(client):
    """Muvaffaqiyatli so'rov ip hisobini nolga qaytaradi."""
    xato = {"X-API-Key": "xato"}
    for _ in range(deps._key_throttle.free):
        client.get("/api/v1/cameras", headers=xato)
    assert client.get("/api/v1/cameras", headers=KEY).status_code == 200
    # Hisob tozalandi — yana bepul urinishlar bor.
    assert client.get("/api/v1/cameras", headers=xato).status_code == 401


def test_xavfsizlik_sarlavhalari(client):
    """Interfeys kamera manzillari va chiptalarini ko'rsatadi — himoya arzon."""
    r = client.get("/api/v1/cameras", headers=KEY)
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    # no-referrer EMAS: OSM plitka serveri Referer'siz so'rovni bloklaydi.
    assert r.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert "frame-ancestors 'none'" in r.headers["Content-Security-Policy"]


def test_sarlavhalar_401_javobda_ham_boladi():
    """Xato javobda ham qo'yilsin — middleware hamma yo'lni qamraydi."""
    from fastapi.testclient import TestClient

    from app.factory import create_app
    with TestClient(create_app()) as c:
        r = c.get("/api/v1/cameras")
        assert r.status_code == 401
        assert r.headers["X-Frame-Options"] == "DENY"
