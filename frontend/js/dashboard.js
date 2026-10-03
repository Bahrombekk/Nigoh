/* Dashboard: KPI kartalar, hodisalar lentasi, hudud kesimi (/api/stats/dashboard). */
import { $, esc, state } from "./holat.js";
import { api } from "./api.js";
import { hasGeo, map } from "./xarita.js";
import { setQuery } from "./royxat.js";
import { selectCamera } from "./tanlov.js";
import { renderDailyCharts, renderEvents, renderHourly, renderSystem, renderTimeline } from "./grafiklar.js";
import { showTab } from "./tablar.js";

/* ---------- Dashboard ---------- */
export function addEvent(text, kind) {
  state.events.unshift({ t: Date.now(), text, kind });
  if (state.events.length > 50) state.events.pop();
  renderEvents();
}

/* KPI qiymati: ma'lumot bo'lmasa "—" yoziladi va yonidagi birlik
   ("s", "ta") yashiriladi — "— s" degan g'alati yozuv chiqmasin. */
function setKpi(id, value) {
  const el = $(id);
  el.textContent = value == null ? "—" : value;
  const unit = el.nextElementSibling;
  if (unit && unit.classList.contains("u")) unit.hidden = value == null;
}

/* O'zgarish belgisi: musbat/manfiy va yaxshi/yomon tomon. `higherIsBetter`
   onlaynlik uchun true, uzilishlar uchun false. Ma'lumot yo'q bo'lsa bo'sh. */
function setDelta(id, diff, unit, higherIsBetter) {
  const el = $(id);
  if (diff == null || !isFinite(diff)) { el.textContent = ""; el.className = "kp-d"; return; }
  const rounded = Math.round(diff);
  if (rounded === 0) {
    el.textContent = "o'zgarishsiz";
    el.className = "kp-d flat";
    return;
  }
  const good = higherIsBetter ? rounded > 0 : rounded < 0;
  el.textContent = (rounded > 0 ? "▲ +" : "▼ ") + rounded + unit;
  el.className = "kp-d " + (good ? "up" : "down");
}

export function renderDashMetrics() {
  const total = state.cameras.length;
  const on = state.cameras.filter((c) => c.online === true).length;
  const off = state.cameras.filter((c) => c.online === false).length;
  $("m-total").textContent = total;
  $("m-total-note").textContent = new Set(state.cameras.map((c) => c.region)).size + " hududda";
  const pctOn = total ? Math.round((on / total) * 100) : 0;
  $("m-online").textContent = total ? pctOn + "%" : "—";
  $("m-online-n").textContent = on;
  $("m-online-note").textContent = "Hozirda faol kameralar";
  $("m-online-bar").style.width = pctOn + "%";
  const pctOff = total ? Math.round((off / total) * 100) : 0;
  $("m-down-pct").textContent = total ? pctOff + "%" : "—";
  $("m-down-bar").style.width = pctOff + "%";
  setKpi("m-ev", state.stats ? state.stats.events_today : null);

  // Taqqoslashlar faqat haqiqiy tarixdan: onlaynlik 24 soat oldingi
  // o'lchov bilan, bugungi uzilishlar kechagi kun bilan solishtiriladi.
  const tlAll = (state.stats && state.stats.timeline) || [];
  const first = tlAll.find((p) => p.total > 0);
  setDelta("m-online-d", first
    ? pctOn - Math.round((first.online / first.total) * 100) : null, "%", true);
  const d = (state.stats && state.stats.daily) || [];
  const yest = d.length > 1 ? d[d.length - 2].events : null;
  setDelta("m-ev-d", yest == null || !state.stats
    ? null : state.stats.events_today - yest, "", false);
  $("m-ev-note").textContent = state.stats
    ? (state.stats.events_today ? "bugun qayd etilgan" : "bugun uzilish yo'q")
    : "tarix yuklanmoqda…";
  const now = new Date(), pd = (n) => String(n).padStart(2, "0");
  $("dash-upd").textContent = pd(now.getHours()) + ":" + pd(now.getMinutes()) + ":" + pd(now.getSeconds());
  const t = state.openTimes;
  setKpi("m-open", t.length
    ? (t.reduce((s, v) => s + v, 0) / t.length / 1000).toFixed(2).replace(".", ",")
    : null);
  $("m-open-note").textContent = t.length
    ? "shu seansda " + t.length + " o'lchov" : "hali oqim ochilmadi";
  $("m-down").textContent = off;
  $("m-down-note").textContent = off ? "Tekshirish talab qiladi"
    : state.stats ? "bugun " + state.stats.events_today + " ta uzilish"
    : "hammasi joyida";
  renderDonut();
  renderSpark();
}

