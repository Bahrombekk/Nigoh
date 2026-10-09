"""Log tizimini yig'ish: toifa loggerlari, yig'ma `errors`, konsol, uvicorn, istisnolar.

Daraxt:

    nigoh                       (propagate=False — uvicorn root'iga oqmaydi)
    ├─ handler: errors/         WARNING+ hamma toifadan (yig'ma)
    ├─ handler: konsol          LOG_CONSOLE_LEVEL (access — faqat WARNING+)
    ├─ nigoh.app       -> logs/app/app-YYYY-MM-DD.jsonl
    ├─ nigoh.camera    -> logs/camera/...
    ├─ nigoh.stats     -> logs/stats/...
    ├─ nigoh.security  -> logs/security/...   (90 kun)
    ├─ nigoh.database  -> logs/database/...   (90 kun)
    └─ nigoh.access    -> logs/access/...     (14 kun)

uvicorn: `uvicorn.error` (ishga tushish, ushlanmagan xatolar va ularning
traceback'i) -> app toifasi; `uvicorn.access` O'CHIRILADI — so'rovlarni
app/factory.py dagi middleware request_id, vaqt va IP bilan `access` ga
yozadi. Ilgari har bir 200/304 javob konsolni to'ldirardi va muhim
xabar ko'rinmay qolardi.

Ushlanmagan istisnolar (asosiy va fon thread'lari) — CRITICAL, traceback
bilan; aks holda fon xizmati jimgina o'lib, sababi hech qayerda qolmasdi.

Eski fayllar: repo ildizidagi `nigoh.log*` birinchi ishga tushishda
`logs/archive/` ga ko'chiriladi (band bo'lsa — keyingi safar).

Tarkibi:
    configure(console=True) -> Path     tizimni quradi (takror chaqiruv xavfsiz); LOG_DIR
    log(service, event, level="info", exc_info=None, **fields)
                                        bitta hodisa (core/log.py shu yerga uzatadi)
    logger_for(category)                toifa loggeri
    handlers() -> dict                  toifa -> DailyFileHandler (status/API uchun)

Kim ishlatadi: core/log.py (log), main.py (configure), app/logs_api.py.
"""
from __future__ import annotations

import logging
import shutil
import sys
import threading
from pathlib import Path

from core.logs import config
from core.logs.formatters import ConsoleFormatter, JsonFormatter
from core.logs.handlers import DailyFileHandler

_lock = threading.Lock()
_configured = False
_handlers: dict[str, DailyFileHandler] = {}


class _Tag(logging.Filter):
    """Tashqi loggerlar (uvicorn, warnings) yozuviga toifa va service qo'yadi."""

    def __init__(self, category: str, service: str) -> None:
        super().__init__()
        self.category, self.service = category, service

    def filter(self, record: logging.LogRecord) -> bool:
        if not getattr(record, "category", None):
            record.category = self.category
            record.service = self.service
        return True


class _ConsoleGate(logging.Filter):
    """Konsolga access toifasidan faqat WARNING+ (4xx/5xx) chiqadi."""

    def filter(self, record: logging.LogRecord) -> bool:
        if getattr(record, "category", "") == "access":
            return record.levelno >= logging.WARNING
        return True


def _file_handler(category: str) -> DailyFileHandler:
    h = DailyFileHandler(config.LOG_DIR / category, category,
                         config.CATEGORIES[category]["retention"], config.MAX_BYTES)
    h.setFormatter(JsonFormatter())
    return h


def _archive_legacy() -> None:
    """Ildizdagi eski nigoh.log* ni logs/archive/ ga ko'chiradi (bir marta)."""
    root = config.LOG_DIR.parent
    old = sorted(root.glob("nigoh.log*"))
    if not old:
        return
    target = config.LOG_DIR / "archive"
    target.mkdir(parents=True, exist_ok=True)
    for f in old:
        try:
            shutil.move(str(f), str(target / f.name))
        except OSError:
            pass                    # boshqa jarayon (eski server) ushlab turibdi — keyingi safar


def _hook_exceptions() -> None:
    def main_hook(exc_type, exc, tb):
        if issubclass(exc_type, KeyboardInterrupt):
            return sys.__excepthook__(exc_type, exc, tb)
        log("app", "uncaught_exception", level="critical", exc_info=(exc_type, exc, tb))

    def thread_hook(args):
        if args.exc_type is SystemExit:
            return
        log("app", "thread_crashed", level="critical",
            exc_info=(args.exc_type, args.exc_value, args.exc_traceback),
            thread=args.thread.name if args.thread else "?")

    sys.excepthook = main_hook
    threading.excepthook = thread_hook


def configure(console: bool = True) -> Path:
    global _configured
    with _lock:
        if _configured:
            return config.LOG_DIR
        config.LOG_DIR.mkdir(parents=True, exist_ok=True)
        _archive_legacy()

        root = logging.getLogger("nigoh")
        root.setLevel(config.LEVEL)
        root.propagate = False
        for h in list(root.handlers):
            root.removeHandler(h)

        errors = _file_handler("errors")
        errors.setLevel(logging.WARNING)
        root.addHandler(errors)
        _handlers["errors"] = errors

        console_handler = None
        if console:
            console_handler = logging.StreamHandler(sys.stdout)
            console_handler.setLevel(config.CONSOLE_LEVEL)
            console_handler.setFormatter(ConsoleFormatter(color=sys.stdout.isatty()))
            console_handler.addFilter(_ConsoleGate())
            root.addHandler(console_handler)

        for category in config.CATEGORIES:
            if category == "errors":
                continue
            lg = logging.getLogger(f"nigoh.{category}")
            lg.setLevel(config.LEVEL)
            lg.propagate = True
            for h in list(lg.handlers):
                lg.removeHandler(h)
            h = _file_handler(category)
            lg.addHandler(h)
            _handlers[category] = h

        # uvicorn: xatolar -> app toifasi (o'z handlerlari bilan), access -> o'chiq.
        uv = logging.getLogger("uvicorn.error")
        uv.handlers = [_handlers["app"], errors] + ([console_handler] if console_handler else [])
        uv.propagate = False
        uv.setLevel(logging.INFO)
        uv.filters = [_Tag("app", "server")]
        logging.getLogger("uvicorn").propagate = False
        acc = logging.getLogger("uvicorn.access")
        acc.handlers, acc.propagate, acc.disabled = [], False, True

        # Python ogohlantirishlari (DeprecationWarning va h.k.) ham logga.
        logging.captureWarnings(True)
        pw = logging.getLogger("py.warnings")
        pw.handlers = [_handlers["app"], errors]
        pw.filters = [_Tag("app", "python")]
        pw.propagate = False

        _hook_exceptions()
        _configured = True
    return config.LOG_DIR


def logger_for(category: str) -> logging.Logger:
    return logging.getLogger(f"nigoh.{category}")


def handlers() -> dict[str, DailyFileHandler]:
    return dict(_handlers)


def log(service: str, event: str, level: str = "info", exc_info=None, **fields) -> None:
    if not _configured:
        configure()
    category = config.category_of(service)
    levelno = logging.getLevelName(level.upper())
    if not isinstance(levelno, int):
        levelno = logging.INFO
    logger_for(category).log(levelno, event, exc_info=exc_info,
                             extra={"service": service, "category": category, "fields": fields})
