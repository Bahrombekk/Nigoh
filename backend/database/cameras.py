"""Kameralar: o'qish (camera_details ko'rinishi) va yozish (cameras,
devices, camera_status jadvallari).

O'qish har doim `camera_details` dan — u kamera, qurilma, jonli holat va
hududni bitta tekis qatorga yig'adi, ustun nomlari API javobi bilan bir
xil (ip, port, node_id, region ...). Yozish faqat shu moduldagi
funksiyalar orqali: kamera qaysi qurilmaga tegishli, NVR'mi, holat qatori
bormi — bular chaqiruvchining tashvishi emas.
"""
from __future__ import annotations

import re
from datetime import datetime

from .connection import get_db

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


def unique_slug(db, base: str, exclude_id: int | None = None) -> str:
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


# ---------- o'qish ----------

def get(db, camera_id: int):
    return db.execute(f"SELECT * FROM {DETAILS} WHERE id = %s", (camera_id,)).fetchone()


def get_by_slug(db, slug: str):
    return db.execute(f"SELECT * FROM {DETAILS} WHERE slug = %s", (slug,)).fetchone()


def get_by_external_id(db, external_id: str):
    return db.execute(f"SELECT * FROM {DETAILS} WHERE external_id = %s",
                      (external_id,)).fetchone()


def external_id_taken(db, external_id: str, exclude_id: int | None = None) -> bool:
    if not external_id:
        return False
    return db.execute(
        "SELECT 1 FROM cameras WHERE external_id = %s AND id IS DISTINCT FROM %s",
        (external_id, exclude_id)).fetchone() is not None


def find_by_address(db, host: str, port: int, rtsp_path: str | None = None) -> list:
    """Shu qurilmadagi kameralar (yo'l berilsa — aynan shu yo'l), id tartibida."""
    sql = f"SELECT * FROM {DETAILS} WHERE ip = %s AND port = %s"
    params: list = [host, port]
    if rtsp_path is not None:
        sql += " AND rtsp_path = %s"
        params.append(rtsp_path)
    return db.execute(sql + " ORDER BY id", params).fetchall()


def list_rtsp(db, enabled_only: bool = False) -> list:
    """Qurilmasi bor (RTSP) kameralar — MediaMTX, health, suratlar uchun."""
    sql = f"SELECT * FROM {DETAILS} WHERE device_id IS NOT NULL"
    if enabled_only:
        sql += " AND enabled"
    return db.execute(sql + " ORDER BY id").fetchall()


def list_by_ids(db, ids: list[int]) -> list:
    return db.execute(f"SELECT * FROM {DETAILS} WHERE id = ANY(%s)", (list(ids),)).fetchall()


def all_slugs(db) -> set[str]:
    return {r[0] for r in db.execute("SELECT slug FROM cameras")}


# ---------- qurilmalar ----------

