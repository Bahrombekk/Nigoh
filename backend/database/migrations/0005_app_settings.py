"""5-migratsiya: sayt sozlamalari va audit jurnalini tuzatish.

1. `app_settings` — super-admin "Sozlamalar" sahifasidan o'zgartiriladigan
   sozlamalar (sayt nomi, mehmon ko'rishi, sessiya muddati, holat
   tekshiruvi vaqtlari ...). Kalitlar va ularning turi/chegarasi kodda
   (app/settings.py); bazada faqat standartdan farq qiladigan qiymatlar
   turadi. Server qayta ishga tushmasdan qo'llanadi.

2. `audit_log.user_id` tashqi kaliti olib tashlanadi. Jadval faqat
   yoziladi (forbid_change trigger: UPDATE/DELETE taqiqlangan), kalit esa
   `ON DELETE SET NULL` edi — audit yozuvi bor foydalanuvchini o'chirish
   UPDATE chaqirib, trigger xatosi bilan yiqilardi. Endi id tarix sifatida
   qoladi (kim ekani `actor` da ham bor).

Tarkibi:
    VERSION = 5
    apply(db)

Jadvallar: app_settings (yangi), audit_log (FK olib tashlandi)
Kim ishlatadi: database/migrations/__init__.py (load) -> database/schema.py;
repositories/settings.py va repositories/audit.py.
"""

VERSION = 5


def apply(db) -> None:
    db.execute("""
        CREATE TABLE app_settings (
            key         TEXT PRIMARY KEY CHECK (key ~ '^[a-z_]+$'),
            value       JSONB NOT NULL,
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_by  TEXT NOT NULL DEFAULT ''
        )""")
    db.execute("COMMENT ON TABLE app_settings IS "
               "'Sayt sozlamalari (app/settings.py ro''yxati); faqat standartdan farqlilari'")
    db.execute("ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_user_id_fkey")
