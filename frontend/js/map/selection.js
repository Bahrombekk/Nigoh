/* ==========================================================================
   map/selection.js — tanlangan kamera paneli (o'ng panel)
   --------------------------------------------------------------------------
   Vazifasi:
     Xaritada/ro'yxatda tanlangan kamera: jonli video, sarlavha va
     tafsilotlar (hudud, joy, kodek, format, model, rejim, oxirgi onlayn),
     "Ishonchlilik" (7 kun), yig'iladigan "Texnik pasport" va "Tarix"
     bo'limlari, panel tugmalari (yopish, to'liq ekran, surat, tahrirlash,
     markazlash, devorga qo'shish).

   Eksport:
     SelectionPanel        — klass: select, setOpen, updateHead, loadDetails,
                             renderDetails (renderReliability, renderPassport,
                             renderHistory), close, editSelected
     selectionPanel        — yagona nusxa
     selPlayer             — JONLI eksport (let): panel pleyeri (Player | null)
     fmtLastSeen(iso)      — "hozirgina", "5 daqiqa oldin", "12.03.2026 14:05"
     selectCamera(id, fly) — kamerani tanlash (fly=false — xarita uchmaydi)
     setSelOpen(open)      — panel ko'rinishi (body.has-sel)
     updateSelHead()       — sarlavha va tafsilotlarni yangilash
     closeSel()            — tanlovni bekor qilish, oqimni to'xtatish

   Bog'liqliklar:
     import: ../core/state.js, ../core/api.js, ./map.js (hasGeo, map, refreshMarkerIcons),
             ./camera-list.js (MOBILE, renderFootStats, renderList, setListOpen),
             ../player/player.js (createPlayer), ../wall/video-wall.js (saveSnapshot),
             ../layout/notifications.js (addEvent), ../layout/tabs.js (showTab),
             ../admin/camera-form.js (openCameraForm)

   DOM: #sel-body, #sel-empty, #sel-video, #sel-msg, #sel-name, #sel-sub, .sp-st,
        #sel-badge, #sel-badge-tx, #sel-badge-2, #sel-f-region, #sel-f-res,
        #sel-f-seen, #sel-f-codec, #sel-f-model, #sel-f-mode, #sel-f-open, #sel-stamp,
        #sel-f-place, #sel-rel-*, #sel-pass*, #sel-hist*,
        #sel-close, #sel-full, #sel-shot, #sel-edit, #sel-center, #sel-wall
   Backend: GET /api/cameras/{id}/snapshot (poster),
            GET /api/cameras/{id}/details?days=7&history=30 (pasport, ishonchlilik, tarix),
            GET /api/admin/cameras?q=...&limit=50&offset=0 (tahrirlash uchun to'liq yozuv),
            oqim — Player orqali (/api/cameras/{id}/stream)

   Qoidalar / tuzoqlar:
     - Boshqa bo'limdan tanlansa avval xaritaga o'tiladi; showTab("map")
       selectCamera ni o'zi qayta chaqiradi (shuning uchun darhol return).
     - Pleyer bir marta yaratiladi va qayta ishlatiladi (selPlayer).
     - O'chiq kamerada ham oqim sinab ko'riladi (holat 60 s eskirgan bo'lishi mumkin).
     - Tafsilotlar faqat tanlashda so'raladi (updateHead tez-tez chaqiriladi);
       kech kelgan javob detailsFor bilan tekshiriladi.
     - Bo'limlarning ochiq/yopiqligi localStorage'da (try/catch — xotira yopiq bo'lishi mumkin).
   ========================================================================== */
import { $, esc, HEVC_OK, state, toast } from "../core/state.js";
import { api } from "../core/api.js";
import { hasGeo, map, refreshMarkerIcons } from "./map.js";
import { MOBILE, renderFootStats, renderList, setListOpen } from "./camera-list.js";
import { createPlayer } from "../player/player.js";
import { saveSnapshot } from "../wall/video-wall.js";
import { addEvent } from "../layout/notifications.js";
import { showTab } from "../layout/tabs.js";
import { openCameraForm } from "../admin/camera-form.js";

/* Jonli eksport — camera-list.js ochiq oqimlarni sanaydi. SelectionPanel.player
   bilan birga yoziladi. */
export let selPlayer = null;

