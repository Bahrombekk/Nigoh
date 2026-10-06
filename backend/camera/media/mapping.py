"""Baza qatori -> MediaMTX tushunadigan kamera lug'ati.

media qatlami bazaning sxemasini bilmasligi uchun tarjima shu yerda: sync,
reconciler va launcher faqat shu lug'at bilan ishlaydi. Parol shu yerda
ochiladi (security.decrypt) va faqat Control API'ga ketadi — faylga
yozilmaydi.

Tarkibi:
    camera_for_mediamtx(row)    bitta kamera -> {slug, ip, port, rtsp_path,
                                username, password, enabled, transcode,
                                always_on, sub_path, node_id, rtsp_udp};
                                IP'siz (tayyor oqim) kamerada None
    cameras_for_mediamtx(db)    barcha RTSP kameralar ro'yxati shu ko'rinishda

Ishlatadi: core.security, database.cameras
Kim ishlatadi: camera.api (cameras, streams, mediamtx), app/bootstrap.py
(reconciler uchun `load_cameras`, mediamtx.yml yozish)
"""
from core import security
from database import cameras


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
        "sub_path": row["sub_path"] or "",
        "node_id": row["node_id"] or 1,
        # TCP'da bermaydigan kamera (camera_status.rtsp_udp) — yo'l
        # konfiguratsiyasiga UDP bo'lib tushadi.
        "rtsp_udp": bool(row["rtsp_udp"]),
    }


def cameras_for_mediamtx(db) -> list[dict]:
    return [c for c in (camera_for_mediamtx(r) for r in cameras.list_rtsp(db)) if c]
