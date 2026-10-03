"""Eski sxemadagi `always_on DEFAULT 1` tuzatilishi.

Ko'chirilgan servis bazasida ustun shunday edi: ustunni ko'rsatmay
qo'shilgan kamera jimgina "doim tayyor" bo'lib, MediaMTX'ga oldindan
yo'l bo'lib tushardi — 5000 kamerada sinxronlash soatlab cho'ziladi.
"""
import sqlite3

from core.db import _fix_column_defaults


def _eski_baza():
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    db.execute("CREATE TABLE cameras (id INTEGER PRIMARY KEY AUTOINCREMENT, "
               "name TEXT NOT NULL, slug TEXT, "
               "always_on INTEGER NOT NULL DEFAULT 1, "
               "enabled INTEGER NOT NULL DEFAULT 1)")
    db.execute("INSERT INTO cameras (id, name, slug, always_on) VALUES (7, 'a', 'a', 1)")
    db.execute("INSERT INTO cameras (id, name, slug, always_on) VALUES (9, 'b', 'b', 0)")
    return db


def _standart(db, ustun):
    return next(r["dflt_value"] for r in db.execute("PRAGMA table_info(cameras)")
                if r["name"] == ustun)


def test_standart_0_ga_tushadi_malumot_saqlanadi():
    db = _eski_baza()
    _fix_column_defaults(db)
    assert str(_standart(db, "always_on")) == "0"
    assert str(_standart(db, "enabled")) == "1"          # boshqasiga tegilmaydi
    rows = [tuple(r) for r in db.execute(
        "SELECT id, name, always_on FROM cameras ORDER BY id")]
    assert rows == [(7, "a", 1), (9, "b", 0)]           # qiymatlar va id'lar
    db.execute("INSERT INTO cameras (name, slug) VALUES ('c', 'c')")
    assert db.execute("SELECT always_on, id FROM cameras WHERE name = 'c'"
                      ).fetchone()[:] == (0, 10)        # yangi yozuv — 0, id davom
    assert db.execute("SELECT COUNT(*) FROM sqlite_master WHERE name = 'cameras_eski'"
                      ).fetchone()[0] == 0


def test_toza_bazaga_tegilmaydi():
    db = _eski_baza()
    _fix_column_defaults(db)
    sql = db.execute("SELECT sql FROM sqlite_master WHERE name = 'cameras'").fetchone()[0]
    _fix_column_defaults(db)                             # ikkinchi marta — hech narsa
    assert db.execute("SELECT sql FROM sqlite_master WHERE name = 'cameras'"
                      ).fetchone()[0] == sql
