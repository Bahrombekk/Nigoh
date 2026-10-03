/* Dashboard grafiklari — SVG, kutubxonasiz (chiziq, ustun, xarita-miniatyura). */
import { $, esc, state } from "./holat.js";
import { ICO, svg } from "./ikonkalar.js";
import { renderDash } from "./dashboard.js";

/* ---------- Grafiklar (SVG, kutubxonasiz) ----------
   Ranglar CSS o'zgaruvchilaridan olinadi — mavzu almashsa moslashadi. */

const chTip = $("chart-tip");
function chTipShow(value, label, cx, cy) {
  chTip.querySelector(".v").textContent = value;
  chTip.querySelector(".l").textContent = label;
  chTip.style.display = "block";
  const r = chTip.getBoundingClientRect();
  let x = cx + 14, y = cy - r.height - 12;
  if (x + r.width > innerWidth - 8) x = cx - r.width - 14;
  if (y < 8) y = cy + 16;
  chTip.style.left = x + "px";
  chTip.style.top = y + "px";
}
function chTipHide() { chTip.style.display = "none"; }

/* Ustuncha balandligi uchun "chiroyli" yuqori chegara: 4, 5, 10, 20, 50… */
function niceMax(v) {
  if (v <= 4) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

/* Usti 4px yumaloq, asosi tekis ustuncha (dataviz spetsifikatsiyasi). */
function colPath(x, w, yTop, yBase) {
  const r = Math.min(4, w / 2, Math.max(0, yBase - yTop));
  return "M" + x.toFixed(1) + "," + yBase.toFixed(1) +
    " L" + x.toFixed(1) + "," + (yTop + r).toFixed(1) +
    " Q" + x.toFixed(1) + "," + yTop.toFixed(1) + " " + (x + r).toFixed(1) + "," + yTop.toFixed(1) +
    " L" + (x + w - r).toFixed(1) + "," + yTop.toFixed(1) +
    " Q" + (x + w).toFixed(1) + "," + yTop.toFixed(1) + " " + (x + w).toFixed(1) + "," + (yTop + r).toFixed(1) +
    " L" + (x + w).toFixed(1) + "," + yBase.toFixed(1) + " Z";
}

/* Grafik davri tugmalari — 6 / 12 / 24 soat. */
document.querySelectorAll("#tl-range button").forEach((b) =>
  b.addEventListener("click", () => {
    state.tlHours = Number(b.dataset.h);
    document.querySelectorAll("#tl-range button").forEach((x) => x.classList.toggle("on", x === b));
    $("tl-sub").textContent = "So'nggi " + state.tlHours + " soat davomida tizim onlaynligi";
    renderTimeline();
  }));

/* Tanlangan davrdagi onlayn darajasi — maydonli chiziq, kursorda qiymat. */
export function renderTimeline() {
  const svg = $("ch-timeline"), empty = $("ch-timeline-empty");
  // Tanlangan davr: so'nggi N soatlik o'lchovlar.
  const cutoff = Date.now() - state.tlHours * 3600e3;
  const data = ((state.stats && state.stats.timeline) || [])
    .filter((p) => p.total > 0 && Date.parse(p.ts) >= cutoff)
    .map((p) => ({ t: Date.parse(p.ts), online: p.online, total: p.total }));
  // Grafik ustidagi yig'ma ko'rsatkichlar: hozir / o'rtacha / eng past / o'lchov soni.
  const pcts = data.map((p) => (p.online / p.total) * 100);
  const fmtPct = (v) => Math.round(v) + "%";
  const setStat = (id, v, cls) => {
    const el = $(id); el.textContent = v; el.className = "v" + (cls ? " " + cls : "");
  };
  if (pcts.length) {
    const cur = pcts[pcts.length - 1], avg = pcts.reduce((a, b) => a + b, 0) / pcts.length,
          min = Math.min(...pcts);
    setStat("tl-now", fmtPct(cur), cur >= 90 ? "ok" : cur < 60 ? "bad" : "");
    setStat("tl-avg", fmtPct(avg), avg >= 90 ? "ok" : avg < 60 ? "bad" : "");
    setStat("tl-min", fmtPct(min), min < 60 ? "bad" : "");
    setStat("tl-n", String(pcts.length));
    // 7 kunlik o'rtacha — kunlik tarixdan (o'lchovsiz kunlar hisobga olinmaydi).
    const days = ((state.stats && state.stats.daily) || []).filter((d) => d.uptime != null);
    const wk = days.length ? days.reduce((s, d) => s + d.uptime, 0) / days.length : null;
    setStat("tl-week", wk == null ? "\u2014" : fmtPct(wk),
            wk == null ? "" : wk >= 90 ? "ok" : wk < 60 ? "bad" : "");
  } else {
    ["tl-now", "tl-avg", "tl-min", "tl-week", "tl-n"].forEach((id) => setStat(id, "—"));
  }
  if (data.length < 2) {
    svg.innerHTML = "";
    empty.textContent = "Tarix yig'ilmoqda — grafik dastlabki o'lchovlar to'plangach (~10 daqiqa) chiziladi.";
    empty.style.display = "flex";
    return;
  }
  empty.style.display = "none";
  const W = Math.max(320, Math.round(svg.clientWidth) || 640), H = 210;
  const L = 40, R = 18, T = 14, B = 26;
  svg.setAttribute("viewBox", "0 0 " + W + " " + H);
  const t0 = data[0].t, t1 = data[data.length - 1].t;
  const x = (t) => L + (W - L - R) * (t - t0) / Math.max(1, t1 - t0);
  const pctOf = (p) => (p.online / p.total) * 100;
  const y = (v) => T + (H - T - B) * (1 - v / 100);
  let out = "";
  [0, 25, 50, 75, 100].forEach((v) => {
    out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) +
           '" y2="' + y(v).toFixed(1) + '" stroke="var(--line-2)"/>';
    if (v % 50 === 0) out += '<text class="ch-tick" x="' + (L - 8) + '" y="' +
      (y(v) + 3.5).toFixed(1) + '" text-anchor="end">' + v + "%</text>";
  });
  // Vaqt belgilari qadami oraliqqa moslashadi: tarix hali qisqa bo'lsa
  // (server yangi ishga tushgan) 5-15 daqiqalik, to'liq sutkada 4 soatlik.
  const MIN = 60000;
  const step = [5 * MIN, 15 * MIN, 30 * MIN, 60 * MIN, 2 * 60 * MIN,
                4 * 60 * MIN, 6 * 60 * MIN]
    .find((s) => (t1 - t0) / s <= 6) || 6 * 60 * MIN;
  const pd2 = (n) => String(n).padStart(2, "0");
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
    const d = new Date(t);
    out += '<text class="ch-tick" x="' + x(t).toFixed(1) + '" y="' + (H - 8) +
      '" text-anchor="middle">' + pd2(d.getHours()) + ":" + pd2(d.getMinutes()) +
      "</text>";
  }
  const pts = data.map((p) => x(p.t).toFixed(1) + "," + y(pctOf(p)).toFixed(1)).join(" ");
  out += '<polygon points="' + x(t0).toFixed(1) + "," + y(0).toFixed(1) + " " + pts +
    " " + x(t1).toFixed(1) + "," + y(0).toFixed(1) + '" fill="var(--accent)" opacity=".1"/>';
  out += '<polyline points="' + pts + '" fill="none" stroke="var(--accent)" ' +
    'stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
  const last = data[data.length - 1];
  out += '<circle cx="' + x(last.t).toFixed(1) + '" cy="' + y(pctOf(last)).toFixed(1) +
    '" r="4" fill="var(--accent)" stroke="var(--surface-2)" stroke-width="2"/>';
  // Eng past nuqta alohida belgilanadi — muammo qachon bo'lganini ko'rsatadi.
  let lowI = 0;
  for (let i = 1; i < data.length; i++) if (pctOf(data[i]) < pctOf(data[lowI])) lowI = i;
  const lowP = data[lowI];
  if (data.length > 3 && pctOf(lowP) < pctOf(last) - 0.5) {
    const lx2 = x(lowP.t), ly2 = y(pctOf(lowP));
    const side = lx2 > W * 0.7 ? -1 : 1;
    out += '<circle cx="' + lx2.toFixed(1) + '" cy="' + ly2.toFixed(1) +
      '" r="4" fill="var(--danger)" stroke="var(--surface-2)" stroke-width="2"/>';
    out += '<text class="ch-cap" x="' + (lx2 + side * 9).toFixed(1) + '" y="' +
      (ly2 + 4).toFixed(1) + '" text-anchor="' + (side > 0 ? "start" : "end") +
      '" fill="var(--danger)">eng past ' + Math.round(pctOf(lowP)) + "%</text>";
  }
  out += '<line class="ch-cx" y1="' + T + '" y2="' + y(0).toFixed(1) +
    '" stroke="var(--faint)" style="display:none"/>';
  out += '<circle class="ch-dot" r="4" fill="var(--accent)" stroke="var(--surface-2)" ' +
    'stroke-width="2" style="display:none"/>';
  out += '<rect class="ch-hit" x="' + L + '" y="' + T + '" width="' + (W - L - R) +
    '" height="' + (H - T - B) + '" fill="transparent"/>';
  svg.innerHTML = out;

  // Kursor eng yaqin o'lchovga "yopishadi" — 2px chiziqni mo'ljallash shart emas.
  const cx = svg.querySelector(".ch-cx"), dot = svg.querySelector(".ch-dot"),
        hit = svg.querySelector(".ch-hit");
  hit.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect();
    const t = t0 + ((e.clientX - r.left) * (W / r.width) - L) / (W - L - R) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < data.length; i++)
      if (Math.abs(data[i].t - t) < Math.abs(data[best].t - t)) best = i;
    const p = data[best], bx = x(p.t).toFixed(1);
    cx.setAttribute("x1", bx); cx.setAttribute("x2", bx); cx.style.display = "";
    dot.setAttribute("cx", bx); dot.setAttribute("cy", y(pctOf(p)).toFixed(1));
    dot.style.display = "";
    const d = new Date(p.t), pd = (n) => String(n).padStart(2, "0");
    chTipShow(p.online + "/" + p.total + " onlayn · " + Math.round(pctOf(p)) + "%",
              pd(d.getHours()) + ":" + pd(d.getMinutes()), e.clientX, e.clientY);
  });
  hit.addEventListener("pointerleave", () => {
    cx.style.display = "none"; dot.style.display = "none"; chTipHide();
  });
}

