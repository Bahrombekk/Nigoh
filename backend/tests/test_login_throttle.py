"""Kirish (login) brute-force himoyasi.

Ikkita xossani qulflaydi:

  * cheklov AYLANIB O'TILMAYDI — `X-Forwarded-For` faqat ishonchli
    proksidan hisobga olinadi, aks holda hujumchi har so'rovda soxta
    sarlavha yuborib har safar yangi hisob ochib olardi;
  * cheklov SERVERNI TO'XTATMAYDI — kutish mijozga aytiladi (429 +
    Retry-After / retry_after), so'rov ichida uxlanmaydi;
  * v3 siyosati: (login, ip) bo'yicha 5 xato -> 5 daqiqa blok, 401 da
    `remaining`. Ilgari bu yerda 30 s gacha
    `time.sleep` bor edi va 40 ta parallel urinish Starlette'ning
    threadpool'ini to'ldirib butun API'ni javobsiz qoldirardi.
"""
import time

import pytest
from fastapi.testclient import TestClient

from app.factory import create_app
from users import api as auth


@pytest.fixture(autouse=True)
def _toza_hisob():
    """Har test toza hisob bilan boshlansin — hisob modul darajasida."""
    auth._login_throttle._fails.clear()
    yield
    auth._login_throttle._fails.clear()


@pytest.fixture(scope="module")
def ui_client(request):
    with TestClient(create_app()) as c:
        yield c


# ---------- ishonchli proksi ----------

def test_soxta_forwarded_for_hisobga_olinmaydi():
    """Internetdan to'g'ridan kelgan so'rovning sarlavhasi — hujumchining
    so'zi, unga ishonilmaydi."""
    class Req:
        def __init__(self, peer, fwd):
            self.client = type("C", (), {"host": peer})()
            self.headers = {"x-forwarded-for": fwd}

    # Ommaviy manzildan kelgan: sarlavha e'tiborsiz, hisob peer bo'yicha.
    assert auth._client_ip(Req("8.8.8.8", "1.2.3.4")) == "8.8.8.8"
    # Nginx (loopback) ortidan kelgan: haqiqiy tomoshabin sarlavhada.
    assert auth._client_ip(Req("127.0.0.1", "9.9.9.9")) == "9.9.9.9"
    # Zanjir bo'lsa birinchisi — eng tashqi mijoz.
    assert auth._client_ip(Req("127.0.0.1", "9.9.9.9, 10.0.0.5")) == "9.9.9.9"


def test_ishonchli_proksi_toifalari():
    assert auth._ishonchli_proksi("127.0.0.1")
    assert auth._ishonchli_proksi("10.0.0.5")        # ichki tarmoq
    assert not auth._ishonchli_proksi("8.8.8.8")      # ommaviy
    assert not auth._ishonchli_proksi("testclient")   # ip emas


# ---------- v3 siyosati: 5 xato -> 5 daqiqa blok ----------

KALIT = ("odam", "ip1")


def test_besh_xatogacha_blok_yoq_keyin_blok():
    for qolgan in range(auth._FAIL_MAX - 1, -1, -1):
        assert auth._retry_after(KALIT) == 0.0
        assert auth._note_fail(KALIT) == qolgan          # blokgacha qolgan urinishlar
    kutish = auth._retry_after(KALIT)
    assert auth._BLOCK_S - 5 < kutish <= auth._BLOCK_S   # 5 daqiqa


def test_blok_login_va_ip_boyicha():
    """Bitta ip'dan boshqa loginga urinish begona hisobni qulflamaydi."""
    for _ in range(auth._FAIL_MAX):
        auth._note_fail(("a", "ip9"))
    assert auth._retry_after(("a", "ip9")) > 0
    assert auth._retry_after(("b", "ip9")) == 0.0
    assert auth._retry_after(("a", "ip8")) == 0.0
    assert auth._login_key(" Admin ", "ip9") == ("admin", "ip9")


