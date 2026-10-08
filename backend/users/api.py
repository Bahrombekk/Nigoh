"""Nigoh — autentifikatsiya endpointlari: sayt kirishi va oqim chiptasi tekshiruvi.

Router kirishsiz ulanadi: /auth/stream ni MediaMTX, /auth/hls ni nginx
chaqiradi (o'z chipta tekshiruvi bor), login/logout/me — sayt kirishi.

Login brute-force himoyasi (core/throttle.Lockout, (login, ip) bo'yicha,
v3): 5 ta noto'g'ri urinish -> 5 daqiqa blok. 401 javobda `remaining` —
blokgacha qolgan urinishlar; blok davomida 429 {"detail", "retry_after"} +
Retry-After — parol tekshirilmaydi va hisob oshmaydi. Har xato jurnalga
`login_failed` bo'lib yoziladi — fail2ban shu satr bo'yicha ip'ni
bloklashi mumkin. Uxlash (`time.sleep`) EMAS: Starlette threadpool'i 40
ta ip va uni barcha `def` endpointlar bo'lishadi — 40 parallel xato kirish
30 s dan uxlab kameralar ro'yxatini ham, admin'ni ham to'xtatardi.

Cookie `nigoh_session` — httponly, samesite=lax, session_hours (standart
12 soat) yoki `remember=true` bilan 30 kun; so'rov HTTPS
orqali kelgan bo'lsa (`X-Forwarded-Proto` faqat ishonchli proksidan)
`secure` qo'yiladi, lokal http'da qo'yilmaydi (aks holda debug UI kira
olmasdi).

Oqim chiptasi: o'z jarayonlarimiz (launcher FFmpeg'i, snapshot zaxirasi)
ichki chipta bilan yuradi — publish ham, read ham. Tashqaridan faqat
tomosha (read/playback) va faqat chipta yoki tirik (ip, yo'l) sessiyasi
bilan. IP'ga qarab ishonilmaydi — nginx ortida hamma 127.0.0.1. Rad etish
jurnalga yoziladi (`stream_denied`; bir xil (yo'l, sabab) daqiqada bir
marta), chunki tashqaridan bu shunchaki "video uzildi" bo'lib ko'rinadi.

HLS Bearer rejimi: `hlsCDNSecret` yoqilganda MediaMTX Bearer bilan
kelgan so'rovni o'z auth ilgagisiz o'tkazadi, shuning uchun tomoshabin
chiptasini nginx `auth_request` orqali /auth/hls da tekshiradi. Sessiyali
rejimda manba qisqa uzilsa mijoz DOIMIY 401 olardi (o'lchov: 96 marta
ketma-ket). Manzilda `session=` ko'rinsa — nginx Bearer qo'ymayapti
(ishlab chiqarishda HTTPS bloki eski namunadan ko'chirilgan edi):
`hls_bearer_yoq` ogohlantirishi yechimi bilan 5 daqiqada bir marta yoziladi.

Endpointlar (kirishsiz; prefiks /api/v1/auth, eski /api/auth):
    POST /api/v1/auth/stream   MediaMTX (authMethod: http) — 200 ruxsat, 401 rad
    GET  /api/v1/auth/hls      nginx auth_request — 204 ruxsat, 401 rad
    POST /api/v1/auth/login    {username, password, remember?} -> sessiya cookie;
                               {username, role}; 401 {detail, remaining};
                               429 {detail, retry_after} — blok tugamagan
    POST /api/v1/auth/logout   sessiyani o'chiradi, cookie'ni tozalaydi
    GET  /api/v1/auth/me       joriy foydalanuvchi (rol, hududlar, full_name, prefs)
                               va sayt: public_view, site_name, session_hours,
                               poll_s, version (kirmaganda ham; prefs — {})
    PATCH /api/v1/auth/me/prefs  interfeys sozlamalari — birlashtiriladi, ≤ 16 KB
    POST /api/v1/auth/password   {current, new} -> 204; joriy xato — 400; audit

Tarkibi:
    router                     APIRouter(prefix="/auth", tags=["auth"])
    _login_throttle, _FAIL_MAX, _BLOCK_S, _login_key(), _retry_after()
                               login cheklovi (testlar ham o'qiydi)
    REMEMBER_DAYS, PREFS_MAX_BYTES, LOGIN_ERROR, LOGIN_BLOCKED, PASSWORD_ERROR
    TRUSTED_PROXIES, _client_ip, _ishonchli_proksi
                               app/network.py ga taxalluslar — chaqiruvchilar
                               va testlar o'zgarmasin

Ishlatadi: app.settings (site_name, public_view, session_hours, ui_poll_s), app.network,
    app.audit, core.security, core.throttle, core.log, core.version, database.users,
    users.schemas (LoginIn, PasswordIn).
Kim ishlatadi: app/factory.py (kirishsiz ulanadi); MediaMTX
    (STREAM_AUTH_URL = /api/auth/stream), nginx (/_hlsauth -> /api/auth/hls,
    scripts/nginx_conf.py), frontend (login/logout/me); tests/test_api.py,
    tests/test_hls_auth.py, tests/test_login_throttle.py.
"""
import json
import math
import threading
import time
from urllib.parse import parse_qs

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse

