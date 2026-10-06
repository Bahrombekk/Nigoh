"""Nigoh — parollar, kamera parollari shifri, sessiyalar va oqim chiptalari.

Kamera parollari MediaMTX/FFmpeg uchun ochiq holda kerak bo'ladi, shuning
uchun ular qaytariladigan shifr (Fernet) bilan saqlanadi. Kalit
`DATA_DIR/secret.key` faylida turadi (yo'q bo'lsa yaratiladi, faqat egasi
o'qiy oladi) — bu fayl bazaning o'zi kabi maxfiy; yo'qolsa parollar
ochilmaydi. Oqim chiptasi, HLS CDN kaliti va ichki chipta kalitlari ham
shu kalitdan hosil qilinadi — alohida fayl kerak emas.

Foydalanuvchi paroli qaytarilmaydigan hash (scrypt) sifatida saqlanadi.
Sessiyada bazada tokenning o'zi emas, SHA-256 xeshi turadi: baza nusxasi
qo'lga tushsa ham undan tayyor kirish tokeni olinmaydi.

Oqim chiptalari (MediaMTX kirish nazorati): MediaMTX portlari ochiq
bo'lgani uchun har o'qish so'rovi backend'dan so'raladi (authMethod:
http), backend esa saytdan berilgan qisqa muddatli chiptani tekshiradi.
HLS brauzer tokenni faqat birinchi so'rovga qo'shadi, shuning uchun to'g'ri
token kelganda (ip, OQIM YO'LI) sessiyasi ochiladi va segmentlar shu orqali
yuradi. Imzo ham, sessiya ham asosiy yo'lga normallashtiriladi
("kamera_1/video1_seg9.mp4" -> "kamera_1"): aks holda tomosha o'rtasida
401 boshlanardi (o'lchov: ~25-45 s dan keyin). "kamera_1" chiptasi
"kamera_10" ga o'tmaydi — chegara "/".

HLS CDN kaliti (`hlsCDNSecret`) endi avtomatik: ilgari u .env da qo'lda
ikki joyga (.env + nginx) yozilishi kerak edi, HTTPS bloki eski namunadan
ko'chirilib tomoshabin doimiy 401 oldi. Sozlanadigan yagona joy nginx —
`python scripts/nginx_conf.py` tayyor holda chiqaradi; HLS_CDN_SECRET
berilsa ustun turadi (bir necha server bitta kalitni bo'lishsa).

Ichki chipta: launcher FFmpeg'i va snapshot zaxirasi MediaMTX'ga
127.0.0.1 dan ulanadi, lekin IP'ga ishonib bo'lmaydi (nginx ortida hamma
127.0.0.1) — shuning uchun muddatsiz, kalitdan hosil qilingan chipta.

Tarkibi:
    encrypt(plain) / decrypt(token)     kamera paroli shifri (buzuq/kalit
                                        almashgan bo'lsa decrypt "" qaytaradi)
    stream_token(path)                  yo'l uchun imzolangan chipta (?token=)
    stream_access_ok(ip, path, token)   MediaMTX/nginx so'rovini tekshiradi
    hls_cdn_secret()                    hlsCDNSecret va nginx Bearer qiymati
    internal_token() / internal_token_ok(t)   ichki jarayonlar chiptasi
    hash_password(p, salt) / verify_password(p, h, salt)   scrypt
    create_session(db, user_id, ip, ua) yangi sessiya tokeni (12 soat)
    session_user(db, token)             yaroqli sessiya egasi yoki None
    delete_session(db, token)           chiqish
    purge_expired_sessions(db)          muddati o'tganlarni o'chiradi
    ensure_admin(db)                    birinchi ishga tushishda super-admin
                                        (ADMIN_LOGIN / ADMIN_PAROL; parol
                                        berilmasa tasodifiy, qaytariladi)
    set_password(db, username, p)       parol o'rnatadi (yo'q bo'lsa admin
                                        yaratadi); sessiyalar bekor bo'ladi
    KEY_PATH, SESSION_COOKIE ("nigoh_session"), SESSION_HOURS (12),
    STREAM_TOKEN_TTL (3600 s), STREAM_SESSION_TTL (600 s)

Ishlatadi: core.paths (DATA_DIR), database.users.
Kim ishlatadi: users/{api,access,admin_api}.py, app/bootstrap.py,
    camera/streaming.py, walls/api.py, camera/api/{admin,devices}.py,
    camera/media/{sync,launcher,fast_start,mapping,reconciler,transport}.py,
    camera/monitoring/{passport,snapshots}.py, scripts (nginx_conf,
    import_mediamtx, frame_interval, keyframe_interval, stream_soak_test),
    database/scripts/fix_camera_data.py.
"""
import base64
import hashlib
import hmac
import os
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone

