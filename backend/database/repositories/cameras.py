"""Kameralar repozitoriysi: o'qish (camera_details ko'rinishi) va yozish (cameras,
devices, camera_status jadvallari).

O'qish har doim `camera_details` dan — u kamera, qurilma, jonli holat va
hududni bitta tekis qatorga yig'adi, ustun nomlari API javobi bilan bir
xil (ip, port, node_id, region ...). Yozish faqat shu moduldagi
funksiyalar orqali: kamera qaysi qurilmaga tegishli, NVR'mi, holat qatori
bormi — bular chaqiruvchining tashvishi emas. Bitta NVR'ning kanallari —
bitta qurilma (devices), shuning uchun bir kanal orqali almashtirilgan
parol hamma kanallarga ta'sir qiladi; kamerasi qolmagan qurilma o'chadi.

"Yo'q" — faqat NULL: bo'sh satr va 0 fps bazaga yozilmaydi (`_none_if_empty`).
Slug yaratilganda bir marta beriladi va O'ZGARMAYDI — u MediaMTX yo'li va
surat faylining nomi.

Tarkibi:
    CameraRepository            kameralar, qurilmalar, jonli holat (holatsiz, `db` oladi)
      o'qish:
        .get(db, id)            bitta kamera (camera_details)
        .get_by_slug(db, slug)  slug bo'yicha
        .get_by_external_id(db, ext)  tashqi tizim id'si bo'yicha
        .external_id_taken(db, ext, exclude_id)  external_id band-mi
        .find_by_address(db, host, port, rtsp_path)  shu qurilmadagi kameralar
        .list_rtsp(db, enabled_only)  qurilmasi bor (RTSP) kameralar — MediaMTX, health, suratlar
        .list_by_ids(db, ids)   id ro'yxati bo'yicha
        .list_all(db)           hammasi, id tartibida
        .all_slugs(db)          barcha sluglar to'plami
        .list_visible(db, bbox=, area_ids=, limit=)  xarita: yoqilganlar, (total, qatorlar)
        .search(db, query, limit, offset)  boshqaruv ro'yxati: nom/hudud/IP/slug/izoh (ILIKE)
      yozish:
        .unique_slug(db, base, exclude_id)  takrorlanmaydigan slug: nom, nom_2, nom_3 ...
        .create(db, data, password_enc=)  yangi kamera (+ qurilma, + holat qatori) -> id
        .update(db, id, data, password_enc=, keep_password=)  sozlama (slug o'zgarmaydi);
                                sub_bad va rtsp_udp tushiriladi
        .delete(db, id)         butunlay o'chirish; qurilmasi bo'shasa u ham
      yumshoq o'chirish (savat, 0006_v3.py — camera_details o'chirilganlarni ko'rsatmaydi):
        .soft_delete(db, id)    deleted_at = now() -> vaqt yoki None
        .get_deleted(db, id)    savatdagi kamera
        .list_deleted(db)       savatdagilar
        .restore(db, id, keep_days)  qaytarish (muddat ichida)
        .purge_deleted(db, keep_days)  muddati o'tganlarni butunlay o'chiradi -> soni
                                create/update shu manzil yoki external_id'li savatdagi
                                kamerani o'zi butunlay o'chiradi (cheklovni band qilmasin)
        .set_enabled(db, id, enabled)
        .set_external_id(db, id, ext)
        .fix_record(db, id, ...)  ma'lumot tuzatish: faqat berilgan maydonlar, note'ga izoh
      qurilma va pasport:
        .set_passport(db, ids, model, firmware)  model/firmware qurilmaga
        .set_vendor(db, id, vendor)  ishlab chiqaruvchi qurilmaga
        .passport_candidates(db, retry_after_s, limit)  kodeki/modeli noma'lum kameralar
        .set_resolutions(db, {slug: "WxH"})  oqimdan o'lchangan o'lcham (MediaMTX)
        .set_probe_result(db, id, codec=, resolution=, fps=, error=)  faqat BO'SH
                                maydonga yozadi, probe_at/probe_error ni yangilaydi
      jonli holat:
        .mark_seen(db, [(host, port)], at)  javob bergan qurilmalarning last_seen'i
        .set_snapshot_at(db, id, at)
        .set_rtsp_udp(db, id, udp)
        .set_sub_bad_by_id(db, id)  pleyer sub oqimni ochmadi (/sub-bad)
        .set_sub_streams(db, [(sub_path, sub_codec, id)])  topilgan ikkinchi oqimlar
      sub oqim (reconciler) — o'zi get_db() ochadi, staticmethod:
        .set_sub_bad(slugs, bad)  bayroqni qo'yadi/oladi -> o'zgargan sluglar
        .cameras_by_slug(slugs)  sub yo'li bor kameralar (tekshiruv uchun)
        .cameras_without_sub()  sub yo'li yozilmagan yoqilgan kameralar
        .set_sub_path(slug, path)  topilgan sub yo'li — faqat bo'sh bo'lsa
        .sub_bad_cameras()      sub_bad belgilangan, qayta tekshiriladigan kameralar
    slugify(text)               MediaMTX uchun xavfsiz kalit (a-z, 0-9, _; kirill/o'zbek translit)
    vendor_for_model(model)     model nomi boshidan ishlab chiqaruvchi (MODEL_VENDORS)
    MODEL_VENDORS               ("DH-", "dahua") ... — import RTSP yo'lidan taxmin qilgani
                                uchun Holowits kamerasi `dahua` bo'lib qolgan edi
    DETAILS                     o'qish uchun view nomi (camera_details)
    DEFAULT_ORGANIZATION_ID     asosiy tashkilot (1)

Jadvallar: cameras, devices, camera_status; view camera_details
Ishlatadi: database.connection (get_db — faqat sub oqim yordamchilari)
Kim ishlatadi: camera/api/admin.py (CRUD, search, pasport, sub oqim),
camera/api/cameras.py (list_visible, list_all, set_sub_bad_by_id),
camera/api/devices.py, camera/api/events.py, camera/state.py,
camera/media/ (launcher, mapping, reconciler, transport),
camera/monitoring/ (health, passport, snapshots), app/bootstrap.py,
stats/ (api, admin_api, recorder, reporting/engine), walls/ (api, registry),
repositories/reports.py (vendor_for_model), database/scripts/fix_camera_data.py,
scripts/import_mediamtx.py (unique_slug), tests/.
"""
from __future__ import annotations

