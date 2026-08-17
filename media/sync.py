"""Nigoh — MediaMTX bilan bog'lash (media paketi).

Backend MediaMTX bilan faqat shu modul orqali gaplashadi: konfiguratsiya
yaratish (`write_config`), jonli API (`ensure_path`, `push_to_api`) va
FFmpeg buyruqlari shu yerda.

Konfiguratsiya kameralar soniga bog'liq emas. `mediamtx.yml` ichida
kameralar ro'yxati ham, parollar ham yozilmaydi — bitta shablon yo'l
bor, u chaqirilganda `stream_launcher.py` bazadan kerakli kamerani topadi.

Nima uchun shunday:

  * 1000 ta kamera bo'lsa ham fayl o'zgarmaydi va MediaMTX'ni qayta
    ishga tushirish shart emas — yangi kamera qo'shilishi bilan ishlaydi.
  * Parollar faqat shifrlangan holda bazada qoladi; konfiguratsiya
    fayliga ochiq holda tushmaydi.
  * Kamera faqat kimdir ko'rayotganda ulanadi, ya'ni resurs kameralar
    soniga emas, tomoshabinlar soniga qarab sarflanadi.

"Doim tayyor" deb belgilangan kameralargina alohida yoziladi — ular
bir zumda ochiladi, lekin doimo resurs egallaydi.

Kodek haqida: ko'p kamera H.265 (HEVC) beradi, brauzerlar buni o'qiy
olmaydi. Bunday kameralar FFmpeg orqali H.264 ga o'giriladi; NVIDIA
karta bo'lsa butun jarayon GPU'da ketadi.
"""
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path

from core.rtsp_probe import build_rtsp_url

import yaml

# Loyiha ildizi — bu fayl media/ ichida turadi, mediamtx.yml esa ildizda
# qoladi (ishga-tushirish.bat va MediaMTX shu yerdan o'qiydi).
BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = BASE_DIR / "mediamtx.yml"
API_BASE = os.environ.get("MEDIAMTX_API", "http://127.0.0.1:9997")
API_TIMEOUT = 4.0

RTSP_PORT = int(os.environ.get("MEDIAMTX_RTSP_PORT", "8554"))
HLS_PORT = int(os.environ.get("HLS_PORT", "8888"))
WEBRTC_PORT = int(os.environ.get("WEBRTC_PORT", "8889"))

HEADER = """# Nigoh tomonidan avtomatik yaratilgan — qo'lda tahrirlamang.
# Kameralarni saytdagi super-admin panelidan boshqaring; bu fayl
# "MediaMTX" oynasidagi tugma bosilganda qayta yoziladi.
"""


# ---------- FFmpeg ----------

@lru_cache(maxsize=1)
def ffmpeg_path() -> str:
    return shutil.which("ffmpeg") or ""


@lru_cache(maxsize=1)
def has_nvenc() -> bool:
    """NVIDIA GPU orqali H.264 kodlash mumkinmi."""
    exe = ffmpeg_path()
    if not exe:
        return False
    try:
        out = subprocess.run([exe, "-hide_banner", "-encoders"],
                             capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.SubprocessError):
        return False
    return "h264_nvenc" in out.stdout


_INPUT = ["-hide_banner", "-loglevel", "warning",
          "-fflags", "nobuffer", "-flags", "low_delay",
          # FFmpeg standart holda oqimni 5 soniya "o'rganadi" — kamerada
          # bitta video yo'l bo'lgani uchun bunga hojat yo'q, shu bilan
          # birinchi ochilish bir necha soniyaga qisqaradi.
          "-analyzeduration", "1000000", "-probesize", "1000000",
          "-rtsp_transport", "tcp"]

# WebRTC uchun paketlar kichik bo'lsin — MediaMTX ularni qayta bo'lmasin.
_OUTPUT = ["-an", "-pkt_size", "1200", "-f", "rtsp", "-rtsp_transport", "tcp"]


