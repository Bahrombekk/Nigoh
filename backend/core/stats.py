"""Nigoh — dashboard uchun tarixiy statistika.

Kamera holatlarini mikroservis o'lchaydi (`state` maydoni), ammo u tarix
yuritmaydi — bu modul har daqiqalik kuzatuv natijasini bazaga yozib boradi:

  * stats_region — har 5 daqiqada hudud kesimida nechta kamera onlayn edi
  * stats_event  — kamera uzildi/qayta ulandi hodisalari (aniq vaqti bilan)

Shu ikkovidan dashboard 24 soatlik grafik, 7 kunlik kunlik ko'rsatkichlar
va hudud kesimidagi statistikani chiqaradi. Hajm nazorati: 12 hudud bilan
sutkada ~3,5 ming qator, 30 kundan eskisi o'chirib boriladi.
"""
import threading
import time
from datetime import datetime, timedelta, timezone

from database import get_db
from database import stats as stats_db

from . import alerts

SNAPSHOT_INTERVAL = 300.0   # soniya — 5 daqiqa: sutkada 288 nuqta yetarli
KEEP_DAYS = 30              # tarix shundan eski bo'lsa o'chiriladi

_prev: dict[int, bool] = {}    # kamera id → oxirgi ma'lum holat
_last_snapshot = 0.0
_lock = threading.Lock()


def record_states(cameras: list[dict]) -> None:
    """Mikroservisdan olingan holatlarni tarixga yozadi (har daqiqa).

    `cameras`: [{"id", "name", "region", "organization_id", "admin_area_id",
    "online": True|False|None}].
    `online=None` — holati o'lchanmaydiganlar (unknown/disabled), ular
    statistikaga kirmaydi — foizlar faqat kuzatiladigan kameralar ustidan
    hisoblanadi.
    """
    global _last_snapshot
    now = datetime.now(timezone.utc)

    with get_db() as db:
        # 1) Holat o'zgarishlari — hodisa sifatida (aniq vaqti bilan).
        changes: list[tuple] = []
        with _lock:
            ids = {cam["id"] for cam in cameras}
            for cam_id in list(_prev):
                if cam_id not in ids:
                    _prev.pop(cam_id)
            for cam in cameras:
                online = cam["online"]
                if online is None:
                    continue
                prev = _prev.get(cam["id"])
                if prev is not None and prev != online:
                    changes.append((now, cam["id"], cam["name"], cam["region"],
                                    "online" if online else "offline"))
                _prev[cam["id"]] = online
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
        if time.time() - _last_snapshot < SNAPSHOT_INTERVAL:
            return
        _last_snapshot = time.time()

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
