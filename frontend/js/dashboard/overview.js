/* ==========================================================================
   dashboard/overview.js — Dashboard / Tahlil tabi (Figma 03.03 + v2 vidjetlari)
   --------------------------------------------------------------------------
   Vazifasi:
     Texnik tahlil (kesimlar, reytinglar, ishonchlilik, sifat):
       * Ishonchlilik — 7 KpiTile: Uptime, Haqiqiy uzilishlar, Qisqa sakrashlar,
         Tasvir to'xtashlari, Tiklanish (MTTR), Uzilishlar oralig'i (MTBF),
         Kuzatuv qamrovi (eng uzun bo'shliq bilan); atamalar izohi — InfoTip'da;
       * Hududlar reytingi (+ CSV) va Uptime taqsimoti — ranking.js chizadi;
       * Kamera markalari — marka jadvali (hozirgi holat chizig'i, uptime,
         uzilish/kamera, sakrash, MTTR, o'girish; bosilsa modellari ochiladi);
       * Holatlar — holatlar donuti, qatorda sabablar (state_reason) maslahatda;
       * Muammoli kameralar: Reyting (4 saralash), Eng uzun uzilishlar, Ochilish vaqti;
       * Texnik kesim — bitta to'plangan chiziq + legenda (+ RTSP UDP);
       * Maʼlumot sifati — 9 tekshiruv; admin — Boshqaruv mos filtr bilan
         (state.adminFilters.quality + state.adminFilterHint, "admin:filter" hodisasi),
         boshqalar — qator ostida kameralar ro'yxati (bosilsa xaritada).

   Eksport: OverviewReport (klass), overviewReport — refresh(days), renderLive(), redraw(), renderOpen()
            initOverview() — main.js mosligi (bir marta ulash); tileHtml()
   Backend: /api/stats/availability?compare=1, /outages/summary, /coverage, /vendors, /quality,
            /regions, /ranking?by=…, /outages?sort=duration, /api/metrics/open
   ========================================================================== */
import { $, esc, state } from "../core/state.js";
import { icon } from "../core/icons.js";
import { tooltip } from "../core/ui.js";
import { donut } from "./charts.js";
import { load, camState, STATUS, LABEL, fmtPct, fmtInt, fmtDur, alertHtml, errHtml, emptyHtml, skelBars, withSkeleton } from "./common.js";
import { renderRegionTable, regionsCsv, renderDistribution, renderRanking, renderLongest } from "./ranking.js";
import { showRegionOnMap } from "./hozir.js";

const VENDOR = { dahua: "Dahua", hikvision: "Hikvision", holowits: "Holowits", boshqa: "Boshqa", unknown: "Nomaʼlum" };
const vendorLabel = (v) => VENDOR[v] || (v ? v[0].toUpperCase() + v.slice(1) : "Nomaʼlum");
const camSelect = (id) => document.dispatchEvent(new CustomEvent("camera:select", { detail: { id: Number(id) } }));

const QUALITY = [
  ["no_location", "Koordinatasi yoʻq", "Xaritada koʻrinmaydi, hudud koordinatadan aniqlanmaydi."],
  ["no_region", "Hududi aniqlanmagan", "Hududlar hisobotiga kirmaydi — hududni qoʻlda tanlang."],
  ["no_km", "Km / piket yoʻq", "Liniya holatida koʻrinmaydi. NVR kanallari uchun odatiy hol."],
  ["no_codec", "Kodek nomaʼlum", "Kamera javob bermagan — pasport tekshiruvi fonda qayta urinadi."],
  ["never_seen", "Hech ulanmagan", "IP manzil yoki parol notoʻgʻri boʻlishi mumkin — joyida tekshiring."],
  ["no_model", "Qurilma modeli nomaʼlum", "Qurilma pasport bermaydi — proshivka yangilanishini kuzatib boʻlmaydi."],
  ["probe_failed", "Pasport tekshiruvi xatosi", "Sabab: parol notoʻgʻri, RTSP yoʻli notoʻgʻri yoki tarmoq javob bermaydi."],
  ["vendor_mismatch", "Marka modelga mos emas", "Import paytida marka notoʻgʻri taxmin qilingan — markani tuzating."],
  ["km_name_mismatch", "Nomdagi km mos emas", "Nomni “3428/1 km” koʻrinishiga keltiring yoki km qiymatini tuzating."],
];
/* probe_failed.detail prefiksi → sabab */
const CAUSE = { parol: "parol", oqim: "oqim yoʻli", tarmoq: "tarmoq" };

