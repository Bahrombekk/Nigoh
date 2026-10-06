"""Nigoh — so'rov kelgan haqiqiy manzil va ishonchli proksilar.

`X-Forwarded-For` faqat ishonchli proksidan kelganda hisobga olinadi.
Aks holda cheklovni aylanib o'tish arzon: har so'rovda boshqa soxta
sarlavha yuborilsa har safar yangi "ip" hisobi ochiladi va eksponensial
kutish (core/throttle.py) umuman ishlamaydi. MediaMTX konfiguratsiyasida
shu tamoyil allaqachon bor (`hlsTrustedProxies`), backend'da yetishmasdi.

Standart — loopback va ichki tarmoqlar ishonchli: nginx shu mashinada
turadi (`network_mode: host`, proksi 127.0.0.1 ga), lekin uni alohida
hostga ko'chirsa ham sozlamasiz ishlayversin. Internetdan to'g'ridan
kelgan so'rovning sarlavhasiga hech qachon ishonilmaydi. `TRUSTED_PROXIES`
(vergul bilan) berilsa — faqat o'sha manzillar.

Tarkibi:
    TRUSTED_PROXIES         TRUSTED_PROXIES muhit o'zgaruvchisidan to'plam
                            (bo'sh — loopback/ichki tarmoq qoidasi)
    ishonchli_proksi(peer)  ulanish manzili ishonchli proksimi
    client_ip(request)      haqiqiy mijoz manzili: ishonchli proksi ortida
                            X-Forwarded-For'ning birinchisi, aks holda peer

Kim ishlatadi: app/deps.py (API kaliti cheklovi), users/api.py (login
    cheklovi va cookie `secure` bayrog'i uchun X-Forwarded-Proto).
"""
import ipaddress
import os

from fastapi import Request

# `X-Forwarded-For` faqat ishonchli proksidan kelganda hisobga olinadi.
# Aks holda cheklovni aylanib o'tish arzon: har so'rovda boshqa soxta
# sarlavha yuborilsa har safar yangi "ip" hisobi ochiladi va eksponensial
# kutish umuman ishlamaydi. MediaMTX konfiguratsiyasida shu tamoyil
# allaqachon bor (`hlsTrustedProxies`), bu yerda yetishmasdi.
#
# Standart — loopback va ichki tarmoqlar: nginx shu mashinada turadi
# (`network_mode: host`, proksi 127.0.0.1 ga), lekin uni alohida hostga
# ko'chirsa ham sozlamasiz ishlayversin. Internetdan to'g'ridan kelgan
# so'rovning sarlavhasiga hech qachon ishonilmaydi. `TRUSTED_PROXIES`
# (vergul bilan) berilsa — faqat o'sha manzillar.
_TRUSTED_ENV = os.environ.get("TRUSTED_PROXIES", "").strip()


TRUSTED_PROXIES = {p.strip() for p in _TRUSTED_ENV.split(",") if p.strip()}


def ishonchli_proksi(peer: str) -> bool:
    if TRUSTED_PROXIES:
        return peer in TRUSTED_PROXIES
    try:
        manzil = ipaddress.ip_address(peer)
    except ValueError:
        return False
    return manzil.is_loopback or manzil.is_private


def client_ip(request: Request) -> str:
    """So'rov kelgan haqiqiy manzil.

    Nginx ortida u `X-Forwarded-For` da bo'ladi, lekin sarlavhaga faqat
    ulanish IShONChLI proksidan kelgandagina ishonamiz — aks holda uni
    har kim o'zi yozib yuboradi.
    """
    peer = request.client.host if request.client else ""
    if ishonchli_proksi(peer):
        fwd = request.headers.get("x-forwarded-for", "")
        if fwd:
            return fwd.split(",")[0].strip()
    return peer