def test_togri_parol_hisobni_tozalaydi():
    for _ in range(auth._FAIL_MAX - 1):
        auth._note_fail(("c", "ip3"))
    auth._clear_fails(("c", "ip3"))
    assert auth._note_fail(("c", "ip3")) == auth._FAIL_MAX - 1


def test_blok_tugagach_hisob_noldan(monkeypatch):
    for _ in range(auth._FAIL_MAX):
        auth._note_fail(("d", "ip4"))
    assert auth._retry_after(("d", "ip4")) > 0
    t = time.monotonic() + auth._BLOCK_S + 1
    monkeypatch.setattr("core.throttle.time.monotonic", lambda: t)
    assert auth._retry_after(("d", "ip4")) == 0.0
    assert auth._note_fail(("d", "ip4")) == auth._FAIL_MAX - 1


# ---------- endpoint xatti-harakati ----------

def test_401_remaining_va_429_retry_after(ui_client):
    xato = {"username": "yoq-bunday-odam", "password": "xato"}
    for qolgan in range(auth._FAIL_MAX - 1, -1, -1):
        r = ui_client.post("/api/v1/auth/login", json=xato)
        assert r.status_code == 401
        assert r.json() == {"detail": "Login yoki parol notoʻgʻri", "remaining": qolgan}

    boshlandi = time.monotonic()
    r = ui_client.post("/api/v1/auth/login", json=xato)
    ketgan = time.monotonic() - boshlandi

    assert r.status_code == 429
    body = r.json()
    assert body["detail"] == "5 daqiqadan keyin qayta urinib koʻring"
    assert 290 <= body["retry_after"] <= 300
    assert int(r.headers["Retry-After"]) == body["retry_after"]
    # Eng muhimi: javob DARHOL keldi — so'rov ichida uxlanmadi.
    assert ketgan < 1.0, f"so'rov {ketgan:.1f} s ushlab turildi — uxlash qaytibdi"
    # Boshqa login shu ip'dan kira oladi (blok login+ip bo'yicha).
    assert ui_client.post("/api/v1/auth/login",
                          json={"username": "boshqa-odam", "password": "x"}).status_code == 401


def test_togri_parol_bilan_kirish_ishlaydi(ui_client):
    """Cheklov qayta yozilgandan keyin ham oddiy kirish buzilmasin.

    Cookie'ning `secure` bayrog'i http'da QO'YILMASLIGI kerak — aks holda
    brauzer uni saqlamaydi va lokal debug UI umuman kira olmaydi.
    """
    from core import security
    from database import get_db

    with get_db() as db:
        security.set_password(db, "sinov-admin", "SinovParol123")

    r = ui_client.post("/api/v1/auth/login",
                       json={"username": "sinov-admin", "password": "SinovParol123"})
    assert r.status_code == 200, r.text
    assert r.json()["username"] == "sinov-admin"

    cookie = r.headers["set-cookie"]
    assert security.SESSION_COOKIE in cookie
    assert "HttpOnly" in cookie
    assert "secure" not in cookie.lower(), "http'da secure qo'yilsa UI kira olmaydi"

    assert ui_client.get("/api/v1/auth/me").json()["authenticated"] is True


def test_cheklangan_urinish_hisobni_oshirmaydi(ui_client):
    """Blok davomidagi urinish hisobni oshirmaydi va blokni uzaytirmaydi —
    aks holda tinmay urinayotgan hujumchi blokni cheksiz cho'zardi."""
    xato = {"username": "yoq-bunday-odam", "password": "xato"}
    for _ in range(auth._FAIL_MAX):
        ui_client.post("/api/v1/auth/login", json=xato)

    kalit = auth._login_key("yoq-bunday-odam", "testclient")
    birinchi = auth._retry_after(kalit)
    for _ in range(10):                        # 429 oladigan urinishlar
        assert ui_client.post("/api/v1/auth/login", json=xato).status_code == 429
    assert auth._retry_after(kalit) <= birinchi
