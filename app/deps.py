"""Nigoh — endpointlar uchun kirish tekshiruvi (FastAPI dependency'lari).

Uch yo'l bilan kiriladi:

  * `X-API-Key` — tashqi backend (server-to-server), admin darajasida;
  * cookie sessiyasi — sayt foydalanuvchisi (admin yoki operator);
  * PUBLIC_VIEW=1 bo'lsa — kirmagan mehmon, faqat ko'rish yo'llarida.

Ikki daraja bor: `require_viewer` — xarita, oqim, surat, devor;
`helpers.require_admin` — boshqaruv. Operatorning hudud cheklovi
endpointlarning o'zida (`helpers.allowed_regions`), chunki u qaysi
kamera so'ralganiga bog'liq.
"""
import math

from fastapi import HTTPException, Request

from core.log import log
from core.throttle import Throttle

from .config import PUBLIC_VIEW
from .helpers import api_key_ok, client_ip, current_user

# Noto'g'ri kalit bilan kelgan urinishlar — ip bo'yicha sekinlashtiriladi.
#
# Kalit 64 belgili bo'lsa uni taxmin qilib bo'lmaydi, lekin cheklov
# baribir kerak: kalit KALTA yoki sizib chiqqan bo'lishi mumkin, va
# tekshiruvsiz endpoint cheksiz tezlikda urishga ochiq qoladi. Kirish
# formasida shunday himoya allaqachon bor edi — bu yerda yo'q edi.
#
# Bepul urinish kamroq (kalit odam yodlaydigan narsa emas: mijoz uni
# sozlamadan oladi, ya'ni xato urinish normal holat emas).
_key_throttle = Throttle(free=3, max_delay=30.0, ttl=600.0)


def key_guard(request: Request) -> bool:
    """`X-API-Key` berilgan bo'lsa tekshiradi.

    To'g'ri — True; berilmagan — False (boshqa yo'llar tekshiriladi);
    xato — 401, ketma-ket xatolarda 429. Cheklov faqat KALIT BERILGAN-u,
    xato bo'lgan holatga: sarlavhasiz so'rov oddiy brauzer so'rovi.
    """
    if not request.headers.get("x-api-key"):
        return False
    ip = client_ip(request)
    if api_key_ok(request):
        _key_throttle.clear(ip)
        return True

    kutish = _key_throttle.retry_after(ip)
    if kutish:
        # So'rov ICHIDA uxlanmaydi — javob darhol qaytadi, mijoz o'zi
        # kutadi. Uxlash jarayonning ishchi oqimlarini band qilardi va
        # shu bilan cheklovning o'zi DoS quroliga aylanardi.
        soniya = max(1, math.ceil(kutish))
        raise HTTPException(
            429, f"Juda ko'p urinish — {soniya} soniyadan keyin qayta urining",
            headers={"Retry-After": str(soniya)})

    _key_throttle.note_fail(ip)
    log("auth", "api_key_xato", level="warning", ip=ip,
        path=request.url.path)
    raise HTTPException(401, "X-API-Key noto'g'ri")


def require_viewer(request: Request) -> None:
    """Ko'rish yo'llari: kalit, sessiya yoki (PUBLIC_VIEW=1) mehmon."""
    if key_guard(request):
        return
    if current_user(request) is not None:
        return
    if PUBLIC_VIEW:
        return
    raise HTTPException(401, "Avval tizimga kiring")


def require_user(request: Request) -> None:
    """Faqat kirganlar (yoki kalit) — mehmonga yopiq bo'limlar uchun."""
    if key_guard(request):
        return
    if current_user(request) is None:
        raise HTTPException(401, "Avval tizimga kiring")
