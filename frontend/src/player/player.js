/* player/player.js — v3 frontend/js/player/player.js dan ko'chirilgan (React'da: usePlayer hook, ./usePlayer.ts).
   Mantiq o'zgarmagan; global holat o'rniga openTimes.js. */
/* ==========================================================================
   player/player.js — video pleyer (WebRTC WHEP -> HLS zaxira)
   --------------------------------------------------------------------------
   Vazifasi:
     Bitta <video> elementida kamera oqimini ochish: avval WebRTC (WHEP),
     6 s da kadr kelmasa — HLS (hls.js yoki Safari'ning o'zi). Ochilish
     vaqtini o'lchaydi, holat yozuvini (ulanmoqda / xato / kutish) boshqaradi.
     Har pleyer o'z holatini olib yuradi — devorda bir nechtasi birga ishlaydi.
     Shu yerda yana: seans bo'yicha WebRTC sog'ligi hisobi va hover'da
     kamerani oldindan uyg'otish (prewarm).

   Eksport:
     Player                    — klass: open(cam, useHevc, quality), stop(), retry(), setMsg(text, kind);
                                 maydonlar: video, onOpen(ms, mode), mode,
                                 onState(kind, text) — ixtiyoriy: har xabar o'zgarishida
                                 ("wait" | "fail" | "" — tozalandi); devor plitkasi o'z
                                 ko'rinishini shu bilan chizadi
     createPlayer(video, msgEl) — new Player(...) (eski nom)
     WebRtcHealth              — klass: isDead(), note(ok) — WebRTC jim qolishini sanaydi
     webrtcHealth              — yagona nusxa
     webrtcDead()              — bu seansda WebRTC o'chirilganmi (HLS darhol)
     noteWebRtc(ok)            — WebRTC urinishi natijasini qayd etish
     StreamPrewarmer           — klass: warm(cam) — hover intent bilan kamerani uyg'otish
     prewarmer                 — yagona nusxa
     prewarm(cam)              — prewarmer.warm ga yo'naltiradi

   Bog'liqliklar:
     import: ./env.js (HEVC_OK, PLAYOUT_DELAY), ./openTimes.js, @/lib/api,
     global: RTCPeerConnection, Hls (hls.js@1 — index.html da CDN dan), fetch

   DOM: konstruktorga berilgan <video> va xabar elementi (.pmsg klassi qo'shiladi)
   Backend: GET /api/cameras/{id}/stream?hevc=0|1[&quality=sub] — chiptali manzillar
              (webrtc_url, stream_url, mode),
            POST {webrtc_url} (WHEP, application/sdp) — MediaMTX,
            {stream_url} (.m3u8) — HLS,
            GET /api/cameras/{id}/snapshot (poster va prewarm)

   Qoidalar / tuzoqlar:
     - `token`: har open/stop uni oshiradi; eski urinishning kechikkan
       javoblari (stale) hech narsaga tegmaydi.
     - Bekor qilingan urinish va "ICE ulangan, kadr yo'q" holati WebRTC'ni
       o'chirishga SANALMAYDI (batafsil — WebRtcHealth izohida).
     - WHEP 400 "source timed out / no stream / not ready" — kamera aybdor:
       HLS'ga o'tilmaydi, darhol aniq xabar chiqadi.
     - prewarm oqimni OCHMAYDI — faqat chipta va surat so'raydi (WAN to'yinmasin).
   ========================================================================== */
import { HEVC_OK, PLAYOUT_DELAY } from "./env.js";
import { openTimes } from "./openTimes.js";
/* hls.js dinamik yuklanadi (alohida bo'lak) — playHls birinchi chaqirilganda. */
let Hls = null;
let hlsLoading = null;
function loadHls() {
  if (!hlsLoading) hlsLoading = import("hls.js").then((m) => { Hls = m.default; return Hls; });
  return hlsLoading;
}
import { api } from "@/lib/api";
import { getCurrentLang, translate } from "@/i18n/core.js";

