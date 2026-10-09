"""Nigoh — fayl yo'llari.

    BACKEND_DIR — backend kodi (main.py, stream_launcher.py shu yerda);
    ROOT_DIR    — repo ildizi: .env, mediamtx/ (dastur), frontend/ (React, build — frontend/dist);
    DATA_DIR    — mashinaga xos fayllar: shifrlash kaliti, loglar,
                  mediamtx.yml, kamera suratlari (papka yo'q bo'lsa yaratiladi).

Ma'lumotlarning o'zi (kameralar, foydalanuvchilar, tarix) PostgreSQL'da —
`database/` paketiga qarang. DATA_DIR standart holatda repo ildizi;
konteynerda NIGOH_DATA orqali alohida volume beriladi (NIGOH_DATA `.env`
da bo'lishi mumkin, shuning uchun core.env avval yuklanadi).

Kim ishlatadi: core/{log,security}.py, camera/media/{reconciler,sync}.py,
    camera/monitoring/snapshots.py, scripts/import_mediamtx.py,
    database/scripts/migrate_sqlite_to_postgres.py, tests/conftest.py.
"""
import os
from pathlib import Path

from core import env  # noqa: F401 — NIGOH_DATA .env da bo'lishi mumkin

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent
DATA_DIR = Path(os.environ.get("NIGOH_DATA") or ROOT_DIR)
DATA_DIR.mkdir(parents=True, exist_ok=True)
