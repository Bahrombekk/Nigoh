"""Kameraning yagona holati (camera/state.py): onlayn, tasvirsiz, uzilgan, tekshirilmagan.

Qulflanadigan qoidalar (2026-10-07):
  * port ochiq, lekin parol/oqim xatosi yoki ~30 daqiqa kadr yo'q — "tasvirsiz"
    (ilgari bunday kamera "onlayn · video kelyapti" deb sanalardi);
  * uzilishdan yangi qaytgan kameraning eski surati "tasvirsiz" qilmaydi;
  * pasportdagi eski "tarmoq" xatosi onlayn kamerani buzmaydi;
  * server hali tekshirmagan yoki IP yo'q — "tekshirilmagan"; o'chirilgan — alohida.
"""
from datetime import datetime, timedelta, timezone

import pytest

from camera import state
from camera.media import reconciler
from camera.monitoring import health, snapshots

NOW = datetime.now(timezone.utc)


def row(**kw):
    base = {"enabled": True, "ip": "10.0.0.5", "port": 554, "slug": "k1",
            "probe_error": None, "snapshot_at": NOW - timedelta(minutes=5)}
    base.update(kw)
    return base


@pytest.fixture()
def env(monkeypatch):
    s = {"online": True, "for": 3600.0, "stalled": set()}
    monkeypatch.setattr(health, "online", lambda ip, port: s["online"])
    monkeypatch.setattr(health, "online_for", lambda ip, port: s["for"] if s["online"] else None)
    monkeypatch.setattr(snapshots, "max_age", lambda: 1800.0)
    monkeypatch.setattr(reconciler, "stalled_paths", lambda: s["stalled"])
    return s


def test_onlayn_va_uzilgan(env):
    assert state.camera_state_reason(row()) == ("online", "")
    env["online"] = False
    assert state.camera_state(row()) == "offline"


def test_tasvirsiz_sabablari(env):
    assert state.camera_state_reason(row(probe_error="parol: Login yoki parol noto'g'ri")) == \
        ("stalled", "parol notoʻgʻri")
    st, why = state.camera_state_reason(row(snapshot_at=NOW - timedelta(minutes=50)))
    assert st == "stalled" and "50 daqiqa" in why
    assert state.camera_state_reason(row(snapshot_at=None))[0] == "stalled"
    assert state.camera_state_reason(row(snapshot_at=(NOW - timedelta(hours=3)).isoformat()))[0] == "stalled"
    env["stalled"] = {"k1_h264"}
    assert state.camera_state_reason(row()) == ("stalled", "ochiq oqimga tasvir kelmayapti")
    env["stalled"] = {"k1_sub"}                        # sub oqim muzlashi hisobga olinmaydi
    assert state.camera_state(row()) == "online"


def test_yangi_qaytgan_va_eski_tarmoq_xatosi(env):
    env["for"] = 300.0                                  # 5 daqiqa oldin qaytgan — surat hali eski
    assert state.camera_state(row(snapshot_at=NOW - timedelta(hours=5))) == "online"
    env["for"] = 3600.0
    assert state.camera_state(row(probe_error="tarmoq: javob bermadi")) == "online"


def test_tekshirilmagan_va_ochirilgan(env):
    env["online"] = None
    assert state.camera_state_reason(row()) == ("unknown", "server hali tekshirmagan")
    assert state.camera_state(row(ip=None)) == "unknown"
    assert state.camera_state(row(enabled=False)) == "disabled"
