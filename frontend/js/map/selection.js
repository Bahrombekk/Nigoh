/* ==========================================================================
   map/selection.js — tanlangan kamera: kichik karta va tafsilot drawer'i
   --------------------------------------------------------------------------
   Figma: Map/CameraPopover (125:263, 02.24) va Map/CameraDrawer (02.03,
   02.19 Texnik pasport, 02.20 Tarix, 02.21 Surat saqlandi).
     * Marker bosilsa → kichik karta markerdan 12px yuqorida: oxirgi kadr
       (snapshot, jonli oqim emas), nom + StatusBadge, meta, "Batafsil",
       devorga qo'shish, to'liq ekran, yopish. Tashqariga click / Esc / × yopadi.
     * "Batafsil" yoki ro'yxat qatori → o'ngda 480px drawer: sarlavha +
       holat + "Hudud · km · piket", jonli video (player/player.js), amallar
       (1 Primary + IconButton'lar), 3 KpiTile, "Soʻnggi 24 soat" (48 blok),
       tablar Maʼlumot / Texnik pasport / Tarix N, so'nggi hodisalar.
       Drawer ochiq bo'lsa boshqa marker → kontent almashadi (karta chiqmaydi).
     * `?camera=ID` manzilda; drawer ochilganda fokus sarlavhaga.

   Eksport:
     SelectionPanel, selectionPanel
     selPlayer             — JONLI eksport (let): drawer pleyeri (Player | null)
     fmtLastSeen(iso)      — "hozirgina", "5 daqiqa oldin", ...
     selectCamera(id, fly) — drawer'ni ochish (fly=false — xarita uchmaydi)
     openCard(id)          — kichik kartani ochish (marker bosilganda)
     setSelOpen(open), updateSelHead(), closeSel()
     selectionEscape()     — Esc: karta → drawer (yopildimi — true)

   Bog'liqliklar:
     import: ../core/state.js, ../core/api.js, ../core/icons.js, ../core/ui.js,
             ./map.js (map, mapView, refreshMarkerIcons), ./util.js,
             ./camera-list.js (MOBILE, renderFootStats, renderList, setListOpen),
             ../player/player.js (createPlayer), ../wall/video-wall.js (saveSnapshot),
             ../layout/tabs.js (showTab), ../admin/camera-form.js (openCameraForm),
             ./groups.js (renderCamGroups)
   Backend: GET /api/cameras/{id}/snapshot (X-Snapshot-At), GET /api/cameras/{id}/details
            ?days=7&history=30 (passport, reliability, history; v3: timeline_24h,
            availability_24h, online_since), GET /api/admin/cameras?q= (tahrirlash)

   Qoidalar / tuzoqlar:
     - Modul yuklanishida boshqa modullarning bog'lamalariga tegilmaydi
       (aylanma import) — DOM init() da yasaladi (page.js chaqiradi).
     - Boshqa bo'limdan tanlansa avval xaritaga o'tiladi; showTab("map")
       selectCamera ni o'zi qayta chaqiradi.
     - Tafsilotlar faqat tanlashda so'raladi; kech javob detailsFor bilan tekshiriladi.
     - timeline_24h yo'q bo'lsa (eski backend) — tarixdan (history) taxminan yasaladi.
   ========================================================================== */
import { $, esc, HEVC_OK, state, toast } from "../core/state.js";
import { api } from "../core/api.js";
import { icon, hydrateIcons } from "../core/icons.js";
import { infotip, tooltip } from "../core/ui.js";
import { map, mapView, refreshMarkerIcons } from "./map.js";
import { MOBILE, renderFootStats, renderList, setListOpen } from "./camera-list.js";
import { createPlayer } from "../player/player.js";
import { saveSnapshot } from "../wall/video-wall.js";
import { showTab } from "../layout/tabs.js";
import { openCameraForm } from "../admin/camera-form.js";
import { renderCamGroups } from "./groups.js";
import { STATUS_LABEL, camPlace, camStatus, camSub, fmtAgo, fmtCodec, fmtDur, fmtRes,
         hasGeo, hm, hms, p2, setParam } from "./util.js";

export let selPlayer = null;
export function fmtLastSeen(iso) { return fmtAgo(iso); }

const VENDORS = { dahua: "Dahua", hikvision: "Hikvision", holowits: "Holowits" };
const HIST = {
  offline: ["Uzildi", "offline"], online: ["Tiklandi", "online"],
  stalled: ["Tasvir toʻxtadi", "no-video"], resumed: ["Tasvir tiklandi", "online"],
  transport: ["Uzatish usuli almashdi", "unknown"], mediamtx: ["Video server", "unknown"],
};
const BLOCK_RANK = { offline: 3, stalled: 2, unknown: 1, online: 0 };

/* "07.10 07:42" */
function fmtStamp(iso) {
  const t = new Date(iso);
  return isNaN(t) ? "—" : p2(t.getDate()) + "." + p2(t.getMonth() + 1) + " " + hm(t);
}
/* Bugun — "10:05", oldin — "07.10 10:05" */
function fmtWhen(iso) {
  const t = new Date(iso);
  if (isNaN(t)) return "—";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return t >= today ? hm(t) : fmtStamp(iso);
}

