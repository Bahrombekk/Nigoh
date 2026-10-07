"""Kamera pasportini fonda to'ldirish: kodek, o'lcham, kadr tezligi, model.

Muammo (2026-10-06): bu ma'lumotlar faqat kamera QO'SHILGAN lahzada bir
marta so'ralardi. O'sha paytda kamera javob bermasa (VPN uzilgan, kamera
qayta yuklanayotgan) maydonlar abadiy bo'sh qolardi — 157 kameradan
21 tasida kodek, 40 tasida model yo'q edi, ularning 20 dan ortig'i esa
aslida ishlab turgan. Sabab ham yozilmasdi: "parol noto'g'ri" bilan
"vaqtincha javob bermadi" bir xil ko'rinardi.

Endi:
  * format (o'lcham) ham: 149 kamerada bo'sh edi — u faqat SDP'dagi
    `x-dimensions` qatoridan olinardi (faqat Hikvision beradi). Endi SPS'dan
    ham hisoblanadi (rtsp_probe.sps_resolution); SPS bermaydigan kameralarda
    (Holowits H.265) kamera ochilganda MediaMTX'dan olinadi (reconciler);
  * har `INTERVAL` da kodeki, formati yoki modeli yo'q kameralardan bir nechtasi
    qayta tekshiriladi — faqat hozir onlayn bo'lganlari (o'chiq kameraga
    urinish behuda);
  * natija bazaga yoziladi: `camera_status.probe_at` va `probe_error`
    (muvaffaqiyatda NULL) — sabab /stats/quality da ko'rinadi;
  * muvaffaqiyatsiz kamera `RETRY_AFTER` dan keyin qayta urinadi (restartdan
    keyin ham — vaqt bazada);
  * topilgan qiymat faqat bo'sh maydonga yoziladi; `transcode` bayrog'iga
    tegilmaydi (u MediaMTX yo'lini o'zgartiradi — buni admin hal qiladi);
  * vendor model bilan mos kelmasa faqat ogohlantiriladi, almashtirilmaydi:
    vendor RTSP yo'lini ham belgilaydi, noto'g'ri almashtirish ishlab
    turgan oqimni buzadi.

Tarkibi:
    PassportChecker             fon tekshiruvchisi
        .check(row)             bitta kamera: so'raydi, bazaga yozadi,
                                {id, codec, model, error} qaytaradi
        .run_once(limit, only_online)  bitta tsikl (skript va testlar uchun)
        .start()                fon thread'i (FIRST_DELAY dan keyin, har INTERVAL)
    service                     yagona nusxa; check / run_once / start — aliaslar
    INTERVAL, FIRST_DELAY, RETRY_AFTER, BATCH, WORKERS   sozlamalar

Ishlatadi: camera.probe (rtsp_probe, device_info), camera.monitoring.health,
core (security, log), database.cameras
Kim ishlatadi: app/bootstrap.py (start), database/scripts/fix_camera_data.py,
testlar
"""
from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor

from camera.monitoring import health
from camera.probe import device_info
from camera.probe.rtsp_probe import probe
from core import security
from core.log import log
from database import cameras, get_db

INTERVAL = 600.0            # tsikl oralig'i
FIRST_DELAY = 120.0         # ishga tushgach: health birinchi sweep'ni tugatsin
RETRY_AFTER = 6 * 3600      # muvaffaqiyatsiz kamerani qayta tekshirish
BATCH = 16                  # bir tsiklda ko'pi bilan
WORKERS = 4                 # parallel: registratorlarni bo'g'masin


class PassportChecker:
    """Kodek/model bo'sh kameralarni fonda qayta tekshiradi va natijani bazaga yozadi."""

    def __init__(self) -> None:
        self._started = False

    def check(self, row) -> dict:
        """Bitta kamera: bo'sh maydonlarni so'raydi va natijani bazaga yozadi.

        Qaytaradi: {"id", "codec", "model", "error"} — skript va testlar uchun.
        """
        password = security.decrypt(row["password_enc"])
        result = {"id": row["id"], "codec": "", "model": "", "error": None}
        # Format (o'lcham) ham shu DESCRIBE'dan chiqadi: SDP qatori yoki SPS.
        if row["codec"] is None or row["resolution"] is None:
            p = probe(row["ip"], row["port"] or 554, row["rtsp_path"] or "",
                      row["username"] or "", password)
            if p.get("ok"):
                result["codec"] = p.get("codec", "")
                resolution, fps = p.get("resolution", ""), float(p.get("fps") or 0.0)
            else:
                result["error"] = f"{p.get('stage', 'xato')}: {p.get('message', '')}".strip()
                resolution, fps = "", 0.0
        else:
            resolution, fps = "", 0.0
        if row["model"] is None:
            info = device_info.device_info(row["ip"], row["username"] or "", password)
            if info and (info.get("model") or info.get("firmware")):
                result["model"] = info.get("model") or ""
                with get_db() as db:
                    cameras.set_passport(db, [row["id"]], info.get("model") or "",
                                         info.get("firmware") or "")
        with get_db() as db:
            cameras.set_probe_result(db, row["id"], codec=result["codec"],
                                     resolution=resolution, fps=fps, error=result["error"])
        vendor = cameras.vendor_for_model(result["model"] or row["model"])
        if vendor and vendor != row["vendor"]:
            # Avtomatik almashtirilmaydi: ishlab chiqaruvchi RTSP yo'lini ham
            # belgilaydi, noto'g'ri almashtirish ishlab turgan oqimni buzadi.
            log("passport", "vendor_mismatch", level="warning", camera_id=row["id"],
                stored=row["vendor"], model=result["model"] or row["model"], expected=vendor)
        return result

    def run_once(self, limit: int = BATCH, only_online: bool = True) -> list[dict]:
        with get_db() as db:
            rows = cameras.passport_candidates(db, RETRY_AFTER, limit * 4)
        if only_online:
            rows = [r for r in rows if health.online(r["ip"], r["port"] or 554) is True]
        rows = rows[:limit]
        if not rows:
            return []
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            results = list(pool.map(self.check, rows))
        log("passport", "cycle", checked=len(results),
            filled=sum(1 for r in results if r["codec"] or r["model"]),
            failed=sum(1 for r in results if r["error"]))
        return results

    def _loop(self) -> None:
        time.sleep(FIRST_DELAY)
        while True:
            try:
                self.run_once()
            except Exception as exc:               # fon vazifa yiqilmasin
                log("passport", "cycle_failed", level="error", error=str(exc))
            time.sleep(INTERVAL)

    def start(self) -> None:
        if self._started:
            return
        self._started = True
        threading.Thread(target=self._loop, name="passport", daemon=True).start()


# Yagona nusxa: jarayonda bitta xizmat ishlaydi.
service = PassportChecker()
check = service.check
run_once = service.run_once
start = service.start
