"""Kameralar boshqaruvi: CRUD, NVR import, skaner, probe va diagnostika.

Foydalanuvchilar (users/admin_api.py), MediaMTX holati (camera/api/mediamtx.py)
va tugunlar (camera/api/nodes.py) alohida fayllarda.

Takror qo'shish xato emas: bitta IP+port+yo'l bitta kameraga tegishli,
shuning uchun ikkinchi so'rov ham 201 va o'sha kameraning o'zini oladi
(sarlavhada `X-Nigoh-Existing: 1`), nusxa yaratilmaydi. Tashqi tizimning
dev va prod muhitlari bitta Nigoh'ga ulanganda ikkinchisi 409 ga urilib
qolmasin, "Qo'shish" ikki bosilishi ham shunday o'tadi. Kanal ko'rsatilmagan
so'rovda (`/stream1` yoki bo'sh) IP+port yetadi — aks holda o'sha
kameraning oqim bermaydigan `/stream1` nusxasi qo'shilardi. Poyga
(probe davomida boshqa so'rov qo'shib ulgursa) bazadagi cheklov va
savepoint bilan ushlanadi.

Parol so'ralmagan joyda (`camera_id`) saqlangan parol ishlatiladi. NVR
importida birinchi kanal YOLG'IZ tekshiriladi: parol xato bo'lsa qolgan
kanallarga tegilmaydi (Hikvision 5 xato urinishdan keyin IP'ni bloklaydi).

Endpointlar (admin; router darajasida require_admin, ulashda key_guard):
  Kameralar
    GET    /api/v1/admin/cameras                 qidiruv + sahifalash (q, limit<=500, offset)
    POST   /api/v1/admin/cameras                 qo'shish: kodek/sub aniqlanadi, holat
                                                 darhol, pasport fonda; takror — 201 o'sha
    PUT    /api/v1/admin/cameras/{ref}           tahrirlash; bo'sh parol — eskisi qoladi,
                                                 kamera javob bermasa eski kodek qoladi
    DELETE /api/v1/admin/cameras/{ref}           o'chirish (204)
    POST   /api/v1/admin/cameras/{ref}/enabled   yoqish/o'chirish bir bosishda
    GET    /api/v1/admin/cameras/{ref}/uptime    ish vaqti tarixi (?hours, <=30 kun):
                                                 segmentlar, uptime %, uzilishlar
    POST   /api/v1/admin/cameras/detect-sub      sub yo'li yo'q kameralarga 2-oqim
                                                 topish (16 parallel probe)
    POST   /api/v1/admin/cameras/{ref}/keyframe  darhol keyframe so'rash (diagnostika)
  Qurilmalar
    POST   /api/v1/admin/nvr/import              registrator kanallari -> kameralar
                                                 (dry_run, probe, spiral joylashuv)
    POST   /api/v1/admin/scan                    sinxron skan: shablon + jonli kanallar
                                                 (fon varianti: /devices/scan)
    POST   /api/v1/admin/probe                   bitta RTSP yo'l va login'ni tekshirish

Tarkibi (ochiq yordamchilar):
    parse_channels(spec, limit)   "1-16" / "1,3,5-8" -> raqamlar ro'yxati
    spread_point(lat, lng, i, m)  NVR kanallarini oltin burchak spiralida
                                  tarqatadi — markerlar ustma-ust tushmasin
    DEFAULT_RTSP_PATH             "/stream1" — "kanal tanlanmagan" belgisi
  Ichki: _rtsp_twin (takror kamerani 3 bosqichda izlash), _camera_data
  (joylashuvni normallashtirish: 0,0 -> NULL, hudud, km/piket nomdan),
  _enrich_new_camera (health.check_now + pasport fonda)

Ishlatadi: app.config, camera.probe (rtsp_probe, detect, device_info),
camera.media.fast_start, camera.monitoring.health, camera.schemas,
camera.state, camera.views, core (security, log), database (cameras,
areas, rail, events), users.access
Kim ishlatadi: app/factory.py (router); frontend admin paneli, tashqi
backend (X-API-Key); tests/test_channels.py (parse_channels, spread_point)
"""
import math
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.config import CHANNEL_VENDORS, VENDORS
from camera.media import fast_start
from camera.media.fast_start import channel_from_path, channel_marked
from camera.monitoring import health
from camera.probe import device_info as devinfo
from camera.probe.detect import channel_path, detect_codec, detect_sub_path
from camera.probe.rtsp_probe import probe
from camera.schemas import CameraIn, EnabledIn, NvrIn, ProbeIn, ScanIn
from camera.state import resolve_ref
from camera.views import admin_camera
from core import security
from core.log import log
from database import (
    IntegrityError,
    areas,
    cameras,
    events,
    get_db,
    rail,
    unique_slug,
)
from users.access import require_admin

