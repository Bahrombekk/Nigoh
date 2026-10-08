"""v3: tizim holati chipi, admin status maydonlari, yangi sayt sozlamalari,
tizim bildirishnomalari generatori va health ilgaklari.

Qulflanadigan qoidalar:
  * /system/state shakli, ichki manzil/IP yo'q; mehmonga faqat public_view bilan;
  * /admin/status: update, mediamtx_uptime_s, network.latency_ms, disk.used_pct/total_mb;
  * yangi sozlamalar (timezone, language, ui_poll_s, notify_outage) tekshiriladi va
    /auth/me poll_s, /public/info guest_view ga ta'sir qiladi;
  * tizim bildirishnomasi holat O'ZGARGANDA bir marta yoziladi (2 tekshiruvdan keyin),
    tiklanish darhol, ko'tarilmagan muammo uchun "tiklandi" yo'q;
  * health ilgagi xatosi kuzatuvni to'xtatmaydi.
"""
import re

import pytest
from fastapi.testclient import TestClient

from app import deps, system_state
from app.factory import create_app
from camera.monitoring import health
from core.version import VERSION
from database import get_db
from notifications import alerts

KEY = {"X-API-Key": "test-kalit"}
IP_RE = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app()) as c:
        yield c


@pytest.fixture(autouse=True)
def _toza(client):
    deps._key_throttle._fails.clear()
    system_state.clear_cache()
    yield
    client.put("/api/v1/admin/settings", headers=KEY, json={"values": {
        "public_view": None, "ui_poll_s": None, "language": None, "timezone": None,
        "notify_outage": None}})


def test_system_state_shakli(client):
    r = client.get("/api/v1/system/state", headers=KEY)
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"state", "label", "services", "checked_at"}
    assert body["state"] in ("ok", "degraded", "down")
    assert body["label"] == system_state.LABELS[body["state"]]
    keys = [s["key"] for s in body["services"]]
    assert keys == ["api", "db", "mediamtx", "health", "network"]   # disk nazorati o'chiq
    for s in body["services"]:
        assert s["state"] in ("ok", "warn", "error") and s["name"] and isinstance(s["detail"], str)
    db = next(s for s in body["services"] if s["key"] == "db")
    assert db["state"] in ("ok", "warn")
    text = r.text
    assert not IP_RE.search(text) and "\\\\" not in text and "/api" not in text


def test_system_state_mehmonga_faqat_public_view_bilan(client):
    mehmon = TestClient(create_app())
    assert mehmon.get("/api/v1/system/state").status_code == 401
    client.put("/api/v1/admin/settings", headers=KEY, json={"values": {"public_view": True}})
    assert mehmon.get("/api/v1/system/state").status_code == 200
    info = mehmon.get("/api/v1/public/info").json()
    assert info["guest_view"] is True and info["public_view"] is True


def test_umumiy_holat_qoidasi(monkeypatch):
    monkeypatch.setattr("app.system_state.mediamtx_sync.api_available", lambda: False)
    assert system_state.collect(fresh=True)["state"] == "down"
    monkeypatch.setattr("app.system_state.mediamtx_sync.api_available", lambda: True)
    monkeypatch.setattr("app.system_state.disk_usage", lambda: (85.0, 1000, 150))
    # Disk nazorati o'chiq — band disk holatga ta'sir qilmaydi.
    data = system_state.collect(fresh=True)
    assert all(s["key"] != "disk" for s in data["services"])
    assert data["metrics"]["disk_pct"] is None
    monkeypatch.setattr("app.system_state.DISK_MONITORING", True)
    data = system_state.collect(fresh=True)
    assert data["state"] in ("degraded",)
    disk = next(s for s in data["services"] if s["key"] == "disk")
    assert disk["state"] == "warn" and disk["detail"] == "85% band"


def test_admin_status_yangi_maydonlar(client):
    body = client.get("/api/v1/admin/status", headers=KEY).json()
    assert body["update"] == {"current": VERSION, "latest": None}
    assert isinstance(body["mediamtx"], bool)                  # v2 mos
    assert "mediamtx_uptime_s" in body
    assert "latency_ms" in body["network"]
    assert 0 < body["disk"]["used_pct"] <= 100 and body["disk"]["total_mb"] > 0
    assert "snapshots_mb" in body["disk"]                       # eski maydonlar joyida


