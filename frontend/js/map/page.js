/* ==========================================================================
   map/page.js — "02 Xarita" sahifasini ulash
   --------------------------------------------------------------------------
   Vazifasi:
     Xarita bo'limi modullarini to'g'ri tartibda ishga tushiradi (DOM init),
     registerPage("map") (main.js dan ko'chirilgan), Esc zanjiri
     (onboarding → o'lchash → lasso/tanlash → karta → drawer → overlay panel),
     manzildagi ?camera=ID ni tiklash, birinchi kirishda onboarding,
     yordam oynasidagi "Tanishtiruvni qayta koʻrish".

   Eksport: initMapPage() — groups.js init() dan (main.js initGroups()) bir marta.
   Bog'liqliklar: ../core/state.js, ../core/modals.js, ../layout/tabs.js, ./map.js,
                  ./camera-list.js, ./selection.js, ./groups.js, ./layers.js, ./tools.js,
                  ./onboarding.js, ./util.js
   Hodisalar: "page:escape" (main.js, cancelable), "cameras:status" (data.js)

   Qoidalar / tuzoqlar:
     - Bu fayl modul yuklanishida hech narsa qilmaydi — aylanma importlar
       (map.js ↔ selection.js ↔ camera-list.js) to'liq baholangach
       initMapPage() chaqiriladi.
   ========================================================================== */
import { state } from "../core/state.js";
import { closeModal } from "../core/modals.js";
import { registerPage, showTab } from "../layout/tabs.js";
import { map } from "./map.js";
import { MOBILE, cameraList, initCameraList } from "./camera-list.js";
import { initSelection, selectCamera, selectionPanel, selectionEscape } from "./selection.js";
import { groupStore } from "./groups.js";
import { initLayers } from "./layers.js";
import { initTools, tools } from "./tools.js";
import { onboarding } from "./onboarding.js";
import { getParam } from "./util.js";

let started = false;

export function initMapPage() {
  if (started) return;
  started = true;
  initSelection();
  initCameraList();
  initLayers();
  initTools();

  registerPage("map", {
    show: () => {
      setTimeout(() => map.invalidateSize(), 60);
      if (state.selectedId && state.byId.has(state.selectedId)) selectCamera(state.selectedId, !selectionPanel.open);
    },
    hide: () => {
      if (selectionPanel.player) selectionPanel.player.stop();
      selectionPanel.closeCard(false);
      onboarding.finish(false);
      if (state.measuring) tools.setMeasure(false);
    },
  });

  document.addEventListener("page:escape", (e) => {
    if (e.detail.tab !== "map") return;
    const handled = onboarding.escape() || tools.escape() || groupStore.escape() || selectionEscape() ||
      (MOBILE.matches && !cameraList.collapsed && (cameraList.setCollapsed(true, false), true));
    if (handled) e.preventDefault();
  });

  // Birinchi ma'lumot: ?camera=ID ni ochish, onboarding.
  let first = true;
  document.addEventListener("cameras:status", () => {
    if (!first || !state.camsLoaded) return;
    first = false;
    const id = Number(getParam("camera"));
    if (id && state.byId.has(id) && state.tab === "map") setTimeout(() => selectCamera(id, true), 50);
    else setTimeout(() => onboarding.maybeStart(), 900);
  });

  const tour = document.getElementById("help-tour");
  if (tour) tour.addEventListener("click", () => {
    closeModal("help-modal");
    showTab("map");
    setTimeout(() => onboarding.start(), 250);
  });
}
