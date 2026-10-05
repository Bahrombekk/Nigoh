"""PostgreSQL ulanishi: hovuz (pool), qator turi va `get_db()`.

Manzil `DATABASE_URL` dan olinadi (masalan
`postgresql://nigoh:<parol>@127.0.0.1:5432/nigoh`). Ilova superuser bilan
emas, faqat o'z bazasiga egalik qiladigan `nigoh` roli bilan ulanadi —
`deploy/postgres/setup-roles.sql` ga qarang.

`get_db()` bitta tranzaksiya beradi: blok xatosiz tugasa COMMIT, xato
bilan chiqsa ROLLBACK. Ulanish hovuzdan olinadi va qaytariladi —
har so'rovda yangi TCP/TLS ulanish ochilmaydi.
"""
from __future__ import annotations

import atexit
import os
import threading
from contextlib import contextmanager

import psycopg
from psycopg_pool import ConnectionPool

from core import env  # noqa: F401 — .env ni DATABASE_URL o'qilishidan oldin yuklaydi

# Xatolar — chaqiruvchilar psycopg'ni bilmasdan ushlay olsin.
IntegrityError = psycopg.IntegrityError
UniqueViolation = psycopg.errors.UniqueViolation

# Sana va soatlar shu zonada qaytadi, `ts::date` va `extract(hour …)`
# ham shu zonada hisoblanadi (SQLite'dagi 'localtime' o'rnida). Saqlash
# baribir UTC'da — TIMESTAMPTZ zonaga bog'liq emas.
VAQT_ZONASI = os.environ.get("NIGOH_TZ", "Asia/Tashkent")


class _QatorAsos(tuple):
    """`sqlite3.Row` kabi qator: `row[0]`, `row["nom"]`, `dict(row)`,
    `row.keys()` va `a, b = row` — hammasi ishlaydi.

    Har so'rov uchun ustun nomlari bir marta hisoblanadi
    (`_qator_turi`), qatorlarning o'zi oddiy tuple — xotira va tezlik
    deyarli tuple bilan bir xil.
    """
    __slots__ = ()
    _nomlar: tuple[str, ...] = ()
    _indeks: dict[str, int] = {}

    def __getitem__(self, kalit):
        if isinstance(kalit, str):
            return tuple.__getitem__(self, self._indeks[kalit])
        return tuple.__getitem__(self, kalit)

    def keys(self):
        return list(self._nomlar)

    def get(self, kalit, standart=None):
        i = self._indeks.get(kalit)
        return standart if i is None else tuple.__getitem__(self, i)

    def __repr__(self):
        return f"Qator({dict(self)!r})"


def _qator_turi(cursor):
    desc = cursor.description
    if desc is None:
        return tuple
    nomlar = tuple(d.name for d in desc)
    tur = type("Qator", (_QatorAsos,), {
        "__slots__": (),
        "_nomlar": nomlar,
        "_indeks": {n: i for i, n in enumerate(nomlar)},
    })
    return tur


class Baza:
    """Ulanish ustidagi yupqa qobiq — kod `db.execute(...)` deb yozadi.

    `executemany` psycopg'da kursorda turadi; bu yerda ulanishdagidek
    chaqiriladi. `savepoint()` — ichidagi xato butun tranzaksiyani
    buzmasligi uchun (PostgreSQL xatodan keyin tranzaksiyani to'xtatadi,
    SQLite esa davom ettirardi).
    """
    __slots__ = ("conn",)

    def __init__(self, conn: psycopg.Connection):
        self.conn = conn

    def execute(self, sql, params=None):
        return self.conn.execute(sql, params)

    def executemany(self, sql, params_seq):
        cur = self.conn.cursor()
        cur.executemany(sql, list(params_seq))
        return cur

    def commit(self):
        self.conn.commit()

    def rollback(self):
        self.conn.rollback()

    def savepoint(self):
        return self.conn.transaction()


def _manzil() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError(
            "DATABASE_URL berilmagan. .env ga qo'shing, masalan:\n"
            "  DATABASE_URL=postgresql://nigoh:<parol>@127.0.0.1:5432/nigoh\n"
            "O'rnatish va rollar: docs/DEPLOY.md, deploy/postgres/setup-roles.sql")
    return url


def _sozla(conn: psycopg.Connection) -> None:
    conn.row_factory = _qator_turi
    conn.execute("SELECT set_config('TimeZone', %s, false)", (VAQT_ZONASI,))
    conn.commit()


_pool: ConnectionPool | None = None
_qulf = threading.Lock()


def pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        with _qulf:
            if _pool is None:
                p = ConnectionPool(
                    _manzil(),
                    min_size=int(os.environ.get("NIGOH_DB_POOL_MIN", "1")),
                    max_size=int(os.environ.get("NIGOH_DB_POOL_MAX", "20")),
                    configure=_sozla,
                    # Server qayta ishga tushsa o'lik ulanish berilmasin.
                    check=ConnectionPool.check_connection,
                    timeout=15,
                    name="nigoh",
                    open=False,
                )
                p.open(wait=True, timeout=15)
                atexit.register(p.close)
                _pool = p
    return _pool


def close_pool() -> None:
    """Hovuzni yopadi (testlar va jarayon tugashi uchun)."""
    global _pool
    with _qulf:
        if _pool is not None:
            _pool.close()
            _pool = None


@contextmanager
def get_db():
    with pool().connection() as conn:
        # `connection()` blok xatosiz tugasa commit, aks holda rollback qiladi.
        yield Baza(conn)


@contextmanager
def single_connection():
    """Hovuzsiz bitta ulanish — qisqa umrli jarayonlar (launcher) uchun:
    hovuz fon oqimlari ochib, darhol yopishga arzimaydi."""
    conn = psycopg.connect(_manzil(), connect_timeout=10)
    try:
        _sozla(conn)
        with conn:
            yield Baza(conn)
    finally:
        conn.close()


def database_size(db) -> int:
    """Baza hajmi baytda (holat sahifasi uchun)."""
    return db.execute("SELECT pg_database_size(current_database())").fetchone()[0]
