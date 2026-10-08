"""Nigoh — ochiq ma'lumot va tizim holati chipi (v3).

Endpointlar (prefiks /api/v1, eski /api):
    GET  /api/v1/public/info     kirishsiz: {site_name, version, public_view, guest_view}
                                 — kirish kartasi footeri va "Mehmon sifatida" tugmasi;
                                 guest_view — public_view'ning o'zi (interfeys nomi)
    GET  /api/v1/system/state    require_viewer (admin, operator, kuzatuvchi, kalit;
                                 public_view yoqiq bo'lsa mehmon ham):
                                 {state, label, services[{key, name, state, detail}],
                                 checked_at}. Ichki manzil, IP, fayl yo'li BERILMAYDI.

Tarkibi:
    public_router   APIRouter(tags=["public"]) — kirishsiz ulanadi
    state_router    APIRouter(tags=["system"]) — require_viewer bilan ulanadi

Ishlatadi: app.settings, app.system_state, core.version.
Kim ishlatadi: app/factory.py, tests/test_v3_auth.py, tests/test_v3_system.py.
"""
from fastapi import APIRouter

from app import system_state
from app.settings import site_settings
from core.version import VERSION

public_router = APIRouter(prefix="/public", tags=["public"])
state_router = APIRouter(prefix="/system", tags=["system"])


@public_router.get("/info")
def public_info():
    """Kirish oynasi uchun: sayt nomi, versiya va mehmon ko'rishi yoqiqmi."""
    public = bool(site_settings.get("public_view"))
    return {"site_name": site_settings.get("site_name"), "version": VERSION,
            "public_view": public, "guest_view": public}


@state_router.get("/state")
def system_state_view():
    """Yuqori panel chipi: "Tizim barqaror" / "Qisman nosozlik" / "Tizim ishlamayapti"."""
    return system_state.public_view(system_state.collect())
