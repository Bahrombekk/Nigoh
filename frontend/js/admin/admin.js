/* ==========================================================================
   admin/admin.js — 05 Boshqaruv: kameralar jadvali va Media sozlamalari
   --------------------------------------------------------------------------
   Vazifasi (Figma "Nigoh vision" 05.01–05.04, 05.08, 05.10, 05.15, 05.16):
     - Sarlavha "Kameralar" + Toolbar / Tizim (sysbar).
     - Toolbar: holat chiplari (Hammasi / Onlayn / Uzilgan / Tasvirsiz /
       Oʻchirilgan — ko'p tanlovli, sahifadagi YAGONA sonlar), qidiruv ("/"),
       "Filtr" popover'i (Hudud / Kodek / Rejim, "Filtr · N"), Eksport menyusi,
       "⋯ Koʻproq" (NVR ochish, Media sozlamalari), Primary "Kamera qoʻshish".
     - Jadval: checkbox, Holat, Kamera, Hudud, Oqim manzili (hover — to'liq +
       nusxalash), Kodek, Rejim, Amallar (⋯; hover/tanlanganda ✎ va ▶).
       Saralash serverda; 52px qator; qator bosilsa — tahrirlash drawer'i.
     - Qator menyusi (E / T / M / ⌫), ommaviy tanlash paneli, sahifalash,
       bo'sh holat ("Bu filtrda kamera yoʻq").
     - O'chirish: tasdiqlash dialogi → toast "Kamera oʻchirildi · Qaytarish" (10 s).
     - MediaMTX konfiguratsiyasi oynasi (#mtx-modal).

   Eksport:
     AdminTable, adminTable        — jadval
     MediaMtxPanel, mediaMtxPanel  — Media sozlamalari oynasi
     loadAdminCameras(offset)      — jadvalni qayta yuklash (data.js polling ham chaqiradi)
     openMediaMtx(), openNvr()     — ⋯ menyusi amallari
     camUiStatus(cam), STATUS_LABEL, codecLabel(cam), streamAddr(cam), streamUrl(cam),
     probeCamera(cam, overrides)   — camera-form.js ham ishlatadi (funksiya e'lonlari:
                                     aylanma importda ham tayyor)

   Bog'liqliklar:
     import: ../core/state.js, ../core/api.js, ../core/icons.js, ../core/ui.js,
             ../core/modals.js, ../core/data.js (loadCameras),
             ../layout/tabs.js (showTab), ../layout/notifications.js (mountSysbar),
             ./camera-form.js (openCameraForm, openCameraDrawer), ./nvr.js (nvrImport — dinamik emas)
   DOM: #admin-view ichidagi #ad-*, #admin-*, #adm-*, #new-cam, #sync-btn, #nvr-btn;
        #mtx-modal, #mtx-text, #mtx-lead, #mtx-apply
   Backend (docs/V3_API.md §5):
     GET  /api/admin/cameras?q&status&region&codec&mode&sort&offset&limit
          → {total, cameras, counts?, facets?}
     DELETE /api/admin/cameras/{id} → 204 (eski) | {id, restore_until} (yumshoq)
     POST /api/admin/cameras/{id}/restore, POST /api/admin/cameras/bulk
     GET  /api/admin/cameras/export?format=csv|xlsx, POST /api/admin/probe
     GET  /api/groups, POST /api/groups/{id}/cameras, GET /api/admin/regions
     GET  /api/admin/mediamtx/config, POST /api/admin/mediamtx/sync

   Qoidalar / tuzoqlar:
     - Javobda `counts` bo'lsa — server filtrlaydi ("server" rejimi). Yo'q bo'lsa
       (eski backend) — butun ro'yxat 500 talab olinadi va filtr/saralash/sonlar
       brauzerda hisoblanadi ("client" rejimi). UI ikkala holatda bir xil.
     - Kodek filtri qiymatlari: h264 | h265 | transcode; rejim: ondemand | always.
     - Yumshoq o'chirish yo'q (DELETE 204) bo'lsa "Qaytarish" ko'rsatilmaydi;
       bulk endpoint 404/405 bo'lsa — bittalab so'rovlar.
     - data.js har 30 s loadAdminCameras() ni chaqiradi: menyu ochiq yoki
       ma'lumot o'zgarmagan bo'lsa jadval qayta chizilmaydi (hover/fokus yo'qolmasin).
   ========================================================================== */
import { $, esc, state, toast } from "../core/state.js";
import { api, ApiError } from "../core/api.js";
import { icon, hydrateIcons } from "../core/icons.js";
import { confirmDialog, menu, popover, closePopovers, emptyState, delayed, onShortcut, debounce, tooltip } from "../core/ui.js";
import { closeModal, openModal } from "../core/modals.js";
import { loadCameras } from "../core/data.js";
import { showTab } from "../layout/tabs.js";
import { mountSysbar } from "../layout/notifications.js";
import { openCameraForm } from "./camera-form.js";

/* ---------- Umumiy yordamchilar (camera-form.js ham ishlatadi) ---------- */
export const STATUS_LABEL = { online: "Onlayn", "no-video": "Tasvirsiz", offline: "Uzilgan",
                              disabled: "Oʻchirilgan", unknown: "Nomaʼlum" };
const API_TO_UI = { online: "online", stalled: "no-video", offline: "offline", disabled: "disabled", unknown: "unknown" };
const STATE_RANK = { online: 0, stalled: 1, offline: 2, unknown: 3, disabled: 4 };

/* Backend holati: admin yozuvida `state`, bo'lmasa ochiq ro'yxatdagi `online`. */
export function camApiState(cam) {
  if (!cam.enabled) return "disabled";
  if (cam.state && API_TO_UI[cam.state]) return cam.state;
  const pub = state.byId.get(cam.id);
  if (pub && pub.online === true) return "online";
  if (pub && pub.online === false) return "offline";
  return "unknown";
}
export function camUiStatus(cam) { return API_TO_UI[camApiState(cam)] || "unknown"; }

