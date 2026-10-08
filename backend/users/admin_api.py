"""Nigoh — foydalanuvchilarni boshqarish (faqat admin / API kaliti).

Admin foydalanuvchi yaratadi, rolini va operator hududlarini belgilaydi
(ilgari api/admin.py ichida edi). Qoidalar:

  * parol kamida 6 belgi; yaratishda majburiy, tahrirda bo'sh — o'zgarmaydi;
    parol almashsa eski sessiyalar bekor bo'ladi;
  * rollar: admin, operator, viewer (Kuzatuvchi — o'z hududlarini faqat
    ko'radi); operator va kuzatuvchi hududlari faqat ro'yxatdagi nomlardan
    (erkin matn yo'q) — noma'lumi bo'lsa 400 va mavjudlari ro'yxati;
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
    POST    /api/v1/admin/users/{user_id}/reset-password
                                             vaqtinchalik parol {"password"} (12 belgi,
                                             bir marta ko'rsatiladi); sessiyalar bekor, audit
    GET     /api/v1/admin/regions            hududlar ro'yxati — kamera formasi
                                             va operator/kuzatuvchi ruxsatlari uchun

Tarkibi:
    router      APIRouter(prefix="/admin", tags=["admin"])

Ishlatadi: database (users, areas, IntegrityError), core.security
    (hash_password), users.access.require_admin, users.schemas.UserIn.
Kim ishlatadi: app/factory.py (key_guard bilan ulanadi),
    tests/test_roles.py, scripts/acceptance_test.py.
"""
import secrets
import string

from fastapi import APIRouter, Depends, HTTPException, Request

from app import audit as audit_log
from core import security
from database import (
    IntegrityError,
    areas,
    get_db,
    users,
)
from database.repositories.users import REGION_ROLES
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
                    if row["role"] in REGION_ROLES else []),
    }


def _check_password(password: str | None, required: bool) -> None:
    if required and not password:
        raise HTTPException(400, "Parol kiritilmagan")
    if password and len(password) < 6:
        raise HTTPException(400, "Parol kamida 6 belgidan iborat boʻlsin")


def _set_regions(db, user_id: int, body: UserIn) -> None:
    """Operator/kuzatuvchi hududlari — faqat ro'yxatdagi nomlar (erkin matn yo'q)."""
    unknown = users.set_regions(db, user_id, body.regions if body.role in REGION_ROLES else [])
    if unknown:
        known = ", ".join(r["name"] for r in areas.list_regions(db))
        raise HTTPException(400, f"Nomaʼlum hudud: {', '.join(unknown)}. Mavjudlari: {known}")


def _keep_one_admin(db, user_id: int, new_role: str | None) -> None:
    """Oxirgi admin operator qilinmasin va o'chirilmasin.

    Bir vaqtdagi ikki so'rov tizimni adminsiz qoldirmasin — tranzaksiya qulfi.
    """
    users.lock_admin_changes(db)
    old = users.get(db, user_id)
    if old is None:
        raise HTTPException(404, "Foydalanuvchi topilmadi")
    if old["role"] == "admin" and new_role != "admin" and users.count(db, "admin") <= 1:
        raise HTTPException(400, "Oxirgi administratorni boshqa rolga oʻtkazib boʻlmaydi"
                            if new_role else "Oxirgi administratorni oʻchirib boʻlmaydi")


@router.get("/users")
def admin_users():
    with get_db() as db:
        return {"users": [_user_view(db, r) for r in users.list_all(db)]}


def _audit_view(view: dict) -> dict:
    """Audit uchun ochiq maydonlar (parol/xesh hech qachon)."""
    return {k: view[k] for k in ("username", "role", "full_name", "is_active", "regions")}


