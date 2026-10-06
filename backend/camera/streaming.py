"""Brauzerga beriladigan oqim manzillari (WebRTC/HLS) va tugun ma'lumoti.

Kamera ochilganda qaysi MediaMTX yo'li beriladi — shu yerda hal bo'ladi:
xom (`<slug>`), o'girilgan (`<slug>_h264`) yoki past sifatli sub
(`<slug>_sub`, kerak bo'lsa `_sub_h264`). Qaror bazadagi `transcode`
bayrog'iga emas, skan yozgan HAQIQIY kodekka qarab chiqadi: bayroq
eskirgan bo'lishi mumkin va ishlab chiqarishda shunday bo'lgan (H.265
kameralarda bayroq 0 turgani uchun brauzerga xom H.265 sub berilib,
kataklar butunlay yashil chiqqan).

Har manzilga shu yo'lga bog'langan muddatli chipta qo'shiladi —
MediaMTX ruxsatni backend'dan so'raydi (/api/auth/stream), chiptasiz
oqim ochilmaydi. Kamera uzoq tugunga biriktirilgan bo'lsa brauzer
o'sha tugunga to'g'ridan ulanadi; MEDIA_BASE berilsa (HTTPS proksi)
lokal tugun oqimlari bitta domen ostidan yuradi.

Tarkibi:
    stream_urls(row, request, hevc_ok, quality)
                        {stream_url (HLS), webrtc_url (WHEP), mode};
                        mode: manual / direct / raw / transcode / sub
    media_host(request) brauzer ulanadigan MediaMTX hosti (MEDIA_HOST yoki
                        so'rov hosti)
    node_info(node_id)  tugun qatori, 30 s keshlanadi; 1-tugun (lokal) —
                        None, ya'ni bitta tugunli rejim bazaga tegmaydi
    clear_node_cache()  tugun tahrirlanganda keshni tozalaydi

Ishlatadi: app.config, camera.media.sync (suffikslar), core.security
(stream_token), database.nodes
Kim ishlatadi: camera/api (cameras, streams, nodes), camera/views.py,
walls/api.py (media_host)
"""
import time

from fastapi import Request

from app.config import HLS_PORT, MEDIA_BASE, MEDIA_HOST, WEBRTC_PORT
from camera.media import sync as mediamtx_sync
from core import security
from database import get_db, nodes


def media_host(request: Request) -> str:
    """MediaMTX qaysi manzilda ekani — brauzer shu manzilga ulanadi."""
    if MEDIA_HOST:
        return MEDIA_HOST
    host = request.url.hostname or "localhost"
    return "localhost" if host == "0.0.0.0" else host


_node_cache: dict[int, tuple[float, dict | None]] = {}


_NODE_TTL = 30.0


def node_info(node_id: int | None) -> dict | None:
    """Tugun ma'lumoti (qisqa keshlanadi).

    1-tugun — backend bilan bitta mashinadagi asosiy MediaMTX: uning uchun
    None qaytadi va muhit sozlamalari (portlar, so'rov hosti) ishlatiladi,
    ya'ni bitta tugunli rejim bazaga umuman murojaat qilmaydi.
    """
    nid = node_id or 1
    if nid == 1:
        return None
    now = time.monotonic()
    cached = _node_cache.get(nid)
    if cached and cached[0] > now:
        return cached[1]
    with get_db() as db:
        row = nodes.get(db, nid)
    info = dict(row) if row else None
    _node_cache[nid] = (now + _NODE_TTL, info)
    return info


def clear_node_cache() -> None:
    """Tugun tahrirlanganda kesh darhol yangilansin."""
    _node_cache.clear()


def _hevc(row) -> bool:
    """Kameraning sub oqimi H.265 mi (bilinmasa — asosiy oqimiga qarab).

    Brauzer H.265 ni WebRTC'da ocholmaganda oqim o'girilishi shart,
    shuning uchun bu savolga `transcode` bayrog'i emas, skan yozgan
    kodek javob beradi.
    """
    for ustun in ("sub_codec", "codec"):
        try:
            qiymat = (row[ustun] or "").upper()
        except (KeyError, IndexError, TypeError):
            continue
        if qiymat:
            return qiymat in ("H265", "HEVC")
    return False


