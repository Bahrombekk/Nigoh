"""Nigoh — video devor (mozaika) API'si.

Brauzer tanlagan kameralarni serverda BITTA katakli oqimga birlashtirish
uchun. `POST /walls` tanlovni saqlaydi va bitta mozaika oqimining manzilini
(+ katak xaritasi) qaytaradi. Brauzer 36 ta emas, bitta oqim ochadi.

Mozaikani FFmpeg yasaydi (`walls/mosaic.py`), MediaMTX `~^wall_...$`
shabloni bo'yicha talab qilinganda ishga tushiradi (`stream_launcher.py`
-> camera/media/launcher.py `run_wall`). Bir xil tanlovni ko'pchilik
so'rasa, bitta kalit chiqadi va bitta oqimni bo'lishadi.

Qoidalar: takror id'lar olib tashlanadi (tartib saqlanadi); topilmagan va
operatorga ruxsat etilmagan hududdagi kameralar jim tashlanadi (hech biri
qolmasa 404); ko'pi bilan 64 katak (8×8); hozircha (MVP) faqat asosiy
(1-) tugundagi kameralar — launcher faqat shu mashinada. Manzillar chipta
(`security.stream_token`) bilan: MEDIA_BASE bo'lsa proksi orqali, aks
holda MediaMTX portlariga to'g'ridan.

Endpointlar (require_viewer; prefiks /api/v1, eski /api):
    POST /api/v1/walls    tanlovdan mozaika oqimi: path (wall_<kalit>),
                          stream_url (HLS), webrtc_url (WHEP), cols/rows,
                          tiles — har kamera katagi (normallashtirilgan
                          x/y/w/h, bosib kattalashtirish uchun)

Tarkibi:
    router      APIRouter(prefix="/walls", tags=["walls"])
    WallIn      so'rov: camera_ids (1-64), cols/rows (1-8, ixtiyoriy)

Ishlatadi: walls.registry (save_wall), walls.mosaic (grid_for),
    camera.streaming.media_host, core.security, database.cameras,
    users.access, app.config (HLS_PORT, WEBRTC_PORT, MEDIA_BASE).
Kim ishlatadi: app/factory.py (require_viewer bilan), tests/test_walls.py.
"""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.config import HLS_PORT, MEDIA_BASE, WEBRTC_PORT
from camera.streaming import media_host
from core import security
from database import cameras, get_db
from users.access import allowed_areas, area_allowed
from walls import registry as walls_registry
from walls.mosaic import grid_for

router = APIRouter(prefix="/walls", tags=["walls"])


class WallIn(BaseModel):
    camera_ids: list[int] = Field(min_length=1, max_length=64)
    cols: int | None = Field(default=None, ge=1, le=8)
    rows: int | None = Field(default=None, ge=1, le=8)


@router.post("")
def create_wall(body: WallIn, request: Request):
    """Kamera tanlovidan mozaika oqimi yaratadi (yoki mavjudini qaytaradi).

    Qaytadi: `path` (wall_<kalit>), `stream_url`/`webrtc_url` (bitta oqim),
    `cols`/`rows` va `tiles` — har kamera qaysi katakda (bosib
    kattalashtirish uchun).
    """
    ids = list(dict.fromkeys(body.camera_ids))   # takrorlarni olib tashlaymiz, tartib saqlanadi
    with get_db() as db:
        found = {r["id"]: r for r in cameras.list_by_ids(db, ids)}
    areas = allowed_areas(request)
    ids = [i for i in ids if i in found and area_allowed(found[i], areas)]
    if not ids:
        raise HTTPException(404, "Birorta kamera topilmadi")

    cols, rows = grid_for(len(ids), body.cols, body.rows)
    if cols * rows > 64:
        raise HTTPException(400, "Maksimal 64 katak (8×8)")

    # MVP: mozaika lokal tugunda quriladi (launcher faqat shu mashinada).
    nodes = {found[i]["node_id"] or 1 for i in ids}
    if nodes - {1}:
        raise HTTPException(400, "Hozircha faqat asosiy tugundagi kameralar "
                                 "bitta devorga birlashtiriladi")

    key = walls_registry.save_wall(ids, cols, rows)
    slug = "wall_" + key
    token = security.stream_token(slug)

    host = media_host(request)
    if MEDIA_BASE:
        stream_url = f"{MEDIA_BASE}/hls/{slug}/index.m3u8?token={token}"
        webrtc_url = f"{MEDIA_BASE}/whep/{slug}/whep?token={token}"
    else:
        stream_url = f"http://{host}:{HLS_PORT}/{slug}/index.m3u8?token={token}"
        webrtc_url = f"http://{host}:{WEBRTC_PORT}/{slug}/whep?token={token}"

    tiles = []
    for idx, cid in enumerate(ids):
        c = found[cid]
        col, row = idx % cols, idx // cols
        tiles.append({
            "camera_id": cid, "name": c["name"], "region": c["region"] or "",
            "col": col, "row": row,
            # Normallashtirilgan joylashuv — brauzer bosilgan nuqtani
            # katakka, katakni kameraga o'giradi (bosib kattalashtirish).
            "x": round(col / cols, 5), "y": round(row / rows, 5),
            "w": round(1 / cols, 5), "h": round(1 / rows, 5),
        })
    return {"path": slug, "mode": "direct", "cols": cols, "rows": rows,
            "stream_url": stream_url, "webrtc_url": webrtc_url, "tiles": tiles}
