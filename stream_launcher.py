"""Nigoh — bitta kamera oqimini ochadigan yordamchi.

MediaMTX buni kimdir kamerani ko'rmoqchi bo'lganda chaqiradi:

    python stream_launcher.py <slug>

Skript bazadan kamerani topadi, parolini ochadi va FFmpeg'ni ishga tushiradi.
Shu tufayli `mediamtx.yml` ichida kameralar ro'yxati ham, parollar ham
saqlanmaydi — 1000 ta kamera bo'lsa ham konfiguratsiya o'zgarmaydi.
"""
import os
import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

import security                                  # noqa: E402
from db import get_db                            # noqa: E402
from mediamtx_sync import (RTSP_PORT, ffmpeg_path,  # noqa: E402
                           has_nvenc, relay_args, transcode_args)
from rtsp_probe import build_rtsp_url            # noqa: E402


# Brauzer H.265 ni o'zi o'qiy olsa, shu qo'shimcha bilan so'raladi va
# video umuman o'girilmaydi.
RAW_SUFFIX = "_raw"


def load_camera(slug: str):
    with get_db() as db:
        row = db.execute(
            "SELECT slug, ip, port, username, password_enc, rtsp_path, "
            "transcode, enabled FROM cameras WHERE slug = ?",
            (slug,),
        ).fetchone()
    return row


def main() -> int:
    slug = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get("MTX_PATH", "")).strip()
    if not slug:
        print("Kamera nomi berilmadi", file=sys.stderr)
        return 2

    # `<kamera>_raw` — brauzer kodekni o'zi uddalaydi, o'girish shart emas.
    raw_only = slug.endswith(RAW_SUFFIX)
    lookup = slug[: -len(RAW_SUFFIX)] if raw_only else slug

    row = load_camera(lookup)
    if row is None:
        print(f"Kamera topilmadi: {lookup}", file=sys.stderr)
        return 3
    if not row["enabled"]:
        print(f"Kamera o'chirilgan: {slug}", file=sys.stderr)
        return 4
    if not row["ip"]:
        print(f"Kamerada IP yo'q: {slug}", file=sys.stderr)
        return 5

    source = build_rtsp_url(
        row["ip"], row["port"] or 554, row["rtsp_path"] or "/",
        row["username"] or "", security.decrypt(row["password_enc"]),
    )
    destination = f"rtsp://127.0.0.1:{RTSP_PORT}/{slug}"

    exe = ffmpeg_path()
    if not exe:
        print("FFmpeg topilmadi — PATH ga qo'shing", file=sys.stderr)
        return 6

    if row["transcode"] and not raw_only:
        args = transcode_args(source, destination, gpu=has_nvenc())
        mode = "GPU" if has_nvenc() else "CPU"
        print(f"{slug}: H.264 ga o'girilmoqda ({mode})", file=sys.stderr)
    else:
        args = relay_args(source, destination)
        why = "brauzer kodekni o'zi o'qiydi" if raw_only else "kodek mos"
        print(f"{slug}: o'girishsiz uzatilmoqda ({why})", file=sys.stderr)

    # FFmpeg shu jarayonning o'rnini egallaydi — MediaMTX uni to'g'ridan
    # to'g'ri boshqaradi (to'xtatish signali ham to'g'ri yetib boradi).
    process = subprocess.Popen([exe] + args)
    try:
        return process.wait()
    except KeyboardInterrupt:
        process.terminate()
        try:
            return process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            return 1


if __name__ == "__main__":
    sys.exit(main())
