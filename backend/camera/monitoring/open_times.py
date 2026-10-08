"""Pleyer ochilish vaqti o'lchovi — xotiradagi namunalar va p50/p95.

"Sekin ochilyapti" degan shikoyatga javob berish uchun bitta raqam
yetmaydi: ochilish uch bo'lakdan iborat va ularning har biri butunlay
boshqa narsa haqida gapiradi.

    stream_ms   /cameras/{id}/stream javobi — backend va MediaMTX'da
                yo'lni tayyorlash. Sekin bo'lsa: MediaMTX'da ortiqcha
                yo'llar (pending_paths) yoki uzoq tugun API'si.
    signal_ms   WHEP so'rovi va javob — signalizatsiya. Sekin bo'lsa:
                tarmoq/proksi. HLS'da bu bosqich yo'q (0).
    frame_ms    birinchi kadr — kameradan keyframe kutish. Sekin bo'lsa:
                kameradagi I Frame Interval (registratorda sozlanadi).
    total_ms    foydalanuvchi ko'rgan to'liq vaqt.

Namunalar xotirada, halqa buferda — baza ham, tashqi tizim ham kerak
emas. Server qayta ishga tushsa hisob noldan boshlanadi, bu maqsadga
zid emas: o'lchov "hozir qanday" degan savolga javob beradi.

Kamera kesimi ham saqlanadi (dashboard "Ochilish vaqti" kartasi): har
kameraning oxirgi PER_CAMERA ta ochilishi — barcha foydalanuvchilar va
devorlar bo'yicha, server ishga tushganidan beri.

Tarkibi:
    record(transport, sample)   bitta ochilishni yozadi (0..MAX_MS ga qisiladi)
    summary()                   transport kesimida {n, <bosqich>: {p50, p95}}
    by_camera()                 kamera id -> {n, last_ms, median_ms, max_ms,
                                transport, at} (oxirgi PER_CAMERA ochilish)
    camera_opens(camera_id)     bitta kameraning oxirgi ochilishlari (xom)
    percentile(values, frac)    eng yaqin tartib statistikasi
    reset()                     hammasini tozalaydi (testlar)
    MAX_SAMPLES     512 — transport boshiga halqa hajmi
    PER_CAMERA      10 — kamera boshiga saqlanadigan ochilishlar
    MAX_MS          120 s — uxlab qolgan yorliqning yovvoyi qiymati kesiladi

Kim ishlatadi: camera/api/metrics.py (yozadi va kamera kesimini beradi),
app/health.py (o'qiydi)
"""
import statistics
import threading
import time
from collections import deque

# Har transport uchun oxirgi shuncha namuna. 512 ta p95 uchun yetarli
# va xotirada bir necha o'nlab kilobayt.
MAX_SAMPLES = 512

FIELDS = ("stream_ms", "signal_ms", "frame_ms", "total_ms")

# Yovvoyi qiymat statistikani buzmasin: o'lchov brauzerdan keladi,
# uxlab qolgan yorliq soatlab "ochilgan" deb yozishi mumkin.
MAX_MS = 120_000

# Kamera boshiga shuncha oxirgi ochilish: median bitta tasodifiy sekin
# ochilishga aldanmaydi, xotira esa 5000 kamerada ham bir necha MB.
PER_CAMERA = 10

_samples: dict[str, deque] = {}
_cameras: dict[int, deque] = {}
_lock = threading.Lock()


def record(transport: str, sample: dict) -> None:
    """Bitta ochilishni yozadi. Transport: webrtc / hls."""
    row = {}
    for field in FIELDS:
        try:
            value = int(sample.get(field) or 0)
        except (TypeError, ValueError):
            value = 0
        row[field] = min(MAX_MS, max(0, value))
    with _lock:
        queue = _samples.get(transport)
        if queue is None:
            queue = _samples[transport] = deque(maxlen=MAX_SAMPLES)
        queue.append(row)
        camera_id = sample.get("camera_id")
        if isinstance(camera_id, int) and row["total_ms"] > 0:
            cam = _cameras.get(camera_id)
            if cam is None:
                cam = _cameras[camera_id] = deque(maxlen=PER_CAMERA)
            cam.append((row["total_ms"], transport, time.time()))


def percentile(values: list[int], fraction: float) -> int:
    """Eng yaqin tartib statistikasi — interpolatsiyasiz, yetarli."""
    if not values:
        return 0
    ordered = sorted(values)
    index = int(round((len(ordered) - 1) * fraction))
    return ordered[min(max(index, 0), len(ordered) - 1)]


def summary() -> dict:
    """Transport kesimida p50/p95 — /health uchun."""
    with _lock:
        snapshot = {name: list(queue) for name, queue in _samples.items()}
    out: dict[str, dict] = {}
    for transport, rows in snapshot.items():
        if not rows:
            continue
        stats: dict = {"n": len(rows)}
        for field in FIELDS:
            values = [row[field] for row in rows]
            stats[field] = {"p50": percentile(values, 0.5),
                            "p95": percentile(values, 0.95)}
        out[transport] = stats
    return out


def by_camera() -> dict[int, dict]:
    """Kamera kesimi: oxirgi ochilishlar bo'yicha median, oxirgisi, eng sekini."""
    with _lock:
        snapshot = {cid: list(q) for cid, q in _cameras.items()}
    out = {}
    for cid, rows in snapshot.items():
        totals = [ms for ms, _, _ in rows]
        last_ms, transport, at = rows[-1]
        out[cid] = {"n": len(rows), "last_ms": last_ms,
                    "median_ms": int(statistics.median(totals)), "max_ms": max(totals),
                    "transport": transport, "at": at}
    return out


def camera_opens(camera_id: int) -> list[tuple[int, str, float]]:
    """Bitta kameraning oxirgi PER_CAMERA ochilishi: [(total_ms, transport, at)], eskisi birinchi."""
    with _lock:
        return list(_cameras.get(camera_id, ()))


def reset() -> None:
    with _lock:
        _samples.clear()
        _cameras.clear()
