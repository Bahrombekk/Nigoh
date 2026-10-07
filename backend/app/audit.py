"""Audit — kim, qachon, nimani o'zgartirdi (audit_log jadvaliga).

Super-admin "Sozlamalar → Tizim" bo'limida ko'rinadi. Yoziladi: sayt
sozlamalari, foydalanuvchilar (yaratish, o'zgartirish, o'chirish) va
kamera guruhlari (yaratish, o'zgartirish, o'chirish).

Parollar va xeshlar hech qachon yozilmaydi — chaqiruvchi faqat ochiq
maydonlarni beradi (masalan foydalanuvchida "parol o'zgardi: ha").

Tarkibi:
    actor_of(request)       (login yoki "api-kalit", user_id)
    record(db, request, action, entity, entity_id=, before=, after=)
                            yozuv qo'shadi — joriy tranzaksiyada (amal
                            bekor bo'lsa audit ham yozilmaydi)

Ishlatadi: database.audit, users.access, app.network (client_ip).
Kim ishlatadi: app/settings_api.py, users/admin_api.py, groups/api.py.
"""
from __future__ import annotations

from fastapi import Request

from app.network import client_ip
from database import audit
from users.access import api_key_ok, current_user


def actor_of(request: Request) -> tuple[str, int | None]:
    if api_key_ok(request):
        return "api-kalit", None
    user = current_user(request)
    return (user["username"], user["id"]) if user else ("mehmon", None)


def record(db, request: Request, action: str, entity: str, *, entity_id=None,
           before=None, after=None) -> None:
    actor, uid = actor_of(request)
    audit.add(db, actor, action, entity, entity_id=entity_id, before=before, after=after,
              user_id=uid, ip=client_ip(request))
