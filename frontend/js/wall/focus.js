/* ==========================================================================
   wall/focus.js — Fokus rejimi (Figma 04.02, `#wall/focus`)
   --------------------------------------------------------------------------
   Vazifasi:
     Bitta kamera katta (asosiy oqim) + yonida devor tartibidagi keyingi 3 ta
     (past oqim), pastda 4 KpiTile: Ochilish, Kodek, Uptime, Uzilishlar.
     ←/→ — oldingi/keyingi kamera (video-wall.js chaqiradi), Esc va
     "Devorga qaytish" — devorga (aylanish pozitsiyasi saqlanadi).

   Eksport:
     FocusView — klass: open(id), close(), refresh(), step(d), stop(), players(),
                 camId, active

   Bog'liqliklar:
     import: ../core/state.js ($, esc, state), ../core/api.js (api),
             ../core/icons.js (hydrateIcons), ../core/ui.js (infotip, tooltip),
             ./tile.js (WallTile va formatlar)
   DOM: #wall-focus, #wf-back, #wf-name, #wf-status, #wf-shot, #wf-map, #wf-fs,
        #wf-main, #wf-next, #wf-kpis
   Backend: GET /api/metrics/open?camera_id= (yangi; eski server — umumiy ro'yxat,
            kamera shu ro'yxatdan qidiriladi; bo'lmasa mahalliy o'lchov),
            GET /api/stats/cameras/{id}?days=7 (uptime_pct),
            GET /api/stats/cameras/{id}?from=YYYY-MM-DD (bugungi outages)

   Qoidalar / tuzoqlar:
     - KPI so'rovlari kamera almashganda eskiradi: `token` bilan tashlanadi.
     - Endpoint 404/409 bersa — "—" (UI buzilmaydi).
   ========================================================================== */
import { $, esc, state } from "../core/state.js";
import { api } from "../core/api.js";
import { hydrateIcons } from "../core/icons.js";
import { infotip, tooltip } from "../core/ui.js";
import { WallTile, STATUS_TEXT, camStatus, fmtCodec, fmtSec } from "./tile.js";

const NEXT_COUNT = 3;

const p2 = (n) => String(n).padStart(2, "0");
const todayIso = () => { const d = new Date(); return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); };
const pct = (v) => v == null ? "—" : (Math.round(v * 10) / 10).toFixed(1).replace(".", ",").replace(/,0$/, "") + "%";

/* "2560x1440" → "1440p" */
function fmtRes(res) {
  const m = String(res || "").match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/i);
  return m ? m[2] + "p" : "";
}

export class FocusView {
  /* wall: VideoWall — cams(), tileOpts(), onExit() */
  constructor(wall) {
    this.wall = wall;
    this.active = false;
    this.camId = null;
    this.main = null;
    this.next = new Map();
    this.token = 0;
    this.kpi = {};
    $("wf-back").addEventListener("click", () => wall.exitFocus());
    $("wf-shot").addEventListener("click", () => { const c = this.cam(); if (c) wall.snapshot(c); });
    $("wf-map").addEventListener("click", () => { const c = this.cam(); if (c) wall.showOnMap(c); });
    $("wf-fs").addEventListener("click", () => this.fullscreen());
  }

  cam() { return state.byId.get(this.camId); }

  players() {
    return [this.main, ...this.next.values()].filter((t) => t && t.player).map((t) => t.player);
  }

  open(id) {
    this.active = true;
    $("wall-focus").hidden = false;
    this.show(id);
  }

  show(id) {
    const cam = state.byId.get(id);
    if (!cam) return;
    const changed = id !== this.camId;
    this.camId = id;
    this.wall.rememberFocus(id);
    if (changed || !this.main) {
      if (this.main) this.main.stop();
      this.main = new WallTile(cam, { actions: false });
      this.main.el.classList.add("wl-tile--main");
      this.main.onOpenMs = () => this.paintOpen();
      $("wf-main").replaceChildren(this.main.el);
      this.main.start("");                 // Fokus — asosiy (yuqori sifat) oqim
      this.kpi = { local: null, server: undefined };
      this.loadKpis(cam);
    }
    this.refresh();
  }

