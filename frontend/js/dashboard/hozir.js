/* ==========================================================================
   dashboard/hozir.js — Dashboard / Hozir tabi (Figma 03.01, 03.04, 03.05)
   --------------------------------------------------------------------------
   Vazifasi:
     Operativ holat bir qarashda:
       * 4 StatCard — Onlayn kameralar · Uzilgan · Uptime · Uzilishlar (davr);
         sparkline, delta (oldingi teng davrga nisbat, ?compare=1), InfoTip;
       * Liniya holati — har kamera bitta kvadrat, km tartibida, hududlar bo'yicha;
       * Diqqat talab qiladi — hozir uzilganlar (eng uzog'i birinchi) va
         "Beqaror" rejimi (eski "Muammoli kameralar" kartasi shu yerga qo'shildi);
       * Hududlar holati (bosilsa hudud xaritada), Soʻnggi hodisalar (uzildi /
         qayta ulandi / oqim ochildi; eng so'nggilarida kameraning oxirgi surati);
       * Bugungi tahlil (6 xulosa: muammoli hudud, eng past nuqta, tiklangan,
         ta'sirlangan, eng uzun uzilish, o'chiq kamera-soat);
       * Tizim holati (xizmatlar + server yuklamasi) va Tezkor amallar (faqat admin).
     Qoida: har raqam shu tabda BIR marta.

   Eksport: HozirTab (klass), hozir (yagona nusxa)
     hozir.refresh(days, force) — davr ma'lumotini so'rash va chizish
     hozir.renderLive()         — faqat kameralar ro'yxatidan chiziladigan qismlar
     hozir.noteOpen()           — pleyer oqim ochganda (renderDashMetrics) — hodisa lentasiga

   Backend: /api/stats/summary?compare=1, /availability?compare=1, /outages/summary,
            /hourly (Bugun) yoki /daily (7/30), /series, /regions, /sla, /feed,
            /ranking?by=flapping, /outages?open_only=true, /api/system/state (yo'q bo'lsa /health),
            /api/cameras/{id}/snapshot?stale=1&cached=1 (hodisa surati). compare bo'lmasa delta yashirin.
   DOM: #db-hozir ichidagi #db-s-*, #db-line*, #db-att*, #db-regions, #db-events, #db-today*, #db-sys*, #db-qa-*
   ========================================================================== */
import { $, esc, state } from "../core/state.js";
import { icon, hydrateIcons } from "../core/icons.js";
import { tooltip } from "../core/ui.js";
import { showTab } from "../layout/tabs.js";
import { sparkline } from "./charts.js";
import {
  load, loadSeries, camState, STATUS, LABEL, fmtPct, fmtInt, fmtDur, fmtSince, hhmm, p2, WD, dayLabel,
  alertHtml, errHtml, emptyHtml, skelBars, withSkeleton,
} from "./common.js";

const camSelect = (id) => document.dispatchEvent(new CustomEvent("camera:select", { detail: { id: Number(id) } }));
/* Hudud xaritada: kameralar ro'yxati shu hudud nomi bilan filtrlanadi (v2 xatti-harakati). */
export function showRegionOnMap(region) {
  // Avval xarita ko'rinadi, filtr keyingi kadrda: yashirin (0 o'lchamli) xaritada
  // Leaflet chegaraga moslashda NaN beradi.
  showTab("map");
  import("../map/camera-list.js")
    .then((m) => requestAnimationFrame(() => requestAnimationFrame(() => m.setQuery(region, true))))
    .catch(() => {});
}
const SVC_ICON = { api: "server", db: "database", mediamtx: "video", health: "activity", disk: "hard-drive",
  network: "wifi", snapshots: "camera", stream: "play" };
const SVC_BADGE = { ok: ["online", "Faol"], warn: ["warning", "Diqqat"], warning: ["warning", "Diqqat"],
  degraded: ["warning", "Diqqat"], unknown: ["unknown", "Nomaʼlum"] };

