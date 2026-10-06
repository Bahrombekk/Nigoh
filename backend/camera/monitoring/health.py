"""Kameralarning tirikligini fonda kuzatish (TCP, har 60 s) va SSE'ga e'lon qilish.

Talab bo'yicha ulanish dizaynining bitta kamchiligi bor: kamera o'chib
qolsa, buni faqat kimdir bosganda bilamiz. Bu modul fonda yengil tekshiruv
yuritadi — xaritada o'chiq kameralar qizil nuqta bo'lib ko'rinadi.

Tekshiruv arzon bo'lishi uchun:

  * RTSP oqim ochilmaydi — faqat TCP ulanish sinaladi (kamera/registrator
    portga javob beryaptimi). Bu bir necha millisekund va trafik deyarli nol.
  * Takrorlanuvchi manzillar birlashtiriladi: 2000 kamera 40 ta NVR'da
    bo'lsa, 2000 emas, 40 ta tekshiruv ketadi.
  * MediaMTX oqim olayotgan manzil UMUMAN tekshirilmaydi — tiriklik
    allaqachon isbotlangan, ortiqcha ulanish esa ba'zi kameralarda
    jonli sessiyani uzib qo'yadi (tcpdump'da ko'rilgan; `_sweep` izohi).
    TCP yiqilsa-yu MediaMTX bayt olayotgan bo'lsa ham kamera tirik:
    zaif dalil kuchlisini bekor qilmaydi.
  * Hammasi parallel (manzillar soniga moslashadi, MAX_WORKERS=256),
    har 60 soniyada bir marta. Timeout'dan keyin bir marta uzunroq
    (RETRY_TIMEOUT) qayta uriniladi, rad etilgan ulanishda — yo'q.
  * Birinchi sweep natijalari kelishi bilan e'lon qilinadi — 5000 kamerada
    xarita ~100 s holatsiz turmasin.

Holat o'zgarishi `events` jadvaliga (uptime tarixi) va SSE'ga (`state`
hodisasi, kamera kesimida) yoziladi; tirik manzillarning `last_seen`
vaqti bazada yangilanadi.

Tarkibi:
    HealthMonitor                   tiriklik kuzatuvchisi
        .start()                    fon thread'ini ishga tushiradi (bir marta)
        .online(ip, port)           oxirgi natija: True / False / None (noma'lum)
        .check_now(ip, port)        bitta manzilni darhol tekshiradi (yangi
                                    kamera 60 s kutib turmasin), o'tishni e'lon qiladi
        .sweep_stats()              oxirgi sweep: checked, online, duration_ms, at
        .set_streaming_probe(fn)    MediaMTX oqim olayotgan (ip, port) lar
                                    manbasi — app/bootstrap.py o'rnatadi
    service                         yagona nusxa; online, check_now, start,
                                    sweep_stats, set_streaming_probe — aliaslar
    CHECK_INTERVAL, TIMEOUT, RETRY_TIMEOUT, MAX_WORKERS   sozlamalar

Ishlatadi: core (bus, log), database (cameras, events)
Kim ishlatadi: app/bootstrap.py (start), camera.state, camera/api (cameras,
admin), camera/monitoring (snapshots, passport), app (health, system_api),
stats (overview, admin_api)
"""
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Callable

from core import bus
from core.log import log
from database import cameras, events, get_db

CHECK_INTERVAL = 60.0   # soniya — har qancha kamerada ham yetarli
TIMEOUT = 1.5
# Timeout — noaniq javob: kamera o'chgan ham, shunchaki band ham bo'lishi
# mumkin (oqim ketayotganda qo'l berish sekinlashadi). Rad etilgan
# ulanish esa aniq javob — u yerda qayta urinishning ma'nosi yo'q.
# Shuning uchun faqat timeout'dan keyin bir marta, uzunroq muddat bilan
# qayta uriniladi: bitta sekin javob kamerani "o'chgan" qilib qo'ymasin.
RETRY_TIMEOUT = 4.0
# Ishchilar soni manzillar soniga moslashadi: 5000 kamera minglab alohida
# manzil bo'lsa ham sweep intervalga sig'adi (eng yomon holat — hammasi
# o'chiq: 3000 manzil / 256 ishchi × 1,5 s ≈ 18 s).
MAX_WORKERS = 256


