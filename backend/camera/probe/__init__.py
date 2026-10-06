"""Qurilmani tekshirish: RTSP muloqoti, qurilma pasporti, kodek va sub yo'l.

Bu paketdagi hamma narsa kameraga to'g'ridan ulanadi va bir martalik
savolga javob beradi ("bu yo'l oqim beradimi?", "model nima?") — fon
kuzatuvi yo'q (u camera.monitoring da).

Tarkibi:
    rtsp_probe.py   kutubxonasiz RTSP tekshiruvi: tarmoq -> RTSP -> parol -> SETUP
    device_info.py  ONVIF/ISAPI orqali ishlab chiqaruvchi, model, firmware
    detect.py       saqlashdan oldin kodek va sub yo'lni aniqlash, kanal shablonlari

Kim ishlatadi: camera.api (admin, devices), camera.media, camera.monitoring
(passport), scripts, database/scripts/fix_camera_data.py
"""
