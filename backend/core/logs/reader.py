"""Loglarni o'qish va qidirish: eng yangisi birinchi, filtrlar bilan.

Fayllar oxiridan boshiga qarab bo'laklab (64 KB) o'qiladi — 50 MB lik
kunlik faylda ham "oxirgi 200 ta xato" darhol topiladi, butun fayl
xotiraga olinmaydi. Buzuq (yarim yozilgan) satr jimgina o'tkaziladi.

JSON toifalar (app, camera, stats, security, database, access, errors)
maydon bo'yicha filtrlanadi. `mediamtx` — MediaMTX'ning matnli logi:
satrdan vaqt va daraja (INF/WAR/ERR/DEB) ajratib olinadi.

Tarkibi:
    LogReader(log_dir)
        .categories()                   mavjud toifalar, fayllar soni va hajmi
        .files(category)                toifa fayllari (yangisi birinchi)
        .query(category, level=, service=, event=, q=, request_id=,
               since=, until=, limit=)  filtrlangan yozuvlar
        .summary(hours=24)              toifa x daraja bo'yicha sonlar
    LEVELS                              daraja tartibi (filtr "shundan yuqori")

Kim ishlatadi: app/logs_api.py.
"""
from __future__ import annotations

import json
import os
import re
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

LEVELS = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40, "CRITICAL": 50}
_MTX_LEVEL = {"DEB": "DEBUG", "INF": "INFO", "WAR": "WARNING", "ERR": "ERROR"}
_MTX_LINE = re.compile(r"^(\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2}) (DEB|INF|WAR|ERR) (.*)$")
_CHUNK = 64 * 1024


def _reverse_lines(path: Path):
    """Faylni oxiridan boshiga qarab satrma-satr beradi."""
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        pos = f.tell()
        rest = b""
        while pos > 0:
            step = min(_CHUNK, pos)
            pos -= step
            f.seek(pos)
            block = f.read(step) + rest
            lines = block.split(b"\n")
            rest = lines[0]
            for line in reversed(lines[1:]):
                if line.strip():
                    yield line.decode("utf-8", errors="replace")
        if rest.strip():
            yield rest.decode("utf-8", errors="replace")


def _parse_ts(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


class LogReader:
    def __init__(self, log_dir: Path) -> None:
        self.log_dir = Path(log_dir)

    # ---------- fayllar ----------

    def categories(self) -> list[dict]:
        out = []
        if not self.log_dir.exists():
            return out
        for d in sorted(p for p in self.log_dir.iterdir() if p.is_dir()):
            files = [f for f in d.iterdir() if f.is_file()]
            out.append({"category": d.name, "files": len(files),
                        "bytes": sum(f.stat().st_size for f in files),
                        "latest": max((f.stat().st_mtime for f in files), default=None)})
        return out

    def files(self, category: str) -> list[dict]:
        d = self.log_dir / category
        if not d.is_dir():
            return []
        files = sorted((f for f in d.iterdir() if f.is_file()),
                       key=lambda f: f.stat().st_mtime, reverse=True)
        return [{"name": f.name, "bytes": f.stat().st_size,
                 "modified": datetime.fromtimestamp(f.stat().st_mtime).isoformat(timespec="seconds")}
                for f in files]

    # ---------- qidiruv ----------

    def _records(self, category: str):
        d = self.log_dir / category
        if not d.is_dir():
            return
        files = sorted((f for f in d.iterdir() if f.is_file()),
                       key=lambda f: f.stat().st_mtime, reverse=True)
        for f in files:
            for line in _reverse_lines(f):
                if category == "mediamtx":
                    m = _MTX_LINE.match(line)
                    if m:
                        ts = datetime.strptime(m.group(1), "%Y/%m/%d %H:%M:%S")
                        yield {"ts": ts.isoformat(), "level": _MTX_LEVEL[m.group(2)],
                               "category": "mediamtx", "service": "mediamtx",
                               "event": m.group(3)}
                    else:
                        yield {"ts": None, "level": "INFO", "category": "mediamtx",
                               "service": "mediamtx", "event": line}
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                if isinstance(rec, dict):
                    yield rec

    def query(self, category: str = "errors", *, level: str | None = None,
              service: str | None = None, event: str | None = None, q: str | None = None,
              request_id: str | None = None, since: datetime | None = None,
              until: datetime | None = None, limit: int = 200) -> list[dict]:
        min_level = LEVELS.get((level or "").upper(), 0)
        needle = (q or "").lower()
        out = []
        for rec in self._records(category):
            ts = _parse_ts(rec.get("ts"))
            if ts is not None and since is not None:
                if ts.tzinfo is None and since.tzinfo is not None:
                    ts = ts.replace(tzinfo=since.tzinfo)
                if ts < since:
                    # Fayllar va satrlar vaqt bo'yicha teskari tartibda — bundan
                    # keyingisi ham eskiroq. Lekin boshqa faylga o'tish mumkin
                    # (bir kunlik bo'laklar), shuning uchun faqat shu yozuvni tashlaymiz.
                    continue
            if ts is not None and until is not None:
                if ts.tzinfo is None and until.tzinfo is not None:
                    ts = ts.replace(tzinfo=until.tzinfo)
                if ts > until:
                    continue
            if min_level and LEVELS.get(str(rec.get("level", "")).upper(), 0) < min_level:
                continue
            if service and rec.get("service") != service:
                continue
            if event and event not in str(rec.get("event", "")):
                continue
            if request_id and rec.get("request_id") != request_id:
                continue
            if needle and needle not in json.dumps(rec, ensure_ascii=False).lower():
                continue
            out.append(rec)
            if len(out) >= limit:
                break
        return out

    def summary(self, hours: int = 24, max_lines: int = 200_000) -> dict:
        """Oxirgi `hours` soatda toifa x daraja bo'yicha sonlar va eng ko'p hodisalar."""
        since = datetime.now().astimezone() - timedelta(hours=hours)
        by_cat: dict[str, Counter] = {}
        top: Counter = Counter()
        for c in self.categories():
            cat = c["category"]
            if cat in ("archive", "errors"):
                continue
            counter = by_cat.setdefault(cat, Counter())
            seen = 0
            for rec in self._records(cat):
                seen += 1
                if seen > max_lines:
                    break
                ts = _parse_ts(rec.get("ts"))
                if ts is not None:
                    if ts.tzinfo is None:
                        ts = ts.astimezone()
                    if ts < since:
                        break
                lvl = str(rec.get("level", "INFO")).upper()
                counter[lvl] += 1
                if LEVELS.get(lvl, 0) >= 30:
                    top[f"{cat}/{rec.get('service')}/{str(rec.get('event'))[:60]}"] += 1
        return {"hours": hours,
                "categories": {k: dict(v) for k, v in by_cat.items()},
                "top_problems": [{"key": k, "count": n} for k, n in top.most_common(15)]}