import re
from datetime import datetime

from database.connection import get_db

DEFAULT_ORGANIZATION_ID = 1
DETAILS = "camera_details"

# Kamera yozuvidagi ustunlar (cameras jadvali) va jonli holat ustunlari.
_CAMERA_FIELDS = ("name", "admin_area_id", "lat", "lng", "source_type", "stream_url",
                  "rtsp_path", "sub_path", "media_node_id", "enabled", "always_on",
                  "note", "external_id", "rail_line_id", "km", "picket", "rail_unit_id")
_STATUS_FIELDS = ("codec", "sub_codec", "resolution", "fps", "transcode")


def _none_if_empty(value):
    """"Yo'q" — faqat NULL: bo'sh satr va 0 fps bazaga yozilmaydi."""
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


# ---------- slug ----------

# O'zbek lotin yozuvidagi maxsus belgilar va kirill harflari.
_TRANSLIT = {
    "ʻ": "", "ʼ": "", "'": "", "`": "", "‘": "", "’": "",
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo",
    "ж": "j", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "x", "ц": "s", "ч": "ch", "ш": "sh", "щ": "sh", "ъ": "",
    "ы": "i", "ь": "", "э": "e", "ю": "yu", "я": "ya", "ў": "o", "қ": "q",
    "ғ": "g", "ҳ": "h",
}


def slugify(text: str) -> str:
    """MediaMTX path nomi uchun xavfsiz kalit: faqat a-z, 0-9 va _."""
    s = "".join(_TRANSLIT.get(ch, ch) for ch in text.lower())
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s or "kamera"


# ---------- o'qish ----------


# ---------- qurilmalar ----------


# ---------- yozish ----------


# ---------- sub oqim bayroqlari (reconciler) ----------

def set_sub_bad(slugs: list[str], bad: bool) -> list[str]:
    """`sub_bad` bayrog'ini o'rnatadi/oladi. Qaytadi: o'zgargan sluglar.

    Faqat haqiqatan boshqa qiymatda turgan qator yangilanadi, shuning
    uchun chaqiruvchi har tsiklda chaqirsa ham takror yozuv bo'lmaydi.

    Bayroq nimani bildiradi: kameraning ikkinchi (sub) oqimi yo'q yoki
    ishlamayapti — tomoshabinga asosiy oqim berilsin. Uni reconciler
    jonli kuzatuvdan o'zi qo'yadi va o'zi oladi (camera/media/reconciler.py,
    `_check_sub_health`), pleyer ham qo'ya oladi (/sub-bad).
    """
    if not slugs:
        return []
    with get_db() as db:
        return [r[0] for r in db.execute(
            "UPDATE camera_status s SET sub_bad = %s FROM cameras c "
            "WHERE s.camera_id = c.id AND c.slug = ANY(%s) AND s.sub_bad <> %s "
            "RETURNING c.slug", (bool(bad), list(slugs), bool(bad)))]