/* Umumiy ustunli grafik: items — {label, value, cap, tipValue, tipLabel}. */
function renderColumns(svgId, emptyId, items, opts) {
  const svg = $(svgId), empty = $(emptyId);
  if (!items.some((it) => it.value != null)) {
    svg.innerHTML = "";
    empty.textContent = opts.emptyText;
    empty.style.display = "flex";
    return;
  }
  empty.style.display = "none";
  const W = Math.max(220, Math.round(svg.clientWidth) || 300), H = 170;
  const L = 30, R = 8, T = 18, B = 24;
  svg.setAttribute("viewBox", "0 0 " + W + " " + H);
  const max = opts.max || niceMax(Math.max(1, ...items.map((it) => it.value || 0)));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  let out = "";
  (opts.max === 100 ? [0, 50, 100] : [0, max / 2, max]).forEach((v) => {
    out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) +
      '" y2="' + y(v).toFixed(1) + '" stroke="var(--line-2)"/>' +
      '<text class="ch-tick" x="' + (L - 7) + '" y="' + (y(v) + 3.5).toFixed(1) +
      '" text-anchor="end">' + Math.round(v) + (opts.unit || "") + "</text>";
  });
  const slot = (W - L - R) / items.length;
  const barW = Math.min(24, slot * 0.62);
  items.forEach((it, i) => {
    const cxm = L + slot * i + slot / 2;
    if (it.value != null && it.value > 0)
      out += '<path class="ch-col" data-i="' + i + '" d="' +
        colPath(cxm - barW / 2, barW, y(it.value), y(0)) + '" fill="var(--accent)"/>';
    if (opts.capLabels && it.value != null && it.cap)
      out += '<text class="ch-cap" x="' + cxm.toFixed(1) + '" y="' +
        (y(it.value) - 5).toFixed(1) + '" text-anchor="middle">' + esc(it.cap) + "</text>";
    if (it.label)
      out += '<text class="ch-tick" x="' + cxm.toFixed(1) + '" y="' + (H - 8) +
        '" text-anchor="middle">' + esc(it.label) + "</text>";
    out += '<rect class="ch-slot" data-i="' + i + '" x="' + (L + slot * i).toFixed(1) +
      '" y="' + T + '" width="' + slot.toFixed(1) + '" height="' + (H - T - B) +
      '" fill="transparent"/>';
  });
  svg.innerHTML = out;
  svg.querySelectorAll(".ch-slot").forEach((rect) => {
    const i = Number(rect.dataset.i);
    const bar = svg.querySelector('.ch-col[data-i="' + i + '"]');
    rect.addEventListener("pointermove", (e) => {
      if (bar) bar.style.opacity = ".78";
      chTipShow(items[i].tipValue, items[i].tipLabel, e.clientX, e.clientY);
    });
    rect.addEventListener("pointerleave", () => {
      if (bar) bar.style.opacity = "";
      chTipHide();
    });
  });
}