from app import audit as audit_log
from app.network import TRUSTED_PROXIES as helpers_trusted
from app.network import client_ip, ishonchli_proksi
from app.settings import site_settings
from core import security
from core.log import log
from core.throttle import Lockout
from core.version import VERSION
from database import get_db, users
from database.repositories.users import REGION_ROLES
from users.schemas import LoginIn, PasswordIn

# Prefiks nisbiy — create_app uni /api/v1 (asosiy) va /api (eski) ostida ulaydi.
#
# Kirish talab qilinmaydi: /auth/stream va /auth/hls ni MediaMTX va nginx
# chaqiradi (o'z chipta tekshiruvi bor), login/logout/me — sayt kirishi.
router = APIRouter(prefix="/auth", tags=["auth"])


# ---------- login brute-force himoyasi ----------
#
# v3 siyosati (Figma): (login, ip) bo'yicha 5 ta noto'g'ri urinish -> 5
# daqiqa BLOK. Har 401 javobda `remaining` — blokgacha qolgan urinishlar
# (kirish kartasi "yana 2 ta urinish" deb ko'rsatadi). Blok davomida kelgan
# so'rov 429 + `retry_after` (soniya) bilan qaytariladi — parol umuman
# tekshirilmaydi va hisob oshmaydi. Kalit (login, ip): bitta ip'dan
# boshqa loginlarga urinish begona hisobni qulflamaydi, begona ip esa
# haqiqiy foydalanuvchini qulflay olmaydi. Har xato jurnalga
# `login_failed` bo'lib yoziladi — fail2ban shu satr bo'yicha ip'ni
# butunlay bloklashi mumkin. (v2 dagi eksponensial kutish — 1, 2, 4 ... 30 s
# — o'rniga; API kaliti uchun u core/throttle.Throttle da qoladi.)
#
# Nima uchun uxlash EMAS: ilgari bu yerda `time.sleep(delay)` turardi va
# izohda "sync endpoint threadpool'da — boshqalarni bloklamaydi" deb
# yozilgandi. Bu noto'g'ri: Starlette'ning threadpool'i 40 ta ip va uni
# barcha `def` endpointlar bo'lishadi (bu servisda deyarli hammasi).
# 40 ta parallel xato kirish har biri 30 s uxlab pool'ni to'ldirardi va
# kameralar ro'yxati ham, admin ham javob bermay qolardi. Kutish
# muddatini mijozga aytish bir xil himoyani beradi, lekin serverda
# birorta resurs egallamaydi.

