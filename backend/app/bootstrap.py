"""Nigoh — ishga tushirish tayyorgarligi: baza, fon xizmatlari, super-admin.

`bootstrap()` ilova so'rov qabul qilishidan OLDIN bir marta chaqiriladi
(main.py, `create_app()` dan oldin). Tartib: baza (init_db — sxema va
migratsiyalar) -> fon xizmatlari -> mediamtx.yml -> reconciler ->
dashboard yozuvchisi -> WebRTC manzili tekshiruvi -> super-admin. Har
qadamning sababi kod ichidagi izohlarda.

Fon xizmatlari:
    camera.monitoring.health      kameralar tirikligi (TCP sweep); MediaMTX
                                  oqim olayotgan kamera "o'chiq" deb
                                  belgilanmaydi (`_streaming_pairs` zondi);
                                  har sweep'dan keyin ilgaklar: notifications.alerts
                                  (tizim bildirishnomalari), camera.trash (savat)
    camera.monitoring.snapshots   suratlar diskda, pog'onali: issiq 10 s,
                                  sovuq online — bir necha daqiqa
    camera.monitoring.passport    kodek/model bo'sh kameralarni qayta tekshirish
    camera.media.reconciler       MediaMTX kuzatuvi: yiqilsa qayta ko'taradi,
                                  yo'llarni kelishtiradi; saytni kutdirmaydi
    stats.recorder                dashboard tarixi — har daqiqada

mediamtx.yml har ishga tushishda qayta yoziladi — portlar va kirish
nazorati kod bilan birga yangilansin. WEBRTC_HOSTS/MEDIA_HOST/MEDIA_BASE
bo'sh bo'lsa ogohlantirish yoziladi: manzil marshrut bo'yicha topilsa
WebRTC faqat ichki tarmoqda ishlaydi; umuman topilmasa ICE virtual
adapterni (VPN, WSL) tanlab qolishi mumkin. Bu eng qimmat jim
nosozliklardan biri edi (har ochilish 6 s kutib HLS'ga tushardi).

Tarkibi:
    bootstrap()                 hammasini ishga tushiradi; birinchi marta
                                super-admin yaratilsa parolini konsolga chiqaradi
    change_admin_password(p)    `python main.py --admin-parol Yangi` — parolni
                                almashtiradi, eski sessiyalar bekor bo'ladi

Ichki: `_load_cameras()` — reconciler uchun kameralarning MediaMTX
ko'rinishi; `_streaming_pairs()` — health uchun MediaMTX oqim olayotgan
(ip, port) lar; monitoring qatlami media'ga bog'lanmasligi uchun shu
yerda turadi va health'ga uzatiladi.

Ishlatadi: database (init_db, get_db, cameras), camera.media (sync,
    reconciler, mapping), camera.monitoring (health, passport, snapshots),
    core.security, core.log, stats.recorder, app.config.
Kim ishlatadi: main.py.
"""
import os

from app.config import API_KEY
from camera import trash
from camera.media import reconciler
from camera.media import sync as mediamtx_sync
from camera.media.mapping import cameras_for_mediamtx
from camera.monitoring import health, passport, snapshots
from core import security
from core.log import log
from database import cameras, get_db, init_db
from notifications import alerts as system_alerts
from stats import recorder as stats_recorder


def _load_cameras() -> list[dict]:
    """Reconciler uchun: kameralarning MediaMTX ko'rinishi, har safar bazadan."""
    with get_db() as db:
        return cameras_for_mediamtx(db)


def _streaming_pairs() -> set[tuple[str, int]]:
    """Ayni damda MediaMTX oqim olayotgan kameralarning (ip, port) to'plami.

    Health tekshiruvi shu ro'yxatga qaraydi: TCP javob bermasa ham,
    MediaMTX kameradan bayt olayotgan bo'lsa kamera tirik hisoblanadi.
    Sweep'da faqat tekshiruvdan o'tmagan manzil bo'lsa chaqiriladi.

    core/ media/ ga bog'lanmasligi uchun funksiya shu qatlamda turadi va
    health'ga uzatiladi (reconciler'dagi `load_cameras` bilan bir xil).
    """
    paths = mediamtx_sync.list_active_paths()
    if not paths:
        return set()
    ready = set()
    for name, item in paths.items():
        if not item.get("ready"):
            continue
        base = name
        for suffix in (mediamtx_sync.TRANSCODE_SUFFIX, mediamtx_sync.SUB_SUFFIX):
            if base.endswith(suffix):
                base = base[: -len(suffix)]
        ready.add(base)
    if not ready:
        return set()
    with get_db() as db:
        rows = [r for r in cameras.list_rtsp(db) if r["slug"] in ready]
    return {(r["ip"], r["port"] or 554) for r in rows if r["ip"]}


