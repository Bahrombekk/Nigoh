"""Kameralarni fonda kuzatuvchi xizmatlar.

Har xizmat — klass va modul darajasidagi yagona nusxa `service`; tashqi
kod uning ochiq aliaslarini chaqiradi (`health.online(...)`,
`snapshots.read(...)`). Fon thread'lari app/bootstrap.py da ishga
tushiriladi.

Tarkibi:
    health.py       HealthMonitor — tiriklik (TCP, har 60 s), SSE `state`
    snapshots.py    SnapshotService — diskdagi suratlar, issiq/sovuq yangilash
    passport.py     PassportChecker — bo'sh kodek/model'ni fonda to'ldirish
    open_times.py   pleyer ochilish vaqti (p50/p95) xotira buferida

Kim ishlatadi: app (bootstrap, /health, system_api), camera.api, camera.state,
stats, database/scripts/fix_camera_data.py
"""