# Kirish urinishlari — mexanizm core/throttle.py da (Lockout).
_login_throttle = Lockout(max_fails=5, block_s=300.0)
# Chegaralar tashqaridan ham ko'rinsin: testlar va diagnostika bilsin.
_FAIL_MAX = _login_throttle.max_fails
_BLOCK_S = _login_throttle.block_s
# "Meni eslab qol" — sessiya muddati (aks holda session_hours sozlamasi).
REMEMBER_DAYS = 30
# users.prefs hajmi chegarasi (JSON, bayt).
PREFS_MAX_BYTES = 16 * 1024
# Javob matnlari — Figma'dagi yozuv (oʻ — U+02BB).
LOGIN_ERROR = "Login yoki parol notoʻgʻri"
LOGIN_BLOCKED = "5 daqiqadan keyin qayta urinib koʻring"
PASSWORD_ERROR = "Joriy parol notoʻgʻri"
# Jurnal takrorini cheklash uchun alohida qulf. Ilgari bu ikki joy
# kirish hisobining qulfini qarzga olardi — mexanizm umumiy modulga
# chiqqach o'sha qulf yo'qoldi.
_log_lock = threading.Lock()

# Proksi va mijoz manzili — umumiy joyda (camera/streaming.py, users/access.py), chunki
# aynan shu mantiq API kaliti cheklovida ham kerak (app/deps.py).
# Eski nomlar taxallus bo'lib qoladi: chaqiruvchilar va testlar
# o'zgarmasin.
_ishonchli_proksi = ishonchli_proksi
_client_ip = client_ip
TRUSTED_PROXIES = helpers_trusted


def _https_dami(request: Request) -> bool:
    """So'rov tomoshabingacha HTTPS bo'lganmi.

    Nginx ortida ilova o'zi http'da tinglaydi, shuning uchun sxema
    `X-Forwarded-Proto` dan olinadi — va u ham faqat ishonchli proksidan
    hisobga olinadi (soxta sarlavha cookie'ni noto'g'ri belgilamasin).
    """
    peer = request.client.host if request.client else ""
    if _ishonchli_proksi(peer):
        proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip()
        if proto:
            return proto.lower() == "https"
    return request.url.scheme == "https"


def _login_key(username: str, ip: str) -> tuple[str, str]:
    """Cheklov kaliti: (login, ip). Login katta-kichik harfsiz — "Admin" va
    "admin" bitta hisob bo'lib sanalsin (aks holda harf almashtirib aylanib o'tiladi)."""
    return (username.strip().lower(), ip)


def _retry_after(key) -> float:
    """Shu (login, ip) yana urinishi uchun necha soniya qolgani (0 — hoziroq mumkin)."""
    return _login_throttle.retry_after(key)


def _note_fail(key) -> int:
    """Xato urinish; qaytadi — blokgacha qolgan urinishlar."""
    return _login_throttle.note_fail(key)


def _clear_fails(key) -> None:
    _login_throttle.clear(key)


@router.post("/stream")
def stream_auth(body: dict):
    """MediaMTX har bir ulanishda shu yerdan ruxsat so'raydi (authMethod: http).

    Buni brauzer emas, MediaMTX'ning o'zi chaqiradi: 200 — ruxsat,
    401 — rad. Shu bilan 8554/8888/8889-portlardagi oqimlarni saytdan
    berilgan chiptasiz ko'rib bo'lmaydi.
    """
    ip = str(body.get("ip") or "")
    action = str(body.get("action") or "")
    path = str(body.get("path") or "")
    query = str(body.get("query") or "")
    token = (parse_qs(query).get("token") or [""])[0]

    # O'z jarayonlarimiz (launcher FFmpeg'i, snapshot zaxirasi) ichki
    # chipta bilan yuradi — publish ham, read ham mumkin. IP'ga qarab
    # ishonib bo'lmaydi: nginx proksi ortida barcha tomoshabin 127.0.0.1
    # bo'lib ko'rinadi, IP istisno chipta tekshiruvini butunlay o'chirardi.
    if security.internal_token_ok(token):
        return {"ok": True}

    # Tashqaridan faqat tomosha — va faqat chipta bilan.
    if action in ("read", "playback"):
        if security.stream_access_ok(ip, path, token):
            return {"ok": True}
    # Rad etish JURNALGA yoziladi. Tashqaridan bu "video uzildi" bo'lib
    # ko'rinadi va sababini taxmin qilib bo'lmaydi — MediaMTX aynan
    # nima so'raganini bilish shart. Toshqin bo'lmasin uchun bir xil
    # (yo'l, sabab) juftligi daqiqada bir marta yoziladi.
    _log_denial(ip, action, path, token)
    raise HTTPException(401, "Oqimga ruxsat yoʻq")


