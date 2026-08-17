"""Nigoh — routelar o'rtasida umumiy yordamchilar.

Bu yerda ikkita "tarjima" qatlami yashaydi:

  * baza qatori → brauzerga xavfsiz ko'rinish (public/admin);
  * baza qatori → MediaMTX tushunadigan ko'rinish.
"""
import re

from fastapi import HTTPException, Request

from core import security
from core.db import get_db
from core.rtsp_probe import probe
from media import sync as mediamtx_sync

from .config import HLS_PORT, MEDIA_HOST, WEBRTC_PORT
from .models import CameraIn


def media_host(request: Request) -> str:
    """MediaMTX qaysi manzilda ekani — brauzer shu manzilga ulanadi."""
    if MEDIA_HOST:
        return MEDIA_HOST
    host = request.url.hostname or "localhost"
    return "localhost" if host == "0.0.0.0" else host


def stream_urls(row, request: Request, hevc_ok: bool = False) -> dict:
    """Kameraning oqim manzillari — faqat kerak bo'lganda so'raladi.

    `hevc_ok` — brauzer H.265 ni o'zi o'qiy oladi. Shunday bo'lsa, H.265
    kamera o'girilmaydi: `<kamera>_raw` yo'li xom oqimni beradi va GPU
    umuman ishlatilmaydi. Bunda WebRTC ishlamaydi (u H.265 ni bilmaydi),
    shuning uchun faqat HLS manzili qaytariladi.
    """
    host = media_host(request)
    if not row["ip"]:
        return {"stream_url": row["stream_url"] or "", "webrtc_url": "",
                "mode": "manual"}

    # Xom yo'l — MediaMTX kameradan to'g'ridan-to'g'ri oladi, FFmpeg yo'q.
    #
    # O'girish ikki holatda kerak:
    #   1) brauzer H.265 ni uddalay olmasa;
    #   2) "tez ochilsin" belgilangan bo'lsa — kameralarning keyframe oralig'i
    #      2-4 soniya, o'girilgan oqimda esa 1,2 soniya, ya'ni ikki barobar
    #      tez ochiladi. Buning narxi: doimiy FFmpeg va GPU.
    slug = row["slug"]
    if row["transcode"] and (not hevc_ok or row["always_on"]):
        slug += mediamtx_sync.TRANSCODE_SUFFIX
        mode = "transcode"
    else:
        mode = "raw" if row["transcode"] else "direct"

    # Chipta shu yo'lga bog'langan va muddatli — MediaMTX'ni backend
    # tekshiradi (routes_auth.stream_auth), chiptasiz oqim ochilmaydi.
    token = security.stream_token(slug)
    return {
        "stream_url": f"http://{host}:{HLS_PORT}/{slug}/index.m3u8?token={token}",
        # WebRTC ancha tez ochiladi — brauzer avval shuni sinaydi.
        "webrtc_url": f"http://{host}:{WEBRTC_PORT}/{slug}/whep?token={token}",
        "mode": mode,
    }


def public_camera(row, request: Request) -> dict:
    """Brauzerga yuboriladigan xavfsiz ko'rinish — parol/IP yo'q."""
    data = {
        "id": row["id"],
        "name": row["name"],
        "region": row["region"],
        "lat": row["lat"],
        "lng": row["lng"],
    }
    data.update(stream_urls(row, request))
    return data


def admin_camera(row, request: Request) -> dict:
    """Admin ko'rinishi — parolning o'zi emas, bor-yo'qligi qaytariladi."""
    data = public_camera(row, request)
    data.update({
        "slug": row["slug"],
        "source_type": "rtsp" if row["ip"] else "manual",
        "ip": row["ip"] or "",
        "port": row["port"] or 554,
        "username": row["username"] or "",
        "has_password": bool(row["password_enc"]),
        "rtsp_path": row["rtsp_path"] or "",
        "vendor": row["vendor"] or "boshqa",
        "enabled": bool(row["enabled"]),
        "note": row["note"] or "",
        "raw_stream_url": row["stream_url"] or "",
        "codec": row["codec"] or "",
        "transcode": bool(row["transcode"]),
        "always_on": bool(row["always_on"]),
    })
    if row["ip"]:
        cred = row["username"] or ""
        if cred and row["password_enc"]:
            cred += ":•••"
        prefix = f"{cred}@" if cred else ""
        path = "/" + (row["rtsp_path"] or "").lstrip("/")
        data["rtsp_preview"] = f"rtsp://{prefix}{row['ip']}:{row['port'] or 554}{path}"
    return data


def mask_config(text: str) -> str:
    """Konfiguratsiyadagi ochiq parollarni yashiradi — brauzerga shu ketadi."""
    return re.sub(r"(rtsp://[^:/@\s]+):[^@\s]+@", r"\1:•••@", text)


def require_admin(request: Request):
    """Himoyalangan endpointlar uchun: sessiya yaroqli bo'lishi shart."""
    token = request.cookies.get(security.SESSION_COOKIE)
    with get_db() as db:
        admin = security.session_admin(db, token)
    if admin is None:
        raise HTTPException(401, "Avval super-admin sifatida kiring")
    return admin


def camera_for_mediamtx(row) -> dict | None:
    """Bitta kamerani MediaMTX tushunadigan ko'rinishga o'tkazadi."""
    if not row["ip"]:
        return None
    return {
        "slug": row["slug"], "ip": row["ip"], "port": row["port"] or 554,
        "rtsp_path": row["rtsp_path"] or "/", "username": row["username"] or "",
        "password": security.decrypt(row["password_enc"]),
        "enabled": bool(row["enabled"]),
        "transcode": bool(row["transcode"]),
        "always_on": bool(row["always_on"]),
    }


def cameras_for_mediamtx(db) -> list[dict]:
    rows = db.execute("SELECT * FROM cameras WHERE ip IS NOT NULL AND ip != ''").fetchall()
    return [c for c in (camera_for_mediamtx(r) for r in rows) if c]


def detect_codec(cam: CameraIn, password: str) -> tuple[str, bool]:
    """Saqlashdan oldin kamera kodegini aniqlaydi.

    Kamera javob bermasa bo'sh qaytaradi — bu saqlashga to'sqinlik qilmaydi.
    """
    if cam.source_type != "rtsp" or not cam.ip.strip():
        return "", False
    result = probe(cam.ip.strip(), cam.port, cam.rtsp_path.strip(),
                   cam.username.strip(), password)
    if not result.get("ok"):
        return "", False
    return result.get("codec", ""), bool(result.get("needs_transcode"))
