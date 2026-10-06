"""`.env` faylini muhitga yuklaydi — import qilinishining o'zi kifoya.

Repo ildizidagi `.env` o'qiladi; muhitda allaqachon bor qiymatlar ustun
turadi (setdefault), shuning uchun Docker compose bergan qiymatlar
almashtirilmaydi. MediaMTX ishga tushiradigan launcher jarayoni ham shu
modul orqali DATABASE_URL'ni oladi (database/connection.py import qiladi).
Format: `KALIT=qiymat`; bo'sh va `#` bilan boshlangan satrlar o'tkazib
yuboriladi.

Tarkibi:
    ENV_PATH        repo ildizidagi .env
    load(yol)       faylni o'qib muhitga qo'shadi (import paytida bir marta)

Kim ishlatadi: app/config.py, core/paths.py, database/connection.py,
    database/scripts/fix_camera_data.py, tests/conftest.py.
"""
import os
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parents[2] / ".env"


def load(yol: Path = ENV_PATH) -> None:
    if not yol.exists():
        return
    for satr in yol.read_text(encoding="utf-8").splitlines():
        satr = satr.strip()
        if not satr or satr.startswith("#") or "=" not in satr:
            continue
        k, v = satr.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


load()