/* WebRTC serverda umuman ishlamasligi mumkin — va bu tasodifiy emas.

   MediaMTX ICE nomzodlari sifatida faqat o'z interfeys manzillarini
   (127.0.0.1, 192.168.x, docker0) e'lon qilsa, internetdagi brauzer
   ularning birortasiga yeta olmaydi: signalizatsiya muvaffaqiyatli
   o'tadi, kadr esa hech qachon kelmaydi. Serverda o'lchandi — 5 ta
   kameradan 5 tasi 12 soniyada bitta ham kadr bermadi.

   Bunda har ochilish 6 soniyani behuda kutishga sarflardi: pleyer
   WebRTC'ni sinaydi, jim qoladi, keyin HLS'ga tushadi. Kamera almashsa
   yana 6 soniya. Ketma-ket ikki marta jim qolgandan keyin bu seansda
   WebRTC sinalmaydi — HLS darhol boshlanadi.

   Bir marta jim qolish sabab emas: kamera ayni damda uyg'onayotgan
   bo'lishi mumkin. Muvaffaqiyatli ochilish hisobni nolga qaytaradi.

   Bekor qilingan urinish (foydalanuvchi boshqa kamerani bosdi) HECH QACHON
   sanalmaydi. Ilgari sanalardi: kameralarni ketma-ket ko'rib chiqqan
   foydalanuvchida WebRTC ikki bosishda o'chib, butun seans 7-17 s lik
   HLS'ga tushardi (lokal o'lchov: WebRTC 15 dan 14 kamerada 3-7 s da
   ochiladi). Kadr bermaydigan kamera ham sanalmaydi — ICE ulangan bo'lsa
   aybdor tarmoq emas. O'chgan WebRTC ham 2 daqiqadan keyin qayta
   sinaladi — bitta yomon daqiqa butun ish kunini sekinlashtirmasin.

   (Bu hisob ilgari camera-list.js da turardi; mazmunan pleyerniki.) */
const WEBRTC_JIM_CHEGARA = 2;
const WEBRTC_QAYTA_SINASH = 120000;           // ms

export class WebRtcHealth {
  constructor() {
    this.webrtcJim = 0;
    this.webrtcJimAt = 0;
  }

  isDead() {
    if (this.webrtcJim < WEBRTC_JIM_CHEGARA) return false;
    if (Date.now() - this.webrtcJimAt > WEBRTC_QAYTA_SINASH) { this.webrtcJim = 0; return false; }
    return true;
  }

  note(ok) {
    if (ok) { this.webrtcJim = 0; return; }
    this.webrtcJim++;
    this.webrtcJimAt = Date.now();
    if (this.webrtcJim === WEBRTC_JIM_CHEGARA) {
      console.warn("Nigoh: WebRTC kadr bermayapti — bu seansda faqat HLS " +
                   "ishlatiladi. Serverda webrtcAdditionalHosts sozlanmagan " +
                   "yoki ICE porti yopiq boʻlishi mumkin.");
    }
  }
}

export const webrtcHealth = new WebRtcHealth();

/* WebRTC'da ochilmaydigan kameralar eslab qolinadi (foydalanuvchi talabi).

   Ba'zi kameralar WebRTC'da hech qachon kadr bermaydi (kodek/paket
   yo'qotish/NVR) — har ochilishda 6 s WebRTC'ni kutib, keyin HLS'ga
   ("Zaxira yo'l orqali ulanmoqda…") o'tardi. HLS'da muvaffaqiyatli
   ochilgan bunday kamera (va sifat) HLS_MEMO_MS davomida eslab qolinadi
   va keyingi safar to'g'ridan HLS bilan ochiladi. Muddat o'tgach WebRTC
   yana sinaladi — kamera tuzalgan bo'lishi mumkin. HLS ham ochilmasa
   yozuv o'chiriladi. Brauzerda saqlanadi (localStorage). */
const HLS_MEMO_KEY = "nigoh.hlsOnly";
const HLS_MEMO_MS = 12 * 3600 * 1000;

function hlsMemo() {
  try {
    const m = JSON.parse(localStorage.getItem(HLS_MEMO_KEY) || "{}");
    return m && typeof m === "object" ? m : {};
  } catch { return {}; }
}
function hlsMemoSave(m) {
  const now = Date.now();
  for (const k of Object.keys(m)) if (now - m[k] > HLS_MEMO_MS) delete m[k];
  try { localStorage.setItem(HLS_MEMO_KEY, JSON.stringify(m)); } catch { /* yashirin rejim */ }
}
export function hlsPreferred(key) {
  const ts = hlsMemo()[key];
  return !!ts && Date.now() - ts < HLS_MEMO_MS;
}
function rememberHls(key, on) {
  const m = hlsMemo();
  if (on) m[key] = Date.now(); else if (key in m) delete m[key]; else return;
  hlsMemoSave(m);
}

export function webrtcDead() { return webrtcHealth.isDead(); }
export function noteWebRtc(ok) { webrtcHealth.note(ok); }

/* ---------- Video pleyer (WebRTC -> HLS) ----------
   Har bir pleyer o'z holatini olib yuradi — devorda bir nechta birga ishlaydi. */

