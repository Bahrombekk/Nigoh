/* ==========================================================================
   map/selection.js — tanlangan kamera paneli (o'ng panel)
   --------------------------------------------------------------------------
   Vazifasi:
     Xaritada/ro'yxatda tanlangan kamera: jonli video, sarlavha va
     tafsilotlar (hudud, kodek, rejim, oxirgi onlayn), panel tugmalari
     (yopish, to'liq ekran, surat, tahrirlash, markazlash, devorga qo'shish).

   Eksport:
     SelectionPanel        — klass: select, setOpen, updateHead, close, editSelected
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
        #sel-f-seen, #sel-f-codec, #sel-f-mode, #sel-f-open, #sel-stamp,
        #sel-close, #sel-full, #sel-shot, #sel-edit, #sel-center, #sel-wall
   Backend: GET /api/cameras/{id}/snapshot (poster),
            GET /api/admin/cameras?q=...&limit=50&offset=0 (tahrirlash uchun to'liq yozuv),
            oqim — Player orqali (/api/cameras/{id}/stream)

   Qoidalar / tuzoqlar:
     - Boshqa bo'limdan tanlansa avval xaritaga o'tiladi; showTab("map")
       selectCamera ni o'zi qayta chaqiradi (shuning uchun darhol return).
     - Pleyer bir marta yaratiladi va qayta ishlatiladi (selPlayer).
     - O'chiq kamerada ham oqim sinab ko'riladi (holat 60 s eskirgan bo'lishi mumkin).
   ========================================================================== */
import { $, HEVC_OK, state, toast } from "../core/state.js";
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

/* ---------- Tanlangan kamera paneli ---------- */
export class SelectionPanel {
  constructor() {
    this.player = null;

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
    this.updateHead();
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
    $("sel-f-res").textContent = cam.resolution || "—";
    $("sel-f-seen").textContent = down ? fmtLastSeen(cam.last_seen) : "hozirgina";
    $("sel-f-codec").textContent = cam.codec || "—";
    $("sel-f-mode").textContent = cam.always_on ? "doim tayyor" : "so'rov bo'yicha";
    const p = (n) => String(n).padStart(2, "0");
    const now = new Date();
    $("sel-stamp").textContent = p(now.getDate()) + "-" + p(now.getMonth() + 1) + "-" +
      now.getFullYear() + " " + p(now.getHours()) + ":" + p(now.getMinutes());
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