def stream_urls(row, request: Request, hevc_ok: bool = False,
                quality: str = "") -> dict:
    """Kameraning oqim manzillari — faqat kerak bo'lganda so'raladi.

    `hevc_ok` — brauzer H.265 ni o'zi o'qiy oladi. Shunday bo'lsa, H.265
    kamera o'girilmaydi: oddiy `<kamera>` yo'lining o'zi xom oqimni beradi
    va GPU umuman ishlatilmaydi (mode: "raw"). Bunda WebRTC amalda
    ishlamaydi (u H.265 ni bilmaydi) — brauzer HLS'ga o'tadi.

    `quality="sub"` — past sifatli ikkinchi oqim (video devor setkasi
    uchun). Kamerada sub yo'l bo'lmasa, jimgina asosiy oqim qaytadi.
    """
    host = media_host(request)
    if not row["ip"]:
        return {"stream_url": row["stream_url"] or "", "webrtc_url": "",
                "mode": "manual"}

    # Kamera boshqa tugunga biriktirilgan bo'lsa, brauzer o'sha tugunga
    # to'g'ridan-to'g'ri ulanadi — trafik markaz orqali aylanib yurmaydi.
    hls_port, webrtc_port = HLS_PORT, WEBRTC_PORT
    node = node_info(row["node_id"])
    if node:
        host = node["public_host"] or host
        hls_port, webrtc_port = node["hls_port"], node["webrtc_port"]

    # Xom yo'l — MediaMTX kameradan to'g'ridan-to'g'ri oladi, FFmpeg yo'q.
    #
    # O'girish ikki holatda kerak:
    #   1) brauzer H.265 ni uddalay olmasa;
    #   2) "tez ochilsin" belgilangan bo'lsa — kameralarning keyframe oralig'i
    #      2-4 soniya, o'girilgan oqimda esa 1,2 soniya, ya'ni ikki barobar
    #      tez ochiladi. Buning narxi: doimiy FFmpeg va GPU.
    slug = row["slug"]
    if quality == "sub" and row["sub_path"]:
        slug += mediamtx_sync.SUB_SUFFIX
        mode = "sub"
        # Sub-oqim odatda H.264 bo'ladi — lekin har doim emas: H.265
        # kameraning ikkinchi oqimi ham H.265 chiqishi mumkin (o'lchovda
        # shunday kameralar uchradi). Xom H.265 brauzerga berilsa tasvir
        # chiqmaydi yoki birinchi kadrda qotib qoladi, shuning uchun sub
        # ham asosiy oqim bilan bir xil qoidada o'giriladi. `mode` "sub"
        # bo'lib qolaveradi: ishlamasa pleyer avvalgidek asosiyga o'tadi.
        # Qaror BAYROQQA emas, HAQIQIY KODEKGA qarab chiqadi.
        #
        # `transcode` — qo'shishda yoziladigan metama'lumot va u xato
        # yoki eskirgan bo'lishi mumkin. Ishlab chiqarishda aynan shu
        # bo'ldi: H.265 kameralarda bayroq 0 turgani uchun brauzerga
        # XOM H.265 sub berildi va uchta katak butunlay yashil chiqdi
        # (dekoder oqimni umuman ocholmaydi). Bayroq to'g'ri bo'lgan
        # o'rnatmada esa o'sha kameralar toza ishlayotgan edi — ya'ni
        # farq kamerada emas, bazadagi yozuvda edi.
        if not hevc_ok and (row["transcode"] or _hevc(row)):
            slug += mediamtx_sync.TRANSCODE_SUFFIX
    elif row["transcode"] and (not hevc_ok or row["always_on"]):
        slug += mediamtx_sync.TRANSCODE_SUFFIX
        mode = "transcode"
    else:
        mode = "raw" if row["transcode"] else "direct"

    # Chipta shu yo'lga bog'langan va muddatli — MediaMTX'ni backend
    # tekshiradi (users/api.py, stream_auth), chiptasiz oqim ochilmaydi.
    token = security.stream_token(slug)

    # HTTPS proksi rejimi: hamma oqim bitta domen ostidan yuradi, portlar
    # tashqariga ko'rinmaydi. Uzoq tugunlar bunga kirmaydi — ular o'z
    # manzilida qoladi.
    if MEDIA_BASE and not node:
        return {
            "stream_url": f"{MEDIA_BASE}/hls/{slug}/index.m3u8?token={token}",
            "webrtc_url": f"{MEDIA_BASE}/whep/{slug}/whep?token={token}",
            "mode": mode,
        }
    return {
        "stream_url": f"http://{host}:{hls_port}/{slug}/index.m3u8?token={token}",
        # WebRTC ancha tez ochiladi — brauzer avval shuni sinaydi.
        "webrtc_url": f"http://{host}:{webrtc_port}/{slug}/whep?token={token}",
        "mode": mode,
    }
