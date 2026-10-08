/* ==========================================================================
   wall/tile.js — Video/Tile (Figma 60:69): devor va Fokus katagi
   --------------------------------------------------------------------------
   Vazifasi:
     Bitta kamera katagi: kadr (oqim), ustki/ostki scrim, holat nuqtasi + nom +
     hudud, "LIVE" belgisi (Live/Pulse), pastda "kodek · ochilish vaqti".
     Holatlar (data-state): connecting (Live/Spinner + "Ulanmoqda…"; 3 s dan
     keyin "Qayta urinish"), live, offline ("Uzilgan · 10 daq oldin" +
     "Qayta ulash"), fail (oqim ochilmadi — 3 s dan keyin bir marta o'zi
     qayta urinadi, keyin "Qayta ulash"). Hover: Surat · Xaritada · Fokus
     amallari + ko'k chegara (CSS).

   Eksport:
     WallTile                 — klass: el, cam, player, quality, openMs;
                                start(quality), setQuality(q), update(cam), stop(),
                                setSelected(on), onOpenMs (ms) — tashqi kuzatuvchi
     fmtCodec(codec)          — "H265" → "H.265"
     fmtSec(ms)               — 2600 → "2,6 s"
     fmtAgo(iso)              — "10 daq oldin"
     camStatus(cam)           — online | no-video | offline | disabled | unknown
     isDown(cam)              — kamera uzilgan/o'chirilganmi (oqim ochilmaydi)
     STATUS_TEXT              — holat → o'zbekcha nom

   Bog'liqliklar:
     import: ../core/state.js (HEVC_OK, esc), ../core/icons.js (icon),
             ../core/ui.js (tooltip), ../player/player.js (createPlayer)

   Qoidalar / tuzoqlar:
     - Pleyer xabari (msgEl) yashirin: holatni Player.onState orqali o'zimiz
       chizamiz (Figma ko'rinishi), matnni esa spinner ostida ko'rsatamiz.
     - Uzilgan kamerada pleyer yaratilmaydi; "Qayta ulash" baribir urinib
       ko'radi (server holati 60 s kechikishi mumkin).
     - quality: "" — asosiy oqim, "sub" — past (Player.open ga shu holicha).
   ========================================================================== */
import { HEVC_OK, esc } from "../core/state.js";
import { icon } from "../core/icons.js";
import { tooltip } from "../core/ui.js";
import { createPlayer } from "../player/player.js";

export const STATUS_TEXT = {
  online: "Onlayn", "no-video": "Tasvirsiz", offline: "Uzilgan",
  disabled: "Oʻchirilgan", unknown: "Nomaʼlum",
};

export function camStatus(cam) {
  const s = cam && cam.state;
  if (s === "online") return "online";
  if (s === "stalled") return "no-video";
  if (s === "offline") return "offline";
  if (s === "disabled") return "disabled";
  if (cam && cam.online === false) return "offline";
  return cam && cam.online === true ? "online" : "unknown";
}

export function isDown(cam) {
  const s = camStatus(cam);
  return s === "offline" || s === "disabled";
}

export function fmtCodec(codec) {
  if (!codec) return "—";
  const c = String(codec).toUpperCase();
  const m = c.match(/^H\.?(\d{3})$/);
  return m ? "H." + m[1] : c;
}

export function fmtSec(ms) {
  if (ms == null || !isFinite(ms)) return "—";
  return (ms / 1000).toFixed(1).replace(".", ",") + " s";
}

export function fmtAgo(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "hozirgina";
  if (s < 3600) return Math.round(s / 60) + " daq oldin";
  if (s < 86400) return Math.round(s / 3600) + " soat oldin";
  return Math.round(s / 86400) + " kun oldin";
}

/* Ulanish shuncha cho'zilsa "Qayta urinish" tugmasi chiqadi (Video/Preview tavsifi). */
const RETRY_HINT_MS = 3000;
/* Oqim ochilmasa — bir marta shuncha kutib o'zi qayta urinadi. */
const AUTO_RETRY_MS = 3000;

export class WallTile {
  /* opts: { actions: bool (hover amallari), onFocus(cam), onShot(cam), onMap(cam) } */
  constructor(cam, opts = {}) {
    this.cam = cam;
    this.opts = opts;
    this.player = null;
    this.quality = "sub";
    this.openMs = null;
    this.onOpenMs = null;
    this.timers = [];
    this.autoRetried = false;
    this.el = this.render();
    this.update(cam);
  }

