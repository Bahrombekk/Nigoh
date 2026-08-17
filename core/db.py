"""Nigoh — ma'lumotlar bazasi: ulanish, sxema va migratsiya."""
import re
import sqlite3
from contextlib import contextmanager
from pathlib import Path

# Loyiha ildizi — bu fayl core/ ichida, ma'lumotlar esa ildizda turadi.
BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "cameras.db"

DEMO_STREAM = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
DEMO_CAMERAS = [
    ("Amir Temur xiyoboni", "Toshkent", 41.3111, 69.2797, DEMO_STREAM),
    ("Chorsu bozori", "Toshkent", 41.3266, 69.2345, DEMO_STREAM),
    ("Registon maydoni", "Samarqand", 39.6547, 66.9758, DEMO_STREAM),
    ("Labi Hovuz", "Buxoro", 39.7747, 64.4197, DEMO_STREAM),
    ("Farg'ona markazi", "Farg'ona", 40.3864, 71.7864, DEMO_STREAM),
    ("Urganch markazi", "Xorazm", 41.5500, 60.6333, DEMO_STREAM),
]

# Eski bazani yangi ustunlar bilan to'ldirish uchun (ALTER TABLE).
CAMERA_EXTRA_COLUMNS = {
    "slug": "TEXT",
    "ip": "TEXT",
    "port": "INTEGER NOT NULL DEFAULT 554",
    "username": "TEXT",
    "password_enc": "TEXT",
    "rtsp_path": "TEXT",
    "vendor": "TEXT",
    "enabled": "INTEGER NOT NULL DEFAULT 1",
    "note": "TEXT",
    "codec": "TEXT",                              # kameradan kelayotgan kodek
    "transcode": "INTEGER NOT NULL DEFAULT 0",    # H.264 ga o'girish kerakmi
    "always_on": "INTEGER NOT NULL DEFAULT 0",    # doim tayyor tursinmi
    "last_seen": "TEXT",                          # oxirgi marta onlayn bo'lgan vaqt (UTC)
}

# Kamera ko'payganda xaritani va ro'yxatni tez ushlab turadigan indekslar.
INDEXES = [
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_cameras_slug ON cameras(slug)",
    "CREATE INDEX IF NOT EXISTS idx_cameras_region ON cameras(region)",
    "CREATE INDEX IF NOT EXISTS idx_cameras_enabled ON cameras(enabled)",
    "CREATE INDEX IF NOT EXISTS idx_cameras_bbox ON cameras(lat, lng)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)",
]


@contextmanager
def get_db():
    # WAL rejimida yozish o'qishlarni qulflamaydi — fon kuzatuvi (health)
    # har daqiqa yozayotganda ham so'rovlar "database is locked" olmaydi.
    # timeout — baribir to'qnashilsa, xato o'rniga kutib beradi.
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=NORMAL")
    try:
        yield db
        db.commit()
    finally:
        db.close()


# ---------- slug ----------

# O'zbek lotin yozuvidagi maxsus belgilar va kirill harflari.
_TRANSLIT = {
    "ʻ": "", "ʼ": "", "'": "", "`": "", "‘": "", "’": "",
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo",
    "ж": "j", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "x", "ц": "s", "ч": "ch", "ш": "sh", "щ": "sh", "ъ": "",
    "ы": "i", "ь": "", "э": "e", "ю": "yu", "я": "ya", "ў": "o", "қ": "q",
    "ғ": "g", "ҳ": "h",
}


def slugify(text: str) -> str:
    """MediaMTX path nomi uchun xavfsiz kalit: faqat a-z, 0-9 va _."""
    s = "".join(_TRANSLIT.get(ch, ch) for ch in text.lower())
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s or "kamera"


def unique_slug(db, base: str, exclude_id: int | None = None) -> str:
    """Bazada takrorlanmaydigan slug qaytaradi: nom, nom_2, nom_3 …"""
    base = slugify(base)
    candidate, n = base, 1
    while True:
        sql = "SELECT id FROM cameras WHERE slug = ?"
        params: list = [candidate]
        if exclude_id is not None:
            sql += " AND id != ?"
            params.append(exclude_id)
        if db.execute(sql, params).fetchone() is None:
            return candidate
        n += 1
        candidate = f"{base}_{n}"


# ---------- sxema ----------

def init_db() -> None:
    with get_db() as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS cameras (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                region TEXT NOT NULL,
                lat REAL NOT NULL,
                lng REAL NOT NULL,
                stream_url TEXT NOT NULL
            )
            """
        )
        _migrate_cameras(db)

        db.execute(
            """
            CREATE TABLE IF NOT EXISTS admins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                pw_hash TEXT NOT NULL,
                pw_salt TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                admin_id INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                expires_at TEXT NOT NULL
            )
            """
        )

        for statement in INDEXES:
            db.execute(statement)

        if db.execute("SELECT COUNT(*) FROM cameras").fetchone()[0] == 0:
            db.executemany(
                "INSERT INTO cameras (name, region, lat, lng, stream_url) "
                "VALUES (?, ?, ?, ?, ?)",
                DEMO_CAMERAS,
            )
            _backfill_slugs(db)


def _migrate_cameras(db) -> None:
    """Eski `cameras` jadvaliga yetishmayotgan ustunlarni qo'shadi."""
    existing = {row["name"] for row in db.execute("PRAGMA table_info(cameras)")}
    for column, ddl in CAMERA_EXTRA_COLUMNS.items():
        if column not in existing:
            db.execute(f"ALTER TABLE cameras ADD COLUMN {column} {ddl}")
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_cameras_slug ON cameras(slug)")
    _backfill_slugs(db)


def _backfill_slugs(db) -> None:
    """Slug'i yo'q eski yozuvlarga nom asosida slug beradi."""
    rows = db.execute(
        "SELECT id, name, region FROM cameras WHERE slug IS NULL OR slug = ''"
    ).fetchall()
    for row in rows:
        slug = unique_slug(db, f"{row['region']}_{row['name']}", exclude_id=row["id"])
        db.execute("UPDATE cameras SET slug = ? WHERE id = ?", (slug, row["id"]))
