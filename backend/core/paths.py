"""Nigoh — fayl yo'llari.

    BACKEND_DIR — backend kodi (main.py, stream_launcher.py shu yerda);
    ROOT_DIR    — repo ildizi: .env, mediamtx/ (dastur), frontend/;
    DATA_DIR    — mashinaga xos fayllar: shifrlash kaliti, loglar,
                  mediamtx.yml, kamera suratlari.

Ma'lumotlarning o'zi (kameralar, foydalanuvchilar, tarix) PostgreSQL'da —
`database/` paketiga qarang. DATA_DIR standart holatda repo ildizi; konteynerda
NIGOH_DATA orqali alohida volume beriladi.
"""
import os
from pathlib import Path

from core import env  # noqa: F401 — NIGOH_DATA .env da bo'lishi mumkin

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent
DATA_DIR = Path(os.environ.get("NIGOH_DATA") or ROOT_DIR)
DATA_DIR.mkdir(parents=True, exist_ok=True)
