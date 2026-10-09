"""Test muhiti: har seans uchun toza PostgreSQL sxemasi va API kalit.

Testlar alohida bazada yuradi — TEST_DATABASE_URL (`.env` yoki muhit).
Seans boshida uning `public` sxemasi o'chirilib qayta quriladi, shuning
uchun bu manzil HECH QACHON asosiy bazaga qaramasligi kerak: baza nomi
`_test` bilan tugamasa testlar umuman boshlanmaydi.

Muhit o'zgaruvchilari modullar import bo'lishidan OLDIN o'rnatilishi
shart — core.paths NIGOH_DATA'ni, database esa DATABASE_URL'ni o'qiydi.
"""
import os
import sys
import tempfile
from pathlib import Path

_data_dir = tempfile.mkdtemp(prefix="nigoh-test-")
os.environ["NIGOH_DATA"] = _data_dir
# setdefault EMAS: dasturchining shell'ida haqiqiy NIGOH_API_KEY
# eksport qilingan bo'lsa testlar o'shani olardi, so'rovlar esa
# "test-kalit" yuborardi — natijada bir nechta test tushunarsiz 401
# bilan yiqilardi.
os.environ["NIGOH_API_KEY"] = "test-kalit"
# Mehmon ko'rishi o'chiq: ko'rish yo'llari ham kalit yoki sessiya talab
# qiladi. setdefault EMAS — loyiha ildizidagi `.env` boshqacha bo'lsa ham
# (app/config.py uni o'qiydi) testlar bir xil muhitda yursin.
os.environ["PUBLIC_VIEW"] = "0"

# Interfeys: backend frontend/dist (React build) ni beradi. Build qilinmagan
# muhitda (CI, toza checkout) testlar Node'siz ham yursin — vaqtinchalik
# index.html va public/assets dagi geojson'lar bilan soxta dist.
_repo = Path(__file__).resolve().parents[2]
if not (_repo / "frontend" / "dist" / "index.html").exists() and "FRONTEND_DIR" not in os.environ:
    _ui = Path(_data_dir) / "ui"
    (_ui / "assets").mkdir(parents=True)
    (_ui / "index.html").write_text("<!doctype html><title>Nigoh</title>", encoding="utf-8")
    for _g in (_repo / "frontend" / "public" / "assets").glob("*.geojson"):
        (_ui / "assets" / _g.name).write_bytes(_g.read_bytes())
    os.environ["FRONTEND_DIR"] = str(_ui)

# Loyiha ildizi import yo'lida bo'lsin (pytest'ni istalgan joydan yuritish uchun).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# .env ni yuklab (TEST_DATABASE_URL o'sha yerda), DATABASE_URL'ni test
# bazasiga MAJBURAN almashtiramiz — .env dagi asosiy manzil ishlatilmasin.
from core import env  # noqa: E402,F401

_test_url = os.environ.get("TEST_DATABASE_URL", "")
if not _test_url.split("?", 1)[0].rstrip("/").endswith("_test"):
    raise SystemExit(
        "TEST_DATABASE_URL berilmagan yoki baza nomi '_test' bilan tugamaydi.\n"
        "Testlar shu bazani tozalab yuboradi — asosiy bazani ko'rsatmang.\n"
        "Masalan: TEST_DATABASE_URL="
        "postgresql://nigoh:<parol>@127.0.0.1:5432/nigoh_test")
os.environ["DATABASE_URL"] = _test_url

import pytest  # noqa: E402

from database import get_db, init_db  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _db():
    with get_db() as db:
        db.execute("DROP SCHEMA IF EXISTS public CASCADE")
        db.execute("CREATE SCHEMA public")
    init_db()


@pytest.fixture(scope="module", autouse=True)
def _stats_cache():
    """Statistika hisobi 60 s keshlanadi (stats/reporting/engine.py). Har modul
    toza keshdan boshlasin: oldingi modul qoldirgan, yangi kameralarsiz hisob
    keyingi modulga o'tib, testlar ishga tushish tartibiga qarab yiqilardi."""
    from stats.reporting import engine
    engine.clear_cache()
    yield
