/* ==========================================================================
   dashboard/trend.js — Dashboard / Trend tabi (Figma 03.02 + v2 vidjetlari)
   --------------------------------------------------------------------------
   Vazifasi:
     Dinamika (vaqt qatorlari va taqqoslash):
       * Onlaynlik darajasi — HOZIR / OʻRTACHA / ENG PAST / MAQSAD va SLA
         (maqsadda o'tgan vaqt ulushi, maqsaddan past vaqt, yetishmagan
         kamera-soat, o'lchovlar soni); maydonli chiziq, maqsad 95% punktiri,
         eng past nuqta; o'lchov oralig'i 5 daq (Bugun) / 1 soat / 6 soat;
       * Kunlik onlaynlik va Kunlik uzilishlar — ustunlar, bugungi to'q rangda;
       * Uzilishlar xaritasi — hafta kuni × soat, cho'qqi soati sarlavhada;
       * Sutka soatlari — uzilish + qisqa sakrash ustunlari, cho'qqi oynasi
         (v2 "Bugungi uzilishlar · soat kesimida" kartasi);
       * Oldingi davr bilan — uptime, qamrov, o'chiq vaqt, uzilmaganlar,
         onlaynlik ulushi va uzilishlar: joriy / oldingi / o'zgarish.

   Eksport: TrendTab (klass), trend (yagona nusxa) — refresh(days), redraw()
   Backend: /api/stats/series (step 5m|hour|6h — 6h bo'lmasa soatlikdan yig'iladi),
            /daily, /heatmap?mode=weekday, /sla?goal=95, /hourly,
            /availability?compare=1, /summary?compare=1, /hourly?day= (Bugun taqqoslash).
            SLA yoki compare bo'lmasa (eski server) — tegishli qism yashiriladi.
   ========================================================================== */
import { $, esc } from "../core/state.js";
import { lineChart, columns, heatmap, hourBars, HEAT_ALPHA } from "./charts.js";
import {
  load, loadSeries, fmtPct, fmtInt, fmtDur, dayLabel, hhmm, p2, errHtml, emptyHtml, skelBlock, skelBars,
  withSkeleton, cssVar,
} from "./common.js";

const WEEK = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];
const GOAL = 95;
const isoDay = (d) => d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());

export class TrendTab {
  constructor() { this.d = { days: 0 }; }

  refresh(days) {
    if (this.d.days !== days) this.d = { days };
    const d = this.d, n = Math.max(7, days);
    const take = (key, el, promise, h, skel) => {
      if (!d[key] && el && !el.dataset.filled) withSkeleton(el, skel || skelBlock(h), promise);
      promise.then((v) => { if (this.d === d) { d[key] = v; this.draw(key); } },
        (err) => { if (this.d === d) { d[key] = { error: err }; this.draw(key); } });
    };
    take("series", $("db-tl"), loadSeries(days), 160);
    take("sla", null, load("/api/stats/sla?days=" + days + "&goal=" + GOAL + "&step=" + (days === 1 ? "5m" : "hour")));
    const daily = load("/api/stats/daily?days=" + n);
    take("daily", $("db-du"), daily, 190);
    if (!d.daily && !$("db-de").dataset.filled) withSkeleton($("db-de"), skelBlock(190), daily);
    take("heat", $("db-hm"), load("/api/stats/heatmap?mode=weekday&days=" + n), 120);
    take("hourly", $("db-hr"), load("/api/stats/hourly?days=" + days), 180);
    // Taqqoslash
    take("avail", $("db-cmp"), load("/api/stats/availability?days=" + days + "&compare=1"), 0, skelBars(6, 16));
    take("summary", null, load("/api/stats/summary?compare=1&days=" + days));
    if (days === 1) {
      const now = new Date(), y = new Date(now.getTime() - 86400e3);
      take("hToday", null, load("/api/stats/hourly?day=" + isoDay(now)));
      take("hYest", null, load("/api/stats/hourly?day=" + isoDay(y)));
    } else if (days === 7) {
      take("daily14", null, load("/api/stats/daily?days=14"));
    }
    this.redraw();
  }

  redraw() { ["series", "sla", "daily", "heat", "hourly", "avail"].forEach((k) => this.draw(k)); }

  draw(key) {
    if (key === "series") this.drawLine();
    if (key === "sla") this.drawSla();
    if (key === "daily") this.drawDaily();
    if (key === "heat") this.drawHeat();
    if (key === "hourly") this.drawHourly();
    if (["avail", "summary", "hToday", "hYest", "daily14"].includes(key)) this.drawCompare();
  }

