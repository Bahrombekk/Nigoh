"""Nigoh — birinchi ishga tushirish tayyorgarligi."""
import os
import threading

from core import health, security
from core.db import get_db, init_db
from media import sync as mediamtx_sync

from .helpers import cameras_for_mediamtx


def _sync_mediamtx_paths() -> None:
    """Kamera yo'llarini ishlab turgan MediaMTX bilan kelishtiradi.

    Fonda ishlaydi: 5000 kamerada bu bir necha soniya olishi mumkin, sayt
    ochilishini kutdirmasin. MediaMTX ishlamayotgan bo'lsa muammo emas —
    har bir ko'rish so'rovida qayta urinib ko'riladi.
    """
    with get_db() as db:
        cameras = cameras_for_mediamtx(db)
    if mediamtx_sync.api_available():
        result = mediamtx_sync.push_to_api(cameras)
        print(f"MediaMTX: {result['message']}")


def bootstrap() -> None:
    init_db()

    # Kameralarning tirikligini fonda kuzatib boramiz — xaritada o'chiq
    # kameralar qizil bo'lib ko'rinadi.
    health.start()

    # Toza nusxada mediamtx.yml bo'lmaydi (u maxfiy ro'yxatda) — o'zimiz
    # yaratamiz, aks holda MediaMTX ishga tusha olmaydi.
    if not mediamtx_sync.CONFIG_PATH.exists():
        with get_db() as db:
            mediamtx_sync.write_config(cameras_for_mediamtx(db))
        print(f"mediamtx.yml yaratildi: {mediamtx_sync.CONFIG_PATH}")

    # Kamera yo'llarini ishlab turgan MediaMTX'ga fonda bildiramiz.
    threading.Thread(target=_sync_mediamtx_paths, daemon=True).start()

    with get_db() as db:
        generated = security.ensure_admin(db)
    if generated:
        login_name = os.environ.get("ADMIN_LOGIN", "admin")
        print("\n" + "=" * 58)
        print("  SUPER-ADMIN YARATILDI — bu ma'lumotni saqlab qo'ying")
        print(f"     login:  {login_name}")
        print(f"     parol:  {generated}")
        print("  Parolni almashtirish:")
        print("     python main.py --admin-parol YangiParol")
        print("=" * 58 + "\n")


def change_admin_password(new_password: str) -> None:
    """`python main.py --admin-parol Yangi` buyrug'i uchun."""
    init_db()
    with get_db() as conn:
        security.set_password(conn, os.environ.get("ADMIN_LOGIN", "admin"), new_password)
    print("Parol almashtirildi. Barcha eski sessiyalar bekor qilindi.")