/* ---------- 24 soatlik mavjudlik (48 × 30 daqiqa) ---------- */
const AFTER = { offline: "offline", online: "online", stalled: "stalled", resumed: "online" };
const BEFORE = { offline: "online", online: "offline", stalled: "online", resumed: "stalled" };

/* history (yangisi birinchi) → [{from, to, state}] — 24 soat oynasida. */
function segmentsFromHistory(cam, history, now) {
  const start = now - 86400000;
  const cur0 = { online: "online", "no-video": "stalled", offline: "offline" }[camStatus(cam)] || "unknown";
  let cur = cur0, end = now;
  const segs = [];
  for (const h of history || []) {
    if (!AFTER[h.kind]) continue;
    const t = new Date(h.ts).getTime();
    if (isNaN(t)) continue;
    if (t <= start) break;
    segs.push({ from: t, to: end, state: cur });
    cur = BEFORE[h.kind];
    end = t;
  }
  segs.push({ from: start, to: end, state: cur });
  return segs;
}

function buildBlocks(cam, d, now) {
  if (d && Array.isArray(d.timeline_24h) && d.timeline_24h.length) {
    const blocks = d.timeline_24h.slice(-48).map((b) => b.state || "unknown");
    const pct = d.availability_24h != null ? d.availability_24h
      : (blocks.filter((s) => s === "online").length / blocks.length) * 100;
    return { blocks, pct };
  }
  const segs = segmentsFromHistory(cam, d && d.history, now);
  const start = now - 86400000, step = 1800000;
  const blocks = [];
  for (let i = 0; i < 48; i++) {
    const a = start + i * step, b = a + step;
    let worst = null;
    segs.forEach((s) => {
      if (s.to <= a || s.from >= b) return;
      if (worst == null || BLOCK_RANK[s.state] > BLOCK_RANK[worst]) worst = s.state;
    });
    blocks.push(worst || "unknown");
  }
  let on = 0;
  segs.forEach((s) => { if (s.state === "online") on += s.to - s.from; });
  return { blocks, pct: (on / 86400000) * 100 };
}

/* ---------- Tanlangan kamera ---------- */
export class SelectionPanel {
  constructor() {
    this.player = null;
    this.details = null;
    this.detailsFor = null;
    this.cardId = null;          // kichik karta ochiq bo'lgan kamera
    this.open = false;           // drawer ochiqmi
    this.tab = "info";
    this.openInfo = null;        // {id, ms, ts} — shu seansda oqim ochilishi
    this.snapUrl = null;
    this.ready = false;
  }

  /* DOM — page.js init'dan (modullar to'liq yuklangach). */
  init() {
    if (this.ready) return;
    this.ready = true;
    const view = $("map-view");
    view.insertAdjacentHTML("beforeend", CARD_HTML + DRAWER_HTML);
    hydrateIcons(view);
    tooltip.label(view);
    this.card = $("mp-card");
    this.drawer = $("mp-drawer");

    // Karta
    $("mc-close").addEventListener("click", () => this.closeCard(true));
    $("mc-more").addEventListener("click", () => { const id = this.cardId; this.closeCard(false); this.select(id, false); });
    $("mc-wall").addEventListener("click", () => this.toWall(this.cardId));
    $("mc-full").addEventListener("click", () => {
      const id = this.cardId;
      this.closeCard(false);
      this.select(id, false);
      this.fullscreen();
    });
    // Kadr ustiga bosish — shu kartaning o'zida jonli oqim (ochilmagan/uzilgan
    // bo'lsa qayta urinadi); jonli ketayotganda — batafsil (drawer).
    $("mc-prev").addEventListener("click", () => {
      const id = this.cardId;
      const box = $("mc-prev");
      if (box.dataset.state === "playing") { this.closeCard(false); this.select(id, false); return; }
      const cam = state.byId.get(id);
      if (cam) this.startCardLive(cam, true);
    });
    map.on("move zoom viewreset", () => this.placeCard());
    map.on("zoomstart", () => { if (this.cardId != null && this.card) this.card.classList.add("is-moving"); });
    map.on("zoomend", () => { if (this.card) this.card.classList.remove("is-moving"); this.placeCard(); });
    // Tashqariga click — karta yopiladi (marker click o'zi qayta ochadi).
    map.on("click", () => { if (this.cardId != null && !state.measuring) this.closeCard(true); });
    addEventListener("resize", () => this.placeCard());

    // Drawer
    $("sel-close").addEventListener("click", () => this.close());
    $("sel-full").addEventListener("click", () => this.fullscreen());
    $("sel-video-wrap").addEventListener("dblclick", () => this.fullscreen());
    $("sel-shot").addEventListener("click", () => { const cam = state.byId.get(state.selectedId); if (cam) saveSnapshot(cam); });
    $("sel-edit").addEventListener("click", () => this.editSelected());
    $("sel-center").addEventListener("click", () => {
      const cam = state.byId.get(state.selectedId);
      if (cam && hasGeo(cam)) map.flyTo([cam.lat, cam.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
      else if (cam) toast("Bu kameraga koordinata kiritilmagan", { tone: "info" });
    });
    $("sel-wall").addEventListener("click", () => this.toWall(state.selectedId));
    $("sel-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-tab]");
      if (b) this.setTab(b.dataset.tab);
    });
    setInterval(() => {
      if (this.open && !document.hidden) $("sel-stamp").textContent = hms(new Date());
    }, 1000);
  }