# Prefiks nisbiy — create_app uni /api/v1 (asosiy) va /api (eski) ostida ulaydi.
router = APIRouter(prefix="/admin", tags=["admin"],
                   dependencies=[Depends(require_admin)])


def _fill_passport(camera_ids: list[int], ip: str,
                   username: str, password: str) -> None:
    """Qurilma pasportini (model/firmware) fonda so'rab bazaga yozadi.

    ONVIF/ISAPI sekin javob berishi mumkin — yaratish so'rovini
    kuttirmaslik uchun alohida ipda yuradi. Qurilma pasport bermasa
    jimgina o'tib ketiladi — bu majburiy ma'lumot emas.
    """
    info = devinfo.device_info(ip, username, password)
    if not info or not (info["model"] or info["firmware"]):
        return
    with get_db() as db:
        cameras.set_passport(db, camera_ids, info["model"], info["firmware"])


def _enrich_new_camera(camera_ids: list[int], ip: str, port: int,
                       username: str, password: str) -> None:
    """Yangi qo'shilgan kamera sahifasi darhol to'liq bo'lsin:
    holat hozir tekshiriladi (tez, ≤1.5 s), pasport fonda to'ladi."""
    if not ip:
        return
    health.check_now(ip, port)
    threading.Thread(
        target=_fill_passport,
        args=(camera_ids, ip, username, password),
        daemon=True,
    ).start()


def _adopt_external_id(db, row, external_id: str):
    """Takror so'rovdagi tashqi ID'ni mavjud kameraga biriktiradi.

    Kamera ilgari external_id'siz qo'shilgan bo'lsa (qo'lda yoki NVR
    importi bilan), takrordan keyin chaqiruvchi `ext:<id>` bilan murojaat
    qila olsin. Kameraning o'z ID'si bor yoki so'ralgani boshqasiga band
    bo'lsa — tegilmaydi (bitta external_id — bitta kamera).
    """
    if not external_id or (row["external_id"] or ""):
        return row
    if cameras.external_id_taken(db, external_id, exclude_id=row["id"]):
        return row
    cameras.set_external_id(db, row["id"], external_id)
    return cameras.get(db, row["id"])


# `CameraIn.rtsp_path` ning standart qiymati. Tanada yo'l bo'lmasa
# Pydantic shuni qo'yadi, ba'zi mijozlar esa aynan shu satrni ataylab
# yuboradi — ikkisi ham "kanal tanlanmagan" degani.
DEFAULT_RTSP_PATH = "/stream1"


def _path_given(cam) -> bool:
    """So'rovda aynan qaysi kanal kerakligi ko'rsatilganmi.

    Ko'rsatilmagan hisoblanadi: `rtsp_path` tanada yo'q (Pydantic
    standart qiymatni qo'yadi), bo'sh, yoki aynan standart `/stream1` —
    bu satr mijoz kodidagi standart qiymatdan kelgan bo'lishi mumkin va
    hech qanday kanalni ko'rsatmaydi (`channel_marked` unda kanal
    topmaydi).

    Ko'rsatilgan bo'lsa (`/Streaming/Channels/201`,
    `/cam/realmonitor?channel=2&subtype=0`) chaqiruvchi registratorning
    aynan bir kanalini so'rayapti — bunday so'rov boshqa kanal bilan
    qorishtirilmaydi.
    """
    if "rtsp_path" not in cam.model_fields_set:
        return False
    yol = cam.rtsp_path.strip()
    return bool(yol) and yol != DEFAULT_RTSP_PATH


def _rtsp_twin(db, cam, any_path: bool = False):
    """Shu kamera allaqachon qo'shilganmi — o'sha yozuv yoki None.

    Uch bosqich, qat'iydan yumshoqqa:

    1. Aynan bir xil IP+port+yo'l — bazadagi `idx_cameras_rtsp` shu
       kalitda turadi.
    2. Bir xil IP+port va bir xil KANAL: `/stream1` bilan qo'shilgan
       so'rov o'sha kameraning haqiqiy yo'liga
       (`/cam/realmonitor?channel=1&subtype=0`) mos kelmaydi, holbuki
       kamera bitta. Kanal ikkala yo'lda ham ataylab ko'rsatilgan
       bo'lishi shart (`channel_marked`), aks holda `/stream1` va
       `/stream2` bitta kamera deb qolardi.
    3. `any_path` — kanal umuman ko'rsatilmagan so'rov (`_path_given`
       yolg'on): tashqi tizim faqat IP yuboradi, yo'lni Nigoh o'zi topib
       qo'ygan bo'ladi. U holda shu IP+port'dagi birinchi kamera "o'sha
       kamera" hisoblanadi.

    Shu yumshatishlarsiz bitta kamera ro'yxatda ikkita bo'lib ko'rinardi
    — ikkinchisi `/stream1` bilan, oqim bermaydigan nusxa.
    """
    if cam.source_type != "rtsp":
        return None
    ip, port = cam.ip.strip(), cam.port
    exact = cameras.find_by_address(db, ip, port, cam.rtsp_path.strip())
    if exact:
        return exact[0]

    rows = cameras.find_by_address(db, ip, port)
    if not rows:
        return None
    if any_path:
        return rows[0]
    kanal = channel_marked(cam.rtsp_path)
    if kanal is None:
        return None
    for row in rows:
        if channel_marked(row["rtsp_path"]) == kanal:
            return row
    return None


