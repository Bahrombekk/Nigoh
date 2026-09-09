"""Servisdagi kameralarni holat bo'yicha guruhlab ko'rsatadi.

"Ochilmayapti" degan shikoyat ostida bir necha xil nosozlik yotadi va
ularning yechimi ham har xil:

    offline   — TCP javob bermayapti (kamera/tarmoq o'chiq)
    stalled   — port ochiq, lekin oqim kelmayapti
    nostream  — javob beryapti, lekin kodek aniqlanmagan (login/yo'l xato)
    H265      — kodek brauzerga tushunarsiz, o'girish kerak (sekin ochiladi)
    sub yo'q  — past sifatli oqim yo'q, devor asosiy oqimni tortadi

    python scripts/oqim_tashxis.py
"""
import os
import pathlib
import sys
from collections import Counter

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from geo_import import Service, load_env_file

load_env_file(str(pathlib.Path(__file__).parent.parent / ".env"))
service = Service(os.environ["NIGOH_URL"], os.environ["NIGOH_KEY"])
cameras = service.cameras()

holat = Counter()
kodek = Counter()
subsiz, transcode, ochilmaydi = [], [], []

for c in cameras:
    holat[c.get("state") or "?"] += 1
    kodek[(c.get("codec") or "—").upper()] += 1
    if not c.get("sub_path"):
        subsiz.append(c)
    if c.get("transcode"):
        transcode.append(c)
    # Brauzer ocholmaydigan holatlar: kodek yo'q yoki manba tirik emas.
    if c.get("state") in ("offline", "stalled") or not c.get("codec"):
        ochilmaydi.append(c)

print(f"Jami: {len(cameras)} ta kamera\n")
print("Holat:")
for k, v in holat.most_common():
    print(f"  {k:<10} {v}")
print("\nKodek:")
for k, v in kodek.most_common():
    print(f"  {k:<10} {v}")
print(f"\nO'girish (transcode) yoqilgan: {len(transcode)} ta")
print(f"Sub (past sifat) oqimi yo'q:    {len(subsiz)} ta")

print(f"\n--- Ochilmasligi kutiladigan {len(ochilmaydi)} ta ---")
for c in ochilmaydi:
    print(f"  #{c['id']:>4} {c.get('ip',''):<15} {(c.get('state') or '?'):<9} "
          f"kodek={(c.get('codec') or '—'):<6} {c['name'][:38]}")
