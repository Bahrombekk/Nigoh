"""Nigoh — foydalanuvchi kamera guruhlari API'si (/groups).

Foydalanuvchi o'ziga kerakli kameralarni tanlab, nom berib saqlaydi
(xaritada filtr, ro'yxatda "Guruhlar", devorda to'plam).

Ruxsatlar:
  * ko'rish — o'z guruhlari va umumiy (`shared`) guruhlar; admin va API
    kalit — hammasi;
  * o'zgartirish/o'chirish — egasi yoki admin (API kalit admin hisoblanadi);
  * kamera qo'shish — faqat foydalanuvchi ko'ra oladigan kameralar (operator —
    o'z hududlari); begonasi — 403, mavjud bo'lmagani — 422;
  * javobdagi `camera_ids` ham ko'ruvchining hududlari bilan cheklanadi:
    admin yaratgan umumiy guruhda operator faqat o'z kameralarini ko'radi,
    qolganlari `hidden` da soni bilan.

Endpointlar (require_user — mehmonga yopiq; prefiks /api/v1, eski /api):
    GET    /api/v1/groups                    ko'rinadigan guruhlar
    POST   /api/v1/groups                    yangi guruh {name, color?, shared?, camera_ids?}
    PATCH  /api/v1/groups/{id}               {name?, color?, shared?}
    DELETE /api/v1/groups/{id}               204
    POST   /api/v1/groups/{id}/cameras       {camera_ids, mode: add | remove | set}

Har guruh: id, name, color, shared, owner_name, mine (o'zinikimi),
can_edit, camera_ids (tartib bilan), hidden (ko'rinmaydigan a'zolar soni).

Tarkibi:
    router              APIRouter(prefix="/groups", tags=["groups"])
    GroupIn, GroupPatch, MembersIn   so'rov modellari
    MAX_GROUPS, MAX_MEMBERS          egadagi guruhlar va guruhdagi kameralar chegarasi

Ishlatadi: database (groups, cameras), users.access.
Kim ishlatadi: app/factory.py (require_user bilan), tests/test_groups.py.
"""
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from database import UniqueViolation, cameras, get_db, groups
from users.access import allowed_areas, api_key_ok, current_user

router = APIRouter(prefix="/groups", tags=["groups"])

MAX_GROUPS = 200            # bitta egada
MAX_MEMBERS = 5000          # bitta guruhda
COLOR = r"^(#[0-9a-fA-F]{6})?$"


class GroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    color: str = Field(default="", pattern=COLOR)
    shared: bool = False
    camera_ids: list[int] = Field(default_factory=list, max_length=MAX_MEMBERS)


class GroupPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    color: str | None = Field(default=None, pattern=COLOR)
    shared: bool | None = None


class MembersIn(BaseModel):
    camera_ids: list[int] = Field(max_length=MAX_MEMBERS)
    mode: Literal["add", "remove", "set"] = "add"


def _who(request: Request) -> tuple[int | None, bool]:
    """(foydalanuvchi id, admin). API kalit — egasiz admin."""
    if api_key_ok(request):
        return None, True
    user = current_user(request)
    if user is None:                       # require_user o'tkazmaydi, baribir
        raise HTTPException(401, "Avval tizimga kiring")
    return user["id"], user["role"] == "admin"


def _can_see(row, uid, admin) -> bool:
    return admin or row["shared"] or row["owner_id"] == uid


def _can_edit(row, uid, admin) -> bool:
    return admin or (uid is not None and row["owner_id"] == uid)


def _out(row, uid, admin, visible: set[int] | None) -> dict:
    ids = list(row["camera_ids"] or [])
    shown = ids if visible is None else [i for i in ids if i in visible]
    return {
        "id": row["id"], "name": row["name"], "color": row["color"], "shared": row["shared"],
        "owner_name": row["owner_name"] or ("API" if row["owner_id"] is None else ""),
        "mine": row["owner_id"] == uid,
        "can_edit": _can_edit(row, uid, admin),
        "camera_ids": shown, "hidden": len(ids) - len(shown),
        "updated_at": row["updated_at"],
    }


def _visible_ids(db, request: Request) -> set[int] | None:
    """Ko'ruvchi ko'ra oladigan kamera id'lari; None — cheklov yo'q."""
    areas = allowed_areas(request)
    if areas is None:
        return None
    allowed = set(areas)
    return {r["id"] for r in cameras.list_all(db) if r["admin_area_id"] in allowed}