def _existing_reply(row, cam, request, response):
    """Takror so'rovga javob: yangi qo'shilgandagidek, lekin nusxasiz.

    Tana yangi yaratilgandagidan farq qilmaydi — chaqiruvchi ajratmoqchi
    bo'lsa, sarlavhada belgisi bor.
    """
    response.headers["X-Nigoh-Existing"] = "1"
    log("app", "camera_duplicate_ignored", id=row["id"],
        ip=cam.ip.strip(), port=cam.port,
        rtsp_path=cam.rtsp_path.strip(),
        external_id=cam.external_id or "")
    return admin_camera(row, request)


def _camera_data(db, cam: CameraIn, *, sub_path: str, sub_codec: str, codec: str,
                 transcode: bool, resolution: str, fps: float) -> dict:
    """Formadan kelgan kamera -> database.cameras.create/update uchun maydonlar.

    Joylashuv normallashtiriladi:
      * 0,0 koordinata — "yo'q" (NULL), haqiqiy nuqta emas;
      * hudud — nom ro'yxatda bo'lsa o'sha, aks holda koordinatadan; erkin
        matn saqlanmaydi;
      * km/piket — aniq berilmasa nomdan ("3428/1 km"), stansiya km
        oralig'idan avtomatik topiladi;
      * nom km yozuviga o'xshab, lekin o'qilmasa ("3606/8/10 km") — 422:
        aks holda kamera jimgina km'siz saqlanib, liniyada ko'rinmay qolardi;
      * koordinata yo'q bo'lsa hudud — o'sha yo'nalishdagi qo'shni km
        kameralaridan (ular bir hududda bo'lsa).
    """
    lat, lng = cam.lat, cam.lng
    if lat is None or lng is None or (lat == 0 and lng == 0):
        lat = lng = None
    km, picket, line_id = cam.km, cam.picket, cam.rail_line_id
    if km is None:
        parsed = rail.parse_km_picket(cam.name)
        if parsed:
            km, picket = parsed
        elif rail.looks_like_km(cam.name):
            raise HTTPException(
                422, f"Nomdagi km/piket o'qilmadi: '{cam.name.strip()}'. To'g'ri ko'rinish — "
                     "'3428/1 km' (km/piket, piket 1–10) yoki km va piketni alohida yuboring.")
    if km is not None and line_id is None:
        line_id = rail.default_line_id(db)
    if line_id is None:
        km = picket = None
    area_id = areas.resolve(db, cam.region, lat, lng)
    if area_id is None and lat is None:
        area_id = rail.area_for_km(db, line_id, km)
    rtsp = cam.source_type == "rtsp"
    return {
        "name": cam.name.strip(),
        "admin_area_id": area_id,
        "lat": lat, "lng": lng,
        "rail_line_id": line_id, "km": km, "picket": picket,
        "rail_unit_id": rail.unit_for_km(db, line_id, km),
        "source_type": cam.source_type,
        "stream_url": "" if rtsp else cam.stream_url.strip(),
        "host": cam.ip.strip(), "port": cam.port, "vendor": cam.vendor,
        "username": cam.username.strip(),
        "rtsp_path": cam.rtsp_path.strip() if rtsp else "",
        "sub_path": sub_path if rtsp else "",
        "media_node_id": cam.node_id,
        "enabled": cam.enabled, "always_on": cam.always_on,
        "note": cam.note.strip(), "external_id": cam.external_id,
        "codec": codec, "sub_codec": sub_codec, "resolution": resolution,
        "fps": fps, "transcode": transcode,
    }


@router.get("/cameras")
def admin_list(request: Request, q: str = "", limit: int = 100, offset: int = 0):
    """Boshqaruv ro'yxati — qidiruv va sahifalash bilan.

    Kamera ko'p bo'lganda hammasini birdan yuborish ham tarmoqni, ham
    brauzerni bo'g'adi, shuning uchun bo'lib beriladi.
    """
    limit = max(1, min(limit, 500))
    with get_db() as db:
        total, rows = cameras.search(db, q.strip(), limit, max(0, offset))
    return {
        "total": total,
        "offset": offset,
        "cameras": [admin_camera(r, request) for r in rows],
    }


