"""Raqamlangan sxema migratsiyalari: har biri `NNNN_nom.py` fayli.

Har bir modulda `VERSION` (fayl raqami bilan bir xil) va `apply(db)` bor.
Bajarilgan migratsiya HECH QACHON tahrirlanmaydi — yangi o'zgarish yangi
raqamli fayl bilan qo'shiladi. Raqamlar 1 dan uzluksiz bo'lishi shart,
`VERSION` fayl nomidagi raqamga mos kelmasa yoki raqam tushib qolsa —
`load()` RuntimeError beradi (noto'g'ri tartibda migratsiya bajarilmasin).

Mavjud migratsiyalar:
    0001_initial.py             SQLite'dan 1:1 ko'chirilgan boshlang'ich sxema
    0002_schema_v2.py           sxema v2: tashkilotlar, hududlar, qurilmalar, audit
    0003_camera_probe.py        camera_status.probe_at / probe_error (pasport tekshiruvi)
    0004_camera_groups.py       foydalanuvchi kamera guruhlari (camera_groups, _members)
    0005_app_settings.py        sayt sozlamalari (app_settings); audit_log.user_id FK olib tashlandi
    0006_v3.py                  v3: users.prefs, viewer roli, cameras.deleted_at (yumshoq
                                o'chirish), system_alerts, notification_reads

Tarkibi:
    load()                      `NNNN_[a-z0-9_]+` modullarini import qiladi, tekshiradi
                                va VERSION bo'yicha tartiblangan ro'yxat qaytaradi

Kim ishlatadi: database/schema.py (init_db, latest_version).
"""
import importlib
import pkgutil
import re

_NAME = re.compile(r"^(\d{4})_[a-z0-9_]+$")


def load() -> list:
    found = []
    for info in pkgutil.iter_modules(__path__):
        m = _NAME.match(info.name)
        if not m:
            continue
        module = importlib.import_module(f"{__name__}.{info.name}")
        if module.VERSION != int(m.group(1)):
            raise RuntimeError(f"{info.name}: VERSION={module.VERSION} fayl raqamiga mos emas")
        found.append(module)
    found.sort(key=lambda mod: mod.VERSION)
    versions = [mod.VERSION for mod in found]
    if versions != list(range(1, len(versions) + 1)):
        raise RuntimeError(f"Migratsiya raqamlari uzluksiz emas: {versions}")
    return found