from cryptography.fernet import Fernet, InvalidToken

from core.paths import DATA_DIR
from database import users

# Kalit fayli ma'lumotlar katalogida — baza bilan yonma-yon turadi.
KEY_PATH = DATA_DIR / "secret.key"

SESSION_COOKIE = "nigoh_session"
SESSION_HOURS = 12


# ---------- kamera parollarini shifrlash ----------

def _load_key() -> bytes:
    if KEY_PATH.exists():
        return KEY_PATH.read_bytes().strip()
    key = Fernet.generate_key()
    KEY_PATH.write_bytes(key)
    try:  # faqat egasi o'qiy olsin (Windows'da e'tiborsiz qoldiriladi)
        os.chmod(KEY_PATH, 0o600)
    except OSError:
        pass
    return key


_fernet = Fernet(_load_key())


def encrypt(plain: str) -> str:
    return _fernet.encrypt(plain.encode()).decode()


def decrypt(token: str | None) -> str:
    if not token:
        return ""
    try:
        return _fernet.decrypt(token.encode()).decode()
    except InvalidToken:
        # Kalit almashtirilgan yoki yozuv buzilgan.
        return ""


# ---------- oqim chiptalari (MediaMTX kirish nazorati) ----------
#
# MediaMTX portlari (8554/8888/8889) hammaga ochiq edi: slug'ni bilgan har
# kim saytga kirmasdan kamerani ko'ra olardi. Endi MediaMTX har bir o'qish
# so'rovini backend'dan so'raydi (authMethod: http), backend esa saytdan
# berilgan qisqa muddatli chiptani tekshiradi.
#
# HLS'ning nozik joyi: brauzer tokenni faqat birinchi so'rovga (index.m3u8)
# qo'shadi, segment so'rovlariga emas. Shuning uchun to'g'ri token kelganda
# (ip, yo'l) juftligiga qisqa "sessiya" ochiladi — segmentlar shu sessiya
# orqali yuradi va har ruxsatli so'rovda uzayadi.

STREAM_TOKEN_TTL = 3600        # soniya — ulanishni boshlash uchun
STREAM_SESSION_TTL = 600       # soniya — har ruxsatli so'rovda uzayadi

# Kalit secret.key'dan hosil qilinadi — alohida fayl kerak emas.
_stream_key = hashlib.sha256(b"nigoh-stream:" + _load_key()).digest()
_stream_sessions: dict[tuple[str, str], float] = {}
_stream_lock = threading.Lock()


def _stream_sig(path: str, expires: int) -> str:
    mac = hmac.new(_stream_key, f"{path}|{expires}".encode(), hashlib.sha256)
    return base64.urlsafe_b64encode(mac.digest()[:20]).decode().rstrip("=")


def _sig_matches(sig: str, path: str, expires: int) -> bool:
    """Chipta shu yo'lga (yoki uning ichki resursiga) tegishlimi.

    Chipta oqim yo'liga imzolanadi ("kamera_1"), lekin MediaMTX ba'zi
    so'rovlarda ICHKI resurs bilan murojaat qiladi — masalan HLS variant
    playlisti "kamera_1/video1_stream.m3u8". Aynan tekshirilsa bunday
    so'rov rad etilardi va tomosha o'rtasida video uzilardi (o'lchov:
    tomosha boshlangandan ~25-45 soniya keyin 401 boshlanardi).

    Prefiks bo'yicha moslik xavfsiz: "kamera_1" chiptasi faqat
    "kamera_1" va uning ichidagi resurslarga ruxsat beradi. Yondosh
    "kamera_10" ga o'tmaydi — chegara sifatida "/" talab qilinadi.
    """
    if hmac.compare_digest(sig, _stream_sig(path, expires)):
        return True
    base = path.split("/", 1)[0]
    if base and base != path:
        return hmac.compare_digest(sig, _stream_sig(base, expires))
    return False


