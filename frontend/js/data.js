/* Kameralar ro'yxatini yuklash va davriy yangilash (/api/cameras). */
import { state } from "./state.js";
import { api } from "./api.js";
import { rebuildMarkers, refreshMarkerIcons } from "./map.js";
import { renderList, renderStrip } from "./camera-list.js";
import { closeSel, updateSelHead } from "./selection.js";
import { buildWall } from "./video-wall.js";
import { renderDash } from "./dashboard.js";
import { renderSystem } from "./charts.js";
import { loadAdminCameras } from "./admin.js";

/* ---------- Ma'lumot yuklash va yangilash ---------- */
export async function loadCameras() {
  const res = await api("/api/cameras");
  applyCameras(res);
  rebuildMarkers();
}

function applyCameras(res) {
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

let refreshing = false;
export async function refreshStatus() {
  if (refreshing || document.hidden) return;
  refreshing = true;
  let res;
  try { res = await api("/api/cameras"); } catch (e) { refreshing = false; return; }
  refreshing = false;
  const changed = res.cameras.length !== state.cameras.length ||
                  res.cameras.some((c) => !state.byId.has(c.id));
  applyCameras(res);
  if (changed) rebuildMarkers(); else refreshMarkerIcons();
  // Devorda holati o'zgargan kamera plitkasi yangilanadi (diff — qolganlar
  // qayta ulanmaydi).
  if (state.tab === "wall") buildWall();
  // Boshqaruv jadvali ochiq bo'lsa, undagi Holat ustuni ham yangilanadi.
  if (state.tab === "admin" && state.admin) {
    loadAdminCameras(state.adminOffset).catch(() => {});
  }
}
setInterval(refreshStatus, 30000);
// Yashirin oynada yangilanish to'xtaydi; qaytib kelinganda darhol yangilanadi.
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshStatus(); });
