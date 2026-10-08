"""Nigoh — foydalanuvchi so'rov modellari (Pydantic; ilgari api/models.py da edi).

Tarkibi:
    LoginIn     POST /auth/login tanasi: username (1-64), password (1-200),
                remember (True — sessiya 30 kun)
    PasswordIn  POST /auth/password tanasi: current, new
    UserIn      POST/PUT /admin/users tanasi: username, password (None —
                o'zgarmasin), role (admin | operator | viewer, standart operator),
                regions (operator va kuzatuvchi uchun hudud nomlari)

Kim ishlatadi: users/api.py (LoginIn, PasswordIn), users/admin_api.py (UserIn).
"""
from pydantic import BaseModel, Field


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=200)
    remember: bool = False                              # True — sessiya 30 kun


class PasswordIn(BaseModel):
    """O'z parolini almashtirish: joriy va yangi parol."""
    current: str = Field(min_length=1, max_length=200)
    new: str = Field(min_length=1, max_length=200)


class UserIn(BaseModel):
    """Foydalanuvchi: 'admin' hammasini boshqaradi, 'operator' faqat
    o'ziga biriktirilgan hududlardagi kameralarni ko'radi, 'viewer'
    (Kuzatuvchi) — o'z hududlarini faqat ko'radi (guruh yarata olmaydi)."""
    username: str = Field(min_length=1, max_length=64)
    password: str | None = Field(default=None, max_length=200)  # None = o'zgarmasin
    role: str = Field(default="operator", pattern="^(admin|operator|viewer)$")
    full_name: str = Field(default="", max_length=120)
    is_active: bool = True                              # False — kira olmaydi (bloklangan)
    regions: list[str] = Field(default_factory=list)   # operator va kuzatuvchi uchun
