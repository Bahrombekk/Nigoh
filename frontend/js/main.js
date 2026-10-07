/* ==========================================================================
   main.js — kirish nuqtasi
   --------------------------------------------------------------------------
   Vazifasi:
     Ilovani ishga tushiradi (kim kirgan, ma'lumot yuklash, splash) va
     global klaviatura qisqartmalari (Escape). index.html faqat shu faylni
     ulaydi: <script type="module" src="/js/main.js"> — shuning uchun u
     js/ ildizida qoladi.

   Eksport: yo'q (faqat ishga tushirish).

   Ishga tushirish tartibi:
     1. Importlar baholanadi: har modul o'z klassining yagona nusxasini
        yaratadi va DOM tugmalarini ulaydi (konstruktorlarda).
     2. Hamma modul yuklangach (aylanma importlar tufayli faqat shu yerda
        xavfsiz): xaritaTanlashniUlash() — xaritaga "click"; initOverview() —
        hisobot tugmalari va ResizeObserver.
     3. start(): mavzu, soat, kontur -> /api/auth/me (server ko'tarilguncha
        qayta so'raladi) -> kerak bo'lsa kirishni kutish -> /api/cameras ->
        #hash bo'limi -> splash yopiladi -> ishlab chiqaruvchi shablonlari.

   Bog'liqliklar:
     import: core/state.js, core/api.js, core/theme.js, core/data.js,
             map/camera-list.js, map/selection.js, layout/notifications.js,
             layout/tabs.js, core/modals.js, auth/auth.js, admin/camera-form.js,
             dashboard/overview.js; yon ta'sir uchun: core/icons.js, map/map.js,
             player/player.js, wall/video-wall.js, dashboard/charts.js,
             admin/admin.js, admin/nvr.js
     global: L, Hls (index.html da CDN dan, main.js dan OLDIN yuklanadi)

   DOM: html.booting, #splash, #sp-status, .login-screen, .backdrop, #sel-body
   Backend: GET /api/auth/me, GET /api/cameras (data.js orqali)

   Qoidalar / tuzoqlar:
     - "Faqat yon ta'sir uchun" importlarni olib tashlamang: ular tugmalarni
       ulaydi (masalan nvr.js ni hech kim import qilmaydi).
     - Kutilmagan xatoda ham sahifa splashda qolib ketmasin: 8 s xavfsizlik
       taymeri bor; kirish kutilayotganda u to'xtatiladi.
     - Har bir faylni `node --input-type=module --check < fayl` bilan
       tekshiring: oddiy `node --check` takroriy e'lonni ko'rmaydi (ilgari
       aynan shu xato sahifani yuklanish ekranida qoldirgan).
   ========================================================================== */
import { $, state, toast } from "./core/state.js";
import { api } from "./core/api.js";
import { setTheme } from "./core/theme.js";
import { loadCameras } from "./core/data.js";
import { MOBILE, setListOpen } from "./map/camera-list.js";
import { closeSel, fmtLastSeen, setSelOpen } from "./map/selection.js";
import { addEvent } from "./layout/notifications.js";
import { AUTH_TABS, drawHeadMaps, showTab, startClock } from "./layout/tabs.js";
import { closeModal, openModal } from "./core/modals.js";
import { applyMe, kirishniKut, openLogin } from "./auth/auth.js";
import { loadVendors, stopPicking, xaritaTanlashniUlash } from "./admin/camera-form.js";
import { initOverview } from "./dashboard/overview.js";
import { initGroups, loadGroups } from "./map/groups.js";
import "./core/icons.js";
import "./map/map.js";
import "./player/player.js";
import "./wall/video-wall.js";
import "./dashboard/charts.js";
import "./admin/admin.js";
import "./admin/nvr.js";

// Hamma modul yuklangan — endi xaritaga hodisa ulash xavfsiz.
xaritaTanlashniUlash();
// Hisobot (dashboard) tugmalari va o'lcham kuzatuvchisi — xuddi shu sababdan shu yerda.
initOverview();
// Kamera guruhlari: oyna, tanlash rejimi, lasso — xuddi shu sababdan shu yerda.
initGroups();



/* ---------- Umumiy ---------- */
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  // Kirish ekrani Escape bilan yopilmaydi — u majburiy.
  if (document.querySelector(".login-screen.open")) return;
  const open = document.querySelector(".backdrop.open");
  if (open) { closeModal(open.id); return; }
  if (state.picking) {
    const target = state.picking === "nvr" ? "nvr-modal" : "cam-modal";
    stopPicking(true);
    openModal(target);
    return;
  }
  if (!$("sel-body").hidden) { closeSel(); return; }
  if (state.tab !== "map") showTab("map");   // devor/dashboard/boshqaruvdan qaytish
});

/* ---------- Ishga tushirish ----------
   Sahifa "booting" holatida ochiladi: ilova yashirin, o'rnida splash turadi.
   Kim ekanimiz aniqlanib, ma'lumot yuklangach interfeys ko'rsatiladi. */
