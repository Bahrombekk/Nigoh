"""Kamera ochilish vaqtini bosqichma-bosqich o'lchaydi (HLS yo'li bilan).

"Sekin ochilyapti" degan shikoyatni raqamga aylantiradi. Uch bosqich
alohida o'lchanadi, chunki ularning sababi ham, yechimi ham har xil:

    stream_ms   /cameras/{id}/stream — backend yo'lni MediaMTX'da
                tayyorlaydi (H.265 bo'lsa FFmpeg o'girishini ham
                ko'taradi). Sekin bo'lsa muammo shu qatlamda.
    playlist_ms birinchi m3u8 — MediaMTX muxer tayyor bo'lishini kutish.
    segment_ms  birinchi videobo'lak — kameradan keyframe kutish.

    python scripts/ochilish_olchov.py            # aralash namuna
    python scripts/ochilish_olchov.py 28 31      # aniq kameralar
"""
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from geo_import import Service, load_env_file

load_env_file(str(pathlib.Path(__file__).parent.parent / ".env"))
BASE = os.environ["NIGOH_URL"]
KEY = os.environ["NIGOH_KEY"]
service = Service(BASE, KEY)


def olib(url: str, timeout: float = 45.0) -> tuple[int, bytes]:
    req = urllib.request.Request(url, headers={"X-API-Key": KEY})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:200]
    except Exception as e:                       # tarmoq/timeout
        return 0, repr(e)[:200].encode()


def olcha(cam: dict) -> dict:
    natija = {"id": cam["id"], "name": cam["name"][:30],
              "codec": cam.get("codec") or "—",
              "transcode": bool(cam.get("transcode"))}

    t0 = time.monotonic()
    kod, tana = olib(f"{BASE}/api/v1/cameras/{cam['id']}/stream")
    natija["stream_ms"] = int((time.monotonic() - t0) * 1000)
    if kod != 200:
        natija["xato"] = f"stream {kod}: {tana[:80].decode(errors='replace')}"
        return natija

    import json
    manzillar = json.loads(tana)
    hls = manzillar.get("stream_url") or ""
    natija["mode"] = manzillar.get("mode", "")
    if not hls:
        natija["xato"] = "hls manzili yo'q"
        return natija

    # Muxer tayyor bo'lguncha m3u8 404/503 berishi mumkin — shuning uchun
    # birinchi MUVAFFAQIYATLI javobgacha bo'lgan vaqt o'lchanadi.
    t1 = time.monotonic()
    pleylist = b""
    while time.monotonic() - t1 < 40:
        kod, tana = olib(hls, timeout=10)
        if kod == 200 and b"#EXT" in tana:
            pleylist = tana
            break
        time.sleep(0.5)
    natija["playlist_ms"] = int((time.monotonic() - t1) * 1000)
    if not pleylist:
        natija["xato"] = f"pleylist kelmadi ({kod})"
        return natija

    # Master pleylist bo'lsa ichidagi variantga kiramiz.
    satrlar = [s.strip() for s in pleylist.decode(errors="replace").splitlines()
               if s.strip() and not s.startswith("#")]
    if not satrlar:
        natija["xato"] = "pleylist bo'sh"
        return natija
    asos = hls.rsplit("/", 1)[0]
    keyingi = satrlar[0]
    if not keyingi.startswith("http"):
        keyingi = f"{asos}/{keyingi}"
    if ".m3u8" in keyingi:
        kod, tana = olib(keyingi, timeout=15)
        satrlar = [s.strip() for s in tana.decode(errors="replace").splitlines()
                   if s.strip() and not s.startswith("#")]
        asos = keyingi.rsplit("/", 1)[0].split("?")[0]
        if not satrlar:
            natija["xato"] = "bo'laklar ro'yxati bo'sh"
            return natija
        keyingi = satrlar[0]
        if not keyingi.startswith("http"):
            token = hls.split("?", 1)[1] if "?" in hls else ""
            keyingi = f"{asos}/{keyingi}" + (f"?{token}" if token and "?" not in keyingi else "")

    t2 = time.monotonic()
    kod, tana = olib(keyingi, timeout=30)
    natija["segment_ms"] = int((time.monotonic() - t2) * 1000)
    natija["segment_kb"] = len(tana) // 1024 if kod == 200 else 0
    if kod != 200:
        natija["xato"] = f"segment {kod}"
    natija["total_ms"] = (natija["stream_ms"] + natija["playlist_ms"]
                          + natija["segment_ms"])
    return natija


def main() -> None:
    cameras = {c["id"]: c for c in service.cameras()}
    if len(sys.argv) > 1:
        tanlov = [cameras[int(a)] for a in sys.argv[1:] if int(a) in cameras]
    else:
        tirik = [c for c in cameras.values()
                 if c.get("state") == "online" and c.get("codec")]
        h264 = [c for c in tirik if (c["codec"] or "").upper() == "H264"][:4]
        h265 = [c for c in tirik if (c["codec"] or "").upper() == "H265"][:4]
        tanlov = h264 + h265

    print("   id kodek  ogir  rejim    stream   plist  segment    jami  nom / xato")
    for cam in tanlov:
        _chop(olcha(cam))
        # Ikkinchi ochilish — yo'l allaqachon tirik. Sovuq va issiq
        # ochilish farqi muammoning qayerdaligini aniq ko'rsatadi.
        issiq = olcha(cam)
        issiq["name"] = "^ ikkinchi urinish (issiq)"
        _chop(issiq)


def _chop(r: dict) -> None:
    ogir = "ha" if r["transcode"] else "yo'q"
    xato = ("  << " + r["xato"]) if r.get("xato") else ""
    print(f"{r['id']:>5} {r['codec']:<6} {ogir:<5} {r.get('mode', '—'):<8} "
          f"{r.get('stream_ms', 0):>6}ms {r.get('playlist_ms', 0):>6}ms "
          f"{r.get('segment_ms', 0):>7}ms {r.get('total_ms', 0):>6}ms  "
          f"{r['name']}{xato}")


if __name__ == "__main__":
    main()
