"""Nigoh — bildirishnomalar API'si (/notifications).

Endpointlar (require_user — mehmonga yopiq; prefiks /api/v1, eski /api):
    GET  /api/v1/notifications?type=all|outage|system&limit=50&before=<id>
            {"items": [{id, type, title, text, ts, camera_id, severity, read}],
             "unread": n, "counts": {"all", "outage", "system"}}
            id — "e123" (kamera hodisasi) yoki "s7" (tizim); `before` — shu
            id dan eskilari (sahifalash). unread/counts — oxirgi 7 kun.
    POST /api/v1/notifications/read   {"ids": [...]} yoki {"all": true} -> {"unread": n}

Operator va kuzatuvchi faqat o'z hududlaridagi kamera hodisalarini ko'radi.

Tarkibi:
    router          APIRouter(prefix="/notifications", tags=["notifications"])
    ReadIn          {"ids": [...], "all": bool}

Ishlatadi: notifications.service, users.access.
Kim ishlatadi: app/factory.py (require_user bilan), tests/test_v3_notifications.py.
"""
import re
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from notifications import service
from users.access import allowed_areas, api_key_ok, current_user

router = APIRouter(prefix="/notifications", tags=["notifications"])

_ID = r"^[es][0-9]{1,18}$"


class ReadIn(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=1000)
    all: bool = False


def _user_id(request: Request) -> int | None:
    """Sessiya egasi; API kaliti — None (o'qilganlik saqlanmaydi)."""
    if api_key_ok(request):
        return None
    user = current_user(request)
    if user is None:                        # require_user o'tkazmaydi, baribir
        raise HTTPException(401, "Avval tizimga kiring")
    return user["id"]


@router.get("")
def list_notifications(request: Request,
                       type: Literal["all", "outage", "system"] = "all",
                       limit: int = Query(default=50, ge=1, le=200),
                       before: str | None = Query(default=None, pattern=_ID)):
    uid = _user_id(request)
    return service.feed(uid, allowed_areas(request), type, limit, before)


@router.post("/read")
def read_notifications(body: ReadIn, request: Request):
    bad = [i for i in body.ids if not re.match(_ID, i)]
    if bad:
        raise HTTPException(422, f"Notoʻgʻri id: {', '.join(bad[:5])}")
    if not body.all and not body.ids:
        raise HTTPException(422, "ids yoki all: true bering")
    uid = _user_id(request)
    return service.mark_read(uid, allowed_areas(request), list(dict.fromkeys(body.ids)), body.all)