def _ensure_device(db, organization_id: int, host: str, port: int, vendor: str | None,
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


def _refresh_device(db, device_id: int | None) -> None:
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


# ---------- yozish ----------

def create(db, data: dict, *, password_enc: str | None) -> int:
    """Yangi kamera. `data`: _CAMERA_FIELDS + slug, host, port, vendor,
    username + jonli holat (codec, sub_codec, resolution, fps, transcode).

    Takror manzil yoki band external_id — UniqueViolation (chaqiruvchi
    savepoint ichida ushlaydi).
    """
    org = data.get("organization_id") or DEFAULT_ORGANIZATION_ID
    device_id = None
    if data["source_type"] == "rtsp":
        device_id = _ensure_device(db, org, data["host"], data["port"], data.get("vendor"),
                                   data.get("username"), password_enc, keep_password=False)
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
    _refresh_device(db, device_id)
    return camera_id


def update(db, camera_id: int, data: dict, *, password_enc: str | None,
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
        device_id = _ensure_device(db, org, data["host"], data["port"], data.get("vendor"),
                                   data.get("username"), password_enc, keep_password)
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
        _refresh_device(db, old_device["device_id"])
    _refresh_device(db, device_id)


def delete(db, camera_id: int) -> None:
    row = db.execute("DELETE FROM cameras WHERE id = %s RETURNING device_id",
                     (camera_id,)).fetchone()
    if row:
        _refresh_device(db, row[0])


def set_enabled(db, camera_id: int, enabled: bool) -> None:
    db.execute("UPDATE cameras SET enabled = %s WHERE id = %s", (bool(enabled), camera_id))


def set_external_id(db, camera_id: int, external_id: str) -> None:
    db.execute("UPDATE cameras SET external_id = %s WHERE id = %s",
               (_none_if_empty(external_id), camera_id))


def set_passport(db, camera_ids: list[int], model: str, firmware: str) -> None:
    """Qurilma pasporti (model/firmware) — kameralarning qurilmasiga yoziladi."""
    db.execute(
        "UPDATE devices SET model = COALESCE(%s, model), firmware = COALESCE(%s, firmware) "
        "WHERE id IN (SELECT device_id FROM cameras WHERE id = ANY(%s))",
        (_none_if_empty(model), _none_if_empty(firmware), list(camera_ids)))


def set_sub_streams(db, items: list[tuple[str, str, int]]) -> None:
    """[(sub_path, sub_codec, camera_id)] — topilgan ikkinchi oqimlar."""
    for sub_path, sub_codec, camera_id in items:
        db.execute("UPDATE cameras SET sub_path = %s WHERE id = %s",
                   (_none_if_empty(sub_path), camera_id))
        db.execute("UPDATE camera_status SET sub_codec = %s WHERE camera_id = %s",
                   (_none_if_empty(sub_codec), camera_id))


def mark_seen(db, addresses: list[tuple[str, int]], at: datetime | str) -> None:
    """Javob bergan manzillar: shu qurilmadagi barcha kameralarning last_seen'i."""
    if not addresses:
        return
    db.execute(
        "UPDATE camera_status s SET last_seen = %s FROM cameras c "
        "JOIN devices d ON d.id = c.device_id "
        "WHERE s.camera_id = c.id AND (d.host, d.rtsp_port) IN "
        "(SELECT * FROM unnest(%s::text[], %s::int[]))",
        (at, [a[0] for a in addresses], [int(a[1]) for a in addresses]))


def set_snapshot_at(db, camera_id: int, at: datetime | str) -> None:
    db.execute("UPDATE camera_status SET snapshot_at = %s WHERE camera_id = %s",
               (at, camera_id))


def set_rtsp_udp(db, camera_id: int, udp: bool) -> None:
    db.execute("UPDATE camera_status SET rtsp_udp = %s WHERE camera_id = %s",
               (bool(udp), camera_id))


# ---------- sub oqim bayroqlari (reconciler) ----------

def set_sub_bad(slugs: list[str], bad: bool) -> list[str]:
    """`sub_bad` bayrog'ini o'rnatadi/oladi. Qaytadi: o'zgargan sluglar.

    Faqat haqiqatan boshqa qiymatda turgan qator yangilanadi, shuning
    uchun chaqiruvchi har tsiklda chaqirsa ham takror yozuv bo'lmaydi.

    Bayroq nimani bildiradi: kameraning ikkinchi (sub) oqimi yo'q yoki
    ishlamayapti — tomoshabinga asosiy oqim berilsin. Uni reconciler
    jonli kuzatuvdan o'zi qo'yadi va o'zi oladi (camera/reconciler.py,
    `_check_sub_health`), pleyer ham qo'ya oladi (/sub-bad).
    """
    if not slugs:
        return []
    with get_db() as db:
        return [r[0] for r in db.execute(
            "UPDATE camera_status s SET sub_bad = %s FROM cameras c "
            "WHERE s.camera_id = c.id AND c.slug = ANY(%s) AND s.sub_bad <> %s "
            "RETURNING c.slug", (bool(bad), list(slugs), bool(bad)))]


def set_sub_bad_by_id(db, camera_id: int) -> None:
    db.execute("UPDATE camera_status SET sub_bad = true WHERE camera_id = %s", (camera_id,))


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


def list_visible(db, *, bbox: tuple[float, float, float, float] | None,
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


def list_all(db) -> list:
    return db.execute(f"SELECT * FROM {DETAILS} ORDER BY id").fetchall()


def _escape_like(text: str) -> str:
    """LIKE/ILIKE uchun: \\, % va _ oddiy belgi bo'lib qolsin (standart ekran — \\)."""
    return re.sub(r"([\\%_])", r"\\\1", text)


def search(db, query: str, limit: int, offset: int) -> tuple[int, list]:
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
