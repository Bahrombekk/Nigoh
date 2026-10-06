"""Baza holati API'si — `GET /api/v1/admin/db` (faqat admin / kalit).

Nima uchun: bazaga kirmasdan turib "sxema qaysi versiyada, migratsiyalar
qachon qo'llangan, baza qancha joy egallaydi, qaysi jadval o'syapti"
degan savollarga javob. Parol, ulanish manzili va ma'lumotning o'zi
qaytmaydi.

Router prefiksi nisbiy (`/admin`): create_app (app/factory.py) uni
/api/v1 (asosiy) va /api (eski) ostida ulaydi.

Tarkibi:
    router                      APIRouter, hamma yo'lida require_admin
    database_status()           server, sxema versiyasi, migratsiyalar, hajm, jadvallar

Endpointlar:
    GET  /api/v1/admin/db       server_version, timezone, database, user,
                                schema_version / schema_latest / up_to_date,
                                migrations [{version, applied_at}], size_bytes,
                                tables [{name, rows (taxminiy), bytes}]

Ishlatadi: database.schema (versiya, migratsiyalar, jadval statistikasi,
server_info), database.connection (get_db, database_size),
users.access.require_admin (ruxsat).
Kim ishlatadi: app/factory.py (`database_router`).
"""
from fastapi import APIRouter, Depends

from database.connection import database_size, get_db
from database.schema import (
    applied_migrations,
    latest_version,
    schema_version,
    server_info,
    table_stats,
)
from users.access import require_admin

# Prefiks nisbiy — create_app uni /api/v1 (asosiy) va /api (eski) ostida ulaydi.
router = APIRouter(prefix="/admin", tags=["database"],
                   dependencies=[Depends(require_admin)])


@router.get("/db")
def database_status():
    """Baza holati: sxema versiyasi (joriy va kod kutayotgani), qo'llangan
    migratsiyalar, umumiy hajm va jadvallar (taxminiy qatorlar, hajm)."""
    with get_db() as db:
        current = schema_version(db)
        return {
            **server_info(db),
            "schema_version": current,
            "schema_latest": latest_version(),
            "up_to_date": current == latest_version(),
            "migrations": [{"version": r["version"], "applied_at": r["applied_at"]}
                           for r in applied_migrations(db)],
            "size_bytes": database_size(db),
            "tables": [{"name": r["name"], "rows": r["rows"], "bytes": r["bytes"]}
                       for r in table_stats(db)],
        }
