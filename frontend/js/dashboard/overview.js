/* ==========================================================================
   dashboard/overview.js — ishonchlilik hisoboti va liniya sxemasi
   --------------------------------------------------------------------------
   Vazifasi:
     Dashboard: uzoq davrli ishonchlilik (GET /api/stats/overview) va
     temir yo'l liniyasi sxemasi.

     Kartalar:
       * Liniya holati  — har kamera o'z km/piketida, joriy holat rangi bilan;
       * Ishonchlilik   — uptime, haqiqiy uzilish / qisqa sakrash, MTTR, qamrov;
       * Muammoli kameralar — 30 kunlik reyting (uzoq o'chiq / tez-tez sakraydi);
       * Uzilishlar xaritasi — kun x soat;
       * Ma'lumot sifati — tuzatilishi kerak bo'lgan yozuvlar;
       * Kamera markalari — marka/model kesimi (holat, uptime, uzilish/kamera, MTTR).

   Eksport:
     OverviewReport    — klass: load, render, renderLine, init (+ ichki render* metodlari)
     overviewReport    — yagona nusxa
     loadOverview()    — hisobotni so'rash; tugagach "overview:loaded" hodisasi
     renderOverview()  — ishonchlilik, muammolilar, issiqlik xaritasi, sifat, markalar
     renderLine()      — liniya sxemasi (kameralar ro'yxatidan, hisobot kerak emas)
     initOverview()    — davr / muammo rejimi tugmalari va ResizeObserver ni ulash (bir marta)

   Bog'liqliklar:
     import: ../core/state.js, ../core/api.js, ../map/selection.js (selectCamera),
             ./charts.js (chTipHide, chTipShow, firstDraw, hatchDef)
     global: ResizeObserver (bo'lmasa — qayta chizish o'lcham o'zgarganda bo'lmaydi)

   DOM: #rail-line, #rail-sub, #rel-sub, #rel-up, #rel-out, #rel-blip, #rel-blip-n,
        #rel-mttr, #rel-mttr-n, #rel-cov, #rel-cov-n, #rel-never, #rel-regions,
        #prob-rows, #prob-mode, #heat-map, #heat-sub, #heat-legend,
        #quality-rows, #quality-count, #vendor-rows, #ven-sub, #ven-count, #period
   Backend: GET /api/stats/overview?days=1|7|30 (va "Bugun"da qo'shimcha ?days=7 —
            hafta-kun issiqlik xaritasi uchun)

   Qoidalar / tuzoqlar:
     - initOverview() main.js dan chaqiriladi (import paytida emas): aylanma
       importlarda bu modul hali baholanmagan bo'lishi mumkin.
     - Davr tugmasi state.period ni o'zgartiradi va "period:changed" hodisasini
       yuboradi — charts.js shu bilan uzun davr grafigini yuklaydi.
     - Chizmalar haqiqiy pikselda (viewBox = konteyner kengligi) — yozuvlar
       har ekranda bir xil o'lchamda; konteyner o'zgarsa qayta chiziladi.
   ========================================================================== */
import { $, esc, state } from "../core/state.js";
import { api } from "../core/api.js";
import { selectCamera } from "../map/selection.js";
import { chTipHide, chTipShow, firstDraw, hatchDef } from "./charts.js";

const STATE_COLOR = {
  online: "var(--ok)", offline: "var(--danger)", stalled: "var(--warn)",
  disabled: "var(--faint)", unknown: "var(--faint)",
};
const STATE_LABEL = {
  online: "onlayn", offline: "uzilgan", stalled: "tasvir to'xtagan",
  disabled: "o'chirilgan", unknown: "tekshirilmagan",
};

function camState(c) {
  if (c.state) return c.state;
  return c.online === true ? "online" : c.online === false ? "offline" : "unknown";
}

/* "4 daq", "3,2 soat", "11 kun" */
function fmtDur(sec) {
  if (sec == null) return "—";
  if (sec < 60) return Math.round(sec) + " s";
  if (sec < 3600) return Math.round(sec / 60) + " daq";
  if (sec < 86400) return (sec / 3600).toFixed(1).replace(".", ",") + " soat";
  return Math.round(sec / 86400) + " kun";
}
const fmtPct = (v) => (v == null ? "—" : v.toFixed(1).replace(".", ",") + "%");
const fmtNum = (n) => (n == null ? "—" : n.toLocaleString("ru-RU").replace(/ /g, " "));

/* Konteynerning sof ichki kengligi (padding'siz) — chizma chetidan chiqmasin. */
function innerWidth_(el) {
  const cs = getComputedStyle(el);
  return Math.floor(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) - 1;
}

