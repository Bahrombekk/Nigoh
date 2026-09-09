"""Nigoh — super-admin endpointlari.

Ikki toifa:

  * foydalanuvchilar (rollar, hududlar) — SHU tizimda saqlanadi;
  * kameralar CRUD, NVR import, skaner, probe, tugunlar, MediaMTX —
    hammasi kamera mikroservisiga o'zgarishsiz uzatiladi (proxy).

Frontend uchun API yuzasi avvalgidek qoldi — u mikroservis haqida bilmaydi.
"""
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from core import security
from core.db import get_db

from . import nigoh
from .helpers import require_admin
from .models import UserIn

# Prefiks nisbiy — create_app uni /api/v1 (asosiy) va /api (eski) ostida ulaydi.
router = APIRouter(prefix="/admin", tags=["admin"],
                   dependencies=[Depends(require_admin)])


# ---------- kameralar (mikroservisga proxy) ----------

@router.get("/cameras")
def admin_list(q: str = "", limit: int = 100, offset: int = 0):
    """Boshqaruv ro'yxati — qidiruv va sahifalash bilan (mikroservisdan)."""
    return nigoh.proxy("GET", "/api/v1/admin/cameras",
                       params={"q": q, "limit": limit, "offset": offset})


@router.post("/cameras", status_code=201)
async def admin_create(request: Request):
    return nigoh.proxy("POST", "/api/v1/admin/cameras",
                       body=await request.json())


@router.put("/cameras/{camera_id}")
async def admin_update(camera_id: int, request: Request):
    return nigoh.proxy("PUT", f"/api/v1/admin/cameras/{camera_id}",
                       body=await request.json())


@router.delete("/cameras/{camera_id}", status_code=204)
def admin_delete(camera_id: int):
    return nigoh.proxy("DELETE", f"/api/v1/admin/cameras/{camera_id}")


@router.post("/cameras/detect-sub")
def admin_detect_sub():
    """Sub yo'li yo'q kameralarga past sifatli 2-oqimni topib beradi."""
    return nigoh.proxy("POST", "/api/v1/admin/cameras/detect-sub")


# ---------- NVR import, skaner, probe (mikroservisga proxy) ----------

@router.post("/nvr/import")
async def admin_nvr_import(request: Request):
    """Registratordagi kanallarni birdaniga kameralarga aylantiradi."""
    return nigoh.proxy("POST", "/api/v1/admin/nvr/import",
                       body=await request.json())


@router.post("/scan")
async def admin_scan(request: Request):
    """Qurilmani o'zi aniqlaydi: turi (kamera/NVR), shabloni va kanallari."""
    return nigoh.proxy("POST", "/api/v1/admin/scan",
                       body=await request.json())


@router.post("/probe")
async def admin_probe(request: Request):
    """Kamera bilan aloqani va login/parolni tekshiradi."""
    return nigoh.proxy("POST", "/api/v1/admin/probe",
                       body=await request.json())


# ---------- foydalanuvchilar (lokal) ----------
#
# Rollar: 'admin' — hammasini boshqaradi (shu bo'lim ham faqat unga ochiq);
# 'operator' — faqat o'ziga biriktirilgan hududlardagi kameralarni ko'radi
# (xarita ro'yxati, oqim va surat shu ro'yxat bilan cheklanadi).

def _user_view(db, row) -> dict:
    return {
        "id": row["id"], "username": row["username"], "role": row["role"],
        "created_at": row["created_at"],
        "regions": (security.user_regions(db, row["id"])
                    if row["role"] == "operator" else []),
    }


def _check_password(password: str | None, required: bool) -> None:
    if required and not password:
        raise HTTPException(400, "Parol kiritilmagan")
    if password and len(password) < 6:
        raise HTTPException(400, "Parol kamida 6 belgidan iborat bo'lsin")


@router.get("/users")
def admin_users():
    with get_db() as db:
        rows = db.execute(
            "SELECT id, username, role, created_at FROM admins ORDER BY id"
        ).fetchall()
        return {"users": [_user_view(db, r) for r in rows]}