export function codecKind(cam) {
  if (cam.transcode) return "transcode";
  if (/h265|hevc/i.test(cam.codec || "")) return "h265";
  if (/h264|avc/i.test(cam.codec || "")) return "h264";
  return "";
}
export function codecLabel(cam) {
  const k = codecKind(cam);
  if (k === "transcode") return "H.265 → H.264";
  if (k === "h265") return "H.265";
  if (k === "h264") return "H.264";
  return cam.codec ? String(cam.codec) : "—";
}
export function modeLabel(cam) { return cam.always_on ? "Doim tayyor" : "Soʻrov boʻyicha"; }

/* Jadvaldagi manzil (sxemasiz, parolsiz): "10.30.33.60:554/cam/realmonitor?…" */
export function streamAddr(cam) {
  if (cam.source_type === "rtsp") {
    if (!cam.ip) return "";
    let p = cam.rtsp_path || "";
    if (p && !p.startsWith("/")) p = "/" + p;
    return cam.ip + ":" + (cam.port || 554) + p;
  }
  return cam.raw_stream_url || "";
}
/* Nusxalanadigan to'liq manzil (login/parolsiz). */
export function streamUrl(cam) {
  const a = streamAddr(cam);
  if (!a) return "";
  return cam.source_type === "rtsp" ? "rtsp://" + a : a;
}

/* Ulanishni tekshirish (saqlangan parol bilan). → {ok, message, codec, resolution, fps, ms} */
export async function probeCamera(cam, over = {}) {
  const t0 = performance.now();
  const r = await api("/api/admin/probe", {
    method: "POST",
    body: JSON.stringify(Object.assign({
      ip: cam.ip, port: cam.port || 554, username: cam.username || "",
      password: null, rtsp_path: cam.rtsp_path || "/", camera_id: cam.id || null,
    }, over)),
  });
  return Object.assign({ ms: performance.now() - t0 }, r);
}
export function fmtSec(ms) { return (ms / 1000).toFixed(1).replace(".", ",") + " s"; }
export function fmtRes(res) {
  const m = /(\d+)\s*x\s*(\d+)/i.exec(res || "");
  return m ? m[2] + "p" : (res || "");
}

/* 404/405 — endpoint hali yo'q (eski backend). */
function missing(e) { return e instanceof ApiError && (e.status === 404 || e.status === 405); }

/* N ta ishni cheklangan parallellikda bajarish. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const run = async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
  return out;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e2) { /* jim */ }
    ta.remove();
  }
}

const CHIPS = [
  { key: "", label: "Hammasi" },
  { key: "online", label: "Onlayn", ui: "online" },
  { key: "offline", label: "Uzilgan", ui: "offline" },
  { key: "stalled", label: "Tasvirsiz", ui: "no-video" },
  { key: "disabled", label: "Oʻchirilgan", ui: "disabled", hideZero: true },
];
const CODECS = [
  { v: "h264", label: "H.264" },
  { v: "h265", label: "H.265" },
  { v: "transcode", label: "H.265 → H.264" },
];
const MODES = [
  { v: "ondemand", label: "Soʻrov boʻyicha" },
  { v: "always", label: "Doim tayyor" },
];

/* ---------- Boshqaruv jadvali ---------- */
export class AdminTable {
  constructor() {
    this.q = "";
    this.statuses = new Set();            // online | offline | stalled | disabled
    this.filters = { region: "", codec: "", mode: "" };
    this.sort = "name";                    // name | -name | region | -region | state | -state
    this.offset = 0;
    this.size = 50;
    this.mode = "unknown";                 // server | client
    this.idFilter = null;                  // { ids: Set, label } — Dashboard → Maʼlumot sifati ishorasi
    this.all = null;                       // client rejimida butun ro'yxat
    this.rows = [];
    this.total = 0;
    this.counts = null;
    this.regions = [];
    this.selected = new Map();             // id → kamera (sahifalar orasida saqlanadi)
    this.seq = 0;
    this.sig = "";
    this.menuFor = null;
    this.loaded = false;
    this.bind();
  }

  bind() {
    mountSysbar($("ad-sysbar"));
    hydrateIcons($("admin-view"));

    const search = $("admin-search");
    const wrap = $("ad-search");
    const go = debounce(() => { this.q = search.value.trim(); this.load(0); }, 300);
    search.addEventListener("input", () => { wrap.classList.toggle("is-filled", !!search.value); go(); });
    $("ad-search-clear").addEventListener("click", (e) => {
      e.preventDefault();
      search.value = ""; wrap.classList.remove("is-filled");
      this.q = ""; this.load(0); search.focus();
    });
    onShortcut("/", () => {
      if (state.tab !== "admin") return false;
      search.focus(); search.select();
    });

    $("ad-filter").addEventListener("click", (e) => this.openFilter(e.currentTarget));
    $("ad-export").addEventListener("click", (e) => this.openExport(e.currentTarget));
    $("ad-more").addEventListener("click", (e) => menu(e.currentTarget, [
      { label: "Registratordan qoʻshish", icon: "server", onClick: () => openNvr() },
      { label: "Media sozlamalari", icon: "gear", onClick: () => openMediaMtx() },
    ], { place: "bottom-end", width: 240 }));
    $("new-cam").addEventListener("click", () => openCameraForm(null));
    $("nvr-btn").addEventListener("click", () => openNvr());

    $("adm-size").addEventListener("change", (e) => { this.size = Number(e.target.value) || 50; this.load(0); });
    $("adm-prev").addEventListener("click", () => this.load(Math.max(0, this.offset - this.size)));
    $("adm-next").addEventListener("click", () => this.load(this.offset + this.size));

    document.querySelectorAll("#admin-table th.sortable").forEach((th) =>
      th.addEventListener("click", () => {
        const k = th.dataset.sort;
        this.sort = this.sort === k ? "-" + k : k;
        this.load(0);
      }));

    $("ad-check-all").addEventListener("change", (e) => {
      const on = e.target.checked;
      this.rows.forEach((c) => { if (on) this.selected.set(c.id, c); else this.selected.delete(c.id); });
      this.paintSelection();
    });

    /* Jadval hodisalari — bitta tinglovchi (qatorlar tez-tez qayta chiziladi). */
    const tbody = $("admin-tbody");
    tbody.addEventListener("click", (e) => this.onRowClick(e));
    tbody.addEventListener("change", (e) => {
      const cb = e.target.closest(".ad-row-check");
      if (!cb) return;
      const cam = this.camOf(cb);
      if (!cam) return;
      if (cb.checked) this.selected.set(cam.id, cam); else this.selected.delete(cam.id);
      this.paintSelection();
    });
    tbody.addEventListener("keydown", (e) => {
      const tr = e.target.closest("tr[data-id]");
      if (!tr || e.target !== tr) return;
      const cam = this.camOf(tr);
      if (!cam) return;
      if (e.key === "Enter") { e.preventDefault(); openCameraForm(cam); return; }
      if (this.shortcut(e, cam)) e.preventDefault();
    });

    /* Ommaviy panel */
    $("ad-bulk-close").addEventListener("click", () => this.clearSelection());
    $("ad-bulk-wall").addEventListener("click", () => this.addToWall([...this.selected.values()]));
    $("ad-bulk-group").addEventListener("click", (e) => this.openGroupMenu(e.currentTarget, [...this.selected.values()]));
    $("ad-bulk-test").addEventListener("click", () => this.bulkTest([...this.selected.values()]));
    $("ad-bulk-del").addEventListener("click", () => this.deleteCameras([...this.selected.values()]));

    document.addEventListener("page:escape", (e) => {
      if (state.tab !== "admin" || !this.selected.size) return;
      this.clearSelection();
      e.preventDefault();
    });
  }

