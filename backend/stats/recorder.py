"""Nigoh — dashboard uchun tarixiy statistikani yozib borish.

Kamera holatini health va reconciler o'lchaydi (`camera.state.camera_state`
— xaritadagi rang bilan bir xil manba), ammo ular tarix yuritmaydi — bu
modul har daqiqalik kuzatuv natijasini bazaga yozib boradi:

  * availability_snapshots — har 5 daqiqada hudud kesimida (tashkilot +
    admin_area) nechta kamera kuzatildi va nechtasi onlayn edi;
  * status_changes — kamera uzildi/qayta ulandi hodisalari (aniq vaqti bilan).

Shu ikkovidan dashboard 24 soatlik grafik, 7 kunlik kunlik ko'rsatkichlar
va hudud kesimidagi statistikani chiqaradi (stats/api.py). Hajm nazorati:
12 hudud bilan sutkada ~3,5 ming qator, 30 kundan eskisi o'chirib boriladi.

Qoidalar: unknown/disabled kameralar foizlarga kirmaydi (holati
o'lchanmaydi); stalled (port ochiq-u tasvir yo'q) — onlayn emas. Bitta
kuzatuvdagi barcha o'zgarishlar Telegram'ga (sozlangan bo'lsa) bitta
xabarda ketadi. Birinchi yozuv birinchi health sweep tugashiga vaqt berib,
60 s dan keyin; fon sikli hech qachon yiqilmaydi — xato jurnalga yoziladi.

Tarkibi:
    StatsRecorder                   tarix yozuvchi xizmat
        .record_states(cameras)     holatlar ro'yxatini tarixga yozadi:
                                    o'zgarishlar, 5 daqiqalik surat, tozalash
        .start_recorder()           fon thread'ini bir marta ishga tushiradi
    service                         yagona nusxa (jarayonda bitta xizmat)
    record_states, start_recorder   service metodlariga taxalluslar
    SNAPSHOT_INTERVAL               surat oralig'i — 300 s (sutkada 288 nuqta)
    RECORD_INTERVAL                 kuzatuv oralig'i — 60 s
    KEEP_DAYS                       tarix saqlanish muddati — 30 kun

Ishlatadi: database (cameras, stats), camera.state, core.alerts, core.log.
Kim ishlatadi: app/bootstrap.py (`start_recorder()`).
"""
import threading
import time
from datetime import datetime, timedelta, timezone

from camera.state import camera_state
from core import alerts
from core.log import log
from database import cameras, get_db
from database import stats as stats_db

SNAPSHOT_INTERVAL = 300.0   # soniya — 5 daqiqa: sutkada 288 nuqta yetarli
KEEP_DAYS = 30              # tarix shundan eski bo'lsa o'chiriladi


# ---------- tarixni yozib borish ----------

RECORD_INTERVAL = 60.0


class StatsRecorder:
    """Kamera holatlarini dashboard tarixiga yozadi: 5 daqiqalik surat va o'zgarishlar."""

    def __init__(self) -> None:
        self._prev: dict[int, bool] = {}    # kamera id → oxirgi ma'lum holat
        self._last_snapshot = 0.0
        self._lock = threading.Lock()
        self._recorder_started = False

    def record_states(self, cameras: list[dict]) -> None:
        """Mikroservisdan olingan holatlarni tarixga yozadi (har daqiqa).

        `cameras`: [{"id", "name", "region", "organization_id", "admin_area_id",
        "online": True|False|None}].
        `online=None` — holati o'lchanmaydiganlar (unknown/disabled), ular
        statistikaga kirmaydi — foizlar faqat kuzatiladigan kameralar ustidan
        hisoblanadi.
        """
        now = datetime.now(timezone.utc)

        with get_db() as db:
            # 1) Holat o'zgarishlari — hodisa sifatida (aniq vaqti bilan).
            changes: list[tuple] = []
            with self._lock:
                ids = {cam["id"] for cam in cameras}
                for cam_id in list(self._prev):
                    if cam_id not in ids:
                        self._prev.pop(cam_id)
                for cam in cameras:
                    online = cam["online"]
                    if online is None:
                        continue
                    prev = self._prev.get(cam["id"])
                    if prev is not None and prev != online:
                        changes.append((now, cam["id"], cam["name"], cam["region"],
                                        "online" if online else "offline"))
                    self._prev[cam["id"]] = online
            if changes:
                stats_db.add_status_changes(db, [(ts, cid, kind)
                                                 for ts, cid, _, _, kind in changes])
                # Telegram sozlangan bo'lsa (TELEGRAM_BOT_TOKEN/CHAT_ID) —
                # bitta kuzatuvdagi barcha o'zgarishlar bitta xabarda ketadi.
                alerts.send_async("\n".join(
                    f"{'🟢 qaytdi' if kind == 'online' else '🔴 uzildi'}: "
                    f"{name} ({region})"
                    for _, _, name, region, kind in changes))

            # 2) Hudud kesimidagi surat — har 5 daqiqada bitta.
            if time.time() - self._last_snapshot < SNAPSHOT_INTERVAL:
                return
            self._last_snapshot = time.time()

            by_area: dict[tuple[int, int | None], list[bool]] = {}
            for cam in cameras:
                if cam["online"] is None:
                    continue
                key = (cam["organization_id"], cam["admin_area_id"])
                by_area.setdefault(key, []).append(cam["online"])
            if by_area:
                stats_db.add_snapshot(db, now, [(org, area, len(v), sum(v))
                                                for (org, area), v in by_area.items()])

            stats_db.prune(db, now - timedelta(days=KEEP_DAYS))

    def _record_once(self) -> None:
        with get_db() as db:
            rows = cameras.list_all(db)
        snapshot = []
        for row in rows:
            state = camera_state(row)
            # unknown/disabled — holati o'lchanmaydi, foizlarga kirmaydi;
            # stalled — port ochiq-u tasvir yo'q, ya'ni ishlamayapti.
            online = None if state in ("unknown", "disabled") else state == "online"
            snapshot.append({"id": row["id"], "name": row["name"], "region": row["region"],
                             "organization_id": row["organization_id"],
                             "admin_area_id": row["admin_area_id"], "online": online})
        self.record_states(snapshot)

    def _recorder_loop(self) -> None:
        while True:
            time.sleep(RECORD_INTERVAL)   # birinchi sweep tugashiga vaqt beriladi
            try:
                self._record_once()
            except Exception as exc:       # kuzatuv hech qachon yiqilmasin
                log("stats", "record_failed", level="error", error=str(exc))

    def start_recorder(self) -> None:
        """Dashboard tarixini fonda yozib boradi (bir marta ishga tushadi)."""
        if self._recorder_started:
            return
        self._recorder_started = True
        threading.Thread(target=self._recorder_loop, name="stats-recorder",
                         daemon=True).start()


# Yagona nusxa: jarayonda bitta xizmat ishlaydi.
service = StatsRecorder()
record_states = service.record_states
start_recorder = service.start_recorder
