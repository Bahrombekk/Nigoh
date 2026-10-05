"""Nigoh — ma'lumotlar bazasi qatlami (PostgreSQL). Bazaga tegadigan barcha
SQL shu paketda; qolgan kod tayyor funksiyalarni chaqiradi.

    connection.py — hovuz, `get_db()`, qator turi, xato turlari
    schema.py     — migratsiyalarni ishga tushirish (`init_db`)
    migrations/   — raqamlangan migratsiyalar (NNNN_*.py)
    cameras.py    — kameralar, qurilmalar, jonli holat; slug
    areas.py      — ma'muriy hududlar (viloyat -> tuman)
    users.py      — foydalanuvchilar, sessiyalar, operator ruxsatlari
    events.py     — kamera/oqim hodisalari (uptime manbai)
    stats.py      — dashboard tarixi
    nodes.py      — MediaMTX tugunlari
    walls.py      — video devor registri
    audit.py      — o'zgarishlar jurnali

SQL so'rovlarida joy belgisi `%s` (psycopg), `?` EMAS. Satr ichidagi
haqiqiy `%` belgisi parametrli so'rovda `%%` deb yoziladi.
"""
from .cameras import (
    cameras_by_slug,
    cameras_without_sub,
    set_sub_bad,
    set_sub_path,
    slugify,
    sub_bad_cameras,
    unique_slug,
)
from .connection import IntegrityError, UniqueViolation, get_db, single_connection
from .schema import init_db

__all__ = [
    "IntegrityError", "UniqueViolation", "cameras_by_slug",
    "cameras_without_sub", "get_db", "init_db", "set_sub_bad",
    "set_sub_path", "slugify", "sub_bad_cameras", "unique_slug",
    "single_connection",
]
