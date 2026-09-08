"""Nigoh — hamma kameraning suratini bitta papkaga yuklab oladi.

    python scripts/rasm_yuklash.py --domen https://negoh.das-uty.uz --login Das-uty

Parol so'raladi (yoki NIGOH_PAROL muhit o'zgaruvchisidan olinadi) —
buyruq satriga yozmaslik yaxshi, aks holda u shell tarixida qoladi.

DIQQAT — surat arxivi yo'q. Server rasmlarni diskda saqlamaydi:
`/api/cameras/<id>/snapshot` har so'rovda kameradan AYNI DAMDAGI JPEG'ni
oladi. Ya'ni bu skript "o'tgan hafta"ni tushirib bermaydi, faqat hozirni.
Tarix kerak bo'lsa skriptni davriy ishlatish kerak:

    --marta 0 --interval 300     # har 5 daqiqada, to'xtatilguncha

Har bir aylanish o'z papkasiga tushadi (`rasmlar/2026-08-27_14-30-00/`),
shuning uchun keyinchalik vaqt bo'yicha ajratish oson.

Faqat standart kutubxona ishlatiladi — loyihada `requests` yo'q.
"""
import argparse
import getpass
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.cookiejar import CookieJar
from pathlib import Path

# Kamera javob bermasa uzoq kutib o'tirmaymiz — 43 kameradan bittasi
# osilib qolsa butun aylanish cho'zilib ketardi.
SNAPSHOT_TIMEOUT = 20.0
LOGIN_TIMEOUT = 15.0
PARALLEL = 8            # bir vaqtda nechta kamera so'ralsin


class Nigoh:
    """Bitta seans: kirish (cookie) va so'rovlar."""

    def __init__(self, domen: str, ssl_tekshir: bool = True):
        self.domen = domen.rstrip("/")
        # Sayt cookie beradi (nigoh_session) — CookieJar uni o'zi eslab
        # qoladi, keyingi so'rovlarga qo'shiladi.
        ctx = None if ssl_tekshir else ssl._create_unverified_context()
        handlers = [urllib.request.HTTPCookieProcessor(CookieJar())]
        if ctx is not None:
            handlers.append(urllib.request.HTTPSHandler(context=ctx))
        self.opener = urllib.request.build_opener(*handlers)

    def _soro(self, yol: str, payload: dict | None = None,
              timeout: float = SNAPSHOT_TIMEOUT) -> bytes:
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(self.domen + yol, data=data)
        if data is not None:
            req.add_header("Content-Type", "application/json")
        with self.opener.open(req, timeout=timeout) as res:
            return res.read()

    def kirish(self, login: str, parol: str) -> str:
        """Rol qaytaradi. PUBLIC_VIEW=1 bo'lsa kirishsiz ham ishlaydi."""
        raw = self._soro("/api/auth/login",
                         {"username": login, "password": parol},
                         timeout=LOGIN_TIMEOUT)
        return (json.loads(raw) or {}).get("role") or "?"

    def kameralar(self) -> list[dict]:
        raw = self._soro("/api/cameras?limit=50000", timeout=60.0)
        return (json.loads(raw) or {}).get("cameras") or []

    def surat(self, camera_id: int) -> bytes:
        return self._soro(f"/api/cameras/{camera_id}/snapshot")


def fayl_nomi(cam: dict) -> str:
    """`hudud_nom_id.jpg` — fayl tizimi uchun xavfsiz nom."""
    xom = f"{cam.get('region') or 'hudud'}_{cam.get('name') or 'kamera'}"
    tozalangan = re.sub(r"[^0-9A-Za-z_-]+", "_", xom).strip("_")[:80]
    return f"{tozalangan or 'kamera'}_{cam['id']}.jpg"


def bitta(nigoh: Nigoh, cam: dict, papka: Path) -> tuple[str, str]:
    """Bitta kamera surati. (holat, izoh) qaytaradi."""
    nom = cam.get("name") or f"#{cam['id']}"
    try:
        data = nigoh.surat(int(cam["id"]))
    except urllib.error.HTTPError as exc:
        # 404 — kamera javob bermadi; 403 — bu hudud sizga berilmagan.
        return "xato", f"{nom}: HTTP {exc.code}"
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return "xato", f"{nom}: {exc}"
    if not data or not data.startswith(b"\xff\xd8"):
        # JPEG SOI markeri yo'q — surat emas (xato sahifasi kelgan).
        return "xato", f"{nom}: JPEG emas ({len(data)} bayt)"
    (papka / fayl_nomi(cam)).write_bytes(data)
    return "ok", f"{nom}: {len(data) // 1024} KB"