function bootDone() {
  const el = document.getElementById("splash");
  document.documentElement.classList.remove("booting");
  if (!el || el.classList.contains("out")) return;
  // Ilova ko'rinadi, splash esa ustidan yumshoq so'nadi.
  el.classList.add("out");
  setTimeout(() => el.classList.remove("out"), 400);
}

/* Yuklanish ekranidagi holat matni. */
function bootStatus(text) {
  const el = document.getElementById("sp-status");
  if (el) el.textContent = text;
}
// Xavfsizlik uchun: kutilmagan xato bo'lsa ham sahifa abadiy splashda
// qolmasin. Kirish kutilayotganda taymer to'xtatiladi — aks holda kirgan
// zahoti bo'sh dashboard bir zumga ko'rinib ketadi.
let bootSafety = setTimeout(bootDone, 8000);


(async function start() {
  // index.html'dagi skript mavzuni allaqachon tanlagan (saqlangan yoki tizimniki).
  setTheme(document.documentElement.dataset.theme || "dark", false);
  startClock();
  setSelOpen(false);
  // Kontur darhol chiziladi — kirish sahifasidagi xarita bo'sh qolmasin.
  // Chegara fayli ochiq statik fayl, kirish talab qilmaydi; kamera
  // nuqtalari esa hozircha yo'q, ular ma'lumot kelgach qo'shiladi.
  drawHeadMaps();

  // Kirish ekrani — birinchi qadam. Kirilmagan bo'lsa u ochiladi: serverda
  // anonim ko'rish yoqiq bo'lsa "Mehmon sifatida davom etish" bilan o'tsa
  // bo'ladi, o'chiq bo'lsa yuklash kirishgacha kutadi.
  // Server hali ko'tarilmagan bo'lsa kirgan foydalanuvchiga ham kirish
  // ekrani chiqib qolmasin — javob kelguncha qayta so'raymiz.
  let me = null;
  bootStatus("Serverga ulanmoqda…");
  for (let attempt = 0; attempt < 30 && !me; attempt++) {
    try { me = await api("/api/auth/me"); }
    catch (e) { await new Promise((r) => setTimeout(r, 2000)); }
  }
  applyMe(me);

  // Chuqur havola: /#wall, /#dash, /#admin. Yopiq bo'lim so'ralgan bo'lsa-yu
  // kirilmagan bo'lsa — manzil tozalanadi, bo'lim umuman ochilmaydi.
  let hashTab = location.hash.replace("#", "");
  if (!["wall", "dash", "admin", "settings"].includes(hashTab)) hashTab = "";
  if (hashTab && AUTH_TABS.includes(hashTab) && !(me && me.authenticated)) {
    history.replaceState(null, "", location.pathname);
  }

  // Telefonda ro'yxat xaritani yopib qo'ymasin — chiplar orqali ochiladi.
  if (MOBILE.matches) setListOpen(false);

  if (!(me && me.authenticated)) {
    // Kirish majburiy (yoki mehmon sifatida o'tiladi) — tanlovgacha
    // hech narsa yuklanmaydi.
    bootStatus("Kirish kutilmoqda");
    clearTimeout(bootSafety);
    openLogin();
    await kirishniKut();
    bootSafety = setTimeout(bootDone, 8000);
  }
  bootStatus("Kameralar yuklanmoqda…");

  // Server hali ko'tarilmagan bo'lsa (masalan, birga ishga tushirilganda)
  // sahifa bo'sh qolib ketmaydi — ulanguncha qayta urinamiz.
  for (let attempt = 0; ; attempt++) {
    try { await loadCameras(); break; }
    catch (e) {
      if (attempt === 0) {
        bootDone();          // xato bo'lsa ham interfeys ko'rinsin
        toast("Server bilan aloqa yo'q — qayta urinilmoqda…", true);
      }
      if (attempt >= 30) { toast("Server javob bermayapti: " + e.message, true); return; }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // Uzilgan kameralar birinchi ochilishda hodisalar ro'yxatiga tushadi.
  state.cameras.filter((c) => c.online === false).forEach((c) =>
    addEvent(c.name + " — uzilgan (oxirgi onlayn: " + fmtLastSeen(c.last_seen) + ")", "danger"));

  // Guruhlar kameralar ro'yxatiga tayanadi (a'zolar holati) — undan keyin.
  loadGroups();

  drawHeadMaps();
  if (hashTab) showTab(hashTab);
  // Interfeys to'liq tayyor bo'lgandan keyin ko'rsatiladi — yangilashda
  // bir zumga noto'g'ri bo'lim yoki yopiq dashboard ko'rinib ketmasin.
  bootDone();

  try { await loadVendors(); } catch (e) { /* shakl ochilganda qayta yuklanadi */ }
})();
