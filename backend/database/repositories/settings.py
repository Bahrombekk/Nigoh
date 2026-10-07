"""Sayt sozlamalari repozitoriysi — app_settings jadvali.

Bazada faqat standartdan farq qiladigan qiymatlar turadi; kalitlar ro'yxati,
turi va chegaralari app/settings.py da. Tekshiruv ham o'sha yerda — bu
yerda faqat SQL.

Tarkibi:
    SettingsRepository
        .all(db)                        {kalit: qiymat} (JSON'dan)
        .meta(db)                       {kalit: (updated_at, updated_by)}
        .set(db, key, value, actor)     yozadi yoki yangilaydi
        .reset(db, key)                 o'chiradi (standartga qaytadi)

Jadvallar: app_settings (0005_app_settings.py)
Kim ishlatadi: app/settings.py.
"""
from __future__ import annotations

from psycopg.types.json import Jsonb


class SettingsRepository:
    """app_settings — kalit/qiymat (JSONB)."""

    def all(self, db) -> dict:
        return {r["key"]: r["value"] for r in db.execute("SELECT key, value FROM app_settings")}

    def meta(self, db) -> dict:
        return {r["key"]: (r["updated_at"], r["updated_by"])
                for r in db.execute("SELECT key, updated_at, updated_by FROM app_settings")}

    def set(self, db, key: str, value, actor: str) -> None:
        db.execute(
            "INSERT INTO app_settings (key, value, updated_by) VALUES (%s, %s, %s) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "
            "updated_by = EXCLUDED.updated_by, updated_at = now()",
            (key, Jsonb(value), actor))

    def reset(self, db, key: str) -> None:
        db.execute("DELETE FROM app_settings WHERE key = %s", (key,))
