/* ==========================================================================
   main.js — kirish nuqtasi (v3)
   --------------------------------------------------------------------------
   Vazifasi:
     Ilovani ishga tushiradi (kim kirgan, ma'lumot yuklash), bo'limlarni
     registerPage bilan ulaydi, global klaviatura (Esc, ?) va qobiq
     (sysbar polling) ni boshlaydi.

   Ishga tushirish tartibi:
     1. Importlar baholanadi: har modul o'z nusxasini yaratadi va DOM ni ulaydi.
     2. Bo'limlar ro'yxatga olinadi (pastdagi BO'LIMLAR bloki).
     3. start(): /api/auth/me (server ko'tarilguncha qayta) → kerak bo'lsa
        kirishni kutish → /api/cameras → #hash bo'limi → splash yopiladi.

   Qoidalar / tuzoqlar:
     - "Faqat yon ta'sir uchun" importlarni olib tashlamang: ular tugmalarni ulaydi.
     - Har bir faylni `node --input-type=module --check < fayl` bilan tekshiring.
     - Bo'lim modullari o'zini registerPage("tab", {show, hide, escape}) bilan
       ulashi mumkin — shunda BO'LIMLAR blokidagi o'z qatorini olib tashlang.
   ========================================================================== */
import { initI18n } from "./core/i18n.js";
import { state, toast } from "./core/state.js";
import { api } from "./core/api.js";
import { setTheme, getTheme } from "./core/theme.js";
import { loadCameras } from "./core/data.js";
import { hydrateIcons } from "./core/icons.js";
import { onShortcut } from "./core/ui.js";
import { openModal, closeModal, topModal } from "./core/modals.js";
import { applyMe, kirishniKut, openLogin } from "./auth/auth.js";
import { AUTH_TABS, initialRoute, registerPage, showTab } from "./layout/tabs.js";
import { startShellPolling, refreshNotifications } from "./layout/notifications.js";
import { initGroups, loadGroups } from "./map/groups.js";
import { selectCamera } from "./map/selection.js";
import { buildWall, stopWall } from "./wall/video-wall.js";
import { renderDash } from "./dashboard/dashboard.js";
import { loadAdminCameras } from "./admin/admin.js";
import { loadSettingsPage, hideSettingsPage } from "./settings/settings.js";
import { loadVendors, xaritaTanlashniUlash } from "./admin/camera-form.js";
import { initOverview } from "./dashboard/overview.js";
import "./player/player.js";
import "./dashboard/charts.js";
import "./admin/nvr.js";

hydrateIcons(document);
initI18n();          // til: butun hujjat + keyingi o'zgarishlar (MutationObserver)
xaritaTanlashniUlash();
initOverview();
initGroups();

/* ---------- BO'LIMLAR (har modul o'z qatorini o'ziga ko'chirishi mumkin) ---------- */
/* "map" — map/page.js da (initGroups → initMapPage) */
registerPage("wall", { show: (sub) => buildWall(sub || ""), hide: () => stopWall() });
registerPage("dash", { show: (sub) => renderDash(sub || "") });
registerPage("admin", { show: () => loadAdminCameras(0) });
registerPage("settings", { show: (sub) => loadSettingsPage(sub), hide: () => hideSettingsPage() });

/* ---------- Global klaviatura ---------- */
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  if (document.querySelector(".login.open")) return;     // kirish majburiy
  const m = topModal();
  if (m) { closeModal(m.id); return; }
  document.dispatchEvent(new CustomEvent("page:escape", { detail: { tab: state.tab }, cancelable: true }));
});
onShortcut("?", () => openModal("help-modal"));
document.getElementById("rail-help").addEventListener("click", () => openModal("help-modal"));
document.addEventListener("camera:select", (e) => {
  showTab("map");
  selectCamera(e.detail.id, true);
});

/* ---------- Ishga tushirish ---------- */
function bootDone() {
  document.documentElement.classList.remove("booting");
}
let bootSafety = setTimeout(bootDone, 8000);

(async function start() {
  setTheme(getTheme(), false);

  let me = null;
  for (let attempt = 0; attempt < 30 && !me; attempt++) {
    try { me = await api("/api/auth/me"); }
    catch (e) { await new Promise((r) => setTimeout(r, 2000)); }
  }
  applyMe(me);

  // Chuqur havola: #wall, #dash/trend, #settings/status ...
  let route = initialRoute();
  if (AUTH_TABS.includes(route.tab) && !(me && me.authenticated)) {
    state.pendingTab = route.tab;
    history.replaceState(null, "", location.pathname);
    route = { tab: "map", sub: "" };
  }

  if (!(me && me.authenticated)) {
    clearTimeout(bootSafety);
    openLogin();
    await kirishniKut();
    bootSafety = setTimeout(bootDone, 8000);
  }

  startShellPolling(state.pollS || 30);

  for (let attempt = 0; ; attempt++) {
    try { await loadCameras(); break; }
    catch (e) {
      if (attempt === 0) { bootDone(); toast("Server bilan aloqa yoʻq — qayta urinilmoqda…", { tone: "error" }); }
      if (attempt >= 30) { toast("Server javob bermayapti: " + e.message, { tone: "error" }); return; }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  loadGroups();
  showTab(state.pendingTab || route.tab, state.pendingTab ? "" : route.sub);
  state.pendingTab = null;
  clearTimeout(bootSafety);
  bootDone();
  document.addEventListener("auth:changed", () => refreshNotifications());

  try { await loadVendors(); } catch (e) { /* shakl ochilganda qayta yuklanadi */ }
})();