@router.get("/hls")
def hls_auth(request: Request):
    """Nginx `auth_request` uchun: shu HLS so'roviga ruxsat bormi.

    `hlsCDNSecret` yoqilganda MediaMTX `Authorization: Bearer` bilan
    kelgan so'rovni shartsiz o'tkazadi va bizning auth ilgagimizni
    (POST /auth/stream) umuman chaqirmaydi. Sarlavhani nginx qo'yadi,
    demak tomoshabin chiptasini ham nginx tekshirishi shart — aks holda
    slug'ni bilgan har kim kamerani ko'ra olardi. Shu endpoint aynan
    o'sha tekshiruv: nginx har bir /media/hls/ so'rovi uchun bu yerga
    kiradi, 204 — ruxsat, 401 — rad.

    Nima uchun umuman Bearer rejimiga o'tildi: sessiyali rejimda manba
    qisqa uzilsa MediaMTX muxerni yo'q qiladi, sessiya o'ladi va mijoz
    DOIMIY 401 oladi (o'lchov: o'sha manzil 96 marta ketma-ket 401,
    o'z-o'zidan tiklanmaydi). Bearer rejimida sessiya yo'q, ya'ni bekor
    bo'ladigan holat ham yo'q.

    Chipta faqat BIRINCHI so'rovda (master pleylist) keladi — MediaMTX
    Bearer rejimida bola pleylisti va segment manzillariga hech qanday
    parametr qo'shmaydi. Shuning uchun keyingi so'rovlar `(ip, yo'l)`
    sessiyasi orqali o'tadi; `stream_access_ok` shuni allaqachon
    bajaradi.
    """
    uri = request.headers.get("x-original-uri", "")
    ip = (request.headers.get("x-viewer-ip")
          or (request.client.host if request.client else ""))
    yol, _, query = uri.partition("?")
    bolaklar = [b for b in yol.split("/") if b]
    # /media/hls/<slug>/<resurs> -> <slug>/<resurs> (MediaMTX ko'rgan yo'l)
    if len(bolaklar) >= 3 and bolaklar[0] == "media" and bolaklar[1] == "hls":
        path = "/".join(bolaklar[2:])
    else:
        path = "/".join(bolaklar)
    params = parse_qs(query)
    token = (params.get("token") or [""])[0]
    if "session" in params:
        _bearer_yoq_ogohlantir(path)

    if security.internal_token_ok(token):
        return Response(status_code=204)
    if security.stream_access_ok(ip, path, token):
        return Response(status_code=204)
    _log_denial(ip, "read", path, token)
    raise HTTPException(401, "Oqimga ruxsat yoʻq")


_BEARER_WARN_EVERY = 300.0
_bearer_warned: list[float] = [0.0]


