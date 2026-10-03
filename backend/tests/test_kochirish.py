"""scripts/servis_bazasini_kochirish.py — servis bazasidan kameralarni olish.

Asosiy xavf — parollar: servis va shu tizim kalitlari har xil, ko'chirishdan
keyin har bir parol LOKAL kalit bilan ochilishi shart. Ikkinchisi — id'lar
saqlanishi (dashboard tarixi ularga bog'langan) va lokal foydalanuvchilarga
tegilmasligi.
"""
import importlib.util
import sqlite3
from pathlib import Path

from cryptography.fernet import Fernet

from core import security
from core.db import DB_PATH

_SKRIPT = Path(__file__).resolve().parent.parent / "scripts" / "servis_bazasini_kochirish.py"
_spec = importlib.util.spec_from_file_location("kochirish", _SKRIPT)
kochirish = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(kochirish)


def _servis_bazasi(yol: Path, fernet: Fernet) -> None:
    db = sqlite3.connect(yol)
    db.executescript("""
        CREATE TABLE cameras (id INTEGER PRIMARY KEY, name TEXT, region TEXT,
            lat REAL, lng REAL, stream_url TEXT, slug TEXT, ip TEXT, port INTEGER,
            username TEXT, password_enc TEXT, rtsp_path TEXT, enabled INTEGER,
            servisga_xos TEXT);
        CREATE TABLE events (id INTEGER PRIMARY KEY, ts TEXT, kind TEXT,
            ip TEXT, port INTEGER, slug TEXT, detail TEXT);
        CREATE TABLE nodes (id INTEGER PRIMARY KEY, name TEXT, api_base TEXT,
            public_host TEXT, rtsp_port INTEGER, hls_port INTEGER,
            webrtc_port INTEGER, enabled INTEGER);
    """)
    db.executemany(
        "INSERT INTO cameras VALUES (?,?,?,?,?,'',?,?,554,'admin',?,'/s',1,'x')",
        [(501, "Servis A", "Toshkent", 41.3, 69.2, "servis_a", "10.30.1.1",
          fernet.encrypt(b"parol-a").decode()),
         (777, "Servis B", "Buxoro", 39.7, 64.4, "servis_b", "10.30.1.2",
          "buzuq-shifr")])
    db.execute("INSERT INTO events VALUES (1,'2026-09-01','offline',"
               "'10.30.1.1',554,'servis_a','')")
    db.execute("INSERT INTO nodes VALUES (1,'Server asosiy','http://127.0.0.1:9997',"
               "'',8554,8888,8889,1)")
    db.execute("INSERT INTO nodes VALUES (2,'Filial','http://10.0.0.9:9997',"
               "'10.0.0.9',8554,8888,8889,1)")
    db.commit()
    db.close()


def test_kochirish_parol_id_va_lokal_malumot(tmp_path):
    servis_fernet = Fernet(Fernet.generate_key())
    manba_yol = tmp_path / "servis.db"
    _servis_bazasi(manba_yol, servis_fernet)

    # Maqsad — test bazasining nusxasi (boshqa testlarga tegmasin).
    maqsad_yol = tmp_path / "lokal.db"
    with sqlite3.connect(DB_PATH) as asl, sqlite3.connect(maqsad_yol) as nusxa:
        asl.backup(nusxa)
    maqsad = sqlite3.connect(maqsad_yol)
    maqsad.row_factory = sqlite3.Row
    adminlar_oldin = maqsad.execute("SELECT COUNT(*) FROM admins").fetchone()[0]
    tugun1_oldin = dict(maqsad.execute("SELECT * FROM nodes WHERE id = 1").fetchone())

    manba = sqlite3.connect(manba_yol)
    manba.row_factory = sqlite3.Row
    r = kochirish.reja(manba, servis_fernet)
    assert r["kameralar"] == 2 and r["parol_ochilmadi"] == [777]

    natija = kochirish.kochir(manba, maqsad, servis_fernet)
    assert natija == {"kameralar": 2, "hodisalar": 1, "tugunlar": 1,
                      "parolsiz": [777]}

    rows = {row["id"]: row for row in maqsad.execute("SELECT * FROM cameras")}
    assert set(rows) == {501, 777}                       # id'lar saqlandi
    # Parol LOKAL kalit bilan ochiladi, servis kaliti bilan emas.
    assert security.decrypt(rows[501]["password_enc"]) == "parol-a"
    assert rows[777]["password_enc"] is None             # buzuq — parolsiz
    assert rows[501]["slug"] == "servis_a"

    # Lokal foydalanuvchilar va asosiy tugun o'zgarmadi.
    assert maqsad.execute("SELECT COUNT(*) FROM admins").fetchone()[0] == adminlar_oldin
    assert dict(maqsad.execute("SELECT * FROM nodes WHERE id = 1").fetchone()) == tugun1_oldin
    assert maqsad.execute("SELECT name FROM nodes WHERE id = 2").fetchone()[0] == "Filial"
    assert maqsad.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 1
