"""So'rov konteksti: har log yozuviga avtomatik qo'shiladigan maydonlar.

HTTP so'rov kelganda middleware (app/factory.py) `request_id` beradi va
shu so'rov davomida yozilgan HAMMA log yozuvi (qaysi modul yozmasin) o'sha
ID bilan chiqadi. "Foydalanuvchi xato ko'rdi" degan shikoyatda javobdagi
`X-Request-ID` sarlavhasi bo'yicha access, security va errors loglaridan
butun zanjirni topish mumkin: `/admin/logs?request_id=...`.

contextvars — thread va asyncio uchun xavfsiz: parallel so'rovlar bir-
birining ID'sini ko'rmaydi. Fon thread'larida (health, reconciler) ID yo'q.

Tarkibi:
    new_request_id()            qisqa tasodifiy ID (12 belgi)
    bind(**fields) -> token     joriy kontekstga maydon qo'shadi
    reset(token)                bind'ni bekor qiladi
    current() -> dict           joriy kontekst maydonlari (formatter oladi)

Kim ishlatadi: app/factory.py (access middleware), core/logs/formatters.py.
"""
from __future__ import annotations

import secrets
from contextvars import ContextVar, Token

_context: ContextVar[dict] = ContextVar("nigoh_log_context", default={})


def new_request_id() -> str:
    return secrets.token_hex(6)


def bind(**fields) -> Token:
    return _context.set({**_context.get(), **fields})


def reset(token: Token) -> None:
    _context.reset(token)


def current() -> dict:
    return _context.get()
