"""Kamera saqlanishidan oldin kodek va sub yo'lni aniqlash; kanal shablonlari.

Admin kamerani qo'shganda yoki tahrirlaganda kameraning o'zidan
so'raladi: qaysi kodek (H.265 bo'lsa o'girish kerak), qaysi o'lcham va
kadr tezligi, past sifatli ikkinchi oqim bormi. Kamera javob bermasa
saqlash to'xtamaydi — maydonlar bo'sh qoladi va keyin passport.py fonda
to'ldiradi.

Tarkibi:
    channel_path(vendor, channel, stream)  kanal raqamidan ishlab chiqaruvchi
                                           RTSP yo'li (hikvision, dahua/amcrest,
                                           uniview, reolink, axis, holowits)
    detect_sub_path(cam, password)         (sub_path, sub_codec): admin bergan
                                           yo'l yoki shablondan hosil qilinib
                                           tekshirilgan yo'l; javob bermagani
                                           saqlanmaydi (ayrim Holowits
                                           kanallarida Media2 xato beradi)
    detect_codec(cam, password)            (codec, needs_transcode, resolution,
                                           fps); fps=0 — SDP'da bermagan kamera

Ishlatadi: camera.probe.rtsp_probe, camera.media.fast_start.channel_from_path,
camera.schemas.CameraIn
Kim ishlatadi: camera/api/admin.py (create/update, detect-sub, NVR import),
camera/api/devices.py (skan)
"""
from camera.media.fast_start import channel_from_path
from camera.probe.rtsp_probe import probe
from camera.schemas import CameraIn


def channel_path(vendor: str, channel: int, stream: str) -> str:
    """Kanal raqamidan ishlab chiqaruvchiga mos RTSP yo'lini quradi."""
    sub = stream == "sub"
    if vendor == "hikvision":
        # 101 = 1-kanal asosiy, 102 = 1-kanal qo'shimcha oqim
        return f"/Streaming/Channels/{channel}0{2 if sub else 1}"
    if vendor in ("dahua", "amcrest"):
        return f"/cam/realmonitor?channel={channel}&subtype={1 if sub else 0}"
    if vendor == "uniview":
        return f"/unicast/c{channel}/s{2 if sub else 1}/live"
    if vendor == "reolink":
        return f"/h264Preview_{channel:02d}_{'sub' if sub else 'main'}"
    if vendor == "axis":
        return f"/axis-media/media.amp?camera={channel}"
    if vendor == "holowits":
        return f"/LiveMedia/ch{channel}/Media{2 if sub else 1}"
    return f"/stream{2 if sub else 1}"


def detect_sub_path(cam: CameraIn, password: str) -> tuple[str, str]:
    """Past sifatli ikkinchi oqim yo'lini va kodegini topadi.

    Admin qiymat kiritgan bo'lsa — o'sha saqlanadi (kodek tekshiruvda
    aniqlanadi). Kiritmagan bo'lsa ishlab chiqaruvchi shablonidan hosil
    qilinadi va tekshiriladi: javob bermagan yo'l saqlanmaydi (ba'zi
    NVR'lar ikkinchi oqimni bermaydi — masalan, ayrim Holowits
    kanallarida Media2 xato beradi).

    Qaytaradi: (sub_path, sub_codec). Kodek alohida saqlanadi — devor
    plitkasida "H265" yorlig'i ko'rinib, aslida H.264 sub ko'rsatilayotgan
    chalkashlik bo'lmasin.
    """
    if cam.source_type != "rtsp" or not cam.ip.strip():
        return (cam.sub_path or "").strip(), ""

    if cam.sub_path is not None:
        sub = cam.sub_path.strip()
        if not sub:
            return "", ""
        result = probe(cam.ip.strip(), cam.port, sub,
                       cam.username.strip(), password)
        return sub, result.get("codec", "") if result.get("ok") else ""

    candidate = channel_path(cam.vendor, channel_from_path(cam.rtsp_path), "sub")
    if candidate == cam.rtsp_path.strip():
        return "", ""                      # asosiy oqimning o'zi sub ekan
    result = probe(cam.ip.strip(), cam.port, candidate,
                   cam.username.strip(), password)
    if not result.get("ok"):
        return "", ""
    return candidate, result.get("codec", "")


def detect_codec(cam: CameraIn, password: str) -> tuple[str, bool, str, float]:
    """Saqlashdan oldin kamera kodegi, o'lchami va kadr tezligini aniqlaydi.

    Qaytaradi: (codec, needs_transcode, resolution, fps).

    Kamera javob bermasa bo'sh qaytaradi — bu saqlashga to'sqinlik qilmaydi.
    `fps` 0 bo'lishi ham normal: ba'zi kameralar SDP'da kadr tezligini
    umuman bermaydi.
    """
    if cam.source_type != "rtsp" or not cam.ip.strip():
        return "", False, "", 0.0
    result = probe(cam.ip.strip(), cam.port, cam.rtsp_path.strip(),
                   cam.username.strip(), password)
    if not result.get("ok"):
        return "", False, "", 0.0
    return (result.get("codec", ""), bool(result.get("needs_transcode")),
            result.get("resolution", ""), float(result.get("fps") or 0.0))
