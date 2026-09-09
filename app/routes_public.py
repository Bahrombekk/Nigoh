"""Nigoh — ochiq (kirishsiz) endpointlar: xarita ro'yxati, oqim, surat.

Ma'lumot manbai — kamera mikroservisi. Bu qatlamning vazifasi: kim nimani
ko'rishini hal qilish (PUBLIC_VIEW, operator hududlari) va javobni
frontend kutgan ko'rinishda uzatish.
"""
from fastapi import APIRouter, HTTPException, Request, Response

from . import nigoh
from .helpers import allowed_regions

# Prefiks nisbiy — create_app uni /api/v1 (asosiy) va /api (eski) ostida ulaydi.
router = APIRouter(prefix="/cameras", tags=["cameras"])


@router.get("")
def list_cameras(request: Request, bbox: str = "", limit: int = 20000):
    """Xarita uchun kameralar — yengil ro'yxat.

    Oqim manzillari bu yerda yuborilmaydi: 1000 ta kamerada ular javobning
    yarmini egallaydi, holbuki bir vaqtda faqat bittasi ochiladi.
    Manzil `/api/v1/cameras/{id}/stream` dan olinadi.

    `bbox` berilsa (minLat,minLng,maxLat,maxLng) faqat shu to'rtburchak
    ichidagilar qaytariladi.

    Ko'rinish: admin (va PUBLIC_VIEW yoqiq bo'lsa anonim) hammasini ko'radi;
    operator faqat o'ziga biriktirilgan hududlarni.
    """
    regions = allowed_regions(request)
    if regions is not None and not regions:
        return {"total": 0, "shown": 0, "cameras": []}

    cameras = nigoh.cameras_cached()
    if regions is not None:
        cameras = [c for c in cameras if c.get("region") in regions]
    total = len(cameras)

    if bbox:
        try:
            min_lat, min_lng, max_lat, max_lng = (float(v) for v in bbox.split(","))
        except ValueError:
            raise HTTPException(400, "bbox formati: minLat,minLng,maxLat,maxLng")
        cameras = [c for c in cameras
                   if min_lat <= (c.get("lat") or 0) <= max_lat
                   and min_lng <= (c.get("lng") or 0) <= max_lng]

    cameras = cameras[: max(1, min(limit, 50000))]
    return {"total": total, "shown": len(cameras), "cameras": cameras}


@router.get("/{camera_id}/stream")
def camera_stream(camera_id: int, request: Request, hevc: int = 0,
                  quality: str = ""):
    """Bitta kameraning oqim manzili — ko'rish boshlanganda so'raladi.

    `hevc=1` — brauzer H.265 ni o'zi o'qiy oladi, o'girish kerak emas.
    `quality=sub` — past sifatli 2-oqim (video devor setkasi uchun);
    kamerada sub yo'l bo'lmasa asosiy oqim qaytadi.

    Chipta mikroservisdan keladi — ko'rinish nazorati shu nuqtada.
    """
    nigoh.check_region(camera_id, allowed_regions(request))
    return nigoh.get_json(f"/api/v1/cameras/{camera_id}/stream",
                          params={"hevc": hevc, "quality": quality})


@router.get("/{camera_id}/snapshot")
def camera_snapshot(camera_id: int, request: Request, stale: int = 0):
    """Kameraning JPEG surati — video ulangunicha darhol ko'rsatish uchun.

    Player suratni poster sifatida qo'yadi: his qilinadigan ochilish
    ~100 ms bo'ladi, video esa orqa fonda ulanadi. Surat mikroservis
    diskida turadi; ETag/304 va yosh sarlavhalari o'zgarishsiz uzatiladi.
    """
    nigoh.check_region(camera_id, allowed_regions(request))
    fwd_headers = {}
    if request.headers.get("if-none-match"):
        fwd_headers["If-None-Match"] = request.headers["if-none-match"]
    r = nigoh.request("GET", f"/api/v1/cameras/{camera_id}/snapshot",
                      params={"stale": stale} if stale else None,
                      headers=fwd_headers)
    if r.status_code == 404:
        raise HTTPException(404, "Kameradan surat olib bo'lmadi")
    if r.status_code >= 400:
        raise HTTPException(r.status_code, "Kamera servisi xatosi")
    headers = {k: v for k, v in r.headers.items()
               if k.lower() in ("etag", "cache-control",
                                "x-snapshot-at", "x-snapshot-age")}
    if r.status_code == 304:
        return Response(status_code=304, headers=headers)
    return Response(content=r.content, media_type="image/jpeg",
                    headers=headers)
