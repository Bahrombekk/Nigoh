"""MediaMTX qatlami: backend MediaMTX bilan faqat shu paket orqali gaplashadi.

Kameralar mediamtx.yml'ga yozilmaydi — yo'llar ishlab turgan MediaMTX'ga
Control API orqali talab bo'yicha qo'shiladi, reconciler esa har 30 s da
tugunlarni kerakli holatga keltiradi. FFmpeg kerak bo'lganda (H.265 ni
o'girish, relay, devor mozaikasi) MediaMTX launcher'ni chaqiradi.

Tarkibi:
    sync.py         konfiguratsiya, Control API, FFmpeg buyruqlari, issiq yo'llar
    reconciler.py   fon kuzatuvchisi: yo'llarni kelishtirish, muzlash, sub salomatligi
    launcher.py     MediaMTX chaqiradigan jarayon (stream_launcher.py ichidan)
    transport.py    kamera uchun TCP/UDP transportini o'lchab tanlash
    fast_start.py   tez ochilish: ONVIF/ISAPI keyframe so'rovi, HTTP surat
    mapping.py      baza qatori -> MediaMTX tushunadigan lug'at

Kim ishlatadi: camera.api, camera.monitoring, app (bootstrap, health),
stream_launcher.py
"""