def _load(db, group_id: int, uid, admin, *, edit: bool):
    row = groups.get(db, group_id)
    if row is None or not _can_see(row, uid, admin):
        raise HTTPException(404, "Guruh topilmadi")
    if edit and not _can_edit(row, uid, admin):
        raise HTTPException(403, "Bu guruhni faqat egasi o'zgartira oladi")
    return row


def _check_cameras(db, request: Request, ids: list[int]) -> list[int]:
    """Takrorlarni olib tashlaydi (tartib saqlanadi) va ruxsatni tekshiradi."""
    ids = list(dict.fromkeys(ids))
    if not ids:
        return ids
    rows = {r["id"]: r for r in cameras.list_all(db) if r["id"] in set(ids)}
    missing = [i for i in ids if i not in rows]
    if missing:
        raise HTTPException(422, f"Kamera topilmadi: {missing[:10]}")
    areas = allowed_areas(request)
    if areas is not None:
        allowed = set(areas)
        foreign = [i for i in ids if rows[i]["admin_area_id"] not in allowed]
        if foreign:
            raise HTTPException(403, "Ba'zi kameralar sizning hududingizda emas")
    return ids


@router.get("")
def list_groups(request: Request):
    """Ko'rinadigan guruhlar: o'zingizniki oldin, keyin umumiylar."""
    uid, admin = _who(request)
    with get_db() as db:
        rows = groups.visible(db, uid, admin)
        visible = _visible_ids(db, request)
    return {"groups": [_out(r, uid, admin, visible) for r in rows]}


@router.post("", status_code=201)
def create_group(body: GroupIn, request: Request):
    uid, admin = _who(request)
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "Guruh nomi bo'sh")
    with get_db() as db:
        if groups.count_owned(db, uid) >= MAX_GROUPS:
            raise HTTPException(409, f"Guruhlar soni chegarasi: {MAX_GROUPS}")
        ids = _check_cameras(db, request, body.camera_ids)
        try:
            gid = groups.create(db, uid, name, body.color, body.shared)
        except UniqueViolation:
            raise HTTPException(409, f"\"{name}\" nomli guruh allaqachon bor") from None
        groups.add_members(db, gid, ids)
        row = groups.get(db, gid)
        visible = _visible_ids(db, request)
    return _out(row, uid, admin, visible)


@router.patch("/{group_id}")
def update_group(group_id: int, body: GroupPatch, request: Request):
    uid, admin = _who(request)
    if body.name is not None and not body.name.strip():
        raise HTTPException(422, "Guruh nomi bo'sh")
    with get_db() as db:
        _load(db, group_id, uid, admin, edit=True)
        try:
            groups.update(db, group_id, name=body.name, color=body.color, shared=body.shared)
        except UniqueViolation:
            raise HTTPException(409, f"\"{body.name.strip()}\" nomli guruh allaqachon bor") from None
        row = groups.get(db, group_id)
        visible = _visible_ids(db, request)
    return _out(row, uid, admin, visible)


@router.delete("/{group_id}", status_code=204)
def delete_group(group_id: int, request: Request):
    uid, admin = _who(request)
    with get_db() as db:
        _load(db, group_id, uid, admin, edit=True)
        groups.delete(db, group_id)
    return Response(status_code=204)


@router.post("/{group_id}/cameras")
def group_cameras(group_id: int, body: MembersIn, request: Request):
    """A'zolar: add — oxiriga qo'shish, remove — chiqarish, set — to'liq almashtirish.

    `set` da operator ko'rmaydigan a'zolar (admin qo'shgan) o'chib ketmaydi —
    ular ro'yxat oxirida saqlanadi.
    """
    uid, admin = _who(request)
    with get_db() as db:
        row = _load(db, group_id, uid, admin, edit=True)
        if body.mode == "remove":
            groups.remove_members(db, group_id, list(set(body.camera_ids)))
        else:
            ids = _check_cameras(db, request, body.camera_ids)
            if body.mode == "add":
                current = len(row["camera_ids"] or [])
                if current + len(ids) > MAX_MEMBERS:
                    raise HTTPException(409, f"Guruhda {MAX_MEMBERS} tadan ko'p kamera bo'lmaydi")
                groups.add_members(db, group_id, ids)
            else:
                visible = _visible_ids(db, request)
                keep = [] if visible is None else [
                    i for i in (row["camera_ids"] or []) if i not in visible]
                groups.set_members(db, group_id, ids + [i for i in keep if i not in ids])
        row = groups.get(db, group_id)
        visible = _visible_ids(db, request)
    return _out(row, uid, admin, visible)
