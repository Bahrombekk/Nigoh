"""Nigoh — FastAPI ilovasini yig'ish.

Qatlamlar:

    app/config.py         sozlamalar (portlar, shablonlar)
    app/models.py         so'rov modellari (Pydantic)
    app/helpers.py        umumiy tarjima qatlami (baza → brauzer/MediaMTX)
    app/routes_auth.py    /api/auth/*
    app/routes_public.py  /api/cameras/*   (kirishsiz)
    app/routes_admin.py   /api/admin/*     (super-admin)

MediaMTX bilan aloqa alohida `media/` paketida — backend unga faqat
`from media import sync` orqali murojaat qiladi. Umumiy infratuzilma
(db, security, health, rtsp_probe, fast_start) `core/` paketida.
"""
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from core.db import BASE_DIR

from .config import VENDORS
from .routes_admin import router as admin_router
from .routes_auth import router as auth_router
from .routes_public import router as public_router


def create_app() -> FastAPI:
    app = FastAPI(title="Nigoh — kamera xaritasi")

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(BASE_DIR / "static" / "index.html")

    @app.get("/static/uz.geojson", include_in_schema=False)
    def uz_boundary():
        """O'zbekiston chegarasi (OSM, ADM0) — xaritada hududni ajratish uchun."""
        return FileResponse(BASE_DIR / "static" / "uz.geojson",
                            media_type="application/geo+json",
                            headers={"Cache-Control": "max-age=86400"})

    @app.get("/static/uz_regions.geojson", include_in_schema=False)
    def uz_regions():
        """Viloyat chegaralari (ADM1) — nuqtadan hududni aniqlash uchun."""
        return FileResponse(BASE_DIR / "static" / "uz_regions.geojson",
                            media_type="application/geo+json",
                            headers={"Cache-Control": "max-age=86400"})

    @app.get("/api/vendors")
    def list_vendors():
        return VENDORS

    app.include_router(auth_router)
    app.include_router(public_router)
    app.include_router(admin_router)

    # Qolgan static fayllar (style.css, app.js) — yuqoridagi maxsus
    # yo'llardan keyin ulanadi, shuning uchun ular ustun turadi.
    app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")

    return app