/* Km bo'yicha uzluksiz bo'laklar: orasi 100 km dan katta bo'lsa alohida
   chiziq (6–33 km va 3372–3729 km bitta o'qda siqilib ketmasin). */
function segments(cams) {
  const sorted = [...cams].sort((a, b) => a.pos - b.pos);
  const out = [];
  sorted.forEach((c) => {
    const last = out[out.length - 1];
    if (last && c.pos - last.to <= 100) { last.cams.push(c); last.to = c.pos; }
    else out.push({ from: c.pos, to: c.pos, cams: [c] });
  });
  return out;
}

/* Muammolilari pastda — rels chizig'iga yaqin turadi, qizil zona bir
   qarashda ko'rinadi; sog'lomlari ustida. */
const STACK_ORDER = { offline: 0, stalled: 1, unknown: 2, disabled: 3, online: 4 };

/* Yaxlit km qadami: o'q yozuvlari bir-biriga tegmasin. */
function niceStep(kmPerPx) {
  const want = kmPerPx * 90;
  return [5, 10, 20, 25, 50, 100, 200, 500].find((s) => s >= want) || 1000;
}

function fmtDate(iso) {
  const d = new Date(iso), p = (n) => String(n).padStart(2, "0");
  return p(d.getDate()) + "." + p(d.getMonth() + 1);
}

/* ---------- Kun x soat xaritasi: shkala ---------- */

/* Bir rangli ketma-ket shkala (dataviz: magnitude — bitta hue, och -> to'q):
   0 — fon, 1..5 — qizilning sirtga aralashgan bosqichlari. Mavzuga mos:
   ranglar CSS o'zgaruvchilaridan color-mix bilan olinadi. */
const HEAT_STEPS = [24, 42, 60, 80, 100];
const heatFill = (lvl) => lvl
  ? "color-mix(in oklab, var(--danger) " + HEAT_STEPS[lvl - 1] + "%, var(--surface-2))"
  : "var(--surface-2)";

const WEEKDAYS = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];

/* Qatorlar: davr 7 kun va undan uzun bo'lsa — hafta kunlari (har katak o'sha
   hafta kunining kuzatilgan kunlari bo'yicha o'rtacha), aks holda — kunlar.
   Kuzatuvsiz kunlar o'rtachaga kirmaydi: aks holda "0" bo'lib, qiymatni
   pasaytirardi. */
function heatRows(days) {
  const covered = (r) => !(r.coverage_pct != null && r.coverage_pct < 50);
  if (days.length < 7) {
    return days.map((r) => ({ label: r.date.slice(8) + "." + r.date.slice(5, 7), noData: !covered(r),
      hours: r.hours, n: 1, tip: r.date.slice(8) + "." + r.date.slice(5, 7) }));
  }
  const rows = WEEKDAYS.map((w) => ({ label: w, hours: new Array(24).fill(0), n: 0, tip: w }));
  days.forEach((r) => {
    if (!covered(r)) return;
    const wd = (new Date(r.date + "T12:00:00").getDay() + 6) % 7;   // Du=0 … Ya=6
    rows[wd].n++;
    r.hours.forEach((v, h) => { rows[wd].hours[h] += v; });
  });
  rows.forEach((row) => {
    row.noData = row.n === 0;
    row.hours = row.hours.map((v) => (row.n ? v / row.n : 0));
    row.tip = row.label + " · " + row.n + " kun o'rtachasi";
  });
  return rows;
}

/* ---------- Ma'lumot sifati: bandlar ---------- */

const QUALITY = [
  ["no_location", "Koordinatasi yo'q", "Xaritada ko'rinmaydi, hudud aniqlanmaydi"],
  ["no_region", "Hududi aniqlanmagan", "Hududlar hisobotiga kirmaydi"],
  ["no_km", "Km/piket yo'q", "Liniya sxemasida ko'rinmaydi"],
  ["no_codec", "Kodek noma'lum", "Kamera hali tekshirilmagan yoki javob bermagan"],
  ["never_seen", "Hech qachon onlayn bo'lmagan", "Manzil yoki parolni tekshiring"],
  ["no_model", "Qurilma modeli noma'lum", "Firmware yangilanishlarini kuzatib bo'lmaydi"],
];

/* ---------- Kamera markalari ---------- */

const VENDOR_LABEL = { dahua: "Dahua", hikvision: "Hikvision", holowits: "Holowits",
                       boshqa: "Boshqa", unknown: "Noma'lum" };
