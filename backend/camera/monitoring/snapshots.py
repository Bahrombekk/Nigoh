"""Kamera suratlarini diskda saqlash va pog'onali (issiq/sovuq) yangilash.

Suratlar bazada emas, diskda turadi (`{DATA_DIR}/snapshots/{slug}.jpg`) —
5000 ta 200 KB blob bazaga o'rinsiz yuk (SQLite davrida u bilan
portlardi, PostgreSQL'ni ham bekorga shishiradi), fayl tizimi esa aynan
shu ish uchun qilingan. Bazada faqat `snapshot_at` (oxirgi surat vaqti).

Yangilash pog'onalari (fon vazifasi, har TICK=10 s, parallellik 8):

  * issiq — oxirgi 5 daqiqada so'ralgan kamera: har 10 soniyada;
  * sovuq — qolganlar: kamera soniga moslashadigan oraliqda (kamida
    10 daqiqa — SNAP_INTERVAL bilan o'zgartiriladi, 5000 kamerada
    ~17 daqiqa), faqat tirik (online) bo'lsa;
  * o'chiq (disabled) yoki o'chib qolgan (offline): umuman yangilanmaydi.

Jadval FAZA bilan tarqatilgan: har kamera id'sidan hisoblangan barqaror
siljish oladi va absolyut vaqt oynasida o'z uyasida bir marta olinadi.
Shu tufayli:

  * birinchi ishga tushishda 5000 surat birdan so'ralmaydi;
  * restartdan keyin diskdagi yangi fayllar qayta olinmaydi (fayl yoshi
    oynaga sig'sa — bajarilgan hisoblanadi);
  * birga navbatga tushgan guruhlar shakllanmaydi — oyna "oxirgi
    yangilanish"ga emas, taqvimga bog'langan.

Urinish muvaffaqiyatsiz bo'lsa ham oyna bajarilgan deb belgilanadi —
buzuq kamera har tickda qayta urinilib registratorni bo'g'masin;
keyingi oynada o'zi qayta uriniladi. Zaxira klapan (BATCH_LIMIT) faqat
navbat haqiqatan to'lganda ishlaydi va issiqlar oldinda turadi.
So'rov paytidagi jonli olish LIVE_SLOTS (2) bilan chegaralangan — 64
katakli devor ochilganda API threadpool'ini yeb qo'ymasin. Yetim fayllar
(bazada yo'q slug) kuniga bir tekshiriladi, bir haftadan eskisi o'chiriladi.

Har muvaffaqiyatli yangilanish SSE'ga `snapshot` hodisasi bo'lib chiqadi.

Tarkibi:
    SnapshotService             surat xizmati
        .read(row, live)        (jpeg|None, etag, vaqt): disk, bo'lmasa jonli olish
        .store_frame(row, data) tayyor JPEG'ni saqlaydi (server yoki brauzer kadri)
        .capture(row)           kameradan surat olib saqlaydi (fast_start.snapshot)
        .note_request(id)       kamerani 5 daqiqaga issiq qiladi
        .max_age()              "yaroqli" yosh — sovuq oraliqning 3 baravari
        .cold_interval(total)   sovuq oraliq kamera soniga qarab
        .cycle_stats()          oxirgi tsikl: total, ok, duration_ms, at
        .path_for(slug)         surat fayli yo'li
        .start()                fon thread'i (bir marta)
    service                     yagona nusxa; yuqoridagi metodlar — aliaslar
    SNAP_DIR, TICK, HOT_WINDOW, HOT_INTERVAL, COLD_MIN_INTERVAL,
    COLD_PER_CAMERA, BATCH_LIMIT, WORKERS, LIVE_SLOTS, ORPHAN_KEEP   sozlamalar

Ishlatadi: camera.media.fast_start, camera.monitoring.health, core (bus,
security, log, paths), database.cameras
Kim ishlatadi: app/bootstrap.py (start), camera/api/cameras.py (read,
store_frame, max_age), app (health, system_api)
"""
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from camera.media import fast_start
from camera.monitoring import health
from core import bus, security
from core.log import log
from core.paths import DATA_DIR
from database import cameras, get_db

