"""Nigoh — foydalanuvchilar, rollar va kirish.

    api.py         /auth/* — login/logout/me; MediaMTX (/auth/stream) va
                   nginx (/auth/hls) uchun oqim chiptasi tekshiruvi
    admin_api.py   /admin/users CRUD, /admin/regions (faqat admin)
    access.py      huquqlar: API kaliti, joriy foydalanuvchi, require_admin,
                   operator hududlari
    schemas.py     so'rov modellari (LoginIn, UserIn)

Rollar: `admin` hammasini ko'radi va boshqaradi; `operator` faqat o'ziga
biriktirilgan hududlardagi kameralarni ko'radi. Parol xeshi, sessiyalar va
chiptalar mexanikasi — core/security.py; SQL — database/repositories/users.py.
"""
