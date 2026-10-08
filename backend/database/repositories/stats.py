"""Dashboard tarixi repozitoriysi: hudud kesimidagi suratlar va holat o'zgarishlari.

  * availability_snapshots — har 5 daqiqada: tashkilot va hudud kesimida
    nechta kamera kuzatildi, nechtasi onlayn edi;
  * status_changes — kamera uzildi/qaytdi (dashboard lentasi).

Hudud nomi saqlanmaydi — admin_areas'dan olinadi; kamera nomi ham
cameras'dan (o'chirilgan kameraning lenta yozuvlari u bilan birga ketadi).
Kuzatuv bo'lmagan oraliq qaytmaydi — grafik uni "0% onlayn" deb emas,
bo'shliq sifatida ko'rsatadi. Sana/soat bo'yicha guruhlash mahalliy
vaqtda (ulanish zonasi — NIGOH_TZ).

Tarkibi:
    StatsRepository             dashboard tarixi (holatsiz, `db` oladi)
      yozish (stats/recorder.py):
        .add_status_changes(db, [(ts, camera_id, kind)])  lenta yozuvlari
        .add_snapshot(db, ts, [(org_id, area_id, total, online)])  bir lahzalik surat
        .prune(db, cutoff)      eski suratlar va o'zgarishlarni o'chiradi
      o'qish (stats/api.py):
        .timeline(db, since)    xom suratlar bo'yicha onlayn/jami
        .timeline_hourly(db, since)  uzun davr: har soatning o'rtachasi
        .daily_uptime(db, since)  mahalliy sana bo'yicha onlayn/jami
        .daily_outages(db, since)  kunlik uzilishlar soni
        .today(db)              bazadagi bugungi sana (CURRENT_DATE)
        .outages_today_by_region(db)  bugungi uzilishlar hudud bo'yicha
        .outages_today_by_hour(db)  bugungi uzilishlar soat bo'yicha
        .uptime_by_region(db, since)  hudud bo'yicha onlayn/jami
        .recent_changes(db, limit)  so'nggi holat o'zgarishlari
        .series(db, since, until, step, area_ids)  onlaynlik qatori: 5m (xom),
                                hour/6h/day (o'rtacha)
        .snapshot_near(db, at, area_ids)  `at` ga eng yaqin (oldingi) surat yig'indisi
        .changes(db, limit=, before_id=, kind=, camera_id=, area_ids=)  lenta,
                                sahifalab (yangisi birinchi)
    KEEP_DAYS                   saqlash muddati (30 kun)
    STEPS                       series qadamlari: "5m", "hour", "6h", "day"

Jadvallar: availability_snapshots, status_changes (+ admin_areas, camera_details)
Ishlatadi: database.repositories.areas (UNASSIGNED)
Kim ishlatadi: stats/recorder.py (yozish, prune, KEEP_DAYS), stats/api.py (o'qish).
"""
from __future__ import annotations

from datetime import datetime

from database.repositories.areas import UNASSIGNED

KEEP_DAYS = 30


# ---------- statistika API (reporting/) uchun ----------

STEPS = {"5m": None, "hour": "hour", "6h": "6 hours", "day": "day"}