SNAP_DIR = DATA_DIR / "snapshots"

TICK = 10.0             # fon tsikli qadami (issiq interval bilan bir xil)
HOT_WINDOW = 300.0      # so'ralganidan keyin shuncha vaqt "issiq"
HOT_INTERVAL = 10.0
# Sovuq oraliq: hech kim so'ramayotgan kamera surati shu oraliqda bir
# yangilanadi. Surat "jonli" bo'lishi shart emas — standart 10 daqiqa,
# kerak bo'lsa SNAP_INTERVAL muhit o'zgaruvchisi bilan o'zgartiriladi.
COLD_MIN_INTERVAL = float(os.environ.get("SNAP_INTERVAL", "600"))
# Sovuq oraliq kamera soniga moslashadi: umumiy tezlik ~5 surat/soniyada
# ushlanadi. Registratorlar bo'g'ilsa 0,5 ga ko'taring.
COLD_PER_CAMERA = 0.2
# Qadam boshiga zaxira klapan — faza to'g'ri ishlasa tegilmaydi (5000
# kamerada cho'qqi ~71). Bir martalik ishga tushishi normal: tarmoq
# qaytganda yoki restartdan keyin uzilgan kameralar bir tickda navbatga
# tushadi va keyingi tick(lar)da tugaydi. Navbat CAPPED_WARN_TICKS
# ketma-ket tickda tugamasa — oraliq haqiqatan noto'g'ri (warning).
BATCH_LIMIT = 96
CAPPED_WARN_TICKS = 6
WORKERS = 8
# read() dagi jonli olish slotlari — 64 katakli devor birinchi ochilganda
# 64 FFmpeg API threadpool'ini yeb qo'ymasin. Bu himoya, tegmang.
LIVE_SLOTS = 2

# Yetim fayllar: kamera o'chirilganda {slug}.jpg qolib ketadi — kuniga
# bir tekshiriladi, bazada yo'q va bir haftadan eski fayl o'chiriladi.
# Bir hafta saqlash ataylab: o'chirish tasodifiy bo'lsa oxirgi kadr
# diagnostika uchun turadi.
CLEAN_EVERY = 86_400.0
ORPHAN_KEEP = 7 * 86_400.0


