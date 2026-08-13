"""Nigoh — kamera xaritasi va super-admin paneli.

Ishga tushirish:
    pip install -r requirements.txt
    python main.py
Keyin brauzerda:  http://localhost:8010
(Portni o'zgartirish:  set PORT=8020  &&  python main.py)

Admin parolini almashtirish:
    python main.py --admin-parol YangiParol123
"""
import math
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator

import mediamtx_sync
import security
from db import BASE_DIR, get_db, init_db, unique_slug
from rtsp_probe import probe

PORT = int(os.environ.get("PORT", "8010"))
HLS_PORT = int(os.environ.get("HLS_PORT", "8888"))
WEBRTC_PORT = int(os.environ.get("WEBRTC_PORT", "8889"))
MEDIA_HOST = os.environ.get("MEDIA_HOST", "")  # bo'sh bo'lsa so'rov manzilidan olinadi

# Kamerani qo'shishda tanlanadigan tayyor RTSP shablonlari.
VENDORS = [
    {"id": "hikvision", "name": "Hikvision", "path": "/Streaming/Channels/101", "port": 554},
    {"id": "dahua", "name": "Dahua", "path": "/cam/realmonitor?channel=1&subtype=0", "port": 554},
    {"id": "uniview", "name": "Uniview", "path": "/media/video1", "port": 554},
    {"id": "axis", "name": "Axis", "path": "/axis-media/media.amp", "port": 554},
    {"id": "tplink", "name": "TP-Link / Tapo", "path": "/stream1", "port": 554},
    {"id": "reolink", "name": "Reolink", "path": "/h264Preview_01_main", "port": 554},
    {"id": "amcrest", "name": "Amcrest", "path": "/cam/realmonitor?channel=1&subtype=0", "port": 554},
    {"id": "boshqa", "name": "Boshqa (qo'lda)", "path": "/stream1", "port": 554},
]


# ---------- so'rov modellari ----------

class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=200)


class CameraIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    region: str = Field(min_length=1, max_length=120)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    source_type: str = "rtsp"          # "rtsp" | "manual"
    enabled: bool = True
    # Standart holda o'chiq: kamera faqat kimdir ko'rganda ulanadi. Aks holda
    # kameralar soni ortishi bilan tarmoq ham, GPU ham tugaydi.
    always_on: bool = False
    note: str = Field(default="", max_length=500)

    # RTSP kamera uchun
    ip: str = Field(default="", max_length=100)
    port: int = Field(default=554, ge=1, le=65535)
    username: str = Field(default="", max_length=100)
    password: str | None = None        # None = o'zgartirilmasin
    rtsp_path: str = Field(default="/stream1", max_length=300)
    vendor: str = Field(default="boshqa", max_length=40)

    # Tayyor oqim manzili uchun
    stream_url: str = Field(default="", max_length=500)

    @field_validator("source_type")
    @classmethod
    def _check_source(cls, v: str) -> str:
        if v not in ("rtsp", "manual"):
            raise ValueError("source_type faqat 'rtsp' yoki 'manual' bo'lishi mumkin")
        return v

    def validate_complete(self) -> None:
        if self.source_type == "rtsp" and not self.ip.strip():
            raise HTTPException(400, "IP manzil kiritilmagan")
        if self.source_type == "manual" and not self.stream_url.strip():
            raise HTTPException(400, "Oqim manzili kiritilmagan")


class NvrIn(BaseModel):
    """Bitta NVR/registratordagi kanallarni birdaniga qo'shish.

    1000 ta kamerani qo'lda kiritib bo'lmaydi — odatda ular 30-40 ta
    registratorga ulangan bo'ladi, har birida 16-64 kanal.
    """
    ip: str = Field(min_length=1, max_length=100)
    port: int = Field(default=554, ge=1, le=65535)
    username: str = Field(default="", max_length=100)
    password: str = Field(default="", max_length=200)
    vendor: str = Field(default="hikvision", max_length=40)
    channels: str = Field(default="1-16", max_length=200)   # "1-16" yoki "1,3,5-8"
    region: str = Field(min_length=1, max_length=120)
    name_prefix: str = Field(default="", max_length=100)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    spread_m: int = Field(default=120, ge=0, le=5000)  # nuqtalar bir-birini bosmasin
    stream: str = Field(default="main")                # "main" | "sub"
    enabled: bool = True
    probe: bool = True                                 # kodekni tekshirib olsinmi
    dry_run: bool = False                              # avval ko'rsatib bersin


