# database/ — Nigoh ma'lumotlar bazasi qatlami

PostgreSQL 17 (psycopg 3). Bazaga tegadigan barcha SQL shu papkada: ulanish
hovuzi, migratsiyalar, repozitoriylar, baza holati API'si, rollar SQL'i va
xizmat skriptlari. Qolgan kod (`camera/`, `stats/`, `users/`, `walls/`, `app/`)
faqat repozitoriy metodlarini chaqiradi.

## Tuzilma

```
database/
├─ __init__.py                     kirish nuqtasi: get_db, init_db, xatolar, repozitoriy nusxalari
├─ connection.py                   hovuz (pool), get_db(), single_connection(), qator turi, NIGOH_TZ
├─ schema.py                       init_db() — migratsiyalarni bajarish; versiya va jadval statistikasi
├─ api.py                          GET /api/v1/admin/db — baza holati (faqat admin)
├─ migrations/
│  ├─ __init__.py                  load() — NNNN_*.py ni topadi, raqamlar uzluksizligini tekshiradi
│  ├─ 0001_initial.py              SQLite'dan 1:1 ko'chirilgan boshlang'ich sxema
│  ├─ 0002_schema_v2.py            sxema v2: tashkilotlar, hududlar, qurilmalar, audit, camera_details
│  └─ 0003_camera_probe.py         camera_status.probe_at / probe_error (pasport tekshiruvi)
├─ repositories/
│  ├─ __init__.py                  har klassning bitta nusxasi (areas, cameras, ...)
│  ├─ areas.py                     AreaRepository — admin_areas, chegaralar keshi
│  ├─ cameras.py                   CameraRepository — cameras + devices + camera_status, slug, pasport
│  ├─ events.py                    EventRepository — camera_events (uptime manbai)
│  ├─ geo.py                       GeoRepository — nuqta GeoJSON ko'pburchak ichidami
│  ├─ nodes.py                     MediaNodeRepository — media_nodes (MediaMTX tugunlari)
│  ├─ rail.py                      RailRepository — rail_lines / rail_units, km/piket
│  ├─ reports.py                   ReportRepository — dashboard hisobotlari uchun xom qatorlar
│  ├─ stats.py                     StatsRepository — availability_snapshots, status_changes
│  ├─ users.py                     UserRepository — users, sessions, user_admin_areas
│  └─ walls.py                     WallRepository — video_walls
├─ scripts/
│  ├─ backup.sh                    pg_dump zaxirasi + secret.key nusxasi, eski zaxiralarni tozalash
│  ├─ migrate_sqlite_to_postgres.py  eski cameras.db (SQLite) dan bir martalik ko'chirish
│  ├─ fix_camera_data.py           kamera ma'lumotidagi kamchiliklarni tuzatish (2026-10-06)
│  └─ move_pgdata.ps1              PostgreSQL ma'lumot katalogini pgdata/ ga ko'chirish (admin yuritadi)
├─ sql/
│  └─ setup-roles.sql              `nigoh` va `nigoh_readonly` rollari, nigoh (va nigoh_test) bazasi
├─ data/
│  └─ uz_regions.geojson           viloyat chegaralari (2-migratsiya admin_areas'ni shundan to'ldiradi)
├─ backups/                        zaxiralar (gitignore'da)
└─ pgdata/                         PostgreSQL ma'lumot katalogi — move_pgdata.ps1 dan keyin (gitignore'da)
```

## Ulanish

Manzil `.env` dagi `DATABASE_URL` dan olinadi:

```
DATABASE_URL=postgresql://nigoh:<NIGOH_DB_PAROL>@127.0.0.1:5432/nigoh
#NIGOH_DB_POOL_MIN=1
#NIGOH_DB_POOL_MAX=20
#NIGOH_TZ=Asia/Tashkent
```

