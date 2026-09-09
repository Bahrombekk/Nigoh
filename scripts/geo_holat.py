"""Servisdagi kameralarning nechtasida koordinata bor — qisqa hisobot.

    python scripts/geo_holat.py
"""
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from geo_import import Service, load_env_file

load_env_file(str(pathlib.Path(__file__).parent.parent / ".env.mikroservis-zaxira"))
service = Service(os.environ["NIGOH_URL"], os.environ["NIGOH_KEY"])
cameras = service.cameras()
placed = [c for c in cameras
          if abs(c.get("lat") or 0) > 1e-6 or abs(c.get("lng") or 0) > 1e-6]
print(f"Jami: {len(cameras)} ta")
print(f"Koordinatasi bor: {len(placed)} ta")
print(f"Joyi yo'q: {len(cameras) - len(placed)} ta")
for camera in cameras:
    if camera not in placed:
        print(f"  #{camera['id']:>4}  {camera.get('ip',''):<15} {camera['name'][:50]}")