export class HozirTab {
  constructor() {
    this.d = { days: 0 };
    this.attMode = "down";
    this.openSeen = new Map();
    this.openEvents = [];

    $("db-att-mode").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-m]");
      if (!b) return;
      this.attMode = b.dataset.m;
      $("db-att-mode").querySelectorAll("button").forEach((x) => x.classList.toggle("is-on", x === b));
      this.renderAttention();
      if (this.attMode === "flap") this.fetchFlap();
    });
    $("db-att").addEventListener("click", (e) => {
      const r = e.target.closest("[data-id]");
      if (r) camSelect(r.dataset.id);
    });
    $("db-regions").addEventListener("click", (e) => {
      const r = e.target.closest("[data-region]");
      if (r) showRegionOnMap(r.dataset.region);
    });
    $("db-events").addEventListener("click", (e) => {
      const r = e.target.closest("[data-id]");
      if (r) camSelect(r.dataset.id);
    });
    $("db-att-all").addEventListener("click", () => {
      if (state.admin && state.admin.role === "admin") {
        state.adminFilters = Object.assign({}, state.adminFilters, { status: "offline" });
        showTab("admin");
      } else {
        showTab("map");
      }
    });
    // "Barchasi" — bildirishnomalar paneli (shu sahifadagi qo'ng'iroq).
    $("db-ev-all").addEventListener("click", () => {
      const bell = document.querySelector("#db-sysbar .bell__btn");
      if (bell) bell.click();
    });
    // Liniya: kvadrat — kamera; kartaning qolgan joyi — xarita (02.01).
    $("db-line").addEventListener("click", (e) => {
      const sq = e.target.closest(".db-sq");
      if (sq) { camSelect(sq.dataset.id); return; }
      if (e.target.closest(".infotip")) return;
      showTab("map");
    });
    $("db-qa-add").addEventListener("click", () => {
      showTab("admin");
      import("../admin/camera-form.js")
        .then((m) => { if (m.openCameraForm) m.openCameraForm(null); })
        .catch(() => {});
    });
    $("db-qa-mtx").addEventListener("click", () => {
      showTab("admin");
      const b = document.getElementById("sync-btn");
      if (b) setTimeout(() => b.click(), 50);
    });
  }

  /* ---------- Ma'lumot ---------- */
  refresh(days, force) {
    if (this.d.days !== days) this.d = { days };
    const d = this.d;
    const take = (key, promise) => promise.then((v) => { if (this.d === d) { d[key] = v; this.paint(key); } },
      (err) => { if (this.d === d) { d[key] = { error: err }; this.paint(key); } });
    take("summary", load("/api/stats/summary?compare=1"));
    take("avail", load("/api/stats/availability?days=" + days + "&compare=1"));
    take("out", load("/api/stats/outages/summary?days=" + days));
    take("trend", days === 1 ? load("/api/stats/hourly?days=1") : load("/api/stats/daily?days=" + days));
    take("series", loadSeries(days));
    take("regions", load("/api/stats/regions?days=" + days));
    take("sla", load("/api/stats/sla?days=" + days + "&goal=95"));
    take("open", load("/api/stats/outages?open_only=true&days=30&sort=duration&limit=500"));
    const feed = load("/api/stats/feed?limit=14", force ? 0 : 15000);
    if (!d.feed) withSkeleton($("db-events"), skelBars(6, 14), feed);
    take("feed", feed);
    if (!$("db-today").dataset.filled) withSkeleton($("db-today"), skelBars(2, 18), load("/api/stats/regions?days=" + days));
    this.fetchSystem();
    if (this.attMode === "flap") this.fetchFlap();
    this.renderAll();
  }

  fetchFlap() {
    const d = this.d;
    const p = load("/api/stats/ranking?days=" + d.days + "&by=flapping&limit=30");
    if (!d.flap) { $("db-att").dataset.filled = ""; withSkeleton($("db-att"), skelBars(6, 14), p); }
    p.then((v) => { if (this.d === d) { d.flap = v; this.renderAttention(); } },
      (err) => { if (this.d === d) { d.flap = { error: err }; this.renderAttention(); } });
  }

  /* Tizim holati: v3 — /api/system/state; eski server — /health dan taxmin. /health
     qo'shimcha server yuklamasini beradi (oqimlar, tomoshabinlar, trafik). */
  fetchSystem() {
    const d = this.d;
    const st = load("/api/system/state", 25000).catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    const hl = load("/health", 25000).catch(() => null);
    if (!d.sys && !$("db-sys").dataset.filled) withSkeleton($("db-sys"), skelBars(5, 16), hl);
    Promise.all([st.catch((e) => ({ error: e })), hl]).then(([s, h]) => {
      if (this.d !== d) return;
      d.sys = { state: s, health: h };
      if (state.tab === "dash") this.renderSystem();
    });
  }

  paint(key) {
    if (state.tab !== "dash") return;
    if (["summary", "avail", "out", "trend", "series"].includes(key)) this.renderStats();
    if (["regions", "sla", "out"].includes(key)) this.renderToday();
    if (key === "feed") this.renderEvents();
    if (key === "open") this.renderAttention();
  }

  renderAll() {
    this.renderStats();
    this.renderLive();
    this.renderEvents();
    this.renderToday();
    this.renderSystem();
  }

  /* Faqat kameralar ro'yxatidan — avto-yangilashda (30 s) arzon. */
  renderLive() {
    this.renderStats();
    this.renderLine();
    this.renderAttention();
    this.renderRegions();
  }

  /* ---------- StatCard ---------- */
  counts() {
    const n = { online: 0, stalled: 0, offline: 0, disabled: 0, unknown: 0 };
    state.cameras.forEach((c) => { const s = camState(c); n[s in n ? s : "unknown"]++; });
    n.total = state.cameras.length;
    n.measured = n.online + n.stalled + n.offline;
    return n;
  }

  renderStats() {
    const d = this.d, days = d.days || 1;
    const ok = (k) => d[k] && !d[k].error ? d[k] : null;
    const n = this.counts();
    const series = ok("series") || [];
    const summary = ok("summary"), avail = ok("avail"), out = ok("out"), tr = ok("trend");

    // 1. Onlayn kameralar
    let meta1;
    if (days === 1) meta1 = n.stalled ? n.stalled + " tasi tasvirsiz" : "Tasvirsiz kamera yoʻq";
    else meta1 = series.length ? days + " kunda oʻrtacha " + fmtInt(series.reduce((s, p) => s + p.online, 0) / series.length) : "";
    const prevS = summary && summary.previous;
    setStat("db-s-online", {
      num: fmtInt(n.online), unit: "/ " + fmtInt(n.total), meta: meta1,
      delta: prevS && summary.online_pct != null && prevS.online_pct != null ? pctDelta(summary.online_pct - prevS.online_pct) : null,
    });
    sparkline(spark("db-s-online"), thin(series.map((p) => p.online)), "--color-icon-success");

    // 2. Uzilgan
    let meta2 = "";
    if (days === 1) {
      const never = state.cameras.filter((c) => camState(c) === "offline" && !c.last_seen).length;
      meta2 = never ? never + " tasi hech ulanmagan" : "Hech ulanmagan kamera yoʻq";
    } else if (series.length) {
      let peak = series[0];
      series.forEach((p) => { if (p.total - p.online > peak.total - peak.online) peak = p; });
      meta2 = (days === 7 ? "Haftalik" : "Oylik") + " choʻqqi: " + dayLabel(new Date(peak.t)) + " · " + fmtInt(peak.total - peak.online);
    }
    const prevOff = prevS && prevS.by_state ? prevS.by_state.offline : null;
    setStat("db-s-down", {
      num: fmtInt(n.offline), unit: n.measured ? fmtPct((n.offline / n.measured) * 100) : "", meta: meta2,
      delta: prevOff != null ? numDelta(n.offline - prevOff) : null,
    });
    sparkline(spark("db-s-down"), thin(series.map((p) => p.total - p.online)), "--color-icon-error");

    // 3. Uptime
    const prevA = avail && avail.previous;
    setStat("db-s-up", {
      num: avail ? fmtPct(avail.uptime_pct) : "—", unit: "",
      meta: avail && avail.coverage_pct != null ? "Kuzatuv qamrovi " + fmtPct(avail.coverage_pct, avail.coverage_pct >= 99.95 ? 0 : 1) : "",
      delta: prevA && avail.uptime_pct != null && prevA.uptime_pct != null ? pctDelta(avail.uptime_pct - prevA.uptime_pct) : null,
      error: d.avail && d.avail.error,
    });
    sparkline(spark("db-s-up"), thin(series.map((p) => p.pct)), "--color-icon-brand");

    // 4. Uzilishlar (davr)
    $("db-s-out-label").textContent = days === 1 ? "Bugungi uzilishlar" : "Uzilishlar · " + days + " kun";
    let meta4 = "", sp4 = [];
    if (tr && days === 1 && Array.isArray(tr.outages)) {
      const h = tr.outages;
      const peak = h.indexOf(Math.max(...h));
      meta4 = h[peak] ? "Choʻqqi " + p2(peak) + ":00 · " + h[peak] + " ta" : "Uzilish qayd etilmagan";
      // Soatlar xronologik tartibda (oxirgi 24 soat), yig'ma.
      const nowH = new Date().getHours();
      let acc = 0;
      for (let i = 1; i <= 24; i++) sp4.push(acc += h[(nowH + i) % 24] || 0);
    } else if (tr && Array.isArray(tr.days)) {
      const ds = tr.days;
      let peak = ds[0];
      ds.forEach((x) => { if ((x.outages || 0) > (peak.outages || 0)) peak = x; });
      meta4 = peak && peak.outages ? "Choʻqqi: " + dayLabel(peak.date) + " · " + fmtInt(peak.outages) : "Uzilish qayd etilmagan";
      let acc = 0;
      sp4 = ds.map((x) => (acc += x.outages || 0));
    }
    const prevO = out && out.previous;
    setStat("db-s-out", {
      num: out ? fmtInt(out.outages) : "—", unit: "", meta: meta4,
      delta: prevO && prevO.outages != null
        ? (days === 1 ? numDelta(out.outages - prevO.outages)
          : prevO.outages ? pctDelta(((out.outages - prevO.outages) / prevO.outages) * 100) : null)
        : null,
      error: d.out && d.out.error,
    });
    sparkline(spark("db-s-out"), sp4, "--color-icon-warning");
  }

  /* ---------- Liniya holati ---------- */
  renderLine() {
    const cams = state.cameras.filter((c) => c.km != null)
      .map((c) => ({ c, pos: c.km + (c.picket || 0) / 10, st: camState(c) }));
    $("db-line-sub").textContent = cams.length ? fmtInt(cams.length) + " kamera · km tartibida" : "";
    const strip = $("db-line-strip");
    if (!cams.length) {
      strip.innerHTML = emptyHtml("Km maʼlumoti yoʻq", "Kameralarga km va piket kiritilsa liniya shu yerda koʻrinadi.");
      return;
    }
    const groups = new Map();
    cams.forEach((x) => {
      const k = x.c.region || "Belgilanmagan";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(x);
    });
    const segs = [...groups.entries()].map(([region, list]) => {
      list.sort((a, b) => a.pos - b.pos);
      // Hudud km oralig'i — eng katta uzluksiz bo'lagidan (100 km dan katta uzilish — alohida bo'lak).
      const runs = [[list[0]]];
      for (let i = 1; i < list.length; i++) {
        if (list[i].pos - list[i - 1].pos > 100) runs.push([]);
        runs[runs.length - 1].push(list[i]);
      }
      const main = runs.reduce((a, b) => (b.length > a.length ? b : a));
      const lo = Math.floor(main[0].pos / 10) * 10, hi = Math.ceil(main[main.length - 1].pos / 10) * 10;
      return { region, list, center: main[Math.floor(main.length / 2)].pos, range: lo === hi ? "km " + lo : "km " + lo + "–" + hi };
    }).sort((a, b) => a.center - b.center);
    strip.classList.toggle("is-dense", cams.length > 500);
    strip.innerHTML = segs.map((s) =>
      '<div class="db-seg" style="flex:' + s.list.length + ' 1 0px;--n:' + s.list.length + '">' +
        '<div class="db-sqs">' + s.list.map((x) => {
          const c = x.c;
          const since = x.st === "offline" ? fmtSince(c.last_seen) : x.st === "online" && c.online_since ? fmtSince(c.online_since) : null;
          const tip = c.name + " · " + LABEL[x.st] + (since ? " · " + since : "");
          return '<i class="db-sq" data-status="' + STATUS[x.st] + '" data-id="' + c.id + '" data-tip="' + esc(tip) + '"></i>';
        }).join("") + "</div>" +
        '<div class="db-seg__l"><span class="db-seg__name">' + esc(s.region) + '</span><span class="db-seg__km">' + s.range + "</span></div>" +
      "</div>").join("");
    // Tor bo'lakda km oralig'i sig'masa — yashiriladi (nom qoladi, Figma'dagidek).
    strip.querySelectorAll(".db-seg__l").forEach((l) => {
      const km = l.querySelector(".db-seg__km");
      km.hidden = false;
      if (l.scrollWidth > l.clientWidth + 1) km.hidden = true;
    });
  }

  /* ---------- Diqqat talab qiladi ---------- */
  renderAttention() {
    const box = $("db-att");
    const off = state.cameras.filter((c) => camState(c) === "offline");
    const all = $("db-att-all");
    all.hidden = !off.length;
    all.textContent = "Barchasi · " + fmtInt(off.length);
    if (this.attMode === "flap") {
      const f = this.d.flap;
      if (!f) return;
      if (f.error) { box.innerHTML = errHtml(f.error); return; }
      box.dataset.filled = "1";
      if (!f.items.length) { box.innerHTML = emptyHtml("Beqaror kamera yoʻq", "Bu davrda uzilish ham, qisqa uzilish ham qayd etilmadi."); return; }
      box.innerHTML = f.items.map((c) => {
        const n = (c.outages || 0) + (c.blips || 0);
        return '<button class="db-att-row" data-id="' + c.id + '" data-tip="' + esc(c.outages + " ta uzilish · " + c.blips + " ta qisqa uzilish") + '">' +
          '<span class="dot" data-status="' + STATUS[c.state || "unknown"] + '"></span>' +
          '<span class="db-att-row__t"><span class="ellipsis">' + esc(c.name) + '</span><span class="db-att-row__s ellipsis">' + esc(c.region || "") + "</span></span>" +
          '<span class="db-att-row__d t-warning">' + fmtInt(n) + " marta</span></button>";
      }).join("");
      return;
    }
    box.dataset.filled = "1";
    if (!off.length) { box.innerHTML = emptyHtml("Barcha kameralar onlayn", "Diqqat talab qiladigan kamera yoʻq."); return; }
    const openSec = new Map();
    const o = this.d.open;
    if (o && !o.error) o.items.forEach((x) => openSec.set(x.camera_id, x.seconds));
    const age = (c) => (c.last_seen ? Date.now() - Date.parse(c.last_seen) : (openSec.get(c.id) || 0) * 1000 + 1e12);
    off.sort((a, b) => age(b) - age(a));
    box.innerHTML = off.slice(0, 60).map((c) => {
      const dur = c.last_seen ? fmtSince(c.last_seen) : openSec.has(c.id) ? fmtDur(openSec.get(c.id)) : "";
      return '<button class="db-att-row" data-id="' + c.id + '">' +
        '<span class="dot" data-status="offline"></span>' +
        '<span class="db-att-row__t"><span class="ellipsis">' + esc(c.name) + '</span><span class="db-att-row__s ellipsis">' + esc(c.region || "") + "</span></span>" +
        (c.last_seen ? "" : '<span class="db-tag">Hech ulanmagan</span>') +
        (dur ? '<span class="db-att-row__d t-error">' + dur + "</span>" : "") + "</button>";
    }).join("");
  }

  /* ---------- Hududlar holati ---------- */
  renderRegions() {
    const by = new Map();
    state.cameras.forEach((c) => {
      const k = c.region || "Belgilanmagan";
      const r = by.get(k) || { region: k, on: 0, n: 0 };
      const s = camState(c);
      if (s !== "disabled") r.n++;
      if (s === "online") r.on++;
      by.set(k, r);
    });
    const rows = [...by.values()].filter((r) => r.n)
      .map((r) => ({ ...r, pct: (r.on / r.n) * 100 }))
      .sort((a, b) => a.pct - b.pct || a.region.localeCompare(b.region, "uz"));
    const box = $("db-regions");
    if (!rows.length) { box.innerHTML = emptyHtml("Kamera yoʻq"); return; }
    box.innerHTML = rows.map((r) => {
      const st = r.pct < 80 ? "offline" : r.pct < 95 ? "no-video" : "online";
      return '<button class="db-reg" data-region="' + esc(r.region) + '" data-tip="Xaritada koʻrsatish">' +
        '<div class="db-reg__top"><span class="ellipsis">' + esc(r.region) + '</span><span class="db-reg__v">' +
          r.on + "/" + r.n + " · " + Math.round(r.pct) + "%</span></div>" +
        '<div class="db-bar"><i data-status="' + st + '" style="width:' + r.pct.toFixed(1) + '%"></i></div></button>';
    }).join("");
  }

  /* ---------- Soʻnggi hodisalar ---------- */
  noteOpen() {
    let changed = false;
    state.openByCam.forEach((ms, id) => {
      if (this.openSeen.get(id) === ms) return;
      this.openSeen.set(id, ms);
      const cam = state.byId.get(id);
      if (!cam) return;
      this.openEvents.unshift({ ts: new Date().toISOString(), camera_id: id, name: cam.name, kind: "open", ms });
      changed = true;
    });
    this.openEvents.length = Math.min(this.openEvents.length, 20);
    if (changed && state.tab === "dash") this.renderEvents();
  }

  renderEvents() {
    const box = $("db-events");
    const f = this.d.feed;
    if (!f && !this.openEvents.length) return;
    if (f && f.error && !this.openEvents.length) { box.innerHTML = errHtml(f.error); return; }
    const items = [...((f && !f.error && f.items) || []), ...this.openEvents]
      .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, 14);
    box.dataset.filled = "1";
    if (!items.length) { box.innerHTML = emptyHtml("Hodisa yoʻq", "Kameralar holati oʻzgarganda shu yerda koʻrinadi."); this.evSig = ""; return; }
    // Surat faqat eng so'nggi 8 ta hodisada (v2 kabi) — oxirgi ma'lum kadr, uzilganda ham.
    const seen = new Set();
    const html = items.map((e, i) => {
      const desc = e.kind === "offline" ? "— uzildi"
        : e.kind === "open" ? "— oqim ochildi · " + (e.ms / 1000).toFixed(1).replace(".", ",") + " s"
        : "— qayta ulandi";
      const thumb = i < 8 && e.camera_id && !seen.has(e.camera_id);
      if (thumb) seen.add(e.camera_id);
      const where = (e.region || "") + (e.km != null ? " · " + e.km + (e.picket ? "/" + e.picket : "") + " km" : "");
      return '<button class="db-ev" data-id="' + e.camera_id + '"' + (where ? ' data-tip="' + esc(where) + '"' : "") + ">" +
        '<span class="db-ev__time">' + hhmm(e.ts) + "</span>" +
        '<span class="dot" data-status="' + (e.kind === "offline" ? "offline" : "online") + '"></span>' +
        '<span class="db-ev__name">' + esc(e.name) + '</span><span class="db-ev__desc ellipsis">' + desc + "</span>" +
        (thumb ? '<img class="db-ev__img" loading="lazy" alt="" src="/api/cameras/' + e.camera_id + '/snapshot?stale=1&cached=1">' : "") +
        "</button>";
    }).join("");
    // Ro'yxat o'zgarmasa qayta chizilmaydi — suratlar har 30 s da miltillamasin.
    if (this.evSig === html) return;
    this.evSig = html;
    box.innerHTML = html;
    box.querySelectorAll(".db-ev__img").forEach((img) => img.addEventListener("error", () => img.remove(), { once: true }));
  }

  /* ---------- Bugungi tahlil ---------- */
  renderToday() {
    const d = this.d, days = d.days || 1;
    $("db-today-title").textContent = days === 1 ? "Bugungi tahlil" : "Davr tahlili";
    $("db-today-sub").textContent = (days === 1 ? "soʻnggi 24 soat" : days + " kun") + " · server tarixidan";
    const box = $("db-today");
    const reg = d.regions, sla = d.sla, out = d.out;
    if (!reg && !sla && !out) return;
    if ([reg, sla, out].every((x) => !x || x.error)) { box.innerHTML = alertHtml(); return; }
    const okv = (x) => (x && !x.error ? x : null);
    const worst = okv(reg) ? [...reg.regions].filter((r) => r.outages).sort((a, b) => b.outages - a.outages)[0] : null;
    const w = okv(sla) && sla.worst;
    const o = okv(out);
    const wd = w ? new Date(w.ts) : null;
    const tiles = [
      ["Eng muammoli hudud", "Davrda eng koʻp uzilish (2 daqiqadan uzun) boʻlgan hudud.",
        worst ? esc(worst.region) : "Yoʻq", worst ? fmtInt(worst.outages) + " ta uzilish" : "uzilish qayd etilmagan", ""],
      ["Eng past nuqta", "Onlayn kameralar ulushi eng past tushgan payt (5 daqiqalik oʻlchov boʻyicha).",
        w ? fmtPct(w.pct, 0) : "—", wd ? (days === 1 ? "" : WD[wd.getDay()] + " " + wd.getDate() + " · ") + p2(wd.getHours()) + ":" + p2(wd.getMinutes()) : "",
        w && w.pct < 50 ? "t-error" : w && w.pct < 90 ? "t-warning" : ""],
      ["Tiklangan uzilishlar", "Davrda tugagan, yaʼni kamera qayta ulangan uzilishlar soni.",
        o && o.mttr ? fmtInt(o.mttr.recovered) : "—", "qayta ulangan", ""],
      ["Uzilish boʻlgan kameralar", "Davrda kamida bir marta uzilgan kameralar soni.",
        o ? fmtInt(o.affected_cameras) : "—", "kamida 1 marta uzilgan", ""],
      ["Eng uzun uzilish", "Davrdagi eng uzun uzilish (faqat kuzatilgan qismi). Hali davom etayotgan boʻlishi mumkin.",
        o && o.longest ? fmtDur(o.longest.seconds) : "—",
        o && o.longest ? o.longest.name + (o.longest.open ? " · davom etmoqda" : "") : "uzilish qayd etilmagan",
        o && o.longest && o.longest.open ? "t-error" : ""],
      ["Ishlamagan vaqt", "Davrda barcha kameralarning ishlamagan (onlayn boʻlmagan) vaqti yigʻindisi, kamera-soatda.",
        o && o.offline_camera_hours != null ? fmtInt(o.offline_camera_hours) : "—", "kamera-soat", ""],
    ];
    box.dataset.filled = "1";
    box.innerHTML = tiles.map(([label, tip, value, meta, cls]) =>
      '<div class="kpi-tile db-tile"><div class="db-tile__head"><span>' + label + '</span><span class="spacer"></span>' +
        '<button type="button" class="infotip" data-tip="' + esc(tip) + '">' + icon("circle-question", "sm") + "</button></div>" +
        '<div class="db-tile__val"><span class="kpi-tile__value ellipsis ' + cls + '">' + value + '</span><span class="kpi-tile__meta ellipsis">' + esc(meta) + "</span></div></div>").join("");
    tooltip.label(box);
  }

  /* ---------- Tizim holati ---------- */
  renderSystem() {
    const s = this.d.sys, box = $("db-sys");
    if (!s) return;
    const st = s.state && !s.state.error ? s.state : null, h = s.health;
    let services;
    if (st && Array.isArray(st.services) && st.services.length) {
      services = st.services;
    } else if (h) {
      // Eski server: /health dan taxminiy xizmatlar ro'yxati.
      const hc = h.health || {};
      const fresh = hc.at && Date.now() - Date.parse(hc.at) < 10 * 60000;
      services = [
        { key: "api", name: "API", state: state.apiOk === false ? "down" : "ok", detail: state.apiOk === false ? "Javob yoʻq" : "Soʻrovlarga javob bermoqda" },
        { key: "mediamtx", name: "Video server", state: h.mediamtx ? "ok" : "down", detail: h.mediamtx ? "Ishlamoqda" : "Ishlamayapti" },
        { key: "health", name: "Holat tekshiruvi", state: fresh ? "ok" : "warn",
          detail: hc.checked ? hc.online + "/" + hc.checked + " qurilma javob berdi" : "Hali tekshirilmagan" },
        { key: "network", name: "Kamera tarmogʻi", state: hc.latency_ms == null ? "unknown" : hc.latency_ms < 300 ? "ok" : "warn",
          detail: hc.latency_ms == null ? "—" : Math.round(hc.latency_ms) + " ms" },
      ];
      if (h.snapshots) services.push({ key: "snapshots", name: "Suratlar", state: h.snapshots.ok >= h.snapshots.total * 0.8 ? "ok" : "warn",
        detail: h.snapshots.ok + "/" + h.snapshots.total + " surat olindi" });
    } else {
      box.innerHTML = s.state && s.state.error ? alertHtml() : emptyHtml("Maʼlumot yoʻq", "Server tizim holatini bermadi.");
      return;
    }
    box.dataset.filled = "1";
    const at = st && st.checked_at ? new Date(st.checked_at) : h && h.health && h.health.at ? new Date(h.health.at) : null;
    $("db-sys-sub").textContent = at && !isNaN(at) ? "tekshirildi " + hhmm(at) : "";
    let html = '<div class="db-svc-list">' + services.map((x) => {
      const [bs, bt] = SVC_BADGE[x.state] || ["offline", "Nosoz"];
      return '<div class="db-svc"><span class="db-svc__ic">' + icon(SVC_ICON[x.key] || "circle-check", "sm") + "</span>" +
        '<span class="db-svc__t"><span class="ellipsis">' + esc(x.name) + '</span><span class="db-svc__d ellipsis">' + esc(x.detail || "") + "</span></span>" +
        '<span class="badge" data-status="' + bs + '"><span class="dot" data-status="' + (bs === "warning" ? "no-video" : bs) + '"></span>' + bt + "</span></div>";
    }).join("") + "</div>";
    if (h && (h.streams != null || h.readers != null)) {
      const mbps = (v) => (v == null ? "—" : (Math.round(v * 10) / 10).toString().replace(".", ","));
      html += '<div class="db-sys-foot">' +
        '<span data-tip="Server hozir ochiq tutgan video oqimlar">Oqimlar <b>' + fmtInt(h.streams) + "</b></span>" +
        '<span data-tip="Oqimlarni hozir koʻrayotgan ulanishlar">Tomoshabinlar <b>' + fmtInt(h.readers) + "</b></span>" +
        (h.egress_mbps != null ? '<span data-tip="Serverdan chiqayotgan video trafik / sigʻim">Trafik <b>' + mbps(h.egress_mbps) + "</b>" +
          (h.egress_capacity_mbps ? " / " + fmtInt(h.egress_capacity_mbps) : "") + " Mbit/s</span>" : "") +
        "</div>";
    }
    box.innerHTML = html;
  }
}

