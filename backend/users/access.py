"""Nigoh — kirish huquqlari: API kaliti, joriy foydalanuvchi, admin, operator hududlari.

Rol tekshiruvi ko'p endpointlarda kerak bo'lgani uchun shu yerda turadi
(ilgari api/helpers.py ichida edi). Ikki daraja: admin (yoki API kaliti)
— hammasi; operator va kuzatuvchi (viewer) — faqat biriktirilgan hududlar (admin_areas) va
ularning ichki bo'g'inlari (viloyat berilsa — tumanlari ham). Hudud
cheklovi qaysi kamera so'ralganiga bog'liq, shuning uchun u dependency
emas — endpoint ichida `allowed_areas` + `check_area`/`area_allowed`
bilan tekshiriladi.

API kaliti (server-to-server): tashqi backend o'z foydalanuvchi/rol
tizimi bilan ishlaydi va Nigoh'ga shu kalit bilan to'liq kiradi —
ruxsatlarni o'zi hal qilib, bu yerdan faqat chiptali oqim manzillari va
kamera boshqaruvini oladi. Kalit `hmac.compare_digest` bilan solishtiriladi.

Tarkibi:
    api_key_ok(request)        X-API-Key to'g'rimi (NIGOH_API_KEY bo'sh — doim False)
    current_user(request)      sessiyadagi foydalanuvchi (admin/operator) yoki None
    require_admin(request)     dependency: admin yoki kalit; kirmagan — 401,
                               operator — 403
    allowed_areas(request)     None — cheklovsiz (kalit, admin, PUBLIC_VIEW
                               mehmoni); ro'yxat — operator/kuzatuvchi hududlari;
                               [] — hech narsa
    area_allowed(row, areas)   kamera shu hududlar ichidami
    check_area(row, areas)     ichida bo'lmasa 403

Ishlatadi: app.config (API_KEY), app.settings (public_view), core.security, database.users.
Kim ishlatadi: app/{__init__,deps,system_api}.py,
    camera/api/{admin,cameras,events,mediamtx,nodes,streams}.py,
    database/api.py, stats/{api,admin_api}.py, users/admin_api.py,
    walls/api.py.
"""
import hmac

from fastapi import HTTPException, Request

from app.config import API_KEY
from app.settings import site_settings
from core import security
from database import get_db, users


def api_key_ok(request: Request) -> bool:
    """Server-to-server kirish: `X-API-Key` sarlavhasi to'g'rimi.

    Tashqi backend (o'z foydalanuvchi/rol tizimi bor tizim) Nigoh'ga shu
    kalit bilan to'liq kiradi — ruxsatlarni o'zi hal qilib, bu yerdan
    faqat chiptali oqim manzillari va kamera boshqaruvini oladi.
    """
    if not API_KEY:
        return False
    supplied = request.headers.get("x-api-key", "")
    return bool(supplied) and hmac.compare_digest(supplied, API_KEY)


def current_user(request: Request):
    """Sessiyadagi foydalanuvchi (admin yoki operator), bo'lmasa None."""
    token = request.cookies.get(security.SESSION_COOKIE)
    with get_db() as db:
        return security.session_user(db, token)


def require_admin(request: Request):
    """Boshqaruv endpointlari uchun: admin roli yoki to'g'ri API kalit."""
    if api_key_ok(request):
        return {"id": 0, "username": "api", "role": "admin"}
    user = current_user(request)
    if user is None:
        raise HTTPException(401, "Avval administrator sifatida kiring")
    if user["role"] != "admin":
        raise HTTPException(403, "Bu boʻlim faqat administrator uchun")
    return user


def allowed_areas(request: Request) -> list[int] | None:
    """Foydalanuvchi qaysi hududlarni ko'ra oladi (admin_areas id'lari).

    None — cheklov yo'q (API kalit, admin yoki, PUBLIC_VIEW yoqiq bo'lsa,
    mehmon); ro'yxat — operator: biriktirilgan hududlar va ularning ichki
    bo'g'inlari (viloyat berilsa — tumanlari ham); bo'sh = hech narsa.
    PUBLIC_VIEW o'chiq bo'lsa mehmon bu yerga yetib kelmaydi —
    `deps.require_viewer` uni oldinroq qaytaradi; baribir bo'sh ro'yxat.
    """
    if api_key_ok(request):
        return None
    user = current_user(request)
    if user is None:
        return None if site_settings.get("public_view") else []
    if user["role"] == "admin":
        return None
    with get_db() as db:
        return users.allowed_area_ids(db, user["id"])


def area_allowed(row, areas: list[int] | None) -> bool:
    return areas is None or row["admin_area_id"] in areas


def check_area(row, areas: list[int] | None) -> None:
    """Operator cheklovi: kamera ruxsat etilgan hududda bo'lsin (aks holda 403)."""
    if not area_allowed(row, areas):
        raise HTTPException(403, "Bu kamerani koʻrishga ruxsat yoʻq")