@router.post("/cameras", status_code=201)
def admin_create(cam: CameraIn, request: Request, response: Response):
    cam.validate_complete()
    # Takror qo'shish — xato emas: bitta IP+port+yo'l bitta kameraga
    # tegishli, shuning uchun ikkinchi so'rov ham yangi qo'shilgandek
    # javob oladi (201 + o'sha kameraning o'zi), lekin nusxa
    # yaratilmaydi. Tashqi tizimning dev va prod muhitlari bitta
    # Nigoh'ga ulanganda ikkinchisi 409 ga urilib ishlamay qolmasin;
    # skan sahifasida "Qo'shish" ikki bosilishi ham shunday o'tadi.
    # Ataylab ikkinchi nusxa kerak bo'lsa — RTSP yo'lni o'zgartiring.
    #
    # Kanal ko'rsatilmagan so'rovda IP+port yetadi (`_path_given`,
    # `_rtsp_twin`): tashqi tizim faqat IP yuboradi, yo'lni esa Nigoh
    # o'zi topgan bo'ladi — aks holda o'sha kameraning `/stream1` li,
    # oqim bermaydigan ikkinchi nusxasi qo'shilardi.
    aniq_yol = _path_given(cam)
    if not cam.rtsp_path.strip():          # bo'sh yuborilgan — standartga
        cam.rtsp_path = DEFAULT_RTSP_PATH
    if cam.source_type == "rtsp":
        with get_db() as db:
            dup = _rtsp_twin(db, cam, any_path=not aniq_yol)
            if dup is not None:
                dup = _adopt_external_id(db, dup, cam.external_id)
        if dup is not None:
            return _existing_reply(dup, cam, request, response)
    codec, transcode, resolution, fps = detect_codec(cam, cam.password or "")
    sub_path, sub_codec = detect_sub_path(cam, cam.password or "")
    with get_db() as db:
        data = _camera_data(db, cam, sub_path=sub_path, sub_codec=sub_codec,
                            codec=codec, transcode=transcode,
                            resolution=resolution, fps=fps)
        # Slug bir marta, nomdan beriladi va keyin o'zgarmaydi.
        data["slug"] = unique_slug(db, cam.name)
        try:
            # Savepoint: PostgreSQL xatodan keyin butun tranzaksiyani
            # to'xtatadi — quyidagi `_rtsp_twin` so'rovi ishlay olsin.
            with db.savepoint():
                camera_id = cameras.create(
                    db, data,
                    password_enc=security.encrypt(cam.password) if cam.password else None)
        except IntegrityError:
            # POYGA. Yuqoridagi tekshiruvdan keyin RTSP probe'lari bir
            # necha soniya ketdi va shu oraliqda o'sha kamera boshqa
            # so'rovda qo'shilgan bo'lishi mumkin — tashqi tizim javobni
            # kutmay takror yuborsa, dev va prod muhitlari bir vaqtda
            # ulansa, tugma ikki bosilsa. Tekshiruvning o'zi buni ushlay
            # olmaydi, shuning uchun oxirgi so'z bazada: (device_id,
            # rtsp_path) cheklovi nusxani yozdirmaydi. Javob esa tekshiruv
            # ushlagandagidek — chaqiruvchi uchun farqi yo'q.
            dup = _rtsp_twin(db, cam, any_path=not aniq_yol)
            if dup is None:            # RTSP takrori emas — external_id band
                raise HTTPException(409, f"external_id band: {cam.external_id}")
            dup = _adopt_external_id(db, dup, cam.external_id)
            return _existing_reply(dup, cam, request, response)
        row = cameras.get(db, camera_id)
    # Javob "Tekshirilmagan" bo'lib ketmasin: holat hozir aniqlanadi,
    # model/firmware fonda to'ladi.
    _enrich_new_camera([row["id"]], row["ip"] or "", row["port"] or 554,
                       row["username"] or "", cam.password or "")
    return admin_camera(row, request)


