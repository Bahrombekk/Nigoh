"""Excel'dagi geolokatsiyani ishlayotgan Nigoh servisiga yozadi.

Kameralar servisga allaqachon ulangan, ammo ko'pchiligining koordinatasi
yo'q (0,0 — "joyi ko'rsatilmagan"). Excel faylida har bir kameraning IP
manzili va joylashuvi bor; moslashtirish IP bo'yicha ketadi.

Ishlatish (avval quruq yurish — hech narsa yozilmaydi):
    python scripts/geo_import.py "nigoh geolakatsiya.xlsx"
Haqiqatan yozish:
    python scripts/geo_import.py "nigoh geolakatsiya.xlsx" --apply

Manzil va kalit muhitdan (NIGOH_URL, NIGOH_KEY) yoki `--env-file` bilan
ko'rsatilgan fayldan olinadi.

Koordinata formati Excel'da bir xil emas — qo'lda kiritilgan:
    41.16.00.294      daraja.daqiqa.soniya.kasr
    40 29 13 998      xuddi shu, ajratgichi bo'sh joy
    40°11'18.9        daraja/daqiqa belgisi bilan
    68.4921.708       nuqta tushib qolgan (68°49'21.708")
    40.188572         allaqachon o'nlik daraja
Hammasi o'nlik darajaga keltiriladi va O'zbekiston chegarasiga tekshiriladi.
"""
import argparse
import json
import os
import pathlib
import re
import sys
import urllib.error
import urllib.request

import openpyxl

# Koordinata shu to'rtburchakdan chiqib ketsa — kiritishda xato bo'lgan.
UZ_BBOX = (37.0, 46.0, 55.0, 74.0)   # minLat, maxLat, minLng, maxLng


# ---------- koordinatani o'qish ----------

def to_degrees(value) -> float | None:
    """Bir katakdagi qiymatni o'nlik darajaga aylantiradi (topolmasa None)."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)

    text = str(value).replace("\xa0", " ").strip()
    if not text:
        return None
    parts = re.findall(r"\d+", text)
    if not parts:
        return None

    # Nuqta tushib qolgan: 68.4921.708 — o'rtadagi to'rt raqam daqiqa+soniya.
    if len(parts) == 3 and len(parts[1]) == 4:
        parts = [parts[0], parts[1][:2], parts[1][2:], parts[2]]

    if len(parts) == 2:                       # allaqachon o'nlik daraja
        return float(f"{parts[0]}.{parts[1]}")
    if len(parts) == 3:                       # daraja/daqiqa/soniya
        deg, minutes, seconds = parts[0], parts[1], parts[2]
    elif len(parts) >= 4:                     # soniyaning kasr qismi alohida
        deg, minutes, seconds = parts[0], parts[1], f"{parts[2]}.{parts[3]}"
    else:
        return None
    return int(deg) + int(minutes) / 60 + float(seconds) / 3600


def read_excel(path: str) -> tuple[dict[str, tuple[float, float]], list[str]]:
    """Excel'ni o'qiydi: {ip: (lat, lng)} va muammoli qatorlar ro'yxati."""
    sheet = openpyxl.load_workbook(path, data_only=True)["cameras"]
    points: dict[str, tuple[float, float]] = {}
    problems: list[str] = []

    for number, row in enumerate(sheet.iter_rows(min_row=2, values_only=True), 2):
        km, ip = row[0], row[1]
        if not ip:
            continue
        ip = str(ip).strip()
        lat, lng = to_degrees(row[4]), to_degrees(row[5])
        if lat is None or lng is None:
            problems.append(f"{number}-qator ({km}, {ip}): koordinata yo'q")
            continue
        min_lat, max_lat, min_lng, max_lng = UZ_BBOX
        if not (min_lat <= lat <= max_lat and min_lng <= lng <= max_lng):
            problems.append(f"{number}-qator ({km}, {ip}): chegaradan tashqarida "
                            f"{lat:.6f}, {lng:.6f} — asli {row[4]!r}, {row[5]!r}")
            continue
        old = points.get(ip)
        if old and (round(old[0], 5), round(old[1], 5)) != (round(lat, 5), round(lng, 5)):
            problems.append(f"{number}-qator ({km}, {ip}): shu IP uchun boshqa "
                            f"koordinata ham bor — oxirgisi olinadi")
        points[ip] = (lat, lng)

    return points, problems


# ---------- servis bilan aloqa ----------

