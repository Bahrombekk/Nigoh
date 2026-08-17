"""Nigoh — sozlamalar.

Hammasi muhit o'zgaruvchilari orqali boshqariladi, standart qiymatlar
bitta kompyuterda ishga tushirishga mo'ljallangan.
"""
import os

PORT = int(os.environ.get("PORT", "8010"))
HLS_PORT = int(os.environ.get("HLS_PORT", "8888"))
WEBRTC_PORT = int(os.environ.get("WEBRTC_PORT", "8889"))
MEDIA_HOST = os.environ.get("MEDIA_HOST", "")  # bo'sh bo'lsa so'rov manzilidan olinadi

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
