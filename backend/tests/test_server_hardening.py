"""Xavfsizlik auditi (2026-10-15) — server/tarmoq sozlamasiga bog'liq tuzatishlar.

  * masofaviy MediaMTX tugunining API/metrikasi auth'dan ozod emas, markaz
    `_api()` da Basic auth yuboradi, `/auth/stream` action=api ni faqat shu
    bilan o'tkazadi; lokal tugun o'zgarmaydi;
  * TRUSTED_PROXIES bo'sh bo'lsa faqat loopback ishonchli (ichki tarmoq emas);
  * Docker HTTPS CA'si NameConstraints bilan, kaliti nginx papkasidan tashqarida;
  * HLS sessiyasi mijoz cookie'siga bog'lanadi (NAT qo'shnisi chiptasiz kirmaydi);
  * nginx: HSTS faqat certbot sertifikatida, /media/whep/ ostida faqat WHEP;
    nisbiy MEDIA_BASE'da CORS `*` emas; SSE ruxsat yo'qolsa yopiladi;
    /docs va /openapi.json kirishsiz ochilmaydi.
"""
import asyncio
import base64
import importlib
import sys
from pathlib import Path

import pytest
import yaml
from cryptography import x509
from fastapi.testclient import TestClient
from starlette.requests import Request

from app import deps, network
from app.factory import create_app
from camera.api import events
from camera.media import sync
from core import security

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import docker_https  # noqa: E402
import nginx_conf  # noqa: E402

KEY = {"X-API-Key": "test-kalit"}
UZOQ = {"public_host": "node2.example.uz", "api_base": "http://10.0.0.5:9997"}


@pytest.fixture(scope="module")
def client():
    # nginx backend bilan bir mashinada — so'rov 127.0.0.1 dan keladi.
    with TestClient(create_app(), client=("127.0.0.1", 50000)) as c:
        yield c


@pytest.fixture(autouse=True)
def _toza_hisob():
    deps._key_throttle._fails.clear()
    yield
    deps._key_throttle._fails.clear()


# ---------- 1. masofaviy MediaMTX tuguni API'si ----------

def test_uzoq_tugunda_api_auth_dan_ozod_emas():
    c = yaml.safe_load(sync.build_config([], node=UZOQ))
    assert c["apiAddress"].startswith(":")          # markaz yetishi kerak
    assert c["authHTTPExclude"] == []               # ... lekin auth bilan


def test_lokal_tugun_ozligicha_qoladi():
    c = yaml.safe_load(sync.build_config([]))
    assert c["apiAddress"].startswith("127.0.0.1:")
    assert {"action": "api"} in c["authHTTPExclude"]
    assert {"action": "metrics"} in c["authHTTPExclude"]


class _Javob:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return b"{}"


def _ushlangan_sarlavha(monkeypatch, api_base):
    olingan = {}

    def urlopen(req, timeout=None):
        olingan["auth"] = req.get_header("Authorization")
        return _Javob()

    monkeypatch.setattr(sync.urllib.request, "urlopen", urlopen)
    sync._api("GET", "/v3/config/global/get", api_base=api_base)
    return olingan["auth"]


def test_markaz_uzoq_tugunga_basic_auth_yuboradi(monkeypatch):
    auth = _ushlangan_sarlavha(monkeypatch, UZOQ["api_base"])
    assert auth and auth.startswith("Basic ")
    user, _, parol = base64.b64decode(auth[6:]).decode().partition(":")
    assert security.node_api_ok(user, parol)


def test_lokal_tugunga_auth_yuborilmaydi(monkeypatch):
    assert _ushlangan_sarlavha(monkeypatch, "http://127.0.0.1:9997") is None


def _stream(client, **body):
    return client.post("/api/auth/stream", json={"ip": "10.0.0.99", "path": "", **body})


def test_tugun_api_si_faqat_markaz_paroli_bilan(client):
    ok = _stream(client, action="api", user=security.NODE_API_USER,
                 password=security.node_api_token())
    assert ok.status_code == 200
    assert _stream(client, action="metrics", user=security.NODE_API_USER,
                   password=security.node_api_token()).status_code == 200
    assert _stream(client, action="api").status_code == 401
    assert _stream(client, action="api", user=security.NODE_API_USER,
                   password="soxta").status_code == 401
    # Tomoshabin chiptasi ham, ichki chipta ham API'ni ochmaydi.
    tok = security.stream_token("kam_a")
    assert _stream(client, action="api", query=f"token={tok}").status_code == 401
    assert _stream(client, action="pprof", user=security.NODE_API_USER,
                   password=security.node_api_token()).status_code == 401