class ProbeIn(BaseModel):
    ip: str = Field(min_length=1, max_length=100)
    port: int = Field(default=554, ge=1, le=65535)
    username: str = Field(default="", max_length=100)
    password: str | None = None
    rtsp_path: str = Field(default="/stream1", max_length=300)
    camera_id: int | None = None       # saqlangan parolni ishlatish uchun


# ---------- yordamchilar ----------

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

    if row["transcode"] and hevc_ok:
        slug = row["slug"] + "_raw"
        return {
            "stream_url": f"http://{host}:{HLS_PORT}/{slug}/index.m3u8",
            "webrtc_url": "",
            "mode": "raw",           # o'girishsiz — resurs sarflanmaydi
        }

    return {
        "stream_url": f"http://{host}:{HLS_PORT}/{row['slug']}/index.m3u8",
        # WebRTC ancha tez ochiladi — brauzer avval shuni sinaydi.
        "webrtc_url": f"http://{host}:{WEBRTC_PORT}/{row['slug']}/whep",
        "mode": "transcode" if row["transcode"] else "direct",
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


def cameras_for_mediamtx(db) -> list[dict]:
    rows = db.execute("SELECT * FROM cameras WHERE ip IS NOT NULL AND ip != ''").fetchall()
    return [{
        "slug": r["slug"], "ip": r["ip"], "port": r["port"] or 554,
        "rtsp_path": r["rtsp_path"] or "/", "username": r["username"] or "",
        "password": security.decrypt(r["password_enc"]),
        "enabled": bool(r["enabled"]),
        "transcode": bool(r["transcode"]),
        "always_on": bool(r["always_on"]),
    } for r in rows]


def detect_codec(cam: "CameraIn", password: str) -> tuple[str, bool]:
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


# ---------- ilova ----------

app = FastAPI(title="Nigoh — kamera xaritasi")


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/api/vendors")
def list_vendors():
    return VENDORS


# ---------- autentifikatsiya ----------

@app.post("/api/auth/login")
def login(body: LoginIn, response: Response):
    with get_db() as db:
        security.purge_expired_sessions(db)
        row = db.execute(
            "SELECT id, username, pw_hash, pw_salt FROM admins WHERE username = ?",
            (body.username,),
        ).fetchone()
        if row is None or not security.verify_password(
            body.password, row["pw_hash"], row["pw_salt"]
        ):
            raise HTTPException(401, "Login yoki parol noto'g'ri")
        token = security.create_session(db, row["id"])
        username = row["username"]

    response.set_cookie(
        security.SESSION_COOKIE, token, httponly=True, samesite="lax",
        max_age=security.SESSION_HOURS * 3600, path="/",
    )
    return {"username": username}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response):
    with get_db() as db:
        security.delete_session(db, request.cookies.get(security.SESSION_COOKIE))
    response.delete_cookie(security.SESSION_COOKIE, path="/")
    return {"ok": True}


@app.get("/api/auth/me")
def me(request: Request):
    token = request.cookies.get(security.SESSION_COOKIE)
    with get_db() as db:
        admin = security.session_admin(db, token)
    if admin is None:
        return {"authenticated": False}
    return {"authenticated": True, "username": admin["username"]}


# ---------- ochiq ma'lumot ----------

@app.get("/api/cameras")
def list_cameras(bbox: str = "", limit: int = 20000):
    """Xarita uchun kameralar — yengil ro'yxat.

    Oqim manzillari bu yerda yuborilmaydi: 1000 ta kamerada ular javobning
    yarmini egallaydi, holbuki bir vaqtda faqat bittasi ochiladi.
    Manzil `/api/cameras/{id}/stream` dan olinadi.

    `bbox` berilsa (minLat,minLng,maxLat,maxLng) faqat shu to'rtburchak
    ichidagilar qaytariladi.
    """
    sql = ("SELECT id, name, region, lat, lng FROM cameras WHERE enabled = 1")
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
        "cameras": [dict(r) for r in rows],
    }


