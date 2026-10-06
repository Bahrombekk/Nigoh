"""MediaMTX boshqaruvi: media hodisalari, konfiguratsiyani yozish va ko'rish.

Odatda qo'lda aralashish kerak emas — reconciler har 30 s da tugunlarni
o'zi kelishtiradi. Bu endpointlar admin uchun: "hozir majburan
sinxronla" tugmasi va konfiguratsiyani (parollarsiz) ko'rish.

Endpointlar (admin; router darajasida require_admin):
    GET  /api/v1/admin/events            media qatlamining so'nggi hodisalari
                                         (oqim muzladi/tiklandi, MediaMTX
                                         qayta ishga tushdi); limit<=500
    POST /api/v1/admin/mediamtx/sync     mediamtx.yml ni qayta yozadi va har
                                         tugunga faqat o'z kameralarini
                                         yuboradi (aks holda reconciler 30 s
                                         dan keyin ularni qaytarib o'chirardi)
    GET  /api/v1/admin/mediamtx/config   konfiguratsiya matni (parollar
                                         yashirilgan), API holati, o'girilayotgan
                                         kameralar soni, GPU bor-yo'qligi

Ishlatadi: camera.media.sync, camera.media.mapping, camera.views.mask_config,
database (events, nodes)
Kim ishlatadi: app/factory.py (router); frontend admin paneli
"""
from fastapi import APIRouter, Depends

from camera.media import sync as mediamtx_sync
from camera.media.mapping import cameras_for_mediamtx
from camera.views import mask_config
from database import (
    events,
    get_db,
)
from database import nodes as nodes_db
from users.access import require_admin

# Prefiks nisbiy — create_app uni /api/v1 (asosiy) va /api (eski) ostida ulaydi.
router = APIRouter(prefix="/admin", tags=["admin"],
                   dependencies=[Depends(require_admin)])


@router.get("/events")
def admin_events(limit: int = 100):
    """Media qatlamining so'nggi hodisalari: oqim muzladi/tiklandi,
    MediaMTX qayta ishga tushdi. Jonli holat o'zgarishlari SSE'da (/events)."""
    with get_db() as db:
        rows = events.recent(db, max(1, min(limit, 500)))
    return {"events": [dict(r) for r in rows]}


@router.post("/mediamtx/sync")
def admin_sync():
    """mediamtx.yml faylini qayta yozadi va har bir tugunni jonli yangilaydi.

    Kameralar tugun bo'yicha ajratib yuboriladi — aks holda boshqa tugunga
    biriktirilgan kameralar lokal MediaMTX'ga ham tushib, 30 soniyadan
    keyin reconciler ularni qaytarib o'chirardi (keraksiz tebranish).
    """
    with get_db() as db:
        cameras = cameras_for_mediamtx(db)
        nodes = [dict(r) for r in nodes_db.list_enabled(db)]
    written = mediamtx_sync.write_config(cameras)
    if not nodes:
        nodes = [{"id": 1, "name": "Asosiy", "api_base": None}]

    results = []
    for node in nodes:
        node_cams = [c for c in cameras if (c.get("node_id") or 1) == node["id"]]
        pushed = mediamtx_sync.push_to_api(node_cams, api_base=node["api_base"])
        results.append({"node": node["name"], **pushed})

    ok = all(r["ok"] for r in results)
    message = (results[0]["message"] if len(results) == 1 else
               " · ".join(f"{r['node']}: {r['message']}" for r in results))
    return {
        "written": written,
        "config_path": str(mediamtx_sync.CONFIG_PATH),
        "live": {
            "ok": ok, "message": message,
            "added": sum(r["added"] for r in results),
            "updated": sum(r["updated"] for r in results),
            "removed": sum(r["removed"] for r in results),
            "nodes": results,
        },
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
