"""Ilovani yig'ish paketi (app/).

Bu fayl ATAYLAB bo'sh: `create_app` `app/factory.py` da. Agar u shu yerda
bo'lsa, `import app.config` (masalan camera/api/admin.py dan) butun ilovani —
barcha routerlarni — yuklab yuborardi va aylanma import paydo bo'lardi:
camera.api.admin -> app.config -> app/__init__ -> camera.api.admin.

    from app.factory import create_app

Tarkibi: factory.py (create_app), bootstrap.py, config.py, deps.py,
network.py, health.py, system_api.py — batafsil: app/README.md.
"""