class HealthMonitor:
    """Kameralar tirikligi: har 60 s TCP tekshiruvi, natija xotirada va SSE orqali."""

    def __init__(self) -> None:
        self._statuses: dict[tuple[str, int], bool] = {}
        self._stats = {"checked": 0, "online": 0, "duration_ms": 0, "at": ""}
        self._lock = threading.Lock()
        self._started = False
        # Oqim olayotgan manzillarni beradigan funksiya — ilova qatlami
        # o'rnatadi (`set_streaming_probe`). core/ media/ ga bog'lanmasligi
        # uchun tashqaridan beriladi; reconciler'dagi `load_cameras` bilan bir
        # xil naqsh.
        self._streaming_pairs: Callable[[], set[tuple[str, int]]] | None = None

    def set_streaming_probe(self, fn: Callable[[], set[tuple[str, int]]]) -> None:
        self._streaming_pairs = fn

    def _connect(self, pair: tuple[str, int], timeout: float) -> tuple[bool, str]:
        """(muvaffaqiyat, sabab). Sabab: "" | "timeout" | "refused"."""
        try:
            socket.create_connection(pair, timeout=timeout).close()
            return True, ""
        except TimeoutError:
            return False, "timeout"
        except OSError:
            return False, "refused"

    def _tcp_ok(self, pair: tuple[str, int]) -> bool:
        ok, why = self._connect(pair, TIMEOUT)
        if ok or why != "timeout":
            return ok
        return self._connect(pair, RETRY_TIMEOUT)[0]

    def _live_pairs(self) -> set[tuple[str, int]]:
        """MediaMTX ayni damda oqim olayotgan (ip, port) juftliklari.

        Ilgak o'rnatilmagan yoki so'rov yiqilgan bo'lsa bo'sh to'plam —
        tekshiruv o'z yo'lida davom etadi.
        """
        if self._streaming_pairs is None:
            return set()
        try:
            return self._streaming_pairs()
        except Exception as exc:                # noqa: BLE001
            log("health", "streaming_probe_failed", level="warning", error=str(exc))
            return set()

    def _rescue_streaming(self, fresh: dict[tuple[str, int], bool],
                          live: set[tuple[str, int]] | None = None) -> list:
        """Oqim ketayotgan manzilni "o'chiq" deb belgilamaydi.

        TCP tekshiruvi va MediaMTX ikki mustaqil dalil, va ular teng emas:
        MediaMTX kameradan BAYT olayotgan bo'lsa, kamera tirikligi
        isbotlangan. Tekshiruv esa qurilma band, sekin yoki yangi ulanishni
        rad etayotgan paytda ham yiqiladi — shunda video ekranda ketaverib,
        yorliq "o'chgan" bo'lib turardi.

        Zaif dalil kuchlisini bekor qila olmasligi kerak.
        """
        failed = [pair for pair, ok in fresh.items() if not ok]
        if not failed:
            return []
        if live is None:
            live = self._live_pairs()
        if not live:
            return []
        rescued = [pair for pair in failed if pair in live]
        for pair in rescued:
            fresh[pair] = True
        if rescued:
            log("health", "tcp_failed_but_streaming", level="warning",
                addresses=len(rescued),
                detail="TCP tekshiruvi yiqildi, lekin MediaMTX shu manzildan "
                       "oqim olyapti — kamera tirik deb hisoblandi")
        return rescued

    def _sweep(self) -> None:
        started = time.monotonic()
        with get_db() as db:
            rows = cameras.list_rtsp(db, enabled_only=True)
        pairs = list(dict.fromkeys((row["ip"], row["port"] or 554) for row in rows))
        if not pairs:
            with self._lock:
                self._statuses.clear()
            return

        # OQIM KETAYOTGAN MANZIL TEKSHIRILMAYDI.
        #
        # Sabab shunchaki tejash emas. Kameralar (Dahua, ONVIF klonlari)
        # bir vaqtda ochilgan RTSP ulanishlari soniga sezgir: tekshiruv
        # ulanib darhol uziladi, kamera esa shu payt tirik sessiyani
        # yopib qo'yishi mumkin — ishlab chiqarishda tcpdump'da ko'rindi
        # (tekshiruv SYN'iga SYN-ACK va AYNAN SHU MILLISEKUNDDA jonli
        # sessiyaga FIN). MediaMTX o'sha manzildan bayt olayotgan bo'lsa,
        # kamera tirikligi allaqachon isbotlangan — qo'shimcha ulanishning
        # yangi ma'lumoti yo'q, zarari esa bor.
        live = self._live_pairs()
        probe = [pair for pair in pairs if pair not in live]

        # Birinchi sweep (server endigina yondi): natija kelishi bilan
        # e'lon qilinadi. Aks holda xarita butun sweep tugaguncha holatsiz
        # turardi — 5000 kamerada, ulardan ko'pi javob bermasa, bu ~100 s
        # (har javobsiz manzil 1,5 + 4 s kutiladi). Tirik kamera millisoniyada
        # javob beradi, ya'ni ular darhol yashil bo'ladi. Keyingi sweeplarda
        # eski holat bor — o'zgarishlar oxirida solishtiriladi (SSE).
        with self._lock:
            first = not self._statuses
        fresh: dict[tuple[str, int], bool] = {}
        if probe:
            workers = min(MAX_WORKERS, max(8, len(probe)))
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = {pool.submit(self._tcp_ok, pair): pair for pair in probe}
                for future in as_completed(futures):
                    pair = futures[future]
                    fresh[pair] = future.result()
                    if first:
                        with self._lock:
                            self._statuses.setdefault(pair, fresh[pair])

        for pair in pairs:
            if pair in live:
                fresh[pair] = True
        # Tekshiruv davomida oqim boshlangan bo'lsa ham "o'chiq" deb
        # belgilanmasin — ro'yxat sweep boshida olingan.
        self._rescue_streaming(fresh)

        # Holat o'zgarganlarni SSE abonentlariga e'lon qilamiz. Birinchi sweep
        # (eski qiymat yo'q) e'lon qilinmaydi — ulanish paytidagi boshlang'ich
        # holat /cameras/status dan olinadi, hodisa faqat o'zgarish demak.
        with self._lock:
            old = dict(self._statuses)
        changed = [pair for pair, ok in fresh.items()
                   if pair in old and old[pair] != ok]
        if changed:
            self._publish_changes(changed, fresh)

        # Tirik chiqqanlarning "oxirgi onlayn" vaqti bazaga yoziladi — server
        # qayta ishga tushsa ham tarix yo'qolmaydi.
        alive = [pair for pair, ok in fresh.items() if ok]
        if alive:
            with get_db() as db:
                cameras.mark_seen(db, alive, datetime.now(timezone.utc))

        with self._lock:
            self._statuses.clear()               # o'chirilgan manzillar chiqib ketadi
            self._statuses.update(fresh)
            self._stats.update(
                checked=len(pairs), online=sum(1 for ok in fresh.values() if ok),
                duration_ms=int((time.monotonic() - started) * 1000),
                at=datetime.now(timezone.utc).isoformat(),
            )

    def _publish_changes(self, changed: list[tuple[str, int]],
                         fresh: dict[tuple[str, int], bool]) -> None:
        """O'zgargan manzillardagi kameralarni SSE'ga uzatadi.

        Bitta NVR manzili ortida o'nlab kamera bo'lishi mumkin — hodisa
        kamera kesimida (id/external_id bilan) beriladi.
        """
        with get_db() as db:
            rows = cameras.list_rtsp(db, enabled_only=True)
        by_pair: dict[tuple[str, int], list] = {}
        for row in rows:
            by_pair.setdefault((row["ip"], row["port"] or 554), []).append(row)

        at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        # O'tishlar bazaga ham yoziladi — kamera qachon/qancha o'chiq turgani
        # tarixи shu yozuvlardan hisoblanadi (uptime statistikasi).
        with get_db() as db:
            for pair in changed:
                state = "online" if fresh[pair] else "offline"
                for row in by_pair.get(pair, []):
                    events.add(db, state, camera_id=row["id"], path=row["slug"])
                    bus.publish("state", {
                        "id": row["id"],
                        "external_id": row["external_id"] or "",
                        "state": state,
                        "at": at,
                    })

    def sweep_stats(self) -> dict:
        """Oxirgi sweep haqida: nechta manzil, nechtasi tirik, qancha vaqt oldi.

        5000 kamerada sweep intervalga sig'ayotganini kuzatish uchun —
        `duration_ms` CHECK_INTERVAL'ga yaqinlashsa, MAX_WORKERS'ni oshirish
        yoki intervalni kengaytirish kerak.
        """
        with self._lock:
            return dict(self._stats)

    def _loop(self) -> None:
        while True:
            try:
                self._sweep()
            except Exception as exc:        # kuzatuv hech qachon yiqilmasin
                log("health", "sweep_failed", level="error", error=str(exc))
            time.sleep(CHECK_INTERVAL)

    def start(self) -> None:
        """Fon tekshiruvini ishga tushiradi (bir marta)."""
        with self._lock:
            if self._started:
                return
            self._started = True
        threading.Thread(target=self._loop, daemon=True).start()

    def online(self, ip: str | None, port: int | None) -> bool | None:
        """True — tirik, False — o'chiq, None — hali noma'lum yoki IP'siz."""
        if not ip:
            return None
        with self._lock:
            return self._statuses.get((ip, port or 554))

    def check_now(self, ip: str | None, port: int | None) -> bool | None:
        """Bitta manzilni darhol tekshiradi — yangi kamera navbatdagi sweep'ni
        (60 s gacha) kutib "Tekshirilmagan" bo'lib turmasin. Natija umumiy
        xaritaga yoziladi, tirik chiqsa last_seen ham yangilanadi."""
        if not ip:
            return None
        pair = (ip, port or 554)
        # Oqim ketayotgan manzilga ulanmaymiz (`_sweep` izohi) — MediaMTX
        # dalili yetarli.
        if pair in self._live_pairs():
            ok = True
        else:
            ok = self._tcp_ok(pair)
            if not ok and self._rescue_streaming({pair: False}):
                ok = True
        with self._lock:
            old = self._statuses.get(pair)
            self._statuses[pair] = ok
        with get_db() as db:
            # O'tish shu yerda yuz berdi — sweep endi ko'rmaydi, tarixga o'zimiz
            # yozamiz VA SSE'ga e'lon qilamiz. E'lon qilinmasa yangi qo'shilgan
            # yoki tahrirlangan kameraning birinchi holati abonentlarga
            # yetmasdi (_enrich_new_camera aynan shu yo'ldan yuradi), ya'ni
            # asosiy tizim keyingi sweep'gacha (60 s) eski holatni ko'rardi.
            if old is not None and old != ok:
                state = "online" if ok else "offline"
                at = datetime.now(timezone.utc).isoformat(timespec="seconds")
                for row in cameras.find_by_address(db, pair[0], pair[1]):
                    events.add(db, state, camera_id=row["id"], path=row["slug"])
                    bus.publish("state", {
                        "id": row["id"],
                        "external_id": row["external_id"] or "",
                        "state": state,
                        "at": at,
                    })
            if ok:
                cameras.mark_seen(db, [pair], datetime.now(timezone.utc))
        return ok


# Yagona nusxa: jarayonda bitta xizmat ishlaydi.
service = HealthMonitor()
set_streaming_probe = service.set_streaming_probe
sweep_stats = service.sweep_stats
start = service.start
online = service.online
check_now = service.check_now