# ---------- 2. ishonchli proksi ----------

def test_standart_faqat_loopback(monkeypatch):
    monkeypatch.setattr(network, "TRUSTED_PROXIES", set())
    monkeypatch.setattr(network, "_TRUSTED_NETS", [])
    assert network.ishonchli_proksi("127.0.0.1")
    assert network.ishonchli_proksi("::1")
    assert network.ishonchli_proksi("::ffff:127.0.0.1")
    for ip in ("10.0.0.5", "192.168.1.10", "172.17.0.1", "8.8.8.8", "testclient"):
        assert not network.ishonchli_proksi(ip), ip


def test_trusted_proxies_cidr_bilan(monkeypatch):
    qiymat = {"10.0.0.7", "172.18.0.0/16"}
    monkeypatch.setattr(network, "TRUSTED_PROXIES", qiymat)
    monkeypatch.setattr(network, "_TRUSTED_NETS", network._tarmoqlar(qiymat))
    assert network.ishonchli_proksi("10.0.0.7")
    assert network.ishonchli_proksi("172.18.3.4")
    assert not network.ishonchli_proksi("10.0.0.8")
    assert not network.ishonchli_proksi("127.0.0.1")      # aniq ro'yxat — faqat o'shalar


def test_docker_compose_env_loopback_beradi():
    env = docker_https.compose_env(["192.168.1.5"], server=True)
    assert "TRUSTED_PROXIES=127.0.0.1,::1" in env


# ---------- 3. CA: NameConstraints va kalit joyi ----------

def test_yangi_ca_cheklangan_va_kaliti_tls_dan_tashqarida(tmp_path):
    tls, ca_dir = tmp_path / "tls", tmp_path / "ca"
    tls.mkdir()
    cert, key = docker_https.ensure_ca(tls, ca_dir, ["192.168.1.5"])
    assert (ca_dir / "ca.key").exists() and not (tls / "ca.key").exists()
    assert (tls / "ca.crt").exists()

    ext = cert.extensions.get_extension_for_class(x509.NameConstraints)
    assert ext.critical
    ruxsat = {str(n.value) for n in ext.value.permitted_subtrees}
    assert ruxsat == {"localhost", "127.0.0.1/32", "192.168.1.5/32"}

    # Server sertifikati shu CA bilan chiqadi va cheklov ichida.
    docker_https.issue_server(tls, cert, key, ["192.168.1.5"])
    assert (tls / "server.crt").exists()


def test_ca_begona_sayt_uchun_ishlatib_bolmaydi(tmp_path):
    """Kalit sizsa ham: CA bilan yasalgan "bank.uz" sertifikati rad etiladi."""
    import datetime as dt
    import ipaddress

    from cryptography.hazmat.primitives import hashes
    from cryptography.x509.oid import NameOID
    from cryptography.x509.verification import PolicyBuilder, Store, VerificationError

    tls = tmp_path / "tls"
    tls.mkdir()
    ca, ca_key = docker_https.ensure_ca(tls, tmp_path / "ca", ["192.168.1.5"])
    docker_https.issue_server(tls, ca, ca_key, ["192.168.1.5"])
    ozimiz = x509.load_pem_x509_certificates((tls / "server.crt").read_bytes())[0]
    store = Store([ca])
    PolicyBuilder().store(store).build_server_verifier(
        x509.IPAddress(ipaddress.ip_address("192.168.1.5"))).verify(ozimiz, [])

    k = docker_https._key()
    now = dt.datetime.now(dt.timezone.utc)
    soxta = (x509.CertificateBuilder()
             .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "bank.uz")]))
             .issuer_name(ca.subject).public_key(k.public_key())
             .serial_number(x509.random_serial_number())
             .not_valid_before(now - dt.timedelta(days=1))
             .not_valid_after(now + dt.timedelta(days=30))
             .add_extension(x509.SubjectAlternativeName([x509.DNSName("bank.uz")]), critical=False)
             .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
             .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()),
                            critical=False)
             .sign(ca_key, hashes.SHA256()))
    with pytest.raises(VerificationError):
        PolicyBuilder().store(store).build_server_verifier(x509.DNSName("bank.uz")).verify(soxta, [])