@router.put("/cameras/{ref}")
def admin_update(ref: str, cam: CameraIn, request: Request):
    cam.validate_complete()
    with get_db() as db:
        old = resolve_ref(db, ref)
        if old is None:
            raise HTTPException(404, "Kamera topilmadi")
        camera_id = old["id"]

        # Parol bo'sh qoldirilsa — qurilmadagisi saqlanadi.
        keep_password = not cam.password
        password_enc = security.encrypt(cam.password) if cam.password else None
        password = cam.password or security.decrypt(old["password_enc"])

        # Kodekni qayta aniqlaymiz — kamera sozlamasi o'zgargan bo'lishi mumkin.
        codec, transcode, resolution, fps = detect_codec(cam, password)
        responded = bool(codec)
        if not responded:                   # kamera javob bermadi — eskisi qoladi
            codec, transcode = old["codec"] or "", bool(old["transcode"])
            resolution = old["resolution"] or ""
            fps = float(old["fps"] or 0.0)

        sub_path, sub_codec = detect_sub_path(cam, password)
        if not sub_path and not responded:  # kamera javob bermadi — eskisi qoladi
            sub_path = old["sub_path"] or ""
            sub_codec = old["sub_codec"] or ""

        data = _camera_data(db, cam, sub_path=sub_path, sub_codec=sub_codec,
                            codec=codec, transcode=transcode,
                            resolution=resolution, fps=fps)
        try:
            # sub_bad va rtsp_udp tushiriladi — tahrir kamera qaytadan
            # baholansin degani (database/cameras.update).
            with db.savepoint():
                cameras.update(db, camera_id, data, password_enc=password_enc,
                               keep_password=keep_password)
        except IntegrityError:
            # Ikki cheklov bor — sababini aytib beramiz. external_id
            # avval tekshiriladi: `_rtsp_twin` kanal bo'yicha ham
            # izlaydi, ya'ni bandligi external_id'dan bo'lsa ham shu
            # IP'dagi qo'shnini topib, xato sababini almashtirib
            # qo'yishi mumkin edi.
            if cameras.external_id_taken(db, cam.external_id, exclude_id=camera_id):
                raise HTTPException(409, f"external_id band: {cam.external_id}")
            twin = _rtsp_twin(db, cam)
            if twin is not None and twin["id"] != camera_id:
                raise HTTPException(
                    409, f"Bu manzil boshqa kameraga tegishli: "
                         f"«{twin['name']}» (o'sha IP, port va RTSP yo'l)")
            raise HTTPException(409, f"external_id band: {cam.external_id}")
        row = cameras.get(db, camera_id)
    # Manzil/parol o'zgargan bo'lishi mumkin — holat va pasport yangilanadi.
    _enrich_new_camera([camera_id], row["ip"] or "", row["port"] or 554,
                       row["username"] or "", password)
    return admin_camera(row, request)


@router.post("/cameras/detect-sub")
def admin_detect_sub():
    """Sub yo'li yo'q kameralarga past sifatli 2-oqimni topib beradi.

    Mavjud bazani bir bosishda to'ldirish uchun: har bir kamera uchun
    ishlab chiqaruvchi shablonidan sub yo'l hosil qilinadi va parallel
    tekshiriladi — faqat javob berganlari saqlanadi.
    """
    with get_db() as db:
        rows = [r for r in cameras.list_rtsp(db, enabled_only=True) if not r["sub_path"]]

    def job(row) -> tuple[int, str, str]:
        main = (row["rtsp_path"] or "").strip()
        candidate = channel_path(row["vendor"] or "boshqa",
                                 channel_from_path(main), "sub")
        if candidate == main:
            return row["id"], "", ""
        result = probe(row["ip"], row["port"] or 554, candidate,
                       row["username"] or "",
                       security.decrypt(row["password_enc"]))
        if not result.get("ok"):
            return row["id"], "", ""
        return row["id"], candidate, result.get("codec", "")

    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(job, rows))

    found = [(sub, codec, cam_id) for cam_id, sub, codec in results if sub]
    if found:
        with get_db() as db:
            cameras.set_sub_streams(db, found)
    return {"checked": len(rows), "found": len(found)}


@router.delete("/cameras/{ref}", status_code=204)
def admin_delete(ref: str):
    with get_db() as db:
        row = resolve_ref(db, ref)
        if row is None:
            raise HTTPException(404, "Kamera topilmadi")
        cameras.delete(db, row["id"])


@router.post("/cameras/{ref}/enabled")
def admin_set_enabled(ref: str, body: EnabledIn, request: Request):
    """Kamerani yoqish/o'chirib qo'yish — to'liq tahrirsiz, bir bosishda.
    O'chirilgan kameraga oqim ham, surat ham berilmaydi; reconciler
    MediaMTX yo'lini o'zi olib tashlaydi."""
    with get_db() as db:
        row = resolve_ref(db, ref)
        if row is None:
            raise HTTPException(404, "Kamera topilmadi")
        cameras.set_enabled(db, row["id"], body.enabled)
        row = cameras.get(db, row["id"])
    return admin_camera(row, request)


