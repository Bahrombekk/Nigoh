"""Nigoh — sozlamalar.

Hammasi muhit o'zgaruvchilari orqali boshqariladi; qulaylik uchun loyiha
ildizidagi `.env` fayli ham o'qiladi (muhitda allaqachon bor qiymatlar
ustun turadi). Standart qiymatlar bitta kompyuterda ishga tushirishga
mo'ljallangan.
"""
import os
from pathlib import Path

# `.env` — kalitlarni bat-fayl yoki muhitga yozmasdan berish yo'li.
# Docker compose ham shu faylni yuklaydi — u yerda qiymatlar allaqachon
# muhitda bo'ladi va setdefault ularni almashtirmaydi.
# Repo ildizida (backend/ dan bir pog'ona yuqori).
_ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
if _ENV_PATH.exists():
    for _line in _ENV_PATH.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _v = _line.split("=", 1)
        os.environ.setdefault(_k.strip(), _v.strip())

PORT = int(os.environ.get("PORT", "8010"))

# Interfeys papkasi — backend uni o'zi beradi (standart: repo ildizidagi
# frontend/). Bo'sh qiymat (`FRONTEND_DIR=`) — backend faqat API, interfeys
# alohida serverda (nginx yoki frontendchining dev serveri).
_frontend = os.environ.get("FRONTEND_DIR")
FRONTEND_DIR = (Path(_frontend) if _frontend else
                Path(__file__).resolve().parents[2] / "frontend") if _frontend != "" else None

# Kirmagan (anonim) foydalanuvchi xarita va oqimlarni ko'ra oladimi.
# Standart — ha. PUBLIC_VIEW=0 qilinsa faqat tizimga kirganlar ko'radi:
# admin — hammasini, operator — o'z hududlarini.
PUBLIC_VIEW = os.environ.get("PUBLIC_VIEW", "1") != "0"

# Server-to-server kirish: tashqi backend `X-API-Key` sarlavhasi bilan
# to'liq (admin darajasida) kiradi — cookie/login kerak emas. Bo'sh qolsa
# mexanizm o'chiq, tizim faqat login bilan ishlaydi. Kalit qo'yilsa uzun
# tasodifiy bo'lsin (masalan, `openssl rand -hex 32`).
API_KEY = os.environ.get("NIGOH_API_KEY", "")
HLS_PORT = int(os.environ.get("HLS_PORT", "8888"))
WEBRTC_PORT = int(os.environ.get("WEBRTC_PORT", "8889"))
MEDIA_HOST = os.environ.get("MEDIA_HOST", "")  # bo'sh bo'lsa so'rov manzilidan olinadi

# Sayt HTTPS proksi (nginx) ortida bo'lsa, oqim manzillari ham HTTPS bo'lishi
# shart — aks holda brauzer videoni bloklaydi (mixed content). MEDIA_BASE
# to'liq asos beradi (masalan, https://kamera.example.uz/media) va proksi
# /hls/ ni 8888-ga, /whep/ ni 8889-ga o'tkazadi. Bo'sh qolsa eski usul:
# http://MEDIA_HOST:port. Faqat markaziy (1-) tugunga taalluqli.
MEDIA_BASE = os.environ.get("MEDIA_BASE", "").rstrip("/")

# Kamerani qo'shishda tanlanadigan tayyor RTSP shablonlari.
VENDORS = [
    {"id": "hikvision", "name": "Hikvision", "path": "/Streaming/Channels/101", "port": 554},
    {"id": "dahua", "name": "Dahua", "path": "/cam/realmonitor?channel=1&subtype=0", "port": 554},
    {"id": "uniview", "name": "Uniview", "path": "/media/video1", "port": 554},
    {"id": "axis", "name": "Axis", "path": "/axis-media/media.amp", "port": 554},
    {"id": "tplink", "name": "TP-Link / Tapo", "path": "/stream1", "port": 554},
    {"id": "reolink", "name": "Reolink", "path": "/h264Preview_01_main", "port": 554},
    {"id": "amcrest", "name": "Amcrest", "path": "/cam/realmonitor?channel=1&subtype=0", "port": 554},
    {"id": "holowits", "name": "Holowits / Huawei", "path": "/LiveMedia/ch1/Media1", "port": 554},
    {"id": "boshqa", "name": "Boshqa (qo'lda)", "path": "/stream1", "port": 554},
]

# Kanal raqami bilan ishlaydigan (NVR bo'la oladigan) ishlab chiqaruvchilar —
# skaner shu tartibda sinaydi, birinchi javob bergani tanlanadi.
CHANNEL_VENDORS = ["hikvision", "dahua", "holowits", "uniview", "reolink", "axis"]