def relay_args(src_url: str, dst_url: str) -> list[str]:
    """Kamera H.264 bergan holat: video umuman ochilmaydi.

    Paketlar borligicha uzatiladi — na dekodlash, na kodlash bor.
    Sarf: bir necha foiz protsessor va ~30 MB xotira.
    """
    return _INPUT + ["-i", src_url, "-c", "copy"] + _OUTPUT + [dst_url]


def transcode_args(src_url: str, dst_url: str, gpu: bool = True,
                   bitrate: str = "3M") -> list[str]:
    """Kamera H.265 bergan holat: dekodlash va qayta kodlash.

    H.265 va H.264 — bir-biriga o'xshamaydigan siqish usullari, shuning
    uchun oraliq qadamsiz o'girib bo'lmaydi: tasvirni ochib, qaytadan
    siqish shart. Buni yo'qotishning yagona yo'li — kamerani H.264 ga
    o'tkazish, shunda yuqoridagi `relay_args` ishlaydi.
    """
    if gpu:
        # Dekodlash ham, kodlash ham GPU'da — nusxalashsiz.
        video = [
            "-hwaccel", "cuda", "-hwaccel_output_format", "cuda",
            "-i", src_url,
            "-c:v", "h264_nvenc", "-preset", "p1", "-tune", "ull",
            "-rc", "cbr", "-b:v", bitrate,
        ]
    else:
        video = [
            "-i", src_url,
            "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
            "-b:v", bitrate,
        ]
    # Qisqa GOP — segment tezroq tayyor bo'ladi.
    return _INPUT + video + ["-g", "30", "-bf", "0"] + _OUTPUT + [dst_url]


# ---------- yo'llar ----------

TRANSCODE_SUFFIX = "_h264"


def _launcher(slug_expr: str) -> str:
    """`stream_launcher.py` ni chaqiruvchi buyruq."""
    python = sys.executable or "python"
    script = BASE_DIR / "stream_launcher.py"
    return f'"{python}" "{script}" {slug_expr}'


def source_path(cam: dict) -> dict:
    """Kamerani MediaMTX o'zi tortadigan yo'l.

    FFmpeg ishlatilmaydi: MediaMTX RTSP'ni to'g'ridan-to'g'ri oladi. Bu ham
    tezroq (jarayon ishga tushirilmaydi), ham yengilroq (~220 MB o'rniga
    bir necha MB), ham ishonchliroq — FFmpeg nusxalashda B-kadrli H.264
    oqimni buzib yuborardi.
    """
    conf = {
        "source": build_rtsp_url(
            cam["ip"], cam["port"], cam.get("rtsp_path") or "/",
            cam.get("username") or "", cam.get("password") or "",
        ),
        # UDP'da paketlar yo'qoladi va tasvir buziladi — TCP majburiy.
        "rtspTransport": "tcp",
        "sourceOnDemand": not cam.get("always_on"),
    }
    if conf["sourceOnDemand"]:
        conf["sourceOnDemandStartTimeout"] = "20s"
        # MediaMTX davomiyliklarni normallashtirib saqlaydi ("60s" -> "1m0s").
        # Taqqoslash (ensure_path/push_to_api) aynan mos kelishi uchun
        # qiymatlar uning o'z shaklida yoziladi — aks holda har safar
        # keraksiz PATCH ketadi.
        conf["sourceOnDemandCloseAfter"] = "1m0s"
    return conf


def camera_paths(cameras: list[dict]) -> dict:
    """MediaMTX `paths` bo'limi.

    Kameralar bu yerga yozilmaydi — ular ishlab turgan MediaMTX'ga API
    orqali qo'shiladi (`ensure_path`). Faylda faqat o'girish uchun shablon
    qoladi, shuning uchun 1000 kamerada ham hajmi o'zgarmaydi va parollar
    diskka tushmaydi.
    """
    return {
        f"~^[a-z0-9_]+{TRANSCODE_SUFFIX}$": {
            "runOnDemand": _launcher("$MTX_PATH"),
            "runOnDemandRestart": True,
            "runOnDemandStartTimeout": "20s",
            "runOnDemandCloseAfter": "1m0s",   # MediaMTX normallashtirgan shakl
        }
    }