/* Holat taqsimoti — donut. Markazda bosh ko'rsatkich: onlayn foizi. */
function renderDonut() {
  const on = state.cameras.filter((c) => c.online === true).length;
  const off = state.cameras.filter((c) => c.online === false).length;
  const unk = state.cameras.length - on - off;
  const total = state.cameras.length || 1;
  const parts = [
    { label: "Onlayn", n: on, color: "var(--ok)" },
    { label: "Uzilgan", n: off, color: "var(--danger)" },
    { label: "Noma'lum", n: unk, color: "var(--faint)" },
  ].filter((p) => p.n > 0);

  const R = 46, C = 2 * Math.PI * R;
  const gap = parts.length > 1 ? 3 : 0;   // segmentlar orasidagi "havo"
  let acc = 0;
  const segs = parts.map((p) => {
    const frac = p.n / total;
    const len = Math.max(C * frac - gap, 0.5);
    const s = '<circle cx="60" cy="60" r="' + R + '" fill="none" pathLength="' + C.toFixed(2) +
      '" style="stroke:' + p.color + ';stroke-width:13" stroke-dasharray="' +
      len.toFixed(2) + " " + C.toFixed(2) + '" stroke-dashoffset="' + (-acc - gap / 2).toFixed(2) +
      '" transform="rotate(-90 60 60)"><title>' + p.label + ": " + p.n + " ta</title></circle>";
    acc += C * frac;
    return s;
  }).join("");
  const pct = Math.round((on / total) * 100);
  $("donut").innerHTML = segs +
    '<text x="60" y="58" text-anchor="middle" style="font:700 23px var(--font),sans-serif;fill:var(--text)">' + pct + "%</text>" +
    '<text x="60" y="76" text-anchor="middle" style="font:700 8.5px var(--font),sans-serif;letter-spacing:.1em;fill:var(--faint)">ONLAYN</text>';
  $("donut-legend").innerHTML = parts.map((p) =>
    '<div class="dl"><i style="background:' + p.color + '"></i>' + p.label +
    " <b>" + p.n + " ta</b></div>").join("");
}

/* Ochilish vaqtlari sparkline'i — seansdagi so'nggi 24 o'lchov. */
function renderSpark() {
  const el = $("m-open-spark");
  const data = state.openTimes.slice(-24);
  if (data.length < 2) { el.innerHTML = ""; return; }
  const W = 200, H = 30, P = 4;
  const max = Math.max(...data), min = Math.min(...data);
  const x = (i) => P + (W - 2 * P) * i / (data.length - 1);
  const y = (v) => max === min ? H / 2 : H - P - (H - 2 * P) * (v - min) / (max - min);
  const pts = data.map((v, i) => x(i).toFixed(1) + "," + y(v).toFixed(1)).join(" ");
  const lx = x(data.length - 1).toFixed(1), ly = y(data[data.length - 1]).toFixed(1);
  el.innerHTML =
    '<polygon points="' + P + "," + (H - P) + " " + pts + " " + lx + "," + (H - P) +
      '" style="fill:var(--accent);opacity:.1"/>' +
    '<polyline points="' + pts + '" vector-effect="non-scaling-stroke" ' +
      'style="fill:none;stroke:var(--accent);stroke-width:2;stroke-linejoin:round;stroke-linecap:round"/>' +
    '<circle cx="' + lx + '" cy="' + ly + '" r="3.5" style="fill:var(--accent);stroke:var(--surface-2);stroke-width:2"/>';
}

