"""Nigoh — so'rov modellari (Pydantic).

Kamera/probe/skan modellari endi bu yerda emas — o'sha so'rovlar tanasi
o'zgarishsiz mikroservisga uzatiladi va u yerda tekshiriladi. Bu yerda
faqat shu tizim o'zi saqlaydigan narsalar: kirish va foydalanuvchilar.
"""
from pydantic import BaseModel, Field


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=200)


class UserIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str | None = Field(default=None, max_length=200)  # None = o'zgarmasin
    role: str = Field(default="operator", pattern="^(admin|operator)$")
    regions: list[str] = Field(default_factory=list)   # operator uchun