def build_config(cameras: list[dict]) -> str:
    """To'liq mediamtx.yml matnini qaytaradi."""
    config = {
        "logLevel": "info",
        "api": True,
        "apiAddress": "127.0.0.1:9997",

        "rtsp": True,
        "rtspAddress": f":{RTSP_PORT}",
        "rtspTransports": ["tcp"],

        # WebRTC — asosiy yo'l, eng tez ochiladi.
        "webrtc": True,
        "webrtcAddress": f":{WEBRTC_PORT}",
        "webrtcAllowOrigins": ["*"],
        "webrtcLocalUDPAddress": ":8189",

        # HLS — WebRTC ishlamagan brauzerlar uchun zaxira.
        "hls": True,
        "hlsAddress": f":{HLS_PORT}",
        "hlsVariant": "lowLatency",
        # Doimiy remux qilinsa xom H.265 yo'llari ham bekorga HLS'ga o'giriladi;
        # asosiy yo'l WebRTC bo'lgani uchun bunga hojat yo'q.
        "hlsAlwaysRemux": False,
        "hlsSegmentCount": 7,
        "hlsSegmentDuration": "1s",
        "hlsPartDuration": "200ms",
        "hlsAllowOrigins": ["*"],

        "rtmp": False,
        "srt": False,

        "paths": camera_paths(cameras) or {},
    }
    body = yaml.safe_dump(config, allow_unicode=True, sort_keys=False,
                          default_flow_style=False, width=10000)
    return HEADER + "\n" + body


def write_config(cameras: list[dict]) -> int:
    """mediamtx.yml faylini qayta yozadi, tayyor kameralar sonini qaytaradi."""
    CONFIG_PATH.write_text(build_config(cameras), encoding="utf-8")
    return sum(1 for c in cameras if c.get("ip") and c.get("enabled"))


# ---------- ishlab turgan MediaMTX bilan aloqa ----------

def _api(method: str, path: str, payload: dict | None = None):
    url = f"{API_BASE.rstrip('/')}{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=API_TIMEOUT) as res:
        raw = res.read()
    return json.loads(raw) if raw else None


def api_available() -> bool:
    try:
        _api("GET", "/v3/config/global/get")
        return True
    except (urllib.error.URLError, OSError, ValueError):
        return False


def ensure_path(cam: dict) -> bool:
    """Kamera yo'li MediaMTX'da borligiga ishonch hosil qiladi.

    Ko'rish so'ralganda chaqiriladi. Yo'l yo'q bo'lsa qo'shiladi, borligi
    boshqacha bo'lsa yangilanadi. Shu sababli MediaMTX qayta ishga tushsa
    ham hech narsani qo'lda tiklash kerak emas.
    """
    if not cam.get("ip"):
        return False
    slug, wanted = cam["slug"], source_path(cam)
    try:
        current = _api("GET", f"/v3/config/paths/get/{slug}")
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            return False
        current = None
    except (urllib.error.URLError, OSError, ValueError):
        return False

    try:
        if current is None:
            _api("POST", f"/v3/config/paths/add/{slug}", wanted)
        elif any(current.get(k) != v for k, v in wanted.items()):
            _api("PATCH", f"/v3/config/paths/patch/{slug}", wanted)
        return True
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, ValueError):
        return False


def ensure_transcode_path(cam: dict) -> bool:
    """"Tez ochilsin" kameralari uchun o'girilgan oqim doim tayyor tursin.

    Shablon yo'l o'girishni faqat so'ralganda boshlaydi; bu yerda esa uni
    doimiy ishlatib qo'yamiz, aks holda "tez" degani birinchi ochilishda
    ishlamaydi.
    """
    if not (cam.get("transcode") and cam.get("always_on") and cam.get("enabled")):
        return False
    name = cam["slug"] + TRANSCODE_SUFFIX
    wanted = {"runOnInit": _launcher(name), "runOnInitRestart": True}
    try:
        try:
            current = _api("GET", f"/v3/config/paths/get/{name}")
        except urllib.error.HTTPError as exc:
            if exc.code != 404:
                return False
            current = None
        if current is None:
            _api("POST", f"/v3/config/paths/add/{name}", wanted)
        elif current.get("runOnInit") != wanted["runOnInit"]:
            _api("PATCH", f"/v3/config/paths/patch/{name}", wanted)
        return True
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, ValueError):
        return False


