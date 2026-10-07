"""MediaMTX tugunlarini tirik va kerakli holatda tutuvchi fon vazifasi.

Har 30 soniyada (CHECK_INTERVAL), har bir yoqilgan tugun (nodes jadvali) uchun:

  1. Lokal MediaMTX yiqilgan bo'lsa — qayta ishga tushiriladi (log
     logs/mediamtx/mediamtx.log da; ko'tarilmasa sababi jurnalga chiqadi).
     Uzoq tugundagi jarayonga aralasha olmaymiz — u yiqilsa faqat hodisa
     yoziladi (API javob bermayapti). `MEDIAMTX_AUTOSTART=0` — o'chirish.

  2. Tugun yo'llari kerakli holat bilan kelishtiriladi (`sync.push_to_api`).
     MediaMTX qayta ishga tushganda API orqali qo'shilgan yo'llar
     yo'qoladi — shu yerda o'z-o'zidan tiklanadi. Farq bo'lmasa hech
     narsa yuborilmaydi, ya'ni tinch holatda bu arzon tekshiruv xolos.

Har 5 soniyada (STALL_INTERVAL), faqat javob bergan tugunlarda:

  3. Faol oqimlarning bayt hisobi kuzatiladi — STALL_AFTER (20 s) davomida
     qo'zg'almagan tayyor oqim "muzlagan" deb belgilanadi (hodisa + SSE
     `stalled`). O'lchov vaqt bo'yicha, tsikl bo'yicha emas: uzun GOP'li
     kamera ma'lumotni portlash bilan yuboradi va ikki portlash orasidagi
     jimlik muzlash emas. Sub oqim muzlashi kamera holatini o'zgartirmaydi.
  4. Uzoq vaqt (NOT_READY_AFTER, 45 s) tayyor bo'lmayotgan yoki buzuq kadr
     berayotgan yo'l uchun transport sinovi buyuriladi (media/transport.py).
  5. Sub oqim salomatligi: so'ralgan-u SUB_DEAD_AFTER (45 s) bitta bayt
     kelmagan sub faqat SHUBHA uyg'otadi; hukmni kadr o'qib ko'rish
     (`sync.kadr_keladimi`) chiqaradi — DESCRIBE yetarli emas, registrator
     sub'ni e'lon qilib, paket bermasligi o'lchangan. Yaroqsiz sub'lar
     SUB_RECHECK (6 soat) da qayta sinaladi, sub yo'li yo'q kameralarga
     esa yo'l izlanadi (`rtsp_probe.sub_yol_nomzodlari`). Birinchi qayta
     sinov ishga tushgandan ko'p o'tmay (SUB_FIRST_RECHECK) — eski
     noto'g'ri bayroqlar tez tozalansin (32 tadan 29 tasi sog'lom chiqqan).

Tugundagi MediaMTX BIZNIKI ekani har tsiklda tekshiriladi: begona
o'rnatmaga tegilmaydi (`sync.api_status` izohiga qarang) — ikki o'rnatma
bitta 9997-portga qarasa bir-birining yo'llarini o'chirib turardi.
Ortiqcha yo'llar ko'p bo'lsa (har API amali butun konfiguratsiyani qayta
yuklaydi: 0 yo'lda 9 ms, 2400 da 297 ms) tozalash bir necha tsiklga
cho'ziladi va operator ogohlantiriladi; MediaMTX avtomatik qayta
ishga tushirilmaydi — tirik oqimlar uzilardi.

Natijada qo'lda aralashish kerak emas: kamera qo'shildi/o'chirildi yoki
MediaMTX yiqildi — 30 soniya ichida tizim o'zini kerakli holatga keltiradi.

Tarkibi:
    Reconciler                      fon kuzatuvchisi
        .start(load_cameras)        fon thread'i (bir marta); load_cameras —
                                    MediaMTX ko'rinishidagi kameralar (app beradi)
        .stalled_paths()            muzlagan yo'llar ("slug" yoki "slug@tugun")
        .stalled_count(node_id)     tugundagi muzlagan oqimlar soni
        .pending_count(node_id)     tugunda tozalanmagan ortiqcha yo'llar
        .foreign_nodes()            begona MediaMTX'ga qarab turgan tugunlar soni
    stream_resolution(item)         MediaMTX yo'lidan video o'lchami (format
                                    bazaga shu bilan yoziladi)
    service                         yagona nusxa; stalled_paths, stalled_count,
                                    pending_count, foreign_nodes, start — aliaslar
    CHECK_INTERVAL, STALL_INTERVAL, STALL_AFTER, SUB_DEAD_AFTER, SUB_RECHECK,
    SUB_FIRST_RECHECK, NOT_READY_AFTER   sozlamalar (muhit o'zgaruvchilari)
    MEDIAMTX_EXE, LOG_PATH          lokal MediaMTX dasturi va jurnali

Ishlatadi: camera.media (sync, transport), camera.probe.rtsp_probe,
core (bus, security, log, paths), database (cameras, nodes, events, sub_*)
Kim ishlatadi: app/bootstrap.py (start), camera.state (stalled_paths),
camera/api/nodes.py, app/health.py, app/system_api.py
"""
import os
import subprocess
import threading
import time
from datetime import datetime, timezone
from typing import Callable

from app.settings import site_settings
from camera.media import sync, transport
from camera.probe.rtsp_probe import build_rtsp_url, sub_yol_nomzodlari
from core import bus, security
from core.log import log
from core.logs import external as mtx_log
from core.paths import ROOT_DIR
from database import cameras as cameras_db
from database import (
    cameras_by_slug,
    cameras_without_sub,
    events,
    get_db,
    set_sub_bad,
    set_sub_path,
    sub_bad_cameras,
)
from database import nodes as nodes_db