_PROBE_COLUMNS = "id, slug, ip, port, username, password_enc, sub_path, rtsp_path, rtsp_udp"


def cameras_by_slug(slugs: list[str]) -> list[dict]:
    """Sub yo'li bor kameralarni slug bo'yicha oladi (tekshiruv uchun)."""
    if not slugs:
        return []
    with get_db() as db:
        return [dict(r) for r in db.execute(
            f"SELECT {_PROBE_COLUMNS} FROM {DETAILS} WHERE slug = ANY(%s) "
            "AND sub_path IS NOT NULL", (list(slugs),))]


def cameras_without_sub() -> list[dict]:
    """Sub yo'li yozilmagan, yoqilgan kameralar.

    Ular devorda og'ir asosiy oqimda ochiladi. Kameraning ikkinchi oqimi
    ko'pincha BOR — shunchaki qo'shishda yozilmagan; reconciler uni
    taxmin qilib, tekshirib, shu yerga yozadi (`set_sub_path`).
    """
    with get_db() as db:
        return [dict(r) for r in db.execute(
            f"SELECT {_PROBE_COLUMNS} FROM {DETAILS} WHERE enabled "
            "AND device_id IS NOT NULL AND sub_path IS NULL")]


def set_sub_path(slug: str, sub_path: str) -> bool:
    """Topilgan sub yo'lini yozadi. Faqat yo'l hali bo'sh bo'lsa.

    Shart muhim: operator shu orada qo'lda yo'l yozgan bo'lishi mumkin,
    avtomatik taxmin uni bosib ketmasin.
    """
    with get_db() as db:
        n = db.execute(
            "UPDATE cameras SET sub_path = %s WHERE slug = %s AND sub_path IS NULL",
            (_none_if_empty(sub_path), slug)).rowcount
    return bool(n)


def sub_bad_cameras() -> list[dict]:
    """`sub_bad` deb belgilangan, sub yo'li bor va yoqilgan kameralar.

    Qayta tekshirish uchun: operator registratorda ikkinchi oqimni
    yoqsa, tizim buni o'zi ko'rib bayroqni olishi kerak.
    """
    with get_db() as db:
        return [dict(r) for r in db.execute(
            f"SELECT {_PROBE_COLUMNS} FROM {DETAILS} WHERE sub_bad AND enabled "
            "AND device_id IS NOT NULL AND sub_path IS NOT NULL")]


def _escape_like(text: str) -> str:
    """LIKE/ILIKE uchun: \\, % va _ oddiy belgi bo'lib qolsin (standart ekran — \\)."""
    return re.sub(r"([\\%_])", r"\\\1", text)


# ---------- pasport (kodek, o'lcham, model) — fonda to'ldiriladi ----------

# Model nomining boshi -> ishlab chiqaruvchi. Import paytida ishlab
# chiqaruvchi RTSP yo'lidan taxmin qilingan (masalan, `/cam/realmonitor` ->
# dahua) va bir necha kamerada xato chiqqan: Holowits kamerasi `dahua` deb
# yozilgan, yo'li ham noto'g'ri bo'lgani uchun videosi hech ochilmagan.
MODEL_VENDORS = (("DH-", "dahua"), ("IPC-", "dahua"),
                 ("DS-", "hikvision"), ("IDS-", "hikvision"), ("HWT-", "holowits"),
                 ("IPC", "uniview"))


def vendor_for_model(model: str | None) -> str | None:
    """Model nomidan ishlab chiqaruvchi; tanilmasa None."""
    text = (model or "").strip().upper()
    for prefix, vendor in MODEL_VENDORS:
        if text.startswith(prefix):
            return vendor
    return None


