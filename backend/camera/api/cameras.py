"""Kameralar (ko'rish tomoni): xarita ro'yxati, holat, oqim manzili va surat.

Asosiy tizim va brauzer kameralarni shu yerdan oladi. Ro'yxat yengil —
oqim manzillari unda yo'q (1000 kamerada ular javobning yarmini
egallardi, bir vaqtda esa faqat bittasi ochiladi); manzil kamera
ochilganda alohida so'raladi va o'sha paytda MediaMTX yo'li tayyorlanadi.

`ref` — ichki id (`123`) yoki tashqi id (`ext:cam-toshkent-014`). Ko'rinish:
admin, API kalit va (PUBLIC_VIEW=1 bo'lsa) mehmon hammasini ko'radi;
operator faqat o'ziga biriktirilgan hududlarni.

Endpointlar (require_viewer; hudud cheklovi endpoint ichida):
    GET  /api/v1/cameras                xarita ro'yxati; ?bbox=minLat,minLng,
                                        maxLat,maxLng, ?limit; total/shown
    GET  /api/v1/cameras/status         boshlang'ich holat SSE'dan oldin:
                                        ?ids=1,2,ext:... (<=1024) yoki ?all=1
    GET  /api/v1/cameras/{ref}/stream   oqim manzili; yo'lni ensure_path qiladi,
                                        issiq belgilaydi, fonda keyframe so'raydi;
                                        ?hevc=1, ?quality=sub
    GET  /api/v1/cameras/{ref}/snapshot JPEG surat; offline/disabled'da 404
                                        (eski kadr jonli bo'lib ko'rinmasin),
                                        ?stale=1 — oxirgi kadr, ?cached=1 —
                                        faqat disk; X-Snapshot-At/-Age, ETag
    POST /api/v1/cameras/{ref}/snapshot brauzer jonli ko'rinishdan olgan kadr
                                        (<=3 MB JPEG) — server RTSP grab qilmaydi
    POST /api/v1/cameras/{ref}/sub-bad  sub oqim brauzerda ochilmadi — saqlanadi,
                                        devor keyingi safar asosiydan ochadi

Snapshot'da holat va yosh tekshiruvi ETag/304 dan OLDIN turadi — aks
holda keshi bor mijoz offline kamerada ham 304 olib eski kadrni
ko'rsatishda davom etardi.

Ishlatadi: camera.media (sync, fast_start, mapping), camera.monitoring
(health, snapshots), camera.state, camera.streaming, users.access
Kim ishlatadi: app/factory.py (router); frontend xarita, pleyer, devor
"""
import time
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, Response