def test_eski_kalit_nginx_papkasidan_kochiriladi(tmp_path):
    tls, ca_dir = tmp_path / "tls", tmp_path / "ca"
    tls.mkdir()
    cert, _ = docker_https.ensure_ca(tls, ca_dir, ["192.168.1.5"])
    (ca_dir / "ca.key").replace(tls / "ca.key")          # eski joylashuv
    cert2, _ = docker_https.ensure_ca(tls, ca_dir, ["192.168.1.5"])
    assert cert2.serial_number == cert.serial_number      # o'sha CA saqlanadi
    assert (ca_dir / "ca.key").exists() and not (tls / "ca.key").exists()


def test_cheklovdan_tashqari_ip_da_toxtaydi(tmp_path):
    tls, ca_dir = tmp_path / "tls", tmp_path / "ca"
    tls.mkdir()
    docker_https.ensure_ca(tls, ca_dir, ["192.168.1.5"])
    with pytest.raises(ValueError):
        docker_https.ensure_ca(tls, ca_dir, ["10.9.9.9"])
    yangi, _ = docker_https.ensure_ca(tls, ca_dir, ["10.9.9.9"], new_ca=True)
    assert docker_https.ca_covers(yangi, ["10.9.9.9"], [])
    assert (tls / "ca.crt.old").exists()


# ---------- 4. HLS sessiyasi mijoz cookie'siga bog'lanadi ----------

def _hls(client, uri, ip, cookie=None, yangi_nginx=True):
    h = {"X-Original-URI": uri, "X-Viewer-IP": ip}
    if yangi_nginx:
        h["X-Nigoh-Hls-Cookie"] = "1"
    if cookie:
        h["Cookie"] = f"{security.HLS_CLIENT_COOKIE}={cookie}"
    return client.get("/api/auth/hls", headers=h)


def test_nat_qoshnisi_chiptasiz_segment_ololmaydi(client):
    ip = "198.51.100.20"      # ikkala odam bitta NAT ortida
    tok = security.stream_token("kam_nat")
    r = _hls(client, f"/media/hls/kam_nat/index.m3u8?token={tok}", ip)
    assert r.status_code == 204
    belgi = r.cookies.get(security.HLS_CLIENT_COOKIE)
    assert belgi and security.valid_hls_client(belgi)
    assert "httponly" in r.headers["set-cookie"].lower()
    assert "path=/media/hls/" in r.headers["set-cookie"].lower()

    seg = "/media/hls/kam_nat/video1_seg3.mp4"
    assert _hls(client, seg, ip, cookie=belgi).status_code == 204       # egasi
    assert _hls(client, seg, ip).status_code == 401                     # cookie'siz qo'shni
    assert _hls(client, seg, ip, cookie=security.new_hls_client()).status_code == 401


def test_cookie_bor_bolsa_yangisi_berilmaydi(client):
    belgi = security.new_hls_client()
    tok = security.stream_token("kam_nat2")
    r = _hls(client, f"/media/hls/kam_nat2/index.m3u8?token={tok}", "198.51.100.21",
             cookie=belgi)
    assert r.status_code == 204
    assert "set-cookie" not in r.headers
    assert _hls(client, "/media/hls/kam_nat2/x.mp4", "198.51.100.21",
                cookie=belgi).status_code == 204


def test_eski_nginx_konfiguratsiyasi_buzilmaydi(client):
    """Qayta yaratilmagan nginx (sarlavhasiz) — avvalgidek (ip, yo'l)."""
    ip = "198.51.100.22"
    tok = security.stream_token("kam_eski")
    r = _hls(client, f"/media/hls/kam_eski/index.m3u8?token={tok}", ip, yangi_nginx=False)
    assert r.status_code == 204 and "set-cookie" not in r.headers
    assert _hls(client, "/media/hls/kam_eski/s.mp4", ip, yangi_nginx=False).status_code == 204


def test_whep_sessiyasi_cookie_rejimida_hlsni_ochmaydi(client):
    """WHEP (MediaMTX auth'i) ochgan (ip, yo'l) sessiyasi cookie'siz HLS'ga o'tmasin."""
    ip = "198.51.100.23"
    assert security.stream_access_ok(ip, "kam_w", security.stream_token("kam_w"))
    assert _hls(client, "/media/hls/kam_w/s.mp4", ip).status_code == 401


# ---------- 5. nginx konfiguratsiyasi va qolganlar ----------

def _nginx(**kw):
    return nginx_conf.build(domain="kamera.example.uz", api_port=8010, hls_port=8888,
                            webrtc_port=8889, secret="sir", ssl=True,
                            cert_dir="/etc/letsencrypt/live", **kw)