  /* ---------- So'rov parametrlari ---------- */
  params(withPage) {
    const p = new URLSearchParams();
    if (this.q) p.set("q", this.q);
    if (this.statuses.size) p.set("status", [...this.statuses].join(","));
    Object.entries(this.filters).forEach(([k, v]) => { if (v) p.set(k, v); });
    if (this.sort) p.set("sort", this.sort);
    if (withPage) { p.set("offset", this.offset); p.set("limit", this.size); }
    return p.toString();
  }

  activeFilterCount() { return Object.values(this.filters).filter(Boolean).length; }
  hasAnyFilter() { return !!(this.q || this.statuses.size || this.activeFilterCount() || this.idFilter); }

  /* Server bilmaydigan filtrlar (aniq kameralar ro'yxati, "H.265 → H.264")
     brauzerda — butun ro'yxat bo'yicha — qo'llanadi. */
  needsClient() { return !!this.idFilter || this.filters.codec === "transcode"; }

  /* Boshqa sahifadan kelgan ishora (state.adminFilters): Dashboard "Diqqat
     talab qiladi → Barchasi" (status) va "Maʼlumot sifati" qatori (ids). Bir marta olinadi. */
  consumeHint() {
    const f = state.adminFilters || {};
    if (!f.status && !(f.ids && f.ids.length)) return;
    if (f.status) this.statuses = new Set([f.status]);
    if (f.ids && f.ids.length) {
      const h = state.adminFilterHint || {};
      this.idFilter = { ids: new Set(f.ids.map(Number)), label: h.label || "Tanlangan kameralar" };
    }
    state.adminFilters = { status: "", region: "", codec: "", mode: "" };
    state.adminFilterHint = null;
  }

  /* ---------- Yuklash ---------- */
  async load(offset) {
    // Joriy sahifani qayta so'rash (data.js polling) — skeleton'siz, o'zgarmasa chizilmaydi.
    const poll = this.loaded && (offset == null || offset === this.offset);
    if (offset != null) this.offset = Math.max(0, offset);
    const my = ++this.seq;
    const stopSk = poll ? () => {} : delayed(() => this.showSkeleton(), 300);
    try {
      if (this.mode !== "client" && !this.needsClient()) {
        const res = await api("/api/admin/cameras?" + this.params(true));
        if (my !== this.seq) return;
        if (res && res.counts) {
          this.mode = "server";
          this.applyServer(res);
        } else {
          this.mode = "client";
          await this.fetchAll(my);
          if (my !== this.seq) return;
          this.applyClient();
        }
      } else {
        await this.fetchAll(my);
        if (my !== this.seq) return;
        this.applyClient();
      }
      this.loaded = true;
      stopSk();
      this.render(poll);
    } catch (e) {
      stopSk();
      if (my !== this.seq) return;
      this.renderError(e);
    }
  }

  /* Eski backend: butun ro'yxat (limit 500 dan bo'lib). */
  async fetchAll(my) {
    const out = [];
    let total = Infinity;
    for (let off = 0; off < total; off += 500) {
      const res = await api("/api/admin/cameras?limit=500&offset=" + off);
      if (my !== this.seq) return;
      total = res.total || 0;
      out.push(...(res.cameras || []));
      if (!res.cameras || !res.cameras.length) break;
    }
    this.all = out;
  }

  applyServer(res) {
    this.rows = res.cameras || [];
    this.total = res.total || 0;
    this.counts = res.counts;
    const f = res.facets || {};
    if (Array.isArray(f.regions) && f.regions.length) this.regions = f.regions.map(String);
    else if (!this.regions.length) this.regions = [...new Set(this.rows.map((c) => c.region).filter(Boolean))].sort();
    if (this.offset && this.offset >= this.total && this.total) { this.offset = Math.floor((this.total - 1) / this.size) * this.size; }
  }

  matchesQ(c, q) {
    if (!q) return true;
    const hay = [c.name, c.region, c.ip, c.ip ? c.ip + ":" + c.port : "", c.rtsp_path, c.raw_stream_url,
                 c.km != null ? String(c.km) : ""].join(" ").toLowerCase();
    return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
  }

