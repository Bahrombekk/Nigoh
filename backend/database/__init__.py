"""Nigoh ma'lumotlar bazasi qatlami (PostgreSQL 17, psycopg 3) — paketning kirish nuqtasi.

Bazaga tegadigan barcha SQL shu paketda; qolgan kod tayyor repozitoriy
metodlarini chaqiradi. Tranzaksiyani chaqiruvchi o'zi ochadi:

    from database import cameras, get_db
    with get_db() as db:
        row = cameras.get(db, 42)

SQL so'rovlarida joy belgisi `%s` (psycopg), `?` EMAS. Satr ichidagi
haqiqiy `%` belgisi parametrli so'rovda `%%` deb yoziladi.

Paket tuzilmasi:
    connection.py     hovuz, `get_db()`, qator turi, xato turlari
    schema.py         migratsiyalarni ishga tushirish (`init_db`), sxema holati
    migrations/       raqamlangan migratsiyalar (NNNN_*.py)
    repositories/     har jadval guruhiga bitta Repository klassi
    api.py            GET /api/v1/admin/db — baza holati
    scripts/, sql/    zaxira, ko'chirish, tuzatish skriptlari; rollar SQL'i

Tarkibi (qayta eksport):
    get_db()                    hovuzdan ulanish, bitta tranzaksiya (COMMIT/ROLLBACK)
    single_connection()         hovuzsiz bitta ulanish (launcher kabi qisqa jarayonlar)
    init_db(target_version)     sxemani oxirgi versiyaga olib chiqadi
    IntegrityError              psycopg.IntegrityError taxallusi
    UniqueViolation             takror kalit xatosi (psycopg.errors.UniqueViolation)
    areas                       AreaRepository — ma'muriy hududlar
    cameras                     CameraRepository — kameralar, qurilmalar, jonli holat
    events                      EventRepository — kamera/oqim hodisalari
    geo                         GeoRepository — nuqta hudud ichidami
    nodes                       MediaNodeRepository — MediaMTX tugunlari
    rail                        RailRepository — temir yo'l, km/piket
    reports                     ReportRepository — dashboard hisobotlari uchun xom qatorlar
    stats                       StatsRepository — dashboard tarixi
    users                       UserRepository — foydalanuvchilar, sessiyalar
    walls                       WallRepository — video devor registri
  eski nomlar (cameras.* ning taxalluslari, `from database import slugify`):
    slugify, unique_slug, set_sub_bad, set_sub_path, cameras_by_slug,
    cameras_without_sub, sub_bad_cameras

Ishlatadi: database.connection, database.repositories, database.schema
Kim ishlatadi: deyarli butun backend — app/, camera/ (api, media, monitoring,
state, streaming), core/security.py, stats/, users/, walls/, scripts/, tests/.
"""
from database.connection import (
    IntegrityError,
    UniqueViolation,
    get_db,
    single_connection,
)
from database.repositories import (
    areas,
    cameras,
    events,
    geo,
    nodes,
    rail,
    reports,
    stats,
    users,
    walls,
)

# Eski nomlar (kod `from database import slugify` deb chaqiradi).
cameras_by_slug = cameras.cameras_by_slug
cameras_without_sub = cameras.cameras_without_sub
set_sub_bad = cameras.set_sub_bad
set_sub_path = cameras.set_sub_path
slugify = cameras.slugify
sub_bad_cameras = cameras.sub_bad_cameras
unique_slug = cameras.unique_slug

from database.schema import init_db  # noqa: E402

__all__ = [
    "IntegrityError", "UniqueViolation", "areas", "cameras", "cameras_by_slug",
    "cameras_without_sub", "events", "geo", "get_db", "init_db", "nodes", "rail",
    "reports", "set_sub_bad", "set_sub_path", "single_connection", "slugify", "stats",
    "sub_bad_cameras", "unique_slug", "users", "walls",
]
