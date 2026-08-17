"""Nigoh — ochiq (kirishsiz) endpointlar: xarita ro'yxati, oqim, surat."""
from fastapi import APIRouter, HTTPException, Request, Response

from core import fast_start, health, security
from core.db import get_db
from media import sync as mediamtx_sync

from .helpers import camera_for_mediamtx, stream_urls

router = APIRouter(prefix="/api/cameras", tags=["cameras"])


@router.get("")
def list_cameras(bbox: str = "", limit: int = 20000):
    """Xarita uchun kameralar — yengil ro'yxat.

    Oqim manzillari bu yerda yuborilmaydi: 1000 ta kamerada ular javobning
    yarmini egallaydi, holbuki bir vaqtda faqat bittasi ochiladi.
    Manzil `/api/cameras/{id}/stream` dan olinadi.

    `bbox` berilsa (minLat,minLng,maxLat,maxLng) faqat shu to'rtburchak
    ichidagilar qaytariladi.
    """
    sql = ("SELECT id, name, region, lat, lng, ip, port, last_seen, codec, "
           "transcode, always_on FROM cameras WHERE enabled = 1")
    params: list = []
    if bbox:
        try:
            min_lat, min_lng, max_lat, max_lng = (float(v) for v in bbox.split(","))
        except ValueError:
            raise HTTPException(400, "bbox formati: minLat,minLng,maxLat,maxLng")
        sql += " AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?"
        params += [min_lat, max_lat, min_lng, max_lng]
    sql += " ORDER BY region, name LIMIT ?"
    params.append(max(1, min(limit, 50000)))

    with get_db() as db:
        rows = db.execute(sql, params).fetchall()
        total = db.execute("SELECT COUNT(*) FROM cameras WHERE enabled = 1").fetchone()[0]
    return {
        "total": total,
        "shown": len(rows),
        # IP tashqariga chiqmaydi — undan faqat tiriklik holati hisoblanadi.
        "cameras": [{
            "id": r["id"], "name": r["name"], "region": r["region"],
            "lat": r["lat"], "lng": r["lng"],
            "online": health.online(r["ip"], r["port"]),
            "last_seen": r["last_seen"] or "",
            "codec": r["codec"] or "",
            "transcode": bool(r["transcode"]),
            "always_on": bool(r["always_on"]),
        } for r in rows],
    }


@router.get("/{camera_id}/stream")
def camera_stream(camera_id: int, request: Request, hevc: int = 0):
    """Bitta kameraning oqim manzili — ko'rish boshlanganda so'raladi.

    `hevc=1` — brauzer H.265 ni o'zi o'qiy oladi, o'girish kerak emas.
    """
    with get_db() as db:
        row = db.execute(
            "SELECT * FROM cameras WHERE id = ? AND enabled = 1", (camera_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(404, "Kamera topilmadi")
        camera = camera_for_mediamtx(row)

    # Yo'l MediaMTX'da borligiga ishonch hosil qilamiz — u qayta ishga
    # tushgan bo'lsa ham ko'rish shu yerda tiklanadi.
    if camera:
        mediamtx_sync.ensure_path(camera)
        mediamtx_sync.ensure_transcode_path(camera)
        # Kameradan darhol keyframe so'raymiz (ONVIF) — tasvir navbatdagi
        # keyframe'gacha (2-4 s) kutib qolmasin. Fonda ketadi, javobni
        # kechiktirmaydi; qo'llamaydigan kamera jim rad etadi.
        fast_start.request_keyframe_async(
            camera["ip"], camera["username"], camera["password"],
            camera["rtsp_path"], row["vendor"] or "")
    return stream_urls(row, request, hevc_ok=bool(hevc))


@router.get("/{camera_id}/snapshot")
def camera_snapshot(camera_id: int):
    """Kameraning JPEG surati — video ulangunicha darhol ko'rsatish uchun.

    Player suratni poster sifatida qo'yadi: his qilinadigan ochilish
    ~100 ms bo'ladi, video esa orqa fonda ulanadi.
    """
    with get_db() as db:
        row = db.execute(
            "SELECT * FROM cameras WHERE id = ? AND enabled = 1", (camera_id,)
        ).fetchone()
    if row is None or not row["ip"]:
        raise HTTPException(404, "Kamera topilmadi")
    data = fast_start.snapshot(
        row["id"], row["ip"], row["username"] or "",
        security.decrypt(row["password_enc"]),
        row["vendor"] or "", row["rtsp_path"] or "", row["slug"] or "")
    if not data:
        raise HTTPException(404, "Kameradan surat olib bo'lmadi")
    return Response(content=data, media_type="image/jpeg",
                    headers={"Cache-Control": "max-age=5"})
