"""Nigoh — kamera mikroservisiga (nigoh-servis) ulanish qatlami.

Butun kamera/media ishi (RTSP, MediaMTX, chiptalar, suratlar, probe/skan)
mikroservisda; bu tizim unga faqat HTTP orqali, `X-API-Key` bilan murojaat
qiladi. Shu modul — yagona chiqish nuqtasi: mijoz, xatolarni tarjima
qilish, kameralar keshi va dashboard uchun holat kuzatuvchisi.
"""
import threading
import time

import httpx
from fastapi import HTTPException, Response
from fastapi.responses import JSONResponse

from core import stats
from core.log import log

from .config import NIGOH_KEY, NIGOH_URL

# Bitta umumiy mijoz — ulanishlar qayta ishlatiladi (keep-alive).
_client = httpx.Client(
    base_url=NIGOH_URL,
    headers={"X-API-Key": NIGOH_KEY},
    timeout=httpx.Timeout(60.0, connect=10.0),
)


def request(method: str, path: str, **kwargs) -> httpx.Response:
    """Mikroservisga so'rov; tarmoq xatosi mijozga 502 bo'lib qaytadi."""
    try:
        return _client.request(method, path, **kwargs)
    except httpx.HTTPError as exc:
        raise HTTPException(502, "Kamera servisi javob bermayapti — "
                                 f"birozdan keyin urinib ko'ring ({type(exc).__name__})")


def _error_detail(r: httpx.Response) -> str:
    try:
        return str(r.json().get("detail", ""))[:300] or f"Kamera servisi xatosi ({r.status_code})"
    except ValueError:
        return f"Kamera servisi xatosi ({r.status_code})"


def proxy(method: str, path: str, params: dict | None = None,
          body=None) -> Response:
    """JSON endpointni to'g'ridan-to'g'ri uzatadi: status va tana o'zgarmaydi."""
    r = request(method, path, params=params, json=body)
    if r.status_code >= 400:
        raise HTTPException(r.status_code, _error_detail(r))
    if not r.content:
        return Response(status_code=r.status_code)
    return JSONResponse(r.json(), status_code=r.status_code)


def get_json(path: str, params: dict | None = None):
    """GET + JSON; 4xx/5xx mikroservis xatosi bilan ko'tariladi."""
    r = request("GET", path, params=params)
    if r.status_code >= 400:
        raise HTTPException(r.status_code, _error_detail(r))
    return r.json()


# ---------- kameralar keshi ----------
#
# Xarita ro'yxati va operator hudud tekshiruvi bir xil ma'lumotni ishlatadi.
# Qisqa kesh mikroservisni har marker bosilishida bezovta qilmaslik uchun.

_CACHE_TTL = 10.0
_cache_lock = threading.Lock()
_cache: tuple[float, list[dict]] = (0.0, [])


def cameras_cached(force: bool = False) -> list[dict]:
    """Mikroservisdagi barcha yoqilgan kameralar (10 s kesh)."""
    global _cache
    now = time.monotonic()
    with _cache_lock:
        if not force and _cache[0] > now:
            return _cache[1]
    data = get_json("/api/v1/cameras", params={"limit": 50000})
    cameras = data.get("cameras", [])
    with _cache_lock:
        _cache = (now + _CACHE_TTL, cameras)
    return cameras


def camera_or_404(camera_id: int | str) -> dict:
    """Keshdan bitta kamera — yo'q bo'lsa 404 (o'chirilganlar ko'rinmaydi)."""
    for cam in cameras_cached():
        if str(cam.get("id")) == str(camera_id):
            return cam
    raise HTTPException(404, "Kamera topilmadi")


def check_region(camera_id: int | str, regions: list[str] | None) -> dict:
    """Operator cheklovi: kamera ruxsat etilgan hududda bo'lsin."""
    cam = camera_or_404(camera_id)
    if regions is not None and cam.get("region") not in regions:
        raise HTTPException(403, "Bu kamerani ko'rishga ruxsat yo'q")
    return cam


# ---------- dashboard uchun holat kuzatuvchisi ----------
#
# Ilgari lokal health sweep yozib borardi; endi manba — mikroservisdagi
# `state`. Har daqiqada ro'yxat olinadi va tarix (stats_region/stats_event)
# avvalgidek yoziladi — dashboard o'zgarmaydi.

POLL_INTERVAL = 60.0
_started = False
_poll_lock = threading.Lock()
_last_poll: dict = {"at": "", "checked": 0, "online": 0, "duration_ms": 0}


def poll_stats() -> dict:
    """Oxirgi kuzatuv haqida qisqa ma'lumot (admin/status uchun)."""
    with _poll_lock:
        return dict(_last_poll)


def _poll_once() -> None:
    started = time.monotonic()
    cameras = cameras_cached(force=True)
    snapshot = []
    for cam in cameras:
        state = cam.get("state") or "unknown"
        if state in ("unknown", "disabled"):
            online = None                 # holati o'lchanmaydiganlar statistikaga kirmaydi
        else:
            online = state == "online"    # stalled/offline — ishlamayapti deb sanaladi
        snapshot.append({"id": cam["id"], "name": cam.get("name", ""),
                         "region": cam.get("region", ""), "online": online})
    stats.record_states(snapshot)
    from datetime import datetime, timezone
    with _poll_lock:
        _last_poll.update(
            at=datetime.now(timezone.utc).isoformat(),
            checked=len(snapshot),
            online=sum(1 for c in snapshot if c["online"]),
            duration_ms=int((time.monotonic() - started) * 1000),
        )


def _poll_loop() -> None:
    while True:
        try:
            _poll_once()
        except Exception as exc:          # kuzatuv hech qachon yiqilmasin
            log("nigoh", "poll_failed", level="error", error=str(exc))
        time.sleep(POLL_INTERVAL)


def start_poller() -> None:
    """Fon kuzatuvini ishga tushiradi (bir marta)."""
    global _started
    if _started:
        return
    _started = True
    threading.Thread(target=_poll_loop, daemon=True).start()
