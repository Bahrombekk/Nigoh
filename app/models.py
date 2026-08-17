"""Nigoh — so'rov modellari (Pydantic)."""
from fastapi import HTTPException
from pydantic import BaseModel, Field, field_validator


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=200)


class CameraIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    region: str = Field(min_length=1, max_length=120)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    source_type: str = "rtsp"          # "rtsp" | "manual"
    enabled: bool = True
    # Standart holda o'chiq: kamera faqat kimdir ko'rganda ulanadi. Aks holda
    # kameralar soni ortishi bilan tarmoq ham, GPU ham tugaydi.
    always_on: bool = False
    note: str = Field(default="", max_length=500)

    # RTSP kamera uchun
    ip: str = Field(default="", max_length=100)
    port: int = Field(default=554, ge=1, le=65535)
    username: str = Field(default="", max_length=100)
    password: str | None = None        # None = o'zgartirilmasin
    rtsp_path: str = Field(default="/stream1", max_length=300)
    vendor: str = Field(default="boshqa", max_length=40)

    # Tayyor oqim manzili uchun
    stream_url: str = Field(default="", max_length=500)

    @field_validator("source_type")
    @classmethod
    def _check_source(cls, v: str) -> str:
        if v not in ("rtsp", "manual"):
            raise ValueError("source_type faqat 'rtsp' yoki 'manual' bo'lishi mumkin")
        return v

    def validate_complete(self) -> None:
        if self.source_type == "rtsp" and not self.ip.strip():
            raise HTTPException(400, "IP manzil kiritilmagan")
        if self.source_type == "manual" and not self.stream_url.strip():
            raise HTTPException(400, "Oqim manzili kiritilmagan")


class NvrIn(BaseModel):
    """Bitta NVR/registratordagi kanallarni birdaniga qo'shish.

    1000 ta kamerani qo'lda kiritib bo'lmaydi — odatda ular 30-40 ta
    registratorga ulangan bo'ladi, har birida 16-64 kanal.
    """
    ip: str = Field(min_length=1, max_length=100)
    port: int = Field(default=554, ge=1, le=65535)
    username: str = Field(default="", max_length=100)
    password: str = Field(default="", max_length=200)
    vendor: str = Field(default="hikvision", max_length=40)
    channels: str = Field(default="1-16", max_length=200)   # "1-16" yoki "1,3,5-8"
    region: str = Field(min_length=1, max_length=120)
    name_prefix: str = Field(default="", max_length=100)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    spread_m: int = Field(default=120, ge=0, le=5000)  # nuqtalar bir-birini bosmasin
    stream: str = Field(default="main")                # "main" | "sub"
    enabled: bool = True
    probe: bool = True                                 # kodekni tekshirib olsinmi
    dry_run: bool = False                              # avval ko'rsatib bersin


class ProbeIn(BaseModel):
    ip: str = Field(min_length=1, max_length=100)
    port: int = Field(default=554, ge=1, le=65535)
    username: str = Field(default="", max_length=100)
    password: str | None = None
    rtsp_path: str = Field(default="/stream1", max_length=300)
    camera_id: int | None = None       # saqlangan parolni ishlatish uchun


class ScanIn(BaseModel):
    """Qurilmani avtomatik aniqlash: IP+login yetadi, qolganini skaner topadi."""
    ip: str = Field(min_length=1, max_length=100)
    port: int = Field(default=554, ge=1, le=65535)
    username: str = Field(default="", max_length=100)
    password: str = Field(default="", max_length=200)
    max_channels: int = Field(default=64, ge=1, le=256)
    camera_id: int | None = None       # tahrirlashda saqlangan parolni ishlatish
