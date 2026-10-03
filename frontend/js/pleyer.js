/* Video pleyer: avval WebRTC (WHEP), bo'lmasa HLS (hls.js). Ochilish vaqtini
   o'lchaydi; WebRTC jim qolsa seans uchun HLS'ga o'tadi. */
import { HEVC_OK, PLAYOUT_DELAY, state } from "./holat.js";
import { api } from "./api.js";
import { noteWebRtc, renderFootStats, webrtcDead } from "./royxat.js";
import { renderDashMetrics } from "./dashboard.js";

/* ---------- Video pleyer (WebRTC -> HLS) ----------
   Har bir pleyer o'z holatini olib yuradi — devorda bir nechta birga ishlaydi. */

const FAIL_MSG = "Oqim ochilmadi — MediaMTX ishlayaptimi va kamera ulanganmi tekshiring";

export function createPlayer(video, msgEl) {
  const p = { video, msgEl, hls: null, pc: null, token: 0, onOpen: null, last: null };
  msgEl.classList.add("pmsg");

  /* Xabar turi: "wait" — aylanma bilan; "fail" — bosilsa qayta uriniladi. */
  const setMsg = (text, kind) => {
    msgEl.textContent = text;
    msgEl.classList.toggle("wait", kind === "wait");
    msgEl.classList.toggle("fail", kind === "fail");
  };
  p.setMsg = setMsg;
  msgEl.addEventListener("click", (e) => {
    if (!msgEl.classList.contains("fail") || !p.last) return;
    e.stopPropagation();
    p.open(...p.last);
  });

  p.stop = () => {
    p.token++;
    // Kutish yozuvining taymerlari — pleyer yopilgach xabar yangilanmasin.
    if (p.onCleanup) { p.onCleanup(); p.onCleanup = null; }
    if (p.hls) { p.hls.destroy(); p.hls = null; }
    if (p.pc) { p.pc.close(); p.pc = null; }
    video.pause();
    video.removeAttribute("src");
    video.srcObject = null;
    video.load();
    setMsg("");
  };

  p.open = (cam, useHevc, quality) => {
    p.stop();
    p.last = [cam, useHevc, quality];
    const my = ++p.token;
    const stale = () => p.token !== my;
    const t0 = performance.now();
    setMsg("Ulanmoqda…", "wait");
    if (!video.poster) video.poster = "/api/cameras/" + cam.id + "/snapshot";

    const opened = () => {
      if (stale()) return;
      setMsg("");
      const ms = performance.now() - t0;
      state.openTimes.push(ms);
      if (state.openTimes.length > 50) state.openTimes.shift();
      state.openByCam.set(cam.id, ms);   // dashboard: kamera kesimida oxirgi o'lchov
      renderFootStats();
      renderDashMetrics();
      if (p.onOpen) p.onOpen(ms, p.mode);
    };
    video.addEventListener("playing", opened, { once: true });

    api("/api/cameras/" + cam.id + "/stream?hevc=" + (useHevc ? 1 : 0) +
        (quality ? "&quality=" + quality : ""))
      .then((urls) => {
        if (stale()) return;
        state.streamOk = Boolean(urls.webrtc_url || urls.stream_url);
        p.mode = urls.mode;
        // Sub oqim ishlamasa — asosiyga; xom H.265 amalda o'qilmasa —
        // bir marta o'girilganiga qaytamiz.
        const onFail = urls.mode === "sub"
          ? () => { if (!stale()) p.open(cam, useHevc); }
          : urls.mode === "raw"
            ? () => { if (!stale()) p.open(cam, false); }
            : () => { if (!stale()) setMsg(FAIL_MSG, "fail"); };
        attach(urls, stale, onFail);
      })
      .catch((e) => { if (!stale()) setMsg(e.message, "fail"); });

    function attach(urls, staleFn, onFail) {
      if (urls.webrtc_url && !webrtcDead()) {
        playWebRtc(urls.webrtc_url, staleFn).then(() => {
          if (!staleFn()) noteWebRtc(true);
        }).catch((err) => {
          // Boshqa kamera bosilgan — bu WebRTC'ning aybi emas.
          if (staleFn()) return;
          // Faqat tarmoq darajasidagi jimlik sanaladi (ICE ulanmagan).
          if (!(err && err.iceOk)) noteWebRtc(false);
          if (err && err.noSource) {
            // Sub oqim yo'q bo'lsa — asosiyga (onFail shuni qiladi);
            // asosiy oqimning manbasi ochilmasa — darhol aniq xabar.
            if (urls.mode === "sub") onFail();
            else setMsg("Kamera oqim bermayapti — kamera yoki registratorni tekshiring", "fail");
            return;
          }
          setMsg("Zaxira yo'l orqali ulanmoqda…", "wait");
          playHls(urls.stream_url, staleFn, onFail);
        });
        return;
      }
      if (!urls.stream_url) { setMsg("Oqim manzili sozlanmagan", "fail"); return; }
      playHls(urls.stream_url, staleFn, onFail);
    }

    async function playWebRtc(whepUrl, staleFn) {
      const pc = new RTCPeerConnection({ iceServers: [] });
      p.pc = pc;
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.ontrack = (e) => {
        if (staleFn()) return;
        // jitterBufferTarget — yangi nom (ms), playoutDelayHint — eskisi
        // (soniya). Ikkisi ham beriladi: brauzer bilganini oladi.
        try { e.receiver.jitterBufferTarget = PLAYOUT_DELAY * 1000; } catch (x) { /* qo'llamaydi */ }
        try { e.receiver.playoutDelayHint = PLAYOUT_DELAY; } catch (x) { /* qo'llamaydi */ }
        pc.__stream = e.streams[0];
        video.srcObject = e.streams[0];
        video.play().catch(() => {});
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
        const poll = setInterval(() => {
          if (staleFn()) { clearInterval(poll); reject(new Error("bekor")); return; }
          if (video.srcObject === pc.__stream && video.currentTime > 0) {
            clearInterval(poll); resolve(); return;
          }
          if (performance.now() - t0 > 6000) {
            clearInterval(poll);
            // ICE ulangan-u kadr yo'q — tarmoq emas, kameraning o'zi
            // (oqim bermayapti). Bunday holat WebRTC'ni o'chirishga
            // sanalmaydi: aks holda ikkita nosoz kamera ketma-ket ochilsa
            // butun seans sekin HLS'ga tushardi.
            const iceOk = ["connected", "completed"].includes(pc.iceConnectionState);
            pc.close();
            reject(Object.assign(new Error("WebRTC jim"), { iceOk }));
          }
        }, 100);
        pc.addEventListener("connectionstatechange", () => {
          if (pc.connectionState === "failed") { clearInterval(poll); pc.close(); reject(new Error("WebRTC uzildi")); }
        });
      });
    }

    function playHls(url, staleFn, onFail) {
      if (!url) { setMsg(FAIL_MSG, "fail"); return; }
      // WebRTC'dan qolgan srcObject `src`dan ustun turadi — tozalanmasa
      // brauzer o'lik oqimni ko'rsatishda davom etadi va HLS ulanmaydi.
      video.srcObject = null;
      const isHls = url.includes(".m3u8");
      if (isHls && window.Hls && Hls.isSupported()) {
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
        p.hls = hls;
        // Uzoq kutishda ekran jim qolmasin: birinchi ochilish sekinligi
        // nosozlik emas, kamerani uyg'otish narxi. Buni aytib turish
        // "ishlamayapti" degan xulosaning oldini oladi.
        const bosqichlar = [
          [6000, "Kamera uyg'otilmoqda…"],
          [15000, "Kamera uyg'onmoqda — birinchi ochilish sekinroq…"],
          [30000, "Hali ham kutilmoqda (uzoq keyframe oralig'i)…"]
        ];
        const kutishTimerlari = bosqichlar.map(([ms, matn]) =>
          setTimeout(() => { if (!staleFn()) setMsg(matn, "wait"); }, ms));
        const kutishniTozala = () => kutishTimerlari.forEach(clearTimeout);
        p.onCleanup = kutishniTozala;

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
          if (onFail && (d.type === Hls.ErrorTypes.MEDIA_ERROR || p.mode === "sub")) {
            hls.destroy(); onFail(); return;
          }
          setMsg(FAIL_MSG, "fail");
        });
      } else if (isHls && video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        video.addEventListener("loadedmetadata", () => {
          if (!staleFn()) video.play().catch(() => {});
        }, { once: true });
        video.onerror = () => { if (!staleFn()) setMsg(FAIL_MSG, "fail"); };
      } else {
        video.src = url;
        video.onerror = () => { if (!staleFn()) setMsg(FAIL_MSG, "fail"); };
        video.play().catch(() => {});
      }
    }
  };
  return p;
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
const warmed = new Map();
let warmTimer = null;
const PREWARM_DELAY = 350;                    // ms — shunchaki o'tib ketish sanalmaydi

export function prewarm(cam) {
  clearTimeout(warmTimer);                    // oldingi nishon bekor qilinadi
  warmTimer = setTimeout(() => {
    const last = warmed.get(cam.id) || 0;
    if (Date.now() - last < 30000) return;
    warmed.set(cam.id, Date.now());
    fetch("/api/cameras/" + cam.id + "/snapshot", { cache: "no-store" }).catch(() => {});
    api("/api/cameras/" + cam.id + "/stream?hevc=" + (HEVC_OK ? 1 : 0)).catch(() => {});
  }, PREWARM_DELAY);
}
