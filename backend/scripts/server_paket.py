#!/usr/bin/env python3
"""Nigoh — serverga ko'chirish paketi: baza + kalit + kamera suratlari.

Ko'chirishdan BEVOSITA OLDIN yurgiziladi (ma'lumot doim o'zgarib turadi):

    venv\\Scripts\\python backend\\scripts\\server_paket.py
    venv\\Scripts\\python backend\\scripts\\server_paket.py --chiqish D:\\paket

Natija — bitta papka (standart: Ish stolida nigoh-paket-YYYYMMDD-HHMM):

    nigoh.dump       pg_dump -Fc (egasiz, huquqlarsiz — serverda nigoh roliga tiklanadi)
    nigoh.bundle     kod (git, `main` butun tarix bilan) — GitHub'siz ham klon qilinadi
    secret.key       kamera parollarini ochadigan kalit. BUSIZ bazadagi
                     parollar o'qilmaydi — kameralarni qaytadan kiritish kerak
    snapshots.tar.gz kamera suratlari (ixtiyoriy, --suratsiz bilan tashlanadi)
    SHA256SUMS       yaxlitlik: serverda `sha256sum -c SHA256SUMS`
    PAKET.txt        nima, qachon, qaysi versiya

DIQQAT: paket MAXFIY — ichida kalit va shifrlangan parollar bor. Faqat
xavfsiz yo'l bilan (scp, flesh) uzating, chatga/pochtaga yubormang,
serverga qo'yilgach o'chirib tashlang.

Tiklash: docs/SERVER_KOCHIRISH.md.
"""
import argparse
import datetime as dt
import hashlib
import os
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent      # backend/
ROOT_DIR = BASE_DIR.parent
sys.path.insert(0, str(BASE_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import nginx_conf  # noqa: E402  (load_env)

# Windows'dagi EDB o'rnatmasi — PATH'da bo'lmasa shu yerdan olinadi.
PG_BIN_WINDOWS = Path(r"C:\Program Files\PostgreSQL\17\bin")


def pg_dump_exe() -> str:
    found = shutil.which("pg_dump")
    if found:
        return found
    exe = PG_BIN_WINDOWS / "pg_dump.exe"
    if exe.exists():
        return str(exe)
    raise SystemExit("pg_dump topilmadi — PostgreSQL bin papkasini PATH'ga qo'shing")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    vaqt = dt.datetime.now().strftime("%Y%m%d-%H%M")
    ap.add_argument("--chiqish", default=str(Path.home() / "Desktop" / f"nigoh-paket-{vaqt}"),
                    help="Paket papkasi (yo'q bo'lsa yaratiladi).")
    ap.add_argument("--suratsiz", action="store_true", help="Kamera suratlarini qo'shmaslik.")
    args = ap.parse_args()

    nginx_conf.load_env(ROOT_DIR / ".env")
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit(".env da DATABASE_URL yo'q")
    from core.paths import DATA_DIR
    from core.version import VERSION

    # Ishlab turgan nusxa qaysi papkada: Docker (data/) yoki start.bat (ildiz).
    # Kalit ikkalasida bir xil bo'lishi shart — farq qilsa to'xtaymiz.
    kalitlar = [p for p in (ROOT_DIR / "data" / "secret.key", DATA_DIR / "secret.key") if p.exists()]
    if not kalitlar:
        raise SystemExit("secret.key topilmadi")
    if len({p.read_bytes() for p in kalitlar}) > 1:
        raise SystemExit(f"secret.key nusxalari farq qiladi: {kalitlar} — qaysi biri to'g'riligini aniqlang")

    out = Path(args.chiqish)
    out.mkdir(parents=True, exist_ok=True)

    print("baza: pg_dump ...")
    dump = out / "nigoh.dump"
    subprocess.run([pg_dump_exe(), "-Fc", "--no-owner", "--no-privileges",
                    "-f", str(dump), "-d", url], check=True)

    shutil.copy2(kalitlar[0], out / "secret.key")

    fayllar = [dump, out / "secret.key"]

    # Kod — git bundle (butun tarix bilan): serverda GitHub'ga kirish
    # bo'lmasa ham `git clone nigoh.bundle nigoh` ishlaydi. Faqat
    # commit qilingan holat kiradi — saqlanmagan o'zgarish bo'lsa ogohlantiramiz.
    if subprocess.run(["git", "status", "--porcelain", "--untracked-files=no"], cwd=ROOT_DIR,
                      capture_output=True, text=True).stdout.strip():
        print("DIQQAT: commit qilinmagan o'zgarishlar bor — ular paketga KIRMAYDI")
    bundle = out / "nigoh.bundle"
    # HEAD ham kiritiladi: usiz `git clone` "remote HEAD refers to nonexistent
    # ref" deydi va ish katalogini bo'sh qoldiradi (serverda shunday bo'ldi).
    subprocess.run(["git", "bundle", "create", str(bundle), "HEAD", "main"], cwd=ROOT_DIR,
                   check=True, capture_output=True)
    fayllar.append(bundle)
    if not args.suratsiz:
        # Docker'dagi suratlar yangiroq; bo'lmasa start.bat'niki.
        src = next((p for p in (ROOT_DIR / "data" / "snapshots", DATA_DIR / "snapshots") if p.is_dir()), None)
        if src:
            print(f"suratlar: {src} ...")
            tar = out / "snapshots.tar.gz"
            with tarfile.open(tar, "w:gz") as t:
                t.add(src, arcname="snapshots")
            fayllar.append(tar)

    (out / "SHA256SUMS").write_text(
        "".join(f"{sha256(f)}  {f.name}\n" for f in fayllar), encoding="utf-8", newline="\n")
    (out / "PAKET.txt").write_text(
        f"Nigoh {VERSION} — serverga ko'chirish paketi\n"
        f"Yaratildi: {dt.datetime.now().isoformat(timespec='seconds')}\n"
        f"Fayllar: {', '.join(f.name for f in fayllar)}\n"
        "Tiklash: docs/SERVER_KOCHIRISH.md\n"
        "MAXFIY: ichida secret.key bor. Serverga qo'yilgach o'chiring.\n",
        encoding="utf-8", newline="\n")

    for f in fayllar:
        print(f"  {f.name:18} {f.stat().st_size / 1e6:8.1f} MB")
    print(f"Tayyor: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
