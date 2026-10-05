"""Sxema migratsiyalarini ishga tushirish.

Migratsiyalarning o'zi `database/migrations/NNNN_*.py` fayllarida.
`init_db()` hali bajarilmaganlarini tartib bilan, har birini o'z
savepoint'ida bajaradi va `schema_version` ga yozadi.

Bir nechta jarayon bir vaqtda ko'tarilsa (masalan ikki backend nusxasi)
migratsiyani faqat bittasi bajaradi: advisory lock.
"""
from __future__ import annotations

import os

from . import migrations
from .connection import get_db

DEFAULT_MEDIA_NODE_ID = 1


def schema_version(db) -> int:
    row = db.execute("SELECT MAX(version) FROM schema_version").fetchone()
    return row[0] or 0


def latest_version() -> int:
    return migrations.load()[-1].VERSION


def _main_media_node(db) -> None:
    """1-tugun har doim bo'lsin — kameralar standart shu tugunda."""
    table = "media_nodes" if schema_version(db) >= 2 else "nodes"
    db.execute(
        f"INSERT INTO {table} (id, name, api_base, public_host, rtsp_port, "
        "hls_port, webrtc_port) VALUES (%s, 'Asosiy', %s, '', %s, %s, %s) "
        "ON CONFLICT (id) DO NOTHING",
        (DEFAULT_MEDIA_NODE_ID,
         os.environ.get("MEDIAMTX_API", "http://127.0.0.1:9997"),
         int(os.environ.get("MEDIAMTX_RTSP_PORT", "8554")),
         int(os.environ.get("HLS_PORT", "8888")),
         int(os.environ.get("WEBRTC_PORT", "8889"))),
    )
    # Qo'lda id=1 berilgan — identity keyingi raqamdan davom etsin.
    db.execute(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
               f"GREATEST((SELECT MAX(id) FROM {table}), 1))")


def init_db(target_version: int | None = None) -> None:
    """Sxemani oxirgi (yoki `target_version`) versiyaga olib chiqadi.

    `target_version` — faqat eski ma'lumotni ko'chirish skriptlari uchun
    (masalan SQLite importi 1-versiya jadvallariga yozadi, keyin qolgan
    migratsiyalar ma'lumotni o'zi o'zgartiradi).
    """
    with get_db() as db:
        # Bir vaqtda ko'tarilgan ikkinchi jarayon shu yerda kutadi.
        db.execute("SELECT pg_advisory_xact_lock(hashtext('nigoh_migratsiya'))")
        db.execute(
            "CREATE TABLE IF NOT EXISTS schema_version ("
            " version INTEGER PRIMARY KEY,"
            " applied_at TIMESTAMPTZ NOT NULL DEFAULT now())")
        current = schema_version(db)
        for migration in migrations.load():
            if migration.VERSION <= current:
                continue
            if target_version is not None and migration.VERSION > target_version:
                break
            if migration.VERSION == 2:
                # 2-migratsiya 1-tugunni media_nodes ga ko'chiradi — u bor bo'lsin.
                _main_media_node(db)
            with db.savepoint():
                migration.apply(db)
                db.execute("INSERT INTO schema_version (version) VALUES (%s)",
                           (migration.VERSION,))
        _main_media_node(db)