const vendorLabel = (v) => VENDOR_LABEL[v] || (v ? v[0].toUpperCase() + v.slice(1) : "Noma'lum");
const upClass = (v) => (v == null ? "" : v >= 99 ? "ok" : v >= 95 ? "warn" : "bad");
/* Hozirgi holat ulushi: onlayn / tasvirsiz / uzilgan / qolgani — bitta chiziqda. */
const NOW_PARTS = [["online", "var(--ok)"], ["stalled", "var(--warn)"], ["offline", "var(--danger)"]];

export class OverviewReport {
  constructor() {
    this.loading = false;
    this.problemMode = "offline";
    this.qualityOpen = null;
    this.vendorOpen = new Set();
    this.initialized = false;
  }

  async load() {
    if (this.loading) return;
    this.loading = true;
    try {
      state.overview = await api("/api/stats/overview?days=" + (state.period || 1));
      // Hafta-kun xaritasi kamida 7 kunlik ma'lumot talab qiladi: "Bugun"da bitta
      // qator ma'nosiz va bo'sh joy qoldirardi.
      state.heatOverview = (state.period || 1) < 7
        ? await api("/api/stats/overview?days=7") : null;
      if (state.tab === "dash") this.render();
      // Hisobotga bog'liq boshqa bloklar (uptime KPI, hududlar "Davr" rejimi).
      document.dispatchEvent(new Event("overview:loaded"));
    } catch (e) { /* endpoint bo'lmasa — qolgan dashboard ishlayveradi */ }
    this.loading = false;
  }

  render() {
    this.renderReliability();
    this.renderProblems();
    this.renderHeatmap();
    this.renderQuality();
    this.renderVendors();
  }

  /* ---------- Kamera markalari ---------- */

  /* Har marka bitta qator: hozirgi holat, davr uptime'i, kameraga to'g'ri
     keladigan uzilishlar (markalar soni har xil — mutlaq son adolatsiz),
     MTTR, kodek va o'girish. Bosilsa — shu markaning modellari. */
  renderVendors() {
    const o = state.overview;
    const box = $("vendor-rows");
    if (!o || !box) return;
    const list = o.vendors || [];
    $("ven-sub").textContent = (o.days === 1 ? "Bugun" : "So'nggi " + o.days + " kun") +
      " · bosilsa modellari ochiladi";
    $("ven-count").textContent = list.length ? list.length + " marka · " +
      list.reduce((s, v) => s + v.cameras, 0) + " kamera" : "";
    // Eski server javobida bo'lim umuman yo'q — "kamera yo'q" deb chalg'itmasin.
    if (!o.vendors) { box.innerHTML = '<div class="empty">Server bu hisobotni hali bermaydi — backend yangilanib qayta ishga tushirilishi kerak.</div>'; return; }
    if (!list.length) { box.innerHTML = '<div class="empty">Kameralar yo‘q.</div>'; return; }
    const maxRate = Math.max(...list.flatMap((v) => [v.outages_per_camera,
      ...v.models.map((m) => m.outages_per_camera)]).filter((x) => x != null), 0.01);

    const nowCell = (r) => {
      const measured = r.now.online + r.now.stalled + r.now.offline;
      const segs = NOW_PARTS.map(([k, color]) => r.now[k]
        ? '<i style="width:' + (r.now[k] / r.cameras * 100).toFixed(1) + "%;background:" + color + '"></i>' : "").join("");
      const tip = NOW_PARTS.map(([k]) => r.now[k] + " " + STATE_LABEL[k]).join(" · ") +
        (r.cameras - measured ? " · " + (r.cameras - measured) + " tekshirilmagan" : "");
      return '<span class="vt-now" title="' + tip + '"><span class="vt-stack">' + segs + "</span>" +
        "<b>" + (measured ? r.now.online + "/" + measured : "—") + "</b></span>";
    };
    const rateCell = (v) => '<span class="vt-rate"><span class="bar"><i style="width:' +
      (v == null ? 0 : Math.max(3, (v / maxRate) * 100)) + '%;background:var(--danger)"></i></span>' +
      "<b>" + (v == null ? "—" : v.toFixed(1).replace(".", ",")) + "</b></span>";
    const common = (r) =>
      "<span class=\"vt-n\">" + r.cameras + "</span>" + nowCell(r) +
      '<span class="vt-n ' + upClass(r.uptime_pct) + '">' + fmtPct(r.uptime_pct) + "</span>" +
      rateCell(r.outages_per_camera) +
      '<span class="vt-n">' + fmtNum(r.blips) + "</span>" +
      '<span class="vt-n">' + fmtDur(r.mttr_median_s) + "</span>";

    box.innerHTML = list.map((v) => {
      const open = this.vendorOpen.has(v.vendor);
      const codec = [["H.264", v.codecs.H264], ["H.265", v.codecs.H265], ["?", v.codecs.unknown]]
        .filter(([, n]) => n).map(([k, n]) => k + " " + n).join(" · ");
      let html = '<div class="vt-row click' + (open ? " open" : "") + '" data-v="' + esc(v.vendor) + '">' +
        '<span class="vt-name"><svg class="vt-chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg><b>' +
        esc(vendorLabel(v.vendor)) + "</b><i>" + v.models.length + " model" +
        (v.no_model ? " · " + v.no_model + " ta modeli noma'lum" : "") + "</i></span>" +
        common(v) +
        '<span class="vt-n vt-codec">' + (codec || "—") + "</span>" +
        '<span class="vt-n">' + (v.transcode ? v.transcode + " ta" : "—") + "</span></div>";
      if (open) {
        html += v.models.map((m) => '<div class="vt-row sub">' +
          '<span class="vt-name"><b>' + esc(m.model || "Model noma'lum") + "</b></span>" +
          common(m) + "<span></span><span></span></div>").join("");
      }
      return html;
    }).join("");
    box.querySelectorAll(".vt-row.click").forEach((row) =>
      row.addEventListener("click", () => {
        const k = row.dataset.v;
        if (this.vendorOpen.has(k)) this.vendorOpen.delete(k); else this.vendorOpen.add(k);
        this.renderVendors();
      }));
  }