export function renderDash() {
  renderDashMetrics();
  renderSystem();
  renderAttention();
  renderToday();
  renderFlapping();
  renderRegions();
  renderTech();
  renderSlow();
  renderEvents();
  renderTimeline();
  renderDailyCharts();
  renderHourly();
  loadStats();
}

/* Tarixiy statistika serverdan olinadi — kelgach grafiklar qayta chiziladi. */
let statsLoading = false;
export async function loadStats() {
  if (statsLoading) return;
  statsLoading = true;
  try {
    state.stats = await api("/api/stats/dashboard");
    if (state.tab === "dash") {
      renderDashMetrics();
      renderRegions();
      renderEvents();
      renderTimeline();
      renderDailyCharts();
      renderHourly();
    }
  } catch (e) { /* endpoint bo'lmasa — jonli qism ishlayveradi */ }
  statsLoading = false;
}

/* Hududlar jadvali: joriy holat + 24 soatlik o'rtacha + bugungi uzilishlar. */
function renderRegions() {
  // Tartib: ko'p uzilgani tepada — operator muammodan boshlaydi.
  const downBy = new Map();
  state.cameras.forEach((c) => {
    if (c.online === false) downBy.set(c.region, (downBy.get(c.region) || 0) + 1);
  });
  const regions = [...new Set(state.cameras.map((c) => c.region))]
    .sort((x, y) => (downBy.get(y) || 0) - (downBy.get(x) || 0) || x.localeCompare(y, "uz"));
  const rstats = new Map(
    ((state.stats && state.stats.regions) || []).map((r) => [r.region, r]));
  const head = '<div class="rrow head"><span class="nn">#</span><span class="rg">Hudud</span>' +
    '<span class="bar-h">Onlaynlik</span><span class="lb">Onlayn</span>' +
    '<span class="lb2" title="24 soatlik o\'rtacha onlayn">24s</span>' +
    '<span class="lb2" title="Bugungi uzilish hodisalari">Uzil.</span></div>';
  $("region-rows").innerHTML = head + regions.map((region, idx) => {
    const list = state.cameras.filter((c) => c.region === region);
    const up = list.filter((c) => c.online !== false).length;
    const pct = list.length ? Math.round((up / list.length) * 100) : 0;
    const color = pct === 100 ? "var(--ok)" : pct >= 60 ? "var(--accent)" : "var(--danger)";
    const st = rstats.get(region);
    const up24 = st && st.uptime24 != null ? Math.round(st.uptime24) + "%" : "—";
    const ev = st ? st.events_today : null;
    return '<div class="rrow click" data-region="' + esc(region) + '">' +
      '<span class="nn">' + (idx + 1) + "</span>" +
      '<span class="rg">' + esc(region) + "</span>" +
      '<div class="bar"><i style="width:' + pct + "%;background:" + color + '"></i></div>' +
      '<span class="lb">' + up + "/" + list.length + " · " + pct + "%</span>" +
      '<span class="lb2">' + up24 + "</span>" +
      '<span class="lb2' + (ev ? " bad" : "") + '">' +
        (ev == null ? "—" : ev ? ev + "&darr;" : "0") + "</span></div>";
  }).join("");
  // Hudud qatori bosilsa — xaritaga o'tib, o'sha hudud kameralari ko'rsatiladi.
  document.querySelectorAll("#region-rows .rrow.click").forEach((row) =>
    row.addEventListener("click", () => {
      const region = row.dataset.region;
      showTab("map");
      setQuery(region, null, true);
      const pts = state.cameras.filter((c) => c.region === region && hasGeo(c));
      if (pts.length) {
        const b = L.latLngBounds(pts.map((c) => [c.lat, c.lng]));
        map.fitBounds(b.pad(0.35));
      }
    }));
}

