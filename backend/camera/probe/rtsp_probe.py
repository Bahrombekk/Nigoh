"""Kamerani tekshirish: tarmoq, RTSP javobi, login/parol va oqim (SETUP).

Tashqi kutubxonasiz, RTSP so'rovini to'g'ridan-to'g'ri TCP orqali yuboradi.
Kameralarning aksariyati Digest autentifikatsiyadan foydalanadi, shuning
uchun Basic ham, Digest ham (qop bilan RFC 2617 va eski RFC 2069)
qo'llab-quvvatlanadi.

Tekshiruv bosqichma-bosqich va har bosqich o'z xato matnini beradi —
foydalanuvchi "nima noto'g'ri" ekanini ko'rsin: tarmoq (port yopiq, DNS),
rtsp (RTSP xizmati emas, yo'l topilmadi), parol, oqim (SDP'da video yo'q
yoki SETUP rad etildi — DESCRIBE'ga javob berib oqim bermaydigan kanallar
shu yerda ushlanadi, aks holda skaner soxta kanallar topardi).

Cheklov: DESCRIBE/SETUP muvaffaqiyati kadr kelishini kafolatlamaydi
(registrator sub'ni e'lon qilib, paket bermasligi o'lchangan) — kadr
darajasidagi tekshiruv `camera.media.sync.kadr_keladimi` da.

Tarkibi:
    probe(ip, port, path, username, password)
                        {ok, stage, message, codec, needs_transcode,
                        resolution, fps, audio}; stage: tarmoq / rtsp /
                        parol / oqim / tayyor
    build_rtsp_url(ip, port, path, username, password)
                        to'liq RTSP manzil (login/parol URL-kodlangan, IPv6)
    sub_yol_nomzodlari(rtsp_path)
                        asosiy yo'ldan sub yo'l taxminlari (Dahua subtype,
                        Hikvision 101->102, stream1->2, main->sub); har
                        nomzod haqiqatda tekshiriladi
    sdp_codec / sdp_resolution / sdp_fps / sdp_has_audio / sdp_video_control
    sps_resolution(describe)    SPS (sprop-parameter-sets / sprop-sps) dan o'lcham
                        DESCRIBE javobidan ma'lumot ajratish
    TIMEOUT             6 s

Kim ishlatadi: camera.probe (detect), camera/api (admin, devices),
camera.media (sync, reconciler, launcher, transport), camera/monitoring/passport.py,
scripts, database/scripts/fix_camera_data.py, testlar
"""
import base64
import binascii
import hashlib
import re
import secrets
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
                   challenge: str, nc: int = 1,
                   cnonce: str | None = None) -> str:
    """Digest Authorization sarlavhasi.

    Kamera `qop` talab qilsa (Axis, ko'p ONVIF qurilma, ba'zi Dahua
    firmware) RFC 2617 formulasi ishlatiladi: MD5(HA1:nonce:nc:cnonce:
    qop:HA2). `qop`siz eski RFC 2069 formulasi qoladi. Bitta nonce bilan
    ikkinchi so'rov (SETUP) yuborilganda `nc` oshirilishi shart.
    """
    fields = dict(re.findall(r'(\w+)="([^"]*)"', challenge))
    realm = fields.get("realm", "")
    nonce = fields.get("nonce", "")
    # qop qo'shtirnoqli ham, qo'shtirnoqsiz ham keladi: qop="auth" / qop=auth
    qop_raw = fields.get("qop", "")
    if not qop_raw:
        match = re.search(r'qop=([^,\s"]+)', challenge)
        qop_raw = match.group(1) if match else ""
    qop = "auth" if "auth" in [q.strip() for q in qop_raw.split(",")] else ""

    md5 = lambda s: hashlib.md5(s.encode()).hexdigest()  # noqa: E731
    ha1 = md5(f"{username}:{realm}:{password}")
    ha2 = md5(f"{method}:{uri}")
    if qop:
        nc_value = f"{nc:08x}"
        cnonce = cnonce or secrets.token_hex(8)
        response = md5(f"{ha1}:{nonce}:{nc_value}:{cnonce}:{qop}:{ha2}")
    else:
        response = md5(f"{ha1}:{nonce}:{ha2}")
    header = (
        f'Digest username="{username}", realm="{realm}", nonce="{nonce}", '
        f'uri="{uri}", response="{response}"'
    )
    if qop:
        header += f', qop={qop}, nc={nc_value}, cnonce="{cnonce}"'
    if "opaque" in fields:
        header += f', opaque="{fields["opaque"]}"'
    return header


def _request(sock, method: str, uri: str, cseq: int, auth: str = "",
             extra: list[str] | None = None) -> str:
    lines = [
        f"{method} {uri} RTSP/1.0",
        f"CSeq: {cseq}",
        f"User-Agent: {USER_AGENT}",
    ]
    if method == "DESCRIBE":
        lines.append("Accept: application/sdp")
    if extra:
        lines.extend(extra)
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


