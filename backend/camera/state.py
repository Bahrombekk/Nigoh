"""Kameraning yagona holati va `ref` bo'yicha qidiruv.

Holat bir necha mustaqil kuzatuvdan yig'iladi: admin bayrog'i, IP bor-yo'qligi,
reconciler'ning bayt hisobi (muzlash) va health'ning TCP tekshiruvi.
Hamma iste'molchi (xarita, status, SSE boshlang'ich holati, statistika)
bitta qoidani ishlatsin deb hisob shu yerda.

Tarkibi:
    camera_state(row)   disabled / unknown / offline / stalled / online;
                        faqat tomosha qilinadigan oqimlar (asosiy va _h264)
                        muzlashi `stalled` qiladi — sub oqim hisobga olinmaydi
    resolve_ref(db, ref)  '123' — ichki id, 'ext:...' — tashqi id; topilmasa None

Ishlatadi: camera.media.reconciler, camera.media.sync, camera.monitoring.health,
database.cameras
Kim ishlatadi: camera.api (cameras, streams, admin, devices), camera.views,
stats (api, overview, recorder, admin_api)
"""
from camera.media import reconciler
from camera.media import sync as mediamtx_sync
from camera.monitoring import health
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


def camera_state(row) -> str:
    """Kameraning yagona holati — sochilgan kuzatuvlar bitta maydonda.

    disabled — admin o'chirib qo'ygan;
    unknown  — IP'siz (tayyor oqim) yoki hali tekshirilmagan;
    offline  — tarmoqdan javob yo'q (TCP tekshiruv);
    stalled  — port ochiq, lekin faol oqimga bayt kelmayapti (reconciler);
    online   — hammasi joyida.
    """
    if not row["enabled"]:
        return "disabled"
    if not row["ip"]:
        return "unknown"
    slug = row["slug"] or ""
    # Faqat TOMOSHA qilinadigan oqimlar kamerani "muzlagan" qiladi: asosiy
    # (slug) va H.264 o'girish (_h264). SUB oqim ALOHIDA — u faqat devor
    # kataklari uchun; sub muzlasa (masalan kameraning 2-oqimi yo'q/beqaror)
    # asosiy oqim ishlab turgani holda butun kamera muammoli ko'rinmasin.
    # Sub holatini devorning o'z tayyorlik tekshiruvi hal qiladi.
    variants = {slug, slug + mediamtx_sync.TRANSCODE_SUFFIX}
    for display in reconciler.stalled_paths():
        if display.split("@", 1)[0] in variants:
            return "stalled"
    alive = health.online(row["ip"], row["port"])
    if alive is None:
        return "unknown"
    return "online" if alive else "offline"
