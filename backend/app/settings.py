"""Sayt sozlamalari — super-admin "Sozlamalar" sahifasidan o'zgartiriladi.

Ro'yxat (kalit, turi, chegarasi, izohi) shu yerda; bazada (app_settings)
faqat standartdan farq qiladigan qiymatlar. Standart qiymat muhit
o'zgaruvchisidan (.env) olinadi — ya'ni sahifadan o'zgartirilmagan sozlama
avvalgidek ishlayveradi.

Hammasi server qayta ishga tushmasdan qo'llanadi: foydalanuvchi kodi
qiymatni har safar `site_settings.get(kalit)` bilan oladi (60 s kesh,
yozilganda darhol tozalanadi). Baza javob bermasa — standart qiymat.

Sozlamalar:
    site_name                 sayt nomi (yon menyu, sarlavha, kirish oynasi)
    timezone                  interfeys vaqt zonasi (IANA, standart Asia/Tashkent)
    language                  standart til: uz | uz-cyrl | ru | en
    ui_poll_s                 xarita va ro'yxat yangilanishi, 10–300 s (/auth/me poll_s)
    notify_outage             kamera uzilish/qaytish bildirishnomalari ko'rsatiladimi
    public_view               mehmon (kirmagan) xarita va oqimlarni ko'radimi
                              (interfeysda "guest_view" — /public/info)
    session_hours             sessiya muddati — yangi kirishlarga
    health_interval_s         kameralar holati qanchalik tez-tez tekshiriladi
    stall_after_s             ochiq oqim muzlagan deb hisoblanadigan sukunat
    transport_check_after_s   oqim ochilmasa TCP/UDP tekshiruvi boshlanadigan vaqt

Tarkibi:
    Setting                     bitta sozlama ta'rifi (dataclass); kind: str | bool | int |
                                choice (choices ro'yxatidan)
    SETTINGS                    kalit -> Setting (tartib — sahifadagi tartib)
    SiteSettings                xizmat: get(key), view(db), update(db, changes, actor)
    site_settings               yagona nusxa

Ishlatadi: database (settings), app.config (PUBLIC_VIEW standarti).
Kim ishlatadi: app/settings_api.py, app/deps.py (public_view), users/api.py
    (site_name, public_view, session_hours), camera/monitoring/health.py
    (health_interval_s), camera/media/reconciler.py (stall_after_s,
    transport_check_after_s).
"""
from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from database import get_db
from database import settings as settings_db

CACHE_TTL = 60.0


@dataclass(frozen=True)
class Setting:
    key: str
    group: str
    label: str
    help: str
    kind: str                         # str | bool | int | choice
    default: Callable[[], Any]
    minimum: int | None = None
    maximum: int | None = None
    unit: str = ""
    choices: tuple[str, ...] = ()     # kind == "choice" — ruxsat etilgan qiymatlar
    check: Callable[[str], bool] | None = None   # str uchun qo'shimcha tekshiruv

    def clean(self, value):
        """Qiymatni tekshiradi va turiga keltiradi; xato bo'lsa ValueError."""
        if self.kind == "choice":
            if value not in self.choices:
                raise ValueError(f"{self.label}: {' | '.join(self.choices)} dan biri boʻlsin")
            return value
        if self.kind == "bool":
            if not isinstance(value, bool):
                raise ValueError(f"{self.label}: ha/yoʻq boʻlishi kerak")
            return value
        if self.kind == "int":
            if isinstance(value, bool) or not isinstance(value, (int, float)) or int(value) != value:
                raise ValueError(f"{self.label}: butun son boʻlishi kerak")
            value = int(value)
            if self.minimum is not None and value < self.minimum or \
                    self.maximum is not None and value > self.maximum:
                raise ValueError(f"{self.label}: {self.minimum}–{self.maximum} oraligʻida boʻlsin")
            return value
        if not isinstance(value, str):
            raise ValueError(f"{self.label}: matn boʻlishi kerak")
        value = value.strip()
        if not value or (self.maximum and len(value) > self.maximum):
            raise ValueError(f"{self.label}: 1–{self.maximum} belgi")
        if self.check is not None and not self.check(value):
            raise ValueError(f"{self.label}: notoʻgʻri qiymat ({value})")
        return value


def _env_int(name: str, fallback: int) -> int:
    try:
        return int(float(os.environ.get(name, fallback)))
    except ValueError:
        return fallback


def _valid_tz(name: str) -> bool:
    """IANA vaqt zonasi nomi (Asia/Tashkent) — zoneinfo taniydimi."""
    try:
        ZoneInfo(name)
        return True
    except (ZoneInfoNotFoundError, ValueError):
        return False


def _public_view() -> bool:
    from app.config import PUBLIC_VIEW
    return PUBLIC_VIEW