class CameraRepository:
    """Kameralar, ularning qurilmalari (devices) va jonli holati (camera_status).

    Holatsiz: har metod birinchi argument sifatida ulanishni (`db`) oladi —
    tranzaksiya chegarasini chaqiruvchi `with get_db() as db:` bilan belgilaydi.
    """

    DEFAULT_ORGANIZATION_ID = DEFAULT_ORGANIZATION_ID
    DETAILS = DETAILS
    MODEL_VENDORS = MODEL_VENDORS
    slugify = staticmethod(slugify)
    set_sub_bad = staticmethod(set_sub_bad)
    cameras_by_slug = staticmethod(cameras_by_slug)
    cameras_without_sub = staticmethod(cameras_without_sub)
    set_sub_path = staticmethod(set_sub_path)
    sub_bad_cameras = staticmethod(sub_bad_cameras)
    vendor_for_model = staticmethod(vendor_for_model)

    def unique_slug(self, db, base: str, exclude_id: int | None = None) -> str:
        """Bazada takrorlanmaydigan slug qaytaradi: nom, nom_2, nom_3 …

        Slug kamera yaratilganda bir marta beriladi va O'ZGARMAYDI: u MediaMTX
        yo'li va surat faylining nomi. Nom tahrirlansa ham slug qoladi.
        """
        base = slugify(base)
        candidate, n = base, 1
        while True:
            sql = "SELECT id FROM cameras WHERE slug = %s"
            params: list = [candidate]
            if exclude_id is not None:
                sql += " AND id != %s"
                params.append(exclude_id)
            if db.execute(sql, params).fetchone() is None:
                return candidate
            n += 1
            candidate = f"{base}_{n}"

    def get(self, db, camera_id: int):
        return db.execute(f"SELECT * FROM {DETAILS} WHERE id = %s", (camera_id,)).fetchone()

    def get_by_slug(self, db, slug: str):
        return db.execute(f"SELECT * FROM {DETAILS} WHERE slug = %s", (slug,)).fetchone()

    def get_by_external_id(self, db, external_id: str):
        return db.execute(f"SELECT * FROM {DETAILS} WHERE external_id = %s",
                          (external_id,)).fetchone()

    def external_id_taken(self, db, external_id: str, exclude_id: int | None = None) -> bool:
        if not external_id:
            return False
        return db.execute(
            "SELECT 1 FROM cameras WHERE external_id = %s AND id IS DISTINCT FROM %s "
            "AND deleted_at IS NULL",
            (external_id, exclude_id)).fetchone() is not None

    def find_by_address(self, db, host: str, port: int, rtsp_path: str | None = None) -> list:
        """Shu qurilmadagi kameralar (yo'l berilsa — aynan shu yo'l), id tartibida."""
        sql = f"SELECT * FROM {DETAILS} WHERE ip = %s AND port = %s"
        params: list = [host, port]
        if rtsp_path is not None:
            sql += " AND rtsp_path = %s"
            params.append(rtsp_path)
        return db.execute(sql + " ORDER BY id", params).fetchall()

    def list_rtsp(self, db, enabled_only: bool = False) -> list:
        """Qurilmasi bor (RTSP) kameralar — MediaMTX, health, suratlar uchun."""
        sql = f"SELECT * FROM {DETAILS} WHERE device_id IS NOT NULL"
        if enabled_only:
            sql += " AND enabled"
        return db.execute(sql + " ORDER BY id").fetchall()

    def list_by_ids(self, db, ids: list[int]) -> list:
        return db.execute(f"SELECT * FROM {DETAILS} WHERE id = ANY(%s)", (list(ids),)).fetchall()

    def all_slugs(self, db) -> set[str]:
        return {r[0] for r in db.execute("SELECT slug FROM cameras")}

    def _ensure_device(self, db, organization_id: int, host: str, port: int, vendor: str | None,
                       username: str | None, password_enc: str | None,
                       keep_password: bool) -> int:
        """Manzil bo'yicha qurilmani topadi yoki yaratadi; login/parolni yangilaydi.

        `keep_password` — parol berilmagan: qurilmadagisi qoladi. Bitta NVR'ning
        kanallari bitta qurilma, shuning uchun bir kanal orqali parol
        almashtirilsa, hamma kanallar yangi parol bilan ishlaydi.
        """
        row = db.execute("SELECT id FROM devices WHERE organization_id = %s "
                         "AND host = %s AND rtsp_port = %s",
                         (organization_id, host, port)).fetchone()
        vendor = _none_if_empty(vendor) or "boshqa"
        if row is None:
            return db.execute(
                "INSERT INTO devices (organization_id, vendor, host, rtsp_port, "
                "username, password_enc) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                (organization_id, vendor, host, port, _none_if_empty(username),
                 _none_if_empty(password_enc))).fetchone()[0]
        sets, params = ["vendor = %s", "username = %s"], [vendor, _none_if_empty(username)]
        if not keep_password:
            sets.append("password_enc = %s")
            params.append(_none_if_empty(password_enc))
        db.execute(f"UPDATE devices SET {', '.join(sets)} WHERE id = %s", (*params, row[0]))
        return row[0]

    def _refresh_device(self, db, device_id: int | None) -> None:
        """Qurilma turi kanallar soniga qarab; kamerasi qolmagan qurilma o'chiriladi."""
        if device_id is None:
            return
        n = db.execute("SELECT COUNT(*) FROM cameras WHERE device_id = %s",
                       (device_id,)).fetchone()[0]
        if n == 0:
            db.execute("DELETE FROM devices WHERE id = %s", (device_id,))
        else:
            db.execute("UPDATE devices SET kind = %s WHERE id = %s AND kind <> %s",
                       ("nvr" if n > 1 else "camera", device_id, "nvr" if n > 1 else "camera"))

    def _purge_deleted_conflicts(self, db, org: int, device_id: int | None, rtsp_path,
                                 external_id, exclude_id: int | None = None) -> None:
        """Yangi/tahrirlangan kamera bilan bir xil manzil yoki external_id'li
        YUMSHOQ O'CHIRILGAN kamera butunlay o'chiriladi.

        Aks holda savatdagi kamera (device_id, rtsp_path) va external_id
        cheklovlarini band qilib turardi: o'chirilgan kamerani qayta qo'shib
        bo'lmasdi (409). Qayta qo'shish — eski yozuvni tiklashdan ustun.
        Qurilmasi bu yerda tozalanmaydi — uni yangi kamera ishlatadi.
        """
        conds, params = [], []
        if device_id is not None and _none_if_empty(rtsp_path):
            conds.append("(device_id = %s AND rtsp_path = %s)")
            params += [device_id, _none_if_empty(rtsp_path)]
        if _none_if_empty(external_id):
            conds.append("(organization_id = %s AND external_id = %s)")
            params += [org, _none_if_empty(external_id)]
        if not conds:
            return
        rows = db.execute(
            f"DELETE FROM cameras WHERE deleted_at IS NOT NULL AND id IS DISTINCT FROM %s "
            f"AND ({' OR '.join(conds)}) RETURNING device_id", [exclude_id, *params]).fetchall()
        for (dev,) in rows:
            if dev != device_id:
                self._refresh_device(db, dev)

    def create(self, db, data: dict, *, password_enc: str | None) -> int:
        """Yangi kamera. `data`: _CAMERA_FIELDS + slug, host, port, vendor,
        username + jonli holat (codec, sub_codec, resolution, fps, transcode).

        Takror manzil yoki band external_id — UniqueViolation (chaqiruvchi
        savepoint ichida ushlaydi). Shu manzil/ID'li o'chirilgan (savatdagi)
        kamera bo'lsa, u butunlay o'chiriladi.
        """
        org = data.get("organization_id") or DEFAULT_ORGANIZATION_ID
        device_id = None
        if data["source_type"] == "rtsp":
            device_id = self._ensure_device(db, org, data["host"], data["port"], data.get("vendor"),
                                       data.get("username"), password_enc, keep_password=False)
        self._purge_deleted_conflicts(db, org, device_id, data.get("rtsp_path"),
                                      data.get("external_id"))
        fields = {f: _none_if_empty(data.get(f)) for f in _CAMERA_FIELDS}
        fields.update(organization_id=org, device_id=device_id, slug=data["slug"])
        cols = ", ".join(fields)
        camera_id = db.execute(
            f"INSERT INTO cameras ({cols}) VALUES ({', '.join(['%s'] * len(fields))}) "
            "RETURNING id", tuple(fields.values())).fetchone()[0]
        status = {f: _none_if_empty(data.get(f)) for f in _STATUS_FIELDS}
        status["transcode"] = bool(status["transcode"])
        db.execute(
            "INSERT INTO camera_status (camera_id, codec, sub_codec, resolution, fps, transcode) "
            "VALUES (%s, %s, %s, %s, %s, %s)",
            (camera_id, status["codec"], status["sub_codec"], status["resolution"],
             status["fps"] or None, status["transcode"]))
        self._refresh_device(db, device_id)
        return camera_id

    def update(self, db, camera_id: int, data: dict, *, password_enc: str | None,
               keep_password: bool) -> None:
        """Kamera sozlamasini almashtiradi (slug o'zgarmaydi).

        Manzil o'zgarsa kamera boshqa qurilmaga o'tadi; eski qurilmada kamera
        qolmasa u o'chiriladi. Tahrir — kamera qaytadan baholansin degani:
        sub_bad va rtsp_udp bayroqlari tushiriladi (transport.py kerak bo'lsa
        UDP'ni bir daqiqada qayta yoqadi).
        """
        old_device = db.execute("SELECT device_id, organization_id FROM cameras WHERE id = %s",
                                (camera_id,)).fetchone()
        org = old_device["organization_id"]
        device_id = None
        if data["source_type"] == "rtsp":
            device_id = self._ensure_device(db, org, data["host"], data["port"], data.get("vendor"),
                                       data.get("username"), password_enc, keep_password)
        self._purge_deleted_conflicts(db, org, device_id, data.get("rtsp_path"),
                                      data.get("external_id"), exclude_id=camera_id)
        fields = {f: _none_if_empty(data.get(f)) for f in _CAMERA_FIELDS}
        fields["device_id"] = device_id
        assignments = ", ".join(f"{f} = %s" for f in fields)
        db.execute(f"UPDATE cameras SET {assignments} WHERE id = %s",
                   (*fields.values(), camera_id))
        status = {f: _none_if_empty(data.get(f)) for f in _STATUS_FIELDS}
        db.execute(
            "UPDATE camera_status SET codec = %s, sub_codec = %s, resolution = %s, "
            "fps = %s, transcode = %s, sub_bad = false, rtsp_udp = false WHERE camera_id = %s",
            (status["codec"], status["sub_codec"], status["resolution"], status["fps"] or None,
             bool(status["transcode"]), camera_id))
        if old_device["device_id"] != device_id:
            self._refresh_device(db, old_device["device_id"])
        self._refresh_device(db, device_id)

    def delete(self, db, camera_id: int) -> None:
        """Butunlay o'chirish (tarix, guruh a'zoligi bilan). API'dagi o'chirish —
        `soft_delete`; buni purge vazifasi, testlar va skriptlar chaqiradi."""
        row = db.execute("DELETE FROM cameras WHERE id = %s RETURNING device_id",
                         (camera_id,)).fetchone()
        if row:
            self._refresh_device(db, row[0])

    # ---------- yumshoq o'chirish (savat) ----------

    def soft_delete(self, db, camera_id: int) -> datetime | None:
        """Kamerani savatga o'tkazadi: `camera_details` dan (ya'ni ro'yxatlar,
        statistika, MediaMTX, health'dan) chiqadi. Qaytadi: o'chirilgan vaqt
        yoki None (topilmadi / allaqachon o'chirilgan)."""
        row = db.execute("UPDATE cameras SET deleted_at = now() WHERE id = %s "
                         "AND deleted_at IS NULL RETURNING deleted_at", (camera_id,)).fetchone()
        return row[0] if row else None

    def get_deleted(self, db, camera_id: int):
        """Savatdagi kamera: id, name, slug, deleted_at (bo'lmasa None)."""
        return db.execute("SELECT id, name, slug, deleted_at FROM cameras "
                          "WHERE id = %s AND deleted_at IS NOT NULL", (camera_id,)).fetchone()

    def list_deleted(self, db) -> list:
        """Savatdagi kameralar, yangi o'chirilgani birinchi."""
        return db.execute(
            "SELECT c.id, c.name, c.slug, c.deleted_at, COALESCE(a.name, 'Belgilanmagan') AS region "
            "FROM cameras c LEFT JOIN admin_areas a ON a.id = c.admin_area_id "
            "WHERE c.deleted_at IS NOT NULL ORDER BY c.deleted_at DESC, c.id").fetchall()

    def restore(self, db, camera_id: int, keep_days: int) -> bool:
        """Savatdan qaytaradi (o'chirilganiga `keep_days` kun bo'lmagan bo'lsa)."""
        return db.execute(
            "UPDATE cameras SET deleted_at = NULL WHERE id = %s AND deleted_at IS NOT NULL "
            "AND deleted_at > now() - make_interval(days => %s)",
            (camera_id, keep_days)).rowcount > 0

    def purge_deleted(self, db, keep_days: int) -> int:
        """`keep_days` kundan oldin o'chirilganlarni butunlay o'chiradi. Qaytadi: soni."""
        rows = db.execute(
            "DELETE FROM cameras WHERE deleted_at IS NOT NULL "
            "AND deleted_at <= now() - make_interval(days => %s) RETURNING device_id",
            (keep_days,)).fetchall()
        for dev in {r[0] for r in rows}:
            self._refresh_device(db, dev)
        return len(rows)

    def set_enabled(self, db, camera_id: int, enabled: bool) -> None:
        db.execute("UPDATE cameras SET enabled = %s WHERE id = %s", (bool(enabled), camera_id))

    def set_external_id(self, db, camera_id: int, external_id: str) -> None:
        db.execute("UPDATE cameras SET external_id = %s WHERE id = %s",
                   (_none_if_empty(external_id), camera_id))

    def set_passport(self, db, camera_ids: list[int], model: str, firmware: str) -> None:
        """Qurilma pasporti (model/firmware) — kameralarning qurilmasiga yoziladi."""
        db.execute(
            "UPDATE devices SET model = COALESCE(%s, model), firmware = COALESCE(%s, firmware) "
            "WHERE id IN (SELECT device_id FROM cameras WHERE id = ANY(%s))",
            (_none_if_empty(model), _none_if_empty(firmware), list(camera_ids)))

    def set_sub_streams(self, db, items: list[tuple[str, str, int]]) -> None:
        """[(sub_path, sub_codec, camera_id)] — topilgan ikkinchi oqimlar."""
        for sub_path, sub_codec, camera_id in items:
            db.execute("UPDATE cameras SET sub_path = %s WHERE id = %s",
                       (_none_if_empty(sub_path), camera_id))
            db.execute("UPDATE camera_status SET sub_codec = %s WHERE camera_id = %s",
                       (_none_if_empty(sub_codec), camera_id))

    def mark_seen(self, db, addresses: list[tuple[str, int]], at: datetime | str) -> None:
        """Javob bergan manzillar: shu qurilmadagi barcha kameralarning last_seen'i."""
        if not addresses:
            return
        db.execute(
            "UPDATE camera_status s SET last_seen = %s FROM cameras c "
            "JOIN devices d ON d.id = c.device_id "
            "WHERE s.camera_id = c.id AND (d.host, d.rtsp_port) IN "
            "(SELECT * FROM unnest(%s::text[], %s::int[]))",
            (at, [a[0] for a in addresses], [int(a[1]) for a in addresses]))

    def set_snapshot_at(self, db, camera_id: int, at: datetime | str) -> None:
        db.execute("UPDATE camera_status SET snapshot_at = %s WHERE camera_id = %s",
                   (at, camera_id))

    def set_rtsp_udp(self, db, camera_id: int, udp: bool) -> None:
        db.execute("UPDATE camera_status SET rtsp_udp = %s WHERE camera_id = %s",
                   (bool(udp), camera_id))

    def set_sub_bad_by_id(self, db, camera_id: int) -> None:
        db.execute("UPDATE camera_status SET sub_bad = true WHERE camera_id = %s", (camera_id,))

    def list_visible(self, db, *, bbox: tuple[float, float, float, float] | None,
                     area_ids: list[int] | None, limit: int) -> tuple[int, list]:
        """Xarita ro'yxati: yoqilgan kameralar, ixtiyoriy bbox va hudud cheklovi.

        Sanoq va tanlov AYNAN bitta shart bo'yicha — `total` filtrga mos
        kameralar soni, qatorlar esa `limit` gacha.
        """
        where, params = "WHERE enabled", []
        if bbox:
            min_lat, min_lng, max_lat, max_lng = bbox
            where += " AND lat BETWEEN %s AND %s AND lng BETWEEN %s AND %s"
            params += [min_lat, max_lat, min_lng, max_lng]
        if area_ids is not None:
            where += " AND admin_area_id = ANY(%s)"
            params.append(list(area_ids))
        total = db.execute(f"SELECT COUNT(*) FROM {DETAILS} {where}", params).fetchone()[0]
        rows = db.execute(f"SELECT * FROM {DETAILS} {where} ORDER BY region, name LIMIT %s",
                          params + [limit]).fetchall()
        return total, rows

    def list_all(self, db) -> list:
        return db.execute(f"SELECT * FROM {DETAILS} ORDER BY id").fetchall()

    def search(self, db, query: str, limit: int, offset: int) -> tuple[int, list]:
        """Boshqaruv ro'yxati: nom, hudud, IP, slug yoki izoh bo'yicha qidiruv."""
        where, params = "", []
        if query:
            # ILIKE — katta-kichik harfga qaramaydi. % va _ foydalanuvchi
            # matnida joker emas, oddiy belgi.
            needle = "%" + _escape_like(query) + "%"
            where = ("WHERE name ILIKE %s OR region ILIKE %s OR ip ILIKE %s "
                     "OR slug ILIKE %s OR note ILIKE %s")
            params = [needle] * 5
        total = db.execute(f"SELECT COUNT(*) FROM {DETAILS} {where}", params).fetchone()[0]
        rows = db.execute(f"SELECT * FROM {DETAILS} {where} ORDER BY region, name "
                          "LIMIT %s OFFSET %s", params + [limit, offset]).fetchall()
        return total, rows

    def passport_candidates(self, db, retry_after_s: int, limit: int) -> list:
        """Kodeki, formati yoki modeli noma'lum yoqiq RTSP kameralar — oxirgi
        urinishdan `retry_after_s` o'tganlari, hech tekshirilmaganlari birinchi."""
        return db.execute(
            f"SELECT * FROM {DETAILS} WHERE enabled AND source_type = 'rtsp' "
            "AND (codec IS NULL OR resolution IS NULL OR model IS NULL) "
            "AND (probe_at IS NULL OR probe_at < now() - make_interval(secs => %s)) "
            "ORDER BY probe_at NULLS FIRST, id LIMIT %s", (retry_after_s, limit)).fetchall()

    def set_probe_result(self, db, camera_id: int, *, codec: str = "", resolution: str = "",
                         fps: float = 0.0, error: str | None = None) -> None:
        """Pasport tekshiruvi natijasi. Topilgan qiymatlar faqat BO'SH maydonga
        yoziladi — admin qo'lda kiritgani yoki skan aniqlagani ustidan yozilmaydi."""
        db.execute(
            "UPDATE camera_status SET codec = COALESCE(codec, %s), "
            "resolution = COALESCE(resolution, %s), fps = COALESCE(fps, %s), "
            "probe_at = now(), probe_error = %s WHERE camera_id = %s",
            (_none_if_empty(codec), _none_if_empty(resolution), fps or None,
             error or None, camera_id))

    def set_resolutions(self, db, by_slug: dict[str, str]) -> int:
        """Oqimdan o'lchangan kadr o'lchami (MediaMTX) — slug -> "1920x1080".
        Haqiqiy oqim eng ishonchli manba: farq qilsa ustidan yoziladi.
        Qaytaradi: o'zgargan kameralar soni."""
        changed = 0
        for slug, resolution in by_slug.items():
            changed += db.execute(
                "UPDATE camera_status SET resolution = %s WHERE camera_id = "
                "(SELECT id FROM cameras WHERE slug = %s) AND resolution IS DISTINCT FROM %s",
                (resolution, slug, resolution)).rowcount
        return changed

    def set_vendor(self, db, camera_id: int, vendor: str) -> None:
        """Ishlab chiqaruvchi — kameraning qurilmasiga yoziladi."""
        db.execute("UPDATE devices SET vendor = %s WHERE id = "
                   "(SELECT device_id FROM cameras WHERE id = %s)", (vendor, camera_id))

    def fix_record(self, db, camera_id: int, *, name: str | None = None, rtsp_path: str | None = None,
                   lat: float | None = None, lng: float | None = None,
                   admin_area_id: int | None = None, rail_line_id: int | None = None,
                   km: int | None = None, picket: int | None = None, note: str = "") -> None:
        """Ma'lumot tuzatish (database/scripts/fix_camera_data.py): faqat berilgan maydonlar
        o'zgaradi, `note` izohning oxiriga qo'shiladi — nima va nega tuzatilgani
        kamera yozuvining o'zida qoladi."""
        fields = {"name": name, "rtsp_path": rtsp_path, "lat": lat, "lng": lng,
                  "admin_area_id": admin_area_id, "rail_line_id": rail_line_id,
                  "km": km, "picket": picket}
        sets = [f"{k} = %({k})s" for k, v in fields.items() if v is not None]
        if note:
            sets.append("note = concat_ws(' · ', NULLIF(note, ''), %(note)s::text)")
        if not sets:
            return
        db.execute(f"UPDATE cameras SET {', '.join(sets)} WHERE id = %(id)s",
                   {**fields, "note": note, "id": camera_id})
