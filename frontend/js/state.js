/* Umumiy holat va yordamchilar: `state` (butun ilova holati), `$`, `esc`, `toast`,
   brauzer imkoniyatlari (HEVC_OK) va pleyer sozlamalari. Boshqa hech narsaga bog'liq emas. */

export const state = {
  cameras: [],
  byId: new Map(),
  vendors: [],
  admin: null,
  tab: "map",
  filter: "all",
  q: "",
  selectedId: null,
  listOpen: true,
  openRegions: {},
  pinned: [],                 // "Devorga qo'shish" bilan tanlanganlar
  wallSize: 3,
  wallRegion: "",             // devorda faqat shu hudud ("" — hammasi)
  wallQuality: "auto",        // auto | sub (past) | main (asl) — devor oqimi
  wallFit: "contain",         // contain — butun kadr, cover — katakni to'ldirish
  wallPage: 0,
  wallAuto: false,            // sahifalarni avtomatik aylantirish
  wallHidden: new Set(),      // devordan vaqtincha olib tashlanganlar
  openTimes: [],              // shu seansda o'lchangan ochilish vaqtlari (ms)
  openByCam: new Map(),       // kamera → oxirgi ochilish vaqti (ms)
  events: [],                 // shu seans hodisalari (oqim ochildi va h.k.)
  stats: null,                // /api/stats/dashboard javobi — tarixiy grafiklar
  editingId: null,
  sourceType: "rtsp",
  picking: null,
  pickMarker: null,
  adminQuery: "",
  adminOffset: 0,
  adminTotal: 0,
  adminCameras: [],
  adminSize: 50,
  tlHours: 24,                // asosiy grafik davri (soat)
  listView: "cams",           // chap panel: "cams" yoki "regs"
  wallInterval: 12,           // avto-almashish oralig'i (soniya)
  apiOk: true,                // oxirgi so'rov muvaffaqiyatli bo'ldimi
  streamOk: null,             // oqim manzili olindimi (null — hali sinalmagan)
  adminFilters: { status: "", region: "", codec: "", mode: "" },
  adminSort: { key: "", dir: 1 }
};

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

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

let toastTimer = null;
export function toast(text, bad) {
  const t = $("toast");
  t.textContent = text;
  t.classList.toggle("bad", Boolean(bad));
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}