CHECK_INTERVAL = 30.0      # soniya — to'liq sinxronlash (yo'llar kelishtiriladi)
# Muzlash tekshiruvi ancha tez-tez: oqim qotganini 60 soniyada bilish
# kuzatuv tizimi uchun juda kech. Faol yo'llar ro'yxati kichik (yo'llar
# talab bo'yicha yaratiladi), shuning uchun bu arzon.
STALL_INTERVAL = 5.0       # soniya — tekshiruv qadami
# Shuncha vaqt bitta bayt kelmasa oqim muzlagan hisoblanadi. Qadamdan
# ancha uzun bo'lishi SHART: kamera ma'lumotni portlash bilan yuborishi
# normal holat (uzun GOP), va ikki portlash orasidagi jimlik muzlash
# emas. 20 soniya — eng sekin kamerada ham ikki-uch keyframe oralig'i,
# lekin kuzatuvchi uchun hali ham tez.
STALL_AFTER = float(os.environ.get("STALL_AFTER", "20"))
# Sub oqim so'ralgan, lekin shuncha vaqt ichida bitta bayt ham kelmasa —
# kamerada ikkinchi oqim yo'q (yoki o'chirilgan) deb belgilanadi.
#
# Amalda uchragan holat: registratorning 8 kanalidan ikkitasida ikkinchi
# oqim yoqilmagan edi (/Streaming/Channels/402 va 802 javob bermasdi),
# asosiy oqimlari esa ishlab turardi. Devorda o'sha ikki katak bo'sh
# qolardi va buni QO'LDA topib, qo'lda belgilash kerak edi.
#
# 45 soniya: `sourceOnDemandStartTimeout` (12 s) dan ancha uzun, ya'ni
# sekin uyg'onadigan kamera noto'g'ri belgilanmaydi.
SUB_DEAD_AFTER = float(os.environ.get("SUB_DEAD_AFTER", "45"))
# Yaroqsiz deb belgilangan sub shuncha vaqtdan keyin qayta sinaladi —
# operator registratorda ikkinchi oqimni yoqsa, tizim buni O'ZI ko'radi
# va belgini oladi. Tekshiruv sub oqimdan kadr o'qib ko'rish bilan.
SUB_RECHECK = float(os.environ.get("SUB_RECHECK", "21600"))   # 6 soat
# Ishga tushgandan keyin birinchi tekshiruvgacha — yangi versiya
# qo'yilganda eski bayroqlar tez tozalansin (yuqoridagi izohga qarang).
SUB_FIRST_RECHECK = float(os.environ.get("SUB_FIRST_RECHECK", "300"))
# Yo'l MediaMTX'da bor, lekin shuncha vaqtdan beri "tayyor" bo'lmadi —
# ya'ni kimdir uni ko'rmoqchi, manba esa ko'tarilmayapti. Shu holatda
# transport tekshiruvi ishga tushadi (media/transport.py): kameralarning
# bir qismi RTSP'ni TCP'da bermaydi va PLAY'dan keyin ulanishni darhol
# yopadi. Muddat manba ochilishidan (SOURCE_START_TIMEOUT, 12 s) va
# relay ko'tarilishidan (30 s) uzun bo'lishi SHART — aks holda sekin
# ochiladigan sog'lom kamera ham tekshiruvga tushadi.
NOT_READY_AFTER = float(os.environ.get("TRANSPORT_CHECK_AFTER", "45"))
SPAWN_COOLDOWN = 30.0      # qayta urinishlar orasidagi eng kam vaqt
STARTUP_WAIT = 8.0         # ishga tushirgandan keyin API'ni shuncha kutamiz

# MediaMTX dasturi repo ildizidagi mediamtx/ papkasida.
MEDIAMTX_EXE = ROOT_DIR / "mediamtx" / (
    "mediamtx.exe" if os.name == "nt" else "mediamtx")
# MediaMTX logi logs/mediamtx/ da (core/logs/external.py: copytruncate aylantirish).
LOG_PATH = mtx_log.MEDIAMTX_LOG


# Yo'q bo'lib ketgan yo'lning hisobi shuncha vaqt saqlanadi.
_NOT_READY_KEEP = 300.0

# Ortiqcha yo'llar. MediaMTX har `paths/add`/`delete` so'roviga butun
# konfiguratsiyani qayta yuklaydi, ya'ni bitta amal narxi mavjud yo'llar
# soniga chiziqli o'sadi (o'lchov: 0 yo'lda 9 ms, 2400 yo'lda 297 ms).
# Shu sababli tozalash vaqt byudjeti bilan chegaralangan va bir necha
# tsiklga cho'ziladi — shu davrda kamera ochilishi ham sekin bo'ladi.
#
# Eng tez yechim — MediaMTX'ni qayta ishga tushirish: API orqali
# qo'shilgan yo'llar faylga yozilmaydi (tekshirildi: 2051 -> 0), kerakli
# yo'l esa ko'rish so'ralganda o'zi qaytadan yaratiladi. Buni avtomatik
# qilmaymiz — tirik oqimlarni uzib yuborardi; operatorga aytamiz.
BLOAT_WARN_EVERY = 300.0                       # soniya

# Begona MediaMTX (boshqa o'rnatmaniki) — `sync.api_status` izohiga qarang.
FOREIGN_WARN_EVERY = 300.0                     # soniya


DEATH_WARN_EVERY = 300.0     # soniya — jurnal toshib ketmasin


PRUNE_INTERVAL = 3600.0    # soniya — eski hodisalar soatiga bir tozalanadi


def stream_resolution(item: dict) -> str:
    """MediaMTX yo'lidagi video o'lchami ("2560x1440" yoki bo'sh).

    `tracks2[].codecProps.width/height` (MediaMTX v1.12+) — oqimning
    o'zidan (SPS) olingan haqiqiy qiymat. SDP'da o'lcham bermaydigan
    kameralar (Holowits H.265) formati faqat shu yo'l bilan bilinadi.
    """
    if not item.get("ready"):
        return ""
    for track in item.get("tracks2") or []:
        props = track.get("codecProps") or {}
        width, height = props.get("width"), props.get("height")
        if isinstance(width, int) and isinstance(height, int) and width > 0 and height > 0:
            return f"{width}x{height}"
    return ""


