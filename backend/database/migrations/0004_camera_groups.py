"""4-migratsiya: foydalanuvchi kamera guruhlari.

Operator o'ziga kerakli kameralarni (bir uchastka, bir stansiya, "kechasi
kuzatiladiganlar" ...) tanlab, nom berib saqlaydi. Guruh xaritada filtr,
chap ro'yxatda "Guruhlar" yorlig'i va video devorda to'plam sifatida
ishlatiladi.

Egalik: guruh yaratgan foydalanuvchiniki (`owner_id`); API kalit bilan
yaratilgani — egasiz (NULL). `shared` — boshqa foydalanuvchilar ham ko'radi
(o'zgartira olmaydi; admin o'zgartira oladi). Foydalanuvchi o'chirilsa
uning guruhlari ham o'chadi; kamera o'chirilsa guruhlardan chiqadi.

A'zolar tartibi (`position`) saqlanadi — devorda kameralar shu tartibda
chiqadi.

Tarkibi:
    VERSION = 4
    apply(db)                   camera_groups, camera_group_members, indekslar

Jadvallar: camera_groups, camera_group_members
Kim ishlatadi: database/migrations/__init__.py (load) -> database/schema.py;
jadvallarni repositories/groups.py o'qiydi/yozadi.
"""

VERSION = 4


def apply(db) -> None:
    db.execute("""
        CREATE TABLE camera_groups (
            id          SERIAL PRIMARY KEY,
            owner_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
            name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
            color       TEXT NOT NULL DEFAULT '' CHECK (color = '' OR color ~ '^#[0-9a-fA-F]{6}$'),
            shared      BOOLEAN NOT NULL DEFAULT false,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )""")
    # Bitta egada bir xil nomli ikki guruh bo'lmasin (katta-kichik harf farqsiz).
    # Egasiz (API) guruhlar uchun ham — COALESCE bilan.
    db.execute("CREATE UNIQUE INDEX camera_groups_owner_name "
               "ON camera_groups (COALESCE(owner_id, 0), lower(btrim(name)))")
    db.execute("""
        CREATE TABLE camera_group_members (
            group_id    INTEGER NOT NULL REFERENCES camera_groups(id) ON DELETE CASCADE,
            camera_id   INTEGER NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
            position    INTEGER NOT NULL DEFAULT 0,
            added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (group_id, camera_id)
        )""")
    db.execute("CREATE INDEX camera_group_members_camera ON camera_group_members (camera_id)")
    db.execute("COMMENT ON TABLE camera_groups IS "
               "'Foydalanuvchi kamera guruhlari; shared - boshqalar ham ko''radi'")