def _bearer_yoq_ogohlantir(path: str) -> None:
    """Manzilda `session=` bor — demak nginx Bearer sarlavhasini qo'ymayapti.

    Sessiyasiz (CDN) rejimda MediaMTX manzillarga hech qanday parametr
    qo'shmaydi. `session=` ko'rinishi bitta narsani anglatadi: shu so'rov
    kelgan nginx blokida

        proxy_set_header Authorization "Bearer <kalit>";

    yo'q yoki kaliti mos emas. Bu jimgina o'tib ketadigan nosozlik emas:
    sessiyali rejimda manba har uzilganda tomoshabin DOIMIY 401 oladi.
    Ishlab chiqarishda aynan shu bo'ldi — HTTPS (443) bloki eski namunadan
    ko'chirilgan edi, 80-portdagi blok esa to'g'ri. Shuning uchun muammo
    faqat https'da ko'rinardi.
    """
    now = time.monotonic()
    with _log_lock:
        if now - _bearer_warned[0] < _BEARER_WARN_EVERY:
            return
        _bearer_warned[0] = now
    log("auth", "hls_bearer_yoq", level="warning", path=path,
        sabab="nginx /media/hls/ blokida Authorization: Bearer yoʻq yoki "
              "kalit mos emas — MediaMTX sessiyali rejimda ishlayapti va "
              "manba uzilganda tomoshabin doimiy 401 oladi",
        yechim="python scripts/nginx_conf.py > /etc/nginx/sites-available/"
               "negoh.conf && nginx -t && systemctl reload nginx")


_DENY_EVERY = 60.0
_denied: dict[tuple, float] = {}


def _log_denial(ip: str, action: str, path: str, token: str) -> None:
    why = ("chiptasiz" if not token else
           "chipta muddati tugagan yoki imzo mos emas")
    key = (path, why)
    now = time.monotonic()
    with _log_lock:
        if now - _denied.get(key, 0.0) < _DENY_EVERY:
            return
        _denied[key] = now
        if len(_denied) > 500:
            for k, t in list(_denied.items()):
                if now - t > _DENY_EVERY:
                    _denied.pop(k, None)
    log("auth", "stream_denied", level="warning",
        path=path, action=action, ip=ip, sabab=why,
        chipta=(token[:24] + "…") if token else "")


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response):
    """Kirish: sessiya cookie. `remember=true` — 30 kun, aks holda session_hours.

    Xato — 401 {"detail", "remaining"}; 5 xatodan keyin 5 daqiqa 429
    {"detail", "retry_after"} (+ Retry-After sarlavhasi).
    """
    ip = _client_ip(request)
    key = _login_key(body.username, ip)
    kutish = _retry_after(key)
    if kutish:
        # Parol tekshirilmaydi — hisob ham oshmaydi, aks holda tinmay
        # urinayotgan hujumchi blokni cheksiz uzaytirardi.
        soniya = max(1, math.ceil(kutish))
        log("auth", "login_throttled", level="warning", ip=ip, username=body.username,
            kutish=soniya)
        return JSONResponse(status_code=429, headers={"Retry-After": str(soniya)},
                            content={"detail": LOGIN_BLOCKED, "retry_after": soniya})

    with get_db() as db:
        security.purge_expired_sessions(db)
        row = users.get_for_login(db, body.username)
        if row is None or not security.verify_password(
            body.password, row["pw_hash"], row["pw_salt"]
        ):
            remaining = _note_fail(key)
            log("auth", "login_failed", level="warning",
                ip=ip, username=body.username, remaining=remaining)
            return JSONResponse(status_code=401,
                                content={"detail": LOGIN_ERROR, "remaining": remaining})
        _clear_fails(key)
        hours = REMEMBER_DAYS * 24 if body.remember else site_settings.get("session_hours")
        token = security.create_session(db, row["id"], ip,
                                        request.headers.get("user-agent"), hours=hours)
        username, role = row["username"], row["role"]

    response.set_cookie(
        security.SESSION_COOKIE, token, httponly=True, samesite="lax",
        max_age=hours * 3600, path="/",
        # HTTPS orqali kelgan bo'lsa cookie faqat HTTPS'da yuborilsin —
        # 80-portdagi blok (yoki http'ga tushib qolgan havola) sessiyani
        # ochiq tarmoqqa chiqarib yubormasin. Lokal http bilan ishlaganda
        # bayroq qo'yilmaydi, aks holda debug UI umuman kira olmasdi.
        secure=_https_dami(request),
    )
    return {"username": username, "role": role}


