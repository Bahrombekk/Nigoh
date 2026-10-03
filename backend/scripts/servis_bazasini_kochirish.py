"""Mikroservis (nigoh-servis) bazasidagi kameralarni shu tizimga ko'chirish.

Servis tizimga qo'shilgach ishlab turgan kameralar serverdagi servis
bazasida qoldi. Bu skript ularni shu tizimning bazasiga olib o'tadi:

    python scripts/servis_bazasini_kochirish.py <servis cameras.db> <servis secret.key>
    python scripts/servis_bazasini_kochirish.py ... --yoz      # haqiqatan yozish

Standart holda faqat REJA ko'rsatiladi — hech narsa yozilmaydi.

Nima ko'chadi va nima qoladi:

  * kameralar — servisdagi bilan TO'LIQ almashtiriladi, id'lari bilan.
    Id saqlanishi shart: dashboard tarixi (stats_event) va tashqi
    tizimlar kamerani shu id bilan biladi — mikroservis davrida tarix
    aynan servis id'lari bilan yozilgan;
  * kamera parollari — servis kaliti bilan ochilib, SHU tizimning kaliti
    (secret.key) bilan qayta shifrlanadi. Kalitlar har xil: servis
    kalitini shunchaki ko'chirib bo'lmaydi, aks holda lokal parollar
    ochilmay qoladi;
  * `events` (uzilishlar jurnali, uptime tahlili manbai) — servisdagi
    bilan almashtiriladi;
  * qo'shimcha MediaMTX tugunlari (id > 1) — servisdagidek; 1-tugun
    (asosiy, shu mashinadagi MediaMTX) lokal sozlamasida qoladi;
  * foydalanuvchilar, operator hududlari, sessiyalar va dashboard tarixi
    — LOKAL bazadan, tegilmaydi.

Yozishdan oldin lokal baza `cameras-kochirishdan-oldin-<vaqt>.db.zaxira`
nomi bilan zaxiralanadi. Server ishlab turgan bo'lsa avval to'xtating —
aks holda reconciler va health eski ro'yxat bilan yozishda davom etadi.
"""
import argparse
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

# Skript scripts/ ichidan ishga tushirilganda ham loyiha modullarini topsin.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core import security  # noqa: E402
from core.db import DB_PATH, init_db  # noqa: E402


def _ustunlar(db: sqlite3.Connection, jadval: str) -> list[str]:
    return [r[1] for r in db.execute(f"PRAGMA table_info({jadval})")]


def reja(manba: sqlite3.Connection, fernet: Fernet) -> dict:
    """Ko'chiriladigan narsalar va muammolar — bazaga tegmasdan."""
    kameralar = manba.execute("SELECT * FROM cameras ORDER BY id").fetchall()
    ochilmadi = []
    for r in kameralar:
        if r["password_enc"]:
            try:
                fernet.decrypt(r["password_enc"].encode())
            except InvalidToken:
                ochilmadi.append(r["id"])
    return {
        "kameralar": len(kameralar),
        "ip_li": sum(1 for r in kameralar if r["ip"]),
        "parolli": sum(1 for r in kameralar if r["password_enc"]),
        "parol_ochilmadi": ochilmadi,
        "hududlar": len({r["region"] for r in kameralar}),
        "hodisalar": manba.execute("SELECT COUNT(*) FROM events").fetchone()[0],
        "tugunlar": manba.execute(
            "SELECT COUNT(*) FROM nodes WHERE id > 1").fetchone()[0],
    }


