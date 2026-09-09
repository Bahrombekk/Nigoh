"""Haqiqiy brauzerda ochilish vaqtini o'lchaydi (WebRTC va HLS alohida).

Pleyer avval WebRTC'ni sinaydi va 6 soniya kadr kelmasa HLS'ga o'tadi.
Shuning uchun "sekin ochilyapti" ning ikki xil manzarasi bor:

    WebRTC kadr beryapti   -> ochilish 1-2 s, hammasi joyida;
    WebRTC jim             -> 6 s behuda kutish + HLS (sovuq start 15-60 s),
                              hls.js esa manifestni 25 s kutadi va taslim
                              bo'ladi — kamera umuman ochilmaydi.

Skript aynan shuni ajratadi: har kamera uchun WHEP handshake, birinchi
kadr vaqti va (kerak bo'lsa) HLS zaxirasi o'lchanadi.

    python scripts/webrtc_olchov.py 102 103 28 33
"""
import json
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from geo_import import Service, load_env_file
from playwright.sync_api import sync_playwright

load_env_file(str(pathlib.Path(__file__).parent.parent / ".env"))
BASE = os.environ["NIGOH_URL"]
KEY = os.environ["NIGOH_KEY"]

# Brauzerda bajariladi: WHEP handshake + birinchi kadrni kutish.
JS = """
async ([whep, kutish]) => {
  const t0 = performance.now();
  const video = document.createElement("video");
  video.muted = true; video.autoplay = true; video.playsInline = true;
  document.body.appendChild(video);
  const pc = new RTCPeerConnection({iceServers: []});
  pc.addTransceiver("video", {direction: "recvonly"});
  pc.addTransceiver("audio", {direction: "recvonly"});
  const stream = new MediaStream();
  pc.ontrack = (e) => { stream.addTrack(e.track); video.srcObject = stream; };
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise((res) => {
    if (pc.iceGatheringState === "complete") return res();
    setTimeout(res, 900);
    pc.addEventListener("icegatheringstatechange",
      () => { if (pc.iceGatheringState === "complete") res(); });
  });
  let res;
  try {
    res = await fetch(whep, {method: "POST",
      headers: {"Content-Type": "application/sdp"}, body: pc.localDescription.sdp});
  } catch (e) { return {xato: "WHEP so'rovi yiqildi: " + e.message}; }
  const signal_ms = Math.round(performance.now() - t0);
  if (!res.ok) return {signal_ms, xato: "WHEP " + res.status};
  const javob = await res.text();
  const nomzodlar = javob.split(/\\r?\\n/).filter(l => l.includes("candidate"))
                         .map(l => l.trim()).slice(0, 8);
  await pc.setRemoteDescription({type: "answer", sdp: javob});

  const t1 = performance.now();
  const kadr = await new Promise((resolve) => {
    const timer = setInterval(() => {
      if (video.currentTime > 0) { clearInterval(timer); resolve(true); }
      else if (performance.now() - t1 > kutish) { clearInterval(timer); resolve(false); }
    }, 100);
  });
  const holat = pc.connectionState;
  pc.close();
  return {signal_ms, frame_ms: kadr ? Math.round(performance.now() - t1) : 0,
          kadr, holat, nomzodlar};
}
"""


def main() -> None:
    service = Service(BASE, KEY)
    cameras = {c["id"]: c for c in service.cameras()}
    tanlov = [cameras[int(a)] for a in sys.argv[1:] if int(a) in cameras]
    if not tanlov:
        tirik = [c for c in cameras.values()
                 if c.get("state") == "online" and c.get("codec")]
        tanlov = tirik[:6]

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge")
        page = browser.new_page()
        # Sahifa servis domenida bo'lsin — WHEP so'rovi bir xil manbadan ketadi.
        page.goto(BASE + "/", wait_until="domcontentloaded")

        print("   id kodek   signal   kadr   holat   nom")
        for cam in tanlov:
            manzil = json.loads(_stream(cam["id"]))
            whep = manzil.get("webrtc_url", "")
            if not whep:
                print(f"{cam['id']:>5} — whep manzili yo'q")
                continue
            r = page.evaluate(JS, [whep, 12000])
            kadr = "HA" if r.get("kadr") else "YO'Q"
            print(f"{cam['id']:>5} {(cam.get('codec') or '—'):<6} "
                  f"{r.get('signal_ms', 0):>6}ms {r.get('frame_ms', 0):>5}ms "
                  f"{kadr:<6} {(cam['name'] or '')[:34]}"
                  f"{'  << ' + r['xato'] if r.get('xato') else ''}")
            for n in (r.get("nomzodlar") or []):
                print(f"        {n}")
            if not r.get("nomzodlar") and not r.get("xato"):
                print("        (javobda birorta ICE nomzod yo'q)")
        browser.close()


def _stream(camera_id: int) -> str:
    import urllib.request
    req = urllib.request.Request(f"{BASE}/api/v1/cameras/{camera_id}/stream",
                                 headers={"X-API-Key": KEY})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode()


if __name__ == "__main__":
    main()