@router.get("/cameras/{ref}/uptime")
def admin_uptime(ref: str, hours: int = 168):
    """Kameraning ish vaqti tarixi: qachon uzilgan/qaytgan, jami qancha
    o'chiq turgan, uptime foizi. Manba — events jadvalidagi online/offline
    o'tishlari (saqlash muddati 30 kun, shundan uzuni so'ralmaydi)."""
    hours = max(1, min(hours, 24 * 30))
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=hours)
    with get_db() as db:
        row = resolve_ref(db, ref)
        if row is None:
            raise HTTPException(404, "Kamera topilmadi")
        transitions = events.transitions(db, row["id"], since)

    def parse(ts: datetime) -> datetime:
        return ts.astimezone(timezone.utc)

    # Davr boshidagi holat: birinchi o'tishning teskarisi; o'tish umuman
    # bo'lmasa — hozirgi holat butun davrga taalluqli.
    if transitions:
        state_at_start = ("offline" if transitions[0]["kind"] == "online"
                          else "online")
    else:
        alive = health.online(row["ip"], row["port"])
        state_at_start = "offline" if alive is False else "online"

    segments = []                      # [{state, from, to, seconds}]
    cursor, state = since, state_at_start
    for tr in transitions:
        t = parse(tr["ts"])
        if t > cursor:
            segments.append({"state": state, "from": cursor.isoformat(),
                             "to": t.isoformat(),
                             "seconds": int((t - cursor).total_seconds())})
        cursor, state = t, tr["kind"]
    segments.append({"state": state, "from": cursor.isoformat(),
                     "to": now.isoformat(),
                     "seconds": int((now - cursor).total_seconds())})

    offline_s = sum(s["seconds"] for s in segments if s["state"] == "offline")
    total_s = max(1, int((now - since).total_seconds()))
    outages = sum(1 for tr in transitions if tr["kind"] == "offline")
    last_offline = next((tr["ts"] for tr in reversed(transitions)
                         if tr["kind"] == "offline"), None)
    return {
        "hours": hours,
        "uptime_pct": round(100 * (total_s - offline_s) / total_s, 2),
        "offline_seconds": offline_s,
        "outages": outages,
        "last_offline_at": last_offline,
        "segments": segments,
        "transitions": [{"ts": tr["ts"], "kind": tr["kind"]}
                        for tr in transitions],
    }


def parse_channels(spec: str, limit: int = 512) -> list[int]:
    """"1-16" yoki "1,3,5-8" ni raqamlar ro'yxatiga aylantiradi."""
    numbers: list[int] = []
    for chunk in spec.replace(" ", "").split(","):
        if not chunk:
            continue
        if "-" in chunk:
            try:
                start, end = (int(v) for v in chunk.split("-", 1))
            except ValueError:
                raise HTTPException(400, f"Kanal oralig'i noto'g'ri: {chunk}")
            if start > end:
                start, end = end, start
            numbers.extend(range(start, end + 1))
        else:
            try:
                numbers.append(int(chunk))
            except ValueError:
                raise HTTPException(400, f"Kanal raqami noto'g'ri: {chunk}")

    unique = sorted({n for n in numbers if n > 0})
    if not unique:
        raise HTTPException(400, "Kanallar ko'rsatilmagan")
    if len(unique) > limit:
        raise HTTPException(400, f"Bir marta ko'pi bilan {limit} ta kanal")
    return unique


def spread_point(lat: float, lng: float, index: int, spread_m: int) -> tuple[float, float]:
    """Nuqtalarni spiral bo'ylab tarqatadi — markerlar ustma-ust tushmasin."""
    if spread_m <= 0 or index == 0:
        return lat, lng
    step = math.sqrt(index) * spread_m
    angle = index * 2.399963            # oltin burchak — bir tekis tarqaladi
    d_lat = (step * math.cos(angle)) / 111_320
    d_lng = (step * math.sin(angle)) / (111_320 * max(0.2, math.cos(math.radians(lat))))
    return round(lat + d_lat, 6), round(lng + d_lng, 6)


