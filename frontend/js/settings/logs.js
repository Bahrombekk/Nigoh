/* ==========================================================================
   settings/logs.js — Loglar (06.07) va Oʻzgarishlar jurnali (06.08)
   --------------------------------------------------------------------------
   Loglar: sarlavhada daraja Segmented "Hammasi / Xato / Ogohlantirish" (sonlari
   /logs/summary dan, tanlangan toifa va davr bo'yicha) + toifa, davr, qidiruv.
   Qator: vaqt (mono) · daraja tegi · xizmat · xabar; bosilsa — to'liq tafsilot.
   Jurnal: avatar + "admin oʻzgartirdi — Holat tekshiruvi oraligʻi · 60 → 45 s" +
   vaqt ("bugun 10:02"); bosilsa — barcha o'zgargan maydonlar.

   Eksport: LogsSection, AuditSection (klasslar)
   Backend: GET /api/admin/logs?category&level&hours&q&limit, GET /api/admin/logs/summary?hours,
            GET /api/admin/audit?limit
   ========================================================================== */
import { $, esc } from "../core/state.js";
import { api } from "../core/api.js";
import { toast, emptyState } from "../core/ui.js";
import { bindSearch, clockText, whenText, initials } from "./util.js";

const CATEGORIES = [["camera", "Kamera"], ["app", "Ilova"], ["mediamtx", "MediaMTX"], ["security", "Xavfsizlik"],
  ["database", "Baza"], ["stats", "Statistika"], ["access", "HTTP soʻrovlar"], ["errors", "Barcha xatolar"]];
const LV_TAG = { ERROR: "error", CRITICAL: "error", WARNING: "warn", WARN: "warn" };
const fmtN = (n) => Number(n || 0).toLocaleString("ru-RU").replace(/,/g, " ");

export class LogsSection {
  constructor() {
    this.level = "";
    this.bound = false;
    this.req = 0;
  }

  bind() {
    if (this.bound) return;
    this.bound = true;
    $("sl-cat").innerHTML = CATEGORIES.map(([v, t]) => '<option value="' + v + '">' + t + "</option>").join("");
    ["sl-cat", "sl-hours"].forEach((id) => $(id).addEventListener("change", () => this.load()));
    bindSearch($("sl-search"), () => this.load());
    $("sl-level").addEventListener("click", (e) => {
      const b = e.target.closest("[data-lv]");
      if (!b) return;
      this.setLevel(b.dataset.lv);
      this.load(true);
    });
    $("sl-list").addEventListener("click", (e) => {
      const r = e.target.closest(".sx-log");
      if (r && !window.getSelection().toString()) r.classList.toggle("is-open");
    });
  }

  setLevel(lv) {
    this.level = lv;
    $("sl-level").querySelectorAll("[data-lv]").forEach((x) => x.classList.toggle("is-on", x.dataset.lv === lv));
  }

  /* Tizim holati "Koʻrish" dan: toifa va daraja bilan ochiladi. */
  preset(opts) {
    this.bind();
    if (opts.category && CATEGORIES.some(([v]) => v === opts.category)) $("sl-cat").value = opts.category;
    this.setLevel(opts.level || "");
  }

  async load(levelOnly) {
    this.bind();
    const cat = $("sl-cat").value || "camera";
    const hours = $("sl-hours").value;
    const qs = new URLSearchParams({ category: cat, hours, limit: "300" });
    if (this.level) qs.set("level", this.level);
    const q = $("sl-q").value.trim();
    if (q) qs.set("q", q);
    const my = ++this.req;
    if (!$("sl-list").children.length) $("sl-list").innerHTML = '<div class="sx-loglist">' + [0, 1, 2, 3, 4].map(() =>
      '<div class="sx-log"><span class="skeleton" style="height:12px;width:70%"></span></div>').join("") + "</div>";
    const [res, sum] = await Promise.all([
      api("/api/admin/logs?" + qs).catch((e) => { toast(e.message, { tone: "error" }); return null; }),
      levelOnly && this.sum ? Promise.resolve(this.sum)
        : api("/api/admin/logs/summary?hours=" + Math.max(1, Math.round(hours))).catch(() => null),
    ]);
    if (my !== this.req) return;
    this.sum = sum;
    this.counts(cat, sum);
    if (!res) return;
    const items = res.items || [];
    const skip = new Set(["ts", "level", "category", "service", "event", "msg", "message"]);
    $("sl-list").innerHTML = items.length ? '<div class="sx-loglist">' + items.map((r) => {
      const lv = String(r.level || "").toUpperCase();
      const rest = Object.entries(r).filter(([k]) => !skip.has(k))
        .map(([k, v]) => k + "=" + (typeof v === "object" ? JSON.stringify(v) : v)).join("  ");
      const msg = r.event || r.msg || r.message || "";
      return '<div class="sx-log">' +
        '<span class="sx-log__t">' + esc(clockText(r.ts)) + "</span>" +
        '<span class="sx-lv' + (LV_TAG[lv] ? " sx-lv--" + LV_TAG[lv] : "") + '">' + esc(lv === "WARNING" ? "WARN" : lv || "—") + "</span>" +
        '<span class="sx-log__svc ellipsis">' + esc(r.service || r.category || "") + "</span>" +
        '<span class="sx-log__msg">' + esc(msg) + (rest ? '<span class="sx-log__rest"> · ' + esc(rest) + "</span>" : "") + "</span></div>";
    }).join("") + "</div>" + (res.count >= res.limit ? '<div class="body-xs t-tertiary sx-more">Oxirgi ' + res.limit + " ta yozuv koʻrsatildi</div>" : "")
      : emptyState({ type: "search", title: "Bu davrda yozuv yoʻq", text: "Toifa, davr yoki darajani oʻzgartirib koʻring" });
  }