def aylanish(nigoh: Nigoh, cameras: list[dict], ildiz: Path,
             faqat_online: bool) -> tuple[int, int]:
    """Bitta to'liq yuklash. (muvaffaqiyat, xato) qaytaradi."""
    belgi = time.strftime("%Y-%m-%d_%H-%M-%S")
    papka = ildiz / belgi
    papka.mkdir(parents=True, exist_ok=True)

    royxat = cameras
    if faqat_online:
        # O'chiq kameradan surat kelmaydi — bekorga 20 soniya kutmaymiz.
        royxat = [c for c in cameras if c.get("state") == "online"]

    print(f"\n[{belgi}] {len(royxat)} kamera -> {papka}")
    ok = xato = 0
    with ThreadPoolExecutor(max_workers=PARALLEL) as pool:
        for holat, izoh in pool.map(lambda c: bitta(nigoh, c, papka), royxat):
            if holat == "ok":
                ok += 1
                print(f"  + {izoh}")
            else:
                xato += 1
                print(f"  - {izoh}", file=sys.stderr)
    print(f"[{belgi}] tayyor: {ok} surat, {xato} xato")
    return ok, xato


def main() -> int:
    p = argparse.ArgumentParser(
        description="Nigoh kameralaridan surat yuklab oluvchi")
    p.add_argument("--domen", required=True,
                   help="masalan https://negoh.das-uty.uz yoki http://localhost:8010")
    p.add_argument("--login", default="", help="admin/operator logini")
    p.add_argument("--parol", default="",
                   help="berilmasa NIGOH_PAROL yoki so'raladi")
    p.add_argument("--papka", default="rasmlar", help="qayerga saqlansin")
    p.add_argument("--hudud", default="",
                   help="faqat shu hudud(lar), vergul bilan")
    p.add_argument("--marta", type=int, default=1,
                   help="nechta aylanish; 0 — cheksiz (Ctrl+C bilan to'xtatiladi)")
    p.add_argument("--interval", type=float, default=300.0,
                   help="aylanishlar orasidagi soniya (--marta bilan)")
    p.add_argument("--hammasi", action="store_true",
                   help="offline kameralarni ham sinash")
    p.add_argument("--ssl-tekshirmaslik", action="store_true",
                   help="o'z-o'zini imzolagan sertifikat (auto.crt) uchun")
    a = p.parse_args()

    nigoh = Nigoh(a.domen, ssl_tekshir=not a.ssl_tekshirmaslik)

    if a.login:
        parol = a.parol or os.environ.get("NIGOH_PAROL") or getpass.getpass(
            f"{a.login} paroli: ")
        try:
            rol = nigoh.kirish(a.login, parol)
            print(f"Kirildi: {a.login} ({rol})")
        except urllib.error.HTTPError as exc:
            print(f"Kirish rad etildi (HTTP {exc.code}). Login/parolni "
                  f"tekshiring.", file=sys.stderr)
            return 1
        except (urllib.error.URLError, OSError) as exc:
            print(f"Domenga ulanib bo'lmadi: {exc}", file=sys.stderr)
            return 1
    else:
        print("Loginsiz — faqat PUBLIC_VIEW=1 bo'lsa ishlaydi.")

    try:
        cameras = nigoh.kameralar()
    except (urllib.error.HTTPError, urllib.error.URLError, OSError) as exc:
        print(f"Kameralar ro'yxati olinmadi: {exc}", file=sys.stderr)
        return 1

    if a.hudud:
        kerak = {h.strip().lower() for h in a.hudud.split(",") if h.strip()}
        cameras = [c for c in cameras
                   if (c.get("region") or "").lower() in kerak]
    if not cameras:
        print("Kamera topilmadi (ro'yxat bo'sh yoki hudud mos kelmadi).",
              file=sys.stderr)
        return 1

    ildiz = Path(a.papka).resolve()
    print(f"{len(cameras)} kamera topildi. Saqlanadi: {ildiz}")

    jami_ok = jami_xato = 0
    n = 0
    try:
        while a.marta == 0 or n < a.marta:
            ok, xato = aylanish(nigoh, cameras, ildiz, not a.hammasi)
            jami_ok += ok
            jami_xato += xato
            n += 1
            if a.marta != 0 and n >= a.marta:
                break
            time.sleep(a.interval)
    except KeyboardInterrupt:
        print("\nTo'xtatildi.")

    print(f"\nJami: {jami_ok} surat, {jami_xato} xato, {n} aylanish -> {ildiz}")
    return 0 if jami_ok else 2


if __name__ == "__main__":
    sys.exit(main())