  /* ---------- Onlaynlik darajasi ---------- */
  drawLine() {
    const days = this.d.days || 1, s = this.d.series, box = $("db-tl");
    $("db-tl-sub").textContent = days === 1 ? "soʻnggi 24 soat · 5 daqiqalik oʻlchov"
      : "soʻnggi " + days + " kun · " + (days === 7 ? "1 soatlik" : "6 soatlik") + " oʻlchov";
    if (!s) return;
    const setV = (id, text, cls) => { const el = $(id); el.textContent = text; el.className = cls || ""; };
    if (s.error) { box.innerHTML = errHtml(s.error); box.dataset.filled = ""; return; }
    box.dataset.filled = "1";
    if (s.length < 2) {
      ["db-tl-now", "db-tl-avg", "db-tl-min"].forEach((id) => setV(id, "—"));
      box.innerHTML = emptyHtml("Tarix yigʻilmoqda", "Grafik dastlabki oʻlchovlar toʻplangach chiziladi.");
      return;
    }
    const cur = s[s.length - 1].pct;
    const avg = s.reduce((a, p) => a + p.pct, 0) / s.length;
    let low = s[0];
    s.forEach((p) => { if (p.pct < low.pct) low = p; });
    setV("db-tl-now", fmtPct(cur, 0), cur >= GOAL ? "t-success" : cur < 80 ? "t-error" : "t-warning");
    setV("db-tl-avg", fmtPct(avg, 0), "");
    setV("db-tl-min", fmtPct(low.pct, 0) + " · " + (days === 1 ? hhmm(low.t) : dayLabel(new Date(low.t))), "t-error");
    box.innerHTML = '<svg class="db-svg" role="img" aria-label="Onlaynlik darajasi grafigi"></svg>';
    lineChart(box.firstChild, s, {
      goal: GOAL, span: days === 1 ? "day" : days === 7 ? "week" : "month",
      from: Date.now() - days * 86400e3, to: Date.now(),
    });
  }

  /* SLA: maqsadda / past vaqt / yetishmagan kamera-soat / o'lchovlar.
     Endpoint bo'lmasa (eski server) — bu to'rtlik va ajratgich yashiriladi. */
  drawSla() {
    const s = this.d.sla;
    const stats = $("db-tl-stats");
    const ids = ["db-sla-in", "db-sla-below", "db-sla-def", "db-sla-n"];
    const hide = !s || s.error;
    stats.querySelector(".db-tl-div").hidden = !!hide;
    ids.forEach((id) => { $(id).parentElement.hidden = !!(s && s.error); });
    if (hide) return;
    const inPct = s.in_goal_pct;
    $("db-sla-in").textContent = fmtPct(inPct, 0);
    $("db-sla-in").className = inPct == null ? "" : inPct >= 90 ? "t-success" : inPct < 50 ? "t-error" : "t-warning";
    $("db-sla-below").textContent = s.below_goal_seconds ? fmtDur(s.below_goal_seconds) : "0";
    $("db-sla-def").innerHTML = fmtInt(s.deficit_camera_hours) + ' <small>kamera-soat</small>';
    $("db-sla-n").textContent = fmtInt(s.observed_slots);
  }

  /* ---------- Kunlik ustunlar ---------- */
  drawDaily() {
    const dly = this.d.daily, n = Math.max(7, this.d.days || 1);
    $("db-du-sub").textContent = n + " kun · oʻrtacha";
    $("db-de-sub").textContent = n + " kun · hodisalar";
    if (!dly) return;
    const up = $("db-du"), ev = $("db-de");
    if (dly.error) { up.innerHTML = ev.innerHTML = errHtml(dly.error); return; }
    const ds = (dly.days || []).slice(-n);
    up.dataset.filled = ev.dataset.filled = "1";
    if (!ds.length) {
      up.innerHTML = ev.innerHTML = emptyHtml("Kunlik tarix yoʻq", "Server ishlagan sari toʻlib boradi.");
      return;
    }
    const last = ds.length - 1;
    const dateTitle = (s) => { const d = new Date(s + "T12:00:00"); return d.getDate() + "." + p2(d.getMonth() + 1); };
    up.innerHTML = '<svg class="db-svg" role="img" aria-label="Kunlik onlaynlik"></svg>';
    columns(up.firstChild, ds.map((x, i) => ({
      label: dayLabel(x.date, i === last), value: x.uptime_pct,
      cap: x.uptime_pct == null ? null : Math.round(x.uptime_pct) + "%",
      tipTitle: x.uptime_pct == null ? "Kuzatuv yoʻq" : fmtPct(x.uptime_pct) + " onlayn",
      tipText: dateTitle(x.date) + (x.coverage_pct != null && x.coverage_pct < 100 ? " · kuzatuv qamrovi " + fmtPct(x.coverage_pct, 0) : "") +
        (x.offline_camera_hours != null ? " · ishlamagan vaqt " + fmtInt(x.offline_camera_hours) + " kamera-soat" : ""),
      hi: i === last,
    })), { max: 100, color: "--color-icon-brand" });
    ev.innerHTML = '<svg class="db-svg" role="img" aria-label="Kunlik uzilishlar"></svg>';
    columns(ev.firstChild, ds.map((x, i) => {
      const none = !x.coverage_pct && !x.outages;
      return {
        label: dayLabel(x.date, i === last), value: none ? null : x.outages || 0,
        cap: none ? null : fmtInt(x.outages || 0),
        tipTitle: none ? "Kuzatuv yoʻq" : fmtInt(x.outages || 0) + " ta uzilish",
        tipText: dateTitle(x.date) + (x.blips ? " · " + fmtInt(x.blips) + " ta qisqa uzilish" : ""),
        hi: i === last,
      };
    }), { color: "--color-icon-error" });
  }

