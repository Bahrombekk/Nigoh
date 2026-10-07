"""Nigoh — foydalanuvchi so'rov modellari (Pydantic; ilgari api/models.py da edi).

Tarkibi:
    LoginIn     POST /auth/login tanasi: username (1-64), password (1-200)
    UserIn      POST/PUT /admin/users tanasi: username, password (None —
                o'zgarmasin), role (admin | operator, standart operator),
                regions (operator uchun hudud nomlari)

Kim ishlatadi: users/api.py (LoginIn), users/admin_api.py (UserIn).
"""
from pydantic import BaseModel, Field


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=200)


class UserIn(BaseModel):
    """Foydalanuvchi: 'admin' hammasini boshqaradi, 'operator' faqat
    o'ziga biriktirilgan hududlardagi kameralarni ko'radi."""
    username: str = Field(min_length=1, max_length=64)
    password: str | None = Field(default=None, max_length=200)  # None = o'zgarmasin
    role: str = Field(default="operator", pattern="^(admin|operator)$")
    full_name: str = Field(default="", max_length=120)
    is_active: bool = True                              # False — kira olmaydi (bloklangan)
    regions: list[str] = Field(default_factory=list)   # operator uchun