def bootstrap() -> None:
    init_db()

    # Kameralarning tirikligini fonda kuzatib boramiz — xaritada o'chiq
    # kameralar qizil bo'lib ko'rinadi.
    # Oqim ketayotgan kamera "o'chiq" deb belgilanmasin: TCP tekshiruvi
    # qurilma band yoki sekin bo'lganda ham yiqiladi, MediaMTX'dagi bayt
    # esa tiriklikning aniq dalili.
    health.set_streaming_probe(_streaming_pairs)
    # Har sweep'dan keyin: tizim bildirishnomalari (disk, MediaMTX, baza —
    # holat o'zgarganda bitta yozuv) va savatdagi 30 kundan eski kameralarni
    # butunlay o'chirish (soatiga bir).
    health.add_hook(system_alerts.check)
    health.add_hook(trash.purge)
    health.start()

    # Suratlar diskda, pog'onali yangilanadi: issiq (so'ralgan) — 10 s,
    # sovuq online — 5 daqiqa. Poster'lar shu zaxiradan darhol beriladi.
    snapshots.start()

    # Kodek/model bo'sh qolgan kameralar fonda qayta tekshiriladi — qo'shilgan
    # paytda javob bermagan kamera ma'lumotsiz qolib ketmasin.
    passport.start()

    # mediamtx.yml har ishga tushishda qayta yoziladi: portlar va kirish
    # nazorati sozlamalari kod bilan birga yangilansin. MediaMTX ishlab
    # turgan bo'lsa faylni o'zi qayta o'qiydi — qo'lda hech narsa kerak emas.
    with get_db() as db:
        mediamtx_sync.write_config(cameras_for_mediamtx(db))

    # MediaMTX'ni fonda kuzatib turamiz: yiqilsa qayta ishga tushiriladi,
    # yo'llar (kamera qo'shildi/o'chirildi, MediaMTX qayta ko'tarildi)
    # o'z-o'zidan kelishtiriladi. Sayt ochilishini kutdirmaydi.
    reconciler.start(_load_cameras)

    # Dashboard tarixi (availability_snapshots / status_changes) — har daqiqada.
    stats_recorder.start_recorder()

    log("app", "started", api_key=bool(API_KEY))

    # WebRTC tashqaridan ishlashi uchun MediaMTX ICE nomzodida brauzer
    # YETA OLADIGAN manzilni e'lon qilishi kerak. Sozlanmasa u faqat
    # o'z interfeyslarini beradi (127.0.0.1, ichki LAN, docker0) va
    # tashqi tomoshabinda signalizatsiya o'tadi, kadr esa kelmaydi.
    #
    # Bu eng qimmat jim nosozliklardan biri: har ochilish 6 soniya
    # behuda kutib HLS'ga tushadi, HLS'ning sovuq starti esa 15-65
    # soniya — foydalanuvchi buni "sekin" va "ochilmayapti" deb ko'radi.
    # O'lchov: 5 kameradan 5 tasi 12 soniyada bitta kadr bermadi.
    #
    # Sozlama berilmasa manzil endi marshrut bo'yicha O'ZI aniqlanadi
    # (media/sync.webrtc_ice_hosts) — ya'ni ichki tarmoqdagi tomoshabin
    # uchun WebRTC baribir ishlaydi. Shuning uchun ogohlantirish
    # yumshatildi: u endi "umuman ishlamaydi" emas, "faqat ichkarida
    # ishlaydi" deydi. Umuman manzil topilmagani esa jiddiy — o'shanda
    # MediaMTX hamma interfeysni e'lon qiladi va ICE virtual adapterni
    # (VPN, WSL) tanlab qo'yishi mumkin; o'lchovda bu qotishni ikki
    # barobar oshirgan edi.
    if not mediamtx_sync.WEBRTC_HOSTS:
        topilgan = mediamtx_sync.webrtc_ice_hosts()
        log("app", "webrtc_tashqi_manzil_yoq",
            level="info" if topilgan else "warning",
            topilgan=topilgan,
            sabab=("WEBRTC_HOSTS/MEDIA_HOST/MEDIA_BASE boʻsh — manzil "
                   f"marshrut boʻyicha aniqlandi ({', '.join(topilgan)}). "
                   "Ichki tarmoqdagi tomoshabinga yetadi, internetdagi "
                   "tomoshabinga YETMAYDI." if topilgan else
                   "WEBRTC_HOSTS/MEDIA_HOST/MEDIA_BASE boʻsh va manzil "
                   "avtomatik ham aniqlanmadi — MediaMTX hamma "
                   "interfeysni eʼlon qiladi, ICE virtual adapterni "
                   "(VPN, WSL) tanlab qolishi mumkin"),
            yechim="Tashqi tomoshabin kerak boʻlsa `.env` ga "
                   "WEBRTC_HOSTS=<domen yoki tashqi IP> yozing va ICE "
                   "portini (UDP/TCP) firewallda oching")

    with get_db() as db:
        generated = security.ensure_admin(db)
    if generated:
        log("app", "admin_created",
            username=os.environ.get("ADMIN_LOGIN", "admin"))
        login_name = os.environ.get("ADMIN_LOGIN", "admin")
        print("\n" + "=" * 58)
        print("  SUPER-ADMIN YARATILDI — bu maʼlumotni saqlab qoʻying")
        print(f"     login:  {login_name}")
        print(f"     parol:  {generated}")
        print("  Parolni almashtirish:")
        print("     python main.py --admin-parol YangiParol")
        print("=" * 58 + "\n")


def change_admin_password(new_password: str) -> None:
    """`python main.py --admin-parol Yangi` buyrug'i uchun."""
    init_db()
    with get_db() as conn:
        security.set_password(conn, os.environ.get("ADMIN_LOGIN", "admin"), new_password)
    print("Parol almashtirildi. Barcha eski sessiyalar bekor qilindi.")