export function fmtLastSeen(iso) {
  if (!iso) return "ma'lum emas";
  const t = new Date(iso);
  if (isNaN(t)) return "ma'lum emas";
  const diff = (Date.now() - t.getTime()) / 1000;
  if (diff < 90) return "hozirgina";
  if (diff < 3600) return Math.round(diff / 60) + " daqiqa oldin";
  if (diff < 86400) return Math.round(diff / 3600) + " soat oldin";
  const p = (n) => String(n).padStart(2, "0");
  return p(t.getDate()) + "." + p(t.getMonth() + 1) + "." + t.getFullYear() +
         " " + p(t.getHours()) + ":" + p(t.getMinutes());
}

const p2 = (n) => String(n).padStart(2, "0");
/* "07.10 07:42" */
function fmtStamp(iso) {
  const t = new Date(iso);
  return isNaN(t) ? "—" : p2(t.getDate()) + "." + p2(t.getMonth() + 1) + " " + p2(t.getHours()) + ":" + p2(t.getMinutes());
}
/* "45 s", "9 daq", "4,5 soat", "2 kun" */
function fmtDur(sec) {
  if (sec == null) return "—";
  if (sec < 60) return Math.round(sec) + " s";
  if (sec < 3600) return Math.round(sec / 60) + " daq";
  if (sec < 86400) return (sec / 3600).toFixed(1).replace(".", ",") + " soat";
  return Math.round(sec / 86400) + " kun";
}
const VENDORS = { dahua: "Dahua", hikvision: "Hikvision", holowits: "Holowits" };
const HIST = {
  offline: ["uzildi", "bad"], online: ["tiklandi", "ok"],
  stalled: ["tasvir to'xtadi", "warn"], resumed: ["tasvir tiklandi", "ok"],
  transport: ["transport almashdi", "info"], mediamtx: ["media server", "info"],
};