  /* ---------- Kichik karta (Map/CameraPopover) ---------- */
  openCard(id) {
    const cam = state.byId.get(id);
    if (!cam || !this.ready) return;
    if (state.measuring) {
      if (hasGeo(cam)) document.dispatchEvent(new CustomEvent("measure:point", { detail: { lat: cam.lat, lng: cam.lng } }));
      return;
    }
    // Drawer ochiq — kontent almashadi, karta chiqmaydi.
    if (this.open) { this.select(id, false); return; }
    this.cardId = id;
    state.selectedId = id;
    refreshMarkerIcons();
    renderList();
    this.fillCard(cam);
    this.card.hidden = false;
    this.placeCard();
    document.dispatchEvent(new CustomEvent("selection:card", { detail: { id } }));
  }

  fillCard(cam) {
    const st = camStatus(cam);
    $("mc-name").textContent = cam.name;
    const badge = $("mc-badge");
    badge.dataset.status = st;
    badge.innerHTML = '<span class="dot" data-status="' + st + '"></span>' + STATUS_LABEL[st];
    $("mc-meta").textContent = [camSub(cam), fmtCodec(cam.codec)].filter(Boolean).join(" · ") || "—";
    $("mc-fmt").textContent = [fmtCodec(cam.codec), fmtRes(cam.resolution)].filter(Boolean).join(" · ") || "—";
    this.loadPreview(cam, $("mc-prev"));
    if (st !== "offline") this.startCardLive(cam, false);
  }

  /* Kartada jonli oqim: avval oxirgi kadr ko'rinadi, oqim kelgach video
     ustiga chiqadi va "LIVE" belgisi yonadi (kadrda LIVE yozilmaydi). Kichik
     katak — past sifatli 2-oqim (sub). */
  startCardLive(cam, manual) {
    const box = $("mc-prev");
    if (!this.cardPlayer) {
      this.cardPlayer = createPlayer($("mc-video"), $("mc-msg"));
      this.cardPlayer.onOpen = () => {
        if (this.cardId == null) return;
        box.dataset.state = "playing";
        box.setAttribute("aria-label", "Batafsil");
        box.querySelector(".mp-prev__time").textContent = hms(new Date());
      };
      this.cardPlayer.onState = (kind) => {
        box.classList.toggle("is-connecting", kind === "wait");
        box.classList.toggle("is-failed", kind === "fail");
      };
    }
    const v = $("mc-video");
    v.poster = "";
    if (manual && box.dataset.state !== "playing") box.classList.add("is-connecting");
    this.cardPlayer.open(cam, HEVC_OK, "sub");
  }

  stopCardLive() {
    if (this.cardPlayer) this.cardPlayer.stop();
    const box = $("mc-prev");
    if (box) { box.classList.remove("is-connecting", "is-failed"); box.setAttribute("aria-label", "Jonli koʻrish"); }
  }

  /* Video/Preview: oxirgi kadr (snapshot) + LIVE/vaqt; uzilgan — sabab + vaqt. */
  async loadPreview(cam, box) {
    const st = camStatus(cam);
    const img = box.querySelector("img");
    const off = box.querySelector(".mp-prev__off-t");
    if (this.snapUrl) { URL.revokeObjectURL(this.snapUrl); this.snapUrl = null; }
    img.removeAttribute("src");
    box.dataset.state = st === "offline" ? "off" : "load";
    off.textContent = st === "offline"
      ? "Oqim yoʻq · " + fmtAgo(cam.last_seen).replace("oldin", "oldin uzildi") : "";
    box.querySelector(".mp-prev__time").textContent = "";
    try {
      const r = await fetch("/api/cameras/" + cam.id + "/snapshot" + (st === "offline" ? "?stale=1" : ""),
        { credentials: "same-origin" });
      if (this.cardId !== cam.id) return;
      if (!r.ok) throw new Error(r.status);
      const at = r.headers.get("X-Snapshot-At");
      this.snapUrl = URL.createObjectURL(await r.blob());
      img.src = this.snapUrl;
      // Jonli oqim allaqachon kelgan bo'lsa — holat o'zgarmaydi.
      if (box.dataset.state !== "playing") box.dataset.state = st !== "offline" ? "snap" : "off-img";
      box.querySelector(".mp-prev__time").textContent = hms(at ? new Date(isNaN(at) ? at : Number(at) * 1000) : new Date());
    } catch (e) {
      if (this.cardId !== cam.id) return;
      box.dataset.state = "off";
      if (!off.textContent) off.textContent = "Kadr yoʻq";
    }
  }