const UZ_MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun",
                   "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const UZ_WDAYS = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];
function fmtDayLabel(dt) { return dt.getDate() + "-" + UZ_MONTHS[dt.getMonth()]; }

/* 7 kunlik kesim: o'rtacha onlayn % va uzilishlar soni — ikkita alohida panel. */
export function renderDailyCharts() {
  const daily = (state.stats && state.stats.daily) || [];
  const items = daily.map((d, i) => ({
    d,
    dt: new Date(d.date + "T00:00:00"),
    last: i === daily.length - 1,
  }));
  renderColumns("ch-daily-up", "ch-daily-up-empty", items.map((it) => ({
    label: it.last ? "Bugun" : UZ_WDAYS[it.dt.getDay()] + " " + it.dt.getDate(),
    value: it.d.uptime,
    cap: it.d.uptime == null ? "" : Math.round(it.d.uptime) + "%",
    tipValue: it.d.uptime == null ? "ma'lumot yo'q"
      : it.d.uptime.toFixed(1).replace(".", ",") + "% onlayn",
    tipLabel: fmtDayLabel(it.dt),
  })), { max: 100, unit: "%", capLabels: true,
         emptyText: "Kunlik tarix hali yig'ilmagan — server ishlagan sari to'lib boradi." });
  renderColumns("ch-daily-ev", "ch-daily-ev-empty", items.map((it) => ({
    label: it.last ? "Bugun" : UZ_WDAYS[it.dt.getDay()] + " " + it.dt.getDate(),
    // O'sha kunga surat ham, hodisa ham yo'q — "0" emas, "ma'lumot yo'q".
    value: it.d.uptime == null && !it.d.events ? null : it.d.events,
    cap: String(it.d.events),
    tipValue: it.d.events + " ta uzilish",
    tipLabel: fmtDayLabel(it.dt),
  })), { capLabels: true, emptyText: "Kunlik tarix hali yig'ilmagan." });
}