def stream_token(path: str) -> str:
    """Bitta yo'l uchun imzolangan chipta — oqim manziliga ?token= bo'lib qo'shiladi."""
    expires = int(time.time()) + STREAM_TOKEN_TTL
    return f"{expires}.{_stream_sig(path, expires)}"


def _session_key(ip: str, path: str) -> tuple[str, str]:
    """Sessiya kaliti — HAR DOIM oqim yo'lining o'zi bo'yicha.

    MediaMTX ichki resurslarni ham so'raydi ("kamera_1/video1_seg7.mp4").
    Ilgari kalit to'liq yo'l bo'yicha olinardi va shu sababli sessiya
    ishlamasdi: "kamera_1" uchun ochilgan sessiya "kamera_1/..." ni
    qoplamaydi. Natijada tokensiz kelgan segment so'rovlari 401 olardi —
    ishlab chiqarishda o'lchandi:

        yo'l "kamera_1"                    tokensiz -> 200
        yo'l "kamera_1/video1_stream.m3u8" tokensiz -> 401
        yo'l "kamera_1/video1_seg9.mp4"    tokensiz -> 401

    Imzo tekshiruvi (`_sig_matches`) allaqachon asosiy yo'lga
    normallashtirilgan; sessiya ham xuddi shunday bo'lishi shart, aks
    holda mexanizmning butun ma'nosi yo'qoladi (u aynan tokensiz
    segmentlar uchun bor).
    """
    base = path.split("/", 1)[0]
    # Bo'sh baza (masalan "/kamera_1") bo'lsa to'liq yo'l ishlatiladi —
    # aks holda barcha oqim bitta ("", ip) kalitiga tushib qolardi.
    return (ip, base or path)


def stream_access_ok(ip: str, path: str, token: str) -> bool:
    """MediaMTX'dan kelgan o'qish so'rovini tekshiradi.

    To'g'ri token — ruxsat + (ip, oqim yo'li) sessiyasi. Tokensiz so'rov
    faqat tirik sessiya bo'lsa o'tadi (HLS segmentlari, WHEP davomi).
    """
    now = time.time()
    key = _session_key(ip, path)
    if token:
        expires_s, _, sig = token.partition(".")
        try:
            expires = int(expires_s)
        except ValueError:
            expires = 0
        if expires > now and _sig_matches(sig, path, expires):
            with _stream_lock:
                if len(_stream_sessions) > 10_000:      # chegara: eskilar chiqsin
                    for k in [k for k, t in _stream_sessions.items() if t <= now]:
                        _stream_sessions.pop(k, None)
                _stream_sessions[key] = now + STREAM_SESSION_TTL
            return True
    with _stream_lock:
        alive = _stream_sessions.get(key, 0.0) > now
        if alive:
            _stream_sessions[key] = now + STREAM_SESSION_TTL
    return alive


# ---------- HLS "CDN kaliti" ----------
#
# MediaMTX `hlsCDNSecret` — bu kalit `Authorization: Bearer` sarlavhasida
# kelsa MediaMTX so'rovni SESSIYASIZ o'tkazadi va manzillarga na
# `session=`, na `token=` qo'shadi. Sarlavhani nginx qo'yadi.
#
# Nima uchun kalit endi AVTOMATIK: ilgari u .env dagi ixtiyoriy sozlama
# edi va ikkita joyda (.env + nginx) qo'lda bir xil yozilishi kerak edi.
# Amalda bu bajarilmadi — HTTPS (443) bloki docs/DEPLOY.md dagi eski
# namunadan ko'chirilgan bo'lib, unda na `auth_request`, na Bearer
# sarlavhasi bor edi. Natijada MediaMTX sessiyali rejimda qoldi va manba
# har uzilganda tomoshabin DOIMIY 401 oldi:
#
#     .../media/hls/<slug>/video1_stream.m3u8?session=...&token=...  -> 401
#
# Lokalda muammo ko'rinmasdi, chunki MEDIA_BASE bo'sh bo'lganda brauzer
# videoni to'g'ridan MediaMTX portidan oladi (nginx umuman yo'q).
#
# Endi kalit secret.key'dan hosil qilinadi — HAR DOIM mavjud, hech
# qachon bo'sh emas. Sozlanadigan yagona joy nginx, uni esa
# `python scripts/nginx_conf.py` tayyor holda chiqarib beradi.
#
# HLS_CDN_SECRET muhit o'zgaruvchisi qo'yilsa u ustun turadi (bir necha
# server bitta kalitni bo'lishishi kerak bo'lgan hol).

