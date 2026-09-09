"""Nigoh — routelar o'rtasida umumiy yordamchilar.

Kamera/media tarjimasi endi bu yerda emas — u mikroservisda. Bu modulda
faqat kirish nazorati qoldi: sessiya, rollar va hudud cheklovi.
"""
import hmac

from fastapi import HTTPException, Request

from core import security
from core.db import get_db

from .config import API_KEY, PUBLIC_VIEW


def api_key_ok(request: Request) -> bool:
    """Server-to-server kirish: `X-API-Key` sarlavhasi to'g'rimi.

    Tashqi backend (o'z foydalanuvchi/rol tizimi bor tizim) shu kalit
    bilan to'liq kiradi — ruxsatlarni o'zi hal qiladi.
    """
    if not API_KEY:
        return False
    supplied = request.headers.get("x-api-key", "")
    return bool(supplied) and hmac.compare_digest(supplied, API_KEY)


def current_user(request: Request):
    """Sessiyadagi foydalanuvchi (admin yoki operator), bo'lmasa None."""
    token = request.cookies.get(security.SESSION_COOKIE)
    with get_db() as db:
        return security.session_admin(db, token)


def require_admin(request: Request):
    """Boshqaruv endpointlari uchun: admin roli yoki to'g'ri API kalit."""
    if api_key_ok(request):
        return {"id": 0, "username": "api", "role": "admin"}
    user = current_user(request)
    if user is None:
        raise HTTPException(401, "Avval super-admin sifatida kiring")
    if user["role"] != "admin":
        raise HTTPException(403, "Bu bo'lim faqat admin uchun")
    return user


def allowed_regions(request: Request) -> list[str] | None:
    """Foydalanuvchi qaysi hududlarni ko'ra oladi.

    None — cheklov yo'q (API kalit, admin yoki, PUBLIC_VIEW yoqiq bo'lsa,
    anonim); ro'yxat — operator: faqat shu hududlar (bo'sh = hech narsa);
    anonim va PUBLIC_VIEW o'chiq bo'lsa ham bo'sh ro'yxat qaytadi.
    """
    if api_key_ok(request):
        return None
    user = current_user(request)
    if user is None:
        return None if PUBLIC_VIEW else []
    if user["role"] == "admin":
        return None
    with get_db() as db:
        return security.user_regions(db, user["id"])
