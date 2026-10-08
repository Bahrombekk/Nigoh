/* ==========================================================================
   layout/notifications.js — Toolbar / Tizim (sysbar) va bildirishnomalar (07.01)
   --------------------------------------------------------------------------
   Vazifasi:
     sysbar — "● Tizim barqaror" pill + soat + qo'ng'iroq. Bir nechta joyda
     turishi mumkin (xarita toolbar'i, dashboard sarlavhasi, devor): har biri
     mountSysbar(el) bilan; hammasi bir xil holatni ko'rsatadi.
     Bildirishnomalar popover'i: Hammasi / Uzilishlar / Tizim, kun guruhlari
     (Bugun / Kecha / Oldin), o'qilmagan ko'k nuqta, "Hammasi oʻqildi".

   Eksport:
     mountSysbar(container, { flat })  — sysbar'ni joylash
     sysState                           — { state, label, services } (oxirgi)
     refreshSystemState(), refreshNotifications()
     addEvent(text, kind)               — v2 mos: mahalliy toast o'rniga jim (lentaga yozilmaydi)
     renderEvents(), renderBell()       — v2 mos (bo'sh)

   Backend: GET /api/system/state, GET /api/notifications, POST /api/notifications/read
            (docs/V3_API.md). Hali yo'q bo'lsa (404) — /api/stats/feed dan zaxira.
   Hodisa: "camera:select" (detail: id) — bildirishnoma bosilganda xarita ochadi.
   ========================================================================== */
import { esc, state } from "../core/state.js";
import { icon, hydrateIcons } from "../core/icons.js";
import { popover, closePopovers, fmtTime, fmtDateShort, tooltip } from "../core/ui.js";

export const sysState = { state: "unknown", label: "Tekshirilmoqda", services: [], ok: null };
const notif = { items: [], unread: 0, counts: { all: 0, outage: 0, system: 0 }, type: "all", fallback: false };
const bars = [];

/* ---------- Sysbar ---------- */
export function mountSysbar(container, opts = {}) {
  const el = document.createElement("div");
  el.className = "sysbar" + (opts.flat ? " sysbar--flat" : "");
  el.innerHTML =
    '<button class="badge sysbar__state" data-status="unknown"><span class="dot"></span><span class="sysbar__label">Tekshirilmoqda</span></button>' +
    '<span class="sysbar__div"></span>' +
    '<span class="sysbar__clock"><span class="sysbar__time">--:--:--</span><span class="sysbar__date"></span></span>' +
    '<span class="bell"><button class="icon-btn bell__btn" aria-haspopup="dialog">' + icon("bell") + "</button>" +
      '<span class="bell__badge" hidden></span></span>';
  container.appendChild(el);
  el.querySelector(".bell__btn").addEventListener("click", (e) => openNotifications(e.currentTarget));
  el.querySelector(".sysbar__state").addEventListener("click", () => {
    if (state.admin && state.admin.role === "admin") {
      location.hash = "#settings/status";
    }
  });
  bars.push(el);
  paintBars();
  tick();
  return el;
}

function tick() {
  const d = new Date();
  bars.forEach((b) => {
    b.querySelector(".sysbar__time").textContent = fmtTime(d);
    b.querySelector(".sysbar__date").textContent = fmtDateShort(d);
  });
}
setInterval(tick, 1000);

const STATUS = { ok: "online", degraded: "no-video", down: "offline", unknown: "unknown", noconn: "offline" };