/* ---------- Tanlangan kamera paneli ---------- */
export class SelectionPanel {
  constructor() {
    this.player = null;
    this.details = null;        // GET /cameras/{id}/details javobi (tanlangan kamera)
    this.detailsFor = null;     // qaysi kamera uchun so'ralgan — kech javob boshqasini bosmasin

    // Yig'iladigan bo'limlar holati — ko'ruvchining qulayligi uchun eslab qolinadi.
    ["sel-pass", "sel-hist"].forEach((id) => {
      const el = $(id);
      try { el.open = localStorage.getItem("nigoh." + id) === "1"; } catch (e) { /* xotira yopiq */ }
      el.addEventListener("toggle", () => {
        try { localStorage.setItem("nigoh." + id, el.open ? "1" : "0"); } catch (e) { /* xotira yopiq */ }
      });
    });

    $("sel-close").addEventListener("click", () => this.close());

    // Panel — kichik oldindan ko'rish (keng ekranda ~300 px). Kamerani asl
    // o'lchamida ko'rish uchun to'liq ekran: tugma yoki videoga ikki marta bosish.
    const fullscreen = () => {
      const v = $("sel-video");
      if (document.fullscreenElement) { document.exitFullscreen(); return; }
      (v.requestFullscreen || v.webkitEnterFullscreen || function(){}).call(v);
    };
    $("sel-full").addEventListener("click", fullscreen);
    $("sel-video-wrap").addEventListener("dblclick", fullscreen);

    $("sel-shot").addEventListener("click", () => {
      const cam = state.byId.get(state.selectedId);
      if (cam) saveSnapshot(cam);
    });
    $("sel-edit").addEventListener("click", () => this.editSelected());
    $("sel-center").addEventListener("click", () => {
      const cam = state.byId.get(state.selectedId);
      if (cam && hasGeo(cam)) map.flyTo([cam.lat, cam.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
      else if (cam) toast("Bu kameraga koordinata kiritilmagan", true);
    });

    $("sel-wall").addEventListener("click", () => {
      const id = state.selectedId;
      if (id && !state.pinned.includes(id)) state.pinned.push(id);
      showTab("wall");
    });
  }

  select(id, fly) {
    state.selectedId = id;
    const cam = state.byId.get(id);
    if (!cam) return;
    // Boshqa tab'dan kelinsa avval xaritaga o'tamiz — showTab o'zi qayta chaqiradi.
    if (state.tab !== "map") { showTab("map"); return; }
    if (fly !== false && hasGeo(cam)) map.flyTo([cam.lat, cam.lng], Math.max(map.getZoom(), 13), { duration: 0.6 });

    this.setOpen(true);
    if (MOBILE.matches) setListOpen(false);
    if (this.detailsFor !== id) this.details = null;
    this.updateHead();
    this.loadDetails(id);
    renderList();
    refreshMarkerIcons();

    const video = $("sel-video");
    video.poster = "";
    video.poster = "/api/cameras/" + cam.id + "/snapshot?" + Date.now();
    if (!this.player) selPlayer = this.player = createPlayer(video, $("sel-msg"));
    const player = this.player;
    player.onOpen = (ms, mode) => {
      $("sel-f-open").textContent = (ms / 1000).toFixed(2).replace(".", ",") + " s";
      const modeText = { raw: "xom H.265", direct: "to'g'ridan-to'g'ri",
                         transcode: "H.264 ga o'girilgan", manual: "tashqi oqim" }[mode] || mode;
      $("sel-f-mode").textContent = cam.always_on ? "doim tayyor" : modeText;
      addEvent(cam.name + " — oqim ochildi (" + (ms / 1000).toFixed(1) + " s)", "ok");
    };
    $("sel-f-open").innerHTML = "&mdash;";
    player.open(cam, HEVC_OK);
    // O'chiq kamera — kutish o'rniga darhol sabab ko'rsatiladi (oqim baribir
    // sinab ko'riladi: tekshiruv 60 soniya eskirgan bo'lishi mumkin).
    if (cam.online === false) {
      player.setMsg("Kamera o'chiq · oxirgi onlayn: " + fmtLastSeen(cam.last_seen), "wait");
    }
    renderFootStats();
  }

  /* Keng ekranda panel doim ko'rinadi: tanlov bo'lmasa o'rniga yo'riqnoma
     turadi. Tor ekranda u xarita ustida suzadi — faqat tanlov bo'lsa
     ko'rinadi (body.has-sel, style.css). */
  setOpen(open) {
    $("sel-body").hidden = !open;
    $("sel-empty").hidden = open;
    document.body.classList.toggle("has-sel", open);
  }

  updateHead() {
    const cam = state.byId.get(state.selectedId);
    if (!cam) { this.setOpen(false); return; }
    const down = cam.online === false;
    $("sel-name").textContent = cam.name;
    $("sel-sub").textContent = "ID " + cam.id + (cam.external_id ? " · " + cam.external_id : "");
    document.querySelector(".sp-st").classList.toggle("down", down);
    $("sel-badge").classList.toggle("down", down);
    $("sel-badge-tx").textContent = down ? "Uzilgan" : "Onlayn";
    $("sel-badge-2").textContent = down ? "OFFLINE" : "LIVE";
    $("sel-f-region").textContent = cam.region || "—";
    // Marka + model; model hali aniqlanmagan bo'lsa — faqat marka.
    const vendor = VENDORS[cam.vendor] || "";
    const model = [vendor, cam.model].filter(Boolean).join(" ") || "—";
    $("sel-f-model").textContent = model;
    $("sel-f-model").title = model;
    $("sel-f-seen").textContent = down ? fmtLastSeen(cam.last_seen) : "hozirgina";
    $("sel-f-codec").textContent = cam.codec || "—";
    $("sel-f-mode").textContent = cam.always_on ? "doim tayyor" : "so'rov bo'yicha";
    const now = new Date();
    $("sel-stamp").textContent = p2(now.getDate()) + "-" + p2(now.getMonth() + 1) + "-" +
      now.getFullYear() + " " + p2(now.getHours()) + ":" + p2(now.getMinutes());
    this.renderDetails();
  }

  /* Pasport, ishonchlilik va tarix — kamera tanlanganda bir marta so'raladi. */
  async loadDetails(id) {
    this.detailsFor = id;
    try {
      const d = await api("/api/cameras/" + id + "/details?days=7&history=30");
      if (this.detailsFor !== id) return;            // shu orada boshqa kamera tanlandi
      this.details = d;
    } catch (e) {
      if (this.detailsFor !== id) return;
      this.details = { error: true };
    }
    this.renderDetails();
  }

  renderDetails() {
    const cam = state.byId.get(state.selectedId);
    const d = this.details;
    const ready = !!(d && !d.error && cam && d.id === cam.id);
    const failed = !!(d && d.error);
    const ps = ready ? d.passport : null;

    // Asosiy qatorlar: joy (km/piket) va format + kadr tezligi.
    const km = ps ? ps.km : cam && cam.km;
    const picket = ps ? ps.picket : cam && cam.picket;
    $("sel-f-place").textContent = km != null
      ? km + " km" + (picket ? " · " + picket + "-piket" : "") : "—";
    $("sel-f-place").title = ps && ps.rail_line ? ps.rail_line : "";
    const res = (ps && ps.resolution) || (cam && cam.resolution) || "";
    $("sel-f-res").textContent = (res ? res.replace("x", "×") : "—") +
      (ps && ps.fps ? " · " + Math.round(ps.fps) + " fps" : "");

    this.renderReliability(ready ? d.reliability : undefined, failed);
    this.renderPassport(ps, failed);
    this.renderHistory(ready ? d.history : null, failed);
  }

  renderReliability(r, failed) {
    const ids = ["sel-rel-up", "sel-rel-out", "sel-rel-mttr", "sel-rel-long"];
    const set = (id, v, cls) => { const el = $(id); el.textContent = v; el.className = cls || ""; };
    if (!r) {
      ids.forEach((id) => set(id, "—"));
      $("sel-rel-out-n").textContent = "";
      $("sel-rel-off").textContent = "";
      $("sel-rel-last").textContent = r === null ? "Bu kamera holati kuzatilmaydi (o'chirilgan yoki RTSP emas)."
        : failed ? "Ma'lumotni olib bo'lmadi." : "Yuklanmoqda…";
      return;
    }
    const up = r.uptime_pct;
    $("sel-rel-sub").textContent = "so'nggi " + r.days + " kun";
    set("sel-rel-up", up == null ? "—" : up.toFixed(1).replace(".", ",") + "%",
        up == null ? "" : up >= 99 ? "ok" : up >= 95 ? "warn" : "bad");
    set("sel-rel-out", String(r.outages), r.outages ? "bad" : "ok");
    $("sel-rel-out-n").textContent = r.blips ? "+" + r.blips + " qisqa" : "";
    set("sel-rel-mttr", fmtDur(r.mttr_median_s));
    set("sel-rel-long", r.longest_s ? fmtDur(r.longest_s) : "—");
    $("sel-rel-off").textContent = r.offline_seconds ? "jami " + fmtDur(r.offline_seconds) : "";
    const stalls = r.stalls ? " · " + r.stalls + " marta tasvir to'xtagan" : "";
    const last = r.last_outage;
    $("sel-rel-last").textContent = !last
      ? "Davr davomida bir marta ham uzilmagan" + stalls + "."
      : last.open
        ? "Hozir uzilgan: " + fmtStamp(last.start) + " dan beri (" + fmtDur(last.seconds) + ")."
        : "Oxirgi uzilish: " + fmtStamp(last.start) + ", " + fmtDur(last.seconds) + " davom etgan" + stalls + ".";
  }

  renderPassport(ps, failed) {
    const box = $("sel-pass-rows");
    if (!ps) {
      $("sel-pass-sub").textContent = "";
      box.innerHTML = '<div class="sp-empty-row">' + (failed ? "Ma'lumotni olib bo'lmadi." : "Yuklanmoqda…") + "</div>";
      return;
    }
    const sub = !ps.has_sub ? ["yo'q", ""]
      : ps.sub_bad ? [(ps.sub_codec ? ps.sub_codec + " · " : "") + "ishlamaydi", "bad"]
      : [(ps.sub_codec || "?") + " · ishlaydi", ""];
    const probe = ps.probe_error ? [ps.probe_error, "bad"]
      : ps.probe_at ? ["muvaffaqiyatli · " + fmtStamp(ps.probe_at), ""] : ["hali tekshirilmagan", ""];
    const created = ps.created_at ? new Date(ps.created_at) : null;
    // Model va kodek yuqoridagi asosiy qatorlarda — bu yerda takrorlanmaydi.
    const rows = [
      ["Firmware", ps.firmware || "—"],
      ["O'girish", ps.transcode ? "H.265 → H.264 (server)" : "yo'q — kamera oqimi o'zi"],
      ["Sub oqim", sub[0], sub[1]],
      ["Transport", ps.transport === "udp" ? "UDP (TCP'da kadr kelmagan)" : "TCP"],
      ["Liniya", ps.rail_line || "—"],
      ["Koordinata", ps.lat != null ? ps.lat.toFixed(5) + ", " + ps.lng.toFixed(5) : "kiritilmagan",
       ps.lat == null ? "warn" : ""],
      ["Oxirgi surat", ps.snapshot_at ? fmtLastSeen(ps.snapshot_at) : "—"],
      ["Pasport tekshiruvi", probe[0], probe[1]],
      ["Qo'shilgan", created && !isNaN(created)
        ? p2(created.getDate()) + "." + p2(created.getMonth() + 1) + "." + created.getFullYear() : "—"],
    ];
    if (ps.note) rows.push(["Izoh", ps.note]);
    $("sel-pass-sub").textContent = ps.firmware ? "fw " + ps.firmware.split(",")[0] : "";
    box.innerHTML = rows.map(([k, v, cls]) =>
      "<div><dt>" + k + '</dt><dd class="' + (cls || "") + '" title="' + esc(String(v)) + '">' +
      esc(String(v)) + "</dd></div>").join("");
  }

  renderHistory(list, failed) {
    const box = $("sel-hist-rows");
    if (!list) {
      $("sel-hist-sub").textContent = "";
      box.innerHTML = '<li class="sp-empty-row">' + (failed ? "Ma'lumotni olib bo'lmadi." : "Yuklanmoqda…") + "</li>";
      return;
    }
    $("sel-hist-sub").textContent = list.length ? list.length + " hodisa · 30 kun" : "30 kunda hodisa yo'q";
    if (!list.length) {
      box.innerHTML = '<li class="sp-empty-row">So‘nggi 30 kunda hodisa qayd etilmagan.</li>';
      return;
    }
    // Ro'yxat yangisi birinchi: "tiklandi" dan keyingi (eskiroq) "uzildi" — o'sha uzilish.
    box.innerHTML = list.map((h, i) => {
      const [label, cls] = HIST[h.kind] || [h.kind, "info"];
      let note = h.kind === "transport" ? h.detail : "";
      const pair = { online: "offline", resumed: "stalled" }[h.kind];
      if (pair) {
        const prev = list.slice(i + 1).find((x) => x.kind === pair || x.kind === h.kind);
        if (prev && prev.kind === pair) note = fmtDur((new Date(h.ts) - new Date(prev.ts)) / 1000) + " dan keyin";
      }
      return '<li class="' + cls + '"><i></i><span class="hk">' + label +
        (note ? "<em>" + esc(note) + "</em>" : "") + "</span><time>" + fmtStamp(h.ts) + "</time></li>";
    }).join("");
  }

  close() {
    state.selectedId = null;
    this.setOpen(false);
    if (this.player) this.player.stop();
    renderList();
    refreshMarkerIcons();
    renderFootStats();
  }

  async editSelected() {
    const cam = state.byId.get(state.selectedId);
    if (!cam) return;
    if (!state.admin) { toast("Avval super-admin sifatida kiring", true); return; }
    // Shakl to'liq yozuvni talab qiladi (IP, login, yo'l) — uni admin API dan
    // nomi bo'yicha qidirib olamiz; topilmasa boshqaruv bo'limiga o'tkazamiz.
    try {
      const res = await api("/api/admin/cameras?q=" + encodeURIComponent(cam.name) +
                            "&limit=50&offset=0");
      const full = (res.cameras || []).find((c) => c.id === cam.id);
      if (full) { openCameraForm(full); return; }
    } catch (e) { /* pastda boshqaruvga o'tamiz */ }
    toast("Kamera yozuvi topilmadi — boshqaruv bo'limidan tahrirlang", true);
    showTab("admin");
  }
}

export const selectionPanel = new SelectionPanel();

export function selectCamera(id, fly) { selectionPanel.select(id, fly); }
export function setSelOpen(open) { selectionPanel.setOpen(open); }
export function updateSelHead() { selectionPanel.updateHead(); }
export function closeSel() { selectionPanel.close(); }
