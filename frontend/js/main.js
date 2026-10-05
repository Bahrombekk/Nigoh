/* Kirish nuqtasi: ilovani ishga tushiradi (kim kirgan, ma'lumot yuklash, splash)
   va global klaviatura qisqartmalari. */
import { $, state, toast } from "./state.js";
import { api } from "./api.js";
import { setTheme } from "./theme.js";
import { loadCameras } from "./data.js";
import { MOBILE, setListOpen } from "./camera-list.js";
import { closeSel, fmtLastSeen, setSelOpen } from "./selection.js";
import { addEvent } from "./dashboard.js";
import { AUTH_TABS, drawHeadMaps, showTab, startClock } from "./tabs.js";
import { closeModal, openModal } from "./modals.js";
import { applyMe, kirishniKut, openLogin } from "./auth.js";
import { loadVendors, stopPicking, xaritaTanlashniUlash } from "./camera-form.js";
import "./icons.js";
import "./map.js";
import "./player.js";
import "./video-wall.js";
import "./charts.js";
import "./admin.js";
import "./nvr.js";

// Hamma modul yuklangan — endi xaritaga hodisa ulash xavfsiz.
xaritaTanlashniUlash();



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
  if (!["wall", "dash", "admin"].includes(hashTab)) hashTab = "";
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

  drawHeadMaps();
  if (hashTab) showTab(hashTab);
  // Interfeys to'liq tayyor bo'lgandan keyin ko'rsatiladi — yangilashda
  // bir zumga noto'g'ri bo'lim yoki yopiq dashboard ko'rinib ketmasin.
  bootDone();

  try { await loadVendors(); } catch (e) { /* shakl ochilganda qayta yuklanadi */ }
})();