function paintBars() {
  const st = state.apiOk === false ? "noconn" : sysState.state;
  const label = state.apiOk === false ? "Aloqa yoʻq" : sysState.label;
  const unread = notif.unread;
  bars.forEach((b) => {
    const s = b.querySelector(".sysbar__state");
    s.dataset.status = STATUS[st] || "unknown";
    s.querySelector(".sysbar__label").textContent = label;
    const bad = (sysState.services || []).filter((x) => x.state !== "ok").map((x) => x.name).join(", ");
    s.dataset.tip = bad ? "Muammo: " + bad : "Barcha xizmatlar faol";
    const badge = b.querySelector(".bell__badge");
    badge.hidden = !unread;
    badge.textContent = unread > 99 ? "99+" : unread;
    b.querySelector(".bell__btn").setAttribute("aria-label",
      "Bildirishnomalar" + (unread ? ", " + unread + " ta yangi" : ""));
    b.querySelector(".bell__btn").dataset.tip = "Bildirishnomalar";
  });
}

export async function refreshSystemState() {
  try {
    const r = await fetch("/api/system/state", { credentials: "same-origin" });
    if (r.ok) Object.assign(sysState, await r.json());
    else if (r.status === 404) {
      // Backend hali v3 emas — /health dan taxmin.
      const h = await fetch("/health").then((x) => x.json()).catch(() => null);
      Object.assign(sysState, h && h.ok !== false
        ? { state: "ok", label: "Tizim barqaror", services: [] }
        : { state: "degraded", label: "Qisman nosozlik", services: [] });
    }
  } catch (e) { /* aloqa yo'q — state.apiOk ko'rsatadi */ }
  paintBars();
}

/* ---------- Bildirishnomalar ---------- */
export async function refreshNotifications() {
  if (!state.admin && !state.guest) { notif.unread = 0; paintBars(); return; }
  try {
    const r = await fetch("/api/notifications?type=" + notif.type + "&limit=50", { credentials: "same-origin" });
    if (r.ok) {
      Object.assign(notif, await r.json(), { fallback: false });
    } else if (r.status === 404) {
      await loadFallback();
    }
  } catch (e) { /* jim */ }
  paintBars();
  if (openEl) renderList();
}

/* Zaxira: v2 backend — /api/stats/feed (o'qilganlik yo'q, hammasi o'qilgan). */
async function loadFallback() {
  const r = await fetch("/api/stats/feed?limit=50", { credentials: "same-origin" });
  if (!r.ok) return;
  const j = await r.json();
  const rows = (j.items || j.events || j || []);
  notif.items = rows.map((e) => ({
    id: "e" + e.id, type: e.kind === "offline" ? "offline" : "online",
    title: e.name + (e.kind === "offline" ? " uzildi" : " qayta ulandi"),
    text: e.region || "", ts: e.ts, camera_id: e.camera_id || e.id_camera || null,
    severity: e.kind === "offline" ? "error" : "success", read: true,
  })).sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  notif.unread = 0;
  notif.counts = { all: notif.items.length, outage: notif.items.length, system: 0 };
  notif.fallback = true;
}

let openEl = null;

function openNotifications(anchor) {
  const el = popover(anchor, '<div class="notif"></div>', {
    place: "bottom-end", cls: "popover--bare", onClose: () => { openEl = null; },
  });
  if (!el) return;
  openEl = el.querySelector(".notif");
  renderList();
  refreshNotifications();
}

const SEV_ICON = { error: "camera-slash", success: "camera", warning: "triangle-exclamation", info: "circle-info" };

function dayKey(ts) {
  const d = new Date(ts), now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= start) return "Bugun";
  if (d.getTime() >= start - 86400000) return "Kecha";
  return "Oldin";
}