  placeCard() {
    if (this.cardId == null || !this.card || this.card.hidden) return;
    const cam = state.byId.get(this.cardId);
    if (!cam || !hasGeo(cam)) return;
    const p = map.latLngToContainerPoint([cam.lat, cam.lng]);
    const size = map.getSize();
    const w = this.card.offsetWidth, h = this.card.offsetHeight;
    // 12px marker ustida (tanlangan marker 40px → markazdan 20 + 12).
    let below = p.y - 32 - h < 8;
    let top = below ? p.y + 32 : p.y - 32 - h;
    let left = Math.max(8, Math.min(size.x - w - 8, p.x - w / 2));
    this.card.classList.toggle("is-below", below);
    this.card.style.transform = "translate(" + Math.round(left) + "px," + Math.round(top) + "px)";
    this.card.style.setProperty("--ptr-x", Math.max(16, Math.min(w - 16, p.x - left)) + "px");
    const outside = p.x < -40 || p.y < -40 || p.x > size.x + 40 || p.y > size.y + 40;
    this.card.classList.toggle("is-out", outside);
  }

  closeCard(deselect) {
    if (this.cardId == null) return;
    this.cardId = null;
    this.stopCardLive();
    this.card.hidden = true;
    if (deselect && !this.open) {
      state.selectedId = null;
      refreshMarkerIcons();
      renderList();
    }
  }

  toWall(id) {
    if (id && !state.pinned.includes(id)) state.pinned.push(id);
    this.closeCard(false);
    showTab("wall");
  }

  fullscreen() {
    const v = $("sel-video-wrap");
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (v.requestFullscreen) v.requestFullscreen().catch(() => {});
  }

  /* ---------- Drawer (Map/CameraDrawer) ---------- */
  select(id, fly) {
    const cam = state.byId.get(id);
    if (!cam) return;
    state.selectedId = id;
    if (state.tab !== "map") { showTab("map"); return; }
    if (!this.ready) return;
    this.closeCard(false);
    if (fly !== false && hasGeo(cam)) {
      map.flyTo([cam.lat, cam.lng], Math.max(map.getZoom(), 14), { duration: 0.6 });
      // Bir ustundagi kameralar klasterda qolsa — yoyiladi, tanlangan marker ko'rinsin.
      map.once("moveend", () => { if (state.selectedId === id) mapView.reveal(id); });
    }

    const was = this.open;
    if (this.detailsFor !== id) { this.details = null; }
    this.setOpen(true);
    if (MOBILE.matches) setListOpen(false);
    this.updateHead();
    this.loadDetails(id);
    renderList();
    refreshMarkerIcons();
    setParam("camera", id);
    if (!was) setTimeout(() => $("sel-name").focus({ preventScroll: true }), 60);

    const video = $("sel-video");
    video.poster = "";
    // Uzilgan kamerada oxirgi saqlangan kadr (?stale=1) — 404 bo'lmasin.
    video.poster = "/api/cameras/" + cam.id + "/snapshot?" + (camStatus(cam) === "offline" ? "stale=1&" : "") + "t=" + Date.now();
    if (!this.player) selPlayer = this.player = createPlayer(video, $("sel-msg"));
    const player = this.player;
    player.onOpen = (ms) => {
      this.openInfo = { id: cam.id, ms, ts: new Date().toISOString() };
      if (state.selectedId === cam.id) this.renderEvents();
    };
    player.open(cam, HEVC_OK);
    if (camStatus(cam) === "offline") {
      player.setMsg("Oqim yoʻq · " + fmtAgo(cam.last_seen).replace("oldin", "oldin uzildi"), "wait");
    }
    renderFootStats();
    document.dispatchEvent(new CustomEvent("selection:drawer", { detail: { id } }));
  }

  setOpen(open) {
    if (!this.ready) return;
    this.open = !!open;
    this.drawer.hidden = !open;
    $("map-view").classList.toggle("mp-has-drawer", !!open);
    document.body.classList.toggle("has-sel", !!open);
  }

  setTab(tab) {
    this.tab = tab;
    $("sel-tabs").querySelectorAll("button").forEach((b) => b.classList.toggle("is-on", b.dataset.tab === tab));
    ["info", "pass", "hist"].forEach((t) => { $("sel-tab-" + t).hidden = t !== tab; });
  }

  updateHead() {
    if (!this.ready) return;
    // Karta ochiq bo'lsa — holati yangilanadi.
    if (this.cardId != null) {
      const c = state.byId.get(this.cardId);
      if (!c) this.closeCard(true);
      else {
        const st = camStatus(c);
        const badge = $("mc-badge");
        if (badge.dataset.status !== st) {
          badge.dataset.status = st;
          badge.innerHTML = '<span class="dot" data-status="' + st + '"></span>' + STATUS_LABEL[st];
        }
      }
    }
    if (!this.open) return;
    const cam = state.byId.get(state.selectedId);
    if (!cam) { this.close(); return; }
    const st = camStatus(cam);
    $("sel-name").textContent = cam.name;
    const badge = $("sel-badge");
    badge.dataset.status = st;
    badge.innerHTML = '<span class="dot" data-status="' + st + '"></span>' + STATUS_LABEL[st];
    $("sel-sub").textContent = camSub(cam) || "Hudud belgilanmagan";
    $("sel-live").hidden = st === "offline" || st === "disabled";
    $("sel-stamp").textContent = hms(new Date());
    this.renderDetails();
  }