  /* ---------- Liniya holati ---------- */

  renderLine() {
    const svg = $("rail-line");
    if (!svg) return;
    const cams = state.cameras.filter((c) => c.km != null)
      .map((c) => ({ ...c, pos: c.km + (c.picket || 0) / 10, st: camState(c) }));
    const counts = { online: 0, offline: 0, stalled: 0, other: 0 };
    cams.forEach((c) => { counts[c.st in counts ? c.st : "other"]++; });
    $("rail-sub").textContent = cams.length
      ? cams.length + " kamera km bo'yicha · " + counts.online + " onlayn · " +
        counts.offline + " uzilgan" + (counts.stalled ? " · " + counts.stalled + " tasvirsiz" : "")
      : "Kameralarda km ma'lumoti yo'q";
    const W = innerWidth_(svg.parentElement);
    if (!cams.length || W < 50) { svg.innerHTML = ""; return; }

    // Chizish haqiqiy pikselda: viewBox = konteyner kengligi, shuning uchun
    // yozuvlar har qanday ekranda 10–11 px bo'lib qoladi.
    const segs = segments(cams);
    const SEG_GAP = 36;
    const free = W - SEG_GAP * (segs.length - 1);
    // Qisqa bo'lak ham o'qilsin: kamida 14% kenglik.
    const raw = segs.map((s) => Math.max(s.to - s.from, 1));
    const sum = raw.reduce((a, b) => a + b, 0);
    let widths = raw.map((r) => Math.max(free * 0.14, (r / sum) * free));
    const scale = free / widths.reduce((a, b) => a + b, 0);
    widths = widths.map((w) => w * scale);

    // Har bo'lakni km katakchalariga bo'lamiz, kameralar katakda taxlanadi.
    const build = (cell) => {
      const step = cell + (cell >= 8 ? 2 : 1);
      let maxStack = 1;
      const layout = segs.map((seg, i) => {
        const bins = Math.max(1, Math.floor(widths[i] / step));
        const span = Math.max(seg.to - seg.from, 1);
        const cols = Array.from({ length: bins }, () => []);
        seg.cams.forEach((c) => {
          const b = Math.min(bins - 1, Math.floor(((c.pos - seg.from) / span) * bins));
          cols[b].push(c);
        });
        cols.forEach((col) => {
          col.sort((a, b) => STACK_ORDER[a.st] - STACK_ORDER[b.st]);
          maxStack = Math.max(maxStack, col.length);
        });
        return { seg, bins, span, cols };
      });
      return { cell, step, maxStack, layout };
    };
    // Kvadrat o'lchami kamera zichligiga moslashadi: eng baland ustun
    // RAIL_MAX_H ga sig'adigan eng katta kvadrat tanlanadi. Kam kamerada —
    // yirik, bosish oson; ko'p kamerada — mayda. 3 px ham sig'masa (minglab
    // kamera bir km da) ustunlar holat ulushli zichlik chizig'iga aylanadi:
    // karta balandligi kamera soni bilan cheksiz o'smaydi.
    const RAIL_MAX_H = 120;
    let L;
    for (const cell of [12, 10, 8, 6, 5, 4, 3]) {
      L = build(cell);
      if (L.maxStack * L.step <= RAIL_MAX_H) break;
    }
    const bars = L.maxStack * L.step > RAIL_MAX_H;
    if (bars) L = build(6);            // ulushli ustun ingichka bo'lmasin
    const { layout, maxStack } = L;
    const CELL = L.cell, STEP = L.step, GAPC = STEP - CELL;
    const stackH = bars ? RAIL_MAX_H : maxStack * STEP;
    const TOP = 6, track = TOP + stackH + 4, H = track + 34;
    let html = "", x0 = 0;
    const grow = firstDraw("rail");
    layout.forEach(({ seg, bins, span, cols }, i) => {
      const w = widths[i];
      const binX = (b) => x0 + b * (w / bins);
      // Kamera kvadratchalari (yoki zich rejimda holat ulushli ustunlar).
      const rx = Math.max(1, CELL / 4);
      cols.forEach((col, b) => {
        const delay = grow ? ";animation-delay:" + Math.round(binX(b) / W * 500) + "ms" : "";
        if (bars) {
          if (!col.length) return;
          const unit = stackH / maxStack;
          let y = track - 4;
          col.forEach((c, k) => {
            if (k && col[k - 1].st === c.st) return;
            let n = 0;
            for (let m = k; m < col.length && col[m].st === c.st; m++) n++;
            const h = n * unit;
            y -= h;
            html += '<rect class="rl-bin' + (grow ? " rl-pop" : "") + '" data-s="' + i + '" data-b="' + b +
              '" x="' + binX(b).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + CELL + '" height="' +
              Math.max(h, 1).toFixed(1) + '" style="fill:' + STATE_COLOR[c.st] + delay + '"/>';
          });
          return;
        }
        col.forEach((c, k) => {
          const x = binX(b), y = track - 4 - (k + 1) * STEP + GAPC;
          html += '<rect class="rl-dot' + (grow ? " rl-pop" : "") + '" data-id="' + c.id + '" x="' + x.toFixed(1) +
            '" y="' + y + '" width="' + CELL + '" height="' + CELL + '" rx="' + rx + '" style="fill:' +
            STATE_COLOR[c.st] + delay + '"/>';
        });
      });
      // Rels chizig'i.
      html += '<line x1="' + x0 + '" x2="' + (x0 + w) + '" y1="' + track + '" y2="' + track +
        '" class="rl-track"/>';
      // Viloyat bo'laklari: rels ostida ingichka chiziq va nom.
      let runStart = 0;
      const regionAt = (b) => (cols[b][0] || {}).region;
      const filled = cols.map((c, b) => (c.length ? b : -1)).filter((b) => b >= 0);
      for (let j = 1; j <= filled.length; j++) {
        const a = filled[runStart], prev = filled[j - 1];
        if (j === filled.length || regionAt(filled[j]) !== regionAt(prev)) {
          const xa = binX(a), xb = binX(prev) + CELL;
          html += '<line x1="' + xa.toFixed(1) + '" x2="' + xb.toFixed(1) + '" y1="' + (track + 5) +
            '" y2="' + (track + 5) + '" class="rl-band"/>';
          if (xb - xa > 60) {
            html += '<text x="' + ((xa + xb) / 2).toFixed(1) + '" y="' + (track + 17) +
              '" text-anchor="middle" class="rl-reg">' + esc(regionAt(prev)) + "</text>";
          }
          runStart = j;
        }
      }
      // Km o'qi: yaxlit qadam bilan.
      const step = niceStep(span / w);
      for (let km = Math.ceil(seg.from / step) * step; km <= seg.to; km += step) {
        const x = x0 + ((km - seg.from) / span) * w;
        html += '<line x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="' + track + '" y2="' + (track + 3) +
          '" class="rl-track"/><text x="' + x.toFixed(1) + '" y="' + (H - 3) +
          '" text-anchor="middle" class="rl-km">' + km + "</text>";
      }
      if (i < layout.length - 1) {
        html += '<text x="' + (x0 + w + SEG_GAP / 2) + '" y="' + (track + 4) +
          '" text-anchor="middle" class="rl-km">⋯</text>';
      }
      x0 += w + SEG_GAP;
    });
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.innerHTML = html;
    const byId = new Map(cams.map((c) => [c.id, c]));
    svg.onclick = (e) => {
      const dot = e.target.closest(".rl-dot");
      if (dot) selectCamera(Number(dot.dataset.id), true);
    };
    svg.onpointermove = (e) => {
      const bin = e.target.closest(".rl-bin");
      if (bin) {
        const { seg, bins, span, cols } = layout[Number(bin.dataset.s)];
        const b = Number(bin.dataset.b), col = cols[b];
        const by = {};
        col.forEach((c) => { by[c.st] = (by[c.st] || 0) + 1; });
        const km = (k) => Math.round(seg.from + (k / bins) * span);
        chTipShow(col.length + " kamera · " + Object.entries(by)
                    .map(([st, n]) => n + " " + STATE_LABEL[st].toLowerCase()).join(", "),
                  (col[0].region || "") + " · " + km(b) + "–" + km(b + 1) + " km", e.clientX, e.clientY);
        return;
      }
      const dot = e.target.closest(".rl-dot");
      if (!dot) { chTipHide(); return; }
      const c = byId.get(Number(dot.dataset.id));
      chTipShow(c.name + " · " + STATE_LABEL[c.st],
                c.region + " · " + c.km + (c.picket ? "/" + c.picket : "") + " km · bosilsa ochiladi",
                e.clientX, e.clientY);
    };
    svg.onpointerleave = chTipHide;
  }

