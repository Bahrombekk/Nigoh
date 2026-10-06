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

Ishlatadi: camera.monitoring.open_times
Kim ishlatadi: app/factory.py (router); frontend pleyeri
"""
from fastapi import APIRouter, Response
from pydantic import BaseModel, Field

from camera.monitoring import open_times as metrics

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