  /* ---------- Uzilishlar xaritasi ---------- */
  drawHeat() {
    const h = this.d.heat, box = $("db-hm");
    if (!h) return;
    if (h.error) { box.innerHTML = errHtml(h.error); $("db-hm-legend").innerHTML = ""; return; }
    box.dataset.filled = "1";
    const byKey = new Map((h.rows || []).map((r) => [r.key, r]));
    const rows = WEEK.map((w, i) => {
      const r = byKey.get(i + 1);
      const has = r && r.days > 0 && r.hours;
      return { label: w, hours: has ? r.hours : null, tip: w + (has ? " · " + r.days + " kunlik oʻrtacha" : "") };
    });
    const sums = new Array(24).fill(0);
    rows.forEach((r) => (r.hours || []).forEach((v, i) => { sums[i] += v || 0; }));
    const peak = sums.indexOf(Math.max(...sums));
    $("db-hm-sub").textContent = "hafta × soat" + (sums[peak] > 0 ? " · choʻqqi " + p2(peak) + ":00" : "");
    box.innerHTML = '<svg class="db-svg" role="img" aria-label="Uzilishlar xaritasi"></svg>';
    heatmap(box.firstChild, rows);
    const red = cssVar("--color-icon-error");
    $("db-hm-legend").innerHTML = "<span>kam</span>" +
      HEAT_ALPHA.slice(1).map((a) => '<i style="background:' + esc(red) + ";opacity:" + a + '"></i>').join("") +
      '<span>koʻp</span><i class="db-hm-none"></i><span>kuzatuv yoʻq</span>';
  }

  /* ---------- Sutka soatlari ---------- */
  drawHourly() {
    const h = this.d.hourly, box = $("db-hr"), days = this.d.days || 1;
    if (!h) return;
    if (h.error) { box.innerHTML = errHtml(h.error); return; }
    box.dataset.filled = "1";
    const sum = (a) => (a || []).reduce((s, v) => s + (v || 0), 0);
    const pk = h.peak;
    $("db-hr-sub").textContent = (days === 1 ? "soʻnggi 24 soat" : days + " kun yigʻindisi") +
      (pk && pk.outages ? " · choʻqqi " + p2(pk.from_hour) + ":00–" + p2(pk.to_hour) + ":00" : "");
    if (!sum(h.outages) && !sum(h.blips)) {
      box.innerHTML = emptyHtml("Uzilish qayd etilmagan", "Bu davrda uzilish ham, qisqa uzilish ham boʻlmagan.");
      return;
    }
    box.innerHTML = '<svg class="db-svg" role="img" aria-label="Sutka soatlari boʻyicha uzilishlar"></svg>';
    hourBars(box.firstChild, h);
  }