@router.post("/users", status_code=201)
def admin_user_create(body: UserIn, request: Request):
    _check_password(body.password, required=True)
    pw_hash, salt = security.hash_password(body.password)
    with get_db() as db:
        try:
            with db.savepoint():
                row = users.create(db, body.username.strip(), pw_hash, salt, body.role)
        except IntegrityError:
            raise HTTPException(400, "Bunday login allaqachon bor")
        users.update_identity(db, row["id"], row["username"], body.role,
                              body.full_name.strip(), body.is_active)
        _set_regions(db, row["id"], body)
        view = _user_view(db, users.get(db, row["id"]))
        audit_log.record(db, request, "user.create", "user", entity_id=row["id"],
                         after=_audit_view(view))
        return view


@router.put("/users/{user_id}")
def admin_user_update(user_id: int, body: UserIn, request: Request,
                      me=Depends(require_admin)):
    _check_password(body.password, required=False)
    with get_db() as db:
        _keep_one_admin(db, user_id, body.role)
        before = _user_view(db, users.get(db, user_id))
        if not body.is_active:
            # Tizim adminsiz qolmasin: o'zini va oxirgi faol adminni bloklab bo'lmaydi.
            if me["id"] == user_id:
                raise HTTPException(400, "Oʻz hisobingizni bloklay olmaysiz")
            if before["role"] == "admin" and before["is_active"] \
                    and users.count_active_admins(db, exclude_id=user_id) == 0:
                raise HTTPException(400, "Oxirgi faol administratorni bloklab boʻlmaydi")
        try:
            with db.savepoint():
                users.update_identity(db, user_id, body.username.strip(), body.role,
                                      body.full_name.strip(), body.is_active)
        except IntegrityError:
            raise HTTPException(400, "Bunday login allaqachon bor")
        if body.password:
            # Parol almashdi — eski sessiyalar bekor (users.set_password).
            pw_hash, salt = security.hash_password(body.password)
            users.set_password(db, user_id, pw_hash, salt)
        _set_regions(db, user_id, body)
        view = _user_view(db, users.get(db, user_id))
        after = {**_audit_view(view), **({"password": "oʻzgartirildi"} if body.password else {})}
        audit_log.record(db, request, "user.update", "user", entity_id=user_id,
                         before=_audit_view(before), after=after)
        return view


@router.delete("/users/{user_id}", status_code=204)
def admin_user_delete(user_id: int, request: Request, me=Depends(require_admin)):
    if me["id"] == user_id:
        raise HTTPException(400, "Oʻz hisobingizni oʻchira olmaysiz")
    with get_db() as db:
        _keep_one_admin(db, user_id, None)
        audit_log.record(db, request, "user.delete", "user", entity_id=user_id,
                         before=_audit_view(_user_view(db, users.get(db, user_id))))
        # Sessiyalar va hududlar FOREIGN KEY ... ON DELETE CASCADE bilan ketadi.
        users.delete(db, user_id)


# Vaqtinchalik parol alifbosi: o'xshash belgilar (0/O, 1/l/I) yo'q — telefonda
# aytib berishda adashilmasin.
_TEMP_ALPHABET = "".join(c for c in string.ascii_letters + string.digits if c not in "0O1lI")
TEMP_PASSWORD_LEN = 12


@router.post("/users/{user_id}/reset-password")
def admin_user_reset_password(user_id: int, request: Request):
    """Vaqtinchalik parol (12 belgi) — javobda BIR MARTA ko'rsatiladi, bazada faqat
    xeshi. Foydalanuvchining barcha sessiyalari bekor bo'ladi. Audit yoziladi."""
    password = "".join(secrets.choice(_TEMP_ALPHABET) for _ in range(TEMP_PASSWORD_LEN))
    with get_db() as db:
        if users.get(db, user_id) is None:
            raise HTTPException(404, "Foydalanuvchi topilmadi")
        pw_hash, salt = security.hash_password(password)
        users.set_password(db, user_id, pw_hash, salt)
        audit_log.record(db, request, "user.password_reset", "user", entity_id=user_id,
                         after={"password": "vaqtinchalik parol berildi"})
    return {"password": password}


@router.get("/regions")
def admin_regions():
    """Hududlar ro'yxati — kamera formasi va operator ruxsatlari uchun."""
    with get_db() as db:
        return {"regions": areas.list_regions(db)}