class StatsRepository:
    """Dashboard tarixi: hudud suratlari va holat o'zgarishlari.

    Holatsiz: har metod birinchi argument sifatida ulanishni (`db`) oladi —
    tranzaksiya chegarasini chaqiruvchi `with get_db() as db:` bilan belgilaydi.
    """

    KEEP_DAYS = KEEP_DAYS
    STEPS = STEPS

    def add_status_changes(self, db, items: list[tuple[datetime, int, str]]) -> None:
        """[(ts, camera_id, 'online'|'offline')]"""
        db.executemany("INSERT INTO status_changes (ts, camera_id, kind) VALUES (%s, %s, %s)",
                       items)

    def add_snapshot(self, db, ts: datetime, rows: list[tuple[int, int | None, int, int]]) -> None:
        """[(organization_id, admin_area_id, total, online)] — bir lahzalik surat."""
        db.executemany(
            "INSERT INTO availability_snapshots (ts, organization_id, admin_area_id, total, online) "
            "VALUES (%s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
            [(ts, *r) for r in rows])

    def prune(self, db, cutoff: datetime) -> None:
        db.execute("DELETE FROM availability_snapshots WHERE ts < %s", (cutoff,))
        db.execute("DELETE FROM status_changes WHERE ts < %s", (cutoff,))

    def timeline_hourly(self, db, since: datetime) -> list:
        """Uzun davr uchun: har soatning o'rtacha onlayn/jami qiymati.

        Kuzatuv bo'lmagan soatlar qaytmaydi — grafik ularni bo'shliq sifatida
        ko'rsatadi, "0% onlayn" deb emas.
        """
        return db.execute(
            "SELECT h AS ts, AVG(online)::float AS online, AVG(total)::float AS total FROM ("
            "  SELECT date_trunc('hour', ts) AS h, ts, SUM(online) AS online, SUM(total) AS total"
            "  FROM availability_snapshots WHERE ts >= %s GROUP BY ts) t "
            "GROUP BY h ORDER BY h", (since,)).fetchall()

    def timeline(self, db, since: datetime) -> list:
        return db.execute(
            "SELECT ts, SUM(online) AS online, SUM(total) AS total FROM availability_snapshots "
            "WHERE ts >= %s GROUP BY ts ORDER BY ts", (since,)).fetchall()

    def daily_uptime(self, db, since: datetime) -> list:
        """Mahalliy sana bo'yicha (ulanish zonasi — NIGOH_TZ)."""
        return db.execute(
            "SELECT to_char(ts, 'YYYY-MM-DD') AS d, SUM(online) AS online, SUM(total) AS total "
            "FROM availability_snapshots WHERE ts >= %s GROUP BY d", (since,)).fetchall()

    def daily_outages(self, db, since: datetime) -> list:
        return db.execute(
            "SELECT to_char(ts, 'YYYY-MM-DD') AS d, COUNT(*) AS n FROM status_changes "
            "WHERE kind = 'offline' AND ts >= %s GROUP BY d", (since,)).fetchall()

    def today(self, db):
        return db.execute("SELECT CURRENT_DATE").fetchone()[0]

    def outages_today_by_region(self, db) -> list:
        return db.execute(
            "SELECT d.region, COUNT(*) AS n FROM status_changes s "
            "JOIN camera_details d ON d.id = s.camera_id "
            "WHERE s.kind = 'offline' AND s.ts::date = CURRENT_DATE GROUP BY d.region").fetchall()

    def uptime_by_region(self, db, since: datetime) -> list:
        return db.execute(
            "SELECT COALESCE(a.name, %s) AS region, SUM(s.online) AS online, SUM(s.total) AS total "
            "FROM availability_snapshots s LEFT JOIN admin_areas a ON a.id = s.admin_area_id "
            "WHERE s.ts >= %s GROUP BY 1", (UNASSIGNED, since)).fetchall()

    def outages_today_by_hour(self, db) -> list:
        return db.execute(
            "SELECT extract(hour FROM ts)::int AS h, COUNT(*) AS n FROM status_changes "
            "WHERE kind = 'offline' AND ts::date = CURRENT_DATE GROUP BY h").fetchall()

    def recent_changes(self, db, limit: int = 40) -> list:
        return db.execute(
            "SELECT s.ts, s.camera_id, d.name, d.region, d.km, d.picket, s.kind FROM status_changes s "
            "JOIN camera_details d ON d.id = s.camera_id ORDER BY s.id DESC LIMIT %s",
            (limit,)).fetchall()

    def series(self, db, since: datetime, until: datetime, step: str,
               area_ids: list[int] | None) -> list:
        """Onlaynlik qatori: har nuqtada nechta kamera kuzatildi, nechtasi onlayn.

        `5m` — xom suratlar (5 daqiqada bir); `hour`/`day` — o'sha oraliqdagi
        suratlarning o'rtachasi (mahalliy vaqt, NIGOH_TZ). Kuzatuv bo'lmagan
        oraliq qaytmaydi — "0% onlayn" deb emas, bo'shliq bo'lib ko'rinadi.
        """
        flt = "" if area_ids is None else " AND admin_area_id = ANY(%(ids)s)"
        raw = ("SELECT ts, SUM(online) AS online, SUM(total) AS total FROM availability_snapshots "
               f"WHERE ts >= %(s)s AND ts < %(u)s{flt} GROUP BY ts")
        params = {"s": since, "u": until, "ids": area_ids}
        unit = STEPS[step]
        if unit is None:
            return db.execute(raw + " ORDER BY ts", params).fetchall()
        # 6 soat — date_trunc'da yo'q: date_bin, boshlanish mahalliy yarim tunda
        # (vaqt zonasisiz literal ulanish zonasida — NIGOH_TZ — o'qiladi).
        bucket = (f"date_bin('{unit}', ts, TIMESTAMPTZ '2000-01-01 00:00')" if " " in unit
                  else f"date_trunc('{unit}', ts)")
        return db.execute(
            f"SELECT {bucket} AS ts, AVG(online)::float AS online, "
            f"AVG(total)::float AS total, COUNT(*) AS samples FROM ({raw}) t "
            "GROUP BY 1 ORDER BY 1", params).fetchall()

    def snapshot_near(self, db, at: datetime, area_ids: list[int] | None,
                      window_s: int = 3600):
        """`at` dan oldingi eng yaqin surat (ko'pi bilan `window_s` oldin): jami/onlayn
        yig'indisi — "oldingi davr" taqqoslashi uchun. Topilmasa None."""
        flt = "" if area_ids is None else " AND admin_area_id = ANY(%(ids)s)"
        return db.execute(
            "SELECT ts, SUM(total) AS total, SUM(online) AS online FROM availability_snapshots "
            "WHERE ts = (SELECT max(ts) FROM availability_snapshots "
            f"  WHERE ts <= %(at)s AND ts > %(at)s - make_interval(secs => %(w)s){flt}){flt} "
            "GROUP BY ts", {"at": at, "w": window_s, "ids": area_ids}).fetchone()

    def changes(self, db, *, limit: int, before_id: int | None = None, kind: str | None = None,
                camera_id: int | None = None, area_ids: list[int] | None = None) -> list:
        """Holat o'zgarishlari lentasi (yangisi birinchi), sahifalab: `before_id`."""
        where, params = ["TRUE"], {"limit": limit}
        if before_id is not None:
            where.append("s.id < %(before)s")
            params["before"] = before_id
        if kind:
            where.append("s.kind = %(kind)s")
            params["kind"] = kind
        if camera_id is not None:
            where.append("s.camera_id = %(cam)s")
            params["cam"] = camera_id
        if area_ids is not None:
            where.append("d.admin_area_id = ANY(%(ids)s)")
            params["ids"] = area_ids
        return db.execute(
            "SELECT s.id, s.ts, s.camera_id, d.name, d.region, d.admin_area_id, d.km, d.picket, "
            "s.kind FROM status_changes s JOIN camera_details d ON d.id = s.camera_id "
            f"WHERE {' AND '.join(where)} ORDER BY s.id DESC LIMIT %(limit)s", params).fetchall()