  async loadDetails(id) {
    this.detailsFor = id;
    try {
      const d = await api("/api/cameras/" + id + "/details?days=7&history=30");
      if (this.detailsFor !== id) return;
      this.details = d;
    } catch (e) {
      if (this.detailsFor !== id) return;
      this.details = { error: true };
    }
    this.renderDetails();
  }

  renderDetails() {
    const cam = state.byId.get(state.selectedId);
    if (!cam) return;
    const d = this.details;
    const ready = !!(d && !d.error && d.id === cam.id);
    const failed = !!(d && d.error);
    const ps = ready ? d.passport : null;
    const res = (ps && ps.resolution) || cam.resolution;
    const fps = (ps && ps.fps) || cam.fps;
    const fmt = [fmtCodec((ps && ps.codec) || cam.codec), fmtRes(res), fps ? Math.round(fps) + " fps" : ""]
      .filter(Boolean).join(" · ");
    $("sel-fmt").textContent = fmt || "—";
    this.renderKpis(ready ? d.reliability : undefined, failed);
    this.renderAvail(cam, ready ? d : null, failed);
    this.renderInfo(cam, ps, ready ? d : null, fmt);
    this.renderPassport(cam, ps, failed);
    this.renderHistory(ready ? d.history : null, failed);
    this.renderEvents();
  }

  renderKpis(r, failed) {
    const set = (k, v, meta, cls) => {
      $("sel-k-" + k).textContent = v;
      $("sel-k-" + k).className = "kpi-tile__value" + (cls ? " " + cls : "");
      $("sel-k-" + k + "-m").textContent = meta;
    };
    if (!r) {
      const t = r === null ? "kuzatilmaydi" : failed ? "maʼlumot yoʻq" : "…";
      set("up", "—", t); set("out", "—", ""); set("mttr", "—", "");
      return;
    }
    const up = r.uptime_pct;
    set("up", up == null ? "—" : up.toFixed(1).replace(".", ",") + "%", r.days + " kun",
        up == null ? "" : up >= 99 ? "" : up >= 90 ? "t-warning" : "t-error");
    set("out", String(r.outages), r.blips ? "+" + r.blips + " qisqa uzilish" : "qisqa uzilish yoʻq");
    set("mttr", r.mttr_median_s != null ? fmtDur(r.mttr_median_s) : "—", "mediana");
  }

  renderAvail(cam, d, failed) {
    const bar = $("sel-avail");
    const now = Date.now();
    if (!d) {
      bar.innerHTML = Array.from({ length: 48 }, () => '<i data-s="unknown"></i>').join("");
      $("sel-avail-pct").textContent = failed ? "" : "…";
    } else {
      const { blocks, pct } = buildBlocks(cam, d, now);
      bar.innerHTML = blocks.map((s, i) => {
        const t = new Date(now - 86400000 + i * 1800000);
        return '<i data-s="' + esc(s) + '" title="' + hm(t) + " · " + esc({ online: "onlayn", offline: "uzilgan",
          stalled: "tasvirsiz", unknown: "maʼlumot yoʻq" }[s] || s) + '"></i>';
      }).join("");
      const el = $("sel-avail-pct");
      el.textContent = "onlayn " + pct.toFixed(1).replace(".", ",") + "%";
      el.className = "mono-xs " + (pct >= 99 ? "t-success" : pct >= 90 ? "t-warning" : "t-error");
    }
    const start = new Date(now - 86400000);
    start.setMinutes(0, 0, 0);
    const lab = [0, 6, 12, 18].map((h) => hm(new Date(start.getTime() + h * 3600000)));
    $("sel-avail-axis").innerHTML = lab.map((l) => "<span>" + l + "</span>").join("") + "<span>hozir</span>";
  }

  row(ic, k, v, opts = {}) {
    return '<div class="detail-row">' + icon(ic, "sm") + '<span class="detail-row__k">' + esc(k) + "</span>" +
      '<span class="detail-row__v' + (opts.mono ? " mono-sm" : "") + (opts.cls ? " " + opts.cls : "") + '"' +
      (opts.id ? ' id="' + opts.id + '"' : "") + ">" + (opts.html ? v : esc(v)) + "</span></div>";
  }

  /* "Ish vaqti" — joriy onlayn seriya davomiyligi. */
  uptimeText(cam, d) {
    const st = camStatus(cam);
    const since = (d && d.online_since) || cam.online_since;
    if (st === "online" && since) return fmtDur((Date.now() - new Date(since)) / 1000);
    const hist = (d && d.history) || [];
    if (st === "online") {
      const last = hist.find((h) => h.kind === "online");
      if (last) return fmtDur((Date.now() - new Date(last.ts)) / 1000);
      return d ? (d.reliability ? d.reliability.days + "+ kun" : "—") : "…";
    }
    if (st === "offline") {
      const last = hist.find((h) => h.kind === "offline");
      return last ? "uzilgan · " + fmtDur((Date.now() - new Date(last.ts)) / 1000) : "uzilgan";
    }
    return "—";
  }