@router.post("/users", status_code=201)
def admin_user_create(body: UserIn):
    _check_password(body.password, required=True)
    pw_hash, salt = security.hash_password(body.password)
    with get_db() as db:
        try:
            cur = db.execute(
                "INSERT INTO admins (username, pw_hash, pw_salt, role) "
                "VALUES (?, ?, ?, ?)",
                (body.username.strip(), pw_hash, salt, body.role),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(400, "Bunday login allaqachon bor")
        security.set_user_regions(
            db, cur.lastrowid, body.regions if body.role == "operator" else [])
        row = db.execute("SELECT id, username, role, created_at FROM admins "
                         "WHERE id = ?", (cur.lastrowid,)).fetchone()
        return _user_view(db, row)


@router.put("/users/{user_id}")
def admin_user_update(user_id: int, body: UserIn):
    _check_password(body.password, required=False)
    with get_db() as db:
        old = db.execute("SELECT * FROM admins WHERE id = ?",
                         (user_id,)).fetchone()
        if old is None:
            raise HTTPException(404, "Foydalanuvchi topilmadi")
        if old["role"] == "admin" and body.role != "admin":
            admins = db.execute("SELECT COUNT(*) FROM admins "
                                "WHERE role = 'admin'").fetchone()[0]
            if admins <= 1:
                raise HTTPException(400, "Oxirgi adminni operator qilib bo'lmaydi")
        try:
            db.execute("UPDATE admins SET username = ?, role = ? WHERE id = ?",
                       (body.username.strip(), body.role, user_id))
        except sqlite3.IntegrityError:
            raise HTTPException(400, "Bunday login allaqachon bor")
        if body.password:
            pw_hash, salt = security.hash_password(body.password)
            db.execute("UPDATE admins SET pw_hash = ?, pw_salt = ? WHERE id = ?",
                       (pw_hash, salt, user_id))
            # Parol almashdi — eski sessiyalar bekor.
            db.execute("DELETE FROM sessions WHERE admin_id = ?", (user_id,))
        security.set_user_regions(
            db, user_id, body.regions if body.role == "operator" else [])
        row = db.execute("SELECT id, username, role, created_at FROM admins "
                         "WHERE id = ?", (user_id,)).fetchone()
        return _user_view(db, row)


@router.delete("/users/{user_id}", status_code=204)
def admin_user_delete(user_id: int, me=Depends(require_admin)):
    if me["id"] == user_id:
        raise HTTPException(400, "O'z hisobingizni o'chira olmaysiz")
    with get_db() as db:
        row = db.execute("SELECT role FROM admins WHERE id = ?",
                         (user_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "Foydalanuvchi topilmadi")
        if row["role"] == "admin":
            admins = db.execute("SELECT COUNT(*) FROM admins "
                                "WHERE role = 'admin'").fetchone()[0]
            if admins <= 1:
                raise HTTPException(400, "Oxirgi admin o'chirilmaydi")
        db.execute("DELETE FROM admins WHERE id = ?", (user_id,))
        db.execute("DELETE FROM sessions WHERE admin_id = ?", (user_id,))
        db.execute("DELETE FROM user_regions WHERE user_id = ?", (user_id,))


# ---------- MediaMTX tugunlari va holat (mikroservisga proxy) ----------

@router.get("/nodes")
def admin_nodes():
    """Tugunlar ro'yxati: kameralar soni, salomatlik va ish ko'rsatkichlari."""
    return nigoh.proxy("GET", "/api/v1/admin/nodes")


@router.post("/nodes", status_code=201)
async def admin_node_create(request: Request):
    return nigoh.proxy("POST", "/api/v1/admin/nodes",
                       body=await request.json())


@router.put("/nodes/{node_id}")
async def admin_node_update(node_id: int, request: Request):
    return nigoh.proxy("PUT", f"/api/v1/admin/nodes/{node_id}",
                       body=await request.json())


@router.delete("/nodes/{node_id}", status_code=204)
def admin_node_delete(node_id: int):
    return nigoh.proxy("DELETE", f"/api/v1/admin/nodes/{node_id}")


@router.get("/nodes/{node_id}/config")
def admin_node_config(node_id: int):
    """Tugun mashinasiga qo'yiladigan tayyor mediamtx.yml (matn)."""
    r = nigoh.request("GET", f"/api/v1/admin/nodes/{node_id}/config")
    if r.status_code >= 400:
        raise HTTPException(r.status_code, "Tugun topilmadi")
    return Response(r.content, media_type="text/plain; charset=utf-8")


@router.get("/status")
def admin_status():
    """Tizim salomatligi bir qarashda — mikroservisdan, ustiga shu
    tizimning o'z kuzatuv ko'rsatkichi (dashboard tarixi yozilyaptimi)."""
    data = nigoh.get_json("/api/v1/admin/status")
    data["asosiy_tizim"] = {"poll": nigoh.poll_stats()}
    return data


@router.get("/events")
def admin_events(limit: int = 100):
    """Media qatlamining so'nggi hodisalari (mikroservis jurnali)."""
    return nigoh.proxy("GET", "/api/v1/admin/events", params={"limit": limit})


@router.post("/mediamtx/sync")
def admin_sync():
    """Mikroservisdagi MediaMTX konfiguratsiyasini qayta yozdiradi."""
    return nigoh.proxy("POST", "/api/v1/admin/mediamtx/sync")


@router.get("/mediamtx/config")
def admin_config_preview():
    return nigoh.proxy("GET", "/api/v1/admin/mediamtx/config")
