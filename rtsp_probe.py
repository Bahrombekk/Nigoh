"""Nigoh — kamerani tekshirish: tarmoq, RTSP javobi va login/parol.

Tashqi kutubxonasiz, RTSP so'rovini to'g'ridan-to'g'ri TCP orqali yuboradi.
Kameralarning aksariyati Digest autentifikatsiyadan foydalanadi, shuning
uchun Basic ham, Digest ham qo'llab-quvvatlanadi.
"""
import base64
import hashlib
import re
import socket
import urllib.parse

TIMEOUT = 6.0
USER_AGENT = "Nigoh/1.0"


def build_rtsp_url(ip: str, port: int, path: str,
                   username: str = "", password: str = "") -> str:
    """Kamera uchun to'liq RTSP manzil (login/parol bilan)."""
    path = "/" + (path or "").lstrip("/")
    host = f"[{ip}]" if ":" in ip and not ip.startswith("[") else ip
    if username:
        cred = urllib.parse.quote(username, safe="")
        if password:
            cred += ":" + urllib.parse.quote(password, safe="")
        return f"rtsp://{cred}@{host}:{port}{path}"
    return f"rtsp://{host}:{port}{path}"


def _digest_header(username: str, password: str, method: str, uri: str,
                   challenge: str) -> str:
    fields = dict(re.findall(r'(\w+)="([^"]*)"', challenge))
    realm = fields.get("realm", "")
    nonce = fields.get("nonce", "")
    md5 = lambda s: hashlib.md5(s.encode()).hexdigest()  # noqa: E731
    ha1 = md5(f"{username}:{realm}:{password}")
    ha2 = md5(f"{method}:{uri}")
    response = md5(f"{ha1}:{nonce}:{ha2}")
    header = (
        f'Digest username="{username}", realm="{realm}", nonce="{nonce}", '
        f'uri="{uri}", response="{response}"'
    )
    if "opaque" in fields:
        header += f', opaque="{fields["opaque"]}"'
    return header


def _request(sock, method: str, uri: str, cseq: int, auth: str = "") -> str:
    lines = [
        f"{method} {uri} RTSP/1.0",
        f"CSeq: {cseq}",
        f"User-Agent: {USER_AGENT}",
    ]
    if method == "DESCRIBE":
        lines.append("Accept: application/sdp")
    if auth:
        lines.append(f"Authorization: {auth}")
    sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())

    chunks = b""
    while b"\r\n\r\n" not in chunks:
        data = sock.recv(4096)
        if not data:
            break
        chunks += data
        if len(chunks) > 65536:
            break
    return chunks.decode("utf-8", "replace")


def _status(response: str) -> int:
    match = re.match(r"RTSP/\d\.\d (\d+)", response)
    return int(match.group(1)) if match else 0


def sdp_codec(describe: str) -> str:
    """DESCRIBE javobidagi SDP dan video kodekni ajratadi (H264 / H265 …)."""
    for codec in re.findall(r"a=rtpmap:\d+ ([A-Za-z0-9\-]+)/", describe):
        upper = codec.upper()
        if upper in ("H264", "H265", "HEVC", "MP4V-ES", "JPEG", "AV1", "VP8", "VP9"):
            return "H265" if upper == "HEVC" else upper
    return ""


def probe(ip: str, port: int, path: str, username: str = "",
          password: str = "") -> dict:
    """Kamerani bosqichma-bosqich tekshiradi.

    Qaytaradi: {ok, stage, message, codec, needs_transcode}
      stage — qaysi bosqichda to'xtagani: tarmoq / rtsp / parol / tayyor
      codec — kameradan kelayotgan video kodek
      needs_transcode — brauzer o'qishi uchun H.264 ga o'girish kerakmi
    """
    def fail(stage: str, message: str) -> dict:
        return {"ok": False, "stage": stage, "message": message,
                "codec": "", "needs_transcode": False}

    if not ip:
        return fail("tarmoq", "IP manzil ko'rsatilmagan")

    # 1-bosqich: TCP ulanish
    try:
        sock = socket.create_connection((ip, port), timeout=TIMEOUT)
    except socket.gaierror:
        return fail("tarmoq", f"{ip} manzili topilmadi (DNS xatosi)")
    except socket.timeout:
        return fail("tarmoq", f"{ip}:{port} javob bermadi — kamera o'chiq yoki "
                              f"boshqa tarmoqda")
    except OSError as exc:
        return fail("tarmoq",
                    f"{ip}:{port} ga ulanib bo'lmadi ({exc.strerror or exc})")

    uri = build_rtsp_url(ip, port, path)
    try:
        sock.settimeout(TIMEOUT)

        # 2-bosqich: RTSP protokoli javob beryaptimi
        try:
            options = _request(sock, "OPTIONS", uri, 1)
        except (socket.timeout, OSError):
            return fail("rtsp", f"{ip}:{port} ochiq, lekin RTSP javobi kelmadi — "
                                f"port raqamini tekshiring")
        if not options.startswith("RTSP/"):
            return fail("rtsp", f"{ip}:{port} RTSP xizmati emas")

        # 3-bosqich: DESCRIBE — bu yerda login/parol tekshiriladi
        describe = _request(sock, "DESCRIBE", uri, 2)
        code = _status(describe)

        if code == 401:
            if not username:
                return fail("parol", "Kamera login/parol so'rayapti — ularni kiriting")
            challenge = ""
            for line in describe.split("\r\n"):
                if line.lower().startswith("www-authenticate:"):
                    challenge = line.split(":", 1)[1].strip()
                    break

            if challenge.lower().startswith("digest"):
                auth = _digest_header(username, password, "DESCRIBE", uri, challenge)
            else:
                token = base64.b64encode(f"{username}:{password}".encode()).decode()
                auth = f"Basic {token}"

            describe = _request(sock, "DESCRIBE", uri, 3, auth)
            code = _status(describe)

            if code == 401:
                return fail("parol", "Login yoki parol noto'g'ri")

        if code == 404:
            return fail("rtsp", f"RTSP yo'li topilmadi: {path} — ishlab chiqaruvchi "
                                f"shablonini tekshiring")
        if code and code >= 400:
            return fail("rtsp", f"Kamera {code} kodi bilan rad etdi")
        if code == 0:
            return fail("rtsp", "Kameradan tushunarsiz javob")

        codec = sdp_codec(describe)
        needs_transcode = codec in ("H265", "MP4V-ES", "JPEG")

        if not ("m=video" in describe):
            message = "Ulanish muvaffaqiyatli, lekin video oqim e'lon qilinmadi"
        elif needs_transcode:
            message = (f"Ulanish muvaffaqiyatli · kodek {codec} — brauzer buni "
                       f"o'qiy olmaydi, H.264 ga o'girib beriladi")
        elif codec:
            message = f"Ulanish muvaffaqiyatli · kodek {codec}"
        else:
            message = "Ulanish muvaffaqiyatli"

        return {"ok": True, "stage": "tayyor", "message": message,
                "codec": codec, "needs_transcode": needs_transcode}
    finally:
        try:
            sock.close()
        except OSError:
            pass