function renderList() {
  if (!openEl) return;
  const c = notif.counts || {};
  const items = notif.items.filter((n) => notif.type === "all" ||
    (notif.type === "outage" ? n.type !== "system" : n.type === "system"));
  let html = '<div class="notif__head"><div class="notif__title">' +
    '<span class="heading-sm">Bildirishnomalar</span>' +
    (notif.unread ? '<span class="badge badge--count badge--solid">' + notif.unread + "</span>" : "") +
    '<span class="spacer"></span>' +
    (notif.unread ? '<button class="label-sm t-brand" id="nf-readall">Hammasi oʻqildi</button>' : "") +
    "</div>" +
    '<div class="seg" role="tablist">' +
      seg("all", "Hammasi", c.all) + seg("outage", "Uzilishlar", c.outage) + seg("system", "Tizim", c.system) +
    "</div></div><div class=\"notif__list\">";
  let last = "";
  if (!items.length) {
    html += '<div class="empty"><div class="empty__icon">' + icon("bell", "lg") +
      '</div><div class="empty__title">Bildirishnoma yoʻq</div></div>';
  }
  items.forEach((n) => {
    const g = dayKey(n.ts);
    if (g !== last) { html += '<div class="notif__group overline">' + g + "</div>"; last = g; }
    const d = new Date(n.ts);
    html += '<button class="notif__item' + (n.read ? "" : " is-unread") + '" data-id="' + esc(n.id) + '"' +
      (n.camera_id ? ' data-cam="' + n.camera_id + '"' : "") + ">" +
      '<span class="notif__ic" data-sev="' + esc(n.severity || "info") + '">' + icon(SEV_ICON[n.severity] || "circle-info", "sm") + "</span>" +
      '<span class="notif__txt"><span class="notif__t">' + esc(n.title) + '</span><span class="notif__s">' + esc(n.text || "") + "</span></span>" +
      '<span class="notif__meta"><span class="notif__time">' + String(d.getHours()).padStart(2, "0") + ":" +
        String(d.getMinutes()).padStart(2, "0") + "</span>" + (n.read ? "" : '<span class="dot dot--brand"></span>') + "</span>" +
      "</button>";
  });
  html += '</div><div class="notif__foot"><button class="label-sm t-brand" id="nf-all">Barcha hodisalar →</button></div>';
  openEl.innerHTML = html;
  tooltip.label(openEl);
  openEl.querySelectorAll("[data-type]").forEach((b) => b.addEventListener("click", () => {
    notif.type = b.dataset.type;
    renderList();
    refreshNotifications();
  }));
  const ra = openEl.querySelector("#nf-readall");
  if (ra) ra.addEventListener("click", () => markRead({ all: true }));
  openEl.querySelector("#nf-all").addEventListener("click", () => { closePopovers(); location.hash = "#dash"; });
  openEl.querySelectorAll(".notif__item").forEach((b) => b.addEventListener("click", () => {
    const n = notif.items.find((x) => String(x.id) === b.dataset.id);
    if (n && !n.read) markRead({ ids: [n.id] });
    closePopovers();
    if (b.dataset.cam) document.dispatchEvent(new CustomEvent("camera:select", { detail: { id: Number(b.dataset.cam) } }));
  }));
}

function seg(type, label, n) {
  return '<button data-type="' + type + '" class="' + (notif.type === type ? "is-on" : "") + '">' + label +
    (n != null ? ' <span class="seg__count">' + n + "</span>" : "") + "</button>";
}

async function markRead(body) {
  if (notif.fallback) return;
  if (body.all) notif.items.forEach((n) => { n.read = true; });
  else notif.items.forEach((n) => { if (body.ids.includes(n.id)) n.read = true; });
  notif.unread = notif.items.filter((n) => !n.read).length;
  paintBars();
  renderList();
  try {
    const r = await fetch("/api/notifications/read", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (r.ok) { const j = await r.json(); if (typeof j.unread === "number") notif.unread = j.unread; paintBars(); }
  } catch (e) {}
}

/* Davriy yangilash: tizim holati va bildirishnomalar (Sozlamalar → Kuzatuv, standart 30 s). */
let pollTimer = null;
export function startShellPolling(seconds = 30) {
  clearInterval(pollTimer);
  const run = () => { refreshSystemState(); refreshNotifications(); };
  run();
  pollTimer = setInterval(run, Math.max(10, seconds) * 1000);
}
document.addEventListener("api:status", paintBars);

/* ---------- v2 mosligi ---------- */
export function addEvent() {}
export function renderEvents() {}
export function renderBell() { paintBars(); }
hydrateIcons(document);
