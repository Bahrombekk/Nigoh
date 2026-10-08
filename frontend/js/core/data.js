/* ==========================================================================
   core/data.js — kameralar ro'yxati (yuklash va davriy yangilash)
   --------------------------------------------------------------------------
   Vazifasi:
     /api/cameras dan ochiq kameralar ro'yxatini olib `state.cameras` va
     `state.byId` ga yozadi, so'ng unga bog'liq hamma ko'rinishni yangilaydi
     (panel, markerlar, dashboard, devor, boshqaruv). Yangilanish oralig'i —
     `state.pollS` (Sozlamalar → Kuzatuv, /api/auth/me → poll_s, standart 30 s).
     Aloqa holati: state.camsAt (oxirgi muvaffaqiyatli yangilanish, ms),
     state.pollFails (ketma-ket xatolar) — panel footeri va "Aloqa yoʻq"
     Alert'i (02.09) shundan; "cameras:status" hodisasi.

   Eksport:
     CameraStore      — klass: load(), apply(res), refreshStatus(force)
     cameraStore      — yagona nusxa
     loadCameras()    — to'liq yuklash + markerlarni qayta qurish (Promise)
     refreshStatus(force) — yengil yangilash (force — yashirin oynada ham, "Qayta urinish")

   Bog'liqliklar:
     import: ./state.js, ./api.js, ../map/map.js, ../map/camera-list.js,
             ../map/selection.js, ../wall/video-wall.js,
             ../dashboard/dashboard.js (renderDash, renderSystem), ../admin/admin.js
   Backend: GET /api/cameras

   Qoidalar / tuzoqlar:
     - Yashirin oynada (document.hidden) yangilanmaydi; qaytganda darhol yangilanadi.
     - Bir vaqtda faqat bitta refreshStatus ishlaydi (`refreshing` bayrog'i).
     - Taymer har safar state.pollS dan qayta o'qiladi (sozlama o'zgarsa darhol).
     - Dashboard faqat ochiq bo'lsa chiziladi.
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
    this.timer = null;
    state.pollFails = 0;
    state.camsAt = null;
    state.camsLoaded = false;
    document.addEventListener("visibilitychange", () => { if (!document.hidden) this.refreshStatus(); });
  }

  schedule() {
    clearTimeout(this.timer);
    const s = Math.max(10, Math.min(300, Number(state.pollS) || 30));
    this.timer = setTimeout(() => this.refreshStatus(), s * 1000);
  }

  status(ok) {
    if (ok) { state.pollFails = 0; state.camsAt = Date.now(); }
    else state.pollFails = (state.pollFails || 0) + 1;
    document.dispatchEvent(new CustomEvent("cameras:status", { detail: { ok, fails: state.pollFails, at: state.camsAt } }));
  }

  async load() {
    let res;
    try { res = await api("/api/cameras"); }
    catch (e) { this.status(false); throw e; }
    state.camsLoaded = true;
    this.apply(res);
    rebuildMarkers();
    this.status(true);
    this.schedule();
  }

  apply(res) {
    state.cameras = res.cameras;
    state.byId = new Map(res.cameras.map((c) => [c.id, c]));
    if (state.selectedId && !state.byId.has(state.selectedId)) closeSel();
    renderList();
    renderStrip();
    renderSystem();
    if (state.tab === "dash") renderDash();
    updateSelHead();
  }

  async refreshStatus(force) {
    if (!state.camsLoaded) return;
    if (this.refreshing || (document.hidden && !force)) { this.schedule(); return; }
    this.refreshing = true;
    let res;
    try { res = await api("/api/cameras"); }
    catch (e) { this.refreshing = false; this.status(false); this.schedule(); return; }
    this.refreshing = false;
    const changed = res.cameras.length !== state.cameras.length ||
                    res.cameras.some((c) => !state.byId.has(c.id));
    this.apply(res);
    if (changed) rebuildMarkers(); else refreshMarkerIcons();
    this.status(true);
    this.schedule();
    if (state.tab === "wall") buildWall();
    if (state.tab === "admin" && state.admin) {
      loadAdminCameras(state.adminOffset).catch(() => {});
    }
  }
}

export const cameraStore = new CameraStore();

export function loadCameras() { return cameraStore.load(); }
export function refreshStatus(force) { return cameraStore.refreshStatus(force); }
