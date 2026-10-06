"""Har uchastka kanalini o'lchash: RTT, tebranish (jitter), yo'qotish — 200 ta 1300 baytli ping."""
import json
import re
import statistics
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).parent
N = 200
sites = json.loads((HERE / "sites.json").read_text())


def ping(ip):
    out = subprocess.run(["ping", "-n", str(N), "-l", "1300", "-w", "1000", ip],
                         capture_output=True, text=True, encoding="cp866", errors="replace").stdout
    times = [int(t) for t in re.findall(r"(?:time|время)[=<](\d+)", out)]
    return ip, times


jobs = []
for s in sites:
    for ip in list(dict.fromkeys(s["ips"]))[:2]:
        jobs.append((s["site"], ip))
with ThreadPoolExecutor(len(jobs)) as ex:
    res = list(ex.map(lambda j: (j[0], *ping(j[1])), jobs))

summary = {}
for site, ip, times in res:
    d = summary.setdefault(site, {"ips": [], "times": [], "sent": 0})
    d["ips"].append(ip)
    d["times"] += times
    d["sent"] += N
out = []
for s in sites:
    d = summary[s["site"]]
    t = d["times"]
    loss = round(100 * (1 - len(t) / d["sent"]), 1)
    row = {"site": s["site"], "regions": s["regions"], "km": f"{s['kmin']}-{s['kmax']}",
           "cams": s["n"], "loss_%": loss,
           "rtt_avg": round(statistics.fmean(t), 1) if t else None,
           "rtt_p95": sorted(t)[int(0.95 * len(t)) - 1] if t else None,
           "jitter": round(statistics.pstdev(t), 1) if len(t) > 1 else None}
    out.append(row)
    print(json.dumps(row, ensure_ascii=False))
(HERE / "site_links.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
