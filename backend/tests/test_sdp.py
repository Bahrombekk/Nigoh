from camera.probe.rtsp_probe import (
    sdp_codec,
    sdp_fps,
    sdp_resolution,
    sdp_video_control,
    sps_resolution,
)

DESCRIBE = """RTSP/1.0 200 OK\r
Content-Base: rtsp://10.0.0.1:554/Streaming/Channels/101/\r
\r
v=0
m=video 0 RTP/AVP 96
a=rtpmap:96 H265/90000
a=x-dimensions:2560,1440
a=framerate:25
a=control:trackID=1
"""


def test_sdp_codec():
    assert sdp_codec(DESCRIBE) == "H265"
    assert sdp_codec("a=rtpmap:96 H264/90000") == "H264"
    assert sdp_codec("a=rtpmap:97 HEVC/90000") == "H265"   # sinonim
    assert sdp_codec("hech narsa") == ""


def test_sdp_resolution():
    assert sdp_resolution(DESCRIBE) == "2560x1440"
    assert sdp_resolution("a=framesize:96 1920-1080") == "1920x1080"
    assert sdp_resolution("bo'sh") == ""


def test_sdp_fps():
    assert sdp_fps(DESCRIBE) == 25.0
    assert sdp_fps("a=x-framerate: 12.5") == 12.5
    assert sdp_fps("yo'q") == 0.0


def test_sdp_video_control():
    # nisbiy control Content-Base'ga qo'shiladi
    uri = "rtsp://10.0.0.1:554/Streaming/Channels/101"
    assert sdp_video_control(DESCRIBE, uri) == (
        "rtsp://10.0.0.1:554/Streaming/Channels/101/trackID=1")
    # to'liq URL bo'lsa o'zi qaytadi
    full = DESCRIBE.replace("a=control:trackID=1",
                            "a=control:rtsp://10.0.0.1/full/track1")
    assert sdp_video_control(full, uri) == "rtsp://10.0.0.1/full/track1"
    # control yo'q — so'rov manzili
    assert sdp_video_control("m=video 0 RTP/AVP 96", uri) == uri


# Haqiqiy kameralar SDP'idagi SPS (2026-10-06 o'lchovi) va ffmpeg bilan
# yasalgan namunalar (1366x766 — kesish/cropping bilan, o'lcham 16 ga bo'linmaydi).
SPS_CASES = [
    ("sprop-parameter-sets", "J2QAM6wTGqAoALWhAAADAAEAAAMAMgQA", "2560x1440"),      # Dahua
    ("sprop-parameter-sets", "Z2QAH6wsaoFAFum4KAgqAAADAAIAAAMAZQgA", "1280x720"),   # Dahua
    ("sprop-parameter-sets", "Z00AKp24HgCJ+WbgICAoAAADAAgAAAMBlCA=", "1920x1080"),  # Hikvision
    ("sprop-parameter-sets", "Z/QAIJGbKArAw8XeAiAAAAMAIAAAAwFB4wYywA==", "1366x766"),  # x264
    ("sprop-sps", "QgEBBAgAAAMAnggAAAMAAHiQAFWQBgO7yys0kmV4C3AgIABAAAADAEAAAAMBQg==",
     "1366x766"),                                                                      # x265
]


def test_sps_dan_olcham():
    for key, sps, want in SPS_CASES:
        describe = ("m=video 0 RTP/AVP 96\r\n"
                    f"a=fmtp:96 packetization-mode=1;{key}={sps},aOuPLA==")
        assert sps_resolution(describe) == want, key
        # Alohida o'lcham qatori bo'lmasa sdp_resolution SPS'ga tushadi (Dahua holati).
        assert sdp_resolution(describe) == want


def test_sps_yoq_yoki_buzuq():
    assert sps_resolution("a=fmtp:96 packetization-mode=1") == ""          # Holowits H.265
    assert sps_resolution("a=fmtp:96 sprop-parameter-sets=Z2Q=") == ""     # kesilgan SPS
    assert sps_resolution("a=fmtp:96 sprop-parameter-sets=!!!") == ""
    # Alohida qator SPS'dan ustun (kamera nima e'lon qilgan bo'lsa).
    assert sdp_resolution(DESCRIBE + "a=fmtp:96 sprop-parameter-sets=" + SPS_CASES[0][1]) == "2560x1440"
