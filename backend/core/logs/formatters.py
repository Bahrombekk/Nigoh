"""Log yozuvini satrga aylantirish: fayl uchun JSON, konsol uchun odam o'qiydigan.

JSON satr (JSON Lines — har satr mustaqil obyekt, `jq`, Loki, OpenSearch
to'g'ridan-to'g'ri o'qiydi):

    {"ts": "2026-10-06T10:47:00.123+05:00", "level": "WARNING",
     "category": "camera", "service": "snapshots", "event": "backlog",
     "request_id": "a1b2c3d4e5f6", "due": 117, "limit": 96}

  * `ts` — mahalliy vaqt (NIGOH_TZ) millisekund bilan; zonasi satrda bor,
    shuning uchun UTC'ga aylantirish bir ma'noli;
  * kontekst (request_id, user ...) avtomatik qo'shiladi (core/logs/context.py);
  * maxfiy maydonlar yozishdan OLDIN yashiriladi (core/logs/redact.py);
  * istisno bo'lsa — `error_type` va to'liq `traceback`.

Konsol satri (start.bat oynasi):

    10:47:00 WARN  camera/snapshots  backlog · due=117 limit=96

Rang faqat haqiqiy terminalda (fayl yoki quvurga yo'naltirilganda — yo'q).

Tarkibi:
    JsonFormatter       fayl uchun
    ConsoleFormatter    konsol uchun (color=True — ANSI ranglar)

Kim ishlatadi: core/logs/setup.py.
"""
from __future__ import annotations

import json
import logging
import os
import traceback
from datetime import datetime
from zoneinfo import ZoneInfo

from core.logs import context
from core.logs.redact import redact, redact_text

try:
    # Baza bilan bir xil zona (database/connection.py ham NIGOH_TZ ni o'qiydi).
    # core/ database/ ga bog'lanmaydi — shuning uchun muhitdan to'g'ridan-to'g'ri.
    _TZ = ZoneInfo(os.environ.get("NIGOH_TZ", "Asia/Tashkent"))
except Exception:            # noqa: BLE001 — noto'g'ri zona logni to'xtatmasin
    _TZ = None

_SHORT = {"DEBUG": "DEBUG", "INFO": "INFO ", "WARNING": "WARN ", "ERROR": "ERROR",
          "CRITICAL": "CRIT "}
_COLOR = {"DEBUG": "\033[2m", "WARNING": "\033[33m", "ERROR": "\033[31m",
          "CRITICAL": "\033[1;31m"}


def _fields(record: logging.LogRecord) -> dict:
    return getattr(record, "fields", None) or {}


def _service(record: logging.LogRecord) -> str:
    return getattr(record, "service", None) or record.name.rsplit(".", 1)[-1]


def _category(record: logging.LogRecord) -> str:
    return getattr(record, "category", None) or "app"


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        stamp = datetime.fromtimestamp(record.created, _TZ)
        data = {
            "ts": stamp.isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "category": _category(record),
            "service": _service(record),
            "event": redact_text(record.getMessage()),
        }
        data.update(context.current())
        data.update(redact(_fields(record)))
        if record.exc_info and record.exc_info[0] is not None:
            data["error_type"] = record.exc_info[0].__name__
            data["traceback"] = redact_text("".join(traceback.format_exception(*record.exc_info)))
        return json.dumps(data, ensure_ascii=False, default=str)


class ConsoleFormatter(logging.Formatter):
    def __init__(self, color: bool = False) -> None:
        super().__init__()
        self.color = color

    def format(self, record: logging.LogRecord) -> str:
        stamp = datetime.fromtimestamp(record.created).strftime("%H:%M:%S")
        level = _SHORT.get(record.levelname, record.levelname[:5])
        fields = redact(_fields(record))
        extra = " ".join(f"{k}={v}" for k, v in fields.items())
        where = f"{_category(record)}/{_service(record)}"
        line = f"{stamp} {level} {where:<18} {redact_text(record.getMessage())}"
        if extra:
            line += f" · {extra}"
        if record.exc_info and record.exc_info[0] is not None:
            line += f" · {record.exc_info[0].__name__}: {record.exc_info[1]}"
        if self.color and record.levelname in _COLOR:
            line = f"{_COLOR[record.levelname]}{line}\033[0m"
        return line
