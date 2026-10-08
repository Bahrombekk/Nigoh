# users/ — foydalanuvchilar va kirish

```
users/
├─ api.py         /auth/login (remember, 5 xato -> 5 daqiqa blok), logout, me, me/prefs, password;
│                 /auth/stream (MediaMTX) va /auth/hls (nginx) chipta tekshiruvi
├─ admin_api.py   /admin/users CRUD (+ reset-password), /admin/regions — faqat admin;
│                 rollar: admin, operator, viewer (Kuzatuvchi — faqat ko'radi)
├─ access.py      api_key_ok, current_user, require_admin, allowed_areas, check_area
└─ schemas.py     LoginIn, UserIn
```

Qanday birlashadi: `api.py` login'da `core/security.py` bilan sessiya
ochadi (cookie `nigoh_session`), xato urinishlarni `core/throttle.py`
sekinlashtiradi. `access.py` sessiya yoki `X-API-Key` dan foydalanuvchini
aniqlaydi — uni `app/deps.py` va barcha boshqaruv routerlari ishlatadi;
operator va kuzatuvchi hududi cheklovi (`allowed_areas` + `check_area`) endpointlar ichida.
`admin_api.py` foydalanuvchi va operator hududlarini boshqaradi (oxirgi admin
saqlanadi). SQL — `database/repositories/users.py`.