  applyClient() {
    const all = this.all || [];
    const f = this.filters;
    const ids = this.idFilter && this.idFilter.ids;
    const base = all.filter((c) =>
      (!ids || ids.has(Number(c.id))) &&
      this.matchesQ(c, this.q) &&
      (!f.region || c.region === f.region) &&
      (!f.codec || codecKind(c) === f.codec) &&
      (!f.mode || (f.mode === "always") === !!c.always_on));
    const counts = { all: base.length, online: 0, offline: 0, stalled: 0, disabled: 0, unknown: 0 };
    base.forEach((c) => { counts[camApiState(c)] = (counts[camApiState(c)] || 0) + 1; });
    let list = this.statuses.size ? base.filter((c) => this.statuses.has(camApiState(c))) : base;

    const key = this.sort.replace(/^-/, "");
    const dir = this.sort.startsWith("-") ? -1 : 1;
    const coll = new Intl.Collator("uz", { numeric: true, sensitivity: "base" });
    const val = (c) => key === "state" ? STATE_RANK[camApiState(c)] : key === "codec" ? codecLabel(c) : String(c[key] || "");
    if (key) list = [...list].sort((a, b) => {
      const va = val(a), vb = val(b);
      const r = typeof va === "number" ? va - vb : coll.compare(va, vb);
      return dir * (r || coll.compare(a.name || "", b.name || ""));
    });

    this.counts = counts;
    this.total = list.length;
    if (this.offset >= this.total && this.total) this.offset = Math.floor((this.total - 1) / this.size) * this.size;
    this.filtered = list;
    this.rows = list.slice(this.offset, this.offset + this.size);
    this.regions = [...new Set(all.map((c) => c.region).filter(Boolean))].sort((a, b) => coll.compare(a, b));
  }

  /* ---------- Chizish ---------- */
  showSkeleton() {
    const tb = $("admin-tbody");
    let h = "";
    for (let i = 0; i < 8; i++) {
      h += '<tr class="ad-sk"><td></td><td><span class="skeleton" style="width:64px;height:16px"></span></td>' +
        '<td><span class="skeleton" style="width:' + (90 + (i * 23) % 60) + 'px;height:12px"></span></td>' +
        '<td><span class="skeleton" style="width:80px;height:12px"></span></td>' +
        '<td><span class="skeleton" style="width:' + (160 + (i * 37) % 90) + 'px;height:10px"></span></td>' +
        '<td><span class="skeleton" style="width:56px;height:14px"></span></td>' +
        '<td><span class="skeleton" style="width:90px;height:12px"></span></td><td></td></tr>';
    }
    tb.innerHTML = h;
    $("ad-empty").hidden = true;
  }

  render(poll) {
    state.adminOffset = this.offset;
    state.adminTotal = this.total;
    state.adminCameras = this.rows;
    this.renderChips();
    this.renderFilterBtn();
    this.renderSortHeads();

    // Polling: menyu ochiq bo'lsa yoki hech narsa o'zgarmagan bo'lsa jadvalga tegmaymiz.
    const sig = JSON.stringify([this.rows.map((c) => [c.id, c.name, c.region, camApiState(c), c.codec, c.transcode,
      c.always_on, streamAddr(c)]), this.total, this.offset]);
    if (poll && (this.menuFor || sig === this.sig)) { this.renderPager(); return; }
    this.sig = sig;

    // Tanlangan kameralarning yozuvini yangilaymiz (sahifadagilari).
    this.rows.forEach((c) => { if (this.selected.has(c.id)) this.selected.set(c.id, c); });

    const tb = $("admin-tbody");
    const empty = $("ad-empty");
    if (!this.rows.length) {
      tb.innerHTML = "";
      empty.hidden = false;
      const filtered = this.hasAnyFilter();
      empty.innerHTML = filtered
        ? emptyState({ type: "filter", title: "Bu filtrda kamera yoʻq",
                       text: this.filterSummary() + " — mos kamera topilmadi", action: "Filtrlarni tozalash", id: "ad-clear-all" })
        : emptyState({ type: "nodata", title: "Hali kamera yoʻq", text: "Birinchi kamerani qoʻshing",
                       action: "Kamera qoʻshish", primary: true, id: "ad-empty-add" });
      const b = empty.querySelector("button");
      if (b) b.addEventListener("click", () => filtered ? this.clearFilters() : openCameraForm(null));
      $("admin-foot").hidden = true;
      $("admin-view").classList.add("is-empty");
    } else {
      empty.hidden = true;
      $("admin-foot").hidden = false;
      $("admin-view").classList.remove("is-empty");
      tb.innerHTML = this.rows.map((c) => this.rowHtml(c)).join("");
      tooltip.label(tb);
    }
    this.renderPager();
    this.paintSelection();
  }

  renderError(e) {
    $("admin-tbody").innerHTML = "";
    const empty = $("ad-empty");
    empty.hidden = false;
    empty.innerHTML = emptyState({ type: "triangle-exclamation", title: "Roʻyxat yuklanmadi",
                                   text: e && e.message ? e.message : "Server javob bermadi", action: "Qayta urinish", id: "ad-retry" });
    empty.querySelector("button").addEventListener("click", () => this.load(this.offset));
    $("admin-foot").hidden = true;
  }

  filterSummary() {
    const parts = [];
    if (this.idFilter) parts.push(this.idFilter.label);
    if (this.statuses.size) parts.push(CHIPS.filter((c) => this.statuses.has(c.key)).map((c) => c.label).join(", "));
    if (this.filters.region) parts.push(this.filters.region);
    if (this.filters.codec) parts.push((CODECS.find((c) => c.v === this.filters.codec) || {}).label);
    if (this.filters.mode) parts.push((MODES.find((c) => c.v === this.filters.mode) || {}).label);
    if (this.q) parts.push("«" + this.q + "»");
    return parts.join(" · ");
  }

