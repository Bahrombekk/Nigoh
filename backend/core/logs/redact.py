"""Maxfiy ma'lumotni logga tushishdan oldin yashirish.

Log fayllar zaxiraga, boshqa odamlarga, tashqi tizimga (Loki, OpenSearch)
ketadi — ichida parol bo'lsa u ham ketadi. Shuning uchun yashirish YOZISH
paytida, bitta joyda qilinadi, chaqiruvchining ehtiyotkorligiga tayanmay:

  * kalit nomi maxfiy bo'lsa (password, parol, token, secret, api_key,
    authorization, cookie, password_enc ...) — qiymat "***";
  * har qanday satrdagi URL ichidagi login:parol — `rtsp://admin:12345@ip`
    -> `rtsp://admin:***@ip` (kamera manzillari xato matnlarida ko'p uchraydi);
  * so'rov qatoridagi `token=...`, `key=...`, `password=...` — "***".

Tarkibi:
    redact(value)          dict/list/satrni rekursiv tozalaydi (asl obyekt o'zgarmaydi)
    redact_text(text)      bitta satr uchun
    SECRET_KEYS            maxfiy deb hisoblanadigan kalit bo'laklari

Kim ishlatadi: core/logs/formatters.py.
"""
from __future__ import annotations

import re

SECRET_KEYS = ("password", "parol", "passwd", "secret", "token", "api_key", "apikey",
               "authorization", "cookie", "password_enc", "session", "credential")

_URL_CREDS = re.compile(r"(?P<scheme>[a-z][a-z0-9+.-]*://)(?P<user>[^:/@\s]+):(?P<pw>[^@/\s]+)@",
                        re.IGNORECASE)
_QUERY_SECRET = re.compile(r"(?P<key>\b(?:token|key|api_key|password|parol|session)=)[^&\s\"']+",
                           re.IGNORECASE)


def _secret_key(key: str) -> bool:
    k = key.lower()
    return any(s in k for s in SECRET_KEYS)


def redact_text(text: str) -> str:
    text = _URL_CREDS.sub(lambda m: f"{m['scheme']}{m['user']}:***@", text)
    return _QUERY_SECRET.sub(lambda m: f"{m['key']}***", text)


def redact(value, _depth: int = 0):
    if _depth > 6:
        return value
    if isinstance(value, dict):
        return {k: ("***" if _secret_key(str(k)) and v not in (None, "") else redact(v, _depth + 1))
                for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [redact(v, _depth + 1) for v in value]
    if isinstance(value, str):
        return redact_text(value)
    return value