@router.post("/nvr/import")
def admin_nvr_import(body: NvrIn):
    """Registratordagi kanallarni birdaniga kameralarga aylantiradi."""
    channels = parse_channels(body.channels)
    prefix = body.name_prefix.strip() or body.region.strip()

    # Parol berilmasa saqlangan kameranikini olamiz (ProbeIn/ScanIn bilan
    # bir xil). Aks holda tekshiruv 401 bilan yiqilib, hamma kanal
    # "javob bermadi" bo'lib chiqardi.
    password = body.password
    if not password and body.camera_id:
        with get_db() as db:
            row = cameras.get(db, body.camera_id)
        if row:
            password = security.decrypt(row["password_enc"])

    planned = []
    for index, channel in enumerate(channels):
        lat, lng = spread_point(body.lat, body.lng, index, body.spread_m)
        planned.append({
            "channel": channel,
            "name": f"{prefix} {channel}-kanal",
            "rtsp_path": channel_path(body.vendor, channel, body.stream),
            # Video devor uchun past sifatli 2-oqim — faqat tekshiruvdan
            # o'tsa saqlanadi (ba'zi NVR kanallarida sub yo'q bo'ladi).
            "sub_path": (channel_path(body.vendor, channel, "sub")
                         if body.stream == "main" else ""),
            "lat": lat, "lng": lng,
        })

    # Tekshirish parallel ketadi — 64 ta kanalni ketma-ket tekshirish
    # bir necha daqiqa oladi, parallel esa bir necha soniya. Asosiy va
    # sub oqimlar bitta hovuzda birga tekshiriladi.
    results: dict[tuple[int, str], dict] = {}
    if body.probe:
        # Birinchi kanalni YOLG'IZ tekshiramiz. Parol xato bo'lsa qolgan
        # 63 kanalga umuman tegilmaydi: Hikvision registratorlari 5 ta
        # xato urinishdan keyin IP'ni bloklaydi va o'shanda butun
        # qurilma bir yarim soatga yo'qoladi.
        lead = probe(body.ip, body.port, planned[0]["rtsp_path"],
                     body.username, password)
        if lead.get("stage") == "parol":
            raise HTTPException(
                401, f"{lead['message']} — qolgan kanallar tekshirilmadi "
                     f"(registrator xato urinishlardan keyin IP'ni bloklaydi)")
        results[(planned[0]["channel"], "main")] = lead

        jobs = [(item["channel"], "main", item["rtsp_path"])
                for item in planned[1:]]
        jobs += [(item["channel"], "sub", item["sub_path"])
                 for item in planned if item["sub_path"]]
        with ThreadPoolExecutor(max_workers=16) as pool:
            futures = {
                pool.submit(probe, body.ip, body.port, path,
                            body.username, password): (channel, kind)
                for channel, kind, path in jobs
            }
            for future in as_completed(futures):
                results[futures[future]] = future.result()

    for item in planned:
        result = results.get((item["channel"], "main"))
        item["ok"] = result["ok"] if result else None
        item["codec"] = result.get("codec", "") if result else ""
        item["resolution"] = result.get("resolution", "") if result else ""
        item["transcode"] = bool(result.get("needs_transcode")) if result else False
        item["message"] = result["message"] if result else "tekshirilmadi"
        # Sub oqim kodegi alohida saqlanadi: devor plitkasi sub'ni
        # ko'rsatib turib "H265" yorlig'ini chizmasin (asosiy oqim H.265,
        # sub esa deyarli doim H.264 bo'ladi).
        item["sub_codec"] = ""
        if body.probe:
            sub = results.get((item["channel"], "sub"))
            if sub and sub.get("ok"):
                item["sub_codec"] = sub.get("codec", "")
            else:
                item["sub_path"] = ""

    if body.dry_run:
        return {"planned": planned, "created": 0,
                "reachable": sum(1 for p in planned if p["ok"])}

    # Javob bermagan kanallar saqlanmaydi — NVR'da bo'sh slotlar ko'p bo'ladi.
    keep = [p for p in planned if p["ok"] or not body.probe]
    password_enc = security.encrypt(password) if password else None
    created = 0
    created_ids: list[int] = []
    with get_db() as db:
        line_id = None
        for item in keep:
            # Takror kanal (o'sha IP+port+yo'l) qayta saqlanmaydi.
            if cameras.find_by_address(db, body.ip.strip(), body.port, item["rtsp_path"]):
                item["message"] = "allaqachon qo'shilgan — o'tkazib yuborildi"
                continue
            lat, lng = item["lat"], item["lng"]
            if lat == 0 and lng == 0:
                lat = lng = None
            km_picket = rail.parse_km_picket(item["name"])
            if km_picket and line_id is None:
                line_id = rail.default_line_id(db)
            data = {
                "name": item["name"], "slug": unique_slug(db, item["name"]),
                "admin_area_id": areas.resolve(db, body.region, lat, lng),
                "lat": lat, "lng": lng,
                "rail_line_id": line_id if km_picket else None,
                "km": km_picket[0] if km_picket and line_id else None,
                "picket": km_picket[1] if km_picket and line_id else None,
                "source_type": "rtsp", "host": body.ip.strip(), "port": body.port,
                "vendor": body.vendor, "username": body.username.strip(),
                "rtsp_path": item["rtsp_path"], "sub_path": item["sub_path"],
                "media_node_id": body.node_id, "enabled": body.enabled,
                "always_on": False,
                "note": f"{body.ip} · {item['channel']}-kanal",
                "codec": item["codec"], "sub_codec": item["sub_codec"],
                "resolution": item["resolution"], "transcode": item["transcode"],
            }
            try:
                with db.savepoint():
                    camera_id = cameras.create(db, data, password_enc=password_enc)
            except IntegrityError:
                # Kanal shu orada boshqa so'rovda qo'shilgan — cheklov
                # bazada (device_id, rtsp_path). Bitta kanal butun importni
                # yiqitmaydi: qolganlari saqlanaveradi.
                item["message"] = "allaqachon qo'shilgan — o'tkazib yuborildi"
                continue
            created_ids.append(camera_id)
            created += 1

    # NVR manzili bitta — holat bir tekshiruvda, pasport fonda to'ladi.
    if created_ids:
        _enrich_new_camera(created_ids, body.ip.strip(), body.port,
                           body.username.strip(), password)

    return {"planned": planned, "created": created,
            "skipped": len(planned) - created,
            "reachable": sum(1 for p in planned if p["ok"])}