  counts(cat, sum) {
    const c = sum && sum.categories ? (cat === "errors"
      ? Object.values(sum.categories).reduce((a, x) => ({ ERROR: (a.ERROR || 0) + (x.ERROR || 0) + (x.CRITICAL || 0) }), {})
      : sum.categories[cat] || {}) : null;
    const all = c ? Object.values(c).reduce((a, b) => a + b, 0) : null;
    const val = { "": all, ERROR: c ? (c.ERROR || 0) + (c.CRITICAL || 0) : null, WARNING: c ? c.WARNING || 0 : null };
    $("sl-level").querySelectorAll("[data-c]").forEach((el) => {
      const v = val[el.dataset.c];
      el.textContent = v == null ? "" : fmtN(v);
    });
  }
}

/* ---------- O'zgarishlar jurnali ---------- */
const VERB = { create: "qoʻshdi", update: "tahrirladi", delete: "oʻchirdi", restore: "qaytardi",
  password_reset: "parolni tikladi", password: "parolini almashtirdi", bulk: "ommaviy oʻzgartirdi" };
const ENTITY = { user: "Foydalanuvchi", group: "Guruh", camera: "Kamera", settings: "Sozlamalar", wall: "Video devor" };
const SETTING_LABEL = {
  site_name: "Sayt nomi", timezone: "Vaqt zonasi", language: "Til", ui_poll_s: "Xarita va roʻyxat yangilanishi",
  notify_outage: "Uzilish haqida bildirishnoma", public_view: "Mehmon koʻrishi", session_hours: "Seans muddati",
  health_interval_s: "Holat tekshiruvi oraligʻi", stall_after_s: "Tasvir toʻxtashi chegarasi", transport_check_after_s: "Uzatish usulini tekshirish",
};
const show = (v) => (v === true ? "yoqilgan" : v === false ? "oʻchirilgan" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));

export class AuditSection {
  constructor() { this.bound = false; }

  bind() {
    if (this.bound) return;
    this.bound = true;
    $("sa-list").addEventListener("click", (e) => {
      const r = e.target.closest(".sx-arow[data-has]");
      if (r) { r.classList.toggle("is-open"); r.setAttribute("aria-expanded", String(r.classList.contains("is-open"))); }
    });
  }

  async load() {
    this.bind();
    let res;
    try { res = await api("/api/admin/audit?limit=100"); }
    catch (e) { toast(e.message, { tone: "error" }); return; }
    const items = res.items || [];
    $("sa-list").innerHTML = items.length ? '<div class="sx-alist">' + items.map((a) => this.row(a)).join("") + "</div>"
      : emptyState({ type: "history", title: "Hali oʻzgarish yoʻq", text: "Sozlama, foydalanuvchi va guruh oʻzgarishlari shu yerda koʻrinadi" });
  }

  row(a) {
    const [ent, act] = String(a.action || "").split(".");
    const verb = a.action === "settings.update" ? "oʻzgartirdi" : VERB[act] || act || a.action;
    const b = a.before || {}, f = a.after || {};
    const keys = [...new Set([...Object.keys(b), ...Object.keys(f)])].filter((k) => show(b[k]) !== show(f[k]));
    let what;
    if (ent === "settings") {
      what = keys.length ? keys.slice(0, 2).map((k) => (SETTING_LABEL[k] || k) + " · " +
        (k in b ? show(b[k]) + " → " : "") + show(f[k])).join("; ") + (keys.length > 2 ? " +" + (keys.length - 2) : "") : "Sozlamalar";
    } else {
      const name = f.name || f.username || b.name || b.username || (a.entity_id ? "#" + a.entity_id : "");
      what = (ENTITY[ent] || ent || "") + (name ? " " + name : "");
      const extra = keys.filter((k) => !["name", "username", "password"].includes(k));
      if (act === "update" && extra.length) {
        const k = extra[0];
        what += " · " + k + " " + (k in b ? show(b[k]) + " → " : "") + show(f[k]);
      }
    }
    const details = keys.length ? '<ul class="sx-arow__diff">' + keys.map((k) => "<li><b>" + esc(SETTING_LABEL[k] || k) + "</b>: " +
      (k in b ? "<s>" + esc(show(b[k])) + "</s> → " : "") + esc(k in f ? show(f[k]) : "—") + "</li>").join("") +
      (a.ip ? '<li class="t-tertiary">IP: <span class="mono">' + esc(a.ip) + "</span></li>" : "") + "</ul>" : "";
    return '<div class="sx-arow"' + (details ? ' data-has="1" role="button" tabindex="0" aria-expanded="false"' : "") + ">" +
      '<span class="avatar">' + esc(initials(a.actor)) + "</span>" +
      '<span class="sx-arow__txt body-sm"><span class="t-primary">' + esc(a.actor || "tizim") + " " + esc(verb) + "</span>" +
        '<span class="t-secondary"> — ' + esc(what) + "</span>" + details + "</span>" +
      '<span class="sx-arow__t mono-xs t-tertiary">' + esc(whenText(a.ts)) + "</span></div>";
  }
}
