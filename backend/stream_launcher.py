"""MediaMTX chaqiradigan kirish nuqtasi — asosiy kod camera/media/launcher.py da.

    python stream_launcher.py <slug>

MediaMTX yo'l so'ralganda (runOnDemand) shu faylni ishga tushiradi; slug
argumentdan yoki MTX_PATH muhit o'zgaruvchisidan olinadi.
`camera.media.launcher.main()` slug bo'yicha ishni tanlaydi: kamera
relay'i yoki o'girish (`_h264`) uchun FFmpeg, `wall_<kalit>` bo'lsa —
devor mozaikasi (walls/registry.py + walls/mosaic.py).

Bu fayl backend/ ildizida turishi shart: mediamtx.yml dagi runOnDemand
buyrug'i aynan shu yo'lni ko'rsatadi (camera/media/sync.py —
BACKEND_DIR / "stream_launcher.py"). Fayl o'z papkasini sys.path ga
qo'shadi, shuning uchun MediaMTX uni istalgan ishchi katalogdan chaqira oladi.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from camera.media.launcher import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
