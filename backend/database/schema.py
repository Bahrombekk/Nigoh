"""Sxema migratsiyalarini ishga tushirish va sxema holatini o'qish.

Migratsiyalarning o'zi `database/migrations/NNNN_*.py` fayllarida.
`init_db()` hali bajarilmaganlarini tartib bilan, har birini o'z
savepoint'ida bajaradi va `schema_version` ga yozadi.

Bir nechta jarayon bir vaqtda ko'tarilsa (masalan ikki backend nusxasi)
migratsiyani faqat bittasi bajaradi: advisory lock
(`pg_advisory_xact_lock(hashtext('nigoh_migratsiya'))`), ikkinchisi kutadi.

1-MediaMTX tuguni (`DEFAULT_MEDIA_NODE_ID`) har doim bo'ladi — kameralar
standart shu tugunda. U MEDIAMTX_API, MEDIAMTX_RTSP_PORT, HLS_PORT,
WEBRTC_PORT dan yaratiladi; 2-migratsiyadan oldin ham (u 1-tugunni
media_nodes ga ko'chiradi) va har init_db oxirida.

Tarkibi:
    init_db(target_version)     sxemani oxirgi (yoki target_version) versiyaga olib chiqadi;
                                target_version — faqat eski ma'lumotni ko'chirish
                                skriptlari uchun (SQLite importi 1-versiyaga yozadi)
    schema_version(db)          bazadagi joriy versiya (0 — bo'sh)
    latest_version()            kod kutayotgan oxirgi versiya
    applied_migrations(db)      [(version, applied_at)], eskisi birinchi
    table_stats(db)             public jadvallar: taxminiy qatorlar (n_live_tup) va hajm
    server_info(db)             PostgreSQL versiyasi, zona, baza va foydalanuvchi nomi
    DEFAULT_MEDIA_NODE_ID       asosiy MediaMTX tuguni id'si (1)

Jadvallar: schema_version, media_nodes (eski nomi nodes)
Ishlatadi: database.migrations (load), database.connection (get_db)
Kim ishlatadi: database/__init__.py (init_db) -> app/bootstrap.py,
scripts/import_mediamtx.py, database/scripts/*.py, tests/conftest.py;
database/api.py (holat funksiyalari), tests/test_roles.py.
"""
from __future__ import annotations

import os
import time

from core.log import log
from database import migrations
from database.connection import get_db

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
            started = time.monotonic()
            with db.savepoint():
                migration.apply(db)
                db.execute("INSERT INTO schema_version (version) VALUES (%s)",
                           (migration.VERSION,))
            log("database", "migration_applied", version=migration.VERSION,
                module=migration.__name__.rsplit(".", 1)[-1],
                ms=round((time.monotonic() - started) * 1000))
        _main_media_node(db)


def applied_migrations(db) -> list:
    """Qo'llangan migratsiyalar: [(version, applied_at)], eskisi birinchi."""
    return db.execute("SELECT version, applied_at FROM schema_version ORDER BY version").fetchall()


def table_stats(db) -> list:
    """`public` sxemadagi jadvallar: taxminiy qatorlar soni va hajmi (indekslar bilan).

    Qatorlar soni — PostgreSQL statistikasidan (`n_live_tup`): aniq COUNT(*)
    katta jadvalda sekin, bu yerda esa tartib (qaysi jadval o'syapti) kerak.
    """
    return db.execute(
        "SELECT c.relname AS name, COALESCE(s.n_live_tup, 0) AS rows, "
        "pg_total_relation_size(c.oid) AS bytes FROM pg_class c "
        "JOIN pg_namespace n ON n.oid = c.relnamespace "
        "LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid "
        "WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY bytes DESC").fetchall()


def server_info(db) -> dict:
    """PostgreSQL versiyasi, ulanish zonasi va baza nomi."""
    row = db.execute("SELECT current_setting('server_version'), current_setting('TimeZone'), "
                     "current_database(), current_user").fetchone()
    return {"server_version": row[0], "timezone": row[1], "database": row[2], "user": row[3]}