def _probe_many(ip: str, port: int, jobs: dict, username: str,
                password: str) -> dict:
    """Bir nechta RTSP yo'lni parallel tekshiradi: {kalit: probe natijasi}."""
    results: dict = {}
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = {
            pool.submit(probe, ip, port, path, username, password): key
            for key, path in jobs.items()
        }
        for future in as_completed(futures):
            results[futures[future]] = future.result()
    return results


@router.post("/scan")
def admin_scan(body: ScanIn):
    """Qurilmani o'zi aniqlaydi: turi (kamera/NVR), shabloni va jonli kanallari.

    Oddiy foydalanuvchi RTSP yo'lini ham, kanal raqamlarini ham bilmaydi —
    IP va login/parol yetarli. Skaner mashhur shablonlarni sinab, qaysi
    biri ishlashini topadi, so'ng kanallarni 8 talik bloklarda tekshiradi
    va bo'sh blok kelganda to'xtaydi.
    """
    ip, port = body.ip.strip(), body.port
    user, pw = body.username.strip(), body.password
    if not pw and body.camera_id:
        with get_db() as db:
            row = cameras.get(db, body.camera_id)
        if row:
            pw = security.decrypt(row["password_enc"])

    # 1) Shablonni aniqlash — har bir ishlab chiqaruvchining 1-kanali.
    candidates = {v: channel_path(v, 1, "main") for v in CHANNEL_VENDORS}
    candidates["boshqa"] = "/stream1"          # bitta oqimli oddiy kameralar
    first = _probe_many(ip, port, candidates, user, pw)

    # Hech biri ochilmadi-yu, parol xatosi bor — avval shuni aytamiz.
    if not any(r["ok"] for r in first.values()):
        for stage in ("parol", "oqim", "rtsp", "tarmoq"):
            hit = next((r for r in first.values() if r.get("stage") == stage), None)
            if hit:
                return {"found": False, "message": hit["message"]}
        return {"found": False, "message": "Qurilma javob bermadi"}

    vendor = next(v for v in [*CHANNEL_VENDORS, "boshqa"]
                  if first.get(v, {}).get("ok"))
    vendor_name = next((v["name"] for v in VENDORS if v["id"] == vendor), vendor)

    def entry(channel: int, result: dict) -> dict:
        return {
            "channel": channel,
            "rtsp_path": channel_path(vendor, channel, "main"),
            "codec": result.get("codec", ""),
            "needs_transcode": bool(result.get("needs_transcode")),
        }

    channels = [entry(1, first[vendor])]

    # 2) Kanallarni sanash — faqat kanal raqamini biladigan shablonlarda.
    if vendor != "boshqa":
        start = 2
        while start <= body.max_channels:
            block = range(start, min(start + 8, body.max_channels + 1))
            jobs = {c: channel_path(vendor, c, "main") for c in block}
            results = _probe_many(ip, port, jobs, user, pw)
            live = [c for c in sorted(results) if results[c]["ok"]]
            channels.extend(entry(c, results[c]) for c in live)
            if not live:                       # bo'sh blok — qurilma tugadi
                break
            start += 8

    return {
        "found": True,
        "vendor": vendor,
        "vendor_name": vendor_name,
        "device": "nvr" if len(channels) > 1 else "camera",
        "channels": channels,
    }


@router.post("/probe")
def admin_probe(body: ProbeIn):
    """Kamera bilan aloqani va login/parolni tekshiradi."""
    password = body.password or ""
    if not password and body.camera_id:
        with get_db() as db:
            row = cameras.get(db, body.camera_id)
        if row:
            password = security.decrypt(row["password_enc"])
    return probe(body.ip.strip(), body.port, body.rtsp_path.strip(),
                 body.username.strip(), password)


@router.post("/cameras/{ref}/keyframe")
def admin_keyframe(ref: str, stream: str = "main"):
    """Kameradan darhol keyframe so'raydi (ONVIF/ISAPI) — diagnostika amali.

    `sent: true` — kamera qabul qildi; `false` — qo'llamaydi yoki 2 soniya
    ichida takror so'rov (bosim himoyasi).
    """
    with get_db() as db:
        row = resolve_ref(db, ref)
    if row is None:
        raise HTTPException(404, "Kamera topilmadi")
    if not row["ip"]:
        raise HTTPException(400, "Bu kamera tayyor oqim — keyframe so'ralmaydi")
    sent = fast_start.request_keyframe(
        row["ip"], row["username"] or "",
        security.decrypt(row["password_enc"]),
        row["rtsp_path"] or "", row["vendor"] or "",
        stream="sub" if stream == "sub" else "main")
    return {"sent": bool(sent)}