@app.get("/api/cameras/{camera_id}/stream")
def camera_stream(camera_id: int, request: Request, hevc: int = 0):
    """Bitta kameraning oqim manzili — ko'rish boshlanganda so'raladi.

    `hevc=1` — brauzer H.265 ni o'zi o'qiy oladi, o'girish kerak emas.
    """
    with get_db() as db:
        row = db.execute(
            "SELECT slug, ip, stream_url, transcode FROM cameras "
            "WHERE id = ? AND enabled = 1",
            (camera_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(404, "Kamera topilmadi")
    return stream_urls(row, request, hevc_ok=bool(hevc))


# ---------- super-admin ----------

@app.get("/api/admin/cameras")
def admin_list(request: Request, q: str = "", limit: int = 100, offset: int = 0,
               _admin=Depends(require_admin)):
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


@app.post("/api/admin/cameras", status_code=201)
def admin_create(cam: CameraIn, request: Request, _admin=Depends(require_admin)):
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


@app.put("/api/admin/cameras/{camera_id}")
def admin_update(camera_id: int, cam: CameraIn, request: Request,
                 _admin=Depends(require_admin)):
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


@app.delete("/api/admin/cameras/{camera_id}", status_code=204)
def admin_delete(camera_id: int, _admin=Depends(require_admin)):
    with get_db() as db:
        cur = db.execute("DELETE FROM cameras WHERE id = ?", (camera_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Kamera topilmadi")


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


@app.post("/api/admin/nvr/import")
def admin_nvr_import(body: NvrIn, _admin=Depends(require_admin)):
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


@app.post("/api/admin/probe")
def admin_probe(body: ProbeIn, _admin=Depends(require_admin)):
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


@app.post("/api/admin/mediamtx/sync")
def admin_sync(_admin=Depends(require_admin)):
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


@app.get("/api/admin/mediamtx/config")
def admin_config_preview(_admin=Depends(require_admin)):
    with get_db() as db:
        cameras = cameras_for_mediamtx(db)
    return {
        # Parollar yashiriladi — faylga esa ochiq holda yoziladi (MediaMTX uchun).
        "text": mask_config(mediamtx_sync.build_config(cameras)),
        "api_available": mediamtx_sync.api_available(),
        "transcoding": sum(1 for c in cameras if c["transcode"] and c["enabled"]),
        "gpu": mediamtx_sync.has_nvenc(),
    }


# ---------- ishga tushirish ----------

def bootstrap() -> None:
    init_db()

    # Toza nusxada mediamtx.yml bo'lmaydi (u maxfiy ro'yxatda) — o'zimiz
    # yaratamiz, aks holda MediaMTX ishga tusha olmaydi.
    if not mediamtx_sync.CONFIG_PATH.exists():
        with get_db() as db:
            mediamtx_sync.write_config(cameras_for_mediamtx(db))
        print(f"mediamtx.yml yaratildi: {mediamtx_sync.CONFIG_PATH}")

    with get_db() as db:
        generated = security.ensure_admin(db)
    if generated:
        login_name = os.environ.get("ADMIN_LOGIN", "admin")
        print("\n" + "=" * 58)
        print("  SUPER-ADMIN YARATILDI — bu ma'lumotni saqlab qo'ying")
        print(f"     login:  {login_name}")
        print(f"     parol:  {generated}")
        print("  Parolni almashtirish:")
        print("     python main.py --admin-parol YangiParol")
        print("=" * 58 + "\n")


if "--admin-parol" in sys.argv:
    init_db()
    index_of = sys.argv.index("--admin-parol")
    if index_of + 1 >= len(sys.argv):
        sys.exit("Parolni ko'rsating:  python main.py --admin-parol YangiParol")
    new_password = sys.argv[index_of + 1]
    if len(new_password) < 6:
        sys.exit("Parol kamida 6 belgidan iborat bo'lsin")
    with get_db() as conn:
        security.set_password(conn, os.environ.get("ADMIN_LOGIN", "admin"), new_password)
    print("Parol almashtirildi. Barcha eski sessiyalar bekor qilindi.")
    sys.exit(0)

bootstrap()

if __name__ == "__main__":
    # 8000-port ko'pincha band bo'ladi (Docker Desktop, Windows xizmatlari) —
    # boshqa portni PORT muhit o'zgaruvchisi orqali berish mumkin.
    #
    # Avtomatik qayta yuklash faqat kod yozayotganda kerak (set RELOAD=1);
    # Windows'da u ba'zan osilib qoladi, shuning uchun standart holatda o'chiq.
    uvicorn.run("main:app", host="0.0.0.0", port=PORT,
                reload=os.environ.get("RELOAD") == "1")