class SnapshotService:
    """Kamera suratlari: diskda saqlanadi, issiq/sovuq pog'onalarda yangilanadi."""

    def __init__(self) -> None:
        self._requested: dict[int, float] = {}   # camera_id -> oxirgi so'ralgan (monotonic)
        self._done: dict[int, float] = {}        # camera_id -> oxirgi urinish (epoch)
        self._last_total = 0                     # oxirgi tsikldagi kameralar soni
        self._capped_ticks = 0                   # klapan ketma-ket necha tick ishladi
        self._last_clean = 0.0
        self._cycle = {"total": 0, "ok": 0, "duration_ms": 0, "at": ""}
        self._lock = threading.Lock()
        self._started = False
        self._live_sem = threading.BoundedSemaphore(LIVE_SLOTS)

    def path_for(self, slug: str) -> Path:
        return SNAP_DIR / f"{slug}.jpg"

    def cold_interval(self, total: int) -> float:
        return max(COLD_MIN_INTERVAL, total * COLD_PER_CAMERA)

    def cycle_stats(self) -> dict:
        """Oxirgi tsikl haqida — /health va konsol 'Fon vazifalari' uchun."""
        with self._lock:
            return dict(self._cycle)

    def max_age(self) -> float:
        """Suratning "hali yaroqli" yoshi — sovuq oraliqning 3 baravari.

        Yumshoq chegara: asosiy ishni holat tekshiruvi qiladi, bu faqat
        "holat yolg'on gapiryapti" holatini ushlaydi. Issiq oraliqqa
        bog'lanmaydi — aks holda barcha sovuq kameralar "eskirgan" chiqadi.
        """
        with self._lock:
            total = self._last_total
        return 3 * self.cold_interval(total)

    def _offset(self, camera_id: int, interval: float) -> float:
        """Kameraning oraliq ichidagi barqaror siljishi — har restartda bir xil.

        Ketma-ket id'lar ham tekis tarqalsin deb oltin nisbat ko'paytmasi
        ishlatiladi.
        """
        return (camera_id * 2654435761) % max(1, int(interval))

    def _slot(self, camera_id: int, interval: float, now: float) -> float:
        """Kameraning joriy (allaqachon kelgan) uyasi — absolyut vaqtda."""
        off = self._offset(camera_id, interval)
        return ((now - off) // interval) * interval + off

    def note_request(self, camera_id: int) -> None:
        """Surat so'raldi — kamera 5 daqiqaga issiq pog'onaga o'tadi."""
        with self._lock:
            self._requested[camera_id] = time.monotonic()
            if len(self._requested) > 20_000:            # xotira chegarasi
                cutoff = time.monotonic() - HOT_WINDOW
                for key in [k for k, t in self._requested.items() if t < cutoff]:
                    self._requested.pop(key, None)

    def read(self, row, live: bool = True) -> tuple[bytes | None, str, float]:
        """Kameraning suratini beradi: avval disk, bo'lmasa jonli olish.

        Qaytaradi (bytes|None, etag, fayl_vaqti_epoch). So'rov issiqlik
        hisobiga yoziladi — keyingi yangilanishlar fon vazifasida boradi.

        Jonli olish semafor bilan chegaralangan (LIVE_SLOTS): slot bo'sh
        bo'lmasa darhol bo'sh qaytadi — 64 katak birdan ochilganda API
        muzlab qolmaydi, fon tsikli bir necha soniyada to'ldiradi.
        `live=False` — faqat disk (offline/stale holatlari uchun).
        """
        self.note_request(row["id"])
        p = self.path_for(row["slug"] or "")

        def _from_disk():
            stat = p.stat()
            return (p.read_bytes(),
                    f'"{int(stat.st_mtime)}-{stat.st_size}"', stat.st_mtime)

        try:
            return _from_disk()
        except OSError:
            pass
        if live and self._live_sem.acquire(blocking=False):
            try:
                captured = self.capture(row)
            finally:
                self._live_sem.release()
            if captured:
                try:
                    return _from_disk()
                except OSError:
                    pass
        return None, "", 0.0

    def store_frame(self, row, data: bytes | None) -> bool:
        """Tayyor JPEG kadrni surat sifatida saqlaydi: disk + `snapshot_at` +
        SSE. Manba ikki xil — server olgan kadr (`self.capture`) yoki brauzer jonli
        ko'rinishdan yuborgan kadr (push endpoint). Ikkinchisi ochiq turgan
        kamera uchun alohida RTSP grab'ni tejaydi."""
        if not data or data[:2] != b"\xff\xd8":       # JPEG belgisi
            return False
        at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        try:
            SNAP_DIR.mkdir(parents=True, exist_ok=True)
            self.path_for(row["slug"] or "").write_bytes(data)
        except OSError as exc:
            log("snapshots", "write_failed", level="error", error=str(exc))
            return False
        with self._lock:
            self._done[row["id"]] = time.time()
        with get_db() as db:
            cameras.set_snapshot_at(db, row["id"], at)
        bus.publish("snapshot", {"id": row["id"],
                                 "external_id": row["external_id"] or "",
                                 "at": at})
        return True

    def capture(self, row) -> bool:
        """Bitta kameradan surat olib diskka yozadi, bazaga vaqtni belgilaydi."""
        data = fast_start.snapshot(
            row["id"], row["ip"], row["username"] or "",
            security.decrypt(row["password_enc"]),
            row["vendor"] or "", row["rtsp_path"] or "", row["slug"] or "",
            row["port"] or 554)
        return self.store_frame(row, data)

    def _due_cameras(self) -> list:
        """Shu tickda olinadigan kameralar — har biri o'z uyasida, bir marta.

        Issiqlar ro'yxat boshida: klapan (BATCH_LIMIT) ishga tushsa devorda
        ko'rilayotgan kadrlar qurbon bo'lmaydi.
        """
        now = time.time()
        mono = time.monotonic()
        with get_db() as db:
            rows = cameras.list_rtsp(db, enabled_only=True)
        interval_cold = self.cold_interval(len(rows))
        with self._lock:
            self._last_total = len(rows)
            requested = dict(self._requested)
            done = dict(self._done)

        hot_due, cold_due = [], []
        for row in rows:
            alive = health.online(row["ip"], row["port"])
            if alive is False:
                continue                            # offline — urinish behuda
            hot = mono - requested.get(row["id"], -1e12) < HOT_WINDOW
            if not hot and alive is not True:
                continue                            # sovuq faqat aniq online
            interval = HOT_INTERVAL if hot else interval_cold
            slot = self._slot(row["id"], interval, now)
            prev = done.get(row["id"])
            if prev is None:
                # Restart: diskdagi fayl shu uyadan yangi bo'lsa — bajarilgan.
                # Busiz har restart 5000 ta behuda surat degani.
                try:
                    mtime = self.path_for(row["slug"] or "").stat().st_mtime
                except OSError:
                    mtime = 0.0
                if mtime >= slot:
                    with self._lock:
                        self._done[row["id"]] = mtime
                    continue
            elif prev >= slot:
                continue                            # bu oyna allaqachon bajarilgan
            (hot_due if hot else cold_due).append(row)

        due = hot_due + cold_due
        if len(due) > BATCH_LIMIT:
            self._capped_ticks += 1
            if self._capped_ticks == 1:
                log("snapshots", "backlog", due=len(due), limit=BATCH_LIMIT)
            elif self._capped_ticks == CAPPED_WARN_TICKS:
                log("snapshots", "batch_capped", level="warning",
                    due=len(due), limit=BATCH_LIMIT, ticks=self._capped_ticks)
            due = due[:BATCH_LIMIT]
        elif self._capped_ticks:
            if self._capped_ticks > 1:
                log("snapshots", "backlog_cleared", ticks=self._capped_ticks)
            self._capped_ticks = 0
        return due

    def _attempt(self, row) -> bool:
        """Bitta urinish; natijadan qat'i nazar oyna bajarilgan deb belgilanadi."""
        try:
            return self.capture(row)
        finally:
            with self._lock:
                self._done[row["id"]] = time.time()

    def _clean_orphans(self) -> None:
        """Bazada yo'q slug'larning eski suratlarini o'chiradi."""
        with get_db() as db:
            slugs = cameras.all_slugs(db)
        try:
            files = list(SNAP_DIR.glob("*.jpg"))
        except OSError:
            return
        now, removed = time.time(), 0
        for f in files:
            if f.stem in slugs:
                continue
            try:
                if now - f.stat().st_mtime > ORPHAN_KEEP:
                    f.unlink()
                    removed += 1
            except OSError:
                pass
        if removed:
            log("snapshots", "orphans_cleaned", removed=removed)

    def _loop(self) -> None:
        while True:
            try:
                if time.time() - self._last_clean > CLEAN_EVERY:
                    self._last_clean = time.time()
                    self._clean_orphans()
                due = self._due_cameras()
                if due:
                    started = time.monotonic()
                    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
                        results = list(pool.map(self._attempt, due))
                    stats = {"total": len(due),
                             "ok": sum(1 for r in results if r),
                             "duration_ms": int((time.monotonic() - started) * 1000),
                             "at": datetime.now(timezone.utc).isoformat(
                                 timespec="seconds")}
                    with self._lock:
                        self._cycle.update(stats)
                    log("snapshots", "cycle", **stats)
            except Exception as exc:                # fon vazifa yiqilmasin
                log("snapshots", "cycle_failed", level="error", error=str(exc))
            time.sleep(TICK)

    def start(self) -> None:
        with self._lock:
            if self._started:
                return
            self._started = True
        threading.Thread(target=self._loop, daemon=True).start()


# Yagona nusxa: jarayonda bitta xizmat ishlaydi.
service = SnapshotService()
path_for = service.path_for
cold_interval = service.cold_interval
cycle_stats = service.cycle_stats
max_age = service.max_age
note_request = service.note_request
read = service.read
store_frame = service.store_frame
capture = service.capture
start = service.start
