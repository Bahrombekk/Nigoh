"""Log tizimi (core/logs/): toifalar, maxfiylik, kunlik fayllar, qidiruv, API.

Qulflanadigan qoidalar:
  * service -> toifa papkasi; WARNING+ yig'ma errors/ ga ham tushadi;
  * parol/token va URL ichidagi login:parol faylga tushmaydi;
  * fayl qayta nomlanmaydi: sana nomli, chegaradan oshsa .1, eskisi o'chadi;
  * har HTTP so'rovda X-Request-ID va access yozuvi; shu ID bilan qidiriladi;
  * log faylni yuklab olishda yo'l logs/<toifa>/ dan chiqa olmaydi.
"""
import json
import logging
import os
import time
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.factory import create_app
from core.log import log
from core.logs import config, context, external
from core.logs.handlers import DailyFileHandler
from core.logs.reader import LogReader
from core.logs.redact import redact

KEY = {"X-API-Key": "test-kalit"}


def _lines(category: str) -> list[dict]:
    out = []
    for f in sorted((config.LOG_DIR / category).glob("*.jsonl")):
        out += [json.loads(x) for x in f.read_text(encoding="utf-8").splitlines() if x.strip()]
    return out


def test_maxfiy_malumot_yashiriladi():
    r = redact({"password": "12345", "url": "rtsp://admin:Sirli1@10.0.0.5:554/s",
                "nested": {"api_key": "abc", "ok": "rtsp://10.0.0.6/s"},
                "q": "token=xyz&page=2", "empty_password": ""})
    assert r["password"] == "***"
    assert r["url"] == "rtsp://admin:***@10.0.0.5:554/s"
    assert r["nested"] == {"api_key": "***", "ok": "rtsp://10.0.0.6/s"}
    assert r["q"] == "token=***&page=2"
    assert r["empty_password"] == ""


def test_toifa_va_yigma_errors():
    log("auth", "login_failed_test", level="warning", user="ali", password="hech-kim-bilmasin")
    log("snapshots", "info_test", count=3)
    sec = [x for x in _lines("security") if x["event"] == "login_failed_test"]
    assert sec and sec[-1]["category"] == "security" and sec[-1]["password"] == "***"
    assert "hech-kim-bilmasin" not in (config.LOG_DIR / "security").glob("*.jsonl").__next__() \
        .read_text(encoding="utf-8")
    assert any(x["event"] == "login_failed_test" for x in _lines("errors"))
    assert any(x["event"] == "info_test" for x in _lines("camera"))
    assert not any(x["event"] == "info_test" for x in _lines("errors"))     # INFO yig'maga emas


def test_istisno_traceback_bilan():
    try:
        raise ValueError("sinov xatosi rtsp://u:p@1.2.3.4/x")
    except ValueError:
        log("app", "boom_test", level="error", exc_info=True)
    rec = [x for x in _lines("errors") if x["event"] == "boom_test"][-1]
    assert rec["error_type"] == "ValueError"
    assert "Traceback" in rec["traceback"] and "u:***@" in rec["traceback"]


def test_kontekst_request_id():
    token = context.bind(request_id="sinov123")
    try:
        log("stats", "ctx_test")
    finally:
        context.reset(token)
    log("stats", "ctx_test2")
    recs = {x["event"]: x for x in _lines("stats")}
    assert recs["ctx_test"]["request_id"] == "sinov123"
    assert "request_id" not in recs["ctx_test2"]


def test_kunlik_fayl_bolinish_va_tozalash(tmp_path):
    h = DailyFileHandler(tmp_path, "t", retention_days=7, max_bytes=200)
    h.setFormatter(logging.Formatter("%(message)s"))
    lg = logging.getLogger("nigoh_sinov_handler")
    lg.handlers, lg.propagate = [h], False
    for i in range(20):
        lg.warning("satr %02d %s", i, "x" * 20)
    today = date.today().isoformat()
    names = sorted(p.name for p in tmp_path.iterdir())
    assert f"t-{today}.jsonl" in names and f"t-{today}.1.jsonl" in names
    old = tmp_path / f"t-{(date.today() - timedelta(days=30)).isoformat()}.jsonl"
    old.write_text("eski\n")
    keep = tmp_path / f"t-{(date.today() - timedelta(days=2)).isoformat()}.jsonl"
    keep.write_text("yangi\n")
    assert h.cleanup() == 1
    assert not old.exists() and keep.exists()
    h.close()