const STATE_PARTS = [
  ["online", "--color-status-online-icon"], ["stalled", "--color-status-no-video-icon"],
  ["offline", "--color-status-offline-icon"], ["disabled", "--color-status-disabled-icon"],
  ["unknown", "--color-status-unknown-icon"],
];
const STATE_HINT = {
  online: "Tarmoq va tasvir bor", stalled: "Aloqa bor, lekin kadr kelmayapti", offline: "Tarmoqdan javob yoʻq",
  disabled: "Administrator oʻchirgan", unknown: "Server hali tekshirmagan yoki IP manzil yoʻq",
};
const NOW_PARTS = ["online", "stalled", "offline"];

export class OverviewReport {
  constructor() {
    this.d = { days: 0 };
    this.open = new Set();
    this.rankBy = "offline_time";
    this.qOpen = null;
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;
    $("db-vendors").addEventListener("click", (e) => {
      const r = e.target.closest(".db-vt-row[data-v]");
      if (!r) return;
      const k = r.dataset.v;
      if (this.open.has(k)) this.open.delete(k); else this.open.add(k);
      this.renderVendors();
    });
    $("db-rr").addEventListener("click", (e) => {
      const r = e.target.closest("[data-region]");
      if (r) showRegionOnMap(r.dataset.region);
    });
    $("db-rr-csv").addEventListener("click", () => {
      const r = this.d.regions;
      regionsCsv(r && !r.error ? r : null, this.d.days || 1);
    });
    $("db-rank-mode").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-by]");
      if (!b || b.dataset.by === this.rankBy) return;
      this.rankBy = b.dataset.by;
      $("db-rank-mode").querySelectorAll("button").forEach((x) => x.classList.toggle("is-on", x === b));
      this.fetchRanking();
    });
    ["db-rank", "db-long"].forEach((id) => $(id).addEventListener("click", (e) => {
      const r = e.target.closest("[data-id]");
      if (r) camSelect(r.dataset.id);
    }));
    // Ma'lumot sifati → Boshqaruv (admin): filtr ishorasi tabs.js o'tishidan OLDIN qo'yiladi
    // (bu tinglovchi qatorga yaqinroq — document'dagi [data-tab-go] dan oldin ishlaydi).
    // Boshqa rollar: qator ostida kameralar ro'yxati ochiladi.
    $("db-quality").addEventListener("click", (e) => {
      if (e.target.closest(".infotip")) { e.stopPropagation(); return; }
      const cam = e.target.closest(".db-q-cam[data-id]");
      if (cam) { camSelect(cam.dataset.id); return; }
      const r = e.target.closest(".db-q-row[data-k]");
      if (!r || !r.classList.contains("is-link")) return;
      const q = this.d.quality && this.d.quality[r.dataset.k];
      if (!r.dataset.tabGo) {
        this.qOpen = this.qOpen === r.dataset.k ? null : r.dataset.k;
        this.renderQuality();
        return;
      }
      const meta = QUALITY.find((x) => x[0] === r.dataset.k);
      const hint = { key: r.dataset.k, label: meta ? meta[1] : r.dataset.k,
                     ids: q ? q.items.map((x) => x.id) : [], count: q ? q.count : 0 };
      state.adminFilters = Object.assign({}, state.adminFilters, { quality: hint.key, ids: hint.ids });
      state.adminFilterHint = hint;
      document.dispatchEvent(new CustomEvent("admin:filter", { detail: hint }));
    });
  }

  refresh(days) {
    this.init();
    if (this.d.days !== days) this.d = { days };
    const d = this.d;
    const take = (key, promise, el, skel, then) => {
      if (el && !el.dataset.filled) withSkeleton(el, skel, promise);
      promise.then((v) => { if (this.d === d) { d[key] = v; then(); } },
        (err) => { if (this.d === d) { d[key] = { error: err }; then(); } });
    };
    const rel = () => this.renderReliability();
    take("avail", load("/api/stats/availability?days=" + days + "&compare=1"), $("db-rel"), skelBars(2, 18),
      () => { rel(); this.renderDist(); });
    take("out", load("/api/stats/outages/summary?days=" + days), null, "", rel);
    take("cov", load("/api/stats/coverage?days=" + days + "&min_gap_minutes=60"), null, "", rel);
    take("vendors", load("/api/stats/vendors?days=" + days), $("db-vendors"), skelBars(4, 16), () => { this.renderVendors(); this.renderTech(); });
    take("quality", load("/api/stats/quality"), $("db-quality"), skelBars(6, 16), () => this.renderQuality());
    take("openm", load("/api/metrics/open?limit=12", 20000), $("db-open"), skelBars(4, 14), () => this.renderOpen());
    take("regions", load("/api/stats/regions?days=" + days), $("db-rr"), skelBars(6, 16), () => this.renderRegions());
    take("longest", load("/api/stats/outages?days=" + days + "&sort=duration&limit=20"), $("db-long"), skelBars(6, 14), () => this.renderLongest());
    this.fetchRanking();
    this.renderReliability();
    this.renderDist();
    this.renderVendors();
    this.renderQuality();
    this.renderOpen();
    this.renderRegions();
    this.renderLongest();
    this.renderLive();
  }

  fetchRanking() {
    const d = this.d, by = this.rankBy;
    const p = load("/api/stats/ranking?days=" + (d.days || 1) + "&by=" + by + "&limit=25");
    const box = $("db-rank");
    if (!(d.rank && d.rank.by === by)) { box.dataset.filled = ""; withSkeleton(box, skelBars(6, 14), p); }
    p.then((v) => { if (this.d === d && this.rankBy === by) { d.rank = { by, data: v }; this.renderRanking(); } },
      (err) => { if (this.d === d && this.rankBy === by) { d.rank = { by, error: err }; this.renderRanking(); } });
  }

  renderLive() { this.renderTech(); this.renderStates(); }
  redraw() { this.renderStates(); }

  /* ---------- Ishonchlilik ---------- */
  renderReliability() {
    const d = this.d, days = d.days || 1;
    $("db-rel-sub").textContent = (days === 1 ? "bugun" : days + " kun") + " · kuzatuv boʻlgan vaqt boʻyicha";
    const box = $("db-rel");
    const a = d.avail, o = d.out, c = d.cov;
    if (!a && !o) return;
    if ((!a || a.error) && (!o || o.error)) { box.innerHTML = alertHtml(); return; }
    const av = a && !a.error ? a : null, ov = o && !o.error ? o : null, cv = c && !c.error ? c : null;
    const up = av ? av.uptime_pct : null;
    const cov = av ? av.coverage_pct : cv ? cv.pct : null;
    const thr = ov ? Math.round(ov.blip_threshold_s / 60) : 2;
    const gap = cv && cv.gaps && cv.gaps.length ? [...cv.gaps].sort((x, y) => y.hours - x.hours)[0] : null;
    const tiles = [
      ["Ishlash ulushi", "Uptime — kameralar onlayn boʻlgan vaqt ulushi (faqat kuzatilgan vaqt boʻyicha). 90% dan past — ogohlantirish, 95% va undan yuqori — yaxshi.",
        fmtPct(up), "barcha kameralar boʻyicha", up == null ? "" : up < 90 ? "t-warning" : up >= 95 ? "t-success" : ""],
      ["Uzilishlar", thr + " daqiqadan uzun yoki hali davom etayotgan uzilishlar soni. Qisqa uzilishlar bunga kirmaydi.",
        ov ? fmtInt(ov.outages) : "—", thr + " daqiqadan uzun", ""],
      ["Qisqa uzilishlar", thr + " daqiqadan qisqa, oʻzi tiklangan uzilishlar — odatda tarmoq beqarorligi belgisi.",
        ov ? fmtInt(ov.blips) : "—", thr + " daqiqadan qisqa", ""],
      ["Tasvir toʻxtashlari", "Port ochiq, lekin video kelmay qolgan holatlar. Uzilish hisobiga kirmaydi.",
        ov && ov.stalls != null ? fmtInt(ov.stalls) : "—", "aloqa bor, kadr yoʻq", ""],
      ["Tiklanish vaqti", "MTTR — uzilishdan tiklanishgacha oʻtgan vaqt (mediana). Pastda: uzilishlarning 90 foizi shu vaqt ichida tiklanadi.",
        ov && ov.mttr ? fmtDur(ov.mttr.median_s) : "—", ov && ov.mttr && ov.mttr.p90_s != null ? "90 foizi — " + fmtDur(ov.mttr.p90_s) + " ichida" : "", ""],
      ["Uzilishlar orasidagi vaqt", "MTBF — bitta kamerada ikki uzilish orasidagi oʻrtacha vaqt. Qancha katta boʻlsa, shuncha yaxshi.",
        ov && ov.mtbf_s ? fmtDur(ov.mtbf_s) : "—", "har bir kamera uchun", ""],
      ["Kuzatuv qamrovi", "Davrning qancha qismida server oʻlchov yozgan. Past boʻlsa boshqa koʻrsatkichlar toʻliq emas.",
        cov == null ? "—" : fmtPct(cov, cov >= 99.95 ? 0 : 1),
        cov == null ? "" : cov >= 99.95 ? "kuzatuv toʻliq" : gap ? "eng uzun boʻshliq — " + fmtDur(gap.hours * 3600) : cv ? fmtInt(cv.missing_hours) + " soat kuzatuvsiz" : "",
        cov == null ? "" : cov >= 95 ? "t-success" : cov < 70 ? "t-error" : "t-warning"],
    ];
    box.dataset.filled = "1";
    box.innerHTML = tiles.map(([label, tip, value, meta, cls]) => tileHtml(label, tip, value, meta, cls)).join("");
    tooltip.label(box);
  }

  /* ---------- Hududlar reytingi / Uptime taqsimoti ---------- */
  renderRegions() {
    const r = this.d.regions, box = $("db-rr");
    const days = this.d.days || 1;
    $("db-rr-sub").textContent = (days === 1 ? "bugun" : days + " kun") + " · eng yomoni yuqorida";
    if (!r) return;
    $("db-rr-csv").hidden = !!r.error;
    if (r.error) { box.innerHTML = errHtml(r.error); return; }
    box.dataset.filled = "1";
    renderRegionTable(box, r);
  }

  renderDist() {
    const a = this.d.avail, box = $("db-dist");
    if (!a) return;
    if (a.error) { box.innerHTML = errHtml(a.error); return; }
    box.dataset.filled = "1";
    $("db-dist-sub").textContent = renderDistribution(box, a) || "";
  }

  /* ---------- Reyting / Eng uzun uzilishlar ---------- */
  renderRanking() {
    const r = this.d.rank, box = $("db-rank");
    if (!r || r.by !== this.rankBy) return;
    if (r.error) { box.innerHTML = errHtml(r.error); return; }
    box.dataset.filled = "1";
    $("db-rank-sub").textContent = r.data.total ? fmtInt(r.data.total) + " kamera" : "";
    renderRanking(box, r.data, this.rankBy);
  }

  renderLongest() {
    const l = this.d.longest, box = $("db-long");
    if (!l) return;
    if (l.error) { box.innerHTML = errHtml(l.error); return; }
    box.dataset.filled = "1";
    $("db-long-sub").textContent = "eng uzuni birinchi";
    renderLongest(box, l, this.d.days || 1);
  }

  /* ---------- Kamera markalari ---------- */
  renderVendors() {
    const v = this.d.vendors, box = $("db-vendors");
    if (!v) return;
    if (v.error) { box.innerHTML = errHtml(v.error); return; }
    box.dataset.filled = "1";
    const list = v.vendors || [];
    const models = list.reduce((s, x) => s + (x.models || []).filter((m) => m.model).length, 0);
    $("db-ven-sub").textContent = list.length ? list.length + " marka · " + models + " model" : "";
    if (!list.length) { box.innerHTML = emptyHtml("Kamera yoʻq"); return; }
    const upCls = (u) => (u == null ? "" : u < 90 ? "t-warning" : u >= 95 ? "t-success" : "");
    const maxRate = Math.max(0.01, ...list.flatMap((x) => [x.outages_per_camera, ...(x.models || []).map((m) => m.outages_per_camera)])
      .filter((x) => x != null));
    const nowCell = (r) => {
      const n = r.now || {};
      const measured = NOW_PARTS.reduce((s, k) => s + (n[k] || 0), 0);
      const tip = NOW_PARTS.map((k) => (n[k] || 0) + " " + LABEL[k].toLowerCase()).join(" · ");
      return '<span class="db-vt-now" data-tip="' + esc(tip) + '"><span class="db-vt-stack">' +
        NOW_PARTS.filter((k) => n[k]).map((k) => '<i data-status="' + STATUS[k] + '" style="flex:' + n[k] + ' 1 0px"></i>').join("") +
        "</span><b>" + (measured ? fmtInt(n.online) + "/" + fmtInt(measured) : "—") + "</b></span>";
    };
    const rateCell = (x) => '<span class="db-vt-rate"><span class="db-bar"><i data-status="offline" style="width:' +
      (x == null ? 0 : Math.max(3, (x / maxRate) * 100)).toFixed(1) + '%"></i></span><b>' +
      (x == null ? "—" : x.toFixed(1).replace(".", ",")) + "</b></span>";
    const cells = (r, top) =>
      "<span>" + fmtInt(r.cameras) + "</span>" + nowCell(r) +
      '<span class="' + upCls(r.uptime_pct) + '">' + fmtPct(r.uptime_pct) + "</span>" +
      rateCell(r.outages_per_camera) +
      "<span>" + fmtInt(r.blips) + "</span>" +
      "<span>" + fmtDur(r.mttr_median_s) + "</span>" +
      "<span>" + (top ? (r.transcode ? fmtInt(r.transcode) : "—") : "") + "</span>";
    let html = '<div class="db-vt"><div class="db-vt-row db-vt-head"><span>Marka</span><span>Kamera</span>' +
      '<span data-tip="Hozir onlayn / tekshirilgan kameralar">Hozir onlayn</span>' +
      '<span data-tip="Uptime — davrda onlayn boʻlgan vaqt ulushi">Ishlash ulushi</span>' +
      '<span data-tip="Davrdagi uzilishlar soni ÷ kameralar soni">Uzilish (har kameraga)</span>' +
      '<span data-tip="2 daqiqadan qisqa uzilishlar">Qisqa uzilish</span>' +
      '<span data-tip="MTTR — uzilishdan tiklanishgacha oʻtgan vaqt (mediana)">Tiklanish vaqti</span>' +
      '<span data-tip="H.265 → H.264 oʻgirilayotgan kameralar">Oʻgirish</span></div>';
    list.forEach((r) => {
      const codecs = [["H.264", r.codecs && r.codecs.H264], ["H.265", r.codecs && r.codecs.H265]]
        .filter(([, n]) => n).map(([k, n]) => k + ": " + n).join(" · ");
      const nm = (r.models || []).filter((m) => m.model).length;
      const isOpen = this.open.has(r.vendor);
      html += '<button class="db-vt-row' + (isOpen ? " is-open" : "") + '" data-v="' + esc(r.vendor) + '" aria-expanded="' + isOpen + '">' +
        '<span class="db-vt-name"><b><span class="db-vt-chev">' + icon("chevron-right", "sm") + "</span>" + esc(vendorLabel(r.vendor)) + "</b><i>" +
        nm + " model" + (codecs ? " · " + codecs : "") + (r.no_model ? " · modeli nomaʼlum: " + r.no_model : "") + "</i></span>" +
        cells(r, true) + "</button>";
      if (isOpen) {
        (r.models || []).forEach((m) => {
          html += '<div class="db-vt-row db-vt-sub"><span class="db-vt-name"><i>' + esc(m.model || "Model nomaʼlum") + "</i></span>" + cells(m, false) + "</div>";
        });
      }
    });
    box.innerHTML = html + "</div>";
  }

  /* ---------- Ochilish vaqti ---------- */
  renderOpen() {
    const m = this.d.openm, box = $("db-open");
    let rows = [], sub = "";
    const sec = (ms) => (ms / 1000).toFixed(1).replace(".", ",") + " s";
    if (m && !m.error && m.items && m.items.length) {
      rows = m.items.map((x) => ({ name: x.name, ms: x.median_ms, id: x.camera_id || x.id,
        tip: x.n + " ochilish · oxirgisi " + sec(x.last_ms) + (x.max_ms ? " · eng sekini " + sec(x.max_ms) : "") + (x.transport ? " · " + x.transport : "") }));
      sub = "mediana " + sec(m.p50_ms) + (m.p95_ms ? " · 95 foizi — " + sec(m.p95_ms) + " ichida" : "") + " · " + fmtInt(m.opens) + " ochilish";
    } else {
      rows = [...state.openByCam.entries()].map(([id, ms]) => ({ cam: state.byId.get(id), ms, id }))
        .filter((r) => r.cam).map((r) => ({ name: r.cam.name, ms: r.ms, id: r.id, tip: "shu seans" }));
      if (rows.length) sub = "shu seans oʻlchovlari";
    }
    $("db-open-sub").textContent = sub;
    if (!m && !rows.length) return;
    box.dataset.filled = "1";
    if (!rows.length) {
      box.innerHTML = m && m.error && m.error.status !== 404 ? alertHtml()
        : emptyHtml("Hali oʻlchov yoʻq", "Kamera oqimi ochilganda birinchi kadrgacha vaqt shu yerda koʻrinadi.");
      return;
    }
    rows = rows.sort((a, b) => b.ms - a.ms).slice(0, 12);
    const max = rows[0].ms || 1;
    box.innerHTML = rows.map((r) => {
      const s = r.ms / 1000;
      const st = s <= 2 ? "online" : s <= 5 ? "no-video" : "offline";
      return '<div class="db-open-row" data-tip="' + esc(r.tip) + '"><span class="ellipsis">' + esc(r.name) + "</span>" +
        '<div class="db-bar"><i data-status="' + st + '" style="width:' + Math.max(4, (r.ms / max) * 100).toFixed(1) + '%"></i></div>' +
        '<span class="db-num">' + sec(r.ms) + "</span></div>";
    }).join("");
  }

  /* ---------- Texnik kesim ---------- */
  renderTech() {
    const cams = state.cameras, total = cams.length;
    const box = $("db-tech");
    if (!total) { box.innerHTML = emptyHtml("Kamera yoʻq"); return; }
    const isH264 = (c) => /h264|avc/i.test(c.codec || ""), isH265 = (c) => /h265|hevc/i.test(c.codec || "");
    const parts = [
      ["H.265 → H.264 oʻgirish", cams.filter((c) => c.transcode).length, "db-k-brand"],
      ["H.264 (oʻgirishsiz)", cams.filter((c) => isH264(c) && !c.transcode).length, "db-k-brand2"],
      ["H.265 (oʻgirilmaydi)", cams.filter((c) => isH265(c) && !c.transcode).length, "db-k-warn"],
      ["Doim tayyor rejim", cams.filter((c) => c.always_on).length, "db-k-muted"],
    ];
    const v = this.d.vendors;
    if (v && !v.error && v.vendors) {
      const udp = v.vendors.reduce((s, x) => s + (x.udp || 0), 0);
      parts.push(["RTSP UDP orqali", udp, "db-k-muted"]);
    }
    const pct = (n) => Math.round((n / total) * 100);
    box.dataset.filled = "1";
    box.innerHTML = '<div class="db-stack" role="img" aria-label="Kodeklar taqsimoti">' +
      parts.slice(0, 3).filter((p) => p[1]).map((p) => '<i class="' + p[2] + '" style="flex:' + p[1] + ' 1 0px" data-tip="' +
        esc(p[0] + ": " + p[1] + " kamera") + '"></i>').join("") + "</div>" +
      '<div class="db-tech-rows">' + parts.map((p) =>
        '<div class="db-tech-row"><i class="db-key ' + p[2] + '"></i><span class="ellipsis">' + p[0] + "</span>" +
        '<span class="spacer"></span><span class="db-num">' + fmtInt(p[1]) + '</span><span class="db-tech-pct">' + pct(p[1]) + "%</span></div>").join("") +
      "</div>";
  }

  /* ---------- Holatlar (donut) ---------- */
  renderStates() {
    const box = $("db-states");
    const total = state.cameras.length;
    if (!total) { box.innerHTML = emptyHtml("Kamera yoʻq"); return; }
    const n = {}, by = {};
    state.cameras.forEach((c) => {
      const s = camState(c);
      n[s] = (n[s] || 0) + 1;
      (by[s] = by[s] || []).push(c);
    });
    const parts = STATE_PARTS.map(([k, color]) => ({ key: k, n: n[k] || 0, color, label: LABEL[k] }))
      .filter((p) => p.n || p.key !== "unknown");
    const active = total - (n.disabled || 0);
    const pct = active ? ((n.online || 0) / active) * 100 : 0;
    $("db-states-sub").textContent = fmtInt(total) + " kamera · " + new Set(state.cameras.map((c) => c.region || "Belgilanmagan")).size + " hudud";
    if (!box.querySelector("svg")) {
      box.innerHTML = '<svg class="db-donut" role="img" aria-label="Holatlar taqsimoti"></svg><div class="db-states__legend"></div>';
    }
    box.dataset.filled = "1";
    donut(box.querySelector("svg"), parts, { value: Math.round(pct) + "%", sub: fmtInt(n.online || 0) + " / " + fmtInt(active) });
    // Muammoli holatda qaysi kameralar va nega — maslahatda (v2 donut legendasi).
    const why = (k) => {
      if (k === "online" || !by[k]) return STATE_HINT[k];
      const list = by[k];
      return STATE_HINT[k] + ": " + list.slice(0, 6).map((c) => c.name + (c.state_reason ? " — " + c.state_reason : "")).join("; ") +
        (list.length > 6 ? " … va yana " + (list.length - 6) + " ta" : "");
    };
    box.querySelector(".db-states__legend").innerHTML = parts.map((p) =>
      '<div class="db-tech-row" data-tip="' + esc(why(p.key)) + '" data-tip-title="' + esc(p.label) + '">' +
      '<span class="dot" data-status="' + STATUS[p.key] + '"></span>' +
      '<span class="ellipsis">' + p.label + '</span><span class="spacer"></span><span class="db-num">' + fmtInt(p.n) +
      '</span><span class="db-tech-pct">' + Math.round((p.n / total) * 100) + "%</span></div>").join("");
  }

  /* ---------- Maʼlumot sifati ---------- */
  renderQuality() {
    const q = this.d.quality, box = $("db-quality");
    if (!q) return;
    if (q.error) { box.innerHTML = errHtml(q.error); return; }
    box.dataset.filled = "1";
    const checks = QUALITY.filter(([k]) => q[k] || k.indexOf("mismatch") < 0 && k !== "probe_failed");
    const total = checks.reduce((s, [k]) => s + (q[k] ? q[k].count : 0), 0);
    $("db-q-sub").textContent = fmtInt(total) + " kamchilik · " + checks.length + " tekshiruv";
    const admin = state.admin && state.admin.role === "admin";
    const causes = (k) => {
      if (k !== "probe_failed" || !q[k]) return "";
      const n = {};
      q[k].items.forEach((x) => { const c = CAUSE[String(x.detail || "").split(":")[0].trim()] || "boshqa"; n[c] = (n[c] || 0) + 1; });
      return Object.entries(n).map(([c, v]) => c + " " + v).join(" · ");
    };
    box.innerHTML = '<div class="db-q-grid">' + checks.map(([k, label, tip]) => {
      const c = q[k] ? q[k].count : 0;
      const go = c > 0;
      const isOpen = !admin && this.qOpen === k && c;
      const sub = causes(k);
      let row = '<div class="db-q-row' + (go ? " is-link" : "") + (isOpen ? " is-open" : "") + '" data-k="' + k + '"' +
        (go ? (admin ? ' data-tab-go="admin"' : "") + ' role="button" tabindex="0"' + (admin ? "" : ' aria-expanded="' + !!isOpen + '"') : "") + ">" +
        '<span class="db-q-ic ' + (c ? "t-warning" : "t-success") + '">' + icon(c ? "triangle-exclamation" : "circle-check", "sm") + "</span>" +
        '<span class="db-q-label"><span>' + label + "</span>" + (sub ? '<span class="db-q-cause">' + esc(sub) + "</span>" : "") + "</span>" +
        '<button type="button" class="infotip" data-tip="' + esc(tip) + '">' + icon("circle-question", "sm") + "</button>" +
        '<span class="spacer"></span><span class="db-num">' + fmtInt(c) + "</span>" +
        (go ? '<span class="db-q-chev">' + icon(admin ? "chevron-right" : isOpen ? "chevron-up" : "chevron-down", "sm") + "</span>" : '<span class="db-q-chev"></span>') + "</div>";
      if (isOpen) {
        const items = q[k].items || [];
        row += '<div class="db-q-list">' + items.map((x) =>
          '<button class="db-q-cam" data-id="' + x.id + '"' + (x.detail ? ' data-tip="' + esc(x.detail) + '"' : "") + ">" + esc(x.name) +
          "<i>" + esc(x.region || "") + "</i></button>").join("") +
          (c > items.length ? '<span class="db-q-more">va yana ' + fmtInt(c - items.length) + " ta</span>" : "") + "</div>";
      }
      return row;
    }).join("") + "</div>";
    tooltip.label(box);
    box.querySelectorAll(".db-q-row.is-link").forEach((r) => r.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); r.click(); }
    }));
  }
}

export function tileHtml(label, tip, value, meta, cls) {
  return '<div class="kpi-tile db-tile"><div class="db-tile__head"><span class="db-tile__label">' + esc(label) + '</span><span class="spacer"></span>' +
    '<button type="button" class="infotip" data-tip="' + esc(tip) + '">' + icon("circle-question", "sm") + "</button></div>" +
    '<div class="db-tile__val"><span class="kpi-tile__value ' + (cls || "") + '">' + esc(value) + '</span><span class="kpi-tile__meta db-tile__meta">' +
    esc(meta) + "</span></div></div>";
}

export const overviewReport = new OverviewReport();

/* ---------- v2 mosligi (main.js chaqiradi) ---------- */
export function initOverview() { overviewReport.init(); }
export function loadOverview() { return Promise.resolve(); }
export function renderOverview() {}
export function renderLine() {}