def test_hsts_faqat_ishonchli_sertifikatda():
    assert "Strict-Transport-Security" in _nginx()
    oz = _nginx(cert_file="/etc/nginx/tls/server.crt", key_file="/etc/nginx/tls/server.key")
    assert "Strict-Transport-Security" not in oz
    assert "Strict-Transport-Security" not in nginx_conf.build(
        domain="x", api_port=1, hls_port=2, webrtc_port=3, secret="s", ssl=False, cert_dir="")


def test_whep_ostida_faqat_whep():
    conf = _nginx()
    assert "proxy_pass http://127.0.0.1:8889/;" not in conf     # butun port ochiq emas
    assert "/whep(?:/[A-Za-z0-9-]+)?)$" in conf
    assert "return 404;" in conf
    import re
    naqsh = re.search(r"location ~ (\^/media/whep/\S+) \{", conf).group(1)
    naqsh = naqsh.replace("(?<whep_yol>", "(?P<whep_yol>")
    for ok in ("/media/whep/kam_1/whep", "/media/whep/kam_1/whep/3f2a-11ee-9c"):
        assert re.match(naqsh, ok), ok
    for yoq in ("/media/whep/kam_1/whip", "/media/whep/kam_1/", "/media/whep/kam_1/reader.js",
                "/media/whep/kam_1/whip/abc"):
        assert not re.match(naqsh, yoq), yoq


def test_nginx_hls_cookie_uzatadi():
    conf = _nginx()
    assert "auth_request_set $nigoh_hls_cookie $upstream_http_set_cookie;" in conf
    assert "add_header Set-Cookie $nigoh_hls_cookie always;" in conf
    assert "proxy_set_header X-Nigoh-Hls-Cookie 1;" in conf


def test_nisbiy_media_base_da_origin_yulduzcha_emas(monkeypatch):
    monkeypatch.setenv("MEDIA_BASE", "/media")
    monkeypatch.setenv("WEBRTC_HOSTS", "192.168.1.5")
    monkeypatch.delenv("ALLOW_ORIGINS", raising=False)
    importlib.reload(sync)
    try:
        c = yaml.safe_load(sync.build_config([]))
        assert "*" not in c["hlsAllowOrigins"]
        assert "https://192.168.1.5" in c["hlsAllowOrigins"]
        assert c["webrtcAllowOrigins"] == c["hlsAllowOrigins"]
    finally:
        monkeypatch.undo()
        importlib.reload(sync)


def _sse_request(headers=()):
    return Request({"type": "http", "method": "GET", "path": "/api/v1/events",
                    "headers": [(k.lower().encode(), v.encode()) for k, v in headers],
                    "client": ("127.0.0.1", 1), "query_string": b""})


def test_sse_ruxsat_yoqolsa_yopiladi(monkeypatch):
    holat = {"ruxsat": True}
    monkeypatch.setattr(events, "RECHECK_S", 0.0)
    monkeypatch.setattr(events, "_still_allowed", lambda req: holat["ruxsat"])

    async def yurgiz():
        javob = await events.sse_events(_sse_request(KEY.items()))
        it = javob.body_iterator
        birinchi = await it.__anext__()
        holat["ruxsat"] = False                 # masalan foydalanuvchi chiqdi
        ikkinchi = await it.__anext__()
        with pytest.raises(StopAsyncIteration):
            await it.__anext__()
        return birinchi, ikkinchi

    birinchi, ikkinchi = asyncio.run(yurgiz())
    assert "ulandi" in birinchi
    assert ikkinchi.startswith("event: auth")


def test_sse_ruxsat_tekshiruvi():
    assert events._still_allowed(_sse_request(KEY.items()))
    assert not events._still_allowed(_sse_request())            # PUBLIC_VIEW=0, kirmagan


@pytest.mark.parametrize("yol", ["/docs", "/redoc", "/openapi.json"])
def test_api_hujjati_kirishsiz_yopiq(client, yol):
    assert client.get(yol).status_code == 401
    r = client.get(yol, headers=KEY)
    assert r.status_code == 200


def test_api_hujjati_ozining_csp_si_bilan(client):
    r = client.get("/docs", headers=KEY)
    assert "cdn.jsdelivr.net" in r.headers["content-security-policy"]
    assert client.get("/openapi.json", headers=KEY).json()["info"]["title"] == "Nigoh API"
