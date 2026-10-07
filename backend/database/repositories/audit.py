"""Audit jurnali repozitoriysi — audit_log (faqat yoziladi).

Kim, qachon, nimani o'zgartirdi: sozlamalar, foydalanuvchilar, guruhlar.
Jadval o'zgartirilmaydi va o'chirilmaydi (forbid_change trigger) — shuning
uchun bu yerda faqat `add` va o'qish bor.

Tarkibi:
    AuditRepository
        .add(db, actor, action, entity, entity_id=, before=, after=, user_id=, ip=)
        .recent(db, limit, entity=None)   eng yangisi birinchi

Jadvallar: audit_log (0002_schema_v2.py; FK — 0005_app_settings.py)
Kim ishlatadi: app/audit.py.
"""
from __future__ import annotations

from psycopg.types.json import Jsonb


class AuditRepository:
    """audit_log — o'zgarishlar jurnali."""

    def add(self, db, actor: str, action: str, entity: str, *, entity_id=None,
            before=None, after=None, user_id: int | None = None, ip: str | None = None) -> None:
        db.execute(
            "INSERT INTO audit_log (actor, action, entity, entity_id, before, after, user_id, ip) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (actor, action, entity, None if entity_id is None else str(entity_id),
             None if before is None else Jsonb(before), None if after is None else Jsonb(after),
             user_id, ip))

    def recent(self, db, limit: int = 100, entity: str | None = None) -> list:
        where, params = "", []
        if entity:
            where, params = "WHERE entity = %s", [entity]
        return db.execute(
            f"SELECT id, ts, actor, action, entity, entity_id, before, after, ip "
            f"FROM audit_log {where} ORDER BY id DESC LIMIT %s", params + [limit]).fetchall()
