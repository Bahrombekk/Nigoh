"""Xavfsizlik auditi (2026-10-15) tuzatishlari — qaytib kelmasin.

  * eksport: kameradan kelgan matn jadval formulasi bo'lib bajarilmaydi;
  * NVR kanal oralig'i kengaytirishdan oldin cheklanadi (xotira DoS);
  * RTSP yo'lida CR/LF yo'q (RTSP sarlavha injection);
  * saqlangan parol faqat kameraning o'z manziliga beriladi;
  * CSP: script-src'da 'unsafe-inline' va keraksiz CDN'lar yo'q;
  * bo'sh ADMIN_PAROL bo'sh parolli admin yaratmaydi.
"""
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from camera.api import admin
from camera.schemas import ProbeIn
from core import security


def test_eksport_formula_bajarilmaydi():
    row = {"model": "=HYPERLINK(\"http://x\")", "name": "+998", "note": "oddiy", "km": -5}
    assert admin._export_value(row, "online", "model").startswith("'=")
    assert admin._export_value(row, "online", "name") == "'+998"
    assert admin._export_value(row, "online", "note") == "oddiy"
    assert admin._export_value(row, "online", "km") == -5        # son — o'zgarmaydi


def test_kanal_oraligi_kengaytirishdan_oldin_cheklanadi():
    with pytest.raises(HTTPException) as e:
        admin.parse_channels("1-999999999")
    assert e.value.status_code == 400
    assert admin.parse_channels("1-4,8") == [1, 2, 3, 4, 8]


def test_rtsp_yolida_boshqaruv_belgilari_yoq():
    with pytest.raises(ValidationError):
        ProbeIn(ip="10.0.0.1", rtsp_path="/s1\r\nX-Injected: 1")
    assert ProbeIn(ip="10.0.0.1", rtsp_path="/Streaming/Channels/101").rtsp_path


def test_saqlangan_parol_faqat_oz_manziliga():
    row = {"ip": "10.0.0.5", "password_enc": security.encrypt("maxfiy")}
    assert security.stored_password_for(row, "10.0.0.5") == "maxfiy"
    assert security.stored_password_for(row, " 10.0.0.5 ") == "maxfiy"
    assert security.stored_password_for(row, "203.0.113.9") == ""
    assert security.stored_password_for(None, "10.0.0.5") == ""


def test_yol_tozaligi():
    assert security.safe_stream_path("kamera_1/index.m3u8")
    for yomon in ("kamera_1/../kamera_2", "kamera_1/./x", "kamera_1/%2e%2e/x", "a\\b"):
        assert not security.safe_stream_path(yomon), yomon


def test_csp_inline_skriptsiz():
    from app import factory
    script_src = next(p for p in factory._CSP.split(";") if p.strip().startswith("script-src"))
    assert "'unsafe-inline'" not in script_src
    assert "unpkg.com" not in factory._CSP and "jsdelivr" not in factory._CSP
    assert "object-src 'none'" in factory._CSP


def test_bosh_admin_paroli_rad_etiladi(monkeypatch):
    class Bosh:
        @staticmethod
        def count(db):
            return 0

        @staticmethod
        def create(*a, **kw):
            raise AssertionError("bo'sh parol bilan admin yaratilmasligi kerak")

    monkeypatch.setattr(security, "users", Bosh)
    monkeypatch.setenv("ADMIN_PAROL", "123")
    with pytest.raises(RuntimeError):
        security.ensure_admin(None)
