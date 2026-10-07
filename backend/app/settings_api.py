"""Super-admin: sayt sozlamalari va audit jurnali API'si.

Endpointlar (require_admin; prefiks /api/v1, eski /api):
    GET  /api/v1/admin/settings     sozlamalar: ta'rif, joriy va standart qiymat,
                                    kim/qachon o'zgartirgan
    PUT  /api/v1/admin/settings     {"values": {kalit: qiymat | null}} — null
                                    standartga qaytaradi; bittasi xato bo'lsa
                                    hech biri saqlanmaydi (422)
    GET  /api/v1/admin/audit        o'zgarishlar jurnali (?limit=, ?entity=)

Sozlamalar server qayta ishga tushmasdan qo'llanadi (app/settings.py).

Tarkibi:
    router          APIRouter(prefix="/admin", tags=["admin"])
    SettingsIn      {"values": {...}}

Ishlatadi: app.settings, app.audit, database (audit, get_db), users.access.
Kim ishlatadi: app/factory.py (key_guard bilan), frontend admin/settings.js,
    tests/test_settings.py.
"""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app import audit as audit_log
from app.settings import site_settings
from database import audit, get_db
from users.access import require_admin

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


class SettingsIn(BaseModel):
    values: dict[str, Any] = Field(min_length=1, max_length=50)


@router.get("/settings")
def get_settings():
    with get_db() as db:
        return {"settings": site_settings.view(db)}


@router.put("/settings")
def put_settings(body: SettingsIn, request: Request):
    actor, _ = audit_log.actor_of(request)
    with get_db() as db:
        try:
            before, after = site_settings.update(db, body.values, actor)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
        if after:
            audit_log.record(db, request, "settings.update", "settings", before=before, after=after)
    # Tranzaksiya yopilgandan keyin ham: shu orada boshqa so'rov eski qiymatni
    # keshga olgan bo'lishi mumkin.
    site_settings.invalidate()
    with get_db() as db:
        return {"changed": sorted(after), "settings": site_settings.view(db)}


@router.get("/audit")
def get_audit(limit: int = Query(default=100, ge=1, le=1000),
              entity: str | None = Query(default=None, max_length=40)):
    with get_db() as db:
        rows = audit.recent(db, limit, entity)
    return {"items": [{"id": r["id"], "ts": r["ts"], "actor": r["actor"], "action": r["action"],
                       "entity": r["entity"], "entity_id": r["entity_id"],
                       "before": r["before"], "after": r["after"], "ip": r["ip"]} for r in rows]}
