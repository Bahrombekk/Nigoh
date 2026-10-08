/* ==========================================================================
   settings/system.js — Tizim holati (06.04): 6 ta servis kartasi + Alert
   --------------------------------------------------------------------------
   Kartalar: Video servislari (MediaMTX, ish vaqti) · Holat kuzatuvi (onlayn /
   tekshirilgan, oxirgi tekshiruv) · Maʼlumotlar bazasi (versiya, jadval, hajm) ·
   API · Tarmoq (kechikish) · Versiya (yangilanish). Disk nazorati hozircha
   o'chiq (backend app/system_state.DISK_MONITORING) — disk kartasi ko'rsatilmaydi.
   Muammo bo'lsa (warn/error) — Alert ("Koʻrish" → Loglar). Ochiq turganda
   har 30 s yangilanadi; "Yangilash" — darhol.
   Avvalgi 21 jadval ro'yxati olib tashlandi (Figma).

   Eksport: SystemSection (klass)
   Backend: GET /api/admin/status (+ v3: mediamtx.uptime_s, network.latency_ms,
            disk.used_pct, disk.total_mb, update {current, latest}),
            GET /api/admin/db, GET /api/system/state (v3; yo'q bo'lsa — mahalliy qoidalar)
   ========================================================================== */
import { $, esc } from "../core/state.js";
import { api } from "../core/api.js";
import { icon } from "../core/icons.js";
import { toast } from "../core/ui.js";
import { durText, mbText } from "./util.js";

const DOT = { ok: "online", warn: "no-video", error: "offline", unknown: "unknown" };

function agoShort(iso) {
  if (!iso) return "hali boʻlmagan";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return Math.round(s) + " s oldin";
  if (s < 3600) return Math.round(s / 60) + " daq oldin";
  return Math.round(s / 3600) + " soat oldin";
}

export class SystemSection {
  constructor(page) {
    this.page = page;
    this.timer = 0;
    this.noState = false;           // eski backend: /api/system/state yo'q — qayta so'ralmaydi
    this.bound = false;
  }

  bind() {
    if (this.bound) return;
    this.bound = true;
    $("ss-refresh").addEventListener("click", () => this.load(true));
    $("ss-alerts").addEventListener("click", (e) => {
      const b = e.target.closest("[data-logs]");
      if (b) this.page.go("loglar", { category: b.dataset.logs || "", level: b.dataset.level || "" });
    });
  }

  start() {
    this.bind();
    this.load();
    clearInterval(this.timer);
    this.timer = setInterval(() => { if (!document.hidden) this.load(); }, 30000);
  }
  stop() { clearInterval(this.timer); }

  async load(manual) {
    const btn = $("ss-refresh");
    if (manual) btn.disabled = true;
    if (!$("ss-cards").children.length) {
      $("ss-cards").innerHTML = [0, 1, 2, 3, 4, 5].map(() => '<div class="sx-svc"><span class="skeleton" style="height:12px;width:60%"></span>' +
        '<span class="skeleton" style="height:18px;width:40%"></span><span class="skeleton" style="height:10px;width:70%"></span></div>').join("");
    }
    const [st, db, sys] = await Promise.all([
      api("/api/admin/status").catch((e) => { toast(e.message, { tone: "error" }); return null; }),
      api("/api/admin/db").catch(() => null),
      this.noState ? null : api("/api/system/state").catch((e) => { if (e.status === 404) this.noState = true; return null; }),
    ]);
    btn.disabled = false;
    this.render(st, db, sys);
  }

