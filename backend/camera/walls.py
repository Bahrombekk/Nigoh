"""Nigoh — devor (mozaika) registri.

Qaysi kameralar, qaysi setkada birlashtiriladi — shu yerda saqlanadi.
Kalit (wall_key) tanlov + setkaning hashi: BIR XIL tanlovni bir necha
operator so'rasa, bitta kalit chiqadi va bitta mozaika oqimini bo'lishadi
(server bir marta kodlaydi).

Jadval video_walls (launcher ham, API ham shu bazani o'qiydi; SQL —
database/walls.py). MVP:
mozaika kamera SUB-oqimini to'g'ridan kameradan o'qiydi; kelgusida
MediaMTX relay orqali ulashiladi.
"""
from __future__ import annotations

import hashlib

from database import cameras, get_db
from database import walls as walls_db


def wall_key(camera_ids: list[int], cols: int, rows: int) -> str:
    """Tanlov + setka -> qisqa kalit. Tartib muhim (katak joylashuvi),
    shuning uchun ID'lar tartibi saqlanadi."""
    raw = ",".join(str(i) for i in camera_ids) + f"|{cols}x{rows}"
    return hashlib.sha1(raw.encode()).hexdigest()[:12]


# Registrda saqlanadigan eng ko'p devor soni. Har xil tanlov — alohida
# kalit, ya'ni operatorlar erkin tanlaganda kombinatsiyalar cheksiz
# (154 kamerada amalda chegara yo'q). Jadval o'sishi bilan bog'liq
# birorta funksiya yo'q — shuning uchun eng eskilari olib tashlanadi.
# Devor har ochilishida `POST /walls` uni qaytadan yozadi, ya'ni
# ishlatilayotgani hech qachon eskirmaydi.
WALL_LIMIT = 200


def save_wall(camera_ids: list[int], cols: int, rows: int) -> str:
    key = wall_key(camera_ids, cols, rows)
    with get_db() as db:
        walls_db.save(db, key, camera_ids, cols, rows, WALL_LIMIT)
    return key


def load_wall(key: str) -> dict | None:
    with get_db() as db:
        row = walls_db.load(db, key)
    if not row:
        return None
    return {"camera_ids": list(row["camera_ids"]),
            "cols": row["cols"], "rows": row["rows"]}


def wall_relays(key: str) -> dict | None:
    """Launcher uchun: har katak uchun LOKAL MediaMTX relay yo'l nomi + setka.

    Mozaika kameradan TO'G'RIDAN o'qimaydi — u MediaMTX orqa xonda ushlab
    turgan `<slug>_sub` (sub bo'lmasa `<slug>`) relay yo'lidan o'qiydi.
    Foydasi:
      • kamera bilan bitta ulanish (relay), necha devor bo'lsa ham;
      • uzilishni MediaMTX relay ushlaydi, mozaika lokaldan o'qiydi;
      • lokal ulanish — ochilish tez, tarmoq kutmaydi.

    Kodegi bo'sh (o'lik/xato parol/nostream) kamera -> None (qora katak):
    uning relay'i baribir ko'tarilmaydi va FFmpeg'ni yiqitardi.

    Qaytadi: {"relays": [<yo'l nomi|None>...], "cols", "rows"}. Relay
    tayyormi (ready) — buni launcher MediaMTX'dan tekshiradi va sovuq
    yoki ko'tarilmagan relayni qora katakka aylantiradi."""
    w = load_wall(key)
    if not w:
        return None
    ids = w["camera_ids"]
    rows = {}
    if ids:
        with get_db() as db:
            for r in cameras.list_by_ids(db, ids):
                rows[r["id"]] = r
    relays: list[str | None] = []
    for cid in ids:
        r = rows.get(cid)
        if not r or not r["enabled"] or not r["ip"] or not r["codec"]:
            relays.append(None)
            continue
        # Sub relay bo'lsa o'sha (yengil), aks holda asosiy relay.
        relays.append(r["slug"] + "_sub" if r["sub_path"] else r["slug"])
    return {"relays": relays, "cols": w["cols"], "rows": w["rows"]}
