"""SRT laboratoriya sinovi: yo'qotishli kanalda UDP va SRT ni solishtirish.

Kanal emulyatori — UDP relay: har yo'nalishda DELAY ms kechikish va LOSS
ulushda tasodifiy paket tashlash (o'lchangan Toshkent VPN: RTT ~46 ms,
yo'qotish 2-4 %). Manba — 3393/1 km ga o'xshash H.264 ~4,8 Mbit/s, GOP 2 s.

    python scripts/srt_lab.py                  # hamma holat
    python scripts/srt_lab.py udp_4 srt_4      # tanlanganlari
    SEED=11 python scripts/srt_lab.py srt_8    # boshqa tasodifiy ketma-ketlik

Manba fayl (test_h264.mkv) shu papkada bo'lsin; yo'q bo'lsa toza yozuvdan:
    ffmpeg -i <yozuv> -c:v libx264 -b:v 4.8M -g 50 -bf 0 -an test_h264.mkv

2026-10-06 natijasi (docs/SRT_LAB.md): UDP 4 % — 953/1000 kadr, 125 xato;
SRT 4 % va 8 % — 1000/1000 kadr, 0 xato.
"""
import asyncio
import json
import os
import random
import subprocess
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).parent
SRC = HERE / "test_h264.mkv"
DUR = 40           # sekund, har sinov
FPS = 25
ONE_WAY_MS = 23    # RTT 46 ms


class LossyLink:
    """Bitta UDP soket: mijozdan kelgani -> maqsadga, maqsaddan -> mijozga."""

    def __init__(self, listen: int, target: int, loss: float, delay_ms: int, seed: int | None = None):
        self.listen, self.target = listen, ("127.0.0.1", target)
        self.loss, self.delay = loss, delay_ms / 1000
        self.rnd = random.Random(int(os.environ.get("SEED", "7")) if seed is None else seed)
        self.client = None
        self.stats = {"fwd": 0, "fwd_drop": 0, "back": 0, "back_drop": 0}
        self.loop = asyncio.new_event_loop()
        self.ready = threading.Event()
        threading.Thread(target=self._run, daemon=True).start()
        self.ready.wait()

    def _run(self):
        asyncio.set_event_loop(self.loop)
        link = self

        class Proto(asyncio.DatagramProtocol):
            def connection_made(self, transport):
                link.tr = transport
                link.ready.set()

            def datagram_received(self, data, addr):
                to_target = addr != link.target
                if to_target:
                    link.client = addr
                key = "fwd" if to_target else "back"
                link.stats[key] += 1
                if link.rnd.random() < link.loss:
                    link.stats[key + "_drop"] += 1
                    return
                dest = link.target if to_target else link.client
                if dest:
                    link.loop.call_later(link.delay, link.tr.sendto, data, dest)

        self.loop.run_until_complete(self.loop.create_datagram_endpoint(
            Proto, local_addr=("127.0.0.1", self.listen)))
        self.loop.run_forever()

    def close(self):
        self.loop.call_soon_threadsafe(self.tr.close)
        self.loop.call_soon_threadsafe(self.loop.stop)


def analyze(path: Path) -> dict:
    if not path.exists() or path.stat().st_size < 1000:
        return {"frames": 0, "errors": 0, "mbps": 0}
    j = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
         "-show_entries", "stream=nb_read_frames:format=bit_rate", "-of", "json", str(path)],
        capture_output=True, text=True).stdout or "{}")
    frames = int((j.get("streams") or [{}])[0].get("nb_read_frames") or 0)
    err = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:v", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    return {"frames": frames, "errors": len([ln for ln in err.splitlines() if ln.strip()]),
            "mbps": round(int((j.get("format") or {}).get("bit_rate") or 0) / 1e6, 2)}


def run(name: str, proto: str, loss: float, latency_ms: int = 400, port: int = 9100) -> dict:
    out = HERE / f"out_{name}.ts"
    out.unlink(missing_ok=True)
    listen, target = port, port + 1
    link = LossyLink(listen, target, loss, ONE_WAY_MS)
    if proto == "srt":
        lat = latency_ms * 1000                       # ffmpeg libsrt: mikrosekund
        rx_url = f"srt://127.0.0.1:{target}?mode=listener&latency={lat}&pkt_size=1316"
        tx_url = f"srt://127.0.0.1:{listen}?mode=caller&latency={lat}&pkt_size=1316&connect_timeout=15000"
    else:
        rx_url = f"udp://127.0.0.1:{target}?fifo_size=1000000&overrun_nonfatal=1"
        tx_url = f"udp://127.0.0.1:{listen}?pkt_size=1316"
    rx = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-i", rx_url, "-c", "copy", "-t", str(DUR),
                           str(out)], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    time.sleep(1.0)
    tx = subprocess.Popen(["ffmpeg", "-v", "error", "-re", "-stream_loop", "-1", "-i", str(SRC),
                           "-c", "copy", "-t", str(DUR + 4), "-f", "mpegts", tx_url],
                          stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        rx.wait(timeout=DUR + 30)
    except subprocess.TimeoutExpired:
        rx.kill()
    tx.kill()
    link.close()
    res = {"sinov": name, "protokol": proto, "yo'qotish_%": round(loss * 100, 1),
           **analyze(out), "kutilgan_kadr": DUR * FPS,
           "relay": dict(link.stats)}
    print(json.dumps(res, ensure_ascii=False), flush=True)
    return res


if __name__ == "__main__":
    plan = [
        ("udp_0", "udp", 0.0), ("udp_2", "udp", 0.02), ("udp_4", "udp", 0.04),
        ("srt_2", "srt", 0.02), ("srt_4", "srt", 0.04), ("srt_8", "srt", 0.08),
        ("udp_8", "udp", 0.08),
    ]
    only = set(sys.argv[1:])
    for i, (name, proto, loss) in enumerate(plan):
        if only and name not in only:
            continue
        run(name, proto, loss, port=9100 + i * 10)