  /* Ma'lumot yangilanganda (har 30 s) va kamera almashganda. */
  refresh() {
    const cam = this.cam();
    if (!cam) { this.wall.exitFocus(); return; }
    if (this.main) this.main.update(cam);
    $("wf-name").textContent = cam.name;
    const st = camStatus(cam);
    const b = $("wf-status");
    b.dataset.status = st;
    b.innerHTML = '<span class="dot" data-status="' + st + '"></span><span>' + esc(STATUS_TEXT[st]) + "</span>";

    // Keyingi kameralar — devor tartibida, aylana.
    const list = this.wall.cams();
    const i = list.findIndex((c) => c.id === cam.id);
    const want = [];
    for (let k = 1; k < list.length && want.length < NEXT_COUNT; k++) {
      const c = list[(Math.max(i, 0) + k) % list.length];
      if (c.id !== cam.id) want.push(c);
    }
    const ids = new Set(want.map((c) => c.id));
    this.next.forEach((t, id) => { if (!ids.has(id)) { t.stop(); this.next.delete(id); } });
    const box = $("wf-next");
    want.forEach((c, n) => {
      let t = this.next.get(c.id);
      if (!t) {
        t = new WallTile(c, this.wall.tileOpts());
        t.el.addEventListener("click", () => this.show(c.id));
        this.next.set(c.id, t);
        t.start("sub");
      } else t.update(c);
      if (box.children[n] !== t.el) box.insertBefore(t.el, box.children[n] || null);
    });
    this.paintKpis();
  }

  step(d) {
    const list = this.wall.cams();
    if (!list.length) return;
    const i = list.findIndex((c) => c.id === this.camId);
    const n = list[((i < 0 ? 0 : i) + d + list.length) % list.length];
    this.show(n.id);
  }

  fullscreen() {
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
    const el = this.main && this.main.el;
    if (el && el.requestFullscreen) el.requestFullscreen().catch(() => {});
  }

  /* ---------- KPI ---------- */
  async loadKpis(cam) {
    const my = ++this.token;
    const id = cam.id;
    const get = (p) => api(p).catch(() => null);
    const [open, week, today] = await Promise.all([
      get("/api/metrics/open?camera_id=" + id + "&limit=200"),
      get("/api/stats/cameras/" + id + "?days=7"),
      get("/api/stats/cameras/" + id + "?from=" + todayIso()),
    ]);
    if (my !== this.token) return;
    // Yangi server: {camera_id, median_ms, last_ms, ...}; eski: {items: [...]}.
    let srv = null;
    if (open) {
      const it = open.camera_id === id ? open
        : (open.items || []).find((x) => x.camera_id === id);
      if (it) srv = it.median_ms ?? it.p50_ms ?? it.last_ms ?? null;
    }
    this.kpi.server = srv;
    this.kpi.uptime = week ? week.uptime_pct : null;
    this.kpi.outages = today ? today.outages : null;
    this.paintKpis();
  }

  paintOpen() {
    this.kpi.local = this.main ? this.main.openMs : null;
    this.paintKpis();
  }

  paintKpis() {
    const cam = this.cam();
    if (!cam) return;
    const k = this.kpi;
    const openMs = k.server != null ? k.server : (k.local != null ? k.local : state.openByCam.get(cam.id));
    const codec = fmtCodec(cam.codec) + (cam.transcode && /265/.test(cam.codec || "") ? " → H.264" : "");
    const codecMeta = [fmtRes(cam.resolution), cam.fps ? cam.fps + " fps" : ""].filter(Boolean).join(" · ");
    const tile = (label, tip, value, meta) =>
      '<div class="kpi-tile wl-kpi">' +
        '<div class="kpi-tile__label">' + esc(label) + (tip ? '<span class="spacer"></span>' + infotip(tip) : "") + "</div>" +
        '<div class="wl-kpi__row"><span class="kpi-tile__value">' + esc(value) + "</span>" +
          (meta ? '<span class="kpi-tile__meta">' + esc(meta) + "</span>" : "") + "</div></div>";
    const box = $("wf-kpis");
    box.innerHTML =
      tile("Ochilish vaqti", "Oqim bosilgandan birinchi kadr kelguncha ketgan vaqt", openMs != null ? fmtSec(openMs) : "—", "birinchi kadr") +
      tile("Kodek", "", codec, codecMeta) +
      tile("Ishlash ulushi", "Uptime — oxirgi 7 kunda kamera onlayn boʻlgan vaqt ulushi", pct(k.uptime), "7 kun") +
      tile("Uzilishlar", "", k.outages == null ? "—" : String(k.outages), "bugun");
    hydrateIcons(box);
    tooltip.label(box);
  }

  stop() {
    this.token++;
    if (this.main) { this.main.stop(); this.main = null; }
    this.next.forEach((t) => t.stop());
    this.next.clear();
  }

  close() {
    this.stop();
    this.active = false;
    $("wall-focus").hidden = true;
  }
}