/* ---------- Oqimni uzatish (handoff) ----------
   Xaritada kamera popover'da (sub oqim) o'ynab turibdi; "Batafsil" yoki
   to'liq ekran bosilsa yangi oyna o'z pleyerini ochardi va video yana
   "Ulanmoqda…" bo'lib qolardi (foydalanuvchi shikoyati). Endi:
     - pleyer to'xtaganda jonli WebRTC ulanishi darhol yopilmaydi —
       HANDOFF_MS davomida "to'xtab turadi" (park);
     - shu kamerani ochgan pleyer uni darhol oladi: sifat bir xil bo'lsa
       o'sha ulanish davom etadi, boshqa bo'lsa (sub -> asosiy) eski oqim
       ko'rinib turadi, yangisi FONDA ulanadi va birinchi kadri kelgach
       almashadi (qora ekran va "Ulanmoqda" yo'q);
     - boshqa pleyer shu kamerani ko'rsatib turgan bo'lsa (masalan devor),
       uning oqimi ham shunday olinadi.
   Bitta MediaStream bir nechta <video> da birga ko'rsatilishi mumkin. */
const HANDOFF_MS = 8000;
// Uzatilgan past sifat ko'rinib turganda asosiy sifat necha marta qayta so'raladi.
const MAIN_RETRY_MAX = 2;
const MAIN_RETRY_MS = 3000;
const MAX_PARKED = 4;                         // devor sahifalanganda ulanishlar ko'payib ketmasin
const allPlayers = new Set();
const parked = new Map();                     // camId -> { pc, stream, quality, timer }

/* Keyingi ko'rinishda aniq kerak bo'ladigan kameralar (devor -> Fokus: bosilgan
   kamera va "Keyingi kameralar"). Devor yopilganda 16-64 plitka bir vaqtda
   to'xtab park qilinadi va MAX_PARKED eskilarini yopadi — bosilgan kameraning
   oqimi ko'pincha shular orasida qolib, Fokus uni qaytadan ochardi
   (foydalanuvchi shikoyati). Zahiradagilar chegaraga kirmaydi va siqib
   chiqarilmaydi; zahira HANDOFF_MS dan keyin o'zi tugaydi. */
const reserved = new Map();                   // camId -> amal qilish muddati (ms)

export function reserveHandoff(ids) {
  const until = Date.now() + HANDOFF_MS;
  for (const id of ids) if (id != null) reserved.set(id, until);
}

function isReserved(camId) {
  const until = reserved.get(camId);
  if (until == null) return false;
  if (until < Date.now()) { reserved.delete(camId); return false; }
  return true;
}

function closeParked(camId) {
  const e = parked.get(camId);
  if (!e) return;
  clearTimeout(e.timer);
  parked.delete(camId);
  e.pc.close();
}

function parkStream(camId, quality, pc, stream) {
  // Shu oqimni egasiz ko'rsatib turgan pleyer bo'lsa — ulanish unga o'tadi.
  for (const p of allPlayers) {
    if (p.preview && p.preview.stream === stream && !p.preview.pc) { p.preview.pc = pc; return; }
  }
  if (parked.has(camId) && parked.get(camId).pc !== pc) closeParked(camId);
  if (!isReserved(camId)) {
    // Chegara faqat zahirada bo'lmaganlarga: eng eskisi yopiladi.
    const plain = () => [...parked.keys()].filter((id) => !isReserved(id));
    for (let ids = plain(); ids.length >= MAX_PARKED; ids = plain()) closeParked(ids[0]);
  }
  const timer = setTimeout(() => {
    if (parked.get(camId)?.pc === pc) { parked.delete(camId); pc.close(); }
  }, HANDOFF_MS);
  parked.set(camId, { pc, stream, quality, timer });
}

function takeParked(camId) {
  const e = parked.get(camId);
  if (!e) return null;
  clearTimeout(e.timer);
  parked.delete(camId);
  reserved.delete(camId);
  if (["failed", "closed"].includes(e.pc.connectionState)) { e.pc.close(); return null; }
  return e;
}

/* Shu kamerani hozir jonli ko'rsatib turgan boshqa pleyerning oqimi. */
function findLive(camId, except) {
  for (const p of allPlayers) {
    if (p === except || !p.active || p.liveCam !== camId) continue;
    if (p.pc && p.pc.__stream && p.webrtcLive) return { stream: p.pc.__stream, quality: p.liveQuality, pc: null };
    if (p.preview) return { stream: p.preview.stream, quality: p.preview.quality, pc: null };
  }
  return null;
}

const FAIL_MSG = "Oqim ochilmadi — MediaMTX ishlayotganini va kamera ulanganini tekshiring";

export class Player {
  constructor(video, msgEl) {
    this.video = video;
    this.msgEl = msgEl;
    this.hls = null;
    this.pc = null;
    this.token = 0;
    this.onOpen = null;
    this.last = null;
    this.onCleanup = null;
    this.onState = null;
    this.active = false;              // open() dan keyin true, stop() dan keyin false
    this.webrtcLive = false;          // this.pc kadr beryapti (uzatishga yaroqli)
    this.liveCam = null;              // qaysi kamera / sifat ko'rsatilyapti (uzatish uchun)
    this.liveQuality = "";
    this.preview = null;              // { pc|null, stream, quality } — uzatilgan oqim, asosiysi kutilmoqda
    allPlayers.add(this);
    // Tab/oynaga qaytilganda: brauzer fon tabida videoni pauza qiladi yoki
    // dekodlashni to'xtatadi — qaytgach kadr kelmay ekran qora qolardi.
    this.onVisible = () => this.wake();
    document.addEventListener("visibilitychange", this.onVisible);
    msgEl.classList.add("pmsg");
    msgEl.addEventListener("click", (e) => {
      if (!msgEl.classList.contains("fail") || !this.last) return;
      e.stopPropagation();
      this.retry();
    });
  }

