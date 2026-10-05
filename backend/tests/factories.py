"""Testlar uchun ma'lumot yaratish — ilova ishlatadigan funksiyalar orqali.

Kamera to'g'ridan-to'g'ri INSERT bilan emas, `database.cameras.create`
bilan yaratiladi: qurilma, jonli holat qatori va hudud bog'lanishi xuddi
ishlab chiqarishdagidek bo'ladi.
"""
from database import areas, cameras


def add_camera(db, slug: str, *, name: str | None = None, region: str = "Toshkent shahri",
               ip: str | None = "10.9.9.1", port: int = 554, rtsp_path: str | None = None,
               sub_path: str | None = None, enabled: bool = True,
               lat: float | None = None, lng: float | None = None,
               stream_url: str | None = None, external_id: str | None = None,
               username: str = "", password_enc: str | None = None,
               codec: str | None = None, sub_codec: str | None = None,
               transcode: bool = False, always_on: bool = False,
               vendor: str = "boshqa") -> int:
    rtsp = ip is not None
    data = {
        "name": name or slug, "slug": slug,
        "admin_area_id": areas.id_by_name(db, region),
        "lat": lat, "lng": lng,
        "source_type": "rtsp" if rtsp else "manual",
        "stream_url": None if rtsp else (stream_url or f"http://example.test/{slug}.m3u8"),
        "host": ip, "port": port, "vendor": vendor, "username": username,
        # Har kamera o'z yo'li — bitta IP'dagi kameralar takror deb rad etilmasin.
        "rtsp_path": (rtsp_path or f"/{slug}") if rtsp else None,
        "sub_path": sub_path, "media_node_id": 1,
        "enabled": enabled, "always_on": always_on,
        "external_id": external_id,
        "codec": codec, "sub_codec": sub_codec, "transcode": transcode,
    }
    return cameras.create(db, data, password_enc=password_enc)


def add_event(db, kind: str, slug: str, ts=None, detail: str | None = None) -> None:
    """Hodisa: `slug` — oqim yo'li (asosiy, `_sub` yoki `_h264`)."""
    db.execute(
        "INSERT INTO camera_events (ts, kind, camera_id, path, detail) VALUES "
        "(COALESCE(%s, now()), %s, (SELECT id FROM cameras WHERE slug = "
        "regexp_replace(%s, '_(sub|h264)$', '')), %s, %s)",
        (ts, kind, slug, slug, detail))


def count_at(db, ip: str) -> int:
    return db.execute("SELECT COUNT(*) FROM camera_details WHERE ip = %s", (ip,)).fetchone()[0]


def delete_at(db, ip: str) -> None:
    for (camera_id,) in db.execute("SELECT id FROM camera_details WHERE ip = %s",
                                   (ip,)).fetchall():
        cameras.delete(db, camera_id)
