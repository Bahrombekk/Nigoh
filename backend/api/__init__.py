"""Nigoh — FastAPI ilovasini yig'ish.

Qatlamlar:

    app/config.py    sozlamalar (.env, portlar, shablonlar, PUBLIC_VIEW)
    app/models.py    so'rov modellari (Pydantic)
    app/deps.py      kirish: X-API-Key, sessiya, mehmon (PUBLIC_VIEW)
    app/helpers.py   umumiy tarjima qatlami (baza → mijoz/MediaMTX),
                     rollar va operator hududlari
    app/auth.py      /api/v1/auth/*      (login/me; stream/hls — MediaMTX, nginx)
    app/cameras.py   /api/v1/cameras/*   (ro'yxat, holat, oqim, surat)
    app/streams.py   /api/v1/streams     (batch oqim chiptalari)
    app/events.py    /api/v1/events      (SSE — holat o'zgarishlari)
    app/walls.py     /api/v1/walls       (mozaika devor)
    app/metrics.py   /api/v1/metrics/*   (pleyer o'lchagan ochilish vaqti)
    app/stats.py     /api/v1/stats/*     (dashboard tarixi + uni yozuvchi)
    app/devices.py   /api/v1/devices/*   (skan: job + SSE, pasport)
    app/nodes.py     /api/v1/admin/nodes (MediaMTX tugunlari)
    app/analytics.py /api/v1/admin/uptime, /admin/outages/hourly
    app/admin.py     /api/v1/admin/*     (kameralar CRUD, foydalanuvchilar)
    app/health.py    /health             (kalitsiz — Docker HEALTHCHECK)

API ikki prefiksda tinglaydi:

    /api/v1/...   asosiy, hujjatlangan manzil — tashqi mijozlar shu bilan
                  ishlasin; hujjat: /docs (Swagger) va /redoc.
    /api/...      eski manzillar aynan shu endpointlarga olib boradi —
                  interfeys va MediaMTX auth (STREAM_AUTH_URL) shu bilan
                  ishlaydi; hujjatda ko'rinmaydi.

MediaMTX bilan aloqa alohida `media/` paketida — backend unga faqat
`from kamera import sync` orqali murojaat qiladi. Umumiy infratuzilma
(db, security, health, rtsp_probe, fast_start, stats) `core/` paketida.
"""
import asyncio
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from core import bus

from .admin import router as admin_router
from .analytics import router as analytics_router
from .auth import router as auth_router
from .cameras import router as cameras_router
from .config import FRONTEND_DIR, VENDORS
from .deps import key_guard, require_user, require_viewer
from .devices import router as devices_router
from .events import router as events_router
from .health import router as health_router
from .helpers import require_admin
from .metrics import router as metrics_router
from .nodes import router as nodes_router
from .stats import router as stats_router
from .streams import router as streams_router
from .walls import router as walls_router

API_DESCRIPTION = """\
Kamera xaritasi, video devor, dashboard va boshqaruv — bitta tizimda.
Kamera/media qatlami MediaMTX ustida: kameralar bazada, oqim yo'llari
MediaMTX Control API orqali dinamik boshqariladi, restart kerak emas.

Kirish uch yo'l bilan:

* cookie sessiyasi — `POST /auth/login` (sayt foydalanuvchilari);
* `X-API-Key` — tashqi backend, admin darajasida (`NIGOH_API_KEY`);
* mehmon — `PUBLIC_VIEW=1` bo'lsa faqat ko'rish yo'llari ochiq.

Rollar: `admin` hammasini ko'radi va boshqaradi; `operator` faqat o'ziga
biriktirilgan hududlardagi kameralarni ko'radi (ro'yxat, oqim, surat,
devor, SSE — hammasi shu cheklov bilan).

Bo'limlar:

* **cameras / streams / walls / events** — ko'rish: ro'yxat, chiptali
  oqim manzillari, surat, mozaika devor, jonli holat (SSE).
* **stats** — dashboard tarixi (24 soat / 7 kun), faqat kirganlar uchun.
* **auth** — kirish/chiqish; `POST /auth/stream` ni MediaMTX'ning o'zi
  chaqiradi (oqimga ruxsat tekshiruvi), brauzer emas.
* **admin / nodes / devices** — faqat `admin`: kameralar CRUD, NVR import,
  skaner, foydalanuvchilar, MediaMTX tugunlari va sinxronlash.

Kamera holati (`state`): `disabled / unknown / offline / stalled / online`.
Tugun holati (`status`): `online / degraded / offline`.
"""


class _NoCacheStatic(StaticFiles):
    """Interfeys fayllari har so'rovda tekshiriladi.

    Cache-Control bo'lmasa brauzer style.css va app.js ni o'zicha eskirgan
    holda ushlab qoladi — yangilangan dizayn faqat Ctrl+F5 dan keyin
    ko'rinadi. `no-cache` fayl o'zgarganini tekshirishga majbur qiladi;
    ETag saqlanib qolgani uchun o'zgarmagan fayl 304 bilan qaytadi, ya'ni
    qo'shimcha trafik yo'q.
    """

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-cache"
        return response


