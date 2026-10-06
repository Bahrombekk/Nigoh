"""Kamera qatorining JSON ko'rinishlari: public va admin.

Baza qatorini brauzerga xavfsiz shaklga keltiradi: public ko'rinishda
parol ham, IP ham yo'q; admin ko'rinishda parolning o'zi emas, faqat
bor-yo'qligi va yashirilgan RTSP namunasi beriladi.

Tarkibi:
    public_camera(row, request)  id, nom, hudud, koordinata + oqim manzillari
    admin_camera(row, request)   public + boshqaruv maydonlari: holat, manzil,
                                 sub yo'l, transport (rtsp_udp), kodek, fps,
                                 joylashuv (hudud, km/piket), pasport,
                                 `rtsp_preview` (parol o'rnida •••)
    mask_config(text)            konfiguratsiya matnidagi ochiq parollarni
                                 yashiradi — brauzerga shu ketadi

Ishlatadi: camera.state.camera_state, camera.streaming.stream_urls
Kim ishlatadi: camera/api/admin.py (admin_camera), camera/api/mediamtx.py
(mask_config)
"""
import re

from fastapi import Request

from camera.state import camera_state
from camera.streaming import stream_urls


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
        "external_id": row["external_id"] or "",
        "state": camera_state(row),
        "resolution": row["resolution"] or "",
        "source_type": row["source_type"],
        "ip": row["ip"] or "",
        "port": row["port"] or 554,
        "username": row["username"] or "",
        "has_password": bool(row["password_enc"]),
        "rtsp_path": row["rtsp_path"] or "",
        "sub_path": row["sub_path"] or "",
        "sub_codec": row["sub_codec"] or "",
        "sub_bad": bool(row["sub_bad"]),
        # Kamera TCP'da bermagani uchun UDP'ga o'tkazilganmi (avtomatik
        # aniqlanadi — media/transport.py). Admin ko'rinishida turadi:
        # "nega aynan shu kamerada tasvir biroz sinadi" savoliga javob.
        "rtsp_udp": bool(row["rtsp_udp"]),
        "node_id": row["node_id"] or 1,
        "vendor": row["vendor"] or "boshqa",
        "enabled": bool(row["enabled"]),
        "note": row["note"] or "",
        "raw_stream_url": row["stream_url"] or "",
        "model": row["model"] or "",
        "firmware": row["firmware"] or "",
        "last_seen": row["last_seen"] or "",
        # Joylashuv: viloyat (region) va temir yo'l bo'yicha km/piket.
        "admin_area_id": row["admin_area_id"],
        "rail_line_id": row["rail_line_id"],
        "km": row["km"],
        "picket": row["picket"],
        "device_id": row["device_id"],
        "device_kind": row["device_kind"] or "",
        "codec": row["codec"] or "",
        # SDP'dagi kadr tezligi (0 — kamera bermagan). "25 fps deb
        # sozlangan kamera 8 fps beryapti" degan xulosa shu maydonsiz
        # chiqmaydi.
        "fps": float(row["fps"] or 0.0),
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