  render() {
    const el = document.createElement("div");
    el.className = "wl-tile";
    el.dataset.id = this.cam.id;
    el.tabIndex = 0;
    el.innerHTML =
      '<video class="wl-tile__video" muted playsinline autoplay></video>' +
      '<div class="wl-tile__scrim wl-tile__scrim--t"></div><div class="wl-tile__scrim wl-tile__scrim--b"></div>' +
      '<div class="wl-tile__head"><span class="wl-tile__dot"></span>' +
        '<span class="wl-tile__name ellipsis"></span><span class="wl-tile__region ellipsis"></span></div>' +
      '<span class="wl-tile__live"><span class="wl-tile__pulse pulse"></span>JONLI</span>' +
      '<div class="wl-tile__center"></div>' +
      '<span class="wl-tile__meta"></span>' +
      (this.opts.actions === false ? "" :
        '<div class="wl-tile__acts">' +
          '<button type="button" data-act="shot" data-tip="Suratni saqlash">' + icon("camera", "sm") + "</button>" +
          '<button type="button" data-act="map" data-tip="Xaritada koʻrsatish">' + icon("location-crosshairs", "sm") + "</button>" +
          '<button type="button" data-act="focus" data-tip="Fokus rejimida ochish">' + icon("maximize", "sm") + "</button>" +
        "</div>") +
      '<span class="wl-tile__msg" hidden></span>';
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      e.stopPropagation();
      const act = b.dataset.act;
      if (act === "retry") { this.reconnect(); return; }
      const fn = { shot: this.opts.onShot, map: this.opts.onMap, focus: this.opts.onFocus }[act];
      if (fn) fn(this.cam);
    });
    el.addEventListener("dblclick", (e) => e.stopPropagation());
    tooltip.label(el);
    return el;
  }

  q(sel) { return this.el.querySelector(sel); }

  /* Kamera ma'lumoti yangilandi (har 30 s): nom, hudud, holat. */
  update(cam) {
    const wasDown = isDown(this.cam);
    this.cam = cam;
    this.q(".wl-tile__name").textContent = cam.name;
    // Ba'zi bazalarda hudud nomi kamera nomi bilan bir xil — ikki marta yozmaymiz.
    this.q(".wl-tile__region").textContent = cam.region && cam.region !== cam.name ? cam.region : "";
    const down = isDown(cam);
    if (down && !this.player) this.paint("offline");
    else if (down && this.state !== "live") { this.stopPlayer(); this.paint("offline"); }
    else if (!down && wasDown && this.state === "offline" && this.started) this.start(this.quality);
    else if (this.state === "offline") this.paint("offline");     // "N daq oldin" yangilansin
  }

  /* Oqimni boshlash (uzilgan kamerada — faqat "Uzilgan" ko'rinishi). */
  start(quality) {
    this.started = true;
    this.quality = quality;
    if (isDown(this.cam)) { this.paint("offline"); return; }
    this.open();
  }

  open() {
    this.clearTimers();
    if (!this.player) {
      this.player = createPlayer(this.q("video"), this.q(".wl-tile__msg"));
      this.player.onOpen = (ms) => {
        this.openMs = ms;
        this.autoRetried = false;
        this.paint("live");
        if (this.onOpenMs) this.onOpenMs(ms);
      };
      this.player.onState = (kind, text) => {
        if (kind === "wait") this.paint("connecting", text);
        else if (kind === "fail") this.failed(text);
      };
    }
    this.paint("connecting", "Ulanmoqda…");
    this.player.open(this.cam, HEVC_OK, this.quality);
  }

  failed(text) {
    this.paint("fail", text);
    if (this.autoRetried) return;
    this.autoRetried = true;
    this.timers.push(setTimeout(() => { if (this.state === "fail") this.open(); }, AUTO_RETRY_MS));
  }

  /* "Qayta ulash" / "Qayta urinish" — faqat shu kamera qayta so'raladi. */
  reconnect() {
    this.autoRetried = true;          // qo'lda bosildi — o'zi takrorlamaydi
    this.started = true;
    this.open();
  }

  setQuality(q) {
    if (q === this.quality) return;
    this.quality = q;
    if (this.player && this.state !== "offline") this.open();
  }

  setSelected(on) { this.el.classList.toggle("is-sel", !!on); }

  /* Ko'rinish: holat nuqtasi, LIVE, markaz, pastki yozuv. */
  paint(st, text) {
    const prev = this.state;
    this.state = st;
    this.el.dataset.state = st;
    const cam = this.cam;
    const dot = { live: "online", connecting: "no-video", offline: "offline", fail: "offline" }[st];
    this.q(".wl-tile__dot").dataset.status = dot;
    const codec = fmtCodec(cam.codec);
    const meta = st === "live" ? codec + " · " + fmtSec(this.openMs)
      : st === "connecting" ? codec + " · …" : codec + " · —";
    this.q(".wl-tile__meta").textContent = meta;
    const c = this.q(".wl-tile__center");
    const retryBtn = (label) => '<button type="button" class="wl-tile__retry" data-act="retry">' +
      icon("rotate-cw", "sm") + esc(label) + "</button>";
    if (st === "live") c.innerHTML = "";
    else if (st === "connecting" && prev === "connecting" && c.querySelector(".wl-tile__spin")) {
      c.querySelector(".wl-tile__text").textContent = text || "Ulanmoqda…";
    } else if (st === "connecting") {
      c.innerHTML = '<span class="spinner wl-tile__spin" aria-hidden="true"></span>' +
        '<span class="wl-tile__text wl-tile__text--muted">' + esc(text || "Ulanmoqda…") + "</span>" +
        '<span class="wl-tile__later" hidden>' + retryBtn("Qayta urinish") + "</span>";
      this.timers.push(setTimeout(() => {
        const l = this.state === "connecting" && c.querySelector(".wl-tile__later");
        if (l) l.hidden = false;
      }, RETRY_HINT_MS));
    } else {
      const ago = fmtAgo(cam.last_seen);
      const msg = st === "offline"
        ? (camStatus(cam) === "disabled" ? "Oʻchirilgan" : "Uzilgan" + (ago ? " · " + ago : ""))
        : "Oqim ochilmadi";
      c.innerHTML = icon("camera-slash", "lg") +
        '<span class="wl-tile__text"' + (st === "fail" && text ? ' title="' + esc(text) + '"' : "") + ">" +
        esc(msg) + "</span>" + retryBtn("Qayta ulash");
    }
  }

  clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }

  stopPlayer() {
    this.clearTimers();
    if (this.player) { this.player.onState = null; this.player.stop(); this.player = null; }
  }

  stop() {
    this.stopPlayer();
    this.started = false;
    this.el.remove();
  }
}