  /* Xabar turi: "wait" — aylanma bilan; "fail" — bosilsa qayta uriniladi. */
  setMsg(text, kind) {
    const msgEl = this.msgEl;
    msgEl.textContent = text ? translate(text, getCurrentLang()) : text;   // joriy tilda
    msgEl.classList.toggle("wait", kind === "wait");
    msgEl.classList.toggle("fail", kind === "fail");
    if (this.onState) this.onState(text ? (kind || "") : "", text);
  }

  /* Oxirgi open() ni qayta chaqirish ("Qayta ulash"). Joriy ulanish
     uzatishga qo'yilmaydi — aks holda open() o'sha o'lik ulanishni
     darhol qaytarib olardi va qayta ulanish hech narsa o'zgartirmasdi. */
  retry() {
    if (!this.last) return;
    this.discardLive();
    this.open(...this.last);
  }

  discardLive() {
    if (this.pc) { this.pc.close(); this.pc = null; }
    if (this.preview && this.preview.pc) this.preview.pc.close();
    this.preview = null;
    this.webrtcLive = false;
    if (this.liveCam != null) closeParked(this.liveCam);
  }

  /* Sahifa yana ko'rindi: video davom ettiriladi; 2,5 s ichida YANGI KADR
     chizilmasa (pauza, uzilgan WebRTC, eskirgan HLS) oqim qayta ochiladi.

     Kadr requestVideoFrameCallback bilan tekshiriladi. Ilgari currentTime
     qaralardi — Chrome'da WebRTC oqimi fon tabidan qaytgach ekran qora
     qolsa ham currentTime yuraveradi (MediaStream soati), shuning uchun
     pleyer "ishlayapti" deb o'ylab qayta ulanmasdi (foydalanuvchi shikoyati). */
  wake() {
    if (document.hidden || !this.active || !this.last) return;
    const video = this.video;
    if (video.paused) video.play().catch(() => {});
    const t0 = video.currentTime;
    const my = this.token;
    const rvfc = typeof video.requestVideoFrameCallback === "function";
    let frames = 0;
    if (rvfc) {
      const tick = () => { frames++; if (frames < 3 && this.token === my) video.requestVideoFrameCallback(tick); };
      video.requestVideoFrameCallback(tick);
    }
    setTimeout(() => {
      if (document.hidden || !this.active || this.token !== my) return;
      const frozen = rvfc ? frames === 0 : (video.readyState < 2 || video.currentTime <= t0 + 0.05);
      if (frozen) this.retry();
    }, 2500);
  }

  /* Pleyer butunlay olib tashlanadi (komponent yopilganda). */
  destroy() {
    this.stop();
    allPlayers.delete(this);
    document.removeEventListener("visibilitychange", this.onVisible);
  }

  stop() {
    const video = this.video;
    this.active = false;
    this.token++;
    // Kutish yozuvining taymerlari — pleyer yopilgach xabar yangilanmasin.
    if (this.onCleanup) { this.onCleanup(); this.onCleanup = null; }
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    this.dropOverlay();
    // Jonli WebRTC yopilmaydi — qisqa muddat boshqa pleyerga uzatish uchun turadi.
    const camId = this.liveCam;
    if (this.preview) {
      const pv = this.preview;
      this.preview = null;
      if (pv.pc && camId != null) parkStream(camId, pv.quality, pv.pc, pv.stream);
    }
    if (this.pc) {
      if (this.webrtcLive && camId != null && this.pc.__stream) parkStream(camId, this.liveQuality, this.pc, this.pc.__stream);
      else this.pc.close();
      this.pc = null;
    }
    this.webrtcLive = false;
    this.liveCam = null;
    video.pause();
    video.removeAttribute("src");
    video.srcObject = null;
    video.load();
    this.setMsg("");
  }