  renderChips() {
    const counts = this.counts || {};
    const box = $("ad-chips");
    box.innerHTML = CHIPS.map((ch) => {
      const n = ch.key ? (counts[ch.key] || 0) : (counts.all || 0);
      const on = ch.key ? this.statuses.has(ch.key) : !this.statuses.size;
      if (ch.hideZero && !n && !on) return "";
      return '<button type="button" class="chip' + (on ? " is-on" : "") + '" data-st="' + ch.key + '" aria-pressed="' + on + '">' +
        (ch.ui ? '<span class="dot" data-status="' + ch.ui + '"></span>' : "") +
        esc(ch.label) + '<span class="chip__count">' + n + "</span></button>";
    }).join("") + (this.idFilter
      ? '<button type="button" class="chip is-on" data-idf aria-label="Filtrni olib tashlash" data-tip="Filtrni olib tashlash">' +
        esc(this.idFilter.label) + '<span class="chip__count">' + this.idFilter.ids.size + "</span>" + icon("xmark", "xs") + "</button>"
      : "");
    const idf = box.querySelector("[data-idf]");
    if (idf) idf.addEventListener("click", () => { this.idFilter = null; this.load(0); });
    box.querySelectorAll(".chip:not([data-idf])").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.st;
      if (!k) this.statuses.clear();
      else if (this.statuses.has(k)) this.statuses.delete(k);
      else this.statuses.add(k);
      this.load(0);
    }));
  }

  renderFilterBtn() {
    const n = this.activeFilterCount();
    $("ad-filter-label").textContent = n ? "Filtr · " + n : "Filtr";
    $("ad-filter").classList.toggle("is-active", n > 0);
  }

  renderSortHeads() {
    const key = this.sort.replace(/^-/, "");
    const desc = this.sort.startsWith("-");
    document.querySelectorAll("#admin-table th.sortable").forEach((th) => {
      const on = th.dataset.sort === key;
      th.classList.toggle("is-sorted", on);
      th.setAttribute("aria-sort", on ? (desc ? "descending" : "ascending") : "none");
      const s = th.querySelector(".ad-sort");
      s.innerHTML = icon(on ? (desc ? "sort-down" : "sort-up") : "sort", "xs");
    });
  }

  renderPager() {
    const total = this.total;
    const from = total ? this.offset + 1 : 0;
    const to = Math.min(this.offset + this.size, total);
    $("admin-count").textContent = from + "–" + to + " / " + total + " kamera";
    $("adm-prev").disabled = this.offset === 0;
    $("adm-next").disabled = this.offset + this.size >= total;
    const pages = Math.max(1, Math.ceil(total / this.size));
    const cur = Math.floor(this.offset / this.size);
    const want = new Set([0, pages - 1, cur, cur - 1, cur + 1]);
    if (cur <= 2) [1, 2, 3].forEach((i) => want.add(i));
    if (cur >= pages - 3) [pages - 2, pages - 3, pages - 4].forEach((i) => want.add(i));
    const list = [...want].filter((i) => i >= 0 && i < pages).sort((a, b) => a - b);
    let h = "", prev = -1;
    list.forEach((i) => {
      if (prev >= 0 && i - prev > 1) h += '<span class="ad-pages__gap">…</span>';
      h += '<button type="button" class="ad-page' + (i === cur ? " is-on" : "") + '" data-pg="' + i + '"' +
        (i === cur ? ' aria-current="page"' : "") + ">" + (i + 1) + "</button>";
      prev = i;
    });
    const box = $("adm-pages");
    box.innerHTML = h;
    box.querySelectorAll("[data-pg]").forEach((b) =>
      b.addEventListener("click", () => this.load(Number(b.dataset.pg) * this.size)));
    $("adm-size").value = String(this.size);
  }

  rowHtml(c) {
    const st = camUiStatus(c);
    const addr = streamAddr(c);
    const full = streamUrl(c);
    const sel = this.selected.has(c.id);
    const canTest = c.source_type === "rtsp" && !!c.ip;
    return '<tr data-id="' + c.id + '" tabindex="0"' + (sel ? ' class="is-selected"' : "") + ">" +
      '<td class="ad-c-check"><input type="checkbox" class="check ad-row-check" aria-label="' + esc(c.name) + ' — tanlash"' + (sel ? " checked" : "") + "></td>" +
      '<td><span class="badge" data-status="' + st + '"><span class="dot" data-status="' + st + '"></span>' + STATUS_LABEL[st] + "</span></td>" +
      '<td><span class="ad-name ellipsis" title="' + esc(c.name) + '">' + esc(c.name) + "</span></td>" +
      '<td><span class="ellipsis">' + esc(c.region || "—") + "</span></td>" +
      '<td class="ad-c-url">' + (addr
        ? '<span class="ad-url"><span class="ad-url__t mono-xs ellipsis" data-tip="' + esc(full) + '">' + esc(addr) + "</span>" +
          '<button type="button" class="ad-url__copy" data-act="copy" data-tip="Nusxalash" aria-label="Oqim manzilini nusxalash">' + icon("copy", "xs") + "</button></span>"
        : '<span class="t-tertiary">—</span>') + "</td>" +
      '<td><span class="codec-tag">' + esc(codecLabel(c)) + "</span></td>" +
      '<td><span class="ellipsis">' + modeLabel(c) + "</span></td>" +
      '<td class="ad-c-act"><span class="ad-acts">' +
        '<button type="button" class="icon-btn icon-btn--sm ad-hover-act" data-act="edit" data-tip="Tahrirlash">' + icon("pen", "sm") + "</button>" +
        '<button type="button" class="icon-btn icon-btn--sm ad-hover-act" data-act="test" data-tip="Ulanishni tekshirish"' + (canTest ? "" : " disabled") + ">" + icon("play", "sm") + "</button>" +
        '<button type="button" class="icon-btn icon-btn--sm" data-act="menu" data-tip="Amallar" aria-haspopup="menu">' + icon("dots-horizontal", "sm") + "</button>" +
      "</span></td></tr>";
  }

  camOf(el) {
    const tr = el.closest("tr[data-id]");
    if (!tr) return null;
    const id = Number(tr.dataset.id);
    return this.rows.find((c) => c.id === id) || this.selected.get(id) || null;
  }

  onRowClick(e) {
    const cam = this.camOf(e.target);
    if (!cam) return;
    if (e.target.closest(".ad-c-check")) {
      if (!e.target.closest(".ad-row-check")) { const cb = e.target.closest("td").querySelector(".ad-row-check"); cb.click(); }
      return;
    }
    const act = e.target.closest("[data-act]");
    if (act) {
      e.stopPropagation();
      if (act.dataset.act === "edit") openCameraForm(cam);
      else if (act.dataset.act === "test") this.testCamera(cam);
      else if (act.dataset.act === "menu") this.openRowMenu(act, cam);
      else if (act.dataset.act === "copy") this.copyUrl(cam);
      return;
    }
    openCameraForm(cam);
  }

  /* ---------- Tanlov ---------- */
  paintSelection() {
    const ids = new Set(this.selected.keys());
    document.querySelectorAll("#admin-tbody tr[data-id]").forEach((tr) => {
      const on = ids.has(Number(tr.dataset.id));
      tr.classList.toggle("is-selected", on);
      const cb = tr.querySelector(".ad-row-check");
      if (cb) cb.checked = on;
    });
    const onPage = this.rows.filter((c) => ids.has(c.id)).length;
    const all = $("ad-check-all");
    all.checked = !!this.rows.length && onPage === this.rows.length;
    all.indeterminate = onPage > 0 && onPage < this.rows.length || (onPage === 0 && ids.size > 0);
    all.setAttribute("aria-checked", all.indeterminate ? "mixed" : String(all.checked));
    const n = ids.size;
    $("ad-bulk").hidden = !n;
    $("ad-bulk-n").textContent = n + " ta tanlandi";
    $("admin-view").classList.toggle("has-bulk", n > 0);
  }

  clearSelection() { this.selected.clear(); this.paintSelection(); }

  /* ---------- Toolbar popover/menyulari ---------- */
  openFilter(anchor) {
    const sel = (id, label, opts, val) =>
      '<label class="field"><span class="field__label">' + label + '</span><select class="select" id="' + id + '">' +
      opts.map((o) => '<option value="' + esc(o.v) + '"' + (o.v === val ? " selected" : "") + ">" + esc(o.label) + "</option>").join("") +
      "</select></label>";
    const regs = [...new Set([...this.regions, this.filters.region].filter(Boolean))];
    const html = '<div class="ad-filter-pop" role="dialog" aria-label="Filtr">' +
      sel("adf-region", "Hudud", [{ v: "", label: "Barcha hududlar" }, ...regs.map((r) => ({ v: r, label: r }))], this.filters.region) +
      sel("adf-codec", "Kodek", [{ v: "", label: "Barcha kodeklar" }, ...CODECS], this.filters.codec) +
      sel("adf-mode", "Rejim", [{ v: "", label: "Barcha rejimlar" }, ...MODES], this.filters.mode) +
      '<div class="ad-filter-pop__foot"><button type="button" class="btn btn--tertiary btn--sm" id="adf-clear">Tozalash</button></div></div>';
    const el = popover(anchor, html, { place: "bottom-end", width: 280 });
    if (!el) return;
    const apply = () => {
      this.filters = { region: $("adf-region").value, codec: $("adf-codec").value, mode: $("adf-mode").value };
      this.load(0);
    };
    ["adf-region", "adf-codec", "adf-mode"].forEach((id) => $(id).addEventListener("change", apply));
    $("adf-clear").addEventListener("click", () => {
      ["adf-region", "adf-codec", "adf-mode"].forEach((id) => { $(id).value = ""; });
      apply();
    });
    setTimeout(() => $("adf-region").focus(), 30);
  }

  clearFilters() {
    this.q = ""; this.statuses.clear(); this.filters = { region: "", codec: "", mode: "" }; this.idFilter = null;
    $("admin-search").value = ""; $("ad-search").classList.remove("is-filled");
    this.load(0);
  }

  openExport(anchor) {
    const items = [];
    if (this.mode === "server") items.push({ label: "Excel (.xlsx)", icon: "download", onClick: () => this.exportFile("xlsx") });
    items.push({ label: "CSV", icon: "download", onClick: () => this.exportFile("csv") });
    menu(anchor, items, { place: "bottom-end", width: 240 });
  }

  async exportFile(format) {
    if (this.mode === "server") {
      try {
        const res = await fetch("/api/admin/cameras/export?format=" + format + "&" + this.params(false), { credentials: "same-origin" });
        if (res.ok) {
          const blob = await res.blob();
          const cd = res.headers.get("Content-Disposition") || "";
          const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
          this.download(blob, m ? decodeURIComponent(m[1]) : "nigoh-kameralar." + format);
          toast("Eksport tayyor");
          return;
        }
        if (format === "xlsx" && res.status !== 404) { toast("Excel faylini yaratib boʻlmadi — CSV yuklandi", { tone: "info" }); }
      } catch (e) { /* pastda brauzerda CSV */ }
    }
    await this.exportCsvLocal();
  }

  async exportCsvLocal() {
    let rows;
    if (this.mode === "client") rows = this.filtered || [];
    else {
      rows = [];
      try {
        for (let off = 0; ; off += 500) {
          const p = new URLSearchParams(this.params(false));
          p.set("offset", off); p.set("limit", 500);
          const res = await api("/api/admin/cameras?" + p);
          rows.push(...(res.cameras || []));
          if (!res.cameras || !res.cameras.length || rows.length >= res.total) break;
        }
      } catch (e) { toast(e.message, { tone: "error" }); return; }
    }
    if (!rows.length) { toast("Eksport uchun kamera yoʻq", { tone: "info" }); return; }
    const head = ["Nomi", "Hudud", "Holat", "Oqim manzili", "Kodek", "Rejim", "Faol"];
    const cell = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const body = rows.map((c) => [c.name, c.region, STATUS_LABEL[camUiStatus(c)], streamUrl(c),
      codecLabel(c), modeLabel(c), c.enabled ? "ha" : "yoʻq"].map(cell).join(","));
    const blob = new Blob(["﻿" + [head.map(cell).join(","), ...body].join("\r\n")], { type: "text/csv;charset=utf-8" });
    this.download(blob, "nigoh-kameralar.csv");
    toast(rows.length + " ta kamera eksport qilindi");
  }

  download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- Qator menyusi (05.02) ---------- */
  rowItems(cam) {
    const canTest = cam.source_type === "rtsp" && !!cam.ip;
    return [
      { key: "e", label: "Tahrirlash", icon: "pen", kbd: "E", run: () => openCameraForm(cam) },
      { key: "t", label: "Ulanishni tekshirish", icon: "play", kbd: "T", disabled: !canTest, run: () => this.testCamera(cam) },
      { key: "m", label: "Xaritada koʻrsatish", icon: "map-pin", kbd: "M", run: () => this.showOnMap(cam) },
      { label: "Video devorga qoʻshish", icon: "grid", run: () => this.addToWall([cam]) },
      { label: "Oqim manzilini nusxalash", icon: "link", disabled: !streamUrl(cam), run: () => this.copyUrl(cam) },
      "sep",
      { key: "del", label: "Oʻchirish", icon: "trash", kbd: "⌫", danger: true, run: () => this.deleteCameras([cam]) },
    ];
  }

  shortcut(e, cam) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = e.key.toLowerCase();
    const key = k === "backspace" || k === "delete" ? "del" : k;
    const it = this.rowItems(cam).find((x) => x !== "sep" && x.key === key && !x.disabled);
    if (!it) return false;
    closePopovers();
    it.run();
    return true;
  }

  openRowMenu(anchor, cam) {
    const items = this.rowItems(cam).map((x) => x === "sep" ? x : Object.assign({}, x, { onClick: x.run }));
    const up = anchor.getBoundingClientRect().bottom + 270 > innerHeight;
    const tr = anchor.closest("tr");
    this.menuFor = cam.id;
    if (tr) tr.classList.add("is-menu");
    const el = menu(anchor, items, {
      place: up ? "top-end" : "bottom-end", width: 240,
      onClose: () => { this.menuFor = null; if (tr) tr.classList.remove("is-menu"); },
    });
    if (!el) { this.menuFor = null; if (tr) tr.classList.remove("is-menu"); return; }
    el.querySelector(".menu").setAttribute("aria-label", cam.name + " — amallar");
    el.addEventListener("keydown", (e) => { if (this.shortcut(e, cam)) { e.preventDefault(); e.stopPropagation(); } });
  }

  /* ---------- Amallar ---------- */
  showOnMap(cam) {
    const pub = state.byId.get(cam.id);
    if (!pub) { toast("Kamera xaritada koʻrinmaydi (oʻchirilgan)", { tone: "info" }); return; }
    if (!(cam.lat || pub.lat) || !(cam.lng || pub.lng)) toast("Bu kameraga koordinata kiritilmagan", { tone: "info" });
    document.dispatchEvent(new CustomEvent("camera:select", { detail: { id: cam.id } }));
  }

  addToWall(cams) {
    if (!cams.length) return;
    let added = 0;
    cams.forEach((c) => { if (!state.pinned.includes(c.id)) { state.pinned.push(c.id); added++; } });
    toast(cams.length === 1 ? "«" + cams[0].name + "» video devorga qoʻshildi"
                            : cams.length + " ta kamera video devorga qoʻshildi",
          { action: "Ochish", onAction: () => showTab("wall") });
    return added;
  }

  async copyUrl(cam) {
    const u = streamUrl(cam);
    if (!u) return;
    await copyText(u);
    toast("Oqim manzili nusxalandi");
  }

  async testCamera(cam) {
    if (cam.source_type !== "rtsp" || !cam.ip) { toast("Tayyor oqim manzilini tekshirib boʻlmaydi", { tone: "info" }); return; }
    const close = toast(cam.name + " · tekshirilmoqda…", { tone: "info", ms: 15000 });
    try {
      const r = await probeCamera(cam);
      close();
      if (r.ok) {
        toast(cam.name + " · ulanish barqaror · " + fmtSec(r.ms), {
          action: "Videoni ochish", ms: 6000,
          onAction: () => document.dispatchEvent(new CustomEvent("camera:select", { detail: { id: cam.id } })),
        });
      } else toast(cam.name + " · " + (r.message || "ulanmadi"), { tone: "error", ms: 6000 });
    } catch (e) {
      close();
      toast(cam.name + " · " + e.message, { tone: "error" });
    }
  }

  async bulk(action, cams) {
    try {
      const r = await api("/api/admin/cameras/bulk", { method: "POST", body: JSON.stringify({ action, ids: cams.map((c) => c.id) }) });
      return (r && r.results) || [];
    } catch (e) {
      if (!missing(e)) throw e;
      return null;                       // eski backend — bittalab
    }
  }

  async bulkTest(cams) {
    const list = cams.filter((c) => c.source_type === "rtsp" && c.ip);
    if (!list.length) { toast("Tanlanganlar orasida RTSP kamera yoʻq", { tone: "info" }); return; }
    const close = toast(list.length + " ta kamera tekshirilmoqda…", { tone: "info", ms: 60000 });
    try {
      let res = await this.bulk("test", list);
      if (!res) res = await pool(list, 4, async (c) => {
        try { const r = await probeCamera(c); return { id: c.id, ok: !!r.ok, detail: r.message }; }
        catch (e) { return { id: c.id, ok: false, detail: e.message }; }
      });
      close();
      const ok = res.filter((r) => r.ok).length;
      const bad = res.length - ok;
      const firstBad = res.find((r) => !r.ok);
      const name = firstBad ? (list.find((c) => c.id === firstBad.id) || {}).name : "";
      toast(bad ? ok + " tasi ulandi · " + bad + " tasida xato" + (name ? " (" + name + ": " + (firstBad.detail || "ulanmadi") + ")" : "")
                : "Hammasi ulandi · " + ok + " ta kamera",
            { tone: bad ? "error" : "success", ms: 8000 });
    } catch (e) { close(); toast(e.message, { tone: "error" }); }
  }

  async openGroupMenu(anchor, cams) {
    let groups = [];
    try { const r = await api("/api/groups"); groups = (r.groups || r || []).filter((g) => g.can_edit !== false); }
    catch (e) { toast("Guruhlar yuklanmadi: " + e.message, { tone: "error" }); return; }
    const items = groups.length
      ? [{ heading: "Guruhni tanlang" }, ...groups.map((g) => ({ label: g.name, icon: "layer-group", onClick: () => this.addToGroup(g, cams) }))]
      : [{ label: "Tahrirlanadigan guruh yoʻq", disabled: true }];
    menu(anchor, items, { place: "top-start", width: 240 });
  }

  async addToGroup(g, cams) {
    try {
      await api("/api/groups/" + g.id + "/cameras", { method: "POST", body: JSON.stringify({ camera_ids: cams.map((c) => c.id), mode: "add" }) });
      toast(cams.length + " ta kamera «" + g.name + "» guruhiga qoʻshildi");
    } catch (e) { toast(e.message, { tone: "error" }); }
  }

  async deleteCameras(cams) {
    if (!cams.length) return;
    const one = cams.length === 1;
    const ok = await confirmDialog({
      title: one ? "“" + cams[0].name + "” oʻchirilsinmi?" : cams.length + " ta kamera oʻchirilsinmi?",
      text: "Kamera xarita, video devor va hisobotlardan olib tashlanadi. Tarix 30 kun saqlanadi.",
      ok: "Oʻchirish", danger: true,
    });
    if (!ok) return;
    let done = [], soft = false, failed = [];
    try {
      const res = one ? null : await this.bulk("delete", cams);
      if (res) {
        done = cams.filter((c) => res.some((r) => r.id === c.id && r.ok));
        failed = res.filter((r) => !r.ok);
        soft = true;                      // bulk faqat yangi backendda — yumshoq o'chirish
      } else {
        const out = await pool(cams, 4, async (c) => {
          try { const r = await api("/api/admin/cameras/" + c.id, { method: "DELETE" }); return { c, ok: true, soft: !!(r && r.restore_until) }; }
          catch (e) { return { c, ok: false, detail: e.message }; }
        });
        done = out.filter((x) => x.ok).map((x) => x.c);
        soft = out.some((x) => x.soft);
        failed = out.filter((x) => !x.ok);
      }
    } catch (e) { toast(e.message, { tone: "error" }); return; }

    done.forEach((c) => this.selected.delete(c.id));
    this.paintSelection();
    await this.load(this.offset);
    loadCameras().catch(() => {});
    if (!done.length) { toast((failed[0] && failed[0].detail) || "Oʻchirilmadi", { tone: "error" }); return; }
    const msg = done.length === 1 ? "Kamera oʻchirildi" : done.length + " ta kamera oʻchirildi";
    toast(msg + (failed.length ? " · " + failed.length + " tasi oʻchirilmadi" : ""), soft
      ? { action: "Qaytarish", ms: 10000, onAction: () => this.restore(done) }
      : { ms: 4000 });
  }

  async restore(cams) {
    const out = await pool(cams, 4, async (c) => {
      try { await api("/api/admin/cameras/" + c.id + "/restore", { method: "POST" }); return true; }
      catch (e) { return missing(e) ? null : false; }
    });
    if (out.every((x) => x === null)) { toast("Qaytarish serverda hali yoʻq", { tone: "error" }); return; }
    const n = out.filter(Boolean).length;
    await this.load(this.offset);
    loadCameras().catch(() => {});
    toast(n ? (n === 1 ? "Kamera qaytarildi" : n + " ta kamera qaytarildi") : "Qaytarib boʻlmadi", { tone: n ? "success" : "error" });
  }
}