def kochir(manba: sqlite3.Connection, maqsad: sqlite3.Connection,
           fernet: Fernet) -> dict:
    """Kameralar, hodisalar va qo'shimcha tugunlarni bitta tranzaksiyada
    almashtiradi. Parol ochilmasa yozuv parolsiz ko'chadi (sanab beriladi)."""
    umumiy = [u for u in _ustunlar(manba, "cameras")
              if u in set(_ustunlar(maqsad, "cameras"))]
    qatorlar = []
    parolsiz = []
    for r in manba.execute("SELECT * FROM cameras ORDER BY id"):
        q = {u: r[u] for u in umumiy}
        if r["password_enc"]:
            try:
                ochiq = fernet.decrypt(r["password_enc"].encode()).decode()
                q["password_enc"] = security.encrypt(ochiq)
            except InvalidToken:
                q["password_enc"] = None
                parolsiz.append(r["id"])
        qatorlar.append(q)

    hodisa_ust = [u for u in _ustunlar(manba, "events")
                  if u in set(_ustunlar(maqsad, "events"))]
    hodisalar = manba.execute(
        f"SELECT {', '.join(hodisa_ust)} FROM events ORDER BY id").fetchall()
    tugun_ust = [u for u in _ustunlar(manba, "nodes")
                 if u in set(_ustunlar(maqsad, "nodes"))]
    tugunlar = manba.execute(
        f"SELECT {', '.join(tugun_ust)} FROM nodes WHERE id > 1").fetchall()

    with maqsad:
        maqsad.execute("DELETE FROM cameras")
        maqsad.executemany(
            f"INSERT INTO cameras ({', '.join(umumiy)}) "
            f"VALUES ({', '.join('?' * len(umumiy))})",
            [tuple(q[u] for u in umumiy) for q in qatorlar])
        maqsad.execute("DELETE FROM events")
        maqsad.executemany(
            f"INSERT INTO events ({', '.join(hodisa_ust)}) "
            f"VALUES ({', '.join('?' * len(hodisa_ust))})",
            [tuple(h) for h in hodisalar])
        maqsad.execute("DELETE FROM nodes WHERE id > 1")
        maqsad.executemany(
            f"INSERT INTO nodes ({', '.join(tugun_ust)}) "
            f"VALUES ({', '.join('?' * len(tugun_ust))})",
            [tuple(t) for t in tugunlar])
    return {"kameralar": len(qatorlar), "hodisalar": len(hodisalar),
            "tugunlar": len(tugunlar), "parolsiz": parolsiz}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("servis_db", help="serverdagi servis bazasi (data/cameras.db)")
    ap.add_argument("servis_kalit", help="servisning secret.key fayli")
    ap.add_argument("--yoz", action="store_true",
                    help="haqiqatan yozish (bo'lmasa faqat reja)")
    args = ap.parse_args()

    manba_yol, kalit_yol = Path(args.servis_db), Path(args.servis_kalit)
    for yol in (manba_yol, kalit_yol):
        if not yol.is_file():
            print(f"Topilmadi: {yol}")
            return 2
    if manba_yol.resolve() == DB_PATH.resolve():
        print("Manba va maqsad bitta fayl — servis bazasining NUSXASINI bering.")
        return 2

    fernet = Fernet(kalit_yol.read_bytes().strip())
    # Faqat o'qish uchun ochiladi — servis bazasiga hech narsa yozilmaydi.
    manba = sqlite3.connect(f"file:{manba_yol.as_posix()}?mode=ro", uri=True)
    manba.row_factory = sqlite3.Row

    r = reja(manba, fernet)
    print(f"Servis bazasi: {manba_yol}")
    print(f"  kameralar:  {r['kameralar']} (IP'li {r['ip_li']}, "
          f"parolli {r['parolli']}, {r['hududlar']} hudud)")
    print(f"  hodisalar:  {r['hodisalar']}")
    print(f"  qo'shimcha tugunlar: {r['tugunlar']}")
    if r["parol_ochilmadi"]:
        print(f"  DIQQAT: {len(r['parol_ochilmadi'])} ta kamera paroli bu kalit "
              f"bilan ochilmadi (id: {r['parol_ochilmadi'][:20]}) — kalit "
              f"shu bazaniki ekanini tekshiring.")
        if len(r["parol_ochilmadi"]) == r["parolli"] and r["parolli"]:
            print("  Birorta ham parol ochilmadi — kalit noto'g'ri. To'xtatildi.")
            return 1

    init_db()      # lokal baza eng yangi sxemada bo'lsin
    maqsad = sqlite3.connect(DB_PATH)
    maqsad.row_factory = sqlite3.Row
    lokal = maqsad.execute("SELECT COUNT(*) FROM cameras").fetchone()[0]
    print(f"Lokal baza: {DB_PATH} — hozir {lokal} ta kamera, "
          f"ular servisdagilar bilan ALMASHTIRILADI.")

    if not args.yoz:
        print("\nBu faqat reja. Yozish uchun --yoz qo'shing (server to'xtatilgan bo'lsin).")
        return 0

    vaqt = datetime.now().strftime("%Y%m%d-%H%M%S")
    zaxira = DB_PATH.with_name(f"cameras-kochirishdan-oldin-{vaqt}.db.zaxira")
    maqsad.close()
    shutil.copy2(DB_PATH, zaxira)
    print(f"Zaxira: {zaxira}")

    maqsad = sqlite3.connect(DB_PATH)
    maqsad.row_factory = sqlite3.Row
    natija = kochir(manba, maqsad, fernet)
    maqsad.close()
    print(f"Yozildi: {natija['kameralar']} kamera, {natija['hodisalar']} hodisa, "
          f"{natija['tugunlar']} qo'shimcha tugun.")
    if natija["parolsiz"]:
        print(f"Parolsiz ko'chdi (kalit ochmadi): {natija['parolsiz']}")
    print("Serverni qayta ishga tushiring — MediaMTX yo'llari o'zi yangilanadi.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