class Reconciler:
    """MediaMTX kuzatuvchisi: yo'llarni kelishtiradi, muzlagan oqimlar va sub oqim salomatligini tekshiradi, MediaMTX yiqilsa qayta ko'taradi."""

    def __init__(self) -> None:
        self._started = False
        self._lock = threading.Lock()
        self._process: subprocess.Popen | None = None
        self._last_spawn = 0.0
        # (tugun, yo'l) -> (bytesReceived, shu hisob oxirgi marta o'zgargan vaqt)
        self._prev_bytes: dict[tuple[int, str], tuple[int, float]] = {}
        # Sub oqim salomatligi. `_sub_ok` — shu jarayonda BIR MARTA bo'lsa ham
        # kadr bergan sub yo'llar: ular vaqtincha yopilsa ham yaroqsiz deb
        # belgilanmaydi (sourceOnDemand yo'lni tomoshabin ketgach yopadi va
        # hisob nolga tushadi — bu nosozlik emas).
        self._sub_ok: set[tuple[int, str]] = set()
        # (tugun, yo'l) -> qachondan beri so'ralgan-u, bitta bayt ham kelmagan
        self._sub_zero: dict[tuple[int, str], float] = {}
        # ayni damda RTSP tekshiruvida turgan sub yo'llar — takror tekshirilmasin
        self._sub_tekshiruvda: set[str] = set()
        # Allaqachon "yaroqsiz" deb hukm qilingan sub yo'llar. Ularni jonli
        # kuzatuv QAYTA tekshirmaydi — aks holda yo'l MediaMTX'da turgani va
        # bo'sh qolgani uchun har tsiklda shubhaga tushib, har daqiqada bitta
        # ffprobe ko'tarilardi. Ishlab chiqarishda o'lchandi: bitta kamera
        # uchun har ~50 soniyada takror tekshiruv, cheksiz.
        #
        # Qayta sinash bu yerda emas, `_recheck_sub_bad` da (SUB_RECHECK) —
        # o'sha yerda bayroq olinsa, yo'l bu to'plamdan ham chiqadi.
        self._sub_olik: set[str] = set()
        self._sub_olik_yuklandi = False
        self._stalled: dict[tuple[int, str], str] = {}      # (tugun, yo'l) -> ko'rsatma nomi
        # (tugun, yo'l) -> oxirgi ko'rilgan buzuq kadrlar hisobi. Yo'l "tayyor"
        # bo'lsa ham oqim yaroqsiz bo'lishi mumkin: kamera RTP paketlarni
        # tashlab yuboradi, MediaMTX esa "invalid FU-A packet" deb kadrni
        # yig'olmaydi va HLS segmenti chiqmaydi — tomoshabin 500 oladi.
        # O'lchov: bitta kamera TCP'da sekundiga 1200-1700 paket yo'qotgan,
        # o'sha kamera UDP'da bemalol ishlagan.
        self._errors: dict[tuple[int, str], int] = {}
        # slug -> bazaga yozilgan o'lcham: har 5 soniyada qayta yozilmasin.
        self._resolutions: dict[str, str] = {}
        # (tugun, yo'l) -> (jami NOSOZ vaqt, oxirgi ko'rilgan payt).
        #
        # Nima uchun JAMI vaqt, "birinchi ko'rilgan payt" emas: ochilmayotgan
        # yo'l MediaMTX ro'yxatidan vaqti-vaqti bilan butunlay yo'qoladi
        # (manba o'ladi -> talab bo'yicha yo'l o'chadi -> keyingi so'rovda
        # qaytadan tug'iladi). Boshlanish payti saqlansa, har yo'qolishda
        # hisoblagich noldan boshlanardi va muddat HECH QACHON to'lmasdi —
        # o'lchovda 7 daqiqa davomida bitta ham sinov ishga tushmadi.
        self._not_ready: dict[tuple[int, str], tuple[float, float]] = {}
        self._pending: dict[int, int] = {}                  # tugun -> tozalanmagan yo'llar
        self._bloat_warned: dict[int, float] = {}
        self._foreign: dict[int, float] = {}                # tugun -> oxirgi ko'rilgan vaqt
        self._foreign_warned: dict[int, float] = {}
        # Oxirgi to'liq sinxronda API'si javob bergan tugunlar. Tez tsikl faqat
        # shularni tekshiradi — o'lik tugunning timeout'i tsiklni cho'zmasin.
        self._reachable: set[int] = set()
        self._death_warned = [0.0]

    def stalled_paths(self) -> set[str]:
        """Ayni damda muzlagan (bayt kelmayotgan) faol yo'llar."""
        with self._lock:
            return set(self._stalled.values())

    def stalled_count(self, node_id: int) -> int:
        """Bitta tugundagi muzlagan oqimlar soni — tugun salomatligi uchun."""
        with self._lock:
            return sum(1 for key in self._stalled if key[0] == node_id)

    def pending_count(self, node_id: int) -> int:
        """Tugunda hali tozalanmagan ortiqcha yo'llar — 0 bo'lishi kerak."""
        with self._lock:
            return self._pending.get(node_id, 0)

    def _note_pending(self, node: dict, pending: int) -> None:
        """Tozalanmagan yo'llarni qayd etadi va operatorni ogohlantiradi."""
        with self._lock:
            self._pending[node["id"]] = pending
        if not pending:
            return
        now = time.monotonic()
        with self._lock:
            if now - self._bloat_warned.get(node["id"], 0.0) < BLOAT_WARN_EVERY:
                return
            self._bloat_warned[node["id"]] = now
        log("reconciler", "paths_bloated", level="warning", node=node["name"],
            pending=pending,
            message="MediaMTX'da ortiqcha yo'llar ko'p — tozalanmoqda, shu "
                    "davrda kamera sekinroq ochiladi. Tezroq yo'l: MediaMTX'ni "
                    "qayta ishga tushiring (yo'llar faylga yozilmaydi, "
                    "kerakligi ko'rilganda o'zi tiklanadi).")

    def _warn_foreign(self, node: dict, api: str) -> None:
        """Tugun begona MediaMTX'ga qarab turibdi — operatorni ogohlantiradi.

        Bu jimgina o'tkazib yuboriladigan holat emas: shu mashinada ikkinchi
        Nigoh o'rnatmasi ishga tushsa (yoki eski nusxaning `ishga-tushirish`
        fayli bosilsa) ikkala backend bitta 9997-portga qaraydi va bir-birining
        yo'llarini o'chirib turadi. Tashqaridan bu "kameralar uziladi, qotib
        qoladi" bo'lib ko'rinadi va sababini topish qiyin.
        """
        now = time.monotonic()
        with self._lock:
            self._foreign[node["id"]] = now
            if now - self._foreign_warned.get(node["id"], 0.0) < FOREIGN_WARN_EVERY:
                return
            self._foreign_warned[node["id"]] = now
        message = sync._foreign_message(api)
        log("reconciler", "mediamtx_begona", level="error",
            node=node["name"], message=message)
        try:
            with get_db() as db:
                events.add(db, "mediamtx", detail=message)
        except Exception:
            pass

    def foreign_nodes(self) -> int:
        """Begona MediaMTX'ga qarab turgan tugunlar soni — /health uchun."""
        cutoff = time.monotonic() - 2 * CHECK_INTERVAL
        with self._lock:
            return sum(1 for t in self._foreign.values() if t > cutoff)

    def _nodes(self) -> list[dict]:
        """Yoqilgan MediaMTX tugunlari; jadval bo'sh bo'lsa — lokal standart."""
        try:
            with get_db() as db:
                rows = nodes_db.list_enabled(db)
            nodes = [dict(r) for r in rows]
        except Exception:
            nodes = []
        return nodes or [{"id": 1, "name": "Asosiy", "api_base": sync.API_BASE}]

    def _autostart_allowed(self) -> bool:
        if os.environ.get("MEDIAMTX_AUTOSTART", "1") == "0":
            return False
        return MEDIAMTX_EXE.exists()

    def _spawn(self) -> bool:
        """Lokal MediaMTX'ni ishga tushiradi; log logs/mediamtx/mediamtx.log da (core/logs/external.py)."""
        now = time.monotonic()
        if now - self._last_spawn < SPAWN_COOLDOWN:
            return False
        if self._process is not None and self._process.poll() is None:
            return False               # biz ochgan jarayon tirik — hali ko'tarilyapti
        self._last_spawn = now
        try:
            # Eski jarayon o'lgan — ildizdagi eski logni ko'chirish va katta
            # bo'lsa aylantirish uchun eng xavfsiz payt.
            mtx_log.migrate_legacy(ROOT_DIR)
            mtx_log.rotate_if_large()
            log_file = mtx_log.open_for_child()
            self._process = subprocess.Popen(
                [str(MEDIAMTX_EXE), str(sync.CONFIG_PATH)],
                cwd=str(ROOT_DIR),
                stdout=log_file, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
            )
        except OSError as exc:
            log("reconciler", "mediamtx_spawn_failed", level="error", error=str(exc))
            return False
        log("reconciler", "mediamtx_restarted", log_file=LOG_PATH.name)
        try:
            with get_db() as db:
                events.add(db, "mediamtx", detail="MediaMTX qayta ishga tushirildi")
        except Exception:
            pass
        # API ko'tarilishini qisqa kutamiz — yo'llar shu tickning o'zida tiklansin.
        deadline = time.monotonic() + STARTUP_WAIT
        while time.monotonic() < deadline:
            if sync.api_available():
                return True
            if self._process.poll() is not None:
                self._log_spawn_death()
                return False
            time.sleep(0.5)
        return False

    def _log_spawn_death(self) -> None:
        """MediaMTX ko'tarilmasdan o'ldi — SABABINI jurnalga chiqaradi.

        Ilgari bu jimgina o'tardi: reconciler har tsiklda `mediamtx_restarted`
        yozib qayta urinardi, sabab esa faqat `mediamtx.log` da qolardi va
        hech kim u yerga qaramasdi. Amalda bitta port to'qnashuvi (`listen udp
        :8189: bind: ...` — qo'shni o'rnatma bilan bo'lishilgan ICE porti)
        butun video xizmatini o'ldirgan, tashqaridan esa "kameralar
        ishlamayapti" bo'lib ko'ringan.
        """
        now = time.monotonic()
        with self._lock:
            if now - self._death_warned[0] < DEATH_WARN_EVERY:
                return
            self._death_warned[0] = now
        sabab = ""
        try:
            # Faqat oxiri o'qiladi: mediamtx.log katta bo'lishi mumkin,
            # bizga esa o'lishdan oldingi bir necha satr yetadi.
            oxiri = mtx_log.tail(8192)
            sabab = next((s for s in reversed(oxiri.splitlines()) if " ERR " in s), "")
        except OSError:
            pass
        log("reconciler", "mediamtx_kotarilmadi", level="error",
            code=self._process.returncode if self._process else None,
            error=sabab or f"sabab {LOG_PATH.name} da",
            message="MediaMTX ishga tushmadi. Eng ko'p uchraydigan sabab — port "
                    "band (shu mashinada ikkinchi o'rnatma). .env dagi "
                    "MEDIAMTX_API, MEDIAMTX_RTSP_PORT, HLS_PORT, WEBRTC_PORT "
                    "va WEBRTC_UDP_PORT/WEBRTC_TCP_PORT ni bo'sh portlarga o'zgartiring")

    def _sub_belgila(self, slugs: list[str], bad: bool) -> None:
        """`sub_bad` bayrog'ini bazaga yozadi va hodisa qoldiradi.

        Faqat HAQIQATAN o'zgargan qatorga yoziladi (`AND sub_bad = ?`),
        shuning uchun har tsiklda takror yozuv ham, takror jurnal ham
        bo'lmaydi.
        """
        kameralar = [s[: -len(sync.SUB_SUFFIX)] for s in slugs]
        for kamera in set_sub_bad(kameralar, bad):
            log("reconciler", "sub_yaroqsiz" if bad else "sub_tiklandi",
                level="warning" if bad else "info", camera=kamera,
                sabab=("sub oqim so'raldi-yu kelmadi, tekshiruvda ham kadr "
                       "bermadi — registratorda ikkinchi oqim yo'q yoki "
                       "o'chirilgan; endi asosiy oqim beriladi")
                if bad else "sub oqim yana kadr beryapti — asosiyga o'tish bekor")

    def _check_sub_health(self, node: dict, active: dict[str, dict]) -> None:
        """Sub oqim so'ralgan-u kelmasa — kamerani `sub_bad` deb belgilaydi.

        Nima uchun serverda: pleyer ham buni aniqlay oladi, lekin faqat
        O'SHA tomoshabin uchun va faqat u ochib ko'rgandan keyin. Server bir
        marta ko'rsa — hamma mijoz uchun, qayta yuklangandan keyin ham
        o'rinli bo'ladi va hech kim qo'lda aralashmaydi.

        Shartlar ataylab qattiq — sog'lom kamerani noto'g'ri belgilash
        tomoshani og'irlashtiradi (asosiy oqim o'lchovda 7,88 Mbit/s, sub
        1,20 Mbit/s edi):

          * yo'l ISSIQ bo'lishi kerak (`is_warm`) — ya'ni kimdir haqiqatan
            so'ragan. So'ralmagan yo'l tayyor emasligi normal holat;
          * bitta ham bayt kelmagan bo'lishi kerak;
          * shu holat SUB_DEAD_AFTER davom etishi kerak;
          * yo'l ilgari BIR MARTA ishlagan bo'lsa (`self._sub_ok`) hech qachon
            belgilanmaydi — tomoshabin ketgach sourceOnDemand yo'lni yopadi
            va hisob nolga tushadi, bu nosozlikka o'xshab ko'rinadi.

        DIQQAT: bu funksiya HUKM CHIQARMAYDI, faqat shubha uyg'otadi. Nima
        uchun — jonli tizimda sinaganda soxta ishga tushdi: sog'lom kanalning
        sub yo'li "issiq" edi (manzil so'ralgan), lekin tomoshabin ulanmagani
        uchun yo'l bo'sh turardi va u yaroqsiz deb belgilanardi. "So'raldi"
        degani "tortib ko'rildi" degani emas. Shuning uchun yakuniy qarorni
        `self._sub_tasdiqla` RTSP tekshiruvi bilan chiqaradi.
        """
        node_id = node["id"]
        now = time.monotonic()
        shubhali: list[str] = []
        tirik: list[str] = []
        if not self._sub_olik_yuklandi:
            # Bazadagi bayroqlar jarayon qayta ishga tushganda ham o'rinli:
            # usiz har restartdan keyin hamma belgilangan kamera qaytadan
            # tekshirilardi. Qayta sinashni `_recheck_sub_bad` bajaradi.
            try:
                with self._lock:
                    self._sub_olik.update(c["slug"] + sync.SUB_SUFFIX
                                     for c in sub_bad_cameras())
                self._sub_olik_yuklandi = True
            except Exception:      # baza hali tayyor bo'lmasa keyingi tsiklda
                pass
        with self._lock:
            for name, item in active.items():
                # `_sub_h264` — o'girish CHIQISHI, kameraning oqimi emas.
                if not name.endswith(sync.SUB_SUFFIX):
                    continue
                key = (node_id, name)
                got = int(item.get("bytesReceived") or 0)
                if item.get("ready") and got > 0:
                    self._sub_ok.add(key)
                    self._sub_zero.pop(key, None)
                    self._sub_olik.discard(name)
                    tirik.append(name)
                    continue
                if key in self._sub_ok or got > 0 or name in self._sub_olik:
                    continue
                if not sync.is_warm(name):
                    self._sub_zero.pop(key, None)
                    continue
                # Transport sinovi ketayotgan kamerani hozir baholamaymiz:
                # sinov davomida kamera TCP'da kadr bermasligi normal holat
                # (u aynan shuni o'lchayapti), va sinov kamerani UDP'ga
                # o'tkazsa sub o'z-o'zidan ishlab ketishi mumkin. `_sub_zero`
                # tozalanmaydi — keyingi tsiklda qaytadan navbatga turadi.
                if transport.busy(name[: -len(sync.SUB_SUFFIX)]):
                    continue
                birinchi = self._sub_zero.setdefault(key, now)
                if now - birinchi >= SUB_DEAD_AFTER and name not in self._sub_tekshiruvda:
                    self._sub_zero.pop(key, None)
                    self._sub_tekshiruvda.add(name)
                    shubhali.append(name)
            for key in [k for k in self._sub_zero
                        if k[0] == node_id and k[1] not in active]:
                self._sub_zero.pop(key)
        if tirik:
            self._sub_belgila(tirik, bad=False)
        if shubhali:
            # Qarorni kuzatuv EMAS, tekshiruv chiqaradi — pastdagi izohga qarang.
            threading.Thread(target=self._sub_tasdiqla, args=(shubhali,),
                             daemon=True).start()

    def _sub_kadr_beradimi(self, cam: dict) -> bool:
        """Kameraning sub oqimidan haqiqatan kadr keladimi.

        DIQQAT: RTSP DESCHRIBE bilan tekshirish YETARLI EMAS va bu shu
        o'rnatmada o'lchandi — registratorning 4 va 8-kanali DESCRIBE'ga
        javob berib, SDP'da sub oqimni e'lon qilardi, lekin bitta ham paket
        bermasdi. `camera.probe.rtsp_probe.probe` ikkalasini "sog'lom" deb
        ko'rsatgan, bazadagi `sub_codec` ham shundan H265 bo'lib qolgan.
        Shuning uchun tekshiruv paket darajasida.
        """
        try:
            url = build_rtsp_url(cam["ip"], cam["port"] or 554, cam["sub_path"],
                                 cam["username"] or "",
                                 security.decrypt(cam["password_enc"]))
            return sync.kadr_keladimi(url, udp=bool(cam.get("rtsp_udp")))
        except Exception:              # bitta kamera qolganini uzmasin
            return True                # shubhada ayblamaymiz

    def _sub_tasdiqla(self, slugs: list[str]) -> None:
        """Shubhali sub yo'llarni RTSP DESCRIBE bilan tekshirib hukm chiqaradi.

        Kuzatuv "so'raldi-yu kelmadi" deyishi mumkin, lekin buning aybsiz
        sababi ham bor (tomoshabin ulanmay yopib qo'ydi). Tekshiruv esa
        kameraning o'zidan so'raydi: ikkinchi oqim BORMI. Faqat u javob
        bermasa kamera `sub_bad` bo'ladi.

        Alohida oqimda: probe sekin kamerada bir necha soniya kutadi,
        reconciler tsikli esa (u bilan birga muzlash kuzatuvi) turib
        qolmasligi kerak.
        """
        kameralar = [s[: -len(sync.SUB_SUFFIX)] for s in slugs]
        try:
            olik: list[str] = []
            for c in cameras_by_slug(kameralar):
                if self._sub_kadr_beradimi(c):
                    continue
                olik.append(c["slug"])
                log("reconciler", "sub_tekshiruv", level="info", camera=c["slug"],
                    xabar="sub oqimdan kadr kelmadi")
            if olik:
                olik_yollar = [s + sync.SUB_SUFFIX for s in olik]
                with self._lock:
                    self._sub_olik.update(olik_yollar)
                self._sub_belgila(olik_yollar, bad=True)
        finally:
            with self._lock:
                self._sub_tekshiruvda.difference_update(slugs)

    def _sub_tekshiruv_tsikli(self) -> None:
        """Sub bo'yicha davriy ishlar — bitta oqimda, ketma-ket.

        Ikkalasi ham kameraga RTSP ulanish ochadi, shuning uchun parallel
        emas: aks holda bir kameraga bir vaqtda ikki ulanish borib, o'lchov
        o'z natijasini o'zi buzardi.
        """
        self._recheck_sub_bad()
        self._sub_yol_qidir()

    def _sub_yol_qidir(self) -> None:
        """Sub yo'li yozilmagan kameralarda uni TOPIB ko'radi.

        Nima uchun: yo'li bo'sh kamera devorda og'ir asosiy oqimda ochiladi
        (o'lchovda 1,20 o'rniga 7,88 Mbit/s). Kameraning ikkinchi oqimi esa
        ko'pincha bor — shunchaki qo'shishda yozilmagan. Shu o'rnatmada
        o'lchandi: bo'sh 23 kameradan sinalgan 8 tasining 4 tasida sub oqim
        ishlab turgan edi.

        Taxmin ishlab chiqaruvchining nomlash qoidasidan olinadi
        (`camera.probe.rtsp_probe.sub_yol_nomzodlari`), lekin QAT'IY emas: har
        nomzoddan haqiqatda kadr o'qib ko'riladi va faqat bergani yoziladi.
        Shuning uchun noto'g'ri taxmin zarar qilmaydi — u shunchaki
        saqlanmaydi.

        Alohida oqimda va kamdan-kam (SUB_RECHECK) — har nomzod kameraga
        bitta qisqa RTSP ulanish degani.
        """
        kameralar = cameras_without_sub()
        if not kameralar:
            return
        topildi = 0
        for c in kameralar:
            for nomzod in sub_yol_nomzodlari(c["rtsp_path"]):
                try:
                    url = build_rtsp_url(c["ip"], c["port"] or 554, nomzod,
                                         c["username"] or "",
                                         security.decrypt(c["password_enc"]))
                    if not sync.kadr_keladimi(url, udp=bool(c.get("rtsp_udp"))):
                        continue
                except Exception:      # bitta kamera qolganini uzmasin
                    continue
                if set_sub_path(c["slug"], nomzod):
                    topildi += 1
                    log("reconciler", "sub_yol_topildi", camera=c["slug"],
                        sub_path=nomzod,
                        sabab="kamerada ikkinchi oqim bor ekan — devor endi "
                              "og'ir asosiy oqim o'rniga shuni ishlatadi")
                break
        if topildi:
            log("reconciler", "sub_yol_qidiruv", topildi=topildi,
                tekshirilgan=len(kameralar))

    def _recheck_sub_bad(self) -> None:
        """Yaroqsiz deb belgilangan sub oqimlarni qayta sinab ko'radi.

        Busiz bayroq abadiy qolardi: `sub_bad` qo'yilgach mijoz sub'ni
        boshqa so'ramaydi, ya'ni yo'l yaratilmaydi va jonli kuzatuv uni
        hech qachon "tuzalgan" deb ko'ra olmaydi. Operator registratorda
        ikkinchi oqimni yoqsa ham, kimdir QO'LDA bayroqni olishi kerak
        bo'lardi — aynan shu qo'l mehnatidan qutulmoqchimiz.

        Tekshiruv sub oqimdan kadr o'qib ko'rish bilan — DESCRIBE yetarli
        emas (`self._sub_kadr_beradimi` izohiga qarang). Alohida oqimda ishlaydi:
        sekin javob beradigan kameralar tsiklni (va u bilan birga muzlash
        kuzatuvini) ushlab qolmasin.
        """
        kameralar = sub_bad_cameras()
        if not kameralar:
            return
        tuzalgan = [c["slug"] for c in kameralar if self._sub_kadr_beradimi(c)]
        with self._lock:
            self._sub_olik.difference_update(s + sync.SUB_SUFFIX for s in tuzalgan)
        for slug in set_sub_bad(tuzalgan, bad=False):
            log("reconciler", "sub_tiklandi", camera=slug,
                sabab="qayta tekshiruvda sub oqim javob berdi — endi yana "
                      "devorda sub ishlatiladi")

    def _sinov_buyur(self, node_id: int, path: str) -> None:
        """Ochilmayotgan yo'l uchun transport sinovini fonga buyuradi.

        Faqat 1-tugun (backend bilan bitta mashinada): sinov kameraga SHU
        mashinadan ulanadi, uzoq tugundagi kamera esa boshqa tarmoqda —
        bu yerdan o'lchov yolg'on chiqadi.

        `wall_` (mozaika) yo'llari kamera emas, ularda transport degan
        tushuncha yo'q. `_h264` va `_sub` — o'sha kameraning ko'rinishlari,
        shuning uchun asosiy slug bo'yicha sinaladi (transport butun
        qurilmaga tegishli, alohida oqimga emas).
        """
        if node_id != 1 or path.startswith("wall_"):
            return
        slug = path
        for suffix in (sync.TRANSCODE_SUFFIX, sync.SUB_SUFFIX):
            if slug.endswith(suffix):
                slug = slug[: -len(suffix)]
        transport.request(slug)

    def _check_stalls(self, node: dict) -> None:
        """Bayt hisobi STALL_AFTER davomida qo'zg'almasa — oqim muzlagan.

        TCP tekshiruv (health) buni ko'rmaydi: registrator portga javob
        beraveradi, lekin kanal tasvir bermay qolishi mumkin. bytesReceived
        esa yolg'on gapirmaydi.

        O'lchov vaqt bo'yicha, TSIKL bo'yicha emas. Ilgari ketma-ket ikki
        tsikl (5 s) taqqoslanardi va bu soxta signal mashinasi edi: uzun
        GOP'li yoki kam tezlikdagi kamera ma'lumotni portlash bilan yuboradi
        (o'lchov: bitta Dahua kanali har 6-8 soniyada ~675 KB, orada nol), va
        har portlash orasida yo'l "muzladi -> tiklandi" bo'lib jurnalga
        tushardi — 5 soniyalik "muzlash" 12 marta ketma-ket. Tomoshabinga
        SSE orqali `stalled` yuborilardi, ya'ni ishlab turgan kamera
        muammoli bo'lib ko'rinardi.
        """
        node_id = node["id"]
        active = sync.list_active_paths(node["api_base"])
        if active is None:
            return
        now = time.monotonic()
        # Chegaralar Sozlamalar sahifasidan (standart — STALL_AFTER /
        # NOT_READY_AFTER muhit qiymatlari); har tsiklda o'qiladi.
        stall_after = site_settings.get("stall_after_s")
        not_ready_after = site_settings.get("transport_check_after_s")
        changes: list[tuple[str, str, str]] = []     # (ko'rsatma, yo'l, holat)
        tekshirilsin: list[str] = []                 # transport sinoviga nomzodlar
        with self._lock:
            for name, item in active.items():
                key = (node_id, name)
                got = int(item.get("bytesReceived") or 0)
                prev = self._prev_bytes.get(key)
                # "Tayyor emas" holati qancha cho'zilgani — bayt hisobidan
                # MUSTAQIL kuzatiladi. Manba ko'tarilib darhol o'lsa (kamera
                # TCP'ni ko'tarmasa) yo'l hech qachon tayyor bo'lmaydi, bayt
                # esa har urinishda noldan boshlanadi — ya'ni quyidagi
                # muzlash mantig'i buni umuman ko'rmaydi.
                # Nosozlikning ikki ko'rinishi bir xil hisoblanadi: yo'l
                # umuman tayyor bo'lmasligi ham, tayyor bo'lib buzuq kadr
                # berishi ham tomoshabin uchun bitta natija — video yo'q.
                xato = int(item.get("inboundFramesInError") or 0)
                oldingi = self._errors.get(key)
                self._errors[key] = xato
                nosoz = (not item.get("ready")) or (oldingi is not None and xato > oldingi)
                if not nosoz:
                    self._not_ready.pop(key, None)
                else:
                    jami, oxirgi = self._not_ready.get(key, (0.0, now))
                    # Faqat UZLUKSIZ kuzatuv qo'shiladi: yo'l bir necha
                    # tsikl ko'rinmay tursa, o'sha oraliq hisobga kirmaydi.
                    if now - oxirgi <= STALL_INTERVAL * 3:
                        jami += now - oxirgi
                    self._not_ready[key] = (jami, now)
                    if jami >= not_ready_after:
                        tekshirilsin.append(name)
                # Bayt keldi (yoki yo'lni birinchi marta ko'ryapmiz) — hisob
                # noldan boshlanadi. Faqat shu yerda vaqt yangilanadi:
                # o'zgarmagan tsiklda yangilansa muddat hech qachon to'lmasdi.
                if prev is None or got != prev[0]:
                    self._prev_bytes[key] = (got, now)
                    if key in self._stalled:
                        changes.append((self._stalled.pop(key), name, "resumed"))
                    continue
                if not item.get("ready"):
                    # Hali ulanmoqda — bu muzlash emas va hisob ham YURMASIN.
                    # Aks holda sekin ochiladigan kamera (o'lchov: bittasida
                    # relay 15 s da ulangan) tayyor bo'lgan zahoti "muzlagan"
                    # deb belgilanardi: soat u ulanayotgan paytda ishlab
                    # bo'lgan bo'lardi.
                    self._prev_bytes[key] = (got, now)
                    continue
                if now - prev[1] >= stall_after and key not in self._stalled:
                    display = name if node_id == 1 else f"{name}@{node['name']}"
                    self._stalled[key] = display
                    changes.append((display, name, "stalled"))
            for key in list(self._stalled):
                if key[0] == node_id and key[1] not in active:
                    self._stalled.pop(key)                 # oqim yopildi — muzlash tugadi
            for key in [k for k in self._prev_bytes if k[0] == node_id and k[1] not in active]:
                self._prev_bytes.pop(key)
            # Yo'qolgan yo'lning hisobi DARHOL o'chirilmaydi (yuqoridagi
            # izoh) — faqat ancha vaqt ko'rinmagani tashlanadi.
            for key, (_, oxirgi) in list(self._not_ready.items()):
                if key[0] == node_id and now - oxirgi > _NOT_READY_KEEP:
                    self._not_ready.pop(key, None)
                    self._errors.pop(key, None)
            for key in [k for k in self._errors if k[0] == node_id and k[1] not in active]:
                self._errors.pop(key, None)
        # Ro'yxat allaqachon qo'lda — ikkinchi API so'rovi shart emas.
        self._check_sub_health(node, active)
        self._record_resolutions(active)
        # Qulfdan TASHQARIDA: sinovning o'zi fon thread'ida ketadi, lekin
        # navbatga qo'yish ham reconciler qulfini ushlab turmasin.
        for name in tekshirilsin:
            self._sinov_buyur(node_id, name)
        if not changes:
            return
        at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with get_db() as db:
            for display, name, kind in changes:
                events.add(db, kind, path=display,
                           detail="oqim muzladi" if kind == "stalled" else "oqim tiklandi")
                log("reconciler", f"stream_{kind}",
                    level="warning" if kind == "stalled" else "info", path=display)

                # SSE: yo'l nomidan kamera topiladi (suffikslar olib tashlanadi).
                # `resumed` tashqariga `online` bo'lib chiqadi — abonent uchun
                # holat lug'ati bitta: online/offline/stalled.
                #
                # SUB oqim muzlashi kamera holatini o'zgartirmaydi: sub faqat
                # devor kataklari uchun, asosiy oqim ishlab tursa kamera muammoli
                # emas (camera_state ham shunday hisoblaydi). Hodisa jurnalda
                # qoladi (yuqorida yozildi), lekin tomoshabinga stalled yuborilmaydi.
                if name.endswith(sync.SUB_SUFFIX):
                    continue
                base = name
                for suffix in (sync.TRANSCODE_SUFFIX, sync.SUB_SUFFIX):
                    if base.endswith(suffix):
                        base = base[: -len(suffix)]
                row = cameras_db.get_by_slug(db, base)
                if row:
                    bus.publish("state", {
                        "id": row["id"],
                        "external_id": row["external_id"] or "",
                        "state": "stalled" if kind == "stalled" else "online",
                        "at": at,
                    })

    def _record_resolutions(self, active: dict[str, dict]) -> None:
        """Ochiq asosiy oqimlarning haqiqiy o'lchamini bazaga yozadi (format).

        Sub oqim olinmaydi — u boshqa (kichik) o'lchamda. `_h264` (o'girilgan)
        yo'l asl o'lchamni saqlaydi (transcode masshtablamaydi). Bazaga faqat
        yangi yoki o'zgargan qiymat ketadi.
        """
        found: dict[str, str] = {}
        for name, item in active.items():
            if name.endswith(sync.SUB_SUFFIX):
                continue
            resolution = stream_resolution(item)
            if not resolution:
                continue
            slug = name[: -len(sync.TRANSCODE_SUFFIX)] if name.endswith(sync.TRANSCODE_SUFFIX) else name
            if self._resolutions.get(slug) != resolution:
                found[slug] = resolution
        if not found:
            return
        try:
            with get_db() as db:
                changed = cameras_db.set_resolutions(db, found)
        except Exception as exc:                  # baza band — keyingi tsiklda qayta
            log("reconciler", "resolution_save_failed", level="warning", error=str(exc))
            return
        self._resolutions.update(found)
        if changed:
            log("reconciler", "resolution_updated", cameras=changed)

    def _tick(self, load_cameras: Callable[[], list[dict]], announce: bool) -> bool:
        """Bitta tekshiruv (barcha tugunlar). Sinxron bajarilsa True qaytaradi."""
        cameras = load_cameras()
        synced = False
        for node in self._nodes():
            api = node["api_base"]
            local = sync.is_local_api(api)
            status = sync.api_status(api)
            if status == sync.FOREIGN:
                # Begona instansiya: kelishtirmaymiz HAM, o'zimiznikini
                # ko'tarmaymiz ham. Ko'targanda ham foyda yo'q — API porti
                # band, yangi jarayon darhol o'lardi va biz uni har tsiklda
                # qayta urintirardik.
                self._warn_foreign(node, api)
                with self._lock:
                    self._reachable.discard(node["id"])
                continue
            if status != "ok":
                if not (local and self._autostart_allowed() and self._spawn()):
                    with self._lock:
                        self._reachable.discard(node["id"])
                    continue
            with self._lock:
                self._reachable.add(node["id"])
            node_cams = [c for c in cameras
                         if (c.get("node_id") or 1) == node["id"]]
            result = sync.push_to_api(node_cams, api_base=api)
            self._note_pending(node, result.get("pending", 0))
            changed = result["added"] + result["updated"] + result["removed"]
            if announce or changed or not result["ok"]:
                log("reconciler", "sync",
                    level="info" if result["ok"] else "warning",
                    node=node["name"], added=result["added"],
                    updated=result["updated"], removed=result["removed"],
                    message=result["message"])
            synced = synced or result["ok"]
        return synced

    def _watch_active(self) -> None:
        """Faqat muzlash tekshiruvi — to'liq sinxronsiz, tez tsikl uchun.

        Faol yo'llar ro'yxati kichik (yo'llar talab bo'yicha yaratilgani
        uchun MediaMTX'da faqat ko'rilayotganlari turadi), shuning uchun buni
        5000 kamerada ham 5 soniyada bir chaqirish arzon.

        Javob bermayotgan tugun o'tkazib yuboriladi: aks holda har tsikl
        uning timeout'ini (4 s) kutib o'tirardi. Uni to'liq sinxron
        (`self._tick`) qayta sinaydi.
        """
        with self._lock:
            alive = set(self._reachable)
        for node in self._nodes():
            if node["id"] in alive:
                self._check_stalls(node)

    def _loop(self, load_cameras: Callable[[], list[dict]]) -> None:
        announced = False              # birinchi muvaffaqiyatli sinxron logda ko'rinsin
        last_prune = 0.0
        last_sync = 0.0
        # Birinchi tekshiruv darhol emas: ishga tushishda kameralar hali
        # ulanmagan bo'lishi mumkin va hammasi "tuzalmagan" bo'lib chiqardi.
        #
        # Lekin TO'LIQ muddat (6 soat) ham uzoq: yangi versiya qo'yilganda
        # bazada eski, NOTO'G'RI `sub_bad` bayroqlari qolgan bo'lishi mumkin
        # (ilgari pleyer har qotishda belgilardi) va ular devorni og'ir
        # asosiy oqimga o'tkazib turadi. Shu o'rnatmada o'lchandi: 32 ta
        # belgilangan kameradan 29 tasi tekshiruvda SOG'LOM chiqdi.
        # Shuning uchun birinchi tekshiruv ishga tushgandan ko'p o'tmay.
        last_sub_recheck = time.monotonic() - SUB_RECHECK + SUB_FIRST_RECHECK
        while True:
            try:
                now = time.monotonic()
                if not last_sync or now - last_sync >= CHECK_INTERVAL:
                    last_sync = now
                    if self._tick(load_cameras, not announced):
                        announced = True
                    if now - last_prune > PRUNE_INTERVAL:
                        last_prune = now
                        with get_db() as db:
                            events.prune(db)
                        # MediaMTX logi: chegaradan oshsa arxivga, eski arxivlar o'chadi.
                        if mtx_log.rotate_if_large():
                            log("reconciler", "mediamtx_log_rotated")
                        mtx_log.cleanup()
                    if now - last_sub_recheck >= SUB_RECHECK:
                        last_sub_recheck = now
                        threading.Thread(target=self._sub_tekshiruv_tsikli,
                                         daemon=True).start()
                # Muzlash tekshiruvi har tsiklda — to'liq sinxrondan ancha
                # tez-tez. Tomoshabin bor oqim qotganini 60 soniyada emas,
                # 5-10 soniyada bilamiz.
                self._watch_active()
            except Exception as exc:   # kuzatuv hech qachon yiqilmasin
                log("reconciler", "tick_failed", level="error", error=str(exc))
            time.sleep(STALL_INTERVAL)

    def start(self, load_cameras: Callable[[], list[dict]]) -> None:
        """Fon reconcilerini ishga tushiradi (bir marta).

        `load_cameras` — kameralarning MediaMTX ko'rinishini qaytaruvchi
        funksiya; uni app qatlami uzatadi (media qatlami bazaga sxema
        darajasida bog'lanmasin).
        """
        with self._lock:
            if self._started:
                return
            self._started = True
        threading.Thread(target=self._loop, args=(load_cameras,), daemon=True).start()


# Yagona nusxa: jarayonda bitta xizmat ishlaydi.
service = Reconciler()
stalled_paths = service.stalled_paths
stalled_count = service.stalled_count
pending_count = service.pending_count
foreign_nodes = service.foreign_nodes
start = service.start
