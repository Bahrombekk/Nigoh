# Nigoh — serverga ko'chirish (IP bo'yicha HTTPS, ma'lumotlar bilan)

Hozirgi o'rnatma (Windows, Docker Desktop) to'liq — kameralar,
foydalanuvchilar, tarix, kamera parollari — Linux serverga ko'chiriladi.
Sayt serverning IP manzilidan HTTPS bilan ochiladi:
`https://SERVER_IP/`.

Quyida `SERVER_IP` — serverning foydalanuvchilar kiradigan IP manzili.
Hamma buyruq serverda `root` bilan (yoki `sudo`).

## 0. Server talablari

- Ubuntu 22.04 yoki 24.04, kamida 4 yadro / 8 GB RAM / 50 GB disk.
- **Server kameralar tarmog'iga yetishi shart** (10.30.x.x, 192.168.x.x —
  hozirgi kompyuter qayerlarga yetsa). Avval tekshiring:

  ```bash
  nc -zv 10.30.21.62 554        # biror kameraning IP'si — "succeeded" chiqsin
  ```

- NVIDIA GPU — ixtiyoriy (H.265 kameralarni o'girish uchun). Bo'lmasa
  servis CPU'da ishlaydi.

## 1. Hozirgi kompyuterda: paket

Ko'chirish kuni, **avval** bu yerdagi Nigoh'ni to'xtating — aks holda
paketdan keyingi o'zgarishlar yo'qoladi:

```powershell
cd C:\Users\User\Desktop\kamera-xarita
docker compose -f docker-compose.windows.yml down
venv\Scripts\python backend\scripts\server_paket.py
```

Ish stolida `nigoh-paket-YYYYMMDD-HHMM` papkasi paydo bo'ladi:

| Fayl | Nima |
|---|---|
| `nigoh.dump` | baza (kameralar, foydalanuvchilar, tarix) |
| `secret.key` | kamera parollarini ochadigan kalit — **busiz parollar o'qilmaydi** |
| `nigoh.bundle` | kod (git) |
| `snapshots.tar.gz` | kamera suratlari |
| `SHA256SUMS` | yaxlitlik tekshiruvi |

Paket **maxfiy**. Serverga faqat `scp`/flesh bilan o'tkazing:

```powershell
scp -r C:\Users\User\Desktop\nigoh-paket-YYYYMMDD-HHMM root@SERVER_IP:/root/paket
```

## 2. Serverda: Docker va PostgreSQL 17

```bash
apt update && apt install -y curl ca-certificates git
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# PostgreSQL 17 (rasmiy repozitoriy)
install -d /usr/share/postgresql-common/pgdg
curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release; echo $VERSION_CODENAME)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
apt update && apt install -y postgresql-17
```

PostgreSQL standart holatda faqat `127.0.0.1` da tinglaydi — shunday qolsin.

**GPU bo'lsa:** NVIDIA drayveri va
[nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
o'rnating, `nvidia-ctk runtime configure --runtime=docker && systemctl restart docker`.
**GPU bo'lmasa:** 5-qadamdan keyin `docker-compose.yml` dagi `runtime: nvidia`
va `environment:` (NVIDIA_...) qatorlarini `#` bilan izohga oling.

## 3. Paketni tekshirish va bazani tiklash

```bash
cd /root/paket && sha256sum -c SHA256SUMS          # hammasi OK bo'lsin

NIGOH_DB_PAROL=$(openssl rand -base64 24 | tr -d '/+=')
echo "$NIGOH_DB_PAROL"                             # 5-qadamda kerak — saqlab qo'ying

cd /tmp && git clone /root/paket/nigoh.bundle nigoh-sql   # setup-roles.sql uchun
sudo -u postgres psql -v parol="$NIGOH_DB_PAROL" -f /tmp/nigoh-sql/backend/database/sql/setup-roles.sql
# postgres foydalanuvchisi /root ni o'qiy olmaydi — fayl stdin orqali beriladi
sudo -u postgres pg_restore --no-owner --role=nigoh -d nigoh < /root/paket/nigoh.dump
sudo -u postgres psql -d nigoh -c "select count(*) as kameralar from cameras"
rm -rf /tmp/nigoh-sql
```

Kameralar soni hozirgi tizimdagidek (157) chiqishi kerak.

## 4. Kod va ma'lumot papkasi

```bash
git clone /root/paket/nigoh.bundle /opt/nigoh
cd /opt/nigoh
git remote set-url origin https://github.com/Bahrombekk/Nigoh.git   # keyingi yangilanishlar uchun

mkdir -p data
cp /root/paket/secret.key data/secret.key
tar -xzf /root/paket/snapshots.tar.gz -C data
chmod 600 data/secret.key
chown -R 1000:1000 data                             # konteyner UID 1000 bilan ishlaydi
```

## 5. Sozlamalar (`.env`)

```bash
cat > /opt/nigoh/.env <<EOF
PORT=8010
PUBLIC_VIEW=0
NIGOH_DB_PAROL=$NIGOH_DB_PAROL
DATABASE_URL=postgresql://nigoh:$NIGOH_DB_PAROL@127.0.0.1:5432/nigoh
# nginx (HTTPS) ham ko'tarilsin — docker compose va deploy/update.sh uchun
COMPOSE_PROFILES=https
EOF
chmod 600 /opt/nigoh/.env
```

Foydalanuvchilar va parollar bazadan ko'chgan — `ADMIN_PAROL` kerak emas,
hozirgi loginlar bilan kirasiz.

UDP kameralar uchun yadro buferi (bir marta):

```bash
cat > /etc/sysctl.d/99-nigoh.conf <<'CONF'
net.core.rmem_max = 16777216
net.core.rmem_default = 1048576
CONF
sysctl -p /etc/sysctl.d/99-nigoh.conf
```

## 6. HTTPS va ishga tushirish

```bash
cd /opt/nigoh
docker compose build
# sertifikat + nginx konfiguratsiyasi (IP bir nechta bo'lsa --ip ni takrorlang)
docker compose run --rm --no-deps nigoh python scripts/docker_https.py --server --ip SERVER_IP
docker compose up -d
```

Tartib muhim: `docker_https.py` **`up` dan oldin** — aks holda nginx
konfiguratsiyasi yo'q bo'lib ko'tariladi. Skript `data/secret.key` yo'q
bo'lsa to'xtaydi (yangi kalit yaratib, parollarni buzib qo'ymaydi).

## 7. Firewall

```bash
ufw allow 22/tcp
ufw allow 80/tcp          # faqat https:// ga yo'naltirish
ufw allow 443/tcp         # sayt + video
ufw allow 8189/udp        # WebRTC video
ufw allow 8189/tcp
ufw enable
```

8010, 8888, 8889, 5432 ochilMAYDI — ular nginx ortida yoki lokal.

## 8. Tekshirish

```bash
docker ps                                       # nigoh (healthy) va nigoh-nginx
curl -k https://SERVER_IP/health                # "ok":true, "mediamtx":true
docker logs --tail 30 nigoh
```

Brauzerda `https://SERVER_IP/` → hozirgi login/parol bilan kiring →
Xarita va Video devorda video ochilishini ko'ring.

## 9. Mijoz kompyuterlar: sertifikat

Sertifikat o'zimizniki (domen yo'q), shuning uchun brauzer avval
"xavfsiz emas" deydi. Ogohlantirishsiz ochilishi uchun serverdagi
`/opt/nigoh/data/tls/ca.crt` ni har bir mijozga o'rnating:

- Windows: `ca.crt` ni ikki marta bosing → Install Certificate → Local
  Machine → "Trusted Root Certification Authorities".
- Firefox o'z ro'yxatini ishlatadi: Settings → Certificates → Import.

IP o'zgarsa yoki yangisi qo'shilsa 6-qadamdagi `docker_https.py` ni qayta
yurgizib `docker compose restart nginx` qiling — CA o'zgarmaydi, mijozlarga
qayta o'rnatish kerak emas.

## 10. Yangilanish va zaxira

```bash
crontab -e
# kod yangilanishi (GitHub'dan, har 5 daqiqa; repoga kirish kerak — private bo'lsa deploy key)
*/5 * * * * /opt/nigoh/deploy/update.sh >> /var/log/nigoh-deploy.log 2>&1
# bazaning kunlik zaxirasi
15 3 * * * cd /opt/nigoh && backend/database/scripts/backup.sh >> /var/log/nigoh-backup.log 2>&1
```

## 11. Yakun

- Hammasi ishlagach `/root/paket` ni o'chiring (ichida kalit bor), lekin
  `secret.key` ning bir nusxasini xavfsiz joyda saqlang.
- Eski kompyuterda Nigoh'ni qayta yoqmang: ikkala nusxa bir vaqtda bitta
  kameralarga ulanadi va kameralarga ortiqcha yuk tushadi.

## Muammo bo'lsa

| Alomat | Sabab |
|---|---|
| `nigoh` konteyneri qayta-qayta yiqiladi, logda `unknown runtime nvidia` | GPU yo'q — 2-qadamdagi qatorlarni izohga oling |
| Kamera parollari ishlamaydi, hamma kamera "oflayn" | `data/secret.key` boshqa kalit — paketdagisini qo'ying, `docker compose restart nigoh` |
| nginx yiqiladi, `nigoh.conf: Is a directory` | `up` konfiguratsiyadan oldin yurgan — `docker_https.py` ni qayta yurgizing, `docker compose up -d` |
| Sayt ochiladi, video yo'q | 8189/udp yopiq yoki `--ip` noto'g'ri; `curl -k https://SERVER_IP/health` dagi `webrtc_public_hosts` ni tekshiring |
| `permission denied` /data | `chown -R 1000:1000 /opt/nigoh/data` |
