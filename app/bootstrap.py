"""Nigoh — birinchi ishga tushirish tayyorgarligi."""
import os
import sys

from core import security
from core.db import get_db, init_db
from core.log import log

from . import nigoh
from .config import NIGOH_KEY, NIGOH_URL


def bootstrap() -> None:
    # Kamera qatlami mikroservisda — manzil va kalitsiz tizim ma'nosiz,
    # shuning uchun darhol, tushunarli xabar bilan to'xtaymiz.
    if not NIGOH_URL or not NIGOH_KEY:
        sys.exit(
            "NIGOH_URL va NIGOH_KEY sozlanmagan.\n"
            "Loyiha ildizidagi .env fayliga yozing:\n"
            "    NIGOH_URL=https://kamera-servis-manzili\n"
            "    NIGOH_KEY=<mikroservisning NIGOH_API_KEY qiymati>"
        )

    init_db()

    # Kamera holatlarini mikroservisdan fonda so'rab, dashboard tarixini
    # (stats_region/stats_event) yozib boramiz. Sayt ochilishini kutdirmaydi.
    nigoh.start_poller()

    log("app", "started", nigoh_url=NIGOH_URL)

    with get_db() as db:
        generated = security.ensure_admin(db)
    if generated:
        log("app", "admin_created",
            username=os.environ.get("ADMIN_LOGIN", "admin"))
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
