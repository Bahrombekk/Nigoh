# Nigoh — serverga qo'yish

## Talablar

- Linux server (Ubuntu 22.04+ tavsiya), Docker va docker compose plugin.
- PostgreSQL 17 — hostning o'zida, oddiy servis sifatida (Docker'da emas).
- Server kameralar tarmog'iga yeta olishi kerak (RTSP, odatda 554-port).
- Video o'girish ko'p bo'lsa NVIDIA GPU foyda beradi, lekin shart emas —
  H.264 kameralar umuman o'girilmaydi.

## Tez boshlash

```bash
# 1. Loyihani serverga ko'chiring (git yoki papkani nusxalash)
cd nigoh

# 2. Baza (bir marta) — PostgreSQL 17, faqat 127.0.0.1 da tinglaydi
sudo apt install -y postgresql-17          # yo'q bo'lsa: apt.postgresql.org repozitoriysi
NIGOH_DB_PAROL=$(openssl rand -base64 24 | tr -d '/+=')
sudo -u postgres psql -v parol="$NIGOH_DB_PAROL" -f deploy/postgres/setup-roles.sql

# 3. Sozlamalar
cp .env.example .env
nano .env          # ADMIN_PAROL, NIGOH_DB_PAROL va DATABASE_URL
                   # (postgresql://nigoh:<parol>@127.0.0.1:5432/nigoh)

# 4. Ishga tushirish
docker compose up -d --build

# 5. Tekshirish
docker logs nigoh          # "Uvicorn running" ko'rinishi kerak
curl http://localhost:8010/api/v1/cameras
```

Brauzerda: `http://SERVER_IP:8010` — login "Super admin" tugmasi orqali
(`.env` dagi `ADMIN_PAROL`; berilmagan bo'lsa parol `docker logs nigoh`
chiqishida bir marta ko'rinadi — saqlab qo'ying).

## Portlar

Konteyner host tarmog'ida ishlaydi (WebRTC/UDP uchun shart). Firewall'da
oching:

| Port | Protokol | Kimga | Nima |
|---|---|---|---|
| 8010 | tcp | foydalanuvchilar | API + test UI |
| 8888 | tcp | foydalanuvchilar | HLS video |
| 8889 | tcp | foydalanuvchilar | WebRTC signal (WHEP) |
| 8189 | udp | foydalanuvchilar | WebRTC media |
| 8554 | tcp | ixtiyoriy | RTSP chiqish (VLC va h.k.) — kerak bo'lmasa yopiq tuting |
| 9997, 9998 | tcp | hech kim | MediaMTX API/metrics — faqat 127.0.0.1, ochilmaydi |

Server NAT yoki domen ortida bo'lsa `.env` da `MEDIA_HOST` ga tashqi
IP/domenni yozing — oqim manzillari shu manzil bilan beriladi.

## Ma'lumotlar va zaxira

Ma'lumotlar (kameralar, foydalanuvchilar, tarix) — PostgreSQL'da
(Ubuntu'da `/var/lib/postgresql/17/main`). Fayllar (`secret.key`, loglar,
`mediamtx.yml`, suratlar) — `./data` papkasida.