/* Bugungi uzilishlar soat kesimida — muammo qaysi payt bo'lganini ko'rsatadi. */
export function renderHourly() {
  const svg = $("ch-hourly"), empty = $("ch-hourly-empty");
  const hours = (state.stats && state.stats.hourly_today) || [];
  if (!hours.some((v) => v > 0)) {
    svg.innerHTML = "";
    empty.textContent = state.stats
      ? "Bugun uzilish qayd etilmadi." : "Tarix yig'ilmoqda…";
    empty.style.display = "flex";
    return;
  }
  const pd = (n) => String(n).padStart(2, "0");
  renderColumns("ch-hourly", "ch-hourly-empty", hours.map((n, h) => ({
    label: h % 6 === 0 ? pd(h) : "",
    value: n,
    tipValue: n + " ta uzilish",
    tipLabel: pd(h) + ":00 – " + pd(h) + ":59",
  })), { emptyText: "" });
}

/* Oyna o'lchami o'zgarsa grafiklar yangi kenglikka qayta chiziladi. */
let chResizeTimer = null;
window.addEventListener("resize", () => {
  if (state.tab !== "dash") return;
  clearTimeout(chResizeTimer);
  chResizeTimer = setTimeout(() => {
    renderTimeline(); renderDailyCharts(); renderHourly();
  }, 200);
});

/* Dashboard ochiq turganda har 15 soniyada o'zi yangilanadi. */
setInterval(() => {
  if (state.tab === "dash" && !document.hidden) renderDash();
}, 15000);

/* Hodisalar lentasi: server yozgan uzilishlar (doimiy) + shu seansdagi
   mahalliy hodisalar (oqim ochildi, MediaMTX va h.k.) bitta ro'yxatda. */
