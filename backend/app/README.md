# app/ — ilovani yig'ish

```
app/
├─ __init__.py    ataylab bo'sh: create_app shu yerda bo'lsa `import app.config` butun ilovani yuklab aylanma import beradi
├─ factory.py     create_app(): routerlarni /api/v1 va eski /api ostida ulaydi, kirish darajalari, CSP, GZip, frontend
├─ config.py      sozlamalar (.env): PORT, FRONTEND_DIR, PUBLIC_VIEW, NIGOH_API_KEY, media portlari, VENDORS
├─ deps.py        kirish dependency'lari: key_guard, require_viewer, require_user
├─ bootstrap.py   ishga tushish: init_db, fon xizmatlari, mediamtx.yml, super-admin; --admin-parol
├─ network.py     ishonchli proksilar (TRUSTED_PROXIES) va client_ip
├─ health.py      GET /health — kalitsiz, Docker HEALTHCHECK
├─ system_api.py  GET /admin/runtime, /admin/status — faqat admin
├─ system_state.py  tizim holati hisobi (api, db, mediamtx, health, disk, network), 5 s kesh
├─ public_api.py  GET /public/info (kirishsiz), GET /system/state (require_viewer, ichki manzilsiz)
├─ settings.py settings_api.py audit.py  sayt sozlamalari (v3: timezone, language, ui_poll_s,
│                 notify_outage), /admin/settings, /admin/audit, audit yozuvi
└─ logs_api.py    GET /admin/logs, /admin/logs/summary, /admin/logs/files — faqat admin (docs/LOGGING.md)
```

Qanday birlashadi: `main.py` avval `bootstrap()` ni, keyin `create_app()` ni
chaqiradi. `create_app()` mavzu paketlarining routerlarini (`camera/api/`,
`stats/`, `users/`, `walls/`, `database/api.py`, shu papkadagi `health` va
`system_api`) ulaydi va har biriga daraja beradi: auth — kirishsiz, ko'rish —
`require_viewer`, dashboard — `require_user`, boshqaruv — `key_guard` (+
routerdagi `users.access.require_admin`). `deps.py` kalit va sessiyani
`users/access.py` orqali, mijoz manzilini `network.py` orqali tekshiradi.
