"""Foydalanuvchi kamera guruhlari repozitoriysi — camera_groups, camera_group_members.

Guruh egasiniki (`owner_id`; API kalit bilan yaratilgani — NULL). `shared`
guruhni boshqalar ham ko'radi. Ruxsat (kim o'zgartira oladi, operator
qaysi kameralarni ko'radi) bu yerda emas — groups/api.py da; bu yerda faqat
SQL.

A'zolar `position` bo'yicha tartiblanadi; qo'shilgan kameralar oxiriga
tushadi, mavjudlari takrorlanmaydi. Savatdagi (yumshoq o'chirilgan) kamera
`camera_ids` da ko'rinmaydi, tiklansa — o'z joyiga qaytadi.

Tarkibi:
    GroupRepository                 guruhlar (holatsiz, `db` oladi)
        .visible(db, user_id, admin)    o'zining + umumiy guruhlar (admin — hammasi),
                                        a'zolar ro'yxati bilan (camera_ids)
        .get(db, group_id)              bitta guruh (a'zolari bilan) yoki None
        .create(db, owner_id, name, color, shared) -> id
        .update(db, group_id, name=, color=, shared=)   berilgan maydonlar
        .delete(db, group_id)
        .add_members(db, group_id, camera_ids)     oxiriga qo'shadi -> qo'shilganlar soni
        .remove_members(db, group_id, camera_ids)  -> chiqarilganlar soni
        .set_members(db, group_id, camera_ids)     tartibi bilan to'liq almashtiradi
        .count_owned(db, owner_id)      egadagi guruhlar soni (chegara uchun)
        .clear(db)                      hammasini o'chiradi (testlar)

Jadvallar: camera_groups, camera_group_members (0004_camera_groups.py)
Kim ishlatadi: groups/api.py, tests/test_groups.py.
"""
from __future__ import annotations

_SELECT = """
    SELECT g.id, g.owner_id, u.username AS owner_name, g.name, g.color, g.shared,
           g.created_at, g.updated_at,
           COALESCE(array_agg(m.camera_id ORDER BY m.position, m.added_at)
                    FILTER (WHERE m.camera_id IS NOT NULL), '{}') AS camera_ids
    FROM camera_groups g
    LEFT JOIN users u ON u.id = g.owner_id
    LEFT JOIN camera_group_members m ON m.group_id = g.id
          AND EXISTS (SELECT 1 FROM cameras c WHERE c.id = m.camera_id AND c.deleted_at IS NULL)
"""
_GROUP = " GROUP BY g.id, u.username"


class GroupRepository:
    """Kamera guruhlari (camera_groups + camera_group_members)."""

    def visible(self, db, user_id: int | None, admin: bool) -> list:
        """Foydalanuvchiga ko'rinadigan guruhlar: o'ziniki + umumiylar.

        Admin hammasini ko'radi (boshqaruv uchun). Tartib: o'ziniki oldin,
        keyin nom bo'yicha.
        """
        if admin:
            where, params = "", []
        else:
            where, params = " WHERE g.owner_id IS NOT DISTINCT FROM %s OR g.shared", [user_id]
        return db.execute(
            _SELECT + where + _GROUP +
            " ORDER BY (g.owner_id IS NOT DISTINCT FROM %s) DESC, lower(g.name), g.id",
            params + [user_id]).fetchall()

    def get(self, db, group_id: int):
        return db.execute(_SELECT + " WHERE g.id = %s" + _GROUP, (group_id,)).fetchone()

    def create(self, db, owner_id: int | None, name: str, color: str = "",
               shared: bool = False) -> int:
        return db.execute(
            "INSERT INTO camera_groups (owner_id, name, color, shared) "
            "VALUES (%s, %s, %s, %s) RETURNING id",
            (owner_id, name.strip(), color, shared)).fetchone()[0]

    def update(self, db, group_id: int, *, name: str | None = None,
               color: str | None = None, shared: bool | None = None) -> None:
        sets, params = [], []
        for column, value in (("name", name.strip() if name is not None else None),
                              ("color", color), ("shared", shared)):
            if value is not None:
                sets.append(f"{column} = %s")
                params.append(value)
        if not sets:
            return
        db.execute(f"UPDATE camera_groups SET {', '.join(sets)}, updated_at = now() "
                   "WHERE id = %s", params + [group_id])

    def delete(self, db, group_id: int) -> None:
        db.execute("DELETE FROM camera_groups WHERE id = %s", (group_id,))

    def add_members(self, db, group_id: int, camera_ids: list[int]) -> int:
        """Oxiriga qo'shadi (berilgan tartibda); mavjudlari o'z joyida qoladi."""
        if not camera_ids:
            return 0
        start = db.execute("SELECT COALESCE(max(position), -1) + 1 FROM camera_group_members "
                           "WHERE group_id = %s", (group_id,)).fetchone()[0]
        added = 0
        for i, camera_id in enumerate(camera_ids):
            added += db.execute(
                "INSERT INTO camera_group_members (group_id, camera_id, position) "
                "VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                (group_id, camera_id, start + i)).rowcount
        if added:
            self._touch(db, group_id)
        return added

    def remove_members(self, db, group_id: int, camera_ids: list[int]) -> int:
        if not camera_ids:
            return 0
        removed = db.execute("DELETE FROM camera_group_members WHERE group_id = %s "
                             "AND camera_id = ANY(%s)", (group_id, list(camera_ids))).rowcount
        if removed:
            self._touch(db, group_id)
        return removed

    def set_members(self, db, group_id: int, camera_ids: list[int]) -> None:
        """A'zolarni to'liq almashtiradi — berilgan tartib saqlanadi."""
        db.execute("DELETE FROM camera_group_members WHERE group_id = %s", (group_id,))
        for i, camera_id in enumerate(camera_ids):
            db.execute("INSERT INTO camera_group_members (group_id, camera_id, position) "
                       "VALUES (%s, %s, %s) ON CONFLICT DO NOTHING", (group_id, camera_id, i))
        self._touch(db, group_id)

    def count_owned(self, db, owner_id: int | None) -> int:
        return db.execute("SELECT count(*) FROM camera_groups WHERE owner_id IS NOT DISTINCT FROM %s",
                          (owner_id,)).fetchone()[0]

    def clear(self, db) -> None:
        db.execute("DELETE FROM camera_groups")

    def _touch(self, db, group_id: int) -> None:
        db.execute("UPDATE camera_groups SET updated_at = now() WHERE id = %s", (group_id,))