  /* ---------- Ishonchlilik ---------- */

  renderReliability() {
    const o = state.overview;
    if (!o) return;
    const f = o.fleet, cov = o.coverage;
    $("rel-sub").textContent = (o.days === 1 ? "Bugun" : "So'nggi " + o.days + " kun") +
      " · kuzatuv bo'lgan vaqt bo'yicha";
    $("rel-up").textContent = fmtPct(f.uptime_pct);
    $("rel-up").className = "rk-v " + (f.uptime_pct == null ? "" : f.uptime_pct >= 99 ? "ok" : f.uptime_pct >= 95 ? "warn" : "bad");
    $("rel-out").textContent = fmtNum(f.outages);
    $("rel-blip").textContent = fmtNum(f.blips);
    $("rel-blip-n").textContent = Math.round(f.blip_threshold_s / 60) + " daqiqadan qisqa";
    $("rel-mttr").textContent = fmtDur(f.mttr_median_s);
    $("rel-mttr-n").textContent = "90% i " + fmtDur(f.mttr_p90_s) + " ichida tiklanadi";
    $("rel-cov").textContent = fmtPct(cov.pct);
    $("rel-cov").className = "rk-v " + (cov.pct >= 95 ? "ok" : cov.pct >= 70 ? "warn" : "bad");
    const big = cov.gaps.slice().sort((a, b) => b.hours - a.hours)[0];
    $("rel-cov-n").textContent = big
      ? "Eng uzun bo'shliq: " + fmtDate(big.from) + " – " + fmtDate(big.to) + " (" + Math.round(big.hours) + " soat)"
      : "Kuzatuv uzluksiz";
    $("rel-never").textContent = f.never_down + " ta kamera davr davomida bir marta ham uzilmagan · " +
      fmtNum(f.stalls) + " marta tasvir to'xtagan";

    // Hududlar: davr uptime'i, eng past birinchi. Chiziq 90–100% shkalada —
    // 0–100 da 95% va 98% bir xil uzunlikda ko'rinib, farq yo'qolardi.
    const FLOOR = 90;
    $("rel-regions").innerHTML = o.regions.map((g) => {
      const v = g.uptime_pct;
      const color = v == null ? "var(--faint)" : v >= 99 ? "var(--ok)" : v >= 95 ? "var(--warn)" : "var(--danger)";
      const w = v == null ? 0 : Math.max(2, Math.min(100, ((v - FLOOR) / (100 - FLOOR)) * 100));
      return '<div class="rrow"><span class="rg">' + esc(g.region) + "</span>" +
        '<div class="bar" title="Shkala: 90–100%"><i style="width:' + w + "%;background:" + color + '"></i></div>' +
        '<span class="lb">' + fmtPct(v) + '</span><span class="lb2" title="Haqiqiy uzilishlar">' +
        fmtNum(g.outages) + "</span></div>";
    }).join("");
  }