class Service:
    """Nigoh REST API — server-to-server kalit bilan."""

    def __init__(self, base: str, key: str):
        self.base = base.rstrip("/")
        self.key = key

    def _call(self, method: str, path: str, body: dict | None = None) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(
            self.base + path, data=data, method=method,
            headers={"X-API-Key": self.key, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.loads(response.read().decode() or "{}")
        except urllib.error.HTTPError as error:
            detail = error.read().decode()[:300]
            raise SystemExit(f"{method} {path} — {error.code}: {detail}")

    def cameras(self) -> list[dict]:
        """Barcha kameralar — servis bir so'rovda 500 tadan ko'p bermaydi."""
        result, offset = [], 0
        while True:
            page = self._call("GET", f"/api/v1/admin/cameras?limit=500&offset={offset}")
            result += page["cameras"]
            offset += len(page["cameras"])
            if not page["cameras"] or offset >= page["total"]:
                return result

    def save(self, camera: dict, lat: float, lng: float) -> None:
        """Faqat koordinatani o'zgartiradi — qolgan maydonlar o'z holicha.

        PUT to'liq obyekt kutadi, shuning uchun ro'yxatdan kelgan qiymatlar
        aynan qaytariladi. Parol yuborilmaydi: `None` — "o'zgarmasin".
        """
        body = {
            "name": camera["name"],
            "region": camera["region"],
            "lat": lat,
            "lng": lng,
            "source_type": camera["source_type"],
            "node_id": camera.get("node_id", 1),
            "enabled": camera.get("enabled", True),
            "always_on": camera.get("always_on", False),
            "note": camera.get("note", ""),
            "ip": camera.get("ip", ""),
            "port": camera.get("port", 554),
            "username": camera.get("username", ""),
            "password": None,
            "rtsp_path": camera.get("rtsp_path", "") or "/stream1",
            "sub_path": camera.get("sub_path", ""),
            "vendor": camera.get("vendor", "boshqa"),
            "stream_url": camera.get("raw_stream_url", ""),
        }
        self._call("PUT", f"/api/v1/admin/cameras/{camera['id']}", body)


def load_env_file(path: str) -> None:
    """`.env` ko'rinishidagi fayldan muhitga qiymat oladi (bori ustun)."""
    file = pathlib.Path(path)
    if not file.exists():
        return
    for line in file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


# ---------- asosiy oqim ----------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("excel", help="geolokatsiya fayli (.xlsx)")
    parser.add_argument("--apply", action="store_true",
                        help="haqiqatan yozsin (standart holatda faqat ko'rsatadi)")
    parser.add_argument("--env-file", default=".env.mikroservis-zaxira",
                        help="NIGOH_URL va NIGOH_KEY olinadigan fayl")
    parser.add_argument("--overwrite", action="store_true",
                        help="koordinatasi bor kameralarni ham qayta yozsin")
    args = parser.parse_args()

    load_env_file(args.env_file)
    base, key = os.environ.get("NIGOH_URL", ""), os.environ.get("NIGOH_KEY", "")
    if not base or not key:
        return print("NIGOH_URL va NIGOH_KEY topilmadi — --env-file ni tekshiring") or 2

    points, problems = read_excel(args.excel)
    print(f"Excel: {len(points)} ta IP uchun koordinata o'qildi")
    for line in problems:
        print("  ! " + line)

    service = Service(base, key)
    cameras = service.cameras()
    print(f"Servis ({base}): {len(cameras)} ta kamera")

    planned, already, unmatched = [], [], []
    for camera in cameras:
        point = points.get((camera.get("ip") or "").strip())
        if point is None:
            unmatched.append(camera)
            continue
        has_place = abs(camera.get("lat") or 0) > 1e-6 or abs(camera.get("lng") or 0) > 1e-6
        if has_place and not args.overwrite:
            already.append(camera)
            continue
        planned.append((camera, point))

    used = {(c.get("ip") or "").strip() for c, _ in planned}
    missing_ips = sorted(set(points) - {(c.get("ip") or "").strip() for c in cameras})

    print(f"\nYoziladi: {len(planned)} ta")
    for camera, (lat, lng) in planned:
        print(f"  #{camera['id']:>4}  {camera['ip']:<15} {camera['name'][:40]:<40} "
              f"{camera['lat']:.5f},{camera['lng']:.5f}  ->  {lat:.6f},{lng:.6f}")
    if already:
        print(f"\nKoordinatasi allaqachon bor — tegilmaydi: {len(already)} ta "
              f"(--overwrite bilan qayta yozish mumkin)")
    if unmatched:
        print(f"\nExcel'da topilmadi: {len(unmatched)} ta kamera")
        for camera in unmatched[:20]:
            print(f"  #{camera['id']:>4}  {camera.get('ip', ''):<15} {camera['name'][:50]}")
        if len(unmatched) > 20:
            print(f"  ... yana {len(unmatched) - 20} ta")
    if missing_ips:
        print(f"\nExcel'da bor, servisda yo'q IP: {len(missing_ips)} ta")
        print("  " + ", ".join(missing_ips))

    if not args.apply:
        print("\n(Quruq yurish — hech narsa yozilmadi. Yozish uchun: --apply)")
        return 0

    # Ortga qaytarish uchun eski koordinatalar saqlanadi — PUT joyida yozadi.
    backup = pathlib.Path("geo-zaxira.json")
    backup.write_text(json.dumps(
        [{"id": c["id"], "name": c["name"], "lat": c["lat"], "lng": c["lng"]}
         for c, _ in planned], ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nEski koordinatalar zaxirasi: {backup}")

    print("Yozilmoqda... (servis har bir kamerani RTSP orqali tekshiradi, sekin)")
    saved, failed = 0, []
    for camera, (lat, lng) in planned:
        try:
            service.save(camera, lat, lng)
            saved += 1
            print(f"  ok  #{camera['id']} {camera['name'][:40]}")
        except SystemExit as error:
            failed.append((camera, str(error)))
            print(f"  XATO #{camera['id']} {camera['name'][:40]}: {error}")
    print(f"\nSaqlandi: {saved} ta, xato: {len(failed)} ta")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
