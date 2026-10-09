#!/usr/bin/env python3
"""Nigoh — Docker (Windows, Docker Desktop) uchun HTTPS tayyorlash: IP bo'yicha.

Domen va Let's Encrypt yo'q joyda sayt mashinaning IP manzilidan HTTPS
bilan ochiladi. Skript `docker-compose.windows.yml` kutadigan hamma
narsani `data/` ga yozadi (papka gitga tushmaydi):

    data/secret.key          ildizdagi kalit nusxasi — kamera parollari
                             shu bilan ochiladi; yo'q bo'lsa konteyner yangi
                             kalit yaratib, bazadagi parollarni o'qiy olmaydi
    data/tls/ca.crt, ca.key  lokal ildiz sertifikat (CA) — bir marta
                             yaratiladi, qayta ishga tushirishda saqlanadi
    data/tls/server.crt/key  sayt sertifikati: SAN'da hamma IP + localhost
    data/nginx/nigoh.conf    nginx (scripts/nginx_conf.py bilan bir manbadan)
    data/compose.env         konteyner muhiti: baza manzili, WEBRTC_HOSTS ...

Nega CA, oddiy self-signed emas: IP o'zgarsa yoki yangisi qo'shilsa
faqat server sertifikati qayta chiqariladi — mijoz kompyuterlarga bir
marta o'rnatilgan `ca.crt` o'z kuchida qoladi.

Mijozda ogohlantirishsiz ochilishi uchun `data/tls/ca.crt` ni
"Ishonchli ildiz sertifikatlar" (Trusted Root Certification
Authorities) ga o'rnating. O'rnatilmasa ham sayt ishlaydi — brauzer bir
marta "xavfsiz emas" deb so'raydi.

Ishlatish — Linux server (docs/SERVER_KOCHIRISH.md), konteyner ichida:

    docker compose run --rm --no-deps nigoh python scripts/docker_https.py --server --ip <IP>

Ishlatish — Windows (loyiha ildizidan):

    venv\\Scripts\\python backend\\scripts\\docker_https.py            # IP'lar avtomatik
    venv\\Scripts\\python backend\\scripts\\docker_https.py --ip 192.168.136.168
    docker compose -f docker-compose.windows.yml up -d --build

Ishlatadi: scripts/nginx_conf.py (build, load_env), core.security.hls_cdn_secret.
"""
import argparse
import datetime as dt
import ipaddress
import os
import shutil
import socket
import sys
from pathlib import Path
from urllib.parse import urlsplit

BASE_DIR = Path(__file__).resolve().parent.parent      # backend/
ROOT_DIR = BASE_DIR.parent
sys.path.insert(0, str(BASE_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import nginx_conf  # noqa: E402
from cryptography import x509  # noqa: E402
from cryptography.hazmat.primitives import hashes, serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID  # noqa: E402

# Konteyner ichidagi yo'llar (docker-compose.windows.yml dagi volume'lar).
TLS_IN_CONTAINER = "/etc/nginx/tls"
# Docker Desktop'da hostdagi xizmatga shu nom bilan ulaniladi; ulanish
# PostgreSQL'ga localhost'dan kelgandek ko'rinadi — pg_hba o'zgarmaydi.
DB_HOST = "host.docker.internal"


def local_ips() -> list[str]:
    """Mashinaning IPv4 manzillari (link-local 169.254.x va loopback'siz)."""
    found: list[str] = []
    for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_loopback or ip.is_link_local or str(ip) in found:
            continue
        found.append(str(ip))
    return found


def _key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


def _write_key(path: Path, key) -> None:
    path.write_bytes(key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption()))


def ensure_ca(tls: Path):
    """Lokal CA — bor bo'lsa o'shani qaytaradi (mijozlardagi ishonch saqlanadi)."""
    crt, key = tls / "ca.crt", tls / "ca.key"
    if crt.exists() and key.exists():
        return (x509.load_pem_x509_certificate(crt.read_bytes()),
                serialization.load_pem_private_key(key.read_bytes(), None))
    k = _key()
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Nigoh local CA")])
    now = dt.datetime.now(dt.timezone.utc)
    cert = (x509.CertificateBuilder()
            .subject_name(name).issuer_name(name)
            .public_key(k.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - dt.timedelta(days=1))
            .not_valid_after(now + dt.timedelta(days=3650))
            .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
            .add_extension(x509.KeyUsage(
                digital_signature=False, content_commitment=False, key_encipherment=False,
                data_encipherment=False, key_agreement=False, key_cert_sign=True,
                crl_sign=True, encipher_only=False, decipher_only=False), critical=True)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(k.public_key()), critical=False)
            .sign(k, hashes.SHA256()))
    _write_key(key, k)
    crt.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return cert, k


