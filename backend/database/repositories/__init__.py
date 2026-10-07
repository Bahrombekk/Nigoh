"""Repozitoriylar — bazaga murojaatning yagona joyi (har jadval guruhi — bitta klass).

Har modulda bitta klass va bu yerda uning bitta nusxasi yaratiladi:

    areas    AreaRepository       admin_areas — viloyat/tuman, chegaralar
    audit    AuditRepository      audit_log — kim nimani o'zgartirdi (faqat yoziladi)
    cameras  CameraRepository     cameras + devices + camera_status, slug, pasport
    events   EventRepository      camera_events — oqim/holat hodisalari
    geo      GeoRepository        nuqta hudud ichidami (geometriya)
    groups   GroupRepository      camera_groups — foydalanuvchi kamera guruhlari
    nodes    MediaNodeRepository  media_nodes — MediaMTX tugunlari
    rail     RailRepository       rail_lines / rail_units — km, piket
    reports  ReportRepository     hisobot uchun xom qatorlar (bo'shliq, o'tish, sifat)
    settings SettingsRepository   app_settings — sayt sozlamalari
    stats    StatsRepository      availability_snapshots, status_changes
    users    UserRepository       users, sessions, user_admin_areas
    walls    WallRepository       video_walls

Ishlatish (chaqiruvchi tranzaksiyani o'zi ochadi):

    from database import cameras, get_db
    with get_db() as db:
        row = cameras.get(db, 42)

Tartib muhim: `users` -> `areas` ga, `reports` -> `cameras`, `rail` ga tayanadi,
shuning uchun ular o'zlaridan oldin yaratilgan bo'lishi kerak (shu sabab
importlar uch bosqichda, `# noqa: E402` bilan).

Klasslar holatsiz: har metod birinchi argument sifatida ulanishni (`db`)
oladi. Istisno — cameras'dagi sub oqim yordamchilari (set_sub_bad,
cameras_by_slug ...) ulanishni o'zi ochadi.

Ishlatadi: database.repositories.* modullari
Kim ishlatadi: database/__init__.py (qayta eksport); repositories/users.py
(areas) va repositories/reports.py (cameras, rail) bir-birini shu yerdan oladi.
"""
from database.repositories.areas import AreaRepository
from database.repositories.audit import AuditRepository
from database.repositories.geo import GeoRepository

areas = AreaRepository()
audit = AuditRepository()
geo = GeoRepository()

from database.repositories.cameras import CameraRepository  # noqa: E402
from database.repositories.events import EventRepository  # noqa: E402
from database.repositories.groups import GroupRepository  # noqa: E402
from database.repositories.nodes import MediaNodeRepository  # noqa: E402
from database.repositories.rail import RailRepository  # noqa: E402

cameras = CameraRepository()
events = EventRepository()
groups = GroupRepository()
nodes = MediaNodeRepository()
rail = RailRepository()

from database.repositories.reports import ReportRepository  # noqa: E402
from database.repositories.settings import SettingsRepository  # noqa: E402
from database.repositories.stats import StatsRepository  # noqa: E402
from database.repositories.users import UserRepository  # noqa: E402
from database.repositories.walls import WallRepository  # noqa: E402

reports = ReportRepository()
settings = SettingsRepository()
stats = StatsRepository()
users = UserRepository()
walls = WallRepository()

__all__ = ["areas", "audit", "cameras", "events", "geo", "groups", "nodes", "rail", "reports", "settings", "stats",
           "users", "walls"]
