"""Nigoh — MediaMTX'ni tirik tutuvchi fon vazifasi (media paketi).

Har 30 soniyada ikki ish qilinadi:

  1. MediaMTX yiqilgan bo'lsa — qayta ishga tushiriladi (faqat lokalda:
     API manzili boshqa mashinaga ko'rsatsa, u yerdagi jarayonga aralasha
     olmaymiz). `MEDIAMTX_AUTOSTART=0` bilan butunlay o'chiriladi.

  2. Yo'llar kerakli holat bilan kelishtiriladi (`push_to_api`). MediaMTX
     qayta ishga tushganda API orqali qo'shilgan yo'llar yo'qoladi — shu
     yerda o'z-o'zidan tiklanadi. Farq bo'lmasa hech narsa yuborilmaydi,
     ya'ni tinch holatda bu bir necha o'n millisekundlik tekshiruv xolos.

Natijada qo'lda aralashish kerak emas: kamera qo'shildi/o'chirildi yoki
MediaMTX yiqildi — 30 soniya ichida tizim o'zini kerakli holatga keltiradi.
"""
import os
import subprocess
import threading
import time
from typing import Callable

from . import sync

CHECK_INTERVAL = 30.0      # soniya
SPAWN_COOLDOWN = 30.0      # qayta urinishlar orasidagi eng kam vaqt
STARTUP_WAIT = 8.0         # ishga tushirgandan keyin API'ni shuncha kutamiz

MEDIAMTX_EXE = sync.BASE_DIR / "mediamtx" / (
    "mediamtx.exe" if os.name == "nt" else "mediamtx")
LOG_PATH = sync.BASE_DIR / "mediamtx.log"

_started = False
_lock = threading.Lock()
_process: subprocess.Popen | None = None
_last_spawn = 0.0


def _autostart_allowed() -> bool:
    if os.environ.get("MEDIAMTX_AUTOSTART", "1") == "0":
        return False
    host = sync.API_BASE.split("//")[-1].split(":")[0]
    return host in ("127.0.0.1", "localhost") and MEDIAMTX_EXE.exists()


def _spawn() -> bool:
    """MediaMTX'ni ishga tushiradi; log ildizdagi mediamtx.log ga boradi."""
    global _process, _last_spawn
    now = time.monotonic()
    if now - _last_spawn < SPAWN_COOLDOWN:
        return False
    if _process is not None and _process.poll() is None:
        return False               # biz ochgan jarayon tirik — hali ko'tarilyapti
    _last_spawn = now
    try:
        log = open(LOG_PATH, "ab")
        _process = subprocess.Popen(
            [str(MEDIAMTX_EXE), str(sync.CONFIG_PATH)],
            cwd=str(sync.BASE_DIR),
            stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
        )
    except OSError as exc:
        print(f"MediaMTX'ni ishga tushirib bo'lmadi: {exc}", flush=True)
        return False
    print(f"MediaMTX qayta ishga tushirildi (log: {LOG_PATH.name})", flush=True)
    # API ko'tarilishini qisqa kutamiz — yo'llar shu tickning o'zida tiklansin.
    deadline = time.monotonic() + STARTUP_WAIT
    while time.monotonic() < deadline:
        if sync.api_available():
            return True
        time.sleep(0.5)
    return False


def _tick(load_cameras: Callable[[], list[dict]], announce: bool) -> bool:
    """Bitta tekshiruv. Sinxronlash bajarilgan bo'lsa True qaytaradi."""
    if not sync.api_available():
        if not (_autostart_allowed() and _spawn()):
            return False
    result = sync.push_to_api(load_cameras())
    changed = result["added"] + result["updated"] + result["removed"]
    if announce or changed or not result["ok"]:
        print(f"MediaMTX: {result['message']}", flush=True)
    return result["ok"]


def _loop(load_cameras: Callable[[], list[dict]]) -> None:
    announced = False              # birinchi muvaffaqiyatli sinxron logda ko'rinsin
    while True:
        try:
            if _tick(load_cameras, not announced):
                announced = True
        except Exception:          # kuzatuv hech qachon yiqilmasin
            pass
        time.sleep(CHECK_INTERVAL)


def start(load_cameras: Callable[[], list[dict]]) -> None:
    """Fon reconcilerini ishga tushiradi (bir marta).

    `load_cameras` — kameralarning MediaMTX ko'rinishini qaytaruvchi
    funksiya; uni app qatlami uzatadi (media qatlami bazaga o'zi murojaat
    qilmaydi — qatlamlar chegarasi buzilmasin).
    """
    global _started
    with _lock:
        if _started:
            return
        _started = True
    threading.Thread(target=_loop, args=(load_cameras,), daemon=True).start()
