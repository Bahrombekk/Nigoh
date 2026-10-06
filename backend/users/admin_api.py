"""Nigoh — foydalanuvchilarni boshqarish (faqat admin / API kaliti).

Admin foydalanuvchi yaratadi, rolini va operator hududlarini belgilaydi
(ilgari api/admin.py ichida edi). Qoidalar:

  * parol kamida 6 belgi; yaratishda majburiy, tahrirda bo'sh — o'zgarmaydi;
    parol almashsa eski sessiyalar bekor bo'ladi;
  * operator hududlari faqat ro'yxatdagi nomlardan (erkin matn yo'q) —
    noma'lumi bo'lsa 400 va mavjudlari ro'yxati;
  * oxirgi admin operator qilinmaydi va o'chirilmaydi — bir vaqtdagi ikki
    so'rov tizimni adminsiz qoldirmasligi uchun tranzaksiya qulfi ostida;
  * admin o'z hisobini o'chira olmaydi;
  * sessiyalar va hududlar foydalanuvchi bilan birga ketadi
    (FOREIGN KEY ... ON DELETE CASCADE).

Endpointlar (hammasi require_admin; prefiks /api/v1/admin, eski /api/admin):
    GET     /api/v1/admin/users              foydalanuvchilar (operatorlar hududlari bilan)
    POST    /api/v1/admin/users              yangi foydalanuvchi (201); login band — 400
    PUT     /api/v1/admin/users/{user_id}    login, rol, parol va hududlarni yangilash
    DELETE  /api/v1/admin/users/{user_id}    o'chirish (204)
    GET     /api/v1/admin/regions            hududlar ro'yxati — kamera formasi
                                             va operator ruxsatlari uchun

Tarkibi:
    router      APIRouter(prefix="/admin", tags=["admin"])

Ishlatadi: database (users, areas, IntegrityError), core.security
    (hash_password), users.access.require_admin, users.schemas.UserIn.
Kim ishlatadi: app/factory.py (key_guard bilan ulanadi),
    tests/test_roles.py, scripts/acceptance_test.py.
"""
from fastapi import APIRouter, Depends, HTTPException

from core import security
from database import (
    IntegrityError,
    areas,
    get_db,
    users,
)
from users.access import require_admin
from users.schemas import UserIn

# Prefiks nisbiy — create_app uni /api/v1 (asosiy) va /api (eski) ostida ulaydi.
router = APIRouter(prefix="/admin", tags=["admin"],
                   dependencies=[Depends(require_admin)])


def _user_view(db, row) -> dict:
    return {
        "id": row["id"], "username": row["username"], "role": row["role"],
        "full_name": row["full_name"] or "", "is_active": row["is_active"],
        "created_at": row["created_at"], "last_login_at": row["last_login_at"],
        "regions": (users.region_names(db, row["id"])
                    if row["role"] == "operator" else []),
    }


def _check_password(password: str | None, required: bool) -> None:
    if required and not password:
        raise HTTPException(400, "Parol kiritilmagan")
    if password and len(password) < 6:
        raise HTTPException(400, "Parol kamida 6 belgidan iborat bo'lsin")


def _set_regions(db, user_id: int, body: UserIn) -> None:
    """Operator hududlari — faqat ro'yxatdagi nomlar (erkin matn yo'q)."""
    unknown = users.set_regions(db, user_id, body.regions if body.role == "operator" else [])
    if unknown:
        known = ", ".join(r["name"] for r in areas.list_regions(db))
        raise HTTPException(400, f"Noma'lum hudud: {', '.join(unknown)}. Mavjudlari: {known}")


def _keep_one_admin(db, user_id: int, new_role: str | None) -> None:
    """Oxirgi admin operator qilinmasin va o'chirilmasin.

    Bir vaqtdagi ikki so'rov tizimni adminsiz qoldirmasin — tranzaksiya qulfi.
    """
    users.lock_admin_changes(db)
    old = users.get(db, user_id)
    if old is None:
        raise HTTPException(404, "Foydalanuvchi topilmadi")
    if old["role"] == "admin" and new_role != "admin" and users.count(db, "admin") <= 1:
        raise HTTPException(400, "Oxirgi adminni operator qilib bo'lmaydi"
                            if new_role else "Oxirgi admin o'chirilmaydi")


@router.get("/users")
def admin_users():
    with get_db() as db:
        return {"users": [_user_view(db, r) for r in users.list_all(db)]}


@router.post("/users", status_code=201)
def admin_user_create(body: UserIn):
    _check_password(body.password, required=True)
    pw_hash, salt = security.hash_password(body.password)
    with get_db() as db:
        try:
            with db.savepoint():
                row = users.create(db, body.username.strip(), pw_hash, salt, body.role)
        except IntegrityError:
            raise HTTPException(400, "Bunday login allaqachon bor")
        _set_regions(db, row["id"], body)
        return _user_view(db, row)


@router.put("/users/{user_id}")
def admin_user_update(user_id: int, body: UserIn):
    _check_password(body.password, required=False)
    with get_db() as db:
        _keep_one_admin(db, user_id, body.role)
        try:
            with db.savepoint():
                users.update_identity(db, user_id, body.username.strip(), body.role)
        except IntegrityError:
            raise HTTPException(400, "Bunday login allaqachon bor")
        if body.password:
            # Parol almashdi — eski sessiyalar bekor (users.set_password).
            pw_hash, salt = security.hash_password(body.password)
            users.set_password(db, user_id, pw_hash, salt)
        _set_regions(db, user_id, body)
        return _user_view(db, users.get(db, user_id))


@router.delete("/users/{user_id}", status_code=204)
def admin_user_delete(user_id: int, me=Depends(require_admin)):
    if me["id"] == user_id:
        raise HTTPException(400, "O'z hisobingizni o'chira olmaysiz")
    with get_db() as db:
        _keep_one_admin(db, user_id, None)
        # Sessiyalar va hududlar FOREIGN KEY ... ON DELETE CASCADE bilan ketadi.
        users.delete(db, user_id)


@router.get("/regions")
def admin_regions():
    """Hududlar ro'yxati — kamera formasi va operator ruxsatlari uchun."""
    with get_db() as db:
        return {"regions": areas.list_regions(db)}
