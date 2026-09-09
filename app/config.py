"""Nigoh — sozlamalar.

Hammasi muhit o'zgaruvchilari orqali boshqariladi; qulaylik uchun loyiha
ildizidagi `.env` fayli ham o'qiladi (muhitda allaqachon bor qiymatlar
ustun turadi). Standart qiymatlar bitta kompyuterda ishga tushirishga
mo'ljallangan.
"""
import os
from pathlib import Path

# `.env` — kalitlarni bat-fayl yoki muhitga yozmasdan berish yo'li.
_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
if _ENV_PATH.exists():
    for _line in _ENV_PATH.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _v = _line.split("=", 1)
        os.environ.setdefault(_k.strip(), _v.strip())

PORT = int(os.environ.get("PORT", "8010"))

# Kamera mikroservisi (nigoh-servis): butun kamera/media qatlami o'sha
# yerda. Bu tizim unga faqat HTTP orqali, X-API-Key bilan murojaat qiladi.
# Ikkalasi ham MAJBURIY — usiz tizim ishga tushmaydi (bootstrap tekshiradi).
NIGOH_URL = os.environ.get("NIGOH_URL", "").rstrip("/")
NIGOH_KEY = os.environ.get("NIGOH_KEY", "")

# Kirmagan (anonim) foydalanuvchi xarita va oqimlarni ko'ra oladimi.
# Standart — ha (hozirgi xatti-harakat). PUBLIC_VIEW=0 qilinsa faqat
# tizimga kirganlar ko'radi: admin — hammasini, operator — o'z hududlarini.
PUBLIC_VIEW = os.environ.get("PUBLIC_VIEW", "1") != "0"

# Server-to-server kirish: tashqi backend `X-API-Key` sarlavhasi bilan
# to'liq (admin darajasida) kiradi — cookie/login kerak emas. Bo'sh qolsa
# mexanizm o'chiq. Bu — SHU tizimning o'z kaliti; mikroservis kaliti
# (NIGOH_KEY) bilan adashtirmang.
API_KEY = os.environ.get("NIGOH_API_KEY", "")

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