  renderInfo(cam, ps, d, fmt) {
    const vendor = VENDORS[(ps && ps.vendor) || cam.vendor] || "";
    const model = [vendor, (ps && ps.model) || cam.model].filter(Boolean).join(" ") || "—";
    const st = camStatus(cam);
    const place = camPlace(ps ? { km: ps.km, picket: ps.picket } : cam);
    $("sel-info-rows").innerHTML =
      this.row("map-pin", "Hudud", cam.region || "—") +
      this.row("location-pin", "Joy", place || "—") +
      this.row("video", "Kodek · format", fmt || "—") +
      this.row("camera", "Model", model) +
      this.row("clock", "Oxirgi aloqa", st === "online" ? "hozirgina" : fmtAgo(cam.last_seen)) +
      this.row("history", "Ish vaqti", this.uptimeText(cam, d)) +
      (state.admin ? this.row("grid", "Guruh", "", { id: "sel-f-groups", cls: "mp-gchips", html: true }) : "");
    if (state.admin) renderCamGroups(cam);
  }

  renderPassport(cam, ps, failed) {
    const box = $("sel-tab-pass");
    if (!ps) {
      box.innerHTML = '<div class="body-sm t-tertiary mp-drawer__empty">' +
        (failed ? "Maʼlumotni olib boʻlmadi." : "Yuklanmoqda…") + "</div>";
      return;
    }
    const sub = !ps.has_sub ? ["yoʻq", ""]
      : ps.sub_bad ? [(ps.sub_codec ? fmtCodec(ps.sub_codec) + " · " : "") + "ishlamaydi", "t-error"]
      : [fmtCodec(ps.sub_codec || "?") + " · ishlaydi", ""];
    const probe = ps.probe_error ? [ps.probe_error, "t-error"]
      : ps.probe_at ? ["muvaffaqiyatli · " + fmtStamp(ps.probe_at), ""] : ["hali tekshirilmagan", ""];
    const created = ps.created_at ? new Date(ps.created_at) : null;
    const vendor = VENDORS[ps.vendor] || ps.vendor || "";
    box.innerHTML =
      this.row("camera", "Model", [vendor, ps.model].filter(Boolean).join(" ") || "—") +
      this.row("cpu", "Proshivka", ps.firmware ? ps.firmware.split(",")[0] : "—", { mono: true }) +
      this.row("video", "Asosiy oqim", [fmtCodec(ps.codec), fmtRes(ps.resolution), ps.fps ? Math.round(ps.fps) + " fps" : ""].filter(Boolean).join(" · ") || "—") +
      this.row("signal", "Qoʻshimcha oqim", sub[0], { cls: sub[1] }) +
      this.row("rotate-cw", "Oʻgirish", ps.transcode ? "H.265 → H.264 (server)" : "yoʻq — kameraning oʻz oqimi") +
      this.row("wifi", "Uzatish usuli", ps.transport === "udp" ? "UDP (TCPʼda kadr kelmagan)" : "TCP") +
      this.row("train", "Liniya", ps.rail_line || "—") +
      this.row("location-crosshairs", "Koordinata", ps.lat != null ? ps.lat.toFixed(5) + ", " + ps.lng.toFixed(5) : "kiritilmagan",
        { mono: ps.lat != null, cls: ps.lat == null ? "t-warning" : "" }) +
      this.row("image", "Oxirgi surat", ps.snapshot_at ? fmtAgo(ps.snapshot_at) : "—") +
      this.row("circle-check", "Pasport tekshiruvi", probe[0], { cls: probe[1] }) +
      this.row("calendar", "Qoʻshilgan", created && !isNaN(created)
        ? p2(created.getDate()) + "." + p2(created.getMonth() + 1) + "." + created.getFullYear() : "—") +
      (ps.note ? this.row("pen", "Izoh", ps.note) : "");
  }

  renderHistory(list, failed) {
    const box = $("sel-tab-hist");
    $("sel-hist-n").textContent = list ? String(list.length) : "";
    if (!list) {
      box.innerHTML = '<div class="body-sm t-tertiary mp-drawer__empty">' +
        (failed ? "Maʼlumotni olib boʻlmadi." : "Yuklanmoqda…") + "</div>";
      return;
    }
    if (!list.length) {
      box.innerHTML = '<div class="body-sm t-tertiary mp-drawer__empty">Soʻnggi 30 kunda hodisa qayd etilmagan.</div>';
      return;
    }
    box.innerHTML = '<ol class="mp-events mp-events--full">' + list.map((h, i) => {
      const [label, st] = HIST[h.kind] || [h.kind, "unknown"];
      let note = h.kind === "transport" ? h.detail : "";
      const pair = { online: "offline", resumed: "stalled" }[h.kind];
      if (pair) {
        const prev = list.slice(i + 1).find((x) => x.kind === pair || x.kind === h.kind);
        if (prev && prev.kind === pair) note = fmtDur((new Date(h.ts) - new Date(prev.ts)) / 1000) + " uzilishdan keyin";
      }
      return '<li><time class="mono-xs">' + fmtStamp(h.ts) + '</time><span class="dot" data-status="' + st + '"></span>' +
        '<span class="body-sm t-secondary">' + esc(label) + (note ? " · " + esc(note) : "") + "</span></li>";
    }).join("") + "</ol>";
  }

