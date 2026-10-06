"""Hisobotlar repozitoriysi — dashboard uchun xom ma'lumot: kuzatuv bo'shliqlari,
o'tishlar, issiqlik xaritasi va ma'lumot sifati.

Hisob-kitob (uptime, MTTR, reyting) stats/overview.py va
stats/reporting/engine.py da — bu modul faqat bazadan kerakli qatorlarni
bitta-ikkita so'rov bilan oladi.

Kuzatuv "yurak urishi" ikki manbadan: dashboard suratlari (5 daqiqada bir)
va kamera hodisalari (2026-10-03 gacha mikroservis yozgan, suratlari
ko'chmagan — faqat suratga qaralsa o'sha davr "kuzatuvsiz" chiqardi).
Ikkalasi ham GAP_THRESHOLD (90 daqiqa) jim tursa — server ishlamagan
(157 kamerada soatiga o'rtacha 15+ hodisa bo'ladi).

Tarkibi:
    ReportRepository            hisobot qatorlari (holatsiz, `db` oladi)
        .monitoring_gaps(db, since, until)  kuzatuv bo'lmagan oraliqlar [boshi, oxiri)
        .transitions(db, since, camera_ids, until)  online/offline o'tishlari + har
                                kameraning davr boshidagi oxirgi holati (30 kun oldin
                                uzilib qaytmagan kamera butun davr o'chiq)
        .stall_counts(db, since, until)  tasvir to'xtashlari (port ochiq, video yo'q) soni
        .data_quality(db, camera_ids)  tuzatiladigan yozuvlar: no_location, no_region,
                                no_km, no_codec, no_model, never_seen, probe_failed,
                                vendor_mismatch, km_name_mismatch
    GAP_THRESHOLD               kuzatuv to'xtagan deb hisoblanadigan sukunat (90 daqiqa)

Jadvallar: availability_snapshots, camera_events; view camera_details
Ishlatadi: database.repositories (cameras.vendor_for_model, rail.parse_km_picket,
rail.looks_like_km)
Kim ishlatadi: stats/reporting/engine.py (monitoring_gaps, transitions,
stall_counts), stats/overview.py va database/scripts/fix_camera_data.py
(data_quality), tests/test_camera_data.py.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from database.repositories import cameras, rail

# Kuzatuv "yurak urishi" — ikki manba birlashtiriladi:
#   * dashboard suratlari (5 daqiqada bir, hozirgi tizim);
#   * kamera hodisalari (2026-10-03 gacha mikroservis yozgan, suratlari
#     esa ko'chmagan — faqat suratga qaralsa o'sha davr "kuzatuvsiz" chiqardi).
# Ikkalasi ham shundan uzoq jim tursa — server ishlamagan. 157 kamerada
# soatiga o'rtacha 15+ hodisa bo'ladi, shuning uchun 90 daqiqalik sukunat
# kuzatuv to'xtaganini anglatadi.
GAP_THRESHOLD = timedelta(minutes=90)


class ReportRepository:
    """Dashboard hisobotlari uchun xom ma'lumot (bo'shliqlar, o'tishlar, sifat).

    Holatsiz: har metod birinchi argument sifatida ulanishni (`db`) oladi —
    tranzaksiya chegarasini chaqiruvchi `with get_db() as db:` bilan belgilaydi.
    """

    GAP_THRESHOLD = GAP_THRESHOLD

    def monitoring_gaps(self, db, since: datetime, until: datetime) -> list[tuple[datetime, datetime]]:
        """Kuzatuv bo'lmagan oraliqlar [boshi, oxiri) — "yurak urishlari" orasidagi tanaffuslar."""
        rows = db.execute(
            "WITH t AS ("
            "  SELECT ts FROM availability_snapshots WHERE ts >= %(s)s AND ts <= %(u)s"
            "  UNION SELECT ts FROM camera_events WHERE ts >= %(s)s AND ts <= %(u)s"
            "    AND kind IN ('online', 'offline')) "
            "SELECT ts, lag(ts) OVER (ORDER BY ts) AS prev FROM t ORDER BY ts",
            {"s": since, "u": until}).fetchall()
        if not rows:
            return [(since, until)]
        gaps = []
        first, last = rows[0]["ts"], rows[-1]["ts"]
        if first - since > GAP_THRESHOLD:
            gaps.append((since, first))
        gaps += [(r["prev"], r["ts"]) for r in rows
                 if r["prev"] is not None and r["ts"] - r["prev"] > GAP_THRESHOLD]
        if until - last > GAP_THRESHOLD:
            gaps.append((last, until))
        return gaps

    def transitions(self, db, since: datetime, camera_ids: list[int] | None,
                    until: datetime | None = None) -> list:
        """online/offline o'tishlari + har kameraning davr boshidagi oxirgi holati.

        Davr boshidan oldingi oxirgi o'tish kerak: kamera 30 kun oldin uzilib,
        hali qaytmagan bo'lsa, davr ichida o'tish yo'q, lekin u butun davr
        davomida o'chiq.
        """
        flt = "" if camera_ids is None else " AND camera_id = ANY(%(ids)s)"
        upto = "" if until is None else " AND ts < %(until)s"
        return db.execute(
            "(SELECT DISTINCT ON (camera_id) camera_id, ts, kind FROM camera_events "
            f" WHERE kind IN ('online', 'offline') AND ts < %(since)s AND camera_id IS NOT NULL{flt}"
            " ORDER BY camera_id, ts DESC, id DESC) "
            "UNION ALL "
            "(SELECT camera_id, ts, kind FROM camera_events "
            f" WHERE kind IN ('online', 'offline') AND ts >= %(since)s AND camera_id IS NOT NULL"
            f"{flt}{upto}) "
            "ORDER BY camera_id, ts",
            {"since": since, "until": until, "ids": camera_ids}).fetchall()

    def stall_counts(self, db, since: datetime, until: datetime | None = None) -> dict[int, int]:
        """Tasvir to'xtashlari (port ochiq, video yo'q) — kamera bo'yicha soni."""
        return {r[0]: r[1] for r in db.execute(
            "SELECT camera_id, COUNT(*) FROM camera_events WHERE kind = 'stalled' "
            "AND ts >= %s AND ts < COALESCE(%s, 'infinity'::timestamptz) "
            "AND camera_id IS NOT NULL GROUP BY camera_id", (since, until))}

    def data_quality(self, db, camera_ids: list[int] | None) -> dict[str, list]:
        """Tuzatilishi kerak bo'lgan yozuvlar: har bir muammo bo'yicha kameralar.

        `detail` — nima noto'g'ri ekani (bo'lsa): tekshiruv xatosi, kutilgan
        ishlab chiqaruvchi, nomdan o'qilgan km.
        """
        flt = "" if camera_ids is None else " AND id = ANY(%(ids)s)"
        checks = {
            "no_location": "lat IS NULL",
            "no_region": "admin_area_id IS NULL",
            "no_km": "km IS NULL AND source_type = 'rtsp'",
            "no_codec": "codec IS NULL AND enabled AND source_type = 'rtsp'",
            "no_model": "model IS NULL AND source_type = 'rtsp'",
            "never_seen": "last_seen IS NULL AND enabled AND source_type = 'rtsp'",
        }
        out = {}
        for key, cond in checks.items():
            out[key] = [dict(r) for r in db.execute(
                f"SELECT id, name, region FROM camera_details WHERE {cond}{flt} ORDER BY name",
                {"ids": camera_ids})]

        rows = db.execute(
            "SELECT id, name, region, km, picket, vendor, model, probe_error, enabled, source_type "
            f"FROM camera_details WHERE TRUE{flt} ORDER BY name", {"ids": camera_ids}).fetchall()
        item = lambda r, detail: {"id": r["id"], "name": r["name"], "region": r["region"],  # noqa: E731
                                  "detail": detail}
        # Kamera tekshiruvi (camera/monitoring/passport.py) xato bergan: parol, yo'l, tarmoq.
        out["probe_failed"] = [item(r, r["probe_error"]) for r in rows
                               if r["probe_error"] and r["enabled"]]
        # Model boshqa ishlab chiqaruvchiniki — RTSP yo'li ham noto'g'ri bo'lishi mumkin.
        out["vendor_mismatch"] = []
        for r in rows:
            expected = cameras.vendor_for_model(r["model"])
            if expected and expected != r["vendor"]:
                out["vendor_mismatch"].append(
                    item(r, f"yozilgan: {r['vendor']}, model {r['model']} -> {expected}"))
        # Nom km yozuviga o'xshaydi, lekin o'qilmaydi yoki saqlangan km'ga mos emas.
        out["km_name_mismatch"] = []
        for r in rows:
            parsed = rail.parse_km_picket(r["name"])
            if parsed is None and rail.looks_like_km(r["name"]):
                out["km_name_mismatch"].append(item(r, "nomdagi km/piket o'qilmadi"))
            elif parsed and r["km"] is not None and parsed != (r["km"], r["picket"]):
                out["km_name_mismatch"].append(
                    item(r, f"nomda {parsed[0]}/{parsed[1]}, bazada {r['km']}/{r['picket']}"))
        return out