# Interfeys tashqi manbalardan yuklaydi: Leaflet/markercluster (unpkg),
# hls.js (jsdelivr), shriftlar (Google Fonts) va OSM xarita plitkalari.
# Ro'yxat shu yerda — yangi CDN qo'shilsa, sahifa jimgina buzilmasin.
_CSP = (
    "default-src 'self'; "
    "img-src 'self' data: blob: https://*.tile.openstreetmap.org "
    "https://tile.openstreetmap.org https://unpkg.com; "
    "media-src 'self' blob: http: https:; "
    "connect-src 'self' http: https: ws: wss:; "
    "script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net; "
    "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com; "
    "worker-src 'self' blob:; "
    "frame-ancestors 'none'"
)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    # Fon thread'lari (health, reconciler, snapshots) SSE hodisalarini
    # shu loop orqali yetkazadi.
    bus.set_loop(asyncio.get_running_loop())
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="Nigoh API",
        version="2.0",
        description=API_DESCRIPTION,
        lifespan=_lifespan,
    )

    # Siqish. 5000 kamerada `/cameras` ro'yxati 1,2 MB, va har ochiq
    # brauzer uni 30 soniyada qayta so'raydi — 50 operator = doimiy
    # ~2 MB/s faqat ro'yxat uchun. JSON yaxshi siqiladi (~10 baravar).
    # SSE, JPEG suratlar va video bu yerga kirmaydi (Starlette ularni
    # o'zi chetlab o'tadi), ya'ni hodisalar kechikmaydi.
    app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=5)

    @app.middleware("http")
    async def xavfsizlik_sarlavhalari(request, call_next):
        """Brauzer uchun eng arzon himoya qatlami.

        Interfeys kamera manzillari va chiptalarini ko'rsatadi — uni
        begona sahifaga joylash (clickjacking) yoki MIME taxminiga
        tayangan hujum bemalol qimmatga tushadi.

        `Referrer-Policy` — `no-referrer` EMAS: OSM plitka serveri
        Referer'siz so'rovni bloklaydi va xarita bo'sh chiqadi.
        `frame-ancestors 'none'` — sahifa boshqa saytning iframe'iga
        joylanmaydi. Oqimning O'ZI bunga kirmaydi: uni MediaMTX beradi
        va u yerda cheklov `hlsAllowOrigins` bilan qo'yiladi.
        """
        javob = await call_next(request)
        javob.headers.setdefault("X-Content-Type-Options", "nosniff")
        javob.headers.setdefault("X-Frame-Options", "DENY")
        javob.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        javob.headers.setdefault("Content-Security-Policy", _CSP)
        return javob

    if FRONTEND_DIR:
        @app.get("/", include_in_schema=False)
        def index():
            return FileResponse(FRONTEND_DIR / "index.html",
                                headers={"Cache-Control": "no-cache"})

        # Chegara fayllari katta (~100 KB) va o'zgarmaydi — bir kun keshda.
        @app.get("/assets/{name}.geojson", include_in_schema=False)
        def geojson(name: str):
            """O'zbekiston chegarasi (uz) va viloyatlar (uz_regions)."""
            if name not in ("uz", "uz_regions"):
                raise HTTPException(404)
            return FileResponse(FRONTEND_DIR / "assets" / f"{name}.geojson",
                                media_type="application/geo+json",
                                headers={"Cache-Control": "max-age=86400"})

    @app.get("/api/v1/vendors", tags=["cameras"],
             dependencies=[Depends(require_viewer)])
    @app.get("/api/vendors", include_in_schema=False,
             dependencies=[Depends(require_viewer)])
    def list_vendors():
        """Kamera qo'shishda tanlanadigan tayyor RTSP shablonlari."""
        return VENDORS

    def mount(router, *deps):
        """/api/v1 — asosiy (hujjatlangan); /api — eski manzil, xuddi shu
        endpointlar (interfeys va MediaMTX auth manzili shu bilan)."""
        dependencies = [Depends(d) for d in deps]
        app.include_router(router, prefix="/api/v1", dependencies=dependencies)
        app.include_router(router, prefix="/api", include_in_schema=False,
                           dependencies=dependencies)

    # auth — kirishsiz: /auth/stream ni MediaMTX, /auth/hls ni nginx
    # chaqiradi (o'z chipta tekshiruvi bor), login/me — sayt kirishi.
    mount(auth_router)
    # Ko'rish: kalit, sessiya yoki mehmon; operator hududi endpoint ichida.
    for router in (cameras_router, streams_router, events_router,
                   walls_router, metrics_router):
        mount(router, require_viewer)
    # Dashboard — faqat kirganlar (yoki kalit): interfeysda ham yopiq bo'lim.
    mount(stats_router, require_user)
    # Boshqaruv: admin/nodes/analytics routerlarining o'zida require_admin
    # bor; key_guard xato kalitni sekinlashtiradi. devices'da yo'q edi.
    for router in (admin_router, nodes_router, analytics_router):
        mount(router, key_guard)
    mount(devices_router, key_guard, require_admin)

    # /health kalitsiz va prefikssiz — Docker HEALTHCHECK shu manzilga
    # qaraydi; ichida sir yo'q.
    app.include_router(health_router)

    # Interfeys (frontend/) — ildizga, hamma API yo'llaridan KEYIN ulanadi:
    # /api, /health, /docs ustun turadi, qolgan manzillar (css/, js/,
    # assets/) shu papkadan beriladi. FRONTEND_DIR bo'sh bo'lsa backend
    # faqat API — interfeysni alohida server (nginx, vite) beradi.
    if FRONTEND_DIR:
        app.mount("/", _NoCacheStatic(directory=FRONTEND_DIR), name="frontend")

    return app