SETTINGS: dict[str, Setting] = {s.key: s for s in (
    Setting("site_name", "Sayt", "Sayt nomi",
            "Yon menyu, brauzer sarlavhasi va kirish oynasidagi nom.",
            "str", lambda: "NIGOH", maximum=40),
    Setting("timezone", "Sayt", "Vaqt zonasi",
            "Interfeysda vaqtlar shu zonada koʻrsatiladi (IANA nomi, masalan Asia/Tashkent). "
            "Statistikadagi sana/soat guruhlash serverning NIGOH_TZ zonasida qoladi.",
            "str", lambda: "Asia/Tashkent", maximum=64, check=_valid_tz),
    Setting("language", "Sayt", "Til",
            "Interfeysning standart tili (foydalanuvchi oʻz profilida boshqasini tanlashi mumkin).",
            "choice", lambda: "uz", choices=("uz", "uz-cyrl", "ru", "en")),
    Setting("ui_poll_s", "Sayt", "Xarita va roʻyxat yangilanishi",
            "Xarita va kameralar roʻyxati shuncha soniyada bir yangilanadi.",
            "int", lambda: 30, minimum=10, maximum=300, unit="s"),
    Setting("notify_outage", "Kuzatuv", "Uzilish haqida bildirishnoma",
            "Kamera uzilgani va qayta ulangani bildirishnomalar roʻyxatida koʻrsatiladi.",
            "bool", lambda: True),
    Setting("public_view", "Kirish", "Mehmon koʻrishi",
            "Kirmagan foydalanuvchi xarita va jonli oqimlarni koʻra oladi (faqat koʻrish; "
            "dashboard, guruhlar va boshqaruv yopiq).",
            "bool", _public_view),
    Setting("session_hours", "Kirish", "Seans muddati",
            "Shuncha vaqtdan keyin qaytadan kirish kerak. Yangi kirishlarga qoʻllanadi.",
            "int", lambda: 12, minimum=1, maximum=168, unit="soat"),
    Setting("health_interval_s", "Kuzatuv", "Holat tekshiruvi oraligʻi",
            "Kameralar (RTSP porti) qanchalik tez-tez tekshiriladi. Kichik qiymat — uzilish "
            "tezroq bilinadi, lekin tarmoqqa (VPN tunnelga) yuk koʻproq.",
            "int", lambda: 60, minimum=30, maximum=600, unit="s"),
    Setting("stall_after_s", "Kuzatuv", "Tasvir toʻxtashi chegarasi",
            "Ochiq oqimda shuncha vaqt bitta bayt ham kelmasa — tasvir toʻxtagan hisoblanadi. "
            "Kalit kadrlar oraligʻi uzun kameralarda juda kichik qiymat soxta ogohlantirish beradi.",
            "int", lambda: _env_int("STALL_AFTER", 20), minimum=10, maximum=300, unit="s"),
    Setting("transport_check_after_s", "Kuzatuv", "Uzatish usulini tekshirish",
            "Oqim shuncha vaqt ochilmasa (yoki buzuq kadr bersa) TCP va UDP sinab koʻriladi "
            "va yaxshisi tanlanadi.",
            "int", lambda: _env_int("TRANSPORT_CHECK_AFTER", 45), minimum=20, maximum=600, unit="s"),
)}


class SiteSettings:
    """Sozlamalar xizmati: keshli o'qish, tekshirib yozish."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._values: dict | None = None
        self._loaded_at = 0.0

    def _stored(self) -> dict:
        now = time.monotonic()
        with self._lock:
            if self._values is not None and now - self._loaded_at < CACHE_TTL:
                return self._values
        try:
            with get_db() as db:
                values = settings_db.all(db)
        except Exception:                 # baza band/yo'q — standart qiymatlar
            values = {}
        with self._lock:
            self._values, self._loaded_at = values, now
        return values

    def get(self, key: str):
        setting = SETTINGS[key]
        stored = self._stored()
        if key in stored:
            try:
                return setting.clean(stored[key])
            except ValueError:            # bazadagi eski/buzuq qiymat — standart
                pass
        return setting.default()

    def invalidate(self) -> None:
        with self._lock:
            self._values = None

    def view(self, db) -> list[dict]:
        """Sahifa uchun: har sozlama ta'rifi, joriy va standart qiymati."""
        stored, meta = settings_db.all(db), settings_db.meta(db)
        out = []
        for s in SETTINGS.values():
            default = s.default()
            value = self.get(s.key) if s.key in stored else default
            at, by = meta.get(s.key, (None, ""))
            out.append({"key": s.key, "group": s.group, "label": s.label, "help": s.help,
                        "kind": s.kind, "min": s.minimum, "max": s.maximum, "unit": s.unit,
                        "choices": list(s.choices) or None,
                        "value": value, "default": default, "changed": s.key in stored,
                        "updated_at": at, "updated_by": by})
        return out

    def update(self, db, changes: dict, actor: str) -> tuple[dict, dict]:
        """O'zgarishlarni tekshirib yozadi. `None` — standartga qaytarish.

        Hammasi tekshirilgandan keyingina yoziladi (bittasi xato bo'lsa hech
        biri saqlanmaydi). Qaytaradi: (oldin, keyin) — audit uchun, faqat
        haqiqatan o'zgarganlari.
        """
        unknown = [k for k in changes if k not in SETTINGS]
        if unknown:
            raise ValueError(f"Nomaʼlum sozlama: {', '.join(unknown)}")
        cleaned = {k: (None if v is None else SETTINGS[k].clean(v)) for k, v in changes.items()}
        before, after = {}, {}
        for key, value in cleaned.items():
            old = self.get(key)
            new = SETTINGS[key].default() if value is None else value
            if value is None:
                settings_db.reset(db, key)
            else:
                settings_db.set(db, key, value, actor)
            if old != new:
                before[key], after[key] = old, new
        self.invalidate()
        return before, after


site_settings = SiteSettings()
