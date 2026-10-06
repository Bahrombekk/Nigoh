/* ==========================================================================
   core/data.js — kameralar ro'yxati (yuklash va davriy yangilash)
   --------------------------------------------------------------------------
   Vazifasi:
     /api/cameras dan ochiq kameralar ro'yxatini olib `state.cameras` va
     `state.byId` ga yozadi, so'ng unga bog'liq hamma ko'rinishni yangilaydi
     (ro'yxat, markerlar, pastki chiziqcha, dashboard, devor, boshqaruv).

   Eksport:
     CameraStore      — klass: load(), apply(res), refreshStatus();
                        konstruktor 30 s taymer va visibilitychange ni ulaydi
     cameraStore      — yagona nusxa
     loadCameras()    — to'liq yuklash + markerlarni qayta qurish (Promise)
     refreshStatus()  — yengil yangilash: o'zgarmagan bo'lsa faqat ikonkalar

   Bog'liqliklar:
     import: ./state.js, ./api.js, ../map/map.js, ../map/camera-list.js,
             ../map/selection.js, ../wall/video-wall.js,
             ../dashboard/dashboard.js (renderDash, renderSystem), ../admin/admin.js

   DOM: to'g'ridan-to'g'ri yo'q (boshqa modullar chizadi)
   Backend: GET /api/cameras

   Qoidalar / tuzoqlar:
     - Yashirin oynada (document.hidden) yangilanmaydi; qaytganda darhol yangilanadi.
     - Bir vaqtda faqat bitta refreshStatus ishlaydi (`refreshing` bayrog'i).
     - Dashboard faqat ochiq bo'lsa chiziladi — yashirin oynaga statistika so'ralmaydi.
     - Uzildi/ulandi hodisalari serverda yoziladi — bu yerda takrorlanmaydi.
   ========================================================================== */
import { state } from "./state.js";
import { api } from "./api.js";
import { rebuildMarkers, refreshMarkerIcons } from "../map/map.js";
import { renderList, renderStrip } from "../map/camera-list.js";
import { closeSel, updateSelHead } from "../map/selection.js";
import { buildWall } from "../wall/video-wall.js";
import { renderDash, renderSystem } from "../dashboard/dashboard.js";
import { loadAdminCameras } from "../admin/admin.js";

/* ---------- Ma'lumot yuklash va yangilash ---------- */
export class CameraStore {
  constructor() {
    this.refreshing = false;
    setInterval(() => this.refreshStatus(), 30000);
    // Yashirin oynada yangilanish to'xtaydi; qaytib kelinganda darhol yangilanadi.
    document.addEventListener("visibilitychange", () => { if (!document.hidden) this.refreshStatus(); });
  }

  async load() {
    const res = await api("/api/cameras");
    this.apply(res);
    rebuildMarkers();
  }

  apply(res) {
    // Uzildi/ulandi hodisalarini server o'zi yozib boradi (core/stats.py) —
    // dashboard ularni /api/stats/dashboard dan oladi, bu yerda takrorlamaymiz.
    state.cameras = res.cameras;
    state.byId = new Map(res.cameras.map((c) => [c.id, c]));
    // Tanlangan kamera o'chirilgan bo'lsa panel yopiladi.
    if (state.selectedId && !state.byId.has(state.selectedId)) closeSel();
    renderList();
    renderStrip();
    renderSystem();
    // Dashboard faqat ochiq bo'lsa chiziladi — yashirin oynaga statistika
    // so'rab, grafik chizib o'tirmaymiz.
    if (state.tab === "dash") renderDash();
    updateSelHead();
  }

  async refreshStatus() {
    if (this.refreshing || document.hidden) return;
    this.refreshing = true;
    let res;
    try { res = await api("/api/cameras"); } catch (e) { this.refreshing = false; return; }
    this.refreshing = false;
    const changed = res.cameras.length !== state.cameras.length ||
                    res.cameras.some((c) => !state.byId.has(c.id));
    this.apply(res);
    if (changed) rebuildMarkers(); else refreshMarkerIcons();
    // Devorda holati o'zgargan kamera plitkasi yangilanadi (diff — qolganlar
    // qayta ulanmaydi).
    if (state.tab === "wall") buildWall();
    // Boshqaruv jadvali ochiq bo'lsa, undagi Holat ustuni ham yangilanadi.
    if (state.tab === "admin" && state.admin) {
      loadAdminCameras(state.adminOffset).catch(() => {});
    }
  }
}

export const cameraStore = new CameraStore();

export function loadCameras() { return cameraStore.load(); }
export function refreshStatus() { return cameraStore.refreshStatus(); }
