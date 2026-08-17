"""Nigoh — super-admin endpointlari: CRUD, NVR import, skaner, MediaMTX."""
import math
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi import APIRouter, Depends, HTTPException, Request

from core import health, security
from core.db import get_db, unique_slug
from core.rtsp_probe import probe
from media import reconciler
from media import sync as mediamtx_sync

from .config import CHANNEL_VENDORS, VENDORS
from .helpers import (admin_camera, cameras_for_mediamtx, detect_codec,
                      mask_config, require_admin)
from .models import CameraIn, NvrIn, ProbeIn, ScanIn

router = APIRouter(prefix="/api/admin", tags=["admin"],
                   dependencies=[Depends(require_admin)])


# ---------- kameralar CRUD ----------

@router.get("/cameras")
def admin_list(request: Request, q: str = "", limit: int = 100, offset: int = 0):
    """Boshqaruv ro'yxati — qidiruv va sahifalash bilan.

    Kamera ko'p bo'lganda hammasini birdan yuborish ham tarmoqni, ham
    brauzerni bo'g'adi, shuning uchun bo'lib beriladi.
    """
    where, params = "", []
    if q.strip():
        needle = f"%{q.strip()}%"
        where = ("WHERE name LIKE ? OR region LIKE ? OR ip LIKE ? "
                 "OR slug LIKE ? OR note LIKE ?")
        params = [needle] * 5

    limit = max(1, min(limit, 500))
    with get_db() as db:
        total = db.execute(f"SELECT COUNT(*) FROM cameras {where}", params).fetchone()[0]
        rows = db.execute(
            f"SELECT * FROM cameras {where} ORDER BY region, name LIMIT ? OFFSET ?",
            params + [limit, max(0, offset)],
        ).fetchall()
    return {
        "total": total,
        "offset": offset,
        "cameras": [admin_camera(r, request) for r in rows],
    }


@router.post("/cameras", status_code=201)
def admin_create(cam: CameraIn, request: Request):
    cam.validate_complete()
    codec, transcode = detect_codec(cam, cam.password or "")
    with get_db() as db:
        slug = unique_slug(db, f"{cam.region}_{cam.name}")
        db.execute(
            "INSERT INTO cameras (name, region, lat, lng, stream_url, slug, ip, "
            "port, username, password_enc, rtsp_path, vendor, enabled, note, "
            "codec, transcode, always_on) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                cam.name.strip(), cam.region.strip(), cam.lat, cam.lng,
                cam.stream_url.strip() if cam.source_type == "manual" else "",
                slug,
                cam.ip.strip() if cam.source_type == "rtsp" else "",
                cam.port, cam.username.strip(),
                security.encrypt(cam.password) if cam.password else "",
                cam.rtsp_path.strip(), cam.vendor, int(cam.enabled), cam.note.strip(),
                codec, int(transcode), int(cam.always_on),
            ),
        )
        row = db.execute("SELECT * FROM cameras WHERE slug = ?", (slug,)).fetchone()
    return admin_camera(row, request)


@router.put("/cameras/{camera_id}")
def admin_update(camera_id: int, cam: CameraIn, request: Request):
    cam.validate_complete()
    with get_db() as db:
        old = db.execute("SELECT * FROM cameras WHERE id = ?", (camera_id,)).fetchone()
        if old is None:
            raise HTTPException(404, "Kamera topilmadi")

        # Parol bo'sh qoldirilsa — eskisi saqlanadi.
        if cam.password:
            password_enc = security.encrypt(cam.password)
        elif cam.source_type == "rtsp":
            password_enc = old["password_enc"] or ""
        else:
            password_enc = ""

        slug = old["slug"]
        if cam.name.strip() != old["name"] or cam.region.strip() != old["region"]:
            slug = unique_slug(db, f"{cam.region}_{cam.name}", exclude_id=camera_id)

        # Kodekni qayta aniqlaymiz — kamera sozlamasi o'zgargan bo'lishi mumkin.
        codec, transcode = detect_codec(cam, cam.password or security.decrypt(password_enc))
        if not codec:                       # kamera javob bermadi — eskisi qoladi
            codec, transcode = old["codec"] or "", bool(old["transcode"])

        db.execute(
            "UPDATE cameras SET name=?, region=?, lat=?, lng=?, stream_url=?, "
            "slug=?, ip=?, port=?, username=?, password_enc=?, rtsp_path=?, "
            "vendor=?, enabled=?, note=?, codec=?, transcode=?, always_on=? "
            "WHERE id=?",
            (
                cam.name.strip(), cam.region.strip(), cam.lat, cam.lng,
                cam.stream_url.strip() if cam.source_type == "manual" else "",
                slug,
                cam.ip.strip() if cam.source_type == "rtsp" else "",
                cam.port, cam.username.strip(), password_enc,
                cam.rtsp_path.strip(), cam.vendor, int(cam.enabled),
                cam.note.strip(), codec, int(transcode), int(cam.always_on),
                camera_id,
            ),
        )
        row = db.execute("SELECT * FROM cameras WHERE id = ?", (camera_id,)).fetchone()
    return admin_camera(row, request)


