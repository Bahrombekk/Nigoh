"""Nigoh — MediaMTX'ni tirik tutuvchi fon vazifasi (media paketi).

Har 30 soniyada ikki ish qilinadi:

  1. MediaMTX yiqilgan bo'lsa — qayta ishga tushiriladi (faqat lokalda:
     API manzili boshqa mashinaga ko'rsatsa, u yerdagi jarayonga aralasha
     olmaymiz). `MEDIAMTX_AUTOSTART=0` bilan butunlay o'chiriladi.

  2. Yo'llar kerakli holat bilan kelishtiriladi (`push_to_api`). MediaMTX
     qayta ishga tushganda API orqali qo'shilgan yo'llar yo'qoladi — shu
     yerda o'z-o'zidan tiklanadi. Farq bo'lmasa hech narsa yuborilmaydi,
     ya'ni tinch holatda bu bir necha o'n millisekundlik tekshiruv xolos.

  3. Faol oqimlarning bayt hisobi kuzatiladi — ikki tekshiruv orasida
     qo'zg'almagan tayyor oqim "muzlagan" deb belgilanadi (hodisa + alert).

Natijada qo'lda aralashish kerak emas: kamera qo'shildi/o'chirildi yoki
MediaMTX yiqildi — 30 soniya ichida tizim o'zini kerakli holatga keltiradi.
"""
import os
import subprocess
import threading
import time
from typing import Callable

from core import alerts, events
from core.db import get_db

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

_prev_bytes: dict[str, int] = {}   # yo'l -> oxirgi ko'rilgan bytesReceived
_stalled: set[str] = set()         # hozir muzlab turgan yo'llar


def stalled_paths() -> set[str]:
    """Ayni damda muzlagan (bayt kelmayotgan) faol yo'llar."""
    with _lock:
        return set(_stalled)


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
    try:
        with get_db() as db:
            events.add(db, "mediamtx", detail="MediaMTX qayta ishga tushirildi")
    except Exception:
        pass
    alerts.send_async("⚠️ MediaMTX yiqilgan edi — qayta ishga tushirildi")
    # API ko'tarilishini qisqa kutamiz — yo'llar shu tickning o'zida tiklansin.
    deadline = time.monotonic() + STARTUP_WAIT
    while time.monotonic() < deadline:
        if sync.api_available():
            return True
        time.sleep(0.5)
    return False


def _check_stalls() -> None:
    """Faol oqimlarning bayt hisobi ikki tick orasida qo'zg'almasa — muzlagan.

    TCP tekshiruv (health) buni ko'rmaydi: registrator portga javob
    beraveradi, lekin kanal tasvir bermay qolishi mumkin. bytesReceived
    esa yolg'on gapirmaydi — 30 soniyada bitta bayt ham kelmagan tayyor
    oqim aniq muzlagan.
    """
    active = sync.list_active_paths()
    if active is None:
        return
    changes: list[tuple[str, str]] = []
    with _lock:
        for name, item in active.items():
            if not item.get("ready"):
                continue                      # hali ulanmagan — muzlash emas
            got = int(item.get("bytesReceived") or 0)
            prev = _prev_bytes.get(name)
            if prev is not None and got == prev:
                if name not in _stalled:
                    _stalled.add(name)
                    changes.append((name, "stalled"))
            elif name in _stalled:
                _stalled.discard(name)
                changes.append((name, "resumed"))
        for name in list(_stalled):
            if name not in active:            # oqim yopildi — muzlash tugadi
                _stalled.discard(name)
        _prev_bytes.clear()
        _prev_bytes.update(
            {n: int(i.get("bytesReceived") or 0) for n, i in active.items()})
    if not changes:
        return
    with get_db() as db:
        for name, kind in changes:
            events.add(db, kind, slug=name,
                       detail="oqim muzladi" if kind == "stalled" else "oqim tiklandi")
    alerts.send_async("\n".join(
        f"{'🧊 muzladi' if kind == 'stalled' else '🟢 tiklandi'}: {name}"
        for name, kind in changes))


def _tick(load_cameras: Callable[[], list[dict]], announce: bool) -> bool:
    """Bitta tekshiruv. Sinxronlash bajarilgan bo'lsa True qaytaradi."""
    if not sync.api_available():
        if not (_autostart_allowed() and _spawn()):
            return False
    result = sync.push_to_api(load_cameras())
    changed = result["added"] + result["updated"] + result["removed"]
    if announce or changed or not result["ok"]:
        print(f"MediaMTX: {result['message']}", flush=True)
    _check_stalls()
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
