"""Nigoh — super-admin autentifikatsiyasi va kamera parollarini shifrlash.

Kamera parollari MediaMTX uchun ochiq holda kerak bo'ladi, shuning uchun
ular qaytariladigan shifr (Fernet) bilan saqlanadi. Kalit `secret.key`
faylida turadi — bu fayl bazaning o'zi kabi maxfiy.

Admin paroli esa qaytarilmaydigan hash (scrypt) sifatida saqlanadi.
"""
import base64
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

# Loyiha ildizi — kalit fayli ildizda qoladi (paket ko'chsa ham o'zgarmaydi).
BASE_DIR = Path(__file__).resolve().parent.parent
KEY_PATH = BASE_DIR / "secret.key"

SESSION_COOKIE = "nigoh_session"
SESSION_HOURS = 12


# ---------- kamera parollarini shifrlash ----------

def _load_key() -> bytes:
    if KEY_PATH.exists():
        return KEY_PATH.read_bytes().strip()
    key = Fernet.generate_key()
    KEY_PATH.write_bytes(key)
    try:  # faqat egasi o'qiy olsin (Windows'da e'tiborsiz qoldiriladi)
        os.chmod(KEY_PATH, 0o600)
    except OSError:
        pass
    return key


_fernet = Fernet(_load_key())


def encrypt(plain: str) -> str:
    return _fernet.encrypt(plain.encode()).decode()


def decrypt(token: str | None) -> str:
    if not token:
        return ""
    try:
        return _fernet.decrypt(token.encode()).decode()
    except InvalidToken:
        # Kalit almashtirilgan yoki yozuv buzilgan.
        return ""


# ---------- admin paroli ----------

def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.scrypt(
        password.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1, dklen=32
    )
    return base64.b64encode(digest).decode(), salt


def verify_password(password: str, pw_hash: str, salt: str) -> bool:
    candidate, _ = hash_password(password, salt)
    return hmac.compare_digest(candidate, pw_hash)


# ---------- sessiyalar ----------

def create_session(db, admin_id: int) -> str:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(hours=SESSION_HOURS)
    db.execute(
        "INSERT INTO sessions (token, admin_id, expires_at) VALUES (?, ?, ?)",
        (token, admin_id, expires.isoformat()),
    )
    return token


def session_admin(db, token: str | None):
    """Yaroqli sessiya bo'lsa admin yozuvini, aks holda None qaytaradi."""
    if not token:
        return None
    row = db.execute(
        "SELECT s.expires_at, a.id, a.username "
        "FROM sessions s JOIN admins a ON a.id = s.admin_id "
        "WHERE s.token = ?",
        (token,),
    ).fetchone()
    if row is None:
        return None
    if datetime.fromisoformat(row["expires_at"]) < datetime.now(timezone.utc):
        db.execute("DELETE FROM sessions WHERE token = ?", (token,))
        return None
    return row


def delete_session(db, token: str | None) -> None:
    if token:
        db.execute("DELETE FROM sessions WHERE token = ?", (token,))


def purge_expired_sessions(db) -> None:
    db.execute(
        "DELETE FROM sessions WHERE expires_at < ?",
        (datetime.now(timezone.utc).isoformat(),),
    )


# ---------- admin yaratish ----------

def ensure_admin(db) -> str | None:
    """Birinchi ishga tushishda super-admin yaratadi.

    Parol ADMIN_PAROL muhit o'zgaruvchisidan olinadi; berilmagan bo'lsa
    tasodifiy parol yaratiladi va konsolga chiqarish uchun qaytariladi.
    """
    if db.execute("SELECT COUNT(*) FROM admins").fetchone()[0] > 0:
        return None

    username = os.environ.get("ADMIN_LOGIN", "admin")
    password = os.environ.get("ADMIN_PAROL")
    generated = password is None
    if generated:
        password = secrets.token_urlsafe(9)

    pw_hash, salt = hash_password(password)
    db.execute(
        "INSERT INTO admins (username, pw_hash, pw_salt) VALUES (?, ?, ?)",
        (username, pw_hash, salt),
    )
    return password if generated else None


def set_password(db, username: str, password: str) -> bool:
    pw_hash, salt = hash_password(password)
    cur = db.execute(
        "UPDATE admins SET pw_hash = ?, pw_salt = ? WHERE username = ?",
        (pw_hash, salt, username),
    )
    if cur.rowcount == 0:
        db.execute(
            "INSERT INTO admins (username, pw_hash, pw_salt) VALUES (?, ?, ?)",
            (username, pw_hash, salt),
        )
    # Parol almashgach eski sessiyalar bekor qilinadi.
    db.execute(
        "DELETE FROM sessions WHERE admin_id IN (SELECT id FROM admins WHERE username = ?)",
        (username,),
    )
    return True
