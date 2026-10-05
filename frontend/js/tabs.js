/* Bo'limlar (Xarita / Devor / Dashboard / Boshqaruv) orasida o'tish, yon menyu,
   bildirishnomalar, tizim holati paneli. */
import { $, state, toast } from "./state.js";
import { hasGeo, map } from "./map.js";
import { refreshStatus } from "./data.js";
import { selPlayer, selectCamera } from "./selection.js";
import { buildWall, stopWall } from "./video-wall.js";
import { loadStats, renderDash } from "./dashboard.js";
import { openModal } from "./modals.js";
import { openLogin } from "./auth.js";
import { loadAdminCameras } from "./admin.js";
import { openCameraForm } from "./camera-form.js";

/* ---------- Tab'lar ---------- */
/* Kirish talab qiladigan bo'limlar. */
export const AUTH_TABS = ["dash", "admin"];

export function showTab(tab) {
  // Dashboard va boshqaruv — faqat tizimga kirganlar uchun. Chuqur havola
  // (#dash) bilan ham ochilmaydi: kirish ekrani chiqadi, manzil tozalanadi.
  if (AUTH_TABS.includes(tab) && !state.admin) {
    state.pendingTab = tab;
    if (location.hash) history.replaceState(null, "", location.pathname);
    openLogin();
    return;
  }
  if (tab === "admin" && state.admin && state.admin.role === "operator") tab = "map";
  const prev = state.tab;
  state.tab = tab;
  document.querySelectorAll("#tabs button").forEach((b) =>
    b.classList.toggle("on", b.dataset.tab === tab));
  $("map-view").hidden = tab !== "map";
  $("wall-view").hidden = tab !== "wall";
  $("dash-view").hidden = tab !== "dash";
  $("admin-view").hidden = tab !== "admin";
  document.body.classList.remove("side-open");

  // Xarita yashirin turganda o'lchamini bilmaydi — ko'ringanda qayta o'lchaydi.
  if (tab === "map") setTimeout(() => map.invalidateSize(), 60);

  if (prev === "wall" && tab !== "wall") stopWall();
  if (prev === "map" && tab !== "map" && selPlayer) selPlayer.stop();

  if (tab === "wall") buildWall();
  if (tab === "dash") renderDash();
  if (tab === "admin") loadAdminCameras(0);
  if (tab === "map" && state.selectedId) selectCamera(state.selectedId, false);

  // Bo'lim manzilda saqlanadi — yangilansa yoki havola ulashilsa o'sha yerga qaytadi.
  const hash = tab === "map" ? "" : "#" + tab;
  if (location.hash !== hash) history.replaceState(null, "", location.pathname + hash);
}
window.addEventListener("hashchange", () => {
  const t = location.hash.replace("#", "") || "map";
  if (["map", "wall", "dash", "admin"].includes(t) && t !== state.tab) showTab(t);
});
document.querySelectorAll("#tabs button").forEach((b) =>
  b.addEventListener("click", () => showTab(b.dataset.tab)));
// Karta sarlavhalari va tezkor amallardagi havolalar.
document.querySelectorAll("[data-tab-go]").forEach((b) =>
  b.addEventListener("click", () => {
    if (b.id === "bell-panel" || b.closest("#bell-panel")) $("bell-panel").hidden = true;
    showTab(b.dataset.tabGo);
  }));

// Yon panel (tor ekranda) va yordam oynasi.
$("side-toggle").addEventListener("click", () => document.body.classList.toggle("side-open"));
// Tor ekranda menyu ochiq turganda qoraytirilgan fonga (body::after)
// bosish uni yopadi — psevdo-element bosilsa nishon body'ning o'zi bo'ladi.
document.addEventListener("click", (e) => {
  if (e.target === document.body && document.body.classList.contains("side-open")) {
    document.body.classList.remove("side-open");
  }
});
$("help-btn").addEventListener("click", () => openModal("help-modal"));
$("qa-add").addEventListener("click", () => {
  if (!state.admin) { showTab("admin"); return; }
  openCameraForm(null);
});
$("qa-mtx").addEventListener("click", () => {
  if (!state.admin) { showTab("admin"); return; }
  $("sync-btn").click();
});
$("map-fs").addEventListener("click", () => {
  if (document.fullscreenElement) { document.exitFullscreen(); return; }
  const el = $("map-card");
  if (el.requestFullscreen) el.requestFullscreen().then(() =>
    setTimeout(() => map.invalidateSize(), 120)).catch(() => {});
});
document.addEventListener("fullscreenchange", () => {
  if (state.tab === "map") setTimeout(() => map.invalidateSize(), 120);
});