@router.delete("/cameras/{camera_id}", status_code=204)
def admin_delete(camera_id: int):
    with get_db() as db:
        cur = db.execute("DELETE FROM cameras WHERE id = ?", (camera_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Kamera topilmadi")


# ---------- NVR import va skaner ----------

def parse_channels(spec: str, limit: int = 512) -> list[int]:
    """"1-16" yoki "1,3,5-8" ni raqamlar ro'yxatiga aylantiradi."""
    numbers: list[int] = []
    for chunk in spec.replace(" ", "").split(","):
        if not chunk:
            continue
        if "-" in chunk:
            try:
                start, end = (int(v) for v in chunk.split("-", 1))
            except ValueError:
                raise HTTPException(400, f"Kanal oralig'i noto'g'ri: {chunk}")
            if start > end:
                start, end = end, start
            numbers.extend(range(start, end + 1))
        else:
            try:
                numbers.append(int(chunk))
            except ValueError:
                raise HTTPException(400, f"Kanal raqami noto'g'ri: {chunk}")

    unique = sorted({n for n in numbers if n > 0})
    if not unique:
        raise HTTPException(400, "Kanallar ko'rsatilmagan")
    if len(unique) > limit:
        raise HTTPException(400, f"Bir marta ko'pi bilan {limit} ta kanal")
    return unique


def channel_path(vendor: str, channel: int, stream: str) -> str:
    """Kanal raqamidan ishlab chiqaruvchiga mos RTSP yo'lini quradi."""
    sub = stream == "sub"
    if vendor == "hikvision":
        # 101 = 1-kanal asosiy, 102 = 1-kanal qo'shimcha oqim
        return f"/Streaming/Channels/{channel}0{2 if sub else 1}"
    if vendor in ("dahua", "amcrest"):
        return f"/cam/realmonitor?channel={channel}&subtype={1 if sub else 0}"
    if vendor == "uniview":
        return f"/unicast/c{channel}/s{2 if sub else 1}/live"
    if vendor == "reolink":
        return f"/h264Preview_{channel:02d}_{'sub' if sub else 'main'}"
    if vendor == "axis":
        return f"/axis-media/media.amp?camera={channel}"
    if vendor == "holowits":
        return f"/LiveMedia/ch{channel}/Media{2 if sub else 1}"
    return f"/stream{2 if sub else 1}"


def spread_point(lat: float, lng: float, index: int, spread_m: int) -> tuple[float, float]:
    """Nuqtalarni spiral bo'ylab tarqatadi — markerlar ustma-ust tushmasin."""
    if spread_m <= 0 or index == 0:
        return lat, lng
    step = math.sqrt(index) * spread_m
    angle = index * 2.399963            # oltin burchak — bir tekis tarqaladi
    d_lat = (step * math.cos(angle)) / 111_320
    d_lng = (step * math.sin(angle)) / (111_320 * max(0.2, math.cos(math.radians(lat))))
    return round(lat + d_lat, 6), round(lng + d_lng, 6)


@router.post("/nvr/import")
def admin_nvr_import(body: NvrIn):
    """Registratordagi kanallarni birdaniga kameralarga aylantiradi."""
    channels = parse_channels(body.channels)
    prefix = body.name_prefix.strip() or body.region.strip()

    planned = []
    for index, channel in enumerate(channels):
        lat, lng = spread_point(body.lat, body.lng, index, body.spread_m)
        planned.append({
            "channel": channel,
            "name": f"{prefix} {channel}-kanal",
            "rtsp_path": channel_path(body.vendor, channel, body.stream),
            "lat": lat, "lng": lng,
        })

    # Tekshirish parallel ketadi — 64 ta kanalni ketma-ket tekshirish
    # bir necha daqiqa oladi, parallel esa bir necha soniya.
    results: dict[int, dict] = {}
    if body.probe:
        with ThreadPoolExecutor(max_workers=16) as pool:
            futures = {
                pool.submit(probe, body.ip, body.port, item["rtsp_path"],
                            body.username, body.password): item["channel"]
                for item in planned
            }
            for future in as_completed(futures):
                results[futures[future]] = future.result()

    for item in planned:
        result = results.get(item["channel"])
        item["ok"] = result["ok"] if result else None
        item["codec"] = result.get("codec", "") if result else ""
        item["transcode"] = bool(result.get("needs_transcode")) if result else False
        item["message"] = result["message"] if result else "tekshirilmadi"

    if body.dry_run:
        return {"planned": planned, "created": 0,
                "reachable": sum(1 for p in planned if p["ok"])}

    # Javob bermagan kanallar saqlanmaydi — NVR'da bo'sh slotlar ko'p bo'ladi.
    keep = [p for p in planned if p["ok"] or not body.probe]
    password_enc = security.encrypt(body.password) if body.password else ""
    created = 0
    with get_db() as db:
        for item in keep:
            slug = unique_slug(db, f"{body.region}_{item['name']}")
            db.execute(
                "INSERT INTO cameras (name, region, lat, lng, stream_url, slug, ip, "
                "port, username, password_enc, rtsp_path, vendor, enabled, note, "
                "codec, transcode, always_on) "
                "VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
                (item["name"], body.region.strip(), item["lat"], item["lng"], slug,
                 body.ip.strip(), body.port, body.username.strip(), password_enc,
                 item["rtsp_path"], body.vendor, int(body.enabled),
                 f"{body.ip} · {item['channel']}-kanal",
                 item["codec"], int(item["transcode"])),
            )
            created += 1

    return {"planned": planned, "created": created,
            "skipped": len(planned) - created,
            "reachable": sum(1 for p in planned if p["ok"])}


def _probe_many(ip: str, port: int, jobs: dict, username: str,
                password: str) -> dict:
    """Bir nechta RTSP yo'lni parallel tekshiradi: {kalit: probe natijasi}."""
    results: dict = {}
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = {
            pool.submit(probe, ip, port, path, username, password): key
            for key, path in jobs.items()
        }
        for future in as_completed(futures):
            results[futures[future]] = future.result()
    return results


@router.post("/scan")
def admin_scan(body: ScanIn):
    """Qurilmani o'zi aniqlaydi: turi (kamera/NVR), shabloni va jonli kanallari.

    Oddiy foydalanuvchi RTSP yo'lini ham, kanal raqamlarini ham bilmaydi —
    IP va login/parol yetarli. Skaner mashhur shablonlarni sinab, qaysi
    biri ishlashini topadi, so'ng kanallarni 8 talik bloklarda tekshiradi
    va bo'sh blok kelganda to'xtaydi.
    """
    ip, port = body.ip.strip(), body.port
    user, pw = body.username.strip(), body.password
    if not pw and body.camera_id:
        with get_db() as db:
            row = db.execute("SELECT password_enc FROM cameras WHERE id = ?",
                             (body.camera_id,)).fetchone()
        if row:
            pw = security.decrypt(row["password_enc"])

    # 1) Shablonni aniqlash — har bir ishlab chiqaruvchining 1-kanali.
    candidates = {v: channel_path(v, 1, "main") for v in CHANNEL_VENDORS}
    candidates["boshqa"] = "/stream1"          # bitta oqimli oddiy kameralar
    first = _probe_many(ip, port, candidates, user, pw)

    # Hech biri ochilmadi-yu, parol xatosi bor — avval shuni aytamiz.
    if not any(r["ok"] for r in first.values()):
        for stage in ("parol", "oqim", "rtsp", "tarmoq"):
            hit = next((r for r in first.values() if r.get("stage") == stage), None)
            if hit:
                return {"found": False, "message": hit["message"]}
        return {"found": False, "message": "Qurilma javob bermadi"}

    vendor = next(v for v in [*CHANNEL_VENDORS, "boshqa"]
                  if first.get(v, {}).get("ok"))
    vendor_name = next((v["name"] for v in VENDORS if v["id"] == vendor), vendor)

    def entry(channel: int, result: dict) -> dict:
        return {
            "channel": channel,
            "rtsp_path": channel_path(vendor, channel, "main"),
            "codec": result.get("codec", ""),
            "needs_transcode": bool(result.get("needs_transcode")),
        }

    channels = [entry(1, first[vendor])]

    # 2) Kanallarni sanash — faqat kanal raqamini biladigan shablonlarda.
    if vendor != "boshqa":
        start = 2
        while start <= body.max_channels:
            block = range(start, min(start + 8, body.max_channels + 1))
            jobs = {c: channel_path(vendor, c, "main") for c in block}
            results = _probe_many(ip, port, jobs, user, pw)
            live = [c for c in sorted(results) if results[c]["ok"]]
            channels.extend(entry(c, results[c]) for c in live)
            if not live:                       # bo'sh blok — qurilma tugadi
                break
            start += 8

    return {
        "found": True,
        "vendor": vendor,
        "vendor_name": vendor_name,
        "device": "nvr" if len(channels) > 1 else "camera",
        "channels": channels,
    }


@router.post("/probe")
def admin_probe(body: ProbeIn):
    """Kamera bilan aloqani va login/parolni tekshiradi."""
    password = body.password or ""
    if not password and body.camera_id:
        with get_db() as db:
            row = db.execute(
                "SELECT password_enc FROM cameras WHERE id = ?", (body.camera_id,)
            ).fetchone()
        if row:
            password = security.decrypt(row["password_enc"])
    return probe(body.ip.strip(), body.port, body.rtsp_path.strip(),
                 body.username.strip(), password)


# ---------- MediaMTX ----------

@router.get("/status")
def admin_status():
    """Tizim salomatligi bir qarashda — 5000 kamerani ko'z bilan emas,
    raqam bilan kuzatish uchun: MediaMTX tirikmi, health sweep intervalga
    sig'ayaptimi, qaysi faol oqimlar muzlagan."""
    return {
        "mediamtx": mediamtx_sync.api_available(),
        "health": health.sweep_stats(),
        "stalled": sorted(reconciler.stalled_paths()),
    }


@router.get("/events")
def admin_events(limit: int = 100):
    """Media qatlamining so'nggi hodisalari: oqim muzladi/tiklandi,
    MediaMTX qayta ishga tushdi. Kamera uzilish tarixi stats_event'da."""
    with get_db() as db:
        rows = db.execute(
            "SELECT ts, kind, ip, port, slug, detail FROM events "
            "ORDER BY id DESC LIMIT ?", (max(1, min(limit, 500)),),
        ).fetchall()
    return {"events": [dict(r) for r in rows]}


@router.post("/mediamtx/sync")
def admin_sync():
    """mediamtx.yml faylini qayta yozadi va imkon bo'lsa jonli yangilaydi."""
    with get_db() as db:
        cameras = cameras_for_mediamtx(db)
    written = mediamtx_sync.write_config(cameras)
    pushed = mediamtx_sync.push_to_api(cameras)
    return {
        "written": written,
        "config_path": str(mediamtx_sync.CONFIG_PATH),
        "live": pushed,
    }


@router.get("/mediamtx/config")
def admin_config_preview():
    with get_db() as db:
        cameras = cameras_for_mediamtx(db)
    return {
        # Parollar yashiriladi — faylga esa ochiq holda yoziladi (MediaMTX uchun).
        "text": mask_config(mediamtx_sync.build_config(cameras)),
        "api_available": mediamtx_sync.api_available(),
        "transcoding": sum(1 for c in cameras if c["transcode"] and c["enabled"]),
        "gpu": mediamtx_sync.has_nvenc(),
    }