Baza papkasini nusxalab zaxira OLINMAYDI (ishlab turgan baza fayllari
izchil bo'lmaydi). Zaxira — `pg_dump`; skript `secret.key` ni ham yoniga
oladi:

```bash
deploy/db-backup.sh                          # backups/nigoh-<vaqt>.dump
# har kuni 03:15 (crontab -e):
15 3 * * * cd /opt/nigoh && deploy/db-backup.sh >> backups/backup.log 2>&1
```

Tiklashni oldindan bir marta sinab ko'ring — tekshirilmagan zaxira
zaxira emas:

```bash
pg_restore -d "$DATABASE_URL" --clean --if-exists --no-owner backups/nigoh-....dump
```

`secret.key` yo'qolsa kameralarning saqlangan parollari **tiklanmaydi** —
zaxirani alohida xavfsiz joyda ham saqlang.

Bazani qo'lda ko'rish uchun faqat o'qiy oladigan `nigoh_readonly` roli bor
(parolini bering: `sudo -u postgres psql -c "ALTER ROLE nigoh_readonly
PASSWORD '...'"`). Ilovaning `nigoh` rolini qo'lda ishlatmang.

Yangilash (ma'lumotlar joyida qoladi):

```bash
docker compose up -d --build
```

## HTTPS (tavsiya qilinadi)

Parollar ochiq HTTP orqali yurmasligi uchun oldiga nginx qo'ying.
API uchun namuna (video portlari alohida qoladi):

```nginx
server {
    listen 443 ssl;
    server_name kamera.example.uz;
    ssl_certificate     /etc/letsencrypt/live/kamera.example.uz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/kamera.example.uz/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8010;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

Eslatma: sahifa HTTPS'da ochilsa, brauzer HTTP'dagi videoni bloklaydi
(mixed content) — 8888/8889 ni ham xuddi shunday HTTPS proksidan
o'tkazing yoki `MEDIA_HOST` ga HTTPS beradigan manzil qo'ying. WebRTC'ning
UDP qismi (8189) proksisiz to'g'ridan ishlayveradi.

## Bir nechta MediaMTX tuguni (kameralar har xil joylarda bo'lsa)

Kameralar bir necha binoda/shaharda bo'lsa, har joyga bitta MediaMTX
qo'ying — kamera trafigi lokal tarmoqda qoladi:

```bash
# Tugun serverida faqat toza MediaMTX kerak:
docker run -d --name mediamtx --network host \
  -v $PWD/mediamtx.yml:/mediamtx.yml bluenviron/mediamtx:latest
```

Konfiguratsiyani markaz beradi: admin sifatida
`GET /api/v1/admin/nodes/{id}/config` — tayyor `mediamtx.yml` (parolsiz).
Tugunni `POST /api/v1/admin/nodes` bilan ro'yxatga oling, kameralarni
`node_id` bilan biriktiring. Markaz tugun yo'llarini API orqali o'zi
boshqaradi (9997-portni faqat markaz serveriga oching), salomatligi
`GET /api/v1/admin/nodes` da ko'rinadi.

Eslatma: o'girish (H.265→H.264) faqat markaziy tugunda ishlaydi — uzoq
tugun kameralarini H.264 rejimida tuting.

## Docker'siz (muqobil)

```bash
apt install python3.12-venv ffmpeg
python3 -m venv venv && venv/bin/pip install -r requirements.txt
# MediaMTX binarini mediamtx/ papkasiga yuklab qo'ying (linux_amd64)
NIGOH_DATA=/var/lib/nigoh PORT=8010 venv/bin/python main.py
```

systemd unit namunasi:

```ini
[Unit]
Description=Nigoh kamera servisi
After=network-online.target

[Service]
WorkingDirectory=/opt/nigoh
Environment=NIGOH_DATA=/var/lib/nigoh
ExecStart=/opt/nigoh/venv/bin/python main.py
Restart=always
User=nigoh

[Install]
WantedBy=multi-user.target
```

## Muammolarni aniqlash

| Belgi | Qarash joyi |
|---|---|
| Sayt ochilmayapti | `docker logs nigoh` |
| Video ochilmayapti | `GET /api/v1/admin/status` — `mediamtx: true` bo'lishi kerak; `data/mediamtx.log` |
| Kamera qizil (offline) | serverdan kameraga tarmoq bormi: `POST /api/v1/admin/probe` sabab-bosqichini aytadi (tarmoq/parol/yo'l) |
| Oqim "stalled" | kamera portga javob beradi, lekin tasvir bermayapti — registratorda kanalni tekshiring |
| Hodisalar tarixi | `GET /api/v1/admin/events`, JSON log: `data/nigoh.log` |
