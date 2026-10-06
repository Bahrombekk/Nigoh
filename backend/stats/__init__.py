"""Nigoh — statistika: dashboard tarixi, ko'rsatkichlar, uzilishlar tahlili.

    api.py          /stats/* — har ko'rsatkich alohida endpoint (require_user)
    overview.py     /stats/overview yig'ma hisoboti (api.py chaqiradi)
    admin_api.py    /admin/uptime, /admin/outages/hourly,
                    /admin/cameras/{ref}/history (require_admin)
    recorder.py     StatsRecorder — har daqiqada holatlarni tarixga yozadi
    reporting/      sof hisob qatlami: period, engine, metrics

Ma'lumot oqimi: recorder.py -> availability_snapshots / status_changes
(database/repositories/stats.py); health va reconciler -> camera_events.
reporting/ shu jadvallardan (database/repositories/reports.py) davr
bo'yicha uzilishlarni hisoblaydi, api.py va overview.py javobga aylantiradi.
admin_api.py esa camera_events'ni bevosita o'qiydi
(database/repositories/events.py). Hammasi 30 kun saqlanadi.
"""
