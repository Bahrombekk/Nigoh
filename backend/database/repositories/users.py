"""Foydalanuvchilar repozitoriysi: foydalanuvchilar, sessiyalar va operator ruxsatlari.

Parol xeshlash va token yaratish — core/security.py da (kriptografiya);
bu modul faqat saqlash va o'qish bilan shug'ullanadi. Sessiyada tokenning
o'zi emas, xeshi saqlanadi. 'admin' hammasini boshqaradi, 'operator' faqat
o'ziga biriktirilgan hududlarni (va ularning ichidagilarni) ko'radi.

Tarkibi:
    UserRepository              foydalanuvchilar va sessiyalar (holatsiz, `db` oladi)
      foydalanuvchilar:
        .count(db, role)        soni (rol bo'yicha ham)
        .get(db, user_id)       ochiq maydonlar (parol xeshisiz)
        .get_for_login(db, username)  parol xeshi bilan; faol bo'lmagan kira olmaydi
        .list_all(db)           hammasi, id tartibida
        .create(db, username, pw_hash, pw_salt, role, organization_id)  takror
                                login — UniqueViolation (chaqiruvchi savepoint'da ushlaydi)
        .update_identity(db, user_id, username, role)
        .set_password(db, user_id, pw_hash, pw_salt)  + barcha sessiyalari bekor
        .id_by_username(db, username)
        .delete(db, user_id)    sessiya va ruxsatlar ON DELETE CASCADE bilan ketadi
        .mark_login(db, user_id)  last_login_at = now()
        .lock_admin_changes(db)  admin rolini o'zgartiruvchi tranzaksiyalar navbati
                                (advisory lock): bir vaqtda ikki adminni tushirgan
                                ikki so'rov tizimni adminsiz qoldirardi
      profil (v3):
        .prefs(db, user_id) / .merge_prefs(db, user_id, patch)  interfeys sozlamalari
        .password_row(db, user_id)  joriy parolni tekshirish uchun xesh va tuz
        .set_password_keep(db, user_id, hash, salt, keep_token_hash)  o'zi almashtirgan
                                parol: joriy sessiyadan boshqalari bekor
        .notif_read_before(db, user_id) / .set_notif_read_before(db, user_id, at)
                                "hammasini o'qildi" belgisi (bildirishnomalar)
      operator va kuzatuvchi hududlari (REGION_ROLES):
        .region_names(db, user_id)  biriktirilgan hudud nomlari
        .allowed_area_ids(db, user_id)  ko'ra oladigan hududlar (ichkilari bilan)
        .set_regions(db, user_id, names)  hududlarni almashtiradi; topilmagan nomlar
                                bo'lsa hech narsa yozilmaydi va ular qaytadi
      sessiyalar:
        .add_session(db, token_hash, user_id, expires_at, ip, user_agent)
        .session_user(db, token_hash)  sessiya egasi (faol foydalanuvchi)
        .delete_session(db, token_hash)
        .purge_expired_sessions(db, now)
    DEFAULT_ORGANIZATION_ID     asosiy tashkilot (1)

Jadvallar: users, sessions, user_admin_areas (+ admin_areas)
Ishlatadi: database.repositories.areas (ids_by_names, with_descendants)
Kim ishlatadi: core/security.py (sessiyalar, parol, birinchi admin),
users/admin_api.py (boshqaruv), users/api.py (kirish, region_names),
users/access.py (allowed_area_ids), tests/test_roles.py.
"""
from __future__ import annotations

from datetime import datetime

from psycopg.types.json import Jsonb

from database.repositories import areas

DEFAULT_ORGANIZATION_ID = 1
# Hududga bog'langan rollar: operator va kuzatuvchi (viewer) faqat biriktirilgan
# hududlarni ko'radi; admin — hammasini.
REGION_ROLES = ("operator", "viewer")
_PUBLIC = "id, username, role, full_name, is_active, organization_id, created_at, last_login_at"


# ---------- foydalanuvchilar ----------


# ---------- operator hududlari ----------


# ---------- sessiyalar ----------


