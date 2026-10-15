"""Nigoh — so'rov kelgan haqiqiy manzil va ishonchli proksilar.

`X-Forwarded-For` faqat ishonchli proksidan kelganda hisobga olinadi.
Aks holda cheklovni aylanib o'tish arzon: har so'rovda boshqa soxta
sarlavha yuborilsa har safar yangi "ip" hisobi ochiladi va eksponensial
kutish (core/throttle.py) umuman ishlamaydi. MediaMTX konfiguratsiyasida
shu tamoyil allaqachon bor (`hlsTrustedProxies`), backend'da yetishmasdi.

Standart — faqat loopback: nginx har bir deploy'da backend bilan bitta
tarmoq nomlar fazosida turadi (Linux: `network_mode: host`, Windows:
`network_mode: "service:nigoh"`, start.bat — proksisiz) va 127.0.0.1 dan
ulanadi. Ilgari ichki tarmoqlarning HAMMASI ishonchli edi: ichki tarmoqdagi
istalgan kompyuter (operatorlar, kameralar segmenti) backend portiga
to'g'ridan soxta X-Forwarded-For yuborib login cheklovini aylanib o'tar,
X-Viewer-IP bilan begona HLS sessiyasini tekshirar edi. Proksi alohida
hostda bo'lsa `TRUSTED_PROXIES` (vergul bilan, IP yoki CIDR) bering.

Tarkibi:
    TRUSTED_PROXIES         TRUSTED_PROXIES muhit o'zgaruvchisidan to'plam
                            (bo'sh — faqat loopback)
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
# Standart — faqat loopback (modul izohi). `TRUSTED_PROXIES` (vergul
# bilan, IP yoki CIDR: "10.0.0.7, 172.18.0.0/16") berilsa — faqat o'shalar.
_TRUSTED_ENV = os.environ.get("TRUSTED_PROXIES", "").strip()


TRUSTED_PROXIES = {p.strip() for p in _TRUSTED_ENV.split(",") if p.strip()}


def _tarmoqlar(qiymatlar) -> list:
    natija = []
    for q in qiymatlar:
        try:
            natija.append(ipaddress.ip_network(q, strict=False))
        except ValueError:
            pass        # noto'g'ri yozuv — e'tiborsiz (aniq satr mosligi qoladi)
    return natija


_TRUSTED_NETS = _tarmoqlar(TRUSTED_PROXIES)


def ishonchli_proksi(peer: str) -> bool:
    try:
        manzil = ipaddress.ip_address(peer)
    except ValueError:
        return peer in TRUSTED_PROXIES
    manzil = getattr(manzil, "ipv4_mapped", None) or manzil   # ::ffff:127.0.0.1
    if TRUSTED_PROXIES:
        return peer in TRUSTED_PROXIES or any(
            manzil.version == n.version and manzil in n for n in _TRUSTED_NETS)
    return manzil.is_loopback


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