/* Texnik kesim: kodeklar, o'girish va rejimlar taqsimoti. */
function renderTech() {
  const total = state.cameras.length || 1;
  // Bitta o'lchov (ulush) — bitta rang: qatorlar yorliq bilan farqlanadi.
  const groups = [
    ["H.265 xom (o'girishsiz)", state.cameras.filter((c) => /h265|hevc/i.test(c.codec || "") && !c.transcode).length, "var(--accent)"],
    ["H.265 → H.264 o'girish", state.cameras.filter((c) => c.transcode).length, "var(--accent)"],
    ["H.264 to'g'ridan-to'g'ri", state.cameras.filter((c) => /h264|avc/i.test(c.codec || "") && !c.transcode).length, "var(--accent)"],
    ["Doim tayyor rejimda", state.cameras.filter((c) => c.always_on).length, "var(--accent)"],
  ];
  $("tech-rows").innerHTML = groups.map(([label, n, color]) => {
    const pct = Math.round((n / total) * 100);
    return '<div class="rrow"><span class="rg wide">' + label + "</span>" +
      '<div class="bar"><i style="width:' + pct + "%;background:" + color + '"></i></div>' +
      '<span class="lb">' + n + " ta · " + pct + "%</span></div>";
  }).join("");
}

/* Bugungi tahlil: KPI'larda yo'q, xulosa talab qiladigan faktlar. */
function renderToday() {
  const box = $("today-facts");
  const st = state.stats;
  if (!st) { box.innerHTML = '<div class="empty">Tarix yuklanmoqda\u2026</div>'; return; }
  const p2 = (n) => String(n).padStart(2, "0");

  // Eng ko'p uzilish qayd etilgan soat.
  const hrs = st.hourly_today || [];
  let peakH = -1;
  hrs.forEach((v, i) => { if (v > 0 && (peakH < 0 || v > hrs[peakH])) peakH = i; });

  // Eng ko'p uzilish bo'lgan hudud.
  const worst = (st.regions || []).filter((x) => x.events_today)
    .sort((x, y) => y.events_today - x.events_today)[0];

  // Bugun qayta ulangan kameralar (hodisalar lentasidan).
  const today = new Date().toDateString();
  const back = (st.events || []).filter((e) =>
    e.kind !== "offline" && new Date(e.ts).toDateString() === today).length;

  // Sutkadagi eng past onlaynlik nuqtasi.
  const tl = (st.timeline || []).filter((x) => x.total > 0);
  let low = null;
  tl.forEach((x) => {
    const v = x.online / x.total;
    if (!low || v < low.v) low = { v: v, ts: x.ts };
  });
  const lowD = low ? new Date(low.ts) : null;

  const facts = [
    ["Eng ko'p uzilish soati",
     peakH < 0 ? "Uzilish yo'q" : p2(peakH) + ":00",
     peakH < 0 ? "ok" : "warn",
     peakH < 0 ? "" : hrs[peakH] + " ta uzilish"],
    ["Eng muammoli hudud", worst ? worst.region : "Yo'q", worst ? "bad" : "ok",
     worst ? worst.events_today + " ta uzilish" : ""],
    ["Bugun qayta ulandi", back + " ta", back ? "ok" : "", "hodisalar lentasidan"],
    ["Sutkadagi eng past nuqta", low ? Math.round(low.v * 100) + "%" : "\u2014",
     low && low.v < 0.6 ? "bad" : "",
     lowD ? p2(lowD.getHours()) + ":" + p2(lowD.getMinutes()) + " da" : ""],
  ];
  box.innerHTML = facts.map((f) =>
    '<div class="fact"><div class="f-k">' + f[0] + "</div>" +
    '<div class="f-v ' + (f[2] || "") + '">' + esc(String(f[1])) + "</div>" +
    (f[3] ? '<div class="f-n">' + esc(f[3]) + "</div>" : "") + "</div>").join("");
}

