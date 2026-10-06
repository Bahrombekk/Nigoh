"""3-migratsiya: kamera pasporti tekshiruvining natijasi.

Kodek, o'lcham va model kamera QO'SHILGAN paytda bir marta aniqlanardi.
O'sha lahzada kamera javob bermasa (tarmoq uzilgan, VPN o'chiq) maydonlar
abadiy bo'sh qolardi va nima uchunligi hech qayerda yozilmasdi —
2026-10-06 da 157 kameradan 21 tasida kodek, 40 tasida model yo'q edi,
ularning ko'pchiligi esa aslida ishlab turgan.

Endi fon vazifasi (`camera/monitoring/passport.py`) bo'sh maydonlarni qayta-qayta
to'ldirishga urinadi va har urinish natijasini shu yerga yozadi:

  * probe_at    — oxirgi urinish vaqti (keyingi urinish shundan hisoblanadi,
                  restartdan keyin ham);
  * probe_error — NULL: oxirgi tekshiruv muvaffaqiyatli; aks holda sabab
                  ("parol: Login yoki parol noto'g'ri", "oqim: ..." ...).

camera_details ko'rinishi shu ikki ustun bilan qayta yaratiladi
(DROP VIEW + CREATE VIEW).

Tarkibi:
    VERSION = 3
    VIEW                        camera_details ning yangi ta'rifi
    apply(db)                   ustunlar, izoh, view

Jadvallar: camera_status (probe_at, probe_error), view camera_details
Kim ishlatadi: database/migrations/__init__.py (load) -> database/schema.py;
ustunlarni repositories/cameras.py (passport_candidates, set_probe_result)
va repositories/reports.py (data_quality: probe_failed) o'qiydi/yozadi.
"""

VERSION = 3

VIEW = """
    CREATE VIEW camera_details AS
    SELECT c.id, c.organization_id, c.name, c.slug, c.source_type,
           c.lat, c.lng,
           c.admin_area_id, COALESCE(a.name, 'Belgilanmagan') AS region,
           c.rail_line_id, c.km, c.picket, c.rail_unit_id,
           c.stream_url, c.device_id,
           d.host AS ip, d.rtsp_port AS port, d.username, d.password_enc,
           COALESCE(d.vendor, 'boshqa') AS vendor, d.model, d.firmware,
           d.kind AS device_kind,
           c.rtsp_path, c.sub_path, c.media_node_id AS node_id,
           c.enabled, c.always_on, c.note, c.external_id,
           c.created_at, c.updated_at,
           s.codec, s.sub_codec, s.resolution, s.fps, s.transcode,
           s.sub_bad, s.rtsp_udp, s.last_seen, s.snapshot_at,
           s.probe_at, s.probe_error
    FROM cameras c
    LEFT JOIN devices d ON d.id = c.device_id
    LEFT JOIN camera_status s ON s.camera_id = c.id
    LEFT JOIN admin_areas a ON a.id = c.admin_area_id"""


def apply(db) -> None:
    db.execute("ALTER TABLE camera_status ADD COLUMN probe_at TIMESTAMPTZ")
    db.execute("ALTER TABLE camera_status ADD COLUMN probe_error TEXT "
               "CHECK (probe_error IS NULL OR probe_error <> '')")
    db.execute("COMMENT ON COLUMN camera_status.probe_error IS "
               "'Oxirgi pasport tekshiruvi xatosi; NULL - muvaffaqiyatli yoki hali tekshirilmagan'")
    db.execute("DROP VIEW camera_details")
    db.execute(VIEW)