def issue_server(tls: Path, ca_cert, ca_key, ips: list[str]) -> None:
    """Sayt sertifikati. Brauzerlar 398 kundan uzunini rad etadi — 397 kun."""
    k = _key()
    san = [x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]
    san += [x509.IPAddress(ipaddress.ip_address(ip)) for ip in ips]
    now = dt.datetime.now(dt.timezone.utc)
    cert = (x509.CertificateBuilder()
            .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, ips[0] if ips else "localhost")]))
            .issuer_name(ca_cert.subject)
            .public_key(k.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - dt.timedelta(days=1))
            .not_valid_after(now + dt.timedelta(days=397))
            .add_extension(x509.SubjectAlternativeName(san), critical=False)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
            .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
            .sign(ca_key, hashes.SHA256()))
    _write_key(tls / "server.key", k)
    # Zanjir: server + CA — mijoz CA'ni o'rnatmagan bo'lsa ham to'liq ko'rinadi.
    (tls / "server.crt").write_bytes(cert.public_bytes(serialization.Encoding.PEM)
                                     + ca_cert.public_bytes(serialization.Encoding.PEM))


def compose_env(ips: list[str], server: bool = False) -> str:
    """Konteyner muhiti.

    Windows: faqat kerakli qiymatlar — .env butunligicha (superuser
    paroli, test bazasi) konteynerga berilmaydi, baza host.docker.internal.
    Server (--server): .env konteynerga baribir beriladi (docker-compose.yml),
    bu fayl faqat HTTPS uchun kerak bo'lganlarni ustidan yozadi.
    """
    lines = ["# AVTOMATIK YARATILGAN: backend/scripts/docker_https.py — qo'lda tahrirlamang."]
    if not server:
        url = urlsplit(os.environ["DATABASE_URL"])
        db = url._replace(netloc=f"{url.username}:{url.password}@{DB_HOST}:{url.port or 5432}").geturl()
        lines += [
            f"DATABASE_URL={db}",
            f"PORT={os.environ.get('PORT', '8010')}",
            f"PUBLIC_VIEW={os.environ.get('PUBLIC_VIEW', '1')}",
        ]
    lines += [
        # Oqimlar nginx orqali, sahifa ochilgan manzilning o'zidan (nisbiy yo'l)
        # — sayt qaysi IP'dan ochilsa ham video o'sha IP'dan keladi.
        "MEDIA_BASE=/media",
        # WebRTC media (8189) nginx'dan o'tmaydi: brauzer shu IP'larga to'g'ridan ulanadi.
        f"WEBRTC_HOSTS={','.join(ips)}",
        # nginx shu konteyner tarmog'ida (127.0.0.1) — X-Forwarded-* faqat undan.
        "TRUSTED_PROXIES=127.0.0.1,::1",
    ]
    if server:
        # Server — oddiy Linux: rmem_max sysctl bilan oshiriladi (yo'riqnoma),
        # bufer standart 8 MB qoladi.
        return "\n".join(lines) + "\n"
    lines += [
        # Docker Desktop VM'ida net.core.rmem_max ~104 KB va konteyner uni
        # o'zgartira olmaydi (namespace'lanmagan sysctl). 8 MB so'ralsa
        # MediaMTX umuman ko'tarilmaydi ("unable to set UDP read buffer
        # size") — VM ruxsat bergan eng katta qiymat olinadi.
        f"MEDIAMTX_UDP_READ_BUFFER={os.environ.get('DOCKER_UDP_READ_BUFFER', '106496')}",
    ]
    for k in ("NIGOH_TZ", "NIGOH_API_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"):
        if os.environ.get(k):
            lines.append(f"{k}={os.environ[k]}")
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--ip", action="append", default=[],
                    help="Sayt ochiladigan IP (bir necha marta berish mumkin). "
                         "Berilmasa mashinaning hamma IPv4 manzillari olinadi.")
    ap.add_argument("--data", default=str(ROOT_DIR / "data"),
                    help="Konteyner ma'lumot papkasi (standart: ildizdagi data/).")
    ap.add_argument("--server", action="store_true",
                    help="Linux server (docker-compose.yml, host tarmog'i): skript "
                         "konteyner ichida yuradi, baza manzili .env dagicha qoladi.")
    args = ap.parse_args()
    if args.server and "--data" not in sys.argv:
        # Konteyner ichida ma'lumot papkasi /data (NIGOH_DATA), /app/data emas.
        args.data = os.environ.get("NIGOH_DATA") or args.data

    nginx_conf.load_env(ROOT_DIR / ".env")
    if not args.server and not os.environ.get("DATABASE_URL"):
        ap.error(".env da DATABASE_URL yo'q")
    if args.server and not (Path(args.data) / "secret.key").exists():
        # core.security kalit topmasa YANGISINI yaratadi — keyin ko'chirilgan
        # bazadagi kamera parollari ochilmaydi. Shuning uchun bu yerda to'xtaymiz.
        ap.error(f"{Path(args.data) / 'secret.key'} yo'q — eski serverdan "
                 "ko'chirilgan kalitni avval data/ ga qo'ying")
    from core import (
        security,  # .env yuklangandan keyin — kalit servisdagi bilan bir xil
    )

    ips = args.ip or local_ips()
    for ip in ips:
        ipaddress.ip_address(ip)  # noto'g'ri qiymat — darrov xato
    data = Path(args.data)
    tls, ngx = data / "tls", data / "nginx"
    for d in (data, tls, ngx):
        d.mkdir(parents=True, exist_ok=True)

    from core.paths import DATA_DIR
    src_key = DATA_DIR / "secret.key"
    if not (data / "secret.key").exists():
        if not src_key.exists():
            ap.error(f"{src_key} topilmadi — kamera parollari ochilmaydi")
        shutil.copy2(src_key, data / "secret.key")
        print(f"secret.key nusxalandi -> {data / 'secret.key'}")

    # `docker compose up` konfiguratsiyadan OLDIN yurgizilsa Docker bind
    # mount uchun yo'q faylning o'rniga bo'sh PAPKA yaratadi — o'chiramiz.
    conf = ngx / "nigoh.conf"
    if conf.is_dir() and not any(conf.iterdir()):
        conf.rmdir()

    ca_cert, ca_key = ensure_ca(tls)
    issue_server(tls, ca_cert, ca_key, ips)
    (ngx / "nigoh.conf").write_text(nginx_conf.build(
        domain="_",
        api_port=int(os.environ.get("PORT", "8010")),
        hls_port=int(os.environ.get("HLS_PORT", "8888")),
        webrtc_port=int(os.environ.get("WEBRTC_PORT", "8889")),
        secret=security.hls_cdn_secret(),
        ssl=True, cert_dir="",
        cert_file=f"{TLS_IN_CONTAINER}/server.crt",
        key_file=f"{TLS_IN_CONTAINER}/server.key",
    ), encoding="utf-8", newline="\n")
    (data / "compose.env").write_text(compose_env(ips, args.server), encoding="utf-8", newline="\n")

    print("IP:", ", ".join(ips))
    print(f"Tayyor: {tls / 'server.crt'}, {ngx / 'nigoh.conf'}, {data / 'compose.env'}")
    print(f"Mijozlarga o'rnatish uchun CA: {tls / 'ca.crt'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