class UserRepository:
    """Foydalanuvchilar, sessiyalar va operator hududlari.

    Holatsiz: har metod birinchi argument sifatida ulanishni (`db`) oladi —
    tranzaksiya chegarasini chaqiruvchi `with get_db() as db:` bilan belgilaydi.
    """

    DEFAULT_ORGANIZATION_ID = DEFAULT_ORGANIZATION_ID

    def count(self, db, role: str | None = None) -> int:
        if role is None:
            return db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        return db.execute("SELECT COUNT(*) FROM users WHERE role = %s", (role,)).fetchone()[0]

    def get(self, db, user_id: int):
        return db.execute(f"SELECT {_PUBLIC} FROM users WHERE id = %s", (user_id,)).fetchone()

    def get_for_login(self, db, username: str):
        """Kirish uchun: parol xeshi bilan. Faol bo'lmagan foydalanuvchi kira olmaydi."""
        return db.execute(
            "SELECT id, username, pw_hash, pw_salt, role FROM users "
            "WHERE username = %s AND is_active", (username,)).fetchone()

    def list_all(self, db) -> list:
        return db.execute(f"SELECT {_PUBLIC} FROM users ORDER BY id").fetchall()

    def create(self, db, username: str, pw_hash: str, pw_salt: str, role: str = "admin",
               organization_id: int = DEFAULT_ORGANIZATION_ID):
        """Takror login — UniqueViolation (chaqiruvchi savepoint ichida ushlaydi)."""
        return db.execute(
            f"INSERT INTO users (username, pw_hash, pw_salt, role, organization_id) "
            f"VALUES (%s, %s, %s, %s, %s) RETURNING {_PUBLIC}",
            (username, pw_hash, pw_salt, role, organization_id)).fetchone()

    def update_identity(self, db, user_id: int, username: str, role: str,
                        full_name: str | None = None, is_active: bool | None = None) -> None:
        # full_name: None — o'zgarmasin, "" — tozalansin (bazada bo'sh qator emas, NULL).
        db.execute("UPDATE users SET username = %s, role = %s, "
                   "full_name = CASE WHEN %s::text IS NULL THEN full_name ELSE NULLIF(%s, '') END, "
                   "is_active = COALESCE(%s, is_active) WHERE id = %s",
                   (username, role, full_name, full_name, is_active, user_id))
        if is_active is False:            # bloklangan — ochiq sessiyalari ham yopiladi
            db.execute("DELETE FROM sessions WHERE user_id = %s", (user_id,))

    def count_active_admins(self, db, exclude_id: int | None = None) -> int:
        """Faol (bloklanmagan) adminlar soni — oxirgisini bloklab bo'lmasin."""
        return db.execute("SELECT count(*) FROM users WHERE role = 'admin' AND is_active "
                          "AND id IS DISTINCT FROM %s", (exclude_id,)).fetchone()[0]

    def set_password(self, db, user_id: int, pw_hash: str, pw_salt: str) -> None:
        """Parol almashadi va shu foydalanuvchining barcha sessiyalari bekor."""
        db.execute("UPDATE users SET pw_hash = %s, pw_salt = %s WHERE id = %s",
                   (pw_hash, pw_salt, user_id))
        db.execute("DELETE FROM sessions WHERE user_id = %s", (user_id,))

    def id_by_username(self, db, username: str) -> int | None:
        row = db.execute("SELECT id FROM users WHERE username = %s", (username,)).fetchone()
        return row[0] if row else None

    def delete(self, db, user_id: int) -> None:
        """Sessiyalar va ruxsatlar FOREIGN KEY ... ON DELETE CASCADE bilan ketadi."""
        db.execute("DELETE FROM users WHERE id = %s", (user_id,))

    def mark_login(self, db, user_id: int) -> None:
        db.execute("UPDATE users SET last_login_at = now() WHERE id = %s", (user_id,))

    def prefs(self, db, user_id: int) -> dict:
        """Interfeys sozlamalari (users.prefs); foydalanuvchi yo'q bo'lsa {}."""
        row = db.execute("SELECT prefs FROM users WHERE id = %s", (user_id,)).fetchone()
        return dict(row[0] or {}) if row else {}

    def merge_prefs(self, db, user_id: int, patch: dict) -> dict:
        """Qisman obyektni mavjudiga birlashtiradi (yuqori daraja kalitlari, `||`);
        qaytadi — to'liq prefs."""
        row = db.execute("UPDATE users SET prefs = prefs || %s WHERE id = %s RETURNING prefs",
                         (Jsonb(patch), user_id)).fetchone()
        return dict(row[0] or {}) if row else {}

    def password_row(self, db, user_id: int):
        """Parolni almashtirishdan oldin joriysini tekshirish uchun: xesh va tuz."""
        return db.execute("SELECT id, username, pw_hash, pw_salt FROM users WHERE id = %s",
                          (user_id,)).fetchone()

    def set_password_keep(self, db, user_id: int, pw_hash: str, pw_salt: str,
                          keep_token_hash: str | None) -> None:
        """Foydalanuvchi o'zi almashtirgan parol: boshqa sessiyalari bekor, joriysi qoladi."""
        db.execute("UPDATE users SET pw_hash = %s, pw_salt = %s WHERE id = %s",
                   (pw_hash, pw_salt, user_id))
        db.execute("DELETE FROM sessions WHERE user_id = %s AND token IS DISTINCT FROM %s",
                   (user_id, keep_token_hash))

    def notif_read_before(self, db, user_id: int) -> datetime | None:
        row = db.execute("SELECT notif_read_before FROM users WHERE id = %s", (user_id,)).fetchone()
        return row[0] if row else None

    def set_notif_read_before(self, db, user_id: int, at: datetime) -> None:
        """"Hammasini o'qildi": shu vaqtgacha bo'lganlar o'qilgan; alohida belgilar keraksiz."""
        db.execute("UPDATE users SET notif_read_before = %s WHERE id = %s", (at, user_id))
        db.execute("DELETE FROM notification_reads WHERE user_id = %s", (user_id,))

    def region_names(self, db, user_id: int) -> list[str]:
        return [r[0] for r in db.execute(
            "SELECT a.name FROM user_admin_areas u JOIN admin_areas a ON a.id = u.admin_area_id "
            "WHERE u.user_id = %s ORDER BY a.name", (user_id,))]

    def allowed_area_ids(self, db, user_id: int) -> list[int]:
        """Operator ko'ra oladigan hududlar: biriktirilganlar va ularning ichidagilari."""
        own = [r[0] for r in db.execute(
            "SELECT admin_area_id FROM user_admin_areas WHERE user_id = %s", (user_id,))]
        return areas.with_descendants(db, own)

    def set_regions(self, db, user_id: int, names: list[str]) -> list[str]:
        """Operatorga hududlar biriktiradi. Qaytadi: topilmagan nomlar (bo'lsa —
        hech narsa yozilmaydi, chaqiruvchi 400 qaytaradi)."""
        found, unknown = areas.ids_by_names(db, names)
        if unknown:
            return unknown
        db.execute("DELETE FROM user_admin_areas WHERE user_id = %s", (user_id,))
        db.executemany("INSERT INTO user_admin_areas (user_id, admin_area_id) VALUES (%s, %s) "
                       "ON CONFLICT DO NOTHING", [(user_id, a) for a in found])
        return []

    def add_session(self, db, token_hash: str, user_id: int, expires_at: datetime,
                    ip: str | None = None, user_agent: str | None = None) -> None:
        db.execute(
            "INSERT INTO sessions (token, user_id, expires_at, ip, user_agent) "
            "VALUES (%s, %s, %s, %s, %s)",
            (token_hash, user_id, expires_at, ip or None, (user_agent or "")[:300] or None))

    def session_user(self, db, token_hash: str):
        return db.execute(
            "SELECT s.expires_at, u.id, u.username, u.role, u.organization_id, u.full_name "
            "FROM sessions s JOIN users u ON u.id = s.user_id "
            "WHERE s.token = %s AND u.is_active", (token_hash,)).fetchone()

    def delete_session(self, db, token_hash: str) -> None:
        db.execute("DELETE FROM sessions WHERE token = %s", (token_hash,))

    def purge_expired_sessions(self, db, now: datetime) -> None:
        db.execute("DELETE FROM sessions WHERE expires_at < %s", (now,))

    def lock_admin_changes(self, db) -> None:
        """Admin rolini o'zgartiruvchi tranzaksiyalarni navbatga qo'yadi.

        Ikki so'rov bir vaqtda ikki adminni tushirsa, sanoq ikkalasida ham 2
        chiqib, tizim adminsiz qolardi.
        """
        db.execute("SELECT pg_advisory_xact_lock(hashtext('nigoh_admin_count'))")