/* ---------- Media sozlamalari (MediaMTX) ---------- */
export class MediaMtxPanel {
  constructor() {
    $("sync-btn").addEventListener("click", () => this.show());
    $("mtx-apply").addEventListener("click", () => this.apply());
  }

  async show() {
    openModal("mtx-modal");
    $("mtx-text").textContent = "Yuklanmoqda…";
    try {
      const r = await api("/api/admin/mediamtx/config");
      $("mtx-text").textContent = r.text;
      $("mtx-lead").textContent = r.api_available
        ? "MediaMTX ishlab turibdi — oʻzgarishlar qayta ishga tushirmasdan qoʻllanadi."
        : "MediaMTX hozir ishlamayapti — fayl yoziladi, keyin MediaMTXʼni ishga tushiring.";
    } catch (e) {
      $("mtx-text").textContent = e.message;
    }
  }

  async apply() {
    $("mtx-apply").disabled = true;
    try {
      const r = await api("/api/admin/mediamtx/sync", { method: "POST" });
      closeModal("mtx-modal");
      toast(r.written + " ta kamera yozildi · " + r.live.message, { tone: r.live.ok ? "success" : "error" });
    } catch (e) {
      toast(e.message, { tone: "error" });
    }
    $("mtx-apply").disabled = false;
  }
}

export const adminTable = new AdminTable();
export const mediaMtxPanel = new MediaMtxPanel();

/* offset berilmasa (polling) — joriy sahifa jimgina yangilanadi. */
export function loadAdminCameras(offset) {
  if (offset === 0) adminTable.consumeHint();
  return adminTable.load(offset);
}
/* Sahifa ochilganda — birinchi sahifa (registerPage "admin"). */
export function showAdminPage() { return adminTable.load(0); }
export function openMediaMtx() { mediaMtxPanel.show(); }
export function openNvr() { document.dispatchEvent(new CustomEvent("admin:nvr")); }