def _setting(client, key):
    items = client.get("/api/v1/admin/settings", headers=KEY).json()["settings"]
    return next(s for s in items if s["key"] == key)


def test_yangi_sozlamalar(client):
    lang = _setting(client, "language")
    assert lang["value"] == "uz" and lang["kind"] == "choice"
    assert lang["choices"] == ["uz", "uz-cyrl", "ru", "en"]
    assert _setting(client, "timezone")["value"] == "Asia/Tashkent"
    poll = _setting(client, "ui_poll_s")
    assert (poll["value"], poll["min"], poll["max"]) == (30, 10, 300)
    assert _setting(client, "notify_outage")["value"] is True
    for key, lo, hi in (("stall_after_s", 10, 300), ("transport_check_after_s", 20, 600),
                        ("health_interval_s", 30, 600)):
        s = _setting(client, key)
        assert (s["min"], s["max"]) == (lo, hi), key

    put = lambda v: client.put("/api/v1/admin/settings", headers=KEY, json={"values": v})  # noqa: E731
    assert put({"language": "de"}).status_code == 422
    assert put({"timezone": "Mars/Olympus"}).status_code == 422
    assert put({"ui_poll_s": 5}).status_code == 422
    assert put({"notify_outage": "ha"}).status_code == 422
    assert put({"language": "ru", "timezone": "Europe/Moscow", "ui_poll_s": 60,
                "notify_outage": False}).status_code == 200
    assert client.get("/api/v1/auth/me").json()["poll_s"] == 60
    assert _setting(client, "language")["value"] == "ru"


def _state(**m):
    base = {"disk_pct": 50.0, "mediamtx": True, "db_ms": 3.0, "checked": 0, "online": 0}
    base.update(m)
    return {"metrics": base}


def _alerts():
    with get_db() as db:
        return db.execute("SELECT key, active, severity, title FROM system_alerts "
                          "ORDER BY id").fetchall()


def test_disk_nazorati_ochirilgan_bildirishnoma_yoq():
    with get_db() as db:
        db.execute("DELETE FROM system_alerts")
    alerts.reset()
    assert alerts.check(_state(disk_pct=96.0)) == []
    assert alerts.check(_state(disk_pct=96.0)) == []
    assert _alerts() == []
    alerts.reset()


def test_tizim_bildirishnomasi_bir_marta(monkeypatch):
    monkeypatch.setattr("app.system_state.DISK_MONITORING", True)
    with get_db() as db:
        db.execute("DELETE FROM system_alerts")
    alerts.reset()
    assert alerts.check(_state()) == []                       # muammo yo'q — "tiklandi" ham yo'q
    assert alerts.check(_state(disk_pct=86.0)) == []           # 1-ko'rinish — hali yozilmaydi
    assert alerts.check(_state(disk_pct=86.0)) == ["disk"]     # 2-ko'rinish — yoziladi
    assert alerts.check(_state(disk_pct=87.0)) == []           # holat o'zgarmadi
    alerts.reset()                                             # "server qayta ishga tushdi"
    assert alerts.check(_state(disk_pct=87.0)) == []           # bazadan eslaydi
    assert alerts.check(_state(disk_pct=40.0)) == ["disk"]     # tiklandi — darhol
    rows = _alerts()
    assert [(r["key"], r["active"], r["severity"]) for r in rows] == [
        ("disk", True, "warning"), ("disk", False, "success")]
    assert rows[0]["title"] == "Disk 86% band"
    alerts.check(_state(mediamtx=False))
    assert alerts.check(_state(mediamtx=False)) == ["mediamtx"]
    assert _alerts()[-1]["severity"] == "error"
    alerts.check(_state())                                     # tiklandi
    alerts.reset()


def test_health_ilgagi_xatosi_kuzatuvni_toxtatmaydi(monkeypatch):
    chaqirildi = []

    def yaxshi():
        chaqirildi.append(1)

    def yomon():
        raise RuntimeError("sinov")

    mon = health.HealthMonitor()
    mon.add_hook(yomon)
    mon.add_hook(yaxshi)
    monkeypatch.setattr(mon, "_sweep", lambda: None)

    class Stop(Exception):
        pass

    def sleep(_):
        raise Stop

    monkeypatch.setattr("camera.monitoring.health.time.sleep", sleep)
    with pytest.raises(Stop):
        mon._loop()
    assert chaqirildi == [1]
