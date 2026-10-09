/* player/env.js — pleyer sozlamalari (v3 core/state.js dan, izohlari bilan). */

/* Qabul buferi (soniya) — WebRTC tasvirni ko'rsatishdan oldin shuncha
   ushlab turadi.

   Nima uchun kerak: kamera kanalida paket yo'qolsa, RTSP/TCP uni qayta
   yuborishni kutadi va oqim to'xtab qoladi, keyin to'p-to'p bo'lib
   quvib yetadi. Bufersiz brauzer aynan shu tebranishni ko'rsatadi —
   tasvir qotib-qotib ketadi. O'lchov (A1 kamerasi, kanalida ~3% paket
   yo'qolishi bor):

       bufersiz  — 30 soniyada 14 marta qotish, vaqtning 33-45 %i
       0,5 s     — 10 marta, 14 %
       1,0 s     —  3 marta,  3 %
       1,5 s     —  3 marta,  4 %

   Sog'lom kanaldagi kameraga zarari yo'q (A7: 0 qotish, 600/600 kadr).
   Narxi — tasvir bir soniya kechikadi; kuzatuv uchun bu sezilmaydi,
   shuning uchun silliqlik afzal ko'rilgan. */
export const PLAYOUT_DELAY = 1.0;

/* Brauzer H.265 (HEVC) ni o'zi o'qiy oladimi? Olsa — server oqimni
   o'girmaydi, xom holda beradi va GPU umuman ishlatilmaydi.

   DIQQAT: bu savol WebRTC uchun so'raladi. Sababi — server bitta yo'l
   qaytaradi, pleyer esa avval WebRTC'ni sinaydi. Brauzerning HLS (MSE)
   tomoni H.265 ni bilishi, WebRTC tomoni esa ko'rsatmasligi mumkin;
   Windows'dagi Edge aynan shunday. Ilgari "ikkisidan biri bilsa yetadi"
   deb hisoblanardi — natijada xom H.265 WebRTC'ga berilib, baytlar oqib
   turgan holda tasvir birinchi kadrda qotib qolardi. Endi WebRTC bor
   bo'lsa hukmni faqat u chiqaradi. */
export const HEVC_OK = (() => {
  try {
    const caps = RTCRtpReceiver.getCapabilities("video");
    if (caps) return caps.codecs.some((c) => /H265|hevc/i.test(c.mimeType));
  } catch (e) { /* WebRTC yo'q — quyida HLS bo'yicha hal qilinadi */ }
  const type = 'video/mp4; codecs="hvc1.1.6.L93.B0"';
  try {
    if (window.MediaSource && MediaSource.isTypeSupported(type)) return true;
  } catch (e) { /* eskirgan brauzer */ }
  return document.createElement("video").canPlayType(type) === "probably";
})();