/* Takroriy uzilishlar: hodisalar lentasida bir necha marta uchragan
   kameralar. Lenta 40 ta yozuvdan iborat, shuning uchun bu "eng ko'p
   uzilgan" emas, "so'nggi paytda takror uzilgan" ro'yxati. */
function renderFlapping() {
  const box = $("flap-rows");
  const evs = ((state.stats && state.stats.events) || []).filter((e) => e.kind === "offline");
  const cnt = new Map();
  evs.forEach((e) => {
    const key = e.name + " || " + (e.region || "");
    cnt.set(key, (cnt.get(key) || 0) + 1);
  });
  const rows = [...cnt.entries()].filter((p) => p[1] > 1)
    .sort((x, y) => y[1] - x[1]).slice(0, 8);
  if (!rows.length) {
    box.innerHTML = '<div class="empty">So\u2018nggi hodisalarda takror uzilgan kamera yo\u2018q.</div>';
    return;
  }
  const max = rows[0][1];
  box.innerHTML = rows.map((p) => {
    const name = p[0].split(" || ")[0];
    return '<div class="rrow"><span class="rg wide">' + esc(name) + "</span>" +
      '<div class="bar"><i style="width:' + Math.round((p[1] / max) * 100) +
      '%;background:var(--danger)"></i></div>' +
      '<span class="lb2 bad">' + p[1] + " marta</span></div>";
  }).join("");
}

/* Necha vaqtdan beri uzilgan: "7 soat", "2 kun". */
function fmtDuration(iso) {
  const t = Date.parse(iso);
  if (!t) return "noma'lum";
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 60) return min + " daqiqa";
  if (min < 1440) return Math.round(min / 60) + " soat";
  return Math.round(min / 1440) + " kun";
}

/* Diqqat talab qiladiganlar: uzilgan kameralar, eng uzoq turganidan
   boshlab. Operator ishini shu ro'yxatdan boshlaydi. */
function renderAttention() {
  const off = state.cameras.filter((c) => c.online === false)
    .sort((x, y) => (Date.parse(x.last_seen) || 0) - (Date.parse(y.last_seen) || 0));
  $("att-count").textContent = off.length ? off.length + " ta uzilgan" : "";
  if (!off.length) {
    $("att-rows").innerHTML =
      '<div class="empty">Hamma kamera onlayn — diqqat talab qiladigan kamera yo‘q.</div>';
    return;
  }
  $("att-rows").innerHTML = off.slice(0, 40).map((c) =>
    '<div class="rrow click att" data-id="' + c.id + '">' +
      '<span class="ln bad"></span>' +
      '<span class="tx"><b>' + esc(c.name) + "</b><i>" + esc(c.region || "") + "</i></span>" +
      '<span class="dur">' + fmtDuration(c.last_seen) + "</span></div>").join("");
  $("att-rows").querySelectorAll(".att").forEach((row) =>
    row.addEventListener("click", () => selectCamera(Number(row.dataset.id), true)));
}

/* Shu seansda o'lchangan oqim ochilish vaqtlari — sekinlari yuqorida. */
function renderSlow() {
  const rows = [...state.openByCam.entries()]
    .map(([id, ms]) => ({ cam: state.byId.get(id), ms }))
    .filter((r) => r.cam)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 8);
  const max = rows.length ? rows[0].ms : 1;
  $("slow-rows").innerHTML = rows.length ? rows.map((r) => {
    const sec = r.ms / 1000;
    const color = sec <= 2 ? "var(--ok)" : sec <= 5 ? "var(--warn)" : "var(--danger)";
    return '<div class="rrow"><span class="rg wide">' + esc(r.cam.name) + "</span>" +
      '<div class="bar"><i style="width:' + Math.max(6, Math.round((r.ms / max) * 100)) +
      "%;background:" + color + '"></i></div>' +
      '<span class="lb">' + sec.toFixed(2) + " s</span></div>";
  }).join("") : '<div class="empty">Hali oqim ochilmadi — kamera oching, o\'lchov shu yerda ko\'rinadi.</div>';
}