  /* ---------- Oldingi davr bilan ---------- */
  drawCompare() {
    const d = this.d, days = d.days || 1, box = $("db-cmp");
    const ok = (k) => (d[k] && !d[k].error ? d[k] : null);
    const a = ok("avail"), sm = ok("summary");
    $("db-cmp-sub").textContent = days === 1 ? "soʻnggi 24 soat · undan oldingi 24 soat" : days + " kun · oldingi " + days + " kun";
    if (!d.avail) return;
    if (d.avail.error && !sm) { box.innerHTML = errHtml(d.avail.error); return; }
    box.dataset.filled = "1";
    // Oldingi davrda o'lchov bo'lmasa (null, 0 kamera-soat yoki 0% qamrov) — qiymat
    // "—" va o'zgarish belgisi yo'q (aks holda "▲1 516", "▲72,5 p.p." kabi soxta farq).
    const pa = a && a.previous && a.previous.coverage_pct > 0 && a.previous.camera_hours_observed > 0 ? a.previous : null;
    const smPrev = sm && sm.previous && sm.previous.measured > 0 ? sm.previous : null;
    const rows = [];
    // [nom, izoh, joriy, oldingi, tur ("pp" | "n" | "h"), yuqorisi yaxshimi]
    if (a) {
      rows.push(["Ishlash ulushi", "Uptime — kuzatilgan vaqtda onlayn boʻlgan ulush.", a.uptime_pct, pa ? pa.uptime_pct : null, "pp", true]);
      rows.push(["Kuzatuv qamrovi", "Davrning qancha qismida server oʻlchov yozgan.", a.coverage_pct, pa ? pa.coverage_pct : null, "pp", true]);
      rows.push(["Ishlamagan vaqt", "Kameralarning ishlamagan vaqti, kamera-soatda.", a.camera_hours_offline, pa ? pa.camera_hours_offline : null, "h", false]);
      rows.push(["Uzilmagan kameralar", "Davrda bir marta ham uzilmagan kameralar.", a.never_down, pa ? pa.never_down : null, "n", true]);
    }
    if (sm && sm.online_pct != null) {
      rows.push(["Hozir onlayn",
        "Hozirgi onlaynlik va " + (days === 1 ? "kechagi" : days + " kun oldingi") + " shu paytdagi oʻlchov.",
        sm.online_pct, smPrev ? smPrev.online_pct : null, "pp", true]);
    }
    // Uzilishlar: Bugun — bugun shu soatgacha vs kecha shu soatgacha; 7 kun — kalendar kunlar.
    const sumTo = (arr, h) => (arr || []).slice(0, h + 1).reduce((s, v) => s + (v || 0), 0);
    if (days === 1 && ok("hToday") && ok("hYest")) {
      const hNow = new Date().getHours();
      rows.push(["Uzilishlar", "Bugun soat " + p2(hNow) + ":59 gacha va kecha shu vaqtgacha.",
        sumTo(d.hToday.outages, hNow), sumTo(d.hYest.outages, hNow), "n", false]);
      rows.push(["Qisqa uzilishlar", "Bugun va kecha shu vaqtgacha boʻlgan 2 daqiqadan qisqa uzilishlar.",
        sumTo(d.hToday.blips, hNow), sumTo(d.hYest.blips, hNow), "n", false]);
    } else if (days === 7 && ok("daily14")) {
      const ds = d.daily14.days || [];
      const cur = ds.slice(-7), prev = ds.slice(-14, -7);
      const s = (xs, k) => xs.reduce((t, x) => t + (x[k] || 0), 0);
      const prevSeen = prev.some((x) => x.coverage_pct > 0);
      if (prev.length) {
        rows.push(["Uzilishlar", "Oxirgi 7 kalendar kun va undan oldingi 7 kun.", s(cur, "outages"), prevSeen ? s(prev, "outages") : null, "n", false]);
        rows.push(["Qisqa uzilishlar", "Oxirgi 7 kalendar kun va undan oldingi 7 kun.", s(cur, "blips"), prevSeen ? s(prev, "blips") : null, "n", false]);
      }
    }
    if (!rows.length) { box.innerHTML = emptyHtml("Taqqoslash yoʻq", "Server oldingi davr maʼlumotini bermadi."); return; }
    const fmtV = (v, kind) => (v == null ? "—" : kind === "pp" ? fmtPct(v, 1) : kind === "h" ? fmtInt(v) + " soat" : fmtInt(v));
    const prevNote = days === 30 ? "30 kundan eski tarix saqlanmaydi — oldingi davr toʻliq emas." : "";
    box.innerHTML = '<div class="db-cmp-row db-cmp-head"><span>Koʻrsatkich</span><span>Joriy</span><span>Oldingi</span><span></span></div>' +
      rows.map(([label, tip, cur, prev, kind, up]) => {
        let chip = "<span></span>";                    // oldingi yo'q — belgi ham yo'q
        if (cur != null && prev != null) {
          const diff = cur - prev;
          const rel = kind === "pp" ? diff : prev ? (diff / prev) * 100 : null;
          const good = diff === 0 ? null : (diff > 0) === up;
          const txt = kind === "pp" ? Math.abs(diff).toFixed(1).replace(".", ",") + " punkt"
            : rel == null ? fmtInt(Math.abs(diff)) : Math.round(Math.abs(rel)) + "%";
          chip = '<span class="db-chg" data-good="' + (good == null ? "" : good) + '">' +
            (diff > 0 ? "▲ " : diff < 0 ? "▼ " : "") + txt + "</span>";
        }
        return '<div class="db-cmp-row" data-tip="' + esc(tip + (prevNote ? " " + prevNote : "")) + '"><span class="ellipsis">' + esc(label) + "</span>" +
          '<span class="db-num">' + fmtV(cur, kind) + '</span><span class="db-num t-tertiary">' + fmtV(prev, kind) + "</span>" + chip + "</div>";
      }).join("");
  }
}

export const trend = new TrendTab();