/* ---------- StatCard yordamchilari ---------- */
function spark(id) { return $(id).querySelector(".db-spark"); }
/* Sparkline uchun ~48 nuqta: 5 daqiqalik shovqin o'rtacha bilan tekislanadi. */
function thin(values, n = 48) {
  if (values.length <= n) return values;
  const out = [], k = values.length / n;
  for (let i = 0; i < n; i++) {
    const part = values.slice(Math.floor(i * k), Math.floor((i + 1) * k));
    out.push(part.reduce((a, b) => a + b, 0) / part.length);
  }
  return out;
}

function setStat(id, { num, unit, meta, delta, error }) {
  const card = $(id);
  card.querySelector(".db-stat__num").textContent = num;
  const u = card.querySelector(".db-stat__unit");
  u.textContent = unit || "";
  u.hidden = !unit;
  const m = card.querySelector(".db-stat__meta");
  m.textContent = error ? "Maʼlumot yuklanmadi" : meta || "";
  m.classList.toggle("t-error", !!error);
  const dl = card.querySelector(".db-delta");
  dl.hidden = !delta;
  if (delta) { dl.textContent = delta.text; dl.dataset.tip = "Oldingi teng davrga nisbatan"; }
}
function pctDelta(v) {
  if (v == null || !isFinite(v)) return null;
  const a = Math.abs(v);
  const s = a < 1 && a > 0 ? a.toFixed(1).replace(".", ",") : String(Math.round(a));
  return { text: (v > 0 ? "▲ " : v < 0 ? "▼ " : "") + s + "%" };
}
function numDelta(v) {
  if (v == null || !isFinite(v)) return null;
  return { text: (v > 0 ? "▲ " : v < 0 ? "▼ " : "") + fmtInt(Math.abs(v)) };
}

export const hozir = new HozirTab();
hydrateIcons($("db-hozir"));
