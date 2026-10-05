"""Nigoh — MediaMTX tugunlari: CRUD, salomatlik va tayyor konfiguratsiya.

Kameralar bir necha binoda/shaharda bo'lsa, har joyga bitta MediaMTX
qo'yiladi — kamera trafigi lokal tarmoqda qoladi, magistralga faqat ayni
damda ko'rilayotgan oqim chiqadi. 1-tugun — backend bilan bitta
mashinadagi asosiy MediaMTX.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Response

from camera import reconciler
from camera import sync as mediamtx_sync
from database import get_db
from database import nodes as nodes_db

from .config import PORT
from .helpers import clear_node_cache, require_admin
from .models import NodeIn

# Prefiks /admin bo'lib qoladi — debug UI va mavjud mijozlar buzilmasin.
router = APIRouter(prefix="/admin", tags=["nodes"],
                   dependencies=[Depends(require_admin)])


def _node_data(body: NodeIn) -> dict:
    return {"name": body.name.strip(), "api_base": body.api_base.strip().rstrip("/"),
            "public_host": body.public_host.strip(), "rtsp_port": body.rtsp_port,
            "hls_port": body.hls_port, "webrtc_port": body.webrtc_port,
            "enabled": bool(body.enabled)}


@router.get("/nodes")
def admin_nodes():
    """Tugunlar ro'yxati: kameralar soni, salomatlik va ish ko'rsatkichlari.

    `status`: online — API tirik va muzlagan oqim yo'q; degraded — API tirik,
    lekin kamida bitta faol oqim muzlagan; offline — API javob bermayapti
    (yangi kameralarni bunday tugunga biriktirmang).
    """
    with get_db() as db:
        rows = nodes_db.list_with_counts(db)
    nodes = []
    for row in rows:
        node = dict(row)
        runtime = mediamtx_sync.node_runtime(row["api_base"])
        stalled = reconciler.stalled_count(row["id"])
        node["online"] = runtime is not None
        node["stalled"] = stalled
        node["runtime"] = runtime
        node["pending_paths"] = reconciler.pending_count(row["id"])
        node["status"] = ("offline" if runtime is None else
                          "degraded" if stalled else "online")
        nodes.append(node)
    return {"nodes": nodes}


@router.post("/nodes", status_code=201)
def admin_node_create(body: NodeIn):
    with get_db() as db:
        row = nodes_db.create(db, _node_data(body))
    clear_node_cache()
    return dict(row)


@router.put("/nodes/{node_id}")
def admin_node_update(node_id: int, body: NodeIn):
    with get_db() as db:
        row = nodes_db.update(db, node_id, _node_data(body))
        if row is None:
            raise HTTPException(404, "Tugun topilmadi")
    clear_node_cache()
    return dict(row)


@router.delete("/nodes/{node_id}", status_code=204)
def admin_node_delete(node_id: int):
    if node_id == 1:
        raise HTTPException(400, "Asosiy tugunni o'chirib bo'lmaydi")
    with get_db() as db:
        used = nodes_db.camera_count(db, node_id)
        if used:
            raise HTTPException(400, f"Tugunda {used} ta kamera bor — avval "
                                     f"ularni boshqa tugunga o'tkazing")
        if not nodes_db.delete(db, node_id):
            raise HTTPException(404, "Tugun topilmadi")
    clear_node_cache()


@router.get("/nodes/{node_id}/config")
def admin_node_config(node_id: int, request: Request):
    """Tugun mashinasiga qo'yiladigan tayyor mediamtx.yml.

    Ichida parol yo'q (kamera yo'llarini markaz API orqali yuboradi),
    shuning uchun ochiq qaytariladi. Auth manzili — backend'ning tugun
    ko'radigan manzili; kerak bo'lsa STREAM_AUTH_URL bilan almashtiring.
    """
    with get_db() as db:
        row = nodes_db.get(db, node_id)
    if row is None:
        raise HTTPException(404, "Tugun topilmadi")
    auth_url = f"http://{request.url.hostname}:{PORT}/api/auth/stream"
    return Response(
        mediamtx_sync.build_config([], auth_url=auth_url, node=dict(row)),
        media_type="text/plain; charset=utf-8",
    )
