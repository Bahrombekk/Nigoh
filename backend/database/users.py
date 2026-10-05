"""Foydalanuvchilar, sessiyalar va operator ruxsatlari.

Parol xeshlash va token yaratish — core/security.py da (kriptografiya);
bu modul faqat saqlash va o'qish bilan shug'ullanadi.
"""
from __future__ import annotations

from datetime import datetime

from . import areas

DEFAULT_ORGANIZATION_ID = 1
_PUBLIC = "id, username, role, full_name, is_active, organization_id, created_at, last_login_at"


# ---------- foydalanuvchilar ----------

def count(db, role: str | None = None) -> int:
    if role is None:
        return db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    return db.execute("SELECT COUNT(*) FROM users WHERE role = %s", (role,)).fetchone()[0]


def get(db, user_id: int):
    return db.execute(f"SELECT {_PUBLIC} FROM users WHERE id = %s", (user_id,)).fetchone()


def get_for_login(db, username: str):
    """Kirish uchun: parol xeshi bilan. Faol bo'lmagan foydalanuvchi kira olmaydi."""
    return db.execute(
        "SELECT id, username, pw_hash, pw_salt, role FROM users "
        "WHERE username = %s AND is_active", (username,)).fetchone()


def list_all(db) -> list:
    return db.execute(f"SELECT {_PUBLIC} FROM users ORDER BY id").fetchall()


def create(db, username: str, pw_hash: str, pw_salt: str, role: str = "admin",
           organization_id: int = DEFAULT_ORGANIZATION_ID):
    """Takror login — UniqueViolation (chaqiruvchi savepoint ichida ushlaydi)."""
    return db.execute(
        f"INSERT INTO users (username, pw_hash, pw_salt, role, organization_id) "
        f"VALUES (%s, %s, %s, %s, %s) RETURNING {_PUBLIC}",
        (username, pw_hash, pw_salt, role, organization_id)).fetchone()


def update_identity(db, user_id: int, username: str, role: str) -> None:
    db.execute("UPDATE users SET username = %s, role = %s WHERE id = %s",
               (username, role, user_id))


def set_password(db, user_id: int, pw_hash: str, pw_salt: str) -> None:
    """Parol almashadi va shu foydalanuvchining barcha sessiyalari bekor."""
    db.execute("UPDATE users SET pw_hash = %s, pw_salt = %s WHERE id = %s",
               (pw_hash, pw_salt, user_id))
    db.execute("DELETE FROM sessions WHERE user_id = %s", (user_id,))


def id_by_username(db, username: str) -> int | None:
    row = db.execute("SELECT id FROM users WHERE username = %s", (username,)).fetchone()
    return row[0] if row else None


def delete(db, user_id: int) -> None:
    """Sessiyalar va ruxsatlar FOREIGN KEY ... ON DELETE CASCADE bilan ketadi."""
    db.execute("DELETE FROM users WHERE id = %s", (user_id,))


def mark_login(db, user_id: int) -> None:
    db.execute("UPDATE users SET last_login_at = now() WHERE id = %s", (user_id,))


# ---------- operator hududlari ----------

def region_names(db, user_id: int) -> list[str]:
    return [r[0] for r in db.execute(
        "SELECT a.name FROM user_admin_areas u JOIN admin_areas a ON a.id = u.admin_area_id "
        "WHERE u.user_id = %s ORDER BY a.name", (user_id,))]


def allowed_area_ids(db, user_id: int) -> list[int]:
    """Operator ko'ra oladigan hududlar: biriktirilganlar va ularning ichidagilari."""
    own = [r[0] for r in db.execute(
        "SELECT admin_area_id FROM user_admin_areas WHERE user_id = %s", (user_id,))]
    return areas.with_descendants(db, own)


def set_regions(db, user_id: int, names: list[str]) -> list[str]:
    """Operatorga hududlar biriktiradi. Qaytadi: topilmagan nomlar (bo'lsa —
    hech narsa yozilmaydi, chaqiruvchi 400 qaytaradi)."""
    found, unknown = areas.ids_by_names(db, names)
    if unknown:
        return unknown
    db.execute("DELETE FROM user_admin_areas WHERE user_id = %s", (user_id,))
    db.executemany("INSERT INTO user_admin_areas (user_id, admin_area_id) VALUES (%s, %s) "
                   "ON CONFLICT DO NOTHING", [(user_id, a) for a in found])
    return []


# ---------- sessiyalar ----------

def add_session(db, token_hash: str, user_id: int, expires_at: datetime,
                ip: str | None = None, user_agent: str | None = None) -> None:
    db.execute(
        "INSERT INTO sessions (token, user_id, expires_at, ip, user_agent) "
        "VALUES (%s, %s, %s, %s, %s)",
        (token_hash, user_id, expires_at, ip or None, (user_agent or "")[:300] or None))


def session_user(db, token_hash: str):
    return db.execute(
        "SELECT s.expires_at, u.id, u.username, u.role, u.organization_id "
        "FROM sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.token = %s AND u.is_active", (token_hash,)).fetchone()


def delete_session(db, token_hash: str) -> None:
    db.execute("DELETE FROM sessions WHERE token = %s", (token_hash,))


def purge_expired_sessions(db, now: datetime) -> None:
    db.execute("DELETE FROM sessions WHERE expires_at < %s", (now,))


def lock_admin_changes(db) -> None:
    """Admin rolini o'zgartiruvchi tranzaksiyalarni navbatga qo'yadi.

    Ikki so'rov bir vaqtda ikki adminni tushirsa, sanoq ikkalasida ham 2
    chiqib, tizim adminsiz qolardi.
    """
    db.execute("SELECT pg_advisory_xact_lock(hashtext('nigoh_admin_count'))")