def test_reader_filtrlar(tmp_path):
    d = tmp_path / "camera"
    d.mkdir()
    rows = [{"ts": f"2026-10-06T10:0{i}:00+05:00", "level": lvl, "category": "camera",
             "service": svc, "event": ev}
            for i, (lvl, svc, ev) in enumerate([("INFO", "health", "sweep"),
                                                ("WARNING", "snapshots", "backlog"),
                                                ("ERROR", "reconciler", "mediamtx_died")])]
    (d / "camera-2026-10-06.jsonl").write_text(
        "\n".join(json.dumps(r) for r in rows) + "\n{buzuq satr\n", encoding="utf-8")
    m = tmp_path / "mediamtx"
    m.mkdir()
    (m / "mediamtx.log").write_text("2026/10/06 10:00:00 INF ok\n2026/10/06 10:01:00 ERR "
                                    "listen udp :8189: bind\n", encoding="utf-8")
    r = LogReader(tmp_path)
    assert [x["event"] for x in r.query("camera")] == ["mediamtx_died", "backlog", "sweep"]
    assert [x["event"] for x in r.query("camera", level="warning")] == ["mediamtx_died", "backlog"]
    assert [x["event"] for x in r.query("camera", service="health")] == ["sweep"]
    assert [x["event"] for x in r.query("camera", q="MEDIAMTX")] == ["mediamtx_died"]
    assert r.query("camera", limit=1)[0]["event"] == "mediamtx_died"
    mtx = r.query("mediamtx", level="ERROR")
    assert len(mtx) == 1 and "8189" in mtx[0]["event"]


def test_mediamtx_copytruncate(monkeypatch, tmp_path):
    monkeypatch.setattr(external, "MEDIAMTX_DIR", tmp_path)
    monkeypatch.setattr(external, "MEDIAMTX_LOG", tmp_path / "mediamtx.log")
    with external.open_for_child() as f:
        f.write(b"x" * 500)
        f.flush()               # MediaMTX to'g'ridan-to'g'ri yozadi; testda bufer bor
        assert external.rotate_if_large(max_bytes=100) is True
        f.write(b"yangi\n")
    assert (tmp_path / "mediamtx.log").stat().st_size < 100
    archives = list(tmp_path.glob("mediamtx-*.log"))
    assert len(archives) == 1 and archives[0].stat().st_size == 500
    old = tmp_path / "mediamtx-2000-01-01-0000.log"
    old.write_text("eski")
    os.utime(old, (time.time() - 90 * 86400,) * 2)
    assert external.cleanup(retention_days=30) == 1


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app()) as c:
        yield c


def test_access_log_va_request_id(client):
    r = client.get("/api/v1/stats/summary", headers={**KEY, "X-Request-ID": "mening-id-1"})
    assert r.status_code == 200 and r.headers["X-Request-ID"] == "mening-id-1"
    r2 = client.get("/api/v1/stats/summary", headers={**KEY, "X-Request-ID": "yomon\nid"})
    assert len(r2.headers["X-Request-ID"]) == 12            # xavfli ID almashtiriladi
    acc = [x for x in _lines("access") if x.get("request_id") == "mening-id-1"]
    assert acc and acc[-1]["status"] == 200 and acc[-1]["auth"] == "key"
    assert acc[-1]["path"] == "/api/v1/stats/summary" and acc[-1]["ms"] >= 0
    body = client.get("/api/v1/admin/logs", headers=KEY,
                      params={"category": "access", "request_id": "mening-id-1"}).json()
    assert body["count"] >= 1 and body["items"][0]["request_id"] == "mening-id-1"


def test_logs_api(client):
    log("auth", "api_sinov_hodisasi", level="error")
    r = client.get("/api/v1/admin/logs", headers=KEY,
                   params={"category": "errors", "event": "api_sinov_hodisasi", "hours": 1})
    assert r.status_code == 200 and r.json()["count"] == 1
    assert client.get("/api/v1/admin/logs?category=nimadir", headers=KEY).status_code == 422
    assert client.get("/api/v1/admin/logs").status_code == 401
    files = client.get("/api/v1/admin/logs/files", headers=KEY).json()
    cats = {c["category"]: c for c in files["categories"]}
    assert "security" in cats and cats["security"]["files"] >= 1
    name = cats["security"]["files_list"][0]["name"]
    dl = client.get(f"/api/v1/admin/logs/files/security/{name}", headers=KEY)
    assert dl.status_code == 200 and "api_sinov_hodisasi" in dl.text
    # ".." ni HTTP mijozning o'zi qisqartiradi (boshqa manzilga boradi) — kodlanganlari sinaladi.
    for bad in ("..%2F..%2F.env", "%2E%2E", "a%5Cb", ".env"):
        assert client.get(f"/api/v1/admin/logs/files/security/{bad}",
                          headers=KEY).status_code == 404
    summary = client.get("/api/v1/admin/logs/summary?hours=1", headers=KEY).json()
    assert summary["categories"]["security"].get("ERROR", 0) >= 1