function fmtEvTime(t) {
  const d = new Date(t), p = (n) => String(n).padStart(2, "0");
  const sameDay = d.toDateString() === new Date().toDateString();
  return (sameDay ? "" : p(d.getDate()) + "." + p(d.getMonth() + 1) + " ") +
         p(d.getHours()) + ":" + p(d.getMinutes());
}

export function renderEvents() {
  const colors = { ok: "var(--ok)", warn: "var(--warn)", danger: "var(--danger)" };
  const server = ((state.stats && state.stats.events) || []).map((e) => ({
    t: Date.parse(e.ts),
    text: e.name + " (" + e.region + ") — " +
          (e.kind === "offline" ? "uzildi" : "qayta ulandi"),
    kind: e.kind === "offline" ? "danger" : "ok",
  }));
  const all = state.events.concat(server).sort((a, b) => b.t - a.t).slice(0, 60);
  const row = (e) => {
    // Matn "Nomi (hudud) — sabab" ko'rinishida: nom qalin, sababi pastda.
    const m = /^(.*?) — (.*)$/.exec(e.text);
    const title = m ? m[1] : e.text;
    const note = m ? m[2] : "";
    return '<div class="erow">' +
      '<span class="ln" style="background:' + (colors[e.kind] || "var(--muted)") + '"></span>' +
      '<span class="tx"><b>' + esc(title) + "</b>" +
        (note ? "<i>" + esc(note) + "</i>" : "") + "</span>" +
      '<span class="tm">' + fmtEvTime(e.t) + "</span></div>";
  };
  $("events-list").innerHTML = all.length
    ? all.map(row).join("")
    : '<div class="empty">Hodisalar hali yo‘q.</div>';
  $("bp-list").innerHTML = all.length
    ? all.slice(0, 12).map(row).join("")
    : '<div class="empty">Yangi bildirishnoma yo‘q.</div>';
}

/* Qo'ng'iroqdagi hisob — hozir uzilgan kameralar soni. */
export function renderBell() {
  const off = state.cameras.filter((c) => c.online === false).length;
  const el = $("bell-count");
  el.textContent = off > 99 ? "99+" : off;
  el.hidden = off === 0;
  $("bp-sub").textContent = off ? off + " ta uzilgan" : "hammasi joyida";
}
$("bell").addEventListener("click", (e) => {
  e.stopPropagation();
  const p = $("bell-panel");
  p.hidden = !p.hidden;
  if (!p.hidden) renderEvents();
});
document.addEventListener("click", (e) => {
  const p = $("bell-panel");
  if (!p.hidden && !p.contains(e.target)) p.hidden = true;
});

/* Tizim holati — faqat haqiqiy signallardan chiqariladi. */
export function renderSystem() {
  const total = state.cameras.length;
  const on = state.cameras.filter((c) => c.online === true).length;
  const pct = total ? (on / total) * 100 : 0;
  const fresh = state.cameras.some((c) => c.last_seen &&
    Date.now() - Date.parse(c.last_seen) < 10 * 60000);
  const rows = [
    ["Video servislari", ICO.server, state.apiOk ? ["Faol", ""] : ["Uzilgan", "bad"]],
    ["Ma'lumotlar bazasi", ICO.db, state.apiOk ? ["Faol", ""] : ["Javob yo'q", "bad"]],
    ["Tarmoq ulanishi", ICO.net,
      !total ? ["Ma'lumot yo'q", "warn"]
        : pct >= 90 ? ["Barqaror", ""]
        : pct >= 60 ? ["Beqaror", "warn"] : ["Muammo", "bad"]],
    ["Holat kuzatuvi", ICO.cast,
      fresh ? ["Faol", ""] : total ? ["Eskirgan", "warn"] : ["Kutilmoqda", "warn"]],
    ["Oqim xizmatlari", ICO.play,
      state.streamOk === null ? ["Sinalmagan", "warn"]
        : state.streamOk ? ["Faol", ""] : ["Uzilgan", "bad"]],
  ];
  $("sys-list").innerHTML = rows.map(([name, icon, [tx, cls]]) =>
    '<div class="sysrow"><span class="si">' + icon + "</span>" +
    '<span class="sn">' + name + "</span>" +
    '<span class="sb ' + cls + '">' + tx + "</span></div>").join("");
}
