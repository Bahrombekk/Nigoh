"""Raqamlangan migratsiyalar: har biri `NNNN_nom.py` fayli.

Har bir modulda `VERSION` (fayl raqami bilan bir xil) va `apply(db)` bor.
Bajarilgan migratsiya HECH QACHON tahrirlanmaydi — yangi o'zgarish yangi
raqamli fayl bilan qo'shiladi.
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