  open(cam, useHevc, quality) {
    const video = this.video;
    this.stop();
    this.active = true;
    this.liveCam = cam.id;
    this.last = [cam, useHevc, quality];
    this.mainRetries = 0;
    const my = ++this.token;
    const stale = () => this.token !== my;
    const t0 = performance.now();
    this.setMsg("Ulanmoqda…", "wait");
    if (!video.poster) video.poster = "/api/cameras/" + cam.id + "/snapshot";
    const q = quality || "";

    const opened = () => {
      if (stale()) return;
      this.setMsg("");
      const ms = performance.now() - t0;
      openTimes.add(cam.id, ms);   // seans o'lchovlari — "nigoh:open-time" hodisasi
      if (this.onOpen) this.onOpen(ms, this.mode);
    };
    video.addEventListener("playing", opened, { once: true });

    // Uzatish: to'xtab turgan yoki boshqa pleyerda o'ynayotgan oqim darhol ko'rsatiladi.
    const src = takeParked(cam.id) || findLive(cam.id, this);
    if (src) {
      video.srcObject = src.stream;
      video.play().catch(() => {});
      this.setMsg("");
      if (src.pc && src.quality === q) {
        // O'sha ulanish to'liq qabul qilinadi — yangi ulanish kerak emas.
        this.pc = src.pc;
        this.webrtcLive = true;
        this.liveQuality = q;
        this.mode = "webrtc";
        return;
      }
      this.preview = { pc: src.pc, stream: src.stream, quality: src.quality };
      // Boshqa pleyerdagi aynan shu sifatli oqim — uni ko'rsatish kifoya
      // (egasi yopilsa ulanish shu pleyerga o'tadi, parkStream).
      if (src.quality === q) { this.mode = "webrtc"; return; }
    }

    api("/api/cameras/" + cam.id + "/stream?hevc=" + (useHevc ? 1 : 0) +
        (quality ? "&quality=" + quality : ""))
      .then((urls) => {
        if (stale()) return;
        this.mode = urls.mode;
        // Sub oqim ishlamasa — asosiyga; xom H.265 amalda o'qilmasa —
        // bir marta o'girilganiga qaytamiz.
        const onFail = urls.mode === "sub"
          ? () => { if (!stale()) this.open(cam, useHevc); }
          : urls.mode === "raw"
            ? () => { if (!stale()) this.open(cam, false); }
            : () => { if (!stale()) this.setMsg(FAIL_MSG, "fail"); };
        this.attach(urls, stale, onFail);
      })
      .catch((e) => { if (!stale()) this.setMsg(e.message, "fail"); });
  }

  attach(urls, staleFn, onFail) {
    const memoKey = this.last ? this.last[0].id + ":" + (this.last[2] || "") : "";
    const failSafe = () => { if (memoKey) rememberHls(memoKey, false); onFail(); };
    if (urls.webrtc_url && !webrtcDead() && !(memoKey && hlsPreferred(memoKey))) {
      this.playWebRtc(urls.webrtc_url, staleFn).then(() => {
        if (!staleFn()) noteWebRtc(true);
      }).catch((err) => {
        // Boshqa kamera bosilgan — bu WebRTC'ning aybi emas.
        if (staleFn()) return;
        // Uzatilgan (odatda past sifatli sub) oqim ko'rinib turibdi. Ilgari shu yerda
        // to'xtalardi va Fokusda past sifat qolib ketardi (foydalanuvchi shikoyati).
        // Endi u ko'rinib turgan holda asosiy sifat yana so'raladi; ikki urinishdan
        // keyin HLS (zaxira yo'l) orqali asosiy sifatga o'tiladi.
        if (this.preview) {
          this.dropOverlay();
          this.setMsg("");
          this.mainRetries = (this.mainRetries || 0) + 1;
          if (this.mainRetries <= MAIN_RETRY_MAX) {
            setTimeout(() => { if (!staleFn() && this.preview) this.attach(urls, staleFn, onFail); },
              MAIN_RETRY_MS * this.mainRetries);
            return;
          }
          if (!urls.stream_url) return;
          const pv = this.preview;
          this.preview = null;
          if (pv.pc) pv.pc.close();
          this.setMsg("Zaxira yoʻl orqali ulanmoqda…", "wait");
          this.playHls(urls.stream_url, staleFn, failSafe);
          return;
        }
        // Faqat tarmoq darajasidagi jimlik sanaladi (ICE ulanmagan).
        if (!(err && err.iceOk)) noteWebRtc(false);
        if (err && err.noSource) {
          // Sub oqim yo'q bo'lsa — asosiyga (onFail shuni qiladi);
          // asosiy oqimning manbasi ochilmasa — darhol aniq xabar.
          if (urls.mode === "sub") onFail();
          else this.setMsg("Kamera oqim bermayapti — kamera yoki registratorni tekshiring", "fail");
          return;
        }
        this.setMsg("Zaxira yoʻl orqali ulanmoqda…", "wait");
        // HLS'da ochilsa — keyingi safar WebRTC kutilmaydi.
        if (memoKey) {
          this.video.addEventListener("playing", () => { if (!staleFn()) rememberHls(memoKey, true); }, { once: true });
        }
        this.playHls(urls.stream_url, staleFn, failSafe);
      });
      return;
    }
    if (!urls.stream_url) { this.setMsg("Oqim manzili sozlanmagan", "fail"); return; }
    this.playHls(urls.stream_url, staleFn, failSafe);
  }