from camera.media import fast_start
from camera.media import sync as mediamtx_sync
from camera.media.mapping import camera_for_mediamtx
from camera.monitoring import health, snapshots
from camera.state import camera_state, resolve_ref
from camera.streaming import node_info, stream_urls
from database import cameras, get_db
from users.access import allowed_areas, area_allowed, check_area

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

    `total` — filtrga mos kameralar soni (bbox ham hisobga olinadi),
    `shown` — shu javobda qaytganlari. Ikkovi teng bo'lmasa `limit`
    ishga tushgan degani.

    Ko'rinish: admin, API kalit va (PUBLIC_VIEW=1 bo'lsa) mehmon hammasini
    ko'radi; operator faqat o'ziga biriktirilgan hududlarni.
    """
    areas = allowed_areas(request)
    if areas is not None and not areas:
        return {"total": 0, "shown": 0, "cameras": []}
    box = None
    if bbox:
        try:
            box = tuple(float(v) for v in bbox.split(","))
            if len(box) != 4:
                raise ValueError
        except ValueError:
            raise HTTPException(400, "bbox formati: minLat,minLng,maxLat,maxLng")
    with get_db() as db:
        total, rows = cameras.list_visible(db, bbox=box, area_ids=areas,
                                           limit=max(1, min(limit, 50000)))
    return {
        "total": total,
        "shown": len(rows),
        # IP tashqariga chiqmaydi — undan faqat tiriklik holati hisoblanadi.
        "cameras": [{
            "id": r["id"], "external_id": r["external_id"] or "",
            "name": r["name"], "region": r["region"],
            "lat": r["lat"], "lng": r["lng"],
            "online": health.online(r["ip"], r["port"]),
            # Yagona holat: disabled / unknown / offline / stalled / online.
            # `online` maydoni eski mijozlar uchun qoldirilgan.
            "state": camera_state(r),
            "last_seen": r["last_seen"] or "",
            "codec": r["codec"] or "",
            "sub_codec": r["sub_codec"] or "",
            "resolution": r["resolution"] or "",
            # Qurilma pasporti (kamera paneli: "Model"). Maxfiy emas — IP/parol yo'q.
            "vendor": r["vendor"] or "",
            "model": r["model"] or "",
            "transcode": bool(r["transcode"]),
            "always_on": bool(r["always_on"]),
            # Temir yo'l bo'yicha joy — dashboard liniya sxemasi uchun.
            "km": r["km"], "picket": r["picket"],
        } for r in rows],
    }


@router.get("/status")
def cameras_status(request: Request, ids: str = "", all: int = 0):
    """Boshlang'ich holat — SSE (`/events`) ga ulanishdan oldin bir marta.

    `?ids=1,2,ext:cam-14` — tanlanganlar; `?all=1` — hammasi. Keyin faqat
    o'zgarishlarni SSE yetkazadi, poll qilish shart emas.

    """
    with get_db() as db:
        if all:
            rows = cameras.list_all(db)
        elif ids.strip():
            refs = [p.strip() for p in ids.split(",") if p.strip()]
            if len(refs) > 1024:
                raise HTTPException(400, "Bitta so'rovda 1024 tagacha id")
            rows = [r for r in (resolve_ref(db, ref) for ref in refs)
                    if r is not None]
        else:
            raise HTTPException(400, "ids=1,2,... yoki all=1 bering")
    areas = allowed_areas(request)
    rows = [r for r in rows if area_allowed(r, areas)]

    def out(r):
        return {
            "id": r["id"],
            "external_id": r["external_id"] or "",
            "state": camera_state(r),
            "codec": r["codec"] or "",
            "sub_codec": r["sub_codec"] or "",
            "resolution": r["resolution"] or "",
            "last_seen": r["last_seen"] or "",
            "snapshot_at": r["snapshot_at"] or "",
        }

    return {"total": len(rows), "cameras": [out(r) for r in rows]}


@router.get("/{ref}/stream")
def camera_stream(ref: str, request: Request, hevc: int = 0,
                  quality: str = ""):
    """Bitta kameraning oqim manzili — ko'rish boshlanganda so'raladi.

    `ref` — ichki id (`123`) yoki tashqi id (`ext:cam-toshkent-014`).
    `hevc=1` — brauzer H.265 ni o'zi o'qiy oladi, o'girish kerak emas.
    `quality=sub` — past sifatli 2-oqim (video devor setkasi uchun);
    kamerada sub yo'l bo'lmasa asosiy oqim qaytadi.
    """
    with get_db() as db:
        row = resolve_ref(db, ref)
        if row is None or not row["enabled"]:
            raise HTTPException(404, "Kamera topilmadi")
        check_area(row, allowed_areas(request))
        camera = camera_for_mediamtx(row)

    # Yo'l o'z tugunidagi MediaMTX'da borligiga ishonch hosil qilamiz —
    # u qayta ishga tushgan bo'lsa ham ko'rish shu yerda tiklanadi.
    if camera:
        node = node_info(camera["node_id"])
        api_base = node["api_base"] if node else None
        sub = mediamtx_sync.sub_variant(camera) if quality == "sub" else None
        if sub:
            # Issiq to'plam: keyingi 10 daqiqada qayta ochilish < 1 s.
            mediamtx_sync.mark_warm(sub["slug"])
            mediamtx_sync.ensure_path(sub, api_base)
        else:
            # Asosiy oqim ham ko'rilayotganda issiq bo'lsin: sourceOnDemand
            # rejimida MediaMTX manbani ochib-yopib turadi va tomosha
            # aynan shunda uziladi (o'lchov: media/sync.py izohida).
            mediamtx_sync.mark_warm(camera["slug"], mediamtx_sync.WARM_MAIN_TTL)
            mediamtx_sync.ensure_path(camera, api_base)
            if api_base is None:               # o'girish faqat lokal tugunda
                mediamtx_sync.ensure_transcode_path(camera)
        # Kameradan darhol keyframe so'raymiz (ONVIF) — tasvir navbatdagi
        # keyframe'gacha (2-4 s) kutib qolmasin. Fonda ketadi, javobni
        # kechiktirmaydi; qo'llamaydigan kamera jim rad etadi. Sub yo'l
        # ko'rsatilayotganda so'rov ham sub oqimga ketadi.
        fast_start.request_keyframe_async(
            camera["ip"], camera["username"], camera["password"],
            camera["rtsp_path"], row["vendor"] or "",
            stream="sub" if sub else "main")
    return stream_urls(row, request, hevc_ok=bool(hevc), quality=quality)


@router.get("/{ref}/snapshot")
def camera_snapshot(ref: str, request: Request, stale: int = 0, cached: int = 0):
    """Kameraning JPEG surati — video ulangunicha darhol ko'rsatish uchun.

    `ref` — ichki id yoki `ext:...`. Player suratni poster sifatida
    qo'yadi: his qilinadigan ochilish ~100 ms bo'ladi, video esa orqa
    fonda ulanadi.

    Offline/o'chirilgan kamerada `404` — bir hafta oldingi kadr jonli
    bo'lib ko'rinmasin (kuzatuvda eng yomon xato — xatoga o'xshamaydigani).
    `stalled` esa ko'rsatiladi: kamera tarmoqda, HTTP surat odatda
    ishlayveradi va aynan shunda kadr kerak. Fayl diskda qoladi —
    `?stale=1` bilan oxirgi ma'lum kadrni olish mumkin (diagnostika).
    `?cached=1` — faqat diskdagi tayyor surat, kameraga jonli ulanilmaydi
    (dashboard ro'yxatidagi kichik suratlar: o'nlab so'rov kameralarni
    bir vaqtda bezovta qilmasin).
    Javob sarlavhalari `X-Snapshot-At` / `X-Snapshot-Age` — kadr yoshiga
    qarab qarorni iste'molchi qiladi (yozuv, xiralashtirish).
    """
    with get_db() as db:
        row = resolve_ref(db, ref)
    if row is None or not row["enabled"] or not row["ip"]:
        raise HTTPException(404, "Kamera topilmadi")
    check_area(row, allowed_areas(request))

    # DIQQAT: holat va yosh tekshiruvi ETag/304 dan OLDIN turadi — aks
    # holda keshi bor mijoz offline kamerada ham 304 olib eski kadrni
    # ko'rsatishda davom etadi va butun to'siq behuda ketadi.
    blocked = camera_state(row) in ("offline", "disabled")
    if blocked and not stale:
        raise HTTPException(404, "Kamera offline — surat berilmaydi "
                                 "(oxirgi kadr: ?stale=1)")

    # Offline'da jonli olishga urinilmaydi — semafor slotini band qilib
    # FFmpeg'ni timeout'gacha kuttirishning ma'nosi yo'q.
    data, etag, at_epoch = snapshots.read(row, live=not blocked and not cached)
    if not data:
        raise HTTPException(404, "Kameradan surat olib bo'lmadi")

    # Yosh bo'yicha zaxira chegara: holat online desa-yu surat olish
    # muntazam yiqilayotgan bo'lsa, eskirgan kadr baribir to'siladi.
    # Chegara sovuq oraliqqa bog'langan (3×) — issiqqa emas.
    age = max(0, int(time.time() - at_epoch)) if at_epoch else None
    if not stale and age is not None and age > snapshots.max_age():
        raise HTTPException(404, "Surat eskirgan — kamera yangi kadr "
                                 "bermayapti (oxirgi kadr: ?stale=1)")

    headers = {"Cache-Control": "max-age=5"}
    if at_epoch:
        headers["X-Snapshot-At"] = datetime.fromtimestamp(
            at_epoch, timezone.utc).isoformat(timespec="seconds")
        headers["X-Snapshot-Age"] = str(age)
    if etag:
        headers["ETag"] = etag
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers=headers)
    return Response(content=data, media_type="image/jpeg", headers=headers)


@router.post("/{ref}/snapshot", status_code=204)
async def push_snapshot(ref: str, request: Request):
    """Brauzer jonli ko'rinishdan olgan kadrni surat sifatida saqlaydi.

    Operator kamerani (devorda yoki sahifasida) jonli ko'rayotgan bo'lsa,
    brauzer allaqachon dekodlangan kadrga ega — o'shani yuboradi va surat
    yangilanadi. Shunda server o'sha kamera uchun alohida RTSP grab
    qilmaydi: ochiq turgan kameralarda surat tsiklining yuki kamayadi.
    """
    with get_db() as db:
        row = resolve_ref(db, ref)
    if row is None or not row["enabled"]:
        raise HTTPException(404, "Kamera topilmadi")
    check_area(row, allowed_areas(request))
    data = await request.body()
    # Katta yuklamadan himoya + JPEG tekshiruvi store_frame ichida.
    if len(data) > 3_000_000:
        raise HTTPException(413, "Surat juda katta (≤3 MB)")
    if not snapshots.store_frame(row, data):
        raise HTTPException(400, "JPEG kutilgan")
    return Response(status_code=204)


@router.post("/{ref}/sub-bad", status_code=204)
def mark_sub_bad(ref: str, request: Request):
    """Kameraning sub oqimi brauzerда ochilmadi — buni saqlaymiz.

    Frontend devor kataki sub'ni ocholmay asosiyga o'tganда chaqiradi.
    Keyingi safar (restart bo'lsa ham) devor to'g'ridan asosiy oqimdan
    ochadi, sub'ni qayta sinamaydi. Kamera tahrirlanganда 0 ga qaytadi.
    """
    with get_db() as db:
        row = resolve_ref(db, ref)
        if row is None:
            raise HTTPException(404, "Kamera topilmadi")
        check_area(row, allowed_areas(request))
        cameras.set_sub_bad_by_id(db, row["id"])
    return Response(status_code=204)
