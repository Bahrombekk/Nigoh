"""Kunlik log fayllari: sana nomli fayl, hajm bo'yicha bo'linish, eski fayllarni tozalash.

Nima uchun standart RotatingFileHandler emas. U faylni QAYTA NOMLAYDI
(`nigoh.log` -> `nigoh.log.1`). Windows'da ochiq fayl qayta nomlanmaydi:
ikkinchi jarayon (stream_launcher, testlar, `--reload`) shu faylni ochib
qo'ygan bo'lsa aylantirish jimgina yiqiladi va fayl cheksiz o'sadi
(2026-10-06: nigoh.log 3,5 MB, mediamtx.log 12,8 MB — hech biri
aylanmagan). Bu handler hech narsani qayta nomlamaydi:

    logs/camera/camera-2026-10-06.jsonl      bugungi fayl
    logs/camera/camera-2026-10-06.1.jsonl    bugun MAX_BYTES dan oshgani
    logs/camera/camera-2026-10-05.jsonl      kecha

Sana o'zgarsa yoki fayl to'lsa — shunchaki YANGI nomli fayl ochiladi.
Bir nechta jarayon bitta faylga qo'shib yozishi (append) xavfsiz.
Saqlash muddatidan eski fayllar kuniga bir marta o'chiriladi.

Tarkibi:
    DailyFileHandler(directory, prefix, retention_days, max_bytes, suffix=".jsonl")
        .emit(record)        yozadi (kerak bo'lsa yangi faylga o'tadi)
        .cleanup()           muddati o'tgan fayllarni o'chiradi
        .current_path        hozir yozilayotgan fayl

Kim ishlatadi: core/logs/setup.py.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from datetime import date, timedelta
from pathlib import Path


class DailyFileHandler(logging.Handler):
    def __init__(self, directory: Path, prefix: str, retention_days: int, max_bytes: int,
                 suffix: str = ".jsonl") -> None:
        super().__init__()
        self.directory = Path(directory)
        self.prefix = prefix
        self.suffix = suffix
        self.retention_days = retention_days
        self.max_bytes = max_bytes
        self._day: date | None = None
        self._part = 0
        self._stream = None
        self._path: Path | None = None
        self._io_lock = threading.Lock()
        self._last_cleanup = 0.0
        self._name_re = re.compile(
            rf"^{re.escape(prefix)}-(\d{{4}}-\d{{2}}-\d{{2}})(?:\.\d+)?{re.escape(suffix)}$")

    @property
    def current_path(self) -> Path | None:
        return self._path

    def _path_for(self, day: date, part: int) -> Path:
        tail = f".{part}" if part else ""
        return self.directory / f"{self.prefix}-{day.isoformat()}{tail}{self.suffix}"

    def _open(self, day: date) -> None:
        if self._stream is not None:
            self._stream.close()
        self.directory.mkdir(parents=True, exist_ok=True)
        if day != self._day:
            self._day, self._part = day, 0
            # Restartdan keyin: bugungi to'lgan bo'laklardan keyingisiga o'tamiz.
            while self._path_for(day, self._part).exists() and \
                    self._path_for(day, self._part).stat().st_size >= self.max_bytes:
                self._part += 1
        self._path = self._path_for(day, self._part)
        self._stream = open(self._path, "a", encoding="utf-8")

    def emit(self, record: logging.LogRecord) -> None:
        try:
            line = self.format(record)
            today = date.fromtimestamp(record.created)
            with self._io_lock:
                if self._stream is None or today != self._day:
                    self._open(today)
                elif self._stream.tell() >= self.max_bytes:
                    self._part += 1
                    self._open(today)
                self._stream.write(line + "\n")
                self._stream.flush()
            if time.monotonic() - self._last_cleanup > 3600:
                self.cleanup()
        except Exception:                      # noqa: BLE001 — log hech qachon ilovani yiqitmasin
            self.handleError(record)

    def cleanup(self) -> int:
        """Saqlash muddatidan eski fayllarni o'chiradi; o'chirilganlar soni."""
        self._last_cleanup = time.monotonic()
        cutoff = date.today() - timedelta(days=self.retention_days)
        removed = 0
        try:
            files = list(self.directory.glob(f"{self.prefix}-*{self.suffix}"))
        except OSError:
            return 0
        for f in files:
            m = self._name_re.match(f.name)
            if not m or f == self._path:
                continue
            try:
                if date.fromisoformat(m.group(1)) < cutoff:
                    f.unlink()
                    removed += 1
            except (OSError, ValueError):
                pass
        return removed

    def close(self) -> None:
        with self._io_lock:
            if self._stream is not None:
                self._stream.close()
                self._stream = None
        super().close()
