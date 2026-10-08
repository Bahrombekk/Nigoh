"""Tizim bildirishnomalari generatori — holat o'zgarganda `system_alerts` ga bitta yozuv.

Health sikliga ilgak bo'lib ulanadi (app/bootstrap.py -> `health.add_hook`),
ya'ni health_interval_s (standart 60 s) da bir tekshiradi. Manba —
app/system_state.py (xuddi /system/state ko'rsatadigan holat).

Qoidalar:
  * yozuv faqat holat O'ZGARGANDA: muammo paydo bo'ldi (active=true) yoki
    o'tib ketdi (active=false, "success"). Oxirgi holat bazadan olinadi —
    server qayta ishga tushsa ham takror yozuv bo'lmaydi;
  * hech qachon ko'tarilmagan muammo uchun "tiklandi" yozilmaydi;
  * muammo ketma-ket RAISE_AFTER (2) tekshiruvda ko'rinsagina yoziladi —
    ishga tushishda MediaMTX bir necha soniya kech ko'tarilishi bildirishnoma
    bo'lmasin. Tiklanish darhol yoziladi.

Kalitlar:
    disk        ma'lumot diski >= 80 % band (>= 95 % — error); faqat
                system_state.DISK_MONITORING yoqiq bo'lsa (hozir o'chiq)
    mediamtx    media server javob bermayapti
    db_slow     baza sekin (SELECT 1 > 500 ms)
    network     birorta kamera qurilmasi javob bermayapti

Tarkibi:
    check(state=None)           bitta tekshiruv; state — system_state.collect() natijasi
                                (testlar beradi). Qaytadi: yozilgan kalitlar ro'yxati
    reset()                     xotiradagi ketma-ketlik hisobini tozalaydi (testlar)
    RAISE_AFTER, KEEP_DAYS

Ishlatadi: app.system_state, database (notifications, get_db), core.log.
Kim ishlatadi: app/bootstrap.py, tests/test_v3_notifications.py.
"""
from __future__ import annotations

import threading

from app import system_state
from core.log import log
from database import get_db, notifications

RAISE_AFTER = 2
KEEP_DAYS = 30

_streak: dict[str, int] = {}
_lock = threading.Lock()


def _conditions(state: dict) -> dict[str, tuple[bool, str, str, str]]:
    """kalit -> (muammo bormi, daraja, sarlavha, matn)."""
    m = state.get("metrics", {})
    out = {}
    pct = m.get("disk_pct")
    if pct is not None and system_state.DISK_MONITORING:
        sev = "error" if pct >= system_state.DISK_ERROR_PCT else "warning"
        out["disk"] = (pct >= system_state.DISK_WARN_PCT, sev, f"Disk {pct:.0f}% band",
                       "Suratlar va jurnallar uchun joy kam qolmoqda")
    out["mediamtx"] = (not m.get("mediamtx", True), "error", "MediaMTX ishlamayapti",
                       "Jonli oqimlar ochilmaydi; server uni qayta ishga tushirishga urinmoqda")
    db_ms = m.get("db_ms")
    out["db_slow"] = (db_ms is None or db_ms > system_state.DB_SLOW_MS, "warning",
                      "Baza sekin javob bermoqda",
                      "Javob berish vaqti: " + ("—" if db_ms is None else f"{db_ms:.0f} ms"))
    checked, online = m.get("checked") or 0, m.get("online") or 0
    out["network"] = (bool(checked) and not online, "error", "Kamera tarmogʻi javob bermayapti",
                      f"{checked} ta qurilmadan birortasi javob bermadi")
    return out


_CLEARED = {
    "disk": ("Diskda joy yetarli", "Disk bandligi meʼyorga qaytdi"),
    "mediamtx": ("MediaMTX qayta ishlayapti", "Jonli oqimlar yana ochiladi"),
    "db_slow": ("Baza tezligi tiklandi", "Baza meʼyorida javob bermoqda"),
    "network": ("Kamera tarmogʻi tiklandi", "Qurilmalar yana javob bermoqda"),
}


def check(state: dict | None = None) -> list[str]:
    """Bitta tekshiruv; o'zgargan holatlarni yozadi."""
    state = state if state is not None else system_state.collect(fresh=True)
    conds = _conditions(state)
    written = []
    with get_db() as db:
        last = notifications.alert_states(db)
        for key, (active, severity, title, text) in conds.items():
            with _lock:
                _streak[key] = _streak.get(key, 0) + 1 if active else 0
                streak = _streak[key]
            was = last.get(key, False)
            if active and not was and streak >= RAISE_AFTER:
                notifications.add_alert(db, key, True, severity, title, text)
                written.append(key)
            elif not active and was:
                ok_title, ok_text = _CLEARED[key]
                notifications.add_alert(db, key, False, "success", ok_title, ok_text)
                written.append(key)
        notifications.prune(db, KEEP_DAYS)
    if written:
        log("app", "system_alerts", keys=written)
    return written


def reset() -> None:
    with _lock:
        _streak.clear()
