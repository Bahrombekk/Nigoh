"""Kamera ma'lumotlari sifati: kamchiliklar qayta paydo bo'lmasin.

2026-10-06 dagi tahlil (157 kamera) va undan chiqqan qoidalar:
  * kodek/model faqat qo'shilgan lahzada so'ralardi -> fonda qayta
    tekshiriladi (camera/monitoring/passport.py), sababi bazada qoladi (probe_error);
  * "3606/8/10 km" kabi nom jimgina km'siz saqlanardi -> 422;
  * koordinatasiz kamera hududsiz qolardi -> hudud qo'shni km'lardan;
  * Holowits kamera "dahua" deb yozilgan (yo'li ham noto'g'ri) ->
    model bo'yicha nomuvofiqlik /stats/quality da ko'rinadi.
"""
import pytest
from fastapi.testclient import TestClient

from app.factory import create_app
from camera.monitoring import passport
from database import areas, cameras, get_db, reports
from tests.factories import add_camera

KEY = {"X-API-Key": "test-kalit"}


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app()) as c:
        yield c


def _manual(client, name, **extra):
    return client.post("/api/v1/admin/cameras", headers=KEY, json={
        "name": name, "region": "", "source_type": "manual",
        "stream_url": f"https://misol.uz/{abs(hash(name))}.m3u8", **extra})


def test_vendor_model_boyicha():
    assert cameras.vendor_for_model("DH-SD6AL445GB-HNV-IR") == "dahua"
    assert cameras.vendor_for_model("DS-2DE7232IW-AE") == "hikvision"
    assert cameras.vendor_for_model("HWT-X6741-20-GZ40-E2-Wp") == "holowits"
    assert cameras.vendor_for_model("IPC-HFW2431S") == "dahua"
    assert cameras.vendor_for_model("") is None
    assert cameras.vendor_for_model("Nomalum-1") is None


def test_oqilmaydigan_km_nomi_rad_etiladi(client):
    r = _manual(client, "3606/8/10 km")
    assert r.status_code == 422
    assert "3428/1 km" in r.json()["detail"]
    # To'g'ri nom va km'siz oddiy nom — o'tadi.
    assert _manual(client, "3606/10 km").status_code == 201
    assert _manual(client, "Toshkent vokzali").status_code == 201


def test_koordinatasiz_kamera_hududi_qoshni_km_dan(client):
    with get_db() as db:
        navoiy = areas.id_by_name(db, "Navoiy")
        line = db.execute("SELECT id FROM rail_lines WHERE code = 'main'").fetchone()[0]
        for slug, km in (("kd_q1", 5001), ("kd_q2", 5003)):
            cid = add_camera(db, slug, region="Navoiy", ip=None)
            db.execute("UPDATE cameras SET rail_line_id = %s, km = %s WHERE id = %s",
                       (line, km, cid))
    r = _manual(client, "5002/4 km")
    assert r.status_code == 201, r.text
    with get_db() as db:
        row = cameras.get(db, r.json()["id"])
    assert (row["km"], row["picket"], row["admin_area_id"]) == (5002, 4, navoiy)


def test_pasport_qayta_tekshiruvi(monkeypatch):
    with get_db() as db:
        ok_id = add_camera(db, "kd_ok", ip="10.79.0.1")
        bad_id = add_camera(db, "kd_bad", ip="10.79.0.2", vendor="dahua")
        db.execute("UPDATE camera_status SET codec = NULL WHERE camera_id = ANY(%s)",
                   ([ok_id, bad_id],))

    def fake_probe(ip, port, path, user, pw):
        if ip.endswith(".1"):
            return {"ok": True, "codec": "H265", "resolution": "1920x1080", "fps": 25.0}
        return {"ok": False, "stage": "parol", "message": "Login yoki parol noto'g'ri"}

    monkeypatch.setattr(passport, "probe", fake_probe)
    monkeypatch.setattr(passport.device_info, "device_info",
                        lambda ip, u, p: {"model": "HWT-X6741", "firmware": "1.0"}
                        if ip.endswith(".2") else None)
    with get_db() as db:
        rows = {r["id"]: r for r in cameras.passport_candidates(db, 3600, 1000)}
    assert {ok_id, bad_id} <= rows.keys()
    passport.check(rows[ok_id])
    passport.check(rows[bad_id])

    with get_db() as db:
        ok, bad = cameras.get(db, ok_id), cameras.get(db, bad_id)
        again = {r["id"] for r in cameras.passport_candidates(db, 3600, 1000)}
        quality = reports.data_quality(db, [ok_id, bad_id])
    assert (ok["codec"], ok["resolution"], ok["probe_error"]) == ("H265", "1920x1080", None)
    assert ok["probe_at"] is not None
    assert bad["codec"] is None and bad["probe_error"].startswith("parol")
    assert bad["model"] == "HWT-X6741"
    # Yaqinda tekshirilgan kamera darhol qayta urinilmaydi.
    assert not {ok_id, bad_id} & again
    # Sabab va nomuvofiqlik sifat hisobotida ko'rinadi.
    assert [i["id"] for i in quality["probe_failed"]] == [bad_id]
    assert "parol" in quality["probe_failed"][0]["detail"]
    assert [i["id"] for i in quality["vendor_mismatch"]] == [bad_id]
    assert "holowits" in quality["vendor_mismatch"][0]["detail"]