def desired_paths(cameras: list[dict]) -> dict:
    """MediaMTX'da (API orqali) turishi kerak bo'lgan to'liq holat.

    Uch qatlam: o'girish shabloni, har bir yoqilgan kameraning manba yo'li
    va "doim tayyor" o'girish yo'llari. `push_to_api` MediaMTX'ni aynan shu
    ro'yxatga keltiradi — ortiqchasi o'chadi, kamisi qo'shiladi.
    """
    wanted = dict(camera_paths(cameras))
    for cam in cameras:
        if not (cam.get("enabled") and cam.get("ip")):
            continue
        wanted[cam["slug"]] = source_path(cam)
        if cam.get("transcode") and cam.get("always_on"):
            name = cam["slug"] + TRANSCODE_SUFFIX
            wanted[name] = {"runOnInit": _launcher(name), "runOnInitRestart": True}
    return wanted


def _list_all_paths() -> dict[str, dict] | None:
    """API'dagi barcha yo'l konfiguratsiyalari — sahifalab, to'liq.

    Bitta so'rov 1000 tagacha qaytaradi; 5000 kamerada qolgani ko'rinmay
    qolardi, shuning uchun `pageCount` tugaguncha o'qiladi.
    """
    paths: dict[str, dict] = {}
    page = 0
    while True:
        try:
            chunk = _api(
                "GET", f"/v3/config/paths/list?itemsPerPage=500&page={page}"
            ) or {}
        except (urllib.error.URLError, OSError, ValueError):
            return None
        for item in chunk.get("items", []):
            paths[item["name"]] = item
        page += 1
        if page >= int(chunk.get("pageCount") or 1):
            return paths


def push_to_api(cameras: list[dict]) -> dict:
    """Ishlab turgan MediaMTX'ni kerakli holatga keltiradi (qayta ishga
    tushirmasdan): yo'q yo'llar qo'shiladi, o'zgarganlari yangilanadi,
    ortiqchalari o'chiriladi. O'zgarmaganlarga tegilmaydi, amallar parallel
    yuboriladi — 5000 kamerada ham soniyalar ichida tugaydi.
    """
    wanted = desired_paths(cameras)
    existing = _list_all_paths()
    if existing is None:
        return {"ok": False, "added": 0, "updated": 0, "removed": 0,
                "message": "MediaMTX ishlamayapti — fayl yangilandi, "
                           "MediaMTX'ni ishga tushiring"}

    ops: list[tuple[str, str, dict | None]] = []
    for name, conf in wanted.items():
        current = existing.get(name)
        if current is None:
            ops.append(("POST", f"/v3/config/paths/add/{name}", conf))
        elif any(current.get(k) != v for k, v in conf.items()):
            ops.append(("PATCH", f"/v3/config/paths/patch/{name}", conf))
    for name in existing:
        if name not in wanted:
            ops.append(("DELETE", f"/v3/config/paths/delete/{name}", None))

    def _run(op: tuple[str, str, dict | None]):
        method, path, payload = op
        try:
            _api(method, path, payload)
            return method, None
        except (urllib.error.URLError, OSError, ValueError) as exc:
            return method, f"{path.rsplit('/', 1)[-1]}: {exc}"

    added = updated = removed = 0
    errors: list[str] = []
    with ThreadPoolExecutor(max_workers=16) as pool:
        for method, error in pool.map(_run, ops):
            if error is not None:
                if method != "DELETE":     # o'chirishdagi xato jiddiy emas
                    errors.append(error)
            elif method == "POST":
                added += 1
            elif method == "PATCH":
                updated += 1
            else:
                removed += 1

    if errors:
        return {"ok": False, "added": added, "updated": updated, "removed": removed,
                "message": "Ba'zi yo'llar yuborilmadi: " + "; ".join(errors[:2])}
    return {"ok": True, "added": added, "updated": updated, "removed": removed,
            "message": f"MediaMTX yangilandi (+{added} / ~{updated} / -{removed})"}
