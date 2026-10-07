"""Kameraning yagona holati va `ref` bo'yicha qidiruv.

Holat bir necha mustaqil kuzatuvdan yig'iladi: admin bayrog'i, IP bor-yo'qligi,
health'ning TCP tekshiruvi, reconciler'ning bayt hisobi (ochiq oqim muzlashi),
surat xizmati (tasvir haqiqatan olinyaptimi) va pasport tekshiruvi (parol/oqim
xatosi). Hamma iste'molchi (xarita, status, SSE, statistika, dashboard)
bitta qoidani ishlatsin deb hisob shu yerda.

Holatlar:
    disabled  admin o'chirib qo'ygan — foizlarga kirmaydi;
    unknown   IP yo'q (tayyor oqim) yoki server hali tekshirmagan (ishga
              tushgandan keyingi birinchi daqiqa);
    offline   tarmoqdan javob yo'q (RTSP porti yopiq);
    stalled   "tasvirsiz": port ochiq, lekin tasvir olinmayapti —
                * ochiq oqimga bayt kelmayapti (reconciler, 20 s);
                * pasport tekshiruvi parol/oqim xatosini topgan;
                * surat xizmati max_age (~30 daq) dan beri birorta kadr
                  ololmagan — kamera shuncha vaqtdan beri onlayn bo'lsa
                  (uzilishdan yangi qaytgan kamerada eski surat soxta signal
                  bermasin);
    online    port ochiq va tasvir bor.

2026-10-07 gacha `stalled` faqat ochiq oqim muzlaganda chiqardi — oqimlar
talab bo'yicha ochilgani uchun u deyarli doim 0 edi, paroli xato yoki
tasvir bermaydigan kameralar "onlayn · video kelyapti" deb sanalardi.

Tarkibi:
    camera_state(row)           holat (yuqoridagi besh qiymatdan biri)
    camera_state_reason(row)    (holat, sabab) — sabab faqat stalled/unknown uchun
    resolve_ref(db, ref)        '123' — ichki id, 'ext:...' — tashqi id; topilmasa None

Ishlatadi: camera.media.reconciler, camera.media.sync, camera.monitoring
(health, snapshots), database.cameras
Kim ishlatadi: camera.api (cameras, streams, admin, devices), camera.views,
stats (api, overview, recorder, admin_api)
"""
from datetime import datetime, timezone

from camera.media import reconciler
from camera.media import sync as mediamtx_sync
from camera.monitoring import health, snapshots
from database import cameras


def resolve_ref(db, ref: str):
    """Kamera qatori `ref` bo'yicha: '123' — ichki id, 'ext:...' — tashqi id.

    Asosiy tizim o'z identifikatori bilan murojaat qila oladi — mapping
    jadval yuritish shart emas. Topilmasa None.
    """
    ref = (ref or "").strip()
    if ref.startswith("ext:"):
        return cameras.get_by_external_id(db, ref[4:])
    if ref.isdigit():
        return cameras.get(db, int(ref))
    return None


# Pasport xatosining bosqichi: "tarmoq" — kamera o'sha paytda javob bermagan
# (hozir onlayn bo'lsa eskirgan xabar), qolganlari — tasvir olinmasligi sababi.
_NETWORK_STAGES = ("tarmoq",)


def _field(row, key):
    try:
        return row[key]
    except (KeyError, IndexError):
        return None


def _minutes(seconds: float) -> str:
    m = int(seconds // 60)
    return f"{m} daqiqa" if m < 120 else f"{m // 60} soat"


def camera_state_reason(row) -> tuple[str, str]:
    """(holat, sabab). Sabab — operatorga tushunarli qisqa izoh (bo'sh bo'lishi mumkin)."""
    if not row["enabled"]:
        return "disabled", "administrator o'chirgan"
    if not row["ip"]:
        return "unknown", "IP manzil yo'q (tashqi oqim)"
    slug = row["slug"] or ""
    # Faqat TOMOSHA qilinadigan oqimlar kamerani "muzlagan" qiladi: asosiy
    # (slug) va H.264 o'girish (_h264). SUB oqim ALOHIDA — u faqat devor
    # kataklari uchun; sub muzlasa asosiy oqim ishlab turgani holda butun
    # kamera muammoli ko'rinmasin.
    variants = {slug, slug + mediamtx_sync.TRANSCODE_SUFFIX}
    alive = health.online(row["ip"], row["port"])
    if alive is None:
        return "unknown", "server hali tekshirmagan"
    if not alive:
        return "offline", "tarmoqdan javob yo'q"
    for display in reconciler.stalled_paths():
        if display.split("@", 1)[0] in variants:
            return "stalled", "ochiq oqimga tasvir kelmayapti"
    error = _field(row, "probe_error")
    if error:
        stage = error.split(":", 1)[0].strip()
        if stage not in _NETWORK_STAGES:
            return "stalled", ("parol noto'g'ri" if stage == "parol"
                               else error.split(":", 1)[-1].strip()[:80] or stage)
    # Surat — tasvir haqiqatan olinyaptimi. Faqat kamera max_age dan uzoqroq
    # onlayn bo'lsa: yangi qaytgan kameraning eski surati soxta signal bermasin.
    online_for = health.online_for(row["ip"], row["port"])
    if online_for is not None:
        max_age = snapshots.max_age()
        if online_for > max_age:
            at = _field(row, "snapshot_at")
            if isinstance(at, str):
                try:
                    at = datetime.fromisoformat(at)
                except ValueError:
                    at = None
            if at is None:
                return "stalled", "hali birorta kadr olinmagan"
            age = (datetime.now(timezone.utc) - at).total_seconds()
            if age > max_age:
                return "stalled", _minutes(age) + "dan beri kadr olinmayapti"
    return "online", ""


def camera_state(row) -> str:
    """Kameraning yagona holati: disabled / unknown / offline / stalled / online."""
    return camera_state_reason(row)[0]
