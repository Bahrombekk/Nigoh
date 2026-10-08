"""Bildirishnomalar lentasi: kamera uzilishlari + tizim bildirishnomalari, o'qilganlik.

Kamera hodisasi (`camera_events` online/offline, health yozadi):
    offline  sarlavha "<kamera> uzildi"; matn — hali uzilgan bo'lsa
             "<hudud> · 17 kundan beri javob yoʻq", tiklangan bo'lsa
             "<hudud> · 5 daqiqadan keyin tiklandi"
    online   sarlavha "<kamera> qayta ulandi"; matn "<hudud> · 1 daqiqa uzilish"
             (oldingi o'tish offline bo'lsa, aks holda "<hudud> · qayta ulandi")
Tizim bildirishnomasi — `system_alerts` (notifications/alerts.py yozadi).

Operator va kuzatuvchi faqat o'z hududlaridagi kamera hodisalarini ko'radi
(tizim bildirishnomalari hammaga). `notify_outage` sozlamasi o'chiq bo'lsa
kamera hodisalari lentaga kirmaydi. `unread`/`counts` — faqat oxirgi
UNREAD_DAYS (7) kun. API kaliti (foydalanuvchisiz) uchun o'qilganlik
saqlanmaydi — hammasi o'qilmagan.

Tarkibi:
    feed(user_id, area_ids, kind, limit, before)   GET /notifications javobi
    mark_read(user_id, area_ids, ids, all_)        POST /notifications/read javobi
    duration_text(seconds)                         "5 daqiqa" / "3 soat" / "17 kun"
    UNREAD_DAYS

Ishlatadi: app.settings (notify_outage), database (notifications, users, get_db).
Kim ishlatadi: notifications/api.py, tests/test_v3_notifications.py.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.settings import site_settings
from database import get_db, notifications, users

UNREAD_DAYS = 7
_TYPES = {"all": ("outage", "system"), "outage": ("outage",), "system": ("system",)}


def duration_text(seconds: float) -> str:
    """Davomiylik: "5 daqiqa", "3 soat", "17 kun" (eng yirik butun birlik)."""
    s = max(0, int(seconds))
    if s < 3600:
        return f"{max(1, s // 60)} daqiqa"
    if s < 86400:
        return f"{s // 3600} soat"
    return f"{s // 86400} kun"


def _since_text(seconds: float) -> str:
    """"5 daqiqadan", "3 soatdan", "17 kundan" — "... beri" / "... keyin" uchun."""
    return duration_text(seconds) + "dan"


def _iso(ts: datetime) -> str:
    return ts.astimezone(timezone.utc).isoformat(timespec="seconds")


def _camera_item(r, now: datetime) -> dict:
    region = r["region"]
    if r["kind"] == "offline":
        if r["next_kind"] == "online":
            text = f"{region} · {_since_text((r['next_ts'] - r['ts']).total_seconds())} keyin tiklandi"
        elif r["next_kind"] is None:
            text = f"{region} · {_since_text((now - r['ts']).total_seconds())} beri javob yoʻq"
        else:
            text = f"{region} · javob bermadi"
        title, severity = f"{r['name']} uzildi", "error"
    else:
        if r["prev_kind"] == "offline":
            text = f"{region} · {duration_text((r['ts'] - r['prev_ts']).total_seconds())} uzilish"
        else:
            text = f"{region} · qayta ulandi"
        title, severity = f"{r['name']} qayta ulandi", "success"
    return {"id": f"e{r['id']}", "type": r["kind"], "title": title, "text": text,
            "ts": _iso(r["ts"]), "camera_id": r["camera_id"], "severity": severity,
            "read": bool(r["read"]), "_key": (r["ts"], notifications.CAMERA, r["id"])}


def _system_item(r) -> dict:
    return {"id": f"s{r['id']}", "type": "system", "title": r["title"], "text": r["text"],
            "ts": _iso(r["ts"]), "camera_id": None, "severity": r["severity"],
            "read": bool(r["read"]), "_key": (r["ts"], notifications.SYSTEM, r["id"])}


def _counts(db, user_id, rb, area_ids, outage: bool) -> tuple[int, dict]:
    since = datetime.now(timezone.utc) - timedelta(days=UNREAD_DAYS)
    n = notifications.unread_counts(db, user_id=user_id, rb=rb, area_ids=area_ids,
                                    since=since, outage=outage)
    return n["outage"] + n["system"], {"all": n["outage"] + n["system"], **n}


def feed(user_id: int | None, area_ids: list[int] | None, kind: str = "all",
         limit: int = 50, before: str | None = None) -> dict:
    """Lenta (yangisi birinchi), o'qilmaganlar soni va turlar bo'yicha sanoq."""
    outage = bool(site_settings.get("notify_outage"))
    sources = _TYPES.get(kind, _TYPES["all"])
    now = datetime.now(timezone.utc)
    with get_db() as db:
        rb = users.notif_read_before(db, user_id) if user_id else None
        cursor = notifications.item_cursor(db, before) if before else None
        items: list[dict] = []
        if before and cursor is None:
            items = []                       # noma'lum kursor — bo'sh sahifa
        else:
            if "outage" in sources and outage and area_ids != []:
                items += [_camera_item(r, now) for r in notifications.camera_items(
                    db, area_ids=area_ids, cursor=cursor, limit=limit, user_id=user_id, rb=rb)]
            if "system" in sources:
                items += [_system_item(r) for r in notifications.system_items(
                    db, cursor=cursor, limit=limit, user_id=user_id, rb=rb)]
        unread, counts = _counts(db, user_id, rb, area_ids, outage and area_ids != [])
    items.sort(key=lambda i: i["_key"], reverse=True)
    items = items[:limit]
    for item in items:
        item.pop("_key")
    return {"items": items, "unread": unread, "counts": counts}


def mark_read(user_id: int | None, area_ids: list[int] | None, ids: list[str],
              all_: bool) -> dict:
    """O'qildi deb belgilaydi; qaytadi — yangi o'qilmaganlar soni."""
    outage = bool(site_settings.get("notify_outage")) and area_ids != []
    with get_db() as db:
        if user_id:
            if all_:
                users.set_notif_read_before(db, user_id, datetime.now(timezone.utc))
            elif ids:
                notifications.mark_read(db, user_id, ids)
        rb = users.notif_read_before(db, user_id) if user_id else None
        unread, _ = _counts(db, user_id, rb, area_ids, outage)
    return {"unread": unread}
