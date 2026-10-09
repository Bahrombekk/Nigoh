"""Nigoh — kamera xaritasi, video devor, dashboard va kamera/media qatlami.

Kirish nuqtasi: `bootstrap()` (baza, fon xizmatlari, super-admin), keyin
`app = create_app()` va uvicorn. Modul import qilinganda ham `app` tayyor
bo'ladi (`uvicorn main:app`, RELOAD rejimi).

Ishga tushirish (backend/ dan):
    pip install -r requirements.txt
    python main.py
Keyin brauzerda:  http://localhost:8010
(Portni o'zgartirish:  set PORT=8020  &&  python main.py)
Kod yozayotganda avtomatik qayta yuklash:  set RELOAD=1  (Windows'da ba'zan
osilib qoladi, shuning uchun standart holatda o'chiq.)

Sozlamalar muhitdan yoki repo ildizidagi `.env` dan o'qiladi
(namuna: `.env.example`). Baza — PostgreSQL (DATABASE_URL).

Admin parolini almashtirish (kamida 6 belgi; eski sessiyalar bekor bo'ladi):
    python main.py --admin-parol YangiParol123

To'xtatishda uvicorn ochiq ulanishlarni SHUTDOWN_GRACE (standart 5 s)
kutadi, keyin majburan uzadi: aks holda bitta SSE ulanishi jarayonni
"Waiting for connections to close" da muddatsiz qotirardi (tafsiloti:
core/watchdog.py). Konteynerda watchdog ham yoqiladi.

Kod tuzilishi (backend/):
    main.py              shu fayl — faqat kirish nuqtasi
    stream_launcher.py   MediaMTX chaqiradigan yupqa qobiq (backend/ ildizida
                         turishi shart — mediamtx.yml shu yo'lni ko'rsatadi)
    app/                 ilovani yig'ish: create_app, config, deps (kirish
                         darajalari), bootstrap, network, /health,
                         /admin/runtime va /admin/status
    camera/              kamera va video qatlami
      api/               HTTP: cameras, streams, events (SSE), metrics,
                         devices (skaner), nodes, mediamtx, admin (CRUD, NVR)
      media/             MediaMTX: sync, reconciler, launcher, mapping,
                         transport, fast_start
      monitoring/        health (tiriklik), snapshots, passport, open_times
      probe/             RTSP tekshiruv: rtsp_probe, device_info, detect
      state.py streaming.py views.py schemas.py
                         holat, chiptali oqim manzillari, javob ko'rinishi,
                         so'rov modellari
    stats/               dashboard statistikasi: api, overview, admin_api
                         (uzilishlar tahlili), recorder, reporting/ (sof hisob)
    users/               foydalanuvchilar va kirish: api (/auth), admin_api,
                         access (rollar, hududlar), schemas
    walls/               server tomonidagi video devor: api, registry, mosaic
    database/            PostgreSQL: connection, schema, migrations/,
                         repositories/, api.py (/admin/db), scripts/, sql/
    core/                umumiy infratuzilma: env, paths, log, bus, throttle,
                         watchdog, security, alerts, version
    scripts/             yordamchi CLI skriptlar (diagnostika, import, nginx)
    tests/               pytest (pytest.ini: testpaths=tests)
    ../frontend/         interfeys — React + Vite + TS (src/), build: frontend/dist —
                         backend o'zi beradi (FRONTEND_DIR)
"""
import os
import sys

import uvicorn

from app.bootstrap import bootstrap, change_admin_password
from app.config import PORT
from app.factory import create_app
from core import watchdog
from core.logs import setup as logs_setup

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

# Log tizimi hammadan oldin: bootstrap (migratsiya, xizmatlar) yozuvlari ham
# logs/ ga tushsin, uvicorn esa o'z log sozlamasini ustiga yozmasin (log_config=None).
logs_setup.configure()
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
        uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=True, log_config=None)
    else:
        # Tayyor obyekt beriladi — modul qayta import qilinmaydi,
        # bootstrap ham ikki marta ishlamaydi.
        # Port o'lib, jarayon tirik qolgan holat uchun oxirgi chegara
        # (konteynerda o'zini tugatadi, Docker qaytaradi).
        watchdog.start(PORT)
        uvicorn.run(app, host="0.0.0.0", port=PORT, log_config=None,
                    timeout_graceful_shutdown=SHUTDOWN_GRACE)