  render(st, db, sys) {
    if (!st) {
      $("ss-cards").innerHTML = "";
      $("ss-alerts").innerHTML = this.alertHtml({ tone: "error", title: "Holatni olib boʻlmadi", text: "Server javob bermadi — keyinroq qayta urinib koʻring" });
      return;
    }
    const svc = {};
    ((sys && sys.services) || []).forEach((s) => { svc[s.key] = s; });
    const cards = [], issues = [];

    // 1. MediaMTX
    const mm = st.mediamtx;
    const mmOk = typeof mm === "object" && mm !== null ? mm.ok !== false && mm.available !== false : !!mm;
    const uptime = (mm && typeof mm === "object" ? mm.uptime_s : null) ?? st.mediamtx_uptime_s ?? null;
    const stalled = (st.stalled || []).length;
    const nodes = st.nodes || [];
    const offNodes = nodes.filter((n) => n.status === "offline").length;
    let mmState = svc.mediamtx ? svc.mediamtx.state : !mmOk ? "error" : stalled || offNodes ? "warn" : "ok";
    cards.push({ key: "mediamtx", icon: "video", name: "Video xizmati (MediaMTX)", state: mmState,
      value: mmOk ? "Ishlamoqda" : "Javob yoʻq",
      meta: !mmOk ? "Jonli oqim ochilmaydi" : uptime != null ? "Ish vaqti " + durText(uptime)
        : stalled ? stalled + " ta oqimda tasvir toʻxtagan" : nodes.reduce((a, n) => a + (n.ready || 0), 0) + " ta oqim ochiq" });
    if (!mmOk) issues.push({ tone: "error", title: "Video xizmati (MediaMTX) javob bermayapti", text: "Jonli tasvir ochilmaydi — xizmatni tekshiring", logs: "mediamtx", level: "ERROR" });
    else if (stalled) issues.push({ tone: "warning", title: stalled + " ta ochiq oqimda tasvir toʻxtagan", text: "Kamera yoki tarmoqni tekshirish kerak", logs: "camera", level: "WARNING" });
    else if (offNodes) issues.push({ tone: "warning", title: offNodes + " ta media tugun javob bermayapti", text: "Shu tugundagi kameralar ochilmaydi", logs: "mediamtx" });

    // 2. Holat kuzatuvi
    const h = st.health || {};
    let hState = svc.health ? svc.health.state : !h.at ? "warn" : (Date.now() - new Date(h.at)) / 1000 > 1800 ? "error" : "ok";
    cards.push({ key: "health", icon: "eye", name: "Holat tekshiruvi", state: hState,
      value: h.checked != null ? (h.online ?? 0) + " / " + h.checked : "—",
      meta: "Oxirgi tekshiruv " + agoShort(h.at) });
    if (hState === "error") issues.push({ tone: "error", title: "Holat tekshiruvi toʻxtagan", text: "Kameralar holati yangilanmayapti", logs: "camera" });

    // 3. Baza
    const dbState = svc.db ? svc.db.state : !db ? "unknown" : db.up_to_date === false ? "warn" : "ok";
    const dbMb = db && db.size_bytes != null ? db.size_bytes / 1048576 : st.disk && st.disk.db_mb;
    cards.push({ key: "db", icon: "server", name: "Maʼlumotlar bazasi", state: dbState,
      value: db ? "PostgreSQL " + String(db.server_version || "").split(" ")[0] : "—",
      meta: db ? (db.tables ? db.tables.length + " jadval · " : "") + mbText(dbMb) +
        (db.up_to_date === false ? " · yangilash kerak" : "") : (svc.db && svc.db.detail) || "Maʼlumot yoʻq" });
    if (dbState === "warn" || dbState === "error") issues.push({ tone: dbState === "error" ? "error" : "warning",
      title: dbState === "error" ? "Baza javob bermayapti" : db && db.up_to_date === false ? "Baza sxemasi eski" : "Baza sekin javob bermoqda",
      text: (svc.db && svc.db.detail) || "Server jurnalini koʻring", logs: "database" });

    // 4. API (disk nazorati hozircha o'chiq — 2026-10-08 qarori; disk kartasi yo'q)
    const apiSvc = svc.api;
    cards.push({ key: "api", icon: "server", name: "API", state: apiSvc ? apiSvc.state : "ok",
      value: apiSvc && apiSvc.state !== "ok" ? "Muammo bor" : "Ishlamoqda",
      meta: (apiSvc && apiSvc.detail) || "Soʻrovlarga javob bermoqda" });

    // 5. Tarmoq
    const net = st.network || {};
    const lat = net.latency_ms ?? null;
    const nState = svc.network ? svc.network.state : lat == null ? "unknown" : lat > 200 ? "warn" : "ok";
    cards.push({ key: "network", icon: "wifi", name: "Tarmoq", state: nState,
      value: nState === "unknown" ? "—" : nState === "ok" ? "Barqaror" : nState === "warn" ? "Sekin" : "Uzilish bor",
      meta: lat != null ? "Kechikish " + Math.round(lat) + " ms" : (svc.network && svc.network.detail) || "Oʻlchov hali yoʻq" });
    if (nState === "warn" || nState === "error") issues.push({ tone: nState === "error" ? "error" : "warning",
      title: nState === "error" ? "Kamera tarmogʻida uzilish" : "Kamera tarmogʻi sekin",
      text: (svc.network && svc.network.detail) || (lat != null ? "Oʻrtacha kechikish " + Math.round(lat) + " ms" : ""), logs: "camera" });

    // 6. Versiya (API)
    const up = st.update || null;
    const hasNew = up && up.latest && up.latest !== (up.current || st.version);
    cards.push({ key: "version", icon: "circle-check", name: "Versiya", state: hasNew ? "warn" : up ? "ok" : "unknown",
      value: "v" + esc(st.version || (up && up.current) || "—"),
      meta: hasNew ? "Yangi versiya: v" + up.latest : up ? "Yangilanish yoʻq" : "Yangilanish tekshirilmaydi",
      metaTone: hasNew ? "brand" : "" });

    $("ss-cards").innerHTML = cards.map((c) =>
      '<div class="sx-svc" data-svc="' + c.key + '">' +
        '<div class="sx-svc__head">' + icon(c.icon) + '<span class="label-sm t-secondary ellipsis">' + esc(c.name) + "</span>" +
          '<span class="spacer"></span><span class="dot" data-status="' + DOT[c.state || "unknown"] + '" role="img" aria-label="' +
          ({ ok: "Ishlamoqda", warn: "Diqqat", error: "Nosoz", unknown: "Nomaʼlum" }[c.state] || "Nomaʼlum") + '"></span></div>' +
        '<div class="numeric-md ellipsis">' + esc(c.value) + "</div>" +
        '<div class="body-xs ' + (c.metaTone ? "t-" + c.metaTone : "t-tertiary") + ' ellipsis">' + esc(c.meta) + "</div></div>").join("");

    const order = { error: 0, warning: 1 };
    issues.sort((a, b) => order[a.tone] - order[b.tone]);
    $("ss-alerts").innerHTML = issues.slice(0, 3).map((i) => this.alertHtml(i)).join("");
  }

  alertHtml(i) {
    return '<div class="alert alert--' + i.tone + '"' + (i.tone === "error" ? ' role="alert"' : "") + ">" +
      icon(i.tone === "error" ? "circle-exclamation" : "triangle-exclamation", "sm") +
      '<div class="alert__body"><span class="alert__title">' + esc(i.title) + "</span>" +
        (i.text ? '<span class="alert__text">' + esc(i.text) + "</span>" : "") + "</div>" +
      (i.logs != null ? '<button class="btn btn--tertiary btn--sm" data-logs="' + esc(i.logs) + '" data-level="' + esc(i.level || "") + '">Koʻrish</button>' : "") +
      "</div>";
  }
}
