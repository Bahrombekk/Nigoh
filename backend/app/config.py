"""Nigoh — sozlamalar (muhit o'zgaruvchilari va `.env`).

Hammasi muhit o'zgaruvchilari orqali boshqariladi; qulaylik uchun repo
ildizidagi `.env` fayli ham o'qiladi (core/env.py yuklaydi, muhitda
allaqachon bor qiymatlar ustun turadi). Standart qiymatlar bitta
kompyuterda ishga tushirishga mo'ljallangan.

Tarkibi:
    PORT              backend porti (standart 8010)
    FRONTEND_DIR      interfeys papkasi (standart repo/frontend);
                      `FRONTEND_DIR=` (bo'sh) — backend faqat API, interfeys
                      alohida serverda (nginx yoki dev server)
    PUBLIC_VIEW       kirmagan mehmon xarita va oqimlarni ko'radimi
                      (standart ha; 0 — faqat kirganlar)
    API_KEY           NIGOH_API_KEY — server-to-server kirish (`X-API-Key`),
                      admin darajasida; bo'sh bo'lsa mexanizm o'chiq. Uzun
                      tasodifiy bo'lsin (`openssl rand -hex 32`)
    HLS_PORT          MediaMTX HLS porti (8888)
    WEBRTC_PORT       MediaMTX WebRTC/WHEP porti (8889)
    MEDIA_HOST        oqim manzilidagi xost; bo'sh — so'rov manzilidan
    MEDIA_BASE        HTTPS proksi ortida oqimlarning to'liq asosi
                      (masalan https://kamera.example.uz/media) — aks holda
                      brauzer videoni bloklaydi (mixed content); faqat
                      markaziy (1-) tugunga taalluqli
    VENDORS           kamera qo'shishda tanlanadigan RTSP shablonlari
    CHANNEL_VENDORS   kanal raqami bilan ishlaydigan (NVR bo'la oladigan)
                      ishlab chiqaruvchilar — skaner shu tartibda sinaydi

Kim ishlatadi: app/factory.py, app/bootstrap.py, app/deps.py,
    camera/api/{admin,devices,nodes}.py, camera/streaming.py,
    users/{access,api}.py, walls/api.py, main.py,
    database/scripts/fix_camera_data.py.
"""
import os
from pathlib import Path

# `.env` — core/env.py yuklaydi (muhitdagi qiymatlar ustun turadi).
from core import env  # noqa: E402,F401

PORT = int(os.environ.get("PORT", "8010"))

# Interfeys papkasi — backend uni o'zi beradi (standart: React build natijasi
# frontend/dist; `cd frontend && npm run build` yasaydi, start.bat yo'q bo'lsa
# o'zi yig'adi). Bo'sh qiymat (`FRONTEND_DIR=`) — backend faqat API, interfeys
# alohida serverda (nginx yoki `npm run dev`).
_frontend = os.environ.get("FRONTEND_DIR")
FRONTEND_DIR = (Path(_frontend) if _frontend else
                Path(__file__).resolve().parents[2] / "frontend" / "dist") if _frontend != "" else None

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
    {"id": "boshqa", "name": "Boshqa (qoʻlda)", "path": "/stream1", "port": 554},
]

# Kanal raqami bilan ishlaydigan (NVR bo'la oladigan) ishlab chiqaruvchilar —
# skaner shu tartibda sinaydi, birinchi javob bergani tanlanadi.
CHANNEL_VENDORS = ["hikvision", "dahua", "holowits", "uniview", "reolink", "axis"]