  async playWebRtc(whepUrl, staleFn) {
    const video = this.video;
    // Uzatilgan oqim ko'rinib turgan bo'lsa yangisi USTMA-UST qo'yilgan
    // shaffof videoda kadr berguncha kutadi. O'lchov: srcObject almashtirilsa
    // element ~0,5-0,9 s qora turadi (yangi sink birinchi kadrni kutadi) —
    // shuning uchun avval ustki qatlam ko'rinadi, ostidagi video yangi oqimni
    // chiza boshlagach qatlam olib tashlanadi.
    const target = this.preview ? this.makeOverlay() : video;
    const pc = new RTCPeerConnection({ iceServers: [] });
    this.pc = pc;
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.ontrack = (e) => {
      if (staleFn()) return;
      // jitterBufferTarget — yangi nom (ms), playoutDelayHint — eskisi
      // (soniya). Ikkisi ham beriladi: brauzer bilganini oladi.
      try { e.receiver.jitterBufferTarget = PLAYOUT_DELAY * 1000; } catch (x) { /* qo'llamaydi */ }
      try { e.receiver.playoutDelayHint = PLAYOUT_DELAY; } catch (x) { /* qo'llamaydi */ }
      pc.__stream = e.streams[0];
      target.srcObject = e.streams[0];
      target.play().catch(() => {});
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await new Promise((resolve) => {          // ICE (ko'pi bilan 900 ms)
      if (pc.iceGatheringState === "complete") return resolve();
      const done = () => { pc.removeEventListener("icegatheringstatechange", check); resolve(); };
      const check = () => { if (pc.iceGatheringState === "complete") done(); };
      pc.addEventListener("icegatheringstatechange", check);
      setTimeout(done, 900);
    });
    const res = await fetch(whepUrl, {
      method: "POST", headers: { "Content-Type": "application/sdp" },
      body: pc.localDescription.sdp
    });
    if (!res.ok) {
      pc.close();
      // MediaMTX manbani ocholmadi (kamera oqim bermayapti) — tarmoq
      // emas, kamera. HLS ham shu manbadan oladi, unga o'tish yana
      // 30+ soniya behuda kutish bo'lardi.
      const body = await res.text().catch(() => "");
      throw Object.assign(new Error("WHEP " + res.status),
        { iceOk: true, noSource: /timed out|no stream|not ready/i.test(body) });
    }
    const answer = await res.text();
    if (staleFn()) { pc.close(); return; }
    await pc.setRemoteDescription({ type: "answer", sdp: answer });
    await new Promise((resolve, reject) => {  // 6 s da tasvir kelmasa — HLS
      // srcObject/"connected" yetarli emas: ular kadr kelmasa ham paydo
      // bo'ladi (masalan, server UDP tashqariga yopiq bo'lsa). Haqiqiy
      // belgi — vaqt yurishi, ya'ni dekodlangan kadrlar oqib kelyapti.
      //
      // Kadr kelishi bilan DARHOL hal bo'ladi. Ilgari faqat 6-soniyada
      // tekshirilardi: shu oraliqda boshqa kamera bosilsa, taymer
      // yangi (hali bo'sh) videoga qarab eski urinishni "jim" deb
      // sanardi va WebRTC butun seansga o'chib qolardi.
      const t0 = performance.now();
      let waitNoted = false;
      const poll = setInterval(() => {
        if (staleFn()) { clearInterval(poll); reject(new Error("bekor")); return; }
        const ready = target === video
          ? target.currentTime > 0
          : target.readyState >= 2 && target.videoWidth > 0;
        if (target.srcObject === pc.__stream && ready) {
          clearInterval(poll);
          if (target !== video) {
            this.fitOverlay(target);           // to'liq ekranga o'tilgan bo'lishi mumkin
            target.style.opacity = "1";
            video.srcObject = pc.__stream;
            video.play().catch(() => {});
            const pv = this.preview;
            this.preview = null;
            if (pv && pv.pc && pv.pc !== pc) parkStream(this.liveCam, pv.quality, pv.pc, pv.stream);
            // Ostidagi video yangi oqimni chiza boshlagach (yoki 3 s) qatlam olinadi.
            const s0 = performance.now();
            const drop = setInterval(() => {
              if ((video.readyState >= 2 && video.videoWidth === target.videoWidth) || performance.now() - s0 > 3000 || staleFn()) {
                clearInterval(drop);
                this.dropOverlay(target);
              }
            }, 50);
          }
          this.webrtcLive = true;
          this.liveQuality = (this.last && this.last[2]) || "";
          resolve(); return;
        }
        // ICE ulangan bo'lsa kadr 20 s gacha kutiladi, ulanmagan bo'lsa 6 s.
        // O'lchov (2026-10-12): H.265 kameralarning o'girish yo'li (_h264)
        // birinchi kadrni 5,5-7,5 s da beradi — 6 s chegara ularni har gal
        // HLS'ga tashlab yuborardi va HLS undan ham sekinroq (segment kutadi),
        // devorda "Kamera uygʻotilmoqda…" uzoq turardi. Ulanish bor — demak
        // kamera uyg'onyapti, uni kutish HLS'ga o'tishdan tezroq.
        const iceOk = ["connected", "completed"].includes(pc.iceConnectionState);
        const elapsed = performance.now() - t0;
        if (iceOk && elapsed > 6000 && !waitNoted) {
          waitNoted = true;
          if (target === video) this.setMsg("Kamera uygʻotilmoqda…", "wait");
        }
        if (elapsed > (iceOk ? 20000 : 6000)) {
          clearInterval(poll);
          // ICE ulangan-u kadr yo'q — tarmoq emas, kameraning o'zi
          // (oqim bermayapti). Bunday holat WebRTC'ni o'chirishga
          // sanalmaydi: aks holda ikkita nosoz kamera ketma-ket ochilsa
          // butun seans sekin HLS'ga tushardi.
          pc.close();
          reject(Object.assign(new Error("WebRTC jim"), { iceOk }));
        }
      }, 100);
      pc.addEventListener("connectionstatechange", () => {
        if (pc.connectionState === "failed") { clearInterval(poll); pc.close(); reject(new Error("WebRTC uzildi")); }
      });
    });
  }

  /* Video ustiga shaffof qatlam (o'sha klass va o'lcham). Ota element
     joylashtirilmagan bo'lsa ko'rinmas, DOM'dan tashqari element. */
  makeOverlay() {
    const video = this.video;
    const el = Object.assign(document.createElement("video"), { muted: true, playsInline: true });
    const parent = video.parentElement;
    if (parent && getComputedStyle(parent).position !== "static") {
      el.className = video.className;
      Object.assign(el.style, { position: "absolute", opacity: "0", pointerEvents: "none", margin: "0" });
      this.fitOverlay(el);
      video.after(el);
    }
    this.overlay = el;
    return el;
  }

  /* Qatlam videoning hozirgi o'rni va o'lchamiga keltiriladi. */
  fitOverlay(el) {
    const video = this.video;
    Object.assign(el.style, {
      left: video.offsetLeft + "px", top: video.offsetTop + "px",
      width: video.offsetWidth + "px", height: video.offsetHeight + "px",
      objectFit: getComputedStyle(video).objectFit,
    });
  }

  dropOverlay(el) {
    el = el || this.overlay;
    if (!el) return;
    el.srcObject = null;
    el.remove();
    if (this.overlay === el) this.overlay = null;
  }

  playHls(url, staleFn, onFail) {
    const video = this.video;
    if (!url) { this.setMsg(FAIL_MSG, "fail"); return; }
    // WebRTC'dan qolgan srcObject `src`dan ustun turadi — tozalanmasa
    // brauzer o'lik oqimni ko'rsatishda davom etadi va HLS ulanmaydi.
    video.srcObject = null;
    const isHls = url.includes(".m3u8");
    // hls.js (~500 KB) faqat HLS kerak bo'lganda yuklanadi — odatda WebRTC
    // ishlaydi va kutubxona umuman kerak bo'lmaydi.
    if (isHls && !Hls) {
      loadHls().then(() => { if (!staleFn()) this.playHls(url, staleFn, onFail); },
                     () => { if (!staleFn()) this.setMsg(FAIL_MSG, "fail"); });
      return;
    }
    if (isHls && Hls.isSupported()) {
      // Zaxira: WebRTC'dagi PLAYOUT_DELAY ning HLS'dagi muqobili.
      // Ilgari `liveSyncDurationCount: 1` va `maxBufferLength: 6` edi —
      // ya'ni bir segmentlik (~1 s) zaxira. Kanal uzuq bo'lgan kamerada
      // bu yetmaydi: pleyer to'xtaydi, keyin jonli chekkaga sakraydi.
      // Sovuq start byudjeti. Ilgari bu yerda 25 000 ms turardi va
      // izohda "sovuq start 5 soniyagacha cho'ziladi" deb yozilgandi.
      // Ishlab chiqarishda o'lchandi — haqiqat boshqa: talab bo'yicha
      // ochilayotgan yo'lda birinchi pleylist 14-65 soniyada keladi
      // (MediaMTX manbani <1 s da ochadi, vaqt HLS muxeri birinchi
      // segmentni yopishiga ketadi — kameraning keyframe oralig'i uzun).
      //
      // 25 s chegara shu taqsimotning o'rtasidan kesib o'tardi: sekin
      // kameralar UMUMAN ochilmasdi va foydalanuvchiga "xato" deb
      // ko'rinardi, holbuki oqim yo'lda edi. Byudjet kengaytirildi va
      // kutish jim emas — quyida holat yozuvi yangilanib turadi.
      const hls = new Hls({
        lowLatencyMode: true, maxBufferLength: 12, backBufferLength: 6,
        liveSyncDurationCount: 3,
        manifestLoadingTimeOut: 30000,
        manifestLoadingMaxRetry: 2,
        manifestLoadingRetryDelay: 2000
      });
      this.hls = hls;
      // Uzoq kutishda ekran jim qolmasin: birinchi ochilish sekinligi
      // nosozlik emas, kamerani uyg'otish narxi. Buni aytib turish
      // "ishlamayapti" degan xulosaning oldini oladi.
      const bosqichlar = [
        [6000, "Kamera uygʻotilmoqda…"],
        [15000, "Kamera uygʻonmoqda — birinchi ochilish sekinroq…"],
        [30000, "Hali ham kutilmoqda (kalit kadrlar oraligʻi uzun)…"]
      ];
      const kutishTimerlari = bosqichlar.map(([ms, matn]) =>
        setTimeout(() => { if (!staleFn()) this.setMsg(matn, "wait"); }, ms));
      const kutishniTozala = () => kutishTimerlari.forEach(clearTimeout);
      this.onCleanup = kutishniTozala;

      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        kutishniTozala();
        if (!staleFn()) video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_, d) => {
        if (!d.fatal || staleFn()) return;
        kutishniTozala();
        // Sub oqimda har qanday jiddiy xato — asosiyga qaytish sababi
        // (sub yo'l NVR'da o'chirilgan bo'lishi mumkin).
        if (onFail && (d.type === Hls.ErrorTypes.MEDIA_ERROR || this.mode === "sub")) {
          hls.destroy(); onFail(); return;
        }
        // HLS ham ochilmadi — "faqat HLS" yozuvi o'chadi, keyingi safar WebRTC sinaladi.
        if (this.last) rememberHls(this.last[0].id + ":" + (this.last[2] || ""), false);
        this.setMsg(FAIL_MSG, "fail");
      });
    } else if (isHls && video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      video.addEventListener("loadedmetadata", () => {
        if (!staleFn()) video.play().catch(() => {});
      }, { once: true });
      video.onerror = () => { if (!staleFn()) this.setMsg(FAIL_MSG, "fail"); };
    } else {
      video.src = url;
      video.onerror = () => { if (!staleFn()) this.setMsg(FAIL_MSG, "fail"); };
      video.play().catch(() => {});
    }
  }
}