  /* SOʻNGGI HODISALAR — 3 ta: oqim ochilishi (shu seans), uzilishlar, tasvirsizlik. */
  renderEvents() {
    const box = $("sel-events");
    if (!box) return;
    const cam = state.byId.get(state.selectedId);
    const d = this.details;
    const list = d && !d.error && cam && d.id === cam.id ? d.history || [] : null;
    const items = [];
    if (this.openInfo && cam && this.openInfo.id === cam.id) {
      items.push({ ts: this.openInfo.ts, st: "online",
        text: "Oqim ochildi · " + (this.openInfo.ms / 1000).toFixed(1).replace(".", ",") + " s" });
    }
    if (list) {
      list.forEach((h, i) => {
        if (h.kind !== "offline" && h.kind !== "stalled") return;
        const end = list.slice(0, i).reverse().find((x) => x.kind === (h.kind === "offline" ? "online" : "resumed"));
        const dur = fmtDur(((end ? new Date(end.ts) : Date.now()) - new Date(h.ts)) / 1000);
        items.push(h.kind === "offline"
          ? { ts: h.ts, st: "offline", text: "Uzildi · " + dur + (end ? "" : " · davom etmoqda") }
          : { ts: h.ts, st: "no-video", text: "Tasvirsiz · " + dur + (/muzla|toʻxta/.test(h.detail || "") ? " · oqim toʻxtadi" : "") });
      });
    }
    items.sort((a, b) => new Date(b.ts) - new Date(a.ts));
    if (!items.length) {
      box.innerHTML = '<div class="body-sm t-tertiary">' + (list ? "Soʻnggi 30 kunda hodisa yoʻq" : "Yuklanmoqda…") + "</div>";
      return;
    }
    box.innerHTML = '<ol class="mp-events">' + items.slice(0, 3).map((it) =>
      '<li><time class="mono-xs">' + fmtWhen(it.ts) + '</time><span class="dot" data-status="' + it.st + '"></span>' +
      '<span class="body-sm t-secondary">' + esc(it.text) + "</span></li>").join("") + "</ol>";
  }

  close() {
    const had = this.open || this.cardId != null;
    this.closeCard(false);
    state.selectedId = null;
    this.setOpen(false);
    if (this.player) this.player.stop();
    setParam("camera", null);
    if (had) { renderList(); refreshMarkerIcons(); renderFootStats(); }
  }

  /* Esc: avval karta, keyin drawer. */
  escape() {
    if (this.cardId != null) { this.closeCard(true); return true; }
    if (this.open) { this.close(); return true; }
    return false;
  }

  async editSelected() {
    const cam = state.byId.get(state.selectedId);
    if (!cam) return;
    if (!state.admin || state.admin.role !== "admin") { toast("Kamerani faqat administrator sozlaydi", { tone: "info" }); return; }
    try {
      const res = await api("/api/admin/cameras?q=" + encodeURIComponent(cam.name) + "&limit=50&offset=0");
      const full = (res.cameras || res.items || []).find((c) => c.id === cam.id);
      if (full) { openCameraForm(full); return; }
    } catch (e) { /* pastda boshqaruvga o'tamiz */ }
    toast("Kamera yozuvi topilmadi — Boshqaruv boʻlimidan tahrirlang", { tone: "error" });
    showTab("admin");
  }
}

/* ---------- Shablonlar ---------- */
const CARD_HTML =
  '<div class="mp-card" id="mp-card" role="dialog" aria-labelledby="mc-name" hidden>' +
    '<button class="mp-prev" id="mc-prev" data-state="load" aria-label="Jonli koʻrish">' +
      '<img alt="">' +
      '<video id="mc-video" muted playsinline></video>' +
      '<span class="mp-prev__msg label-xs" id="mc-msg"></span>' +
      '<span class="mp-prev__scrim"></span>' +
      '<span class="mp-prev__live"><span class="mp-livedot"></span>JONLI</span>' +
      '<span class="mp-prev__time mono-xs"></span>' +
      '<span class="mp-prev__off"><span data-icon="camera-slash" data-icon-size="lg"></span><span class="mp-prev__off-t label-sm"></span></span>' +
      '<span class="mp-prev__spin spinner"></span>' +
      '<span class="mp-prev__bar"><span class="mono-xs" id="mc-fmt"></span></span>' +
    "</button>" +
    '<div class="mp-card__body">' +
      '<div class="mp-card__row"><span class="label-md ellipsis" id="mc-name"></span>' +
        '<span class="badge" id="mc-badge"></span><span class="spacer"></span>' +
        '<button class="icon-btn icon-btn--sm" id="mc-close" data-tip="Yopish" data-icon="xmark" data-icon-size="sm"></button></div>' +
      '<div class="body-xs t-tertiary ellipsis" id="mc-meta"></div>' +
      '<div class="mp-card__actions">' +
        '<button class="btn btn--primary btn--sm mp-card__more" id="mc-more">Batafsil</button>' +
        '<button class="icon-btn icon-btn--sm icon-btn--secondary" id="mc-wall" data-tip="Video devorga qoʻshish" data-icon="grid" data-icon-size="sm"></button>' +
        '<button class="icon-btn icon-btn--sm icon-btn--secondary" id="mc-full" data-tip="Toʻliq ekran" data-icon="maximize" data-icon-size="sm"></button>' +
      "</div>" +
    "</div>" +
    '<span class="mp-card__ptr" aria-hidden="true"></span>' +
  "</div>";