def test_km_nomi_nomuvofiqligi():
    with get_db() as db:
        line = db.execute("SELECT id FROM rail_lines WHERE code = 'main'").fetchone()[0]
        cid = add_camera(db, "kd_km", name="6001/2 km", ip=None)
        db.execute("UPDATE cameras SET rail_line_id = %s, km = 6001, picket = 3 WHERE id = %s",
                   (line, cid))
        q = reports.data_quality(db, [cid])
    assert [i["detail"] for i in q["km_name_mismatch"]] == ["nomda 6001/2, bazada 6001/3"]


def test_tuzatish_yozuvi_izohda_qoladi():
    with get_db() as db:
        cid = add_camera(db, "kd_fix", ip="10.79.0.9", vendor="dahua")
        cameras.set_vendor(db, cid, "holowits")
        cameras.fix_record(db, cid, rtsp_path="/LiveMedia/ch1/Media1", lat=40.1, lng=67.9,
                           note="Tuzatildi: sinov")
        cameras.fix_record(db, cid, note="ikkinchi")
        row = cameras.get(db, cid)
    assert (row["vendor"], row["rtsp_path"], row["lat"]) == ("holowits", "/LiveMedia/ch1/Media1", 40.1)
    assert row["note"] == "Tuzatildi: sinov · ikkinchi"


def test_format_oqimdan_yoziladi():
    """Format (o'lcham) SDP'da bo'lmasa — kamera ochilganda MediaMTX'dan."""
    from camera.media import reconciler
    item = {"ready": True, "tracks2": [{"codec": "H265",
                                        "codecProps": {"width": 2560, "height": 1440}}]}
    assert reconciler.stream_resolution(item) == "2560x1440"
    assert reconciler.stream_resolution({**item, "ready": False}) == ""
    assert reconciler.stream_resolution({"ready": True, "tracks": ["H264"]}) == ""   # eski MediaMTX

    with get_db() as db:
        cam = add_camera(db, "fmt_a", ip="10.66.0.1", codec="H265")
    rec = reconciler.Reconciler()
    rec._record_resolutions({"fmt_a_h264": item,
                             "fmt_a_sub": {**item, "tracks2": [{"codecProps": {"width": 640, "height": 360}}]}})
    with get_db() as db:
        assert cameras.get(db, cam)["resolution"] == "2560x1440"   # sub o'lchami yozilmadi
        # Formati bo'sh, kodeki bor kamera ham pasport tekshiruviga tushadi.
        db.execute("UPDATE camera_status SET resolution = NULL WHERE camera_id = %s", (cam,))
        ids = [r["id"] for r in cameras.passport_candidates(db, 0, 10000)]
    assert cam in ids


def test_kamera_tafsilotlari(client):
    """Panel uchun pasport, ishonchlilik va tarix — IP/parol chiqmaydi."""
    from datetime import datetime, timedelta, timezone

    from camera.api.cameras import _IP_RE
    from stats.reporting import engine
    from tests.factories import add_event
    now = datetime.now(timezone.utc)
    with get_db() as db:
        cam = add_camera(db, "det_a", ip="10.66.1.1", codec="H264", sub_path="/sub")
        cameras.set_passport(db, [cam], "DH-SD49425XB-HNR-S3", "2.812")
        cameras.set_probe_result(db, cam, error="tarmoq: 10.66.1.1:554 javob bermadi")
        add_event(db, "offline", "det_a", now - timedelta(hours=2))
        add_event(db, "online", "det_a", now - timedelta(hours=1))
    engine.clear_cache()
    r = client.get(f"/api/v1/cameras/{cam}/details", headers=KEY)
    assert r.status_code == 200
    body = r.json()
    p = body["passport"]
    assert (p["model"], p["firmware"], p["has_sub"], p["transport"]) == (
        "DH-SD49425XB-HNR-S3", "2.812", True, "tcp")
    assert p["probe_error"].startswith("tarmoq: 10.66.1.1")        # API kalit — admin
    text = r.text
    assert "password" not in text and '"ip"' not in text and "rtsp_path" not in text
    assert [h["kind"] for h in body["history"]] == ["online", "offline"]
    rel = body["reliability"]
    assert rel["outages"] == 1 and rel["last_outage"]["seconds"] >= 3500
    assert client.get("/api/v1/cameras/999999/details", headers=KEY).status_code == 404
    # Admin bo'lmaganga manzil yashiriladi.
    assert _IP_RE.sub("kamera", "tarmoq: 10.66.1.1:554 javob bermadi") == "tarmoq: kamera javob bermadi"
