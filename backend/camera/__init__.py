"""Kamera qatlami: kamera bilan bog'liq hamma narsa shu paketda.

Kamera qo'shilishidan to brauzerda ochilishigacha bo'lgan butun yo'l —
HTTP endpointlar, RTSP tekshiruvi, MediaMTX boshqaruvi, fon kuzatuvi va
oqim manzillari — mavzu bo'yicha kichik paketlarga bo'lingan. Batafsil
xarita va kamera hayot sikli: camera/README.md.

Tarkibi:
    api/            HTTP endpointlar (/cameras, /admin/cameras, /devices,
                    /streams, /events, /metrics, /admin/nodes, /admin/mediamtx)
    media/          MediaMTX qatlami: konfiguratsiya va Control API (sync),
                    reconciler, launcher, transport, fast_start, mapping
    monitoring/     fon xizmatlari: health, snapshots, passport, open_times
    probe/          qurilmani tekshirish: rtsp_probe, device_info, detect
    schemas.py      so'rov modellari (Pydantic)
    state.py        kameraning yagona holati, `ref` bo'yicha qidiruv
    streaming.py    brauzerga oqim manzillari, tugun ma'lumoti
    views.py        kamera qatorining public/admin JSON ko'rinishi
    sync            `camera.media.sync` qisqa nomi (eski `from camera import sync`)

MediaMTX'ning o'zi (mediamtx/ papkasi) repo ildizida, mediamtx.yml esa
ma'lumotlar katalogida (DATA_DIR, standart — repo ildizi); MediaMTX
chaqiradigan yupqa qobiq — backend/stream_launcher.py. Lokal MediaMTX'ni
reconciler ko'taradi (start.bat ham ishga tushirishi mumkin).

Ishlatadi: core (security, log, bus, paths), database, users.access, app.config
Kim ishlatadi: app (routerlarni ulaydi, bootstrap fon xizmatlarini
yoqadi, /health), stats, walls, stream_launcher.py, scripts, testlar
"""
from camera.media import sync  # noqa: F401
