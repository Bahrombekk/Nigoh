"""Tizim holati bir qarashda: xizmatlar (API, baza, MediaMTX, health, disk, tarmoq).

Uch iste'molchi bitta hisobni ishlatadi:

  * `GET /system/state` (app/public_api.py) — hamma uchun, mehmon ham
    (public_view yoqiq bo'lsa): ichki manzil, IP, fayl yo'li BERILMAYDI;
  * `GET /admin/status` (app/system_api.py) — disk foizi, tarmoq kechikishi,
    MediaMTX uptime;
  * tizim bildirishnomalari (notifications/alerts.py) — holat o'zgarganda
    `system_alerts` ga bitta yozuv.

Natija STATE_TTL (5 s) keshlanadi: holat chipi har ochiq brauzerda tez-tez
so'raladi, har safar baza va MediaMTX'ga borish shart emas.

Qoidalar (har xizmat: ok | warn | error):
    api       so'rovga javob berayotgan bo'lsa — doim ok
    db        SELECT 1 vaqti: > DB_SLOW_MS — warn; xato — error
    mediamtx  lokal API javob bermasa — error (jonli oqim ochilmaydi)
    health    sweep hali bo'lmagan — warn; 3 intervaldan eski — error
    disk      ma'lumot katalogi diski: >= DISK_WARN_PCT — warn, >= DISK_ERROR_PCT — error
              (faqat DISK_MONITORING = True bo'lsa; hozir o'chiq)
    network   kamera tarmog'i: birorta manzil javob bermasa (tekshirilganlar > 0) —
              error; o'rtacha TCP vaqti > NET_SLOW_MS — warn
Umumiy holat: db yoki mediamtx error — "down"; boshqa warn/error — "degraded";
aks holda "ok".

Tarkibi:
    collect(fresh=False)        {"state", "label", "services", "checked_at", "metrics"}
                                metrics — ichki raqamlar (disk_pct, db_ms, latency_ms ...),
                                tashqariga faqat admin endpointlari beradi
    public_view(data)           metrics'siz, tashqariga beriladigan ko'rinish
    disk_usage()                (used_pct, total_mb, free_mb) ma'lumot katalogi diski
    clear_cache()               testlar uchun
    LABELS, DISK_WARN_PCT, DISK_ERROR_PCT, DB_SLOW_MS, NET_SLOW_MS, STATE_TTL

Ishlatadi: camera.media.sync (api_available), camera.monitoring.health
    (sweep_stats), app.settings (health_interval_s), core.paths (DATA_DIR), database.
Kim ishlatadi: app/public_api.py, app/system_api.py, notifications/alerts.py.
"""
from __future__ import annotations

import shutil
import threading
import time
from datetime import datetime, timezone

from app.settings import site_settings
from camera.media import sync as mediamtx_sync
from camera.monitoring import health
from core.paths import DATA_DIR
from database import get_db

# Disk nazorati hozircha o'chiq (2026-10-08, foydalanuvchi qarori): server
# diski boshqa ma'lumotlar bilan umumiy, uning bandligi Nigoh'ga bog'liq emas —
# doimiy "Qisman nosozlik" va bildirishnoma chalg'itadi. True qilinsa disk
# xizmati holatda, ogohlantirish esa bildirishnomalarda qaytadi.
DISK_MONITORING = False
DISK_WARN_PCT = 80
DISK_ERROR_PCT = 95
DB_SLOW_MS = 500
NET_SLOW_MS = 200
STATE_TTL = 5.0

LABELS = {"ok": "Tizim barqaror", "degraded": "Qisman nosozlik", "down": "Tizim ishlamayapti"}

_cache: dict = {"at": 0.0, "data": None}
_lock = threading.Lock()


def disk_usage() -> tuple[float | None, int | None, int | None]:
    """Ma'lumot katalogi (suratlar, jurnal) diski: (band %, jami MB, bo'sh MB)."""
    try:
        usage = shutil.disk_usage(DATA_DIR)
    except OSError:
        return None, None, None
    pct = round(100 * usage.used / usage.total, 1) if usage.total else None
    return pct, usage.total // 1_048_576, usage.free // 1_048_576


def _db_ms() -> float | None:
    started = time.perf_counter()
    try:
        with get_db() as db:
            db.execute("SELECT 1").fetchone()
    except Exception:                       # noqa: BLE001 — baza yo'q: holat "error"
        return None
    return round((time.perf_counter() - started) * 1000, 1)


