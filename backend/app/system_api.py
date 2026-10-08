"""Nigoh — tizim holati endpointlari (faqat admin / API kaliti).

5000 kamerani ko'z bilan emas, raqam bilan kuzatish uchun: MediaMTX
tirikmi, health sweep intervalga sig'ayaptimi, qaysi faol oqimlar
muzlagan, tugunlar qay ahvolda, disk qancha band. Ochiq /health versiyani
bermaydi; v3 dan kirish oynasi uchun u /public/info da ham bor.

Endpointlar (router darajasida require_admin; prefiks /api/v1/admin,
eski /api/admin):
    GET  /api/v1/admin/runtime   faol yo'llarning jonli xaritasi: slug ->
                                 ready / readers / bytes_received /
                                 bytes_sent / warm. Faqat lokal tugun —
                                 uzoq tugunlar salomatligi /admin/nodes da
    GET  /api/v1/admin/status    versiya va update {current, latest}, MediaMTX
                                 (bool) va mediamtx_uptime_s, health sweep,
                                 network.latency_ms, disk (suratlar, baza, jurnal,
                                 used_pct, total_mb, free_mb), muzlagan yo'llar,
                                 tugunlar (status, ready, readers, stalled,
                                 pending_paths — 0 bo'lishi kerak)

Tarkibi:
    router      APIRouter(prefix="/admin", tags=["admin"])

Ishlatadi: camera.media (sync, reconciler), camera.monitoring (health,
    snapshots), database (nodes, database_size), core.version, core.log.
Kim ishlatadi: app/factory.py (key_guard bilan ulanadi);
    scripts/watch_camera.py (/admin/runtime), scripts/acceptance_test.py
    va tests/test_api.py (/admin/status).
"""
from fastapi import APIRouter, Depends

from app import system_state
from camera.media import reconciler
from camera.media import sync as mediamtx_sync
from camera.monitoring import health
from core.version import VERSION
from database import (
    get_db,
)
from database import nodes as nodes_db
from database.connection import database_size
from users.access import require_admin

# Prefiks nisbiy — create_app uni /api/v1 (asosiy) va /api (eski) ostida ulaydi.
router = APIRouter(prefix="/admin", tags=["admin"],
                   dependencies=[Depends(require_admin)])


@router.get("/runtime")
def admin_runtime():
    """Faol yo'llarning jonli xaritasi: slug -> ready/readers/baytlar.

    Servis konsoli shu orqali kamera kesimida kirish tezligini (ikki
    so'rov orasidagi bayt farqidan) va tomoshabinlar sonini chizadi.
    Faqat lokal tugun — uzoq tugunlar salomatligi /admin/nodes da.
    """
    paths = mediamtx_sync.list_active_paths()
    if paths is None:
        return {"mediamtx": False, "paths": {}}
    return {"mediamtx": True, "paths": {
        name: {
            "ready": bool(item.get("ready")),
            "readers": len(item.get("readers") or []),
            "bytes_received": int(item.get("bytesReceived") or 0),
            "bytes_sent": int(item.get("bytesSent") or 0),
            "warm": mediamtx_sync.is_warm(name),
        } for name, item in paths.items()
    }}


def _dir_size_mb(path, recursive: bool = False) -> tuple[float, int]:
    total, count = 0, 0
    try:
        for f in (path.rglob("*") if recursive else path.glob("*")):
            try:
                total += f.stat().st_size
                count += 1
            except OSError:
                pass
    except OSError:
        pass
    return round(total / 1_048_576, 1), count


@router.get("/status")
def admin_status():
    """Tizim salomatligi bir qarashda — 5000 kamerani ko'z bilan emas,
    raqam bilan kuzatish uchun: MediaMTX tirikmi, health sweep intervalga
    sig'ayaptimi, qaysi faol oqimlar muzlagan, tugunlar qay ahvolda."""
    with get_db() as db:
        node_rows = nodes_db.list_enabled(db)
        db_bytes = database_size(db)
    nodes = []
    for row in node_rows:
        runtime = mediamtx_sync.node_runtime(row["api_base"])
        stalled = reconciler.stalled_count(row["id"])
        nodes.append({
            "name": row["name"],
            "status": ("offline" if runtime is None else
                       "degraded" if stalled else "online"),
            "ready": runtime["ready"] if runtime else 0,
            "readers": runtime["readers"] if runtime else 0,
            "stalled": stalled,
            # 0 bo'lishi kerak. Noldan katta bo'lsa MediaMTX'da eski
            # versiyadan qolgan ortiqcha yo'llar bor va ular tozalanmoqda —
            # shu davrda kameralar sekinroq ochiladi (jurnalda ko'rsatma).
            "pending_paths": reconciler.pending_count(row["id"]),
        })
    from camera.monitoring import snapshots
    from core.log import LOG_DIR
    db_mb = round(db_bytes / 1_048_576, 1)
    log_mb, _ = _dir_size_mb(LOG_DIR, recursive=True)        # logs/ — hamma toifa va arxivlar
    snap_mb, snap_files = _dir_size_mb(snapshots.SNAP_DIR)
    used_pct, total_mb, free_mb = system_state.disk_usage()
    sweep = health.sweep_stats()
    return {
        "version": VERSION,
        # v3: yangilanish tekshiruvi hali yo'q — latest null.
        "update": {"current": VERSION, "latest": None},
        # `mediamtx` — v2 dagidek bool (mos kelish uchun); uptime alohida maydonda.
        "mediamtx": mediamtx_sync.api_available(),
        "mediamtx_uptime_s": reconciler.uptime_s(1),
        "health": sweep,
        # Kamera tarmog'i: oxirgi sweep'dagi muvaffaqiyatli TCP ulanishning o'rtacha vaqti.
        "network": {"latency_ms": sweep.get("latency_ms"), "checked": sweep.get("checked", 0),
                    "online": sweep.get("online", 0)},
        "disk": {"snapshots_mb": snap_mb, "snapshots_files": snap_files,
                 "db_mb": db_mb, "log_mb": log_mb,
                 # Ma'lumot katalogi joylashgan disk (suratlar, jurnal).
                 "used_pct": used_pct, "total_mb": total_mb, "free_mb": free_mb},
        "stalled": sorted(reconciler.stalled_paths()),
        "nodes": nodes,
    }
