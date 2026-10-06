"""Kamera qatlamining HTTP endpointlari (FastAPI routerlari).

Har fayl bitta `router` beradi; prefikslar nisbiy — app.create_app ularni
/api/v1 (asosiy) va /api (eski) ostida ulaydi va kirish darajasini
qo'shadi.

Tarkibi:
    cameras.py      /cameras — xarita ro'yxati, holat, oqim, surat (ko'rish)
    streams.py      /streams — devor uchun batch oqim chiptalari (ko'rish)
    events.py       /events — holat o'zgarishlari SSE (ko'rish)
    metrics.py      /metrics/open — pleyer ochilish vaqti (ko'rish)
    devices.py      /devices — fon skani (job + SSE), qurilma pasporti (admin)
    admin.py        /admin/cameras CRUD, NVR import, skan, probe (admin)
    nodes.py        /admin/nodes — MediaMTX tugunlari (admin)
    mediamtx.py     /admin/events, /admin/mediamtx/sync|config (admin)

Kim ishlatadi: app/factory.py (create_app -> mount)
"""