const KPI = (k, label, tip) =>
  '<div class="kpi-tile"><span class="kpi-tile__label">' + label + infotip(tip) + "</span>" +
  '<span class="kpi-tile__value" id="sel-k-' + k + '">—</span><span class="kpi-tile__meta" id="sel-k-' + k + '-m"></span></div>';

const DRAWER_HTML =
  '<aside class="mp-drawer" id="mp-drawer" role="dialog" aria-labelledby="sel-name" hidden>' +
    '<header class="mp-drawer__head">' +
      '<div class="mp-drawer__title"><h2 class="heading-lg ellipsis" id="sel-name" tabindex="-1"></h2>' +
        '<button class="icon-btn icon-btn--sm" id="sel-close" data-tip="Yopish" data-icon="xmark" data-icon-size="sm"></button></div>' +
      '<div class="mp-drawer__sub"><span class="badge" id="sel-badge"></span><span class="body-sm t-tertiary ellipsis" id="sel-sub"></span></div>' +
    "</header>" +
    '<div class="mp-drawer__scroll">' +
      '<div class="mp-video" id="sel-video-wrap">' +
        '<video id="sel-video" muted playsinline></video>' +
        '<div id="sel-msg"></div>' +
        '<span class="mp-prev__scrim"></span>' +
        '<span class="mp-prev__live" id="sel-live"><span class="mp-livedot"></span>JONLI</span>' +
        '<span class="mp-prev__time mono-xs" id="sel-stamp"></span>' +
        '<span class="mp-prev__bar"><span class="mono-xs" id="sel-fmt"></span>' +
          '<button class="mp-prev__fs" id="sel-full" data-tip="Toʻliq ekran" data-icon="maximize"></button></span>' +
      "</div>" +
      '<div class="mp-drawer__actions">' +
        '<button class="btn btn--primary mp-drawer__wall" id="sel-wall" data-icon="grid">Video devorga qoʻshish</button>' +
        '<button class="icon-btn icon-btn--secondary" id="sel-shot" data-tip="Suratni saqlash" data-icon="camera"></button>' +
        '<button class="icon-btn icon-btn--secondary" id="sel-center" data-tip="Xaritada markazlash" data-icon="location-crosshairs"></button>' +
        '<button class="icon-btn icon-btn--secondary admin-only" id="sel-edit" data-tip="Kamerani sozlash" data-icon="sliders"></button>' +
      "</div>" +
      '<div class="mp-kpis">' +
        KPI("up", "Ishlash ulushi", "Uptime — soʻnggi 7 kunda kamera onlayn boʻlgan vaqt ulushi. Tasvirsiz vaqt onlayn hisoblanmaydi.") +
        KPI("out", "Uzilishlar", "2 daqiqadan uzun uzilishlar soni (7 kun). Qisqa uzilishlar alohida sanaladi.") +
        KPI("mttr", "Tiklanish vaqti", "MTTR — uzilishdan qayta ulanishgacha oʻtgan vaqtning medianasi.") +
      "</div>" +
      '<section class="mp-avail">' +
        '<div class="mp-avail__head"><span class="overline">Soʻnggi 24 soat</span><span class="spacer"></span><span class="mono-xs" id="sel-avail-pct"></span></div>' +
        '<div class="mp-avail__bar" id="sel-avail"></div>' +
        '<div class="mp-avail__axis mono-xs" id="sel-avail-axis"></div>' +
      "</section>" +
      '<div class="seg" id="sel-tabs" role="tablist">' +
        '<button data-tab="info" class="is-on" role="tab">Maʼlumot</button>' +
        '<button data-tab="pass" role="tab">Texnik pasport</button>' +
        '<button data-tab="hist" role="tab">Tarix <span class="seg__count" id="sel-hist-n"></span></button>' +
      "</div>" +
      '<div id="sel-tab-info">' +
        '<div id="sel-info-rows"></div>' +
        '<div class="overline mp-drawer__h">Soʻnggi hodisalar</div>' +
        '<div id="sel-events"></div>' +
      "</div>" +
      '<div id="sel-tab-pass" hidden></div>' +
      '<div id="sel-tab-hist" hidden></div>' +
    "</div>" +
  "</aside>";

export const selectionPanel = new SelectionPanel();

export function selectCamera(id, fly) { selectionPanel.select(id, fly); }
export function openCard(id) { selectionPanel.openCard(id); }
export function setSelOpen(open) { selectionPanel.setOpen(open); }
export function updateSelHead() { selectionPanel.updateHead(); }
export function closeSel() { selectionPanel.close(); }
export function selectionEscape() { return selectionPanel.escape(); }
export function initSelection() { selectionPanel.init(); }