@router.post("/logout")
def logout(request: Request, response: Response):
    with get_db() as db:
        security.delete_session(db, request.cookies.get(security.SESSION_COOKIE))
    response.delete_cookie(security.SESSION_COOKIE, path="/")
    return {"ok": True}


def _site() -> dict:
    """Interfeys uchun sayt ma'lumoti — kirgan va kirmaganga bir xil."""
    # public_view — kirmagan foydalanuvchi xaritani ko'ra oladimi. Frontend
    # shunga qarab kirish ekranida "Mehmon sifatida davom etish" tugmasini
    # ko'rsatadi yoki yashiradi.
    return {"public_view": site_settings.get("public_view"),
            "site_name": site_settings.get("site_name"),
            "session_hours": site_settings.get("session_hours"),
            "poll_s": site_settings.get("ui_poll_s"),
            # Sayt standart tili (Sozlamalar → Umumiy); foydalanuvchi tanlovi
            # (prefs.lang) bo'lmasa interfeys shu tilda ochiladi.
            "language": site_settings.get("language"),
            "version": VERSION}


def _session(request: Request):
    """Joriy sessiya egasi yoki 401 (prefs/parol — faqat kirganlar)."""
    token = request.cookies.get(security.SESSION_COOKIE)
    with get_db() as db:
        user = security.session_user(db, token)
    if user is None:
        raise HTTPException(401, "Avval tizimga kiring")
    return user


@router.get("/me")
def me(request: Request):
    """Joriy foydalanuvchi: rol, hududlar (operator/kuzatuvchi), F.I.Sh., prefs
    va sayt ma'lumoti (session_hours, poll_s — ui_poll_s, version)."""
    token = request.cookies.get(security.SESSION_COOKIE)
    with get_db() as db:
        user = security.session_user(db, token)
        regions = (users.region_names(db, user["id"])
                   if user is not None and user["role"] in REGION_ROLES else [])
        prefs = users.prefs(db, user["id"]) if user is not None else {}
    if user is None:
        return {"authenticated": False, "full_name": "", "prefs": {}, **_site()}
    return {"authenticated": True, "username": user["username"],
            "role": user["role"], "regions": regions,
            "full_name": user["full_name"] or "", "prefs": prefs, **_site()}


@router.patch("/me/prefs")
def patch_prefs(body: dict, request: Request):
    """Interfeys sozlamalari: qisman obyekt mavjudiga birlashtiriladi (yuqori daraja
    kalitlari almashadi); javob — to'liq prefs. Hajm ≤ 16 KB. Kalitlarni backend
    tekshirmaydi (theme, lang, layers, onboarding, panel, wall, dashTab, dashPeriod)."""
    user = _session(request)
    with get_db() as db:
        merged = {**users.prefs(db, user["id"]), **body}
        if len(json.dumps(merged, ensure_ascii=False).encode()) > PREFS_MAX_BYTES:
            raise HTTPException(413, "prefs 16 KB dan oshmasin")
        return users.merge_prefs(db, user["id"], body)


@router.post("/password", status_code=204)
def change_password(body: PasswordIn, request: Request):
    """O'z parolini almashtirish. Noto'g'ri joriy parol — 400; yangisi kamida
    6 belgi. Boshqa sessiyalar bekor bo'ladi, joriysi qoladi. Audit yoziladi."""
    user = _session(request)
    if len(body.new) < 6:
        raise HTTPException(400, "Parol kamida 6 belgidan iborat boʻlsin")
    with get_db() as db:
        row = users.password_row(db, user["id"])
        if row is None or not security.verify_password(body.current, row["pw_hash"],
                                                       row["pw_salt"]):
            raise HTTPException(400, PASSWORD_ERROR)
        pw_hash, salt = security.hash_password(body.new)
        users.set_password_keep(db, user["id"], pw_hash, salt,
                                security.token_hash(request.cookies.get(security.SESSION_COOKIE)))
        audit_log.record(db, request, "user.password", "user", entity_id=user["id"],
                         after={"password": "oʻzgartirildi"})
    return Response(status_code=204)