export function createPlayer(video, msgEl) {
  return new Player(video, msgEl);
}

/* Kamerani oldindan uyg'otish — sichqoncha kelganda yo'l va surat tayyorlanadi.
   Ikkita qoida bor, ikkalasi ham tasvir qotishiga qarshi:

   1. Oqimning O'ZI bu yerda ochilmaydi. Ilgari HLS pleylisti ham so'ralardi;
      MediaMTX esa talab bo'yicha yo'lni shu so'rovda tortishni boshlaydi va
      keyin uni ushlab turadi. Natijada markerlar yoki ro'yxat ustidan
      sichqoncha o'tib ketishining o'zi o'nlab to'liq sifatli oqimni ochib
      yuborardi: WAN kanali to'yinadi, registrator RTP paketlarini tashlaydi
      va hamma kamerada tasvir qotadi. Chipta so'rovi esa arzon — u faqat
      yo'lni sozlaydi va kameradan keyframe so'raydi.

   2. Kutish (hover intent): sichqoncha shunchaki o'tib ketsa hech narsa
      qilinmaydi — faqat bir joyda to'xtalganda uyg'otiladi. */
const PREWARM_DELAY = 350;                    // ms — shunchaki o'tib ketish sanalmaydi

export class StreamPrewarmer {
  constructor() {
    this.warmed = new Map();
    this.warmTimer = null;
  }

  warm(cam) {
    clearTimeout(this.warmTimer);             // oldingi nishon bekor qilinadi
    this.warmTimer = setTimeout(() => {
      const last = this.warmed.get(cam.id) || 0;
      if (Date.now() - last < 30000) return;
      this.warmed.set(cam.id, Date.now());
      fetch("/api/cameras/" + cam.id + "/snapshot", { cache: "no-store" }).catch(() => {});
      api("/api/cameras/" + cam.id + "/stream?hevc=" + (HEVC_OK ? 1 : 0)).catch(() => {});
    }, PREWARM_DELAY);
  }
}

export const prewarmer = new StreamPrewarmer();

export function prewarm(cam) { prewarmer.warm(cam); }
