"""SQLite (`cameras.db`) dagi ma'lumotni PostgreSQL'ga ko'chiradi.

    python database/scripts/migrate_sqlite_to_postgres.py                 # reja (yozmaydi)
    python database/scripts/migrate_sqlite_to_postgres.py --apply         # ko'chirish
    python database/scripts/migrate_sqlite_to_postgres.py --apply --sqlite D:/eski/cameras.db

Manzil — DATABASE_URL (.env). Ko'chirishdan oldin:
  1. Backend'ni to'xtating — aks holda SQLite'ga yozuv davom etadi.
  2. PostgreSQL servisi ishlab tursin, rollar yaratilgan bo'lsin (backend/database/sql/setup-roles.sql).

Xavfsizlik:
  * SQLite faqat O'QISH rejimida ochiladi — manba fayl o'zgarmaydi.
  * Hammasi BITTA tranzaksiyada: biror qator o'tmasa, PostgreSQL'da
    hech narsa qolmaydi (yarim ko'chirilgan baza bo'lmaydi).
  * Maqsadda kamera allaqachon bo'lsa ko'chirish to'xtaydi (--force siz).
  * Oxirida har jadval bo'yicha qatorlar soni solishtiriladi.

Kamera parollari (`password_enc`) o'zgarishsiz ko'chadi — ular
DATA_DIR/secret.key bilan shifrlangan, shu kalit joyida qolishi shart.

Sessiyalar ko'chirilmaydi: PostgreSQL'da token xesh holida saqlanadi,
eski ochiq tokenlar yaroqsiz. Foydalanuvchilar bir marta qayta kiradi.

Tartib: avval sxema 1-versiyagacha (`init_db(target_version=1)` — SQLite
tuzilmasi shunga mos), ko'chirish, keyin qolgan migratsiyalar ma'lumotni
o'zi yangi sxemaga o'tkazadi. Vaqt ustunlari SQLite'da ikki xil satr
bo'lgan (zonasiz UTC va zonali isoformat) — ikkalasi UTC'ga keltiriladi.

Tarkibi:
    main()                      argumentlar, reja yoki ko'chirish, tekshiruv
    plan(src)                   har jadvaldagi qatorlar soni
    copy(src, db)               jadvallarni ko'chiradi, identity hisoblagichlarni suradi
    convert(table, column, value)  qiymatni PostgreSQL turiga (vaqt, JSONB)
    to_utc(value)               SQLite vaqt satri -> zonali datetime
    sqlite_columns / pg_columns / has_table  sxema yordamchilari
    TABLES                      ko'chirish tartibi (tashqi kalitlar bo'yicha)
    TIME_COLUMNS, IDENTITY      vaqt ustunlari, identity ustunli jadvallar

Ishlatadi: core.paths (DATA_DIR), database (get_db, init_db), psycopg Jsonb
Kim ishlatadi: qo'lda (bir martalik ko'chirish); backend/README.md da tilga olingan.
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from psycopg.types.json import Jsonb  # noqa: E402

from core.paths import DATA_DIR  # noqa: E402
from database import get_db, init_db  # noqa: E402

# Ko'chirish tartibi — tashqi kalitlar bo'yicha: avval ota jadval.
TABLES = ["nodes", "admins", "user_regions", "cameras", "events",
          "stats_region", "stats_event", "walls"]

# Vaqt ustunlari: SQLite'da ikki xil satr bo'lgan — `datetime('now')`
# (zonasiz UTC, "2026-09-07 04:52:53") va Python isoformat (zonali).
TIME_COLUMNS = {"created_at", "expires_at", "ts", "last_seen", "snapshot_at"}

# Identity ustunli jadvallar — ko'chirishdan keyin hisoblagich surilishi kerak.
IDENTITY = {"nodes": "id", "admins": "id", "cameras": "id",
            "events": "id", "stats_event": "id"}


def to_utc(value):
    """SQLite satrini zonali datetime'ga aylantiradi (bo'sh -> None)."""
    if value in (None, ""):
        return None
    moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if moment.tzinfo is None:          # datetime('now') — UTC, zonasiz
        moment = moment.replace(tzinfo=timezone.utc)
    return moment


def sqlite_columns(src: sqlite3.Connection, table: str) -> list[str]:
    return [r[1] for r in src.execute(f"PRAGMA table_info({table})")]


def pg_columns(db, table: str) -> list[str]:
    return [r[0] for r in db.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = 'public' AND table_name = %s "
        "ORDER BY ordinal_position", (table,))]


def has_table(src: sqlite3.Connection, table: str) -> bool:
    return src.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' "
                       "AND name = ?", (table,)).fetchone() is not None


def convert(table: str, column: str, value):
    if column in TIME_COLUMNS:
        return to_utc(value)
    if table == "walls" and column == "camera_ids":
        import json
        return Jsonb(json.loads(value) if isinstance(value, str) else value)
    return value


def plan(src: sqlite3.Connection) -> dict[str, int]:
    return {t: src.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            for t in TABLES if has_table(src, t)}


def copy(src: sqlite3.Connection, db) -> dict[str, int]:
    copied: dict[str, int] = {}
    for table in TABLES:
        if not has_table(src, table):
            continue
        src_cols = sqlite_columns(src, table)
        dst_cols = set(pg_columns(db, table))
        cols = [c for c in src_cols if c in dst_cols]
        dropped = [c for c in src_cols if c not in dst_cols]
        if dropped:
            print(f"  {table}: PostgreSQL sxemasida yo'q ustunlar o'tkazib "
                  f"yuborildi: {', '.join(dropped)}")
        # `rowid` tartibi — walls uchun "oxirgi ishlatilgan" tartibi shu.
        rows = src.execute(f"SELECT {', '.join(cols)} FROM {table} "
                           f"ORDER BY rowid").fetchall()
        if table == "nodes":
            # 1-tugunni init_db yaratgan — SQLite'dagisi bilan almashtiriladi.
            db.execute("DELETE FROM nodes")
        placeholders = ", ".join(["%s"] * len(cols))
        sql = (f"INSERT INTO {table} ({', '.join(cols)}) "
               f"VALUES ({placeholders})")
        db.executemany(sql, [
            tuple(convert(table, c, r[i]) for i, c in enumerate(cols))
            for r in rows])
        copied[table] = len(rows)
    for table, column in IDENTITY.items():
        db.execute(
            f"SELECT setval(pg_get_serial_sequence('{table}', '{column}'), "
            f"GREATEST((SELECT COALESCE(MAX({column}), 0) FROM {table}), 1))")
    return copied


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sqlite", default=str(DATA_DIR / "cameras.db"),
                    help="manba SQLite fayli (standart: DATA_DIR/cameras.db)")
    ap.add_argument("--apply", action="store_true",
                    help="haqiqatan ko'chirsin (standart — faqat reja)")
    ap.add_argument("--force", action="store_true",
                    help="PostgreSQL'da ma'lumot bo'lsa ham (avval tozalab) ko'chirsin")
    args = ap.parse_args()

    path = Path(args.sqlite)
    if not path.exists():
        print(f"SQLite fayli topilmadi: {path}")
        return 1
    src = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)

    counts = plan(src)
    print(f"Manba: {path}")
    for table, n in counts.items():
        print(f"  {table:<14} {n:>8} qator")
    if has_table(src, "sessions"):
        print("  sessions       ko'chirilmaydi (foydalanuvchilar qayta kiradi)")
    if not args.apply:
        print("\nBu faqat reja. Ko'chirish uchun: --apply")
        return 0

    # SQLite tuzilmasi 1-versiyaga mos: avval shu versiyagacha, ko'chirish,
    # keyin qolgan migratsiyalar ma'lumotni o'zi yangi sxemaga o'tkazadi.
    init_db(target_version=1)
    with get_db() as db:
        existing = db.execute("SELECT COUNT(*) FROM cameras").fetchone()[0]
        if existing and not args.force:
            print(f"\nPostgreSQL'da allaqachon {existing} ta kamera bor — to'xtatildi.\n"
                  "Qaytadan ko'chirish kerak bo'lsa: --force (mavjudini o'chiradi).")
            return 1
        if args.force:
            db.execute("TRUNCATE " + ", ".join(reversed(TABLES)) +
                       ", sessions RESTART IDENTITY CASCADE")
        copied = copy(src, db)

        # Tekshiruv — o'sha tranzaksiya ichida: mos kelmasa hammasi bekor.
        mismatch = []
        for table, n in copied.items():
            got = db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            if got != counts[table]:
                mismatch.append(f"{table}: SQLite {counts[table]}, PostgreSQL {got}")
        if mismatch:
            raise SystemExit("Qatorlar soni mos kelmadi, hech narsa yozilmadi:\n  "
                             + "\n  ".join(mismatch))

    init_db()   # qolgan migratsiyalar (sxema v2 va keyingilari)
    print("\nKo'chirildi (sxema oxirgi versiyaga yangilandi):")
    for table, n in copied.items():
        print(f"  {table:<14} {n:>8} qator  OK")
    print("\nSQLite fayliga tegilmadi. Hammasi ishlashiga ishonch hosil "
          "qilgach uni zaxiraga oling.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