_cdn_key = hashlib.sha256(b"nigoh-hls-cdn:" + _load_key()).digest()


def hls_cdn_secret() -> str:
    """MediaMTX `hlsCDNSecret` va nginx `Authorization: Bearer` qiymati."""
    override = os.environ.get("HLS_CDN_SECRET", "").strip()
    if override:
        return override
    return base64.urlsafe_b64encode(_cdn_key).decode().rstrip("=")


# ---------- ichki jarayonlar chiptasi ----------
#
# Launcher'ning FFmpeg'i (o'girish) va snapshot zaxirasi MediaMTX'ga
# 127.0.0.1 dan ulanadi, lekin IP'ga ishonib bo'lmaydi: nginx proksi
# ortida barcha tomoshabin ham 127.0.0.1 bo'lib ko'rinadi. Shuning uchun
# ichki jarayonlar muddatsiz, secret.key'dan hosil qilingan alohida
# chipta bilan yuradi — kalit almashsa chipta ham almashadi.

_internal_key = hashlib.sha256(b"nigoh-internal:" + _load_key()).digest()


def internal_token() -> str:
    """Ichki jarayonlar (FFmpeg) uchun muddatsiz chipta."""
    return base64.urlsafe_b64encode(_internal_key[:20]).decode().rstrip("=")


def internal_token_ok(token: str) -> bool:
    return bool(token) and hmac.compare_digest(token, internal_token())


# ---------- admin paroli ----------

def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.scrypt(
        password.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1, dklen=32
    )
    return base64.b64encode(digest).decode(), salt


def verify_password(password: str, pw_hash: str, salt: str) -> bool:
    candidate, _ = hash_password(password, salt)
    return hmac.compare_digest(candidate, pw_hash)


# ---------- sessiyalar ----------
#
# Bazada tokenning o'zi emas, SHA-256 xeshi turadi: baza nusxasi (zaxira,
# sizib chiqqan dump) qo'lga tushsa ham undan tayyor kirish tokeni
# olinmaydi. Token 256 bitli tasodifiy satr — tuzsiz xesh yetarli.

def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(db, user_id: int, ip: str | None = None,
                   user_agent: str | None = None) -> str:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(hours=SESSION_HOURS)
    users.add_session(db, _token_hash(token), user_id, expires, ip, user_agent)
    users.mark_login(db, user_id)
    return token


def session_user(db, token: str | None):
    """Yaroqli sessiya bo'lsa foydalanuvchi yozuvini, aks holda None qaytaradi."""
    if not token:
        return None
    row = users.session_user(db, _token_hash(token))
    if row is None:
        return None
    if row["expires_at"] < datetime.now(timezone.utc):
        users.delete_session(db, _token_hash(token))
        return None
    return row


def delete_session(db, token: str | None) -> None:
    if token:
        users.delete_session(db, _token_hash(token))


def purge_expired_sessions(db) -> None:
    users.purge_expired_sessions(db, datetime.now(timezone.utc))


# ---------- admin yaratish ----------

def ensure_admin(db) -> str | None:
    """Birinchi ishga tushishda super-admin yaratadi.

    Parol ADMIN_PAROL muhit o'zgaruvchisidan olinadi; berilmagan bo'lsa
    tasodifiy parol yaratiladi va konsolga chiqarish uchun qaytariladi.
    """
    if users.count(db) > 0:
        return None

    username = os.environ.get("ADMIN_LOGIN", "admin")
    password = os.environ.get("ADMIN_PAROL")
    generated = password is None
    if generated:
        password = secrets.token_urlsafe(9)

    pw_hash, salt = hash_password(password)
    users.create(db, username, pw_hash, salt, role="admin")
    return password if generated else None


def set_password(db, username: str, password: str) -> bool:
    """Parolni o'rnatadi (foydalanuvchi bo'lmasa admin qilib yaratadi);
    eski sessiyalar bekor qilinadi."""
    pw_hash, salt = hash_password(password)
    user_id = users.id_by_username(db, username)
    if user_id is None:
        users.create(db, username, pw_hash, salt, role="admin")
    else:
        users.set_password(db, user_id, pw_hash, salt)
    return True