- Ilova superuser bilan emas, faqat o'z bazasiga egalik qiladigan `nigoh`
  roli bilan ulanadi (pastda "Rollar" bo'limiga qarang).
- Hovuz birinchi `get_db()` da ochiladi va har berishda ulanishni tekshiradi
  (server qayta ishga tushsa o'lik ulanish berilmaydi).
- Har ulanishda sessiya zonasi `NIGOH_TZ`: `ts::date`, `extract(hour ...)`
  va qaytgan vaqtlar mahalliy, saqlash esa baribir UTC (`TIMESTAMPTZ`).
- Qisqa umrli jarayonlar (launcher) hovuzsiz `single_connection()` ishlatadi.

## Repozitoriylar

Har jadval guruhi — bitta klass, `repositories/__init__.py` da bitta nusxa,
`database` paketidan qayta eksport qilinadi. Klasslar holatsiz: har metod
birinchi argument sifatida ulanishni oladi, tranzaksiya chegarasini
chaqiruvchi belgilaydi.

```python
from database import cameras, get_db, UniqueViolation

with get_db() as db:                 # xatosiz tugasa COMMIT, xato bilan — ROLLBACK
    row = cameras.get(db, 42)        # camera_details qatori: row["ip"], dict(row)
    try:
        with db.savepoint():         # ichki xato butun tranzaksiyani buzmasin
            cameras.create(db, data, password_enc=enc)
    except UniqueViolation:
        ...
```

Qoidalar:

- SQL'da joy belgisi `%s` (psycopg), `?` emas; satrdagi haqiqiy `%` — `%%`.
- Kamera o'qish har doim `camera_details` ko'rinishidan, yozish faqat
  `CameraRepository` orqali (qurilma, NVR, holat qatori uning ishi).
- "Yo'q" — faqat `NULL`: bo'sh satr va `0` bazaga yozilmaydi.
- Slug yaratilganda beriladi va o'zgarmaydi (MediaMTX yo'li, surat fayli nomi).
- PostgreSQL xatodan keyin tranzaksiyani to'xtatadi — kutilgan xatoni
  `db.savepoint()` ichida ushlang.

## Migratsiyalar

`init_db()` (backend ishga tushganda `app/bootstrap.py` chaqiradi) hali
bajarilmagan migratsiyalarni tartib bilan, har birini o'z savepoint'ida
bajaradi va `schema_version` ga yozadi. Bir vaqtda ko'tarilgan ikkinchi
jarayon advisory lock'da kutadi.

Yangi migratsiya qo'shish:

1. `migrations/NNNN_nom.py` yarating (keyingi raqam, faqat `a-z0-9_`).
2. Ichida `VERSION = NNNN` va `apply(db)`.
3. Backend'ni qayta ishga tushiring yoki `init_db()` ni chaqiring.

Bajarilgan migratsiya **hech qachon** tahrirlanmaydi — yangi o'zgarish
yangi fayl bilan. Raqamlar uzluksiz bo'lmasa yoki `VERSION` fayl nomiga
mos kelmasa, `load()` xato beradi. Joriy holat:
`GET /api/v1/admin/db` (`schema_version`, `schema_latest`, `up_to_date`).

## Zaxira

```
backend/database/scripts/backup.sh                       # backend/database/backups ga
BACKUP_DIR=/mnt/zaxira KEEP_DAYS=30 backend/database/scripts/backup.sh
```

- `pg_dump -Fc`; yozilgandan keyin `pg_restore --list` bilan tekshiriladi,
  yarim fayl zaxira bo'lib qolmaydi. `KEEP_DAYS` (standart 14) dan eskisi o'chadi.
- Kamera parollari bazada Fernet bilan shifrlangan, kaliti `DATA_DIR/secret.key`
  — skript uni ham yoniga nusxalaydi. Kalitsiz zaxira parollarni qaytara
  olmaydi; zaxira papkasini begona ko'zdan saqlang.
- Tiklash (bo'sh bazaga):
  `pg_restore -d "$DATABASE_URL" --clean --if-exists --no-owner backend/database/backups/nigoh-....dump`
- Cron misoli va batafsil: `scripts/backup.sh` boshidagi izoh.

## Rollar

`sql/setup-roles.sql` PostgreSQL o'rnatilgandan keyin bir marta bajariladi:

```
psql -U postgres -v parol=<NIGOH_DB_PAROL> -f backend/database/sql/setup-roles.sql
psql -U postgres -v parol=<NIGOH_DB_PAROL> -v test_db=1 -f ...   # + nigoh_test (testlar)
```

- `nigoh` — ilova roli: superuser emas, rol/baza yarata olmaydi, faqat
  `nigoh` bazasi va uning `public` sxemasi egasi. Ilovadagi xato yoki SQL
  in'ektsiya butun serverni emas, faqat shu bazani ko'radi.
- `nigoh_readonly` — odam qo'lda ko'rishi uchun (DBeaver, pgAdmin): faqat
  `SELECT`, keyin yaratiladigan jadvallarda ham. Parolini alohida bering:
  `ALTER ROLE nigoh_readonly PASSWORD '...';`

O'rnatish tafsilotlari: `docs/DEPLOY.md`.