  /* ---------- Muammoli kameralar ---------- */

  renderProblems() {
    const o = state.overview;
    const problemMode = this.problemMode;
    const box = $("prob-rows");
    if (!o) { box.innerHTML = '<div class="empty">Hisobot yuklanmoqda…</div>'; return; }
    const list = problemMode === "offline" ? o.most_offline : o.most_flapping;
    if (!list.length) {
      box.innerHTML = '<div class="empty">Bu davrda muammoli kamera yo‘q.</div>';
      return;
    }
    const val = (c) => problemMode === "offline" ? c.offline_seconds : c.blips + c.outages;
    const max = val(list[0]) || 1;
    box.innerHTML = list.map((c) => {
      const where = c.km != null ? c.km + (c.picket ? "/" + c.picket : "") + " km · " + c.region : c.region;
      const main = problemMode === "offline"
        ? fmtDur(c.offline_seconds)
        : (c.outages + c.blips) + " marta";
      const note = problemMode === "offline"
        ? "uptime " + fmtPct(c.uptime_pct)
        : c.outages + " uzilish · " + c.blips + " sakrash";
      return '<div class="rrow click prob" data-id="' + c.id + '">' +
        '<span class="pd" style="background:' + STATE_COLOR[c.state] + '" title="' + STATE_LABEL[c.state] + '"></span>' +
        '<span class="tx"><b>' + esc(c.name) + "</b><i>" + esc(where) + "</i></span>" +
        '<div class="bar"><i style="width:' + Math.max(4, Math.round((val(c) / max) * 100)) +
          '%;background:var(--danger)"></i></div>' +
        '<span class="pv"><b>' + main + "</b><i>" + note + "</i></span></div>";
    }).join("");
    box.querySelectorAll(".prob").forEach((row) =>
      row.addEventListener("click", () => selectCamera(Number(row.dataset.id), true)));
  }