def _service(key: str, name: str, state: str, detail: str) -> dict:
    return {"key": key, "name": name, "state": state, "detail": detail}


def _compute() -> dict:
    services = [_service("api", "API", "ok", "Soʻrovlarga javob bermoqda")]

    db_ms = _db_ms()
    if db_ms is None:
        services.append(_service("db", "Maʼlumotlar bazasi", "error", "Javob bermayapti"))
    else:
        services.append(_service("db", "Maʼlumotlar bazasi",
                                 "warn" if db_ms > DB_SLOW_MS else "ok",
                                 f"Sekin: {db_ms:.0f} ms" if db_ms > DB_SLOW_MS
                                 else f"{db_ms:.0f} ms"))

    mtx = mediamtx_sync.api_available()
    services.append(_service("mediamtx", "Video server", "ok" if mtx else "error",
                             "Ishlamoqda" if mtx else "Ishlamayapti — jonli oqim ochilmaydi"))

    sweep = health.sweep_stats()
    interval = site_settings.get("health_interval_s")
    at = sweep.get("at") or ""
    age = None
    if at:
        try:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(at)).total_seconds()
        except ValueError:
            age = None
    if age is None:
        services.append(_service("health", "Holat tekshiruvi", "warn", "Hali tekshirilmagan"))
    elif age > 3 * interval + 60:
        services.append(_service("health", "Holat tekshiruvi", "error",
                                 f"Toʻxtab qolgan ({int(age // 60)} daqiqa oldin)"))
    else:
        services.append(_service("health", "Holat tekshiruvi", "ok",
                                 f"{sweep.get('online', 0)}/{sweep.get('checked', 0)} "
                                 f"qurilma javob berdi"))

    disk_pct, disk_total, disk_free = disk_usage() if DISK_MONITORING else (None, None, None)
    if not DISK_MONITORING:
        pass
    elif disk_pct is None:
        services.append(_service("disk", "Disk", "warn", "Oʻlchab boʻlmadi"))
    else:
        state = ("error" if disk_pct >= DISK_ERROR_PCT else
                 "warn" if disk_pct >= DISK_WARN_PCT else "ok")
        services.append(_service("disk", "Disk", state, f"{disk_pct:.0f}% band"))

    checked, online = sweep.get("checked", 0), sweep.get("online", 0)
    latency = sweep.get("latency_ms")
    if checked and not online:
        services.append(_service("network", "Kamera tarmogʻi", "error",
                                 "Birorta qurilma javob bermayapti"))
    elif latency is not None and latency > NET_SLOW_MS:
        services.append(_service("network", "Kamera tarmogʻi", "warn",
                                 f"Sekin: {latency:.0f} ms"))
    else:
        services.append(_service("network", "Kamera tarmogʻi", "ok",
                                 f"{latency:.0f} ms" if latency is not None else "Ishlamoqda"))

    by_key = {s["key"]: s["state"] for s in services}
    if "error" in (by_key["db"], by_key["mediamtx"]):
        overall = "down"
    elif any(s["state"] != "ok" for s in services):
        overall = "degraded"
    else:
        overall = "ok"
    return {
        "state": overall, "label": LABELS[overall], "services": services,
        "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "metrics": {"db_ms": db_ms, "mediamtx": mtx, "disk_pct": disk_pct,
                    "disk_total_mb": disk_total, "disk_free_mb": disk_free,
                    "latency_ms": latency, "checked": checked, "online": online,
                    "health_age_s": None if age is None else int(age)},
    }


def collect(fresh: bool = False) -> dict:
    """Tizim holati (STATE_TTL keshdan yoki yangidan)."""
    now = time.monotonic()
    with _lock:
        if not fresh and _cache["data"] is not None and now - _cache["at"] < STATE_TTL:
            return _cache["data"]
    data = _compute()
    with _lock:
        _cache["at"], _cache["data"] = now, data
    return data


def public_view(data: dict) -> dict:
    """Tashqariga beriladigan ko'rinish — ichki raqamlar (metrics) yo'q."""
    return {k: data[k] for k in ("state", "label", "services", "checked_at")}


def clear_cache() -> None:
    with _lock:
        _cache["at"], _cache["data"] = 0.0, None