def sdp_resolution(describe: str) -> str:
    """SDP'dan kadr o'lchamini ajratadi ("1920x1080" yoki bo'sh).

    Kameralar buni har xil beradi: Hikvision `a=x-dimensions:1920,1080`,
    boshqalar `a=framesize:96 1920-1080`. Dahua kabilar alohida qator
    bermaydi — o'lcham SPS ichida (`sprop-parameter-sets` / `sprop-sps`),
    u yerdan hisoblanadi. SPS ham bo'lmasa (masalan Holowits H.265) —
    bo'sh; unda o'lcham kamera ochilganda MediaMTX'dan olinadi
    (camera/media/reconciler.py).
    """
    match = re.search(r"a=x-dimensions:\s*(\d+)\s*,\s*(\d+)", describe)
    if not match:
        match = re.search(r"a=framesize:\d+\s+(\d+)-(\d+)", describe)
    if match:
        return f"{match.group(1)}x{match.group(2)}"
    return sps_resolution(describe)


class _Bits:
    """SPS o'quvchi: emulyatsiya baytlari (00 00 03) olib tashlangan bitlar."""

    def __init__(self, nal: bytes) -> None:
        clean, zeros = bytearray(), 0
        for byte in nal:
            if zeros >= 2 and byte == 3:
                zeros = 0
                continue
            clean.append(byte)
            zeros = zeros + 1 if byte == 0 else 0
        self.data, self.pos = bytes(clean), 0

    def u(self, n: int) -> int:
        value = 0
        for _ in range(n):
            if self.pos >= len(self.data) * 8:
                raise ValueError("SPS tugadi")
            value = (value << 1) | ((self.data[self.pos // 8] >> (7 - self.pos % 8)) & 1)
            self.pos += 1
        return value

    def ue(self) -> int:
        zeros = 0
        while self.u(1) == 0:
            zeros += 1
            if zeros > 31:
                raise ValueError("buzuq Exp-Golomb")
        return (1 << zeros) - 1 + self.u(zeros)

    def se(self) -> int:
        k = self.ue()
        return (k + 1) // 2 if k % 2 else -(k // 2)


def _h264_size(sps: bytes) -> tuple[int, int]:
    b = _Bits(sps[1:])                      # NAL sarlavhasi (1 bayt) tashlanadi
    profile = b.u(8)
    b.u(16)                                 # cheklov bayroqlari + level
    b.ue()                                  # sps id
    chroma = 1
    if profile in (100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135):
        chroma = b.ue()
        if chroma == 3:
            b.u(1)
        b.ue(), b.ue()                      # bit chuqurligi
        b.u(1)
        if b.u(1):                          # scaling matrix
            for i in range(8 if chroma != 3 else 12):
                if b.u(1):
                    last = nxt = 8
                    for _ in range(16 if i < 6 else 64):
                        if nxt:
                            nxt = (last + b.se()) % 256
                        last = nxt or last
    b.ue()                                  # log2_max_frame_num
    poc = b.ue()
    if poc == 0:
        b.ue()
    elif poc == 1:
        b.u(1), b.se(), b.se()
        for _ in range(b.ue()):
            b.se()
    b.ue(), b.u(1)                          # ref frames, gaps
    w_mbs, h_map = b.ue() + 1, b.ue() + 1
    frame_mbs_only = b.u(1)
    if not frame_mbs_only:
        b.u(1)
    b.u(1)
    width, height = w_mbs * 16, (2 - frame_mbs_only) * h_map * 16
    if b.u(1):                              # kesish (cropping)
        left, right, top, bottom = b.ue(), b.ue(), b.ue(), b.ue()
        cx = 1 if chroma == 0 else 2 if chroma in (1, 2) else 1
        cy = (1 if chroma in (0, 2, 3) else 2) * (2 - frame_mbs_only)
        width -= (left + right) * cx
        height -= (top + bottom) * cy
    return width, height


def _h265_size(sps: bytes) -> tuple[int, int]:
    b = _Bits(sps[2:])                      # H.265 NAL sarlavhasi — 2 bayt
    b.u(4)
    max_sub = b.u(3)
    b.u(1)
    b.u(96 - 8)                             # general profile_tier_level (88 bit)
    b.u(8)                                  # general_level_idc
    flags = [(b.u(1), b.u(1)) for _ in range(max_sub)]
    if max_sub:
        b.u(2 * (8 - max_sub))
    for profile_present, level_present in flags:
        if profile_present:
            b.u(88)
        if level_present:
            b.u(8)
    b.ue()                                  # sps id
    chroma = b.ue()
    if chroma == 3:
        b.u(1)
    width, height = b.ue(), b.ue()
    if b.u(1):                              # conformance window
        left, right, top, bottom = b.ue(), b.ue(), b.ue(), b.ue()
        cx = 2 if chroma in (1, 2) else 1
        cy = 2 if chroma == 1 else 1
        width -= (left + right) * cx
        height -= (top + bottom) * cy
    return width, height


def sps_resolution(describe: str) -> str:
    """SDP `a=fmtp` dagi SPS dan kadr o'lchami ("1920x1080" yoki bo'sh).

    H.264: `sprop-parameter-sets=<SPS>,<PPS>`; H.265: `sprop-sps=<SPS>`.
    Buzuq yoki tanilmagan SPS — bo'sh (xato chiqarmaydi).
    """
    found = re.search(r"sprop-sps=([A-Za-z0-9+/=]+)", describe)
    parse = _h265_size
    if not found:
        found = re.search(r"sprop-parameter-sets=([A-Za-z0-9+/=]+)", describe)
        parse = _h264_size
    if not found:
        return ""
    try:
        raw = base64.b64decode(found.group(1) + "=" * (-len(found.group(1)) % 4))
        width, height = parse(raw)
    except (ValueError, IndexError, binascii.Error):
        return ""
    if not (16 <= width <= 16384 and 16 <= height <= 16384):
        return ""
    return f"{width}x{height}"


def sdp_fps(describe: str) -> float:
    """SDP'dan kadr tezligini ajratadi (bermagan kamerada 0)."""
    match = re.search(r"a=(?:x-)?framerate:\s*([\d.]+)", describe)
    try:
        return float(match.group(1)) if match else 0.0
    except ValueError:
        return 0.0


def sdp_has_audio(describe: str) -> bool:
    return "m=audio" in describe


def sdp_video_control(describe: str, request_uri: str) -> str:
    """SDP ichidan video trekning SETUP manzilini topadi.

    Kameralar buni uch xil beradi: to'liq URL, nisbiy yo'l ('trackID=1')
    yoki umuman bermaydi. Nisbiy bo'lsa Content-Base'ga qo'shiladi.
    """
    base = request_uri
    match = re.search(r"^Content-Base:\s*(\S+)", describe,
                      re.IGNORECASE | re.MULTILINE)
    if match:
        base = match.group(1)

    control, in_video = "", False
    for line in describe.splitlines():
        if line.startswith("m="):
            in_video = line.startswith("m=video")
        elif in_video and line.startswith("a=control:"):
            control = line.split(":", 1)[1].strip()
            break

    if not control or control == "*":
        return base
    if control.lower().startswith("rtsp://"):
        return control
    return base.rstrip("/") + "/" + control.lstrip("/")


def sub_yol_nomzodlari(rtsp_path: str) -> list[str]:
    """Asosiy yo'ldan ikkinchi (sub) oqim yo'lini taxmin qiladi.

    Nima uchun kerak: bazada sub yo'li bo'sh bo'lgan kamera devorda
    og'ir asosiy oqimda ochiladi. Amalda esa kameraning ikkinchi oqimi
    ko'pincha BOR — shunchaki qo'shishda yozilmagan. Shu o'rnatmada
    o'lchandi: sub yo'li bo'sh 23 kameradan sinalgan 8 tasining
    4 tasida sub oqim ishlab turgan edi.

    Taxmin ishlab chiqaruvchining nomlash qoidasiga tayanadi. Taxmin
    QAT'IY EMAS — chaqiruvchi har nomzodni haqiqatda tekshiradi
    (`media.sync.kadr_keladimi`) va faqat kadr bergani saqlanadi.
    """
    yol = (rtsp_path or "").strip()
    if not yol:
        return []
    nomzod: list[str] = []
    # Dahua va unga o'xshaganlar: subtype=0 -> subtype=1
    if "subtype=0" in yol:
        nomzod.append(yol.replace("subtype=0", "subtype=1"))
    # Hikvision: /Streaming/Channels/101 -> 102 (oxirgi raqam — oqim
    # nomeri: 1 asosiy, 2 sub).
    m = re.search(r"(?i)(/streaming/channels/)(\d+)", yol)
    if m and m.group(2).endswith("1"):
        nomzod.append(yol[:m.start(2)] + m.group(2)[:-1] + "2" + yol[m.end(2):])
    # "…/stream1", "…/ch01/main" kabi keng tarqalgan ikkita shakl.
    m = re.search(r"(?i)(stream)0*1\b", yol)
    if m:
        nomzod.append(yol[:m.start()] + m.group(1) + "2" + yol[m.end():])
    if re.search(r"(?i)/main\b", yol):
        nomzod.append(re.sub(r"(?i)/main\b", "/sub", yol))
    # Takrorlarni va asosiy yo'lning o'zini chiqarib tashlaymiz.
    return [n for n in dict.fromkeys(nomzod) if n and n != yol]


def probe(ip: str, port: int, path: str, username: str = "",
          password: str = "") -> dict:
    """Kamerani bosqichma-bosqich tekshiradi.

    Qaytaradi: {ok, stage, message, codec, needs_transcode,
                resolution, fps, audio}
      stage — qaysi bosqichda to'xtagani: tarmoq / rtsp / parol / tayyor
      codec — kameradan kelayotgan video kodek
      needs_transcode — brauzer o'qishi uchun H.264 ga o'girish kerakmi
      resolution/fps/audio — SDP'dan; kamera bermasa bo'sh/0/False
    """
    def fail(stage: str, message: str) -> dict:
        return {"ok": False, "stage": stage, "message": message,
                "codec": "", "needs_transcode": False,
                "resolution": "", "fps": 0.0, "audio": False}

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

        challenge = ""
        if code == 401:
            if not username:
                return fail("parol", "Kamera login/parol so'rayapti — ularni kiriting")
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
        resolution = sdp_resolution(describe)
        fps = sdp_fps(describe)
        audio = sdp_has_audio(describe)

        # Ba'zi qurilmalar istalgan (hatto mavjud bo'lmagan) yo'lga ham 200
        # qaytaradi, lekin videosiz bo'sh SDP beradi — bu ishlaydigan oqim
        # emas, xato deb qaytaramiz, aks holda skaner soxta kanallar topadi.
        if "m=video" not in describe:
            return fail("oqim", "Kamera javob berdi, lekin bu yo'lda video "
                                "oqim yo'q — RTSP yo'lini tekshiring")

        # 4-bosqich: SETUP — kamera oqimni haqiqatan beradimi. DESCRIBE'ga
        # javob berib, SETUP'da rad etadigan kameralar uchraydi (masalan,
        # o'chirilgan qo'shimcha oqim yoki band kanal) — bularni shu yerda
        # ushlaymiz, aks holda "ok" deb saqlanadi-yu, video ochilmaydi.
        if "m=video" in describe:
            setup_uri = sdp_video_control(describe, uri)
            transport = ["Transport: RTP/AVP/TCP;unicast;interleaved=0-1"]
            setup_auth = ""
            if challenge and challenge.lower().startswith("digest"):
                # Bitta nonce ichida ikkinchi so'rov — nc oshiriladi.
                setup_auth = _digest_header(username, password, "SETUP",
                                            setup_uri, challenge, nc=2)
            elif challenge:
                token = base64.b64encode(f"{username}:{password}".encode()).decode()
                setup_auth = f"Basic {token}"
            try:
                setup = _request(sock, "SETUP", setup_uri, 4, setup_auth, transport)
            except (socket.timeout, OSError):
                return fail("oqim", "Kamera SETUP so'roviga javob bermadi")
            setup_code = _status(setup)
            if setup_code == 461:
                # TCP transportni bilmaydi — UDP bilan qayta urinamiz.
                udp = ["Transport: RTP/AVP;unicast;client_port=45678-45679"]
                try:
                    setup = _request(sock, "SETUP", setup_uri, 5, setup_auth, udp)
                    setup_code = _status(setup)
                except (socket.timeout, OSError):
                    setup_code = 0
            if setup_code and setup_code >= 400:
                return fail("oqim",
                            f"Kamera javob beradi, lekin oqimni bermayapti "
                            f"(SETUP {setup_code}) — bu oqim/kanal o'chiq yoki "
                            f"band bo'lishi mumkin, boshqa yo'lni sinang")

        if needs_transcode:
            message = (f"Ulanish muvaffaqiyatli · kodek {codec} — brauzer buni "
                       f"o'qiy olmaydi, H.264 ga o'girib beriladi")
        elif codec:
            message = f"Ulanish muvaffaqiyatli · kodek {codec}"
        else:
            message = "Ulanish muvaffaqiyatli"
        if resolution:
            message += f" · {resolution}"
        if fps:
            message += f" · {fps:g} fps"
        if audio:
            message += " · audio bor"

        return {"ok": True, "stage": "tayyor", "message": message,
                "codec": codec, "needs_transcode": needs_transcode,
                "resolution": resolution, "fps": fps, "audio": audio}
    except (socket.timeout, OSError) as exc:
        # Ba'zi NVR'lar mavjud bo'lmagan kanal/oqim so'ralganda ulanishni
        # majburan uzadi (ConnectionReset) — bu tizim xatosi emas,
        # "bunday oqim yo'q" degani.
        return fail("rtsp", f"Kamera ulanishni uzib qo'ydi "
                            f"({exc.__class__.__name__}) — bu yo'l/kanal "
                            f"mavjud emas bo'lishi mumkin")
    finally:
        try:
            sock.close()
        except OSError:
            pass