  /* ---------- Kun x soat xaritasi ---------- */

  /* Ustunlar — kunlar, qatorlar — soatlar: xarita karta kengligini to'liq
     egallaydi, balandligi esa 24 qator bilan cheklanadi. Haqiqiy pikselda
     chiziladi — yozuvlar har ekranda bir xil o'lchamda. */
  renderHeatmap() {
    const o = state.heatOverview || state.overview;
    const svg = $("heat-map");
    if (!o || !svg) return;
    const W = innerWidth_(svg.parentElement);
    if (W < 50) return;
    const rows = heatRows(o.heatmap);
    const padL = 26, padB = 16, gap = 3;
    const colW = Math.max(4, (W - padL) / 24 - gap);
    const rowH = Math.max(14, Math.min(30, colW * 1.4));
    const H = rows.length * (rowH + gap) + padB;
    // Bosqichlar kvantil bo'yicha: bitta o'ta zich katak shkalani "o'g'irlamasin".
    const vals = rows.filter((r) => !r.noData).flatMap((r) => r.hours).filter((n) => n > 0)
      .sort((a, b) => a - b);
    const cuts = [0.2, 0.4, 0.6, 0.8].map((q) => vals[Math.floor(q * (vals.length - 1))] || 0);
    const level = (n) => (n > 0 ? 1 + cuts.filter((c) => n > c).length : 0);
    let html = "<defs>" + hatchDef("hm-hatch") + "</defs>";
    for (let h = 0; h < 24; h += 2) {
      html += '<text x="' + (padL + h * (colW + gap) + colW / 2).toFixed(1) + '" y="' + (H - 3) +
        '" text-anchor="middle" class="hm-ax">' + String(h).padStart(2, "0") + "</text>";
    }
    const hourTotals = new Array(24).fill(0);
    let peak = { n: 0 };
    rows.forEach((r, i) => {
      const y = i * (rowH + gap);
      html += '<text x="' + (padL - 7) + '" y="' + (y + rowH / 2 + 3.5).toFixed(1) +
        '" text-anchor="end" class="hm-ax">' + r.label + "</text>";
      if (r.noData) {
        html += '<rect class="hm-cell" data-i="' + i + '" data-h="-1" x="' + padL + '" y="' + y + '" width="' +
          (24 * (colW + gap) - gap).toFixed(1) + '" height="' + rowH + '" rx="3" style="fill:url(#hm-hatch)"/>';
        return;
      }
      r.hours.forEach((n, h) => {
        hourTotals[h] += n;
        const x = padL + h * (colW + gap);
        if (n > peak.n) peak = { n, x, y };
        html += '<rect class="hm-cell" data-i="' + i + '" data-h="' + h + '" x="' + x.toFixed(1) + '" y="' + y +
          '" width="' + colW.toFixed(1) + '" height="' + rowH + '" rx="3" style="fill:' + heatFill(level(n)) + '"/>';
      });
    });
    if (peak.n) {
      html += '<rect x="' + (peak.x - 1.5).toFixed(1) + '" y="' + (peak.y - 1.5) + '" width="' +
        (colW + 3).toFixed(1) + '" height="' + (rowH + 3) + '" rx="4" class="hm-peak"/>';
    }
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.classList.toggle("hm-in", firstDraw("heat"));
    svg.innerHTML = html;
    const fmtN = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ","));
    svg.onpointermove = (e) => {
      const cell = e.target.closest(".hm-cell");
      if (!cell) { chTipHide(); return; }
      const r = rows[Number(cell.dataset.i)], h = Number(cell.dataset.h);
      if (h < 0) chTipShow("kuzatuv yo'q", r.label + " · server ishlamagan", e.clientX, e.clientY);
      else chTipShow(fmtN(r.hours[h]) + " ta uzilish" + (r.n > 1 ? " (o'rtacha)" : ""),
                     r.tip + " · " + String(h).padStart(2, "0") + ":00–" + String(h).padStart(2, "0") + ":59",
                     e.clientX, e.clientY);
    };
    svg.onpointerleave = chTipHide;

    const peakH = hourTotals.indexOf(Math.max(...hourTotals));
    const weekly = o.heatmap.length >= 7;
    $("heat-sub").textContent = (weekly ? "Hafta kuni × soat · " + o.days + " kunlik o'rtacha" : "Soat kesimida") +
      (hourTotals.some((v) => v > 0) ? " · cho'qqi " + String(peakH).padStart(2, "0") + ":00" : "");
    const nodata = o.heatmap.filter((r) => r.coverage_pct != null && r.coverage_pct < 50).length;
    $("heat-legend").innerHTML = "<span>kam</span>" +
      HEAT_STEPS.map((_, i) => '<i style="background:' + heatFill(i + 1) + '"></i>').join("") +
      "<span>ko'p</span>" + (nodata ? '<i class="hatch"></i><span>' + nodata + " kun kuzatuvsiz</span>" : "");
  }

  /* ---------- Ma'lumot sifati ---------- */

  renderQuality() {
    const o = state.overview;
    const box = $("quality-rows");
    if (!o || !box) return;
    const qualityOpen = this.qualityOpen;
    const total = QUALITY.reduce((s, [k]) => s + (o.quality[k] ? o.quality[k].count : 0), 0);
    $("quality-count").textContent = total ? total + " ta yozuv" : "";
    box.innerHTML = QUALITY.map(([key, label, hint]) => {
      const q = o.quality[key] || { count: 0, items: [] };
      const open = qualityOpen === key && q.count;
      return '<div class="qrow' + (q.count ? " click" : "") + (open ? " open" : "") + '" data-k="' + key + '">' +
        '<span class="qi ' + (q.count ? "bad" : "ok") + '">' + (q.count ? "!" : "✓") + "</span>" +
        '<span class="tx"><b>' + label + "</b><i>" + hint + "</i></span>" +
        '<span class="qn' + (q.count ? " bad" : "") + '">' + q.count + "</span></div>";
    }).join("");
    // Ochilgan ro'yxat — barcha bandlardan keyin, to'rni buzmasin.
    const q = qualityOpen && o.quality[qualityOpen];
    if (q && q.count) {
      box.insertAdjacentHTML("beforeend", '<div class="qlist">' + q.items.map((c) =>
        '<button data-id="' + c.id + '">' + esc(c.name) + "<i>" + esc(c.region) + "</i></button>").join("") +
        (q.count > q.items.length ? '<span class="more">va yana ' + (q.count - q.items.length) + " ta</span>" : "") +
        "</div>");
    }
    box.querySelectorAll(".qrow.click").forEach((row) =>
      row.addEventListener("click", () => {
        this.qualityOpen = this.qualityOpen === row.dataset.k ? null : row.dataset.k;
        this.renderQuality();
      }));
    box.querySelectorAll(".qlist button").forEach((b) =>
      b.addEventListener("click", () => selectCamera(Number(b.dataset.id), true)));
  }

  /* ---------- boshqaruv ---------- */

  init() {
    if (this.initialized) return;
    this.initialized = true;
    // Chizmalar haqiqiy pikselda — konteyner kengligi o'zgarsa qayta chiziladi.
    if (window.ResizeObserver) {
      let timer = 0;
      const redraw = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { if (state.tab === "dash") { this.renderLine(); this.renderHeatmap(); } }, 120);
      };
      ["rail-line", "heat-map"].forEach((id) => {
        const el = $(id);
        if (el) new ResizeObserver(redraw).observe(el.parentElement);
      });
    }
    document.querySelectorAll("#period button").forEach((b) =>
      b.addEventListener("click", () => {
        state.period = Number(b.dataset.p);
        document.querySelectorAll("#period button").forEach((x) => x.classList.toggle("on", x === b));
        document.dispatchEvent(new Event("period:changed"));
        this.load();
      }));
    document.querySelectorAll("#prob-mode button").forEach((b) =>
      b.addEventListener("click", () => {
        this.problemMode = b.dataset.m;
        document.querySelectorAll("#prob-mode button").forEach((x) => x.classList.toggle("on", x === b));
        this.renderProblems();
      }));
  }
}

export const overviewReport = new OverviewReport();

export function loadOverview() { return overviewReport.load(); }
export function renderOverview() { overviewReport.render(); }
export function renderLine() { overviewReport.renderLine(); }
export function initOverview() { overviewReport.init(); }
