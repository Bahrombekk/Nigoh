"""Pleyer ochilish vaqti: mijoz o'lchaydi, server yig'adi.

Ochilishning haqiqiy vaqtini faqat brauzer biladi — server "manzilni
berdim" degan joyda to'xtaydi, foydalanuvchi esa birinchi kadrni kutadi.
Shuning uchun pleyer to'rt nuqtani o'lchab shu yerga yuboradi, server
esa /health da p50/p95 qilib ko'rsatadi. Bosqichlarning ma'nosi
camera/monitoring/open_times.py da.

Tarkibi:
    OpenIn          bitta ochilish: camera_id, mode, transport,
                    stream_ms / signal_ms / frame_ms / total_ms
    TRANSPORTS      webrtc / hls / hls_fallback — boshqasi "boshqa" qopiga;
                    hls_fallback alohida, chunki uning vaqtiga muvaffaqiyatsiz
                    WebRTC urinishi ham qo'shilgan

Endpointlar (require_viewer):
    POST /api/v1/metrics/open     o'lchovni yozadi, javob 204
    GET  /api/v1/metrics/open     kamera kesimi: eng sekin ochiladiganlar
                                  (median bo'yicha), umumiy p50/p95; operator —
                                  faqat o'z hududlari

Ishlatadi: camera.monitoring.open_times, database (cameras), users.access
Kim ishlatadi: app/factory.py (router); frontend pleyeri (POST),
    dashboard "Ochilish vaqti" kartasi (GET)
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Query, Request, Response
from pydantic import BaseModel, Field

from camera.monitoring import open_times as metrics
from database import cameras, get_db
from users.access import allowed_areas

# Prefiks nisbiy — create_app uni /api/v1 (asosiy) va /api (eski) ostida ulaydi.
router = APIRouter(prefix="/metrics", tags=["metrics"])

# hls_fallback — WebRTC urinib ko'rilib, yiqilgandan keyingi HLS. Uning
# kutish vaqtiga muvaffaqiyatsiz urinish ham qo'shilgan, shuning uchun
# toza HLS bilan bitta qopga solinmaydi.
TRANSPORTS = ("webrtc", "hls", "hls_fallback")


class OpenIn(BaseModel):
    """Bitta ochilishning bosqichma-bosqich vaqti (millisekund)."""
    camera_id: int | None = None
    mode: str = Field(default="", max_length=20)       # raw/direct/sub/transcode
    transport: str = Field(default="", max_length=20)  # webrtc | hls
    stream_ms: int = Field(default=0, ge=0, le=600_000)
    signal_ms: int = Field(default=0, ge=0, le=600_000)
    frame_ms: int = Field(default=0, ge=0, le=600_000)
    total_ms: int = Field(default=0, ge=0, le=600_000)


@router.post("/open", status_code=204)
def report_open(body: OpenIn):
    """Pleyer ochilishni o'lchab yuboradi. Javob yo'q — 204.

    Natija: `GET /health` -> `open_ms`. Qaysi bosqich sekinligiga qarab
    qayerni tuzatish kerakligi ko'rinadi (camera/monitoring/open_times.py izohiga qarang).
    """
    transport = body.transport if body.transport in TRANSPORTS else "boshqa"
    metrics.record(transport, body.model_dump())
    return Response(status_code=204)


@router.get("/open")
def open_times(request: Request, limit: int = Query(default=8, ge=1, le=200)):
    """Kamera kesimida ochilish vaqti — barcha foydalanuvchilar va devorlar
    bo'yicha, server ishga tushganidan beri. Sekinlari (median) birinchi."""
    data = metrics.by_camera()
    allowed = allowed_areas(request)
    with get_db() as db:
        rows = {r["id"]: r for r in cameras.list_all(db) if r["id"] in data}
    items = []
    for cid, m in data.items():
        row = rows.get(cid)
        if row is None or (allowed is not None and row["admin_area_id"] not in allowed):
            continue
        items.append({"camera_id": cid, "name": row["name"], "region": row["region"],
                      **m, "at": datetime.fromtimestamp(m["at"], timezone.utc)})
    items.sort(key=lambda x: -x["median_ms"])
    medians = sorted(x["median_ms"] for x in items)
    return {"cameras": len(items), "opens": sum(x["n"] for x in items),
            "p50_ms": metrics.percentile(medians, 0.5) if medians else None,
            "p95_ms": metrics.percentile(medians, 0.95) if medians else None,
            "items": items[:limit]}