/* Jonli belgi bosilsa \u2014 darhol yangilash. */
$("dash-refresh").addEventListener("click", async () => {
  const b = $("dash-refresh");
  b.disabled = true;
  await refreshStatus();
  await loadStats();
  renderDash();
  b.disabled = false;
});

/* Hududlar jadvalini CSV faylga chiqarish. */
$("reg-csv").addEventListener("click", () => {
  const rstats = new Map(((state.stats && state.stats.regions) || []).map((x) => [x.region, x]));
  const regions = [...new Set(state.cameras.map((c) => c.region))].sort();
  if (!regions.length) { toast("Eksport uchun ma'lumot yo'q", true); return; }
  const cell = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const head = ["Hudud", "Jami", "Onlayn", "Uzilgan", "Onlaynlik %", "24 soat %", "Bugungi uzilishlar"];
  const body = regions.map((rg) => {
    const list = state.cameras.filter((c) => c.region === rg);
    const up = list.filter((c) => c.online !== false).length;
    const st = rstats.get(rg);
    return [rg, list.length, up, list.length - up,
            list.length ? Math.round((up / list.length) * 100) : 0,
            st && st.uptime24 != null ? st.uptime24 : "",
            st ? st.events_today : ""].map(cell).join(",");
  });
  const blob = new Blob(["\ufeff" + [head.map(cell).join(","), ...body].join("\r\n")],
                        { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "nigoh-hududlar.csv";
  link.click();
  URL.revokeObjectURL(link.href);
  toast(regions.length + " ta hudud eksport qilindi");
});

/* Tepa qatordagi soat. */
export function startClock() {
  const WD = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Jum", "Shan"];
  const MO = ["yanv", "fevr", "mart", "apr", "may", "iyun",
              "iyul", "avg", "sent", "okt", "noyab", "dek"];
  const p = (x) => String(x).padStart(2, "0");
  const tick = () => {
    const d = new Date();
    $("clock-date").textContent = WD[d.getDay()] + ", " + d.getDate() + " " +
      MO[d.getMonth()] + " " + d.getFullYear();
    $("clock-time").textContent = p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  };
  tick();
  setInterval(tick, 1000);
}

/* Sarlavhalardagi O'zbekiston konturi — uz.geojson dan chiziladi. */
export async function drawHeadMaps() {
  const els = document.querySelectorAll(".ph-map");
  if (!els.length) return;
  let gj;
  try { gj = await (await fetch("/assets/uz.geojson")).json(); } catch (e) { return; }
  const geom = gj.features[0].geometry;
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  let minX = 180, maxX = -180, minY = 90, maxY = -90;
  polys.forEach((poly) => poly[0].forEach(([x, y]) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }));
  // Ekvivalent to'rtburchak (equirectangular) proyeksiya: 41° kenglikda bir
  // daraja uzunlik bir daraja kenglikdan ~25% qisqa. Shu koeffitsiyentsiz
  // O'zbekiston yassilashib, keraksiz cho'zilgan bo'lib chiqadi.
  const kx = Math.cos(((minY + maxY) / 2) * Math.PI / 180);
  const wDeg = (maxX - minX) * kx, hDeg = maxY - minY;
  const W = 200, H = 100, pad = 3;
  const sc = Math.min((W - 2 * pad) / wDeg, (H - 2 * pad) / hDeg);
  const ox = (W - wDeg * sc) / 2, oy = (H - hDeg * sc) / 2;
  const px = (x) => (ox + (x - minX) * kx * sc).toFixed(1);
  const py = (y) => (oy + (maxY - y) * sc).toFixed(1);
  const d = polys.map((poly) =>
    "M" + poly[0].map(([x, y]) => px(x) + "," + py(y)).join("L") + "Z").join("");
  // Kameralar joylashuvidan bir nechta nuqta — bezak sifatida.
  const dots = state.cameras.filter(hasGeo)
    .filter((_, i) => i % Math.max(1, Math.ceil(state.cameras.length / 9)) === 0)
    .slice(0, 9)
    .map((c) => '<circle cx="' + px(c.lng) + '" cy="' + py(c.lat) + '" r="1.5"/>').join("");
  // viewBox chizilgan konturga qirqiladi — shakl ramkani to'ldiradi va
  // yon tomonlarda bo'sh joy qolmaydi (CSS balandlik beradi, eni o'zi chiqadi).
  const vb = [ox - pad, oy - pad, wDeg * sc + 2 * pad, hDeg * sc + 2 * pad]
    .map((v) => v.toFixed(1)).join(" ");
  els.forEach((el) => {
    el.setAttribute("viewBox", vb);
    el.innerHTML = '<path d="' + d + '"/>' + dots;
  });
}
