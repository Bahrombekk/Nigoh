"""Nigoh — FastAPI ilovasini yig'ish: routerlar, kirish darajalari, interfeys.

`create_app()` mavzu paketlarining routerlarini bitta ilovaga ulaydi va
har biriga kirish darajasini (dependency) beradi. Endpointlarning
o'zi bu yerda emas — ular mavzu bo'yicha paketlarda: kamera va oqim
`camera/api/`, statistika `stats/`, foydalanuvchilar `users/`, devor
`walls/`, baza holati `database/api.py`, tizim holati `app/system_api.py`.
MediaMTX bilan aloqa `camera/media/` da, umumiy infratuzilma `core/` da.

API ikki prefiksda tinglaydi:

    /api/v1/...   asosiy, hujjatlangan manzil — tashqi mijozlar shu bilan
                  ishlasin; hujjat: /docs (Swagger) va /redoc.
    /api/...      eski manzillar aynan shu endpointlarga olib boradi —
                  interfeys va MediaMTX auth (STREAM_AUTH_URL) shu bilan
                  ishlaydi; hujjatda ko'rinmaydi.

Kirish darajalari (`mount()` da beriladi):

    kirishsiz        users/api.py — /auth/stream ni MediaMTX, /auth/hls ni
                     nginx chaqiradi (o'z chipta tekshiruvi bor), login/me
    require_viewer   camera/api: cameras, streams, events, metrics; walls —
                     kalit, sessiya yoki (PUBLIC_VIEW=1) mehmon; operator
                     hududi endpoint ichida tekshiriladi
    require_user     stats/api.py — dashboard; groups/api.py — kamera guruhlari;
                     mehmonga yopiq
    key_guard        boshqaruv: camera/api/admin, users/admin_api,
                     app/system_api, camera/api/mediamtx, database/api,
                     camera/api/nodes, stats/admin_api — routerning o'zida
                     require_admin bor, key_guard xato kalitni sekinlashtiradi
    key_guard + require_admin   camera/api/devices (routerda o'zi yo'q)
    prefikssiz       /health — kalitsiz, Docker HEALTHCHECK uchun

Interfeys (frontend/) ildizga hamma API yo'llaridan KEYIN ulanadi:
/api, /health, /docs ustun turadi. `FRONTEND_DIR` bo'sh bo'lsa backend
faqat API beradi. Shu yerda yana GZip (5000 kamerada /cameras 1,2 MB)
va xavfsizlik sarlavhalari (CSP, X-Frame-Options, Referrer-Policy)
qo'yiladi — har birining sababi kod ichidagi izohlarda.

Tarkibi:
    create_app()        ilovani yig'ib qaytaradi
    API_DESCRIPTION     Swagger'dagi umumiy tavsif: kirish yo'llari, rollar,
                        bo'limlar, kamera/tugun holatlari

Endpointlar (shu faylning o'zida):
    GET  /                          index.html (FRONTEND_DIR bo'lsa), kirishsiz
    GET  /assets/{name}.geojson     uz / uz_regions chegaralari, 1 kun kesh
    GET  /api/v1/vendors            RTSP shablonlari (app.config.VENDORS),
                                    require_viewer

Ishlatadi: app.config, app.deps, app.health, app.system_api, camera.api.*,
    stats.api, stats.admin_api, users.api, users.admin_api, users.access,
    walls.api, database.api, core.bus (lifespan), core.version.
Kim ishlatadi: main.py (`app = create_app()`), tests/ (TestClient).
"""
import asyncio
import re
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import FRONTEND_DIR, VENDORS
from app.deps import key_guard, require_user, require_viewer
from app.health import router as health_router
from app.logs_api import router as logs_router
from app.network import client_ip
from app.system_api import router as system_router
from camera.api.admin import router as camera_admin_router
from camera.api.cameras import router as cameras_router
from camera.api.devices import router as devices_router
from camera.api.events import router as events_router
from camera.api.mediamtx import router as mediamtx_router
from camera.api.metrics import router as metrics_router
from camera.api.nodes import router as nodes_router
from camera.api.streams import router as streams_router
from core import bus, security
from core.log import log
from core.logs import config as log_config
from core.logs import context as log_context
from core.version import VERSION
from database.api import router as database_router
from groups.api import router as groups_router
from stats.admin_api import router as analytics_router
from stats.api import router as stats_router
from users.access import require_admin
from users.admin_api import router as users_admin_router
from users.api import router as auth_router
from walls.api import router as walls_router

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

# Statik fayllar access logga yozilmaydi (LOG_ACCESS_STATIC=1 bilan yoziladi):
# sahifa har ochilganda 25+ so'rov — muhim yozuvlar ko'rinmay qoladi.
_STATIC_PREFIXES = ("/css/", "/js/", "/assets/", "/favicon")
_REQUEST_ID = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")


def _clean_request_id(value: str | None) -> str:
    """Tashqaridan kelgan X-Request-ID — faqat xavfsiz belgilar (log injeksiyasi bo'lmasin)."""
    return value if value and _REQUEST_ID.match(value) else ""


def _auth_kind(request) -> str:
    """Kim so'radi — bazaga murojaatsiz: kalit, sessiya yoki mehmon."""
    if request.headers.get("x-api-key"):
        return "key"
    if request.cookies.get(security.SESSION_COOKIE):
        return "session"
    return "guest"



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
        version=VERSION,
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

    @app.middleware("http")
    async def access_log(request, call_next):
        """Har so'rov: request_id (javobda X-Request-ID), vaqt, holat, IP -> logs/access.

        Eng tashqi qatlam (oxirgi qo'shilgan middleware birinchi ishlaydi) —
        vaqt hamma middleware bilan birga o'lchanadi. request_id kontekstga
        bog'lanadi: shu so'rov davomida istalgan modul yozgan log yozuvi
        ham o'sha ID bilan chiqadi.
        """
        rid = _clean_request_id(request.headers.get("x-request-id")) or log_context.new_request_id()
        token = log_context.bind(request_id=rid)
        started = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            response.headers["X-Request-ID"] = rid
            return response
        except Exception:
            log("http", "unhandled_exception", level="error", exc_info=True,
                method=request.method, path=request.url.path)
            raise
        finally:
            path = request.url.path
            if log_config.ACCESS_STATIC or not path.startswith(_STATIC_PREFIXES):
                # 5xx — server xatosi; 4xx — ogohlantirish, lekin 401 (kirilmagan) va
                # 404 odatiy oqim: ular errors/ ni to'ldirib, haqiqiy xatoni yashirardi.
                if status >= 500:
                    level = "error"
                elif status >= 400 and status not in (401, 404):
                    level = "warning"
                else:
                    level = "info"
                fields = {"method": request.method, "path": path, "status": status,
                          "ms": round((time.perf_counter() - started) * 1000, 1),
                          "ip": client_ip(request), "auth": _auth_kind(request)}
                if request.url.query:
                    fields["query"] = request.url.query
                log("http", "request", level=level, **fields)
            log_context.reset(token)

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
    # Kamera guruhlari — shaxsiy, mehmonga yopiq; egalik endpoint ichida.
    mount(groups_router, require_user)
    # Boshqaruv: admin/nodes/analytics routerlarining o'zida require_admin
    # bor; key_guard xato kalitni sekinlashtiradi. devices'da yo'q edi.
    for router in (camera_admin_router, users_admin_router, system_router, mediamtx_router,
                   database_router, logs_router, nodes_router, analytics_router):
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
