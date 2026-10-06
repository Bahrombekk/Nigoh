#!/bin/sh
# Nigoh bazasining zaxirasi (pg_dump, siqilgan "custom" format).
#
#     backend/database/scripts/backup.sh                 # backend/database/backups ga
#     BACKUP_DIR=/mnt/zaxira backend/database/scripts/backup.sh
#
# Ulanish .env dagi DATABASE_URL dan olinadi (parol ham shu ichida) —
# alohida sozlash kerak emas. pg_dump PATH'da bo'lishi kerak (Linux:
# postgresql-client; Windows: "C:\Program Files\PostgreSQL\17\bin").
#
# Cron (har kuni 03:15):
#     15 3 * * * cd /opt/nigoh && backend/database/scripts/backup.sh >> backend/database/backups/backup.log 2>&1
#
# Tiklash (bo'sh bazaga, `nigoh` roli bilan):
#     pg_restore -d "$DATABASE_URL" --clean --if-exists --no-owner backend/database/backups/nigoh-....dump
#
# MUHIM: kamera parollari bazada shifrlangan, kaliti — DATA_DIR/secret.key.
# Kalitsiz zaxira parollarni qaytara olmaydi, shuning uchun skript uni
# ham yoniga nusxalaydi. Zaxira papkasini begona ko'zdan saqlang.
set -eu

cd "$(dirname "$0")/../../.."   # loyiha ildizi
BACKUP_DIR="${BACKUP_DIR:-backend/database/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
    DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env | tail -n 1)"
fi
: "${DATABASE_URL:?DATABASE_URL topilmadi (.env)}"

umask 077                      # zaxira faqat egasiga o'qiladi
mkdir -p "$BACKUP_DIR"

DUMP="$BACKUP_DIR/nigoh-$STAMP.dump"
pg_dump --dbname="$DATABASE_URL" -Fc --file="$DUMP.tmp"
# Yarim yozilgan fayl "zaxira" bo'lib qolmasin: avval tekshiruv, keyin nom.
pg_restore --list "$DUMP.tmp" > /dev/null
mv "$DUMP.tmp" "$DUMP"

KEY="${NIGOH_DATA:-.}/secret.key"
[ -f "$KEY" ] || KEY="data/secret.key"
[ -f "$KEY" ] && cp "$KEY" "$BACKUP_DIR/secret-$STAMP.key"

find "$BACKUP_DIR" -name 'nigoh-*.dump' -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name 'secret-*.key' -mtime +"$KEEP_DAYS" -delete

echo "$(date '+%Y-%m-%dT%H:%M:%S') zaxira: $DUMP ($(du -h "$DUMP" | cut -f1))"
