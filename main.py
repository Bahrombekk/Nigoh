"""Nigoh — kamera xaritasi, video devor, dashboard va kamera/media qatlami.

Ishga tushirish:
    pip install -r requirements.txt
    python main.py
Keyin brauzerda:  http://localhost:8010
(Portni o'zgartirish:  set PORT=8020  &&  python main.py)

Sozlamalar muhitdan yoki loyiha ildizidagi `.env` dan o'qiladi
(namuna: `.env.example`).

Admin parolini almashtirish:
    python main.py --admin-parol YangiParol123

Kod tuzilishi:
    main.py            shu fayl — faqat kirish nuqtasi
    app/               BACKEND: config, kirish (rollar, hududlar), endpointlar
    media/             MEDIAMTX QATLAMI: sync, reconciler, launcher,
                       transport (RTSP transportini o'lchash), devor
    core/              UMUMIY: db, security, health, snapshots, rtsp_probe,
                       device_info, fast_start, bus, events, metrics, stats,
                       alerts, log, watchdog
    static/            interfeys (xarita, devor, dashboard, boshqaruv)
    tests/             pytest (pytest.ini: testpaths=tests)
    scripts/           yordamchi skriptlar
    stream_launcher.py MediaMTX chaqiradigan yupqa qobiq (ildizda turishi shart)
"""
import os
import sys

import uvicorn

from app import create_app
from app.bootstrap import bootstrap, change_admin_password
from app.config import PORT
from core import watchdog

# Uvicorn to'xtatish signalini olganda ochiq ulanishlarni shuncha kutadi,
# keyin majburan uzadi.
#
# NIMA UCHUN CHEGARA BOR. Standart holda uvicorn CHEKSIZ kutadi, SSE
# (`/api/v1/events`) ulanishi esa hech qachon o'z-o'zidan yopilmaydi —
# ishlab chiqarishda aynan shu bo'ldi: bitta SSE ulanishi tufayli jarayon
# "Waiting for connections to close" holatida qotib qoldi, tinglash soketi
# yopildi va butun xizmat (HLS auth, RTSP auth, API) muddatsiz o'ldi.
# Tafsiloti: core/watchdog.py.
SHUTDOWN_GRACE = float(os.environ.get("SHUTDOWN_GRACE", "5"))

if "--admin-parol" in sys.argv:
    index_of = sys.argv.index("--admin-parol")
    if index_of + 1 >= len(sys.argv):
        sys.exit("Parolni ko'rsating:  python main.py --admin-parol YangiParol")
    new_password = sys.argv[index_of + 1]
    if len(new_password) < 6:
        sys.exit("Parol kamida 6 belgidan iborat bo'lsin")
    change_admin_password(new_password)
    sys.exit(0)

bootstrap()
app = create_app()

if __name__ == "__main__":
    # 8000-port ko'pincha band bo'ladi (Docker Desktop, Windows xizmatlari) —
    # boshqa portni PORT muhit o'zgaruvchisi orqali berish mumkin.
    #
    # Avtomatik qayta yuklash faqat kod yozayotganda kerak (set RELOAD=1);
    # Windows'da u ba'zan osilib qoladi, shuning uchun standart holatda o'chiq.
    if os.environ.get("RELOAD") == "1":
        # reload rejimida uvicorn modulni o'zi qayta import qiladi — satr beriladi.
        uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=True)
    else:
        # Tayyor obyekt beriladi — modul qayta import qilinmaydi,
        # bootstrap ham ikki marta ishlamaydi.
        # Port o'lib, jarayon tirik qolgan holat uchun oxirgi chegara
        # (konteynerda o'zini tugatadi, Docker qaytaradi).
        watchdog.start(PORT)
        uvicorn.run(app, host="0.0.0.0", port=PORT,
                    timeout_graceful_shutdown=SHUTDOWN_GRACE)
