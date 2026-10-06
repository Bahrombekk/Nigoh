"""Dashboard ishonchlilik hisoboti (stats/overview.py).

Qulflanadigan qoidalar:
  * 2 daqiqadan qisqa uzilish — "qisqa sakrash", uzuni — haqiqiy uzilish;
  * hali qaytmagan uzilish haqiqiy uzilish sifatida hozirgacha sanaladi,
    lekin MTTR'ga kirmaydi (tiklanmagan);
  * kuzatuv bo'shlig'idagi vaqt uptime'ga ham, uzilish davomiyligiga ham
    kirmaydi — server o'chiq turgan kunlar kameralarni "o'chiq" qilmasin.
"""
from datetime import datetime, timedelta, timezone

import pytest

from database import get_db
from stats import overview
from tests.factories import add_camera, add_event

NOW = datetime.now(timezone.utc)


def _ago(**kw) -> datetime:
    return NOW - timedelta(**kw)


@pytest.fixture(scope="module")
def ids():
    with get_db() as db:
        # Oxirgi 6 soatda kuzatuv bor (5 daqiqalik suratlar), undan oldingi
        # 18 soat — bo'shliq (server ishlamagan).
        t = _ago(hours=6)
        while t <= NOW:
            db.execute("INSERT INTO availability_snapshots (ts, organization_id, total, online) "
                       "VALUES (%s, 1, 1, 1) ON CONFLICT DO NOTHING", (t,))
            t += timedelta(minutes=5)
        a = add_camera(db, "ov_a", region="Jizzax", ip="10.77.0.1")
        b = add_camera(db, "ov_b", region="Jizzax", ip="10.77.0.2")
        c = add_camera(db, "ov_c", region="Navoiy", ip="10.77.0.3")
        # A: 60 s lik sakrash va 1 soatlik haqiqiy uzilish.
        add_event(db, "offline", "ov_a", _ago(hours=5))
        add_event(db, "online", "ov_a", _ago(hours=5) + timedelta(seconds=60))
        add_event(db, "offline", "ov_a", _ago(hours=3))
        add_event(db, "online", "ov_a", _ago(hours=2))
        # B: 1 soat oldin uzilgan va hali qaytmagan.
        add_event(db, "offline", "ov_b", _ago(hours=1))
        # C: bo'shliq ichida uzilgan, kuzatuv tiklangach qaytgan — uzilish
        # faqat kuzatuv bo'lgan qismi (30 daq) bilan sanaladi.
        add_event(db, "offline", "ov_c", _ago(hours=12))
        add_event(db, "online", "ov_c", _ago(hours=5, minutes=30))
    return {"a": a, "b": b, "c": c}


@pytest.fixture(scope="module")
def report(ids):
    return overview._compute(1, None)


def _cam(report, cam_id):
    for c in report["most_offline"] + report["most_flapping"]:
        if c["id"] == cam_id:
            return c
    raise AssertionError(f"{cam_id} reytingda yo'q")


def test_qamrov_boshliqni_korsatadi(report):
    # 24 soatdan faqat oxirgi ~6 soat kuzatilgan.
    assert 20 <= report["coverage"]["pct"] <= 30
    # C ning -12 soatdagi hodisasi ham "yurak urishi" (o'sha lahzada kuzatuv
    # ishlagan) — 18 soatlik bo'shliq ikkiga bo'linadi, jami o'zgarmaydi.
    assert sum(g["hours"] for g in report["coverage"]["gaps"]) >= 16


def test_sakrash_va_haqiqiy_uzilish_ajratiladi(report, ids):
    a = _cam(report, ids["a"])
    assert (a["blips"], a["outages"]) == (1, 1)
    assert a["offline_seconds"] == pytest.approx(3600 + 60, abs=5)


def test_davom_etayotgan_uzilish_hozirgacha_sanaladi(report, ids):
    b = _cam(report, ids["b"])
    assert (b["blips"], b["outages"]) == (0, 1)
    assert b["offline_seconds"] == pytest.approx(3600, abs=5)


def test_boshliqdagi_vaqt_uzilishga_kirmaydi(report, ids):
    c = _cam(report, ids["c"])
    # 12 soat oldin uzilgan, lekin kuzatuv faqat 6 soat oldin boshlangan:
    # sanaladigani 6 soat oldindan qaytgunigacha — 30 daqiqa.
    assert c["offline_seconds"] == pytest.approx(30 * 60, abs=10)


def test_uptime_kuzatilgan_vaqtdan_hisoblanadi(report, ids):
    a = _cam(report, ids["a"])
    covered = report["coverage"]["pct"] / 100 * 24 * 3600
    assert a["uptime_pct"] == pytest.approx(100 * (1 - 3660 / covered), abs=0.5)


def test_mttr_faqat_tiklangan_haqiqiy_uzilishlardan(report):
    # Tiklangan haqiqiy uzilishlar: A (1 soat) va C (30 daq); B tiklanmagan.
    assert report["fleet"]["mttr_median_s"] is not None
    assert report["fleet"]["blip_threshold_s"] == 120


def test_endpoint_va_kunlar_chegarasi(ids):
    from fastapi.testclient import TestClient

    from app.factory import create_app
    with TestClient(create_app()) as client:
        r = client.get("/api/v1/stats/overview?days=1", headers={"X-API-Key": "test-kalit"})
        assert r.status_code == 200
        body = r.json()
        assert {"coverage", "fleet", "regions", "most_offline", "most_flapping",
                "heatmap", "quality"} <= body.keys()
        assert len(body["heatmap"][0]["hours"]) == 24
        assert client.get("/api/v1/stats/overview?days=31",
                          headers={"X-API-Key": "test-kalit"}).status_code == 422
