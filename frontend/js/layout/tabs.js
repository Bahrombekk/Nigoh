/* ==========================================================================
   layout/tabs.js — bo'limlar va ilova qobig'i
   --------------------------------------------------------------------------
   Vazifasi:
     Bo'limlar (Xarita / Devor / Dashboard / Boshqaruv) orasida o'tish,
     manzil satridagi #hash bilan sinxronlash, yopiq bo'limlarga kirish
     talabi; ilova qobig'i: yon menyu (tor ekranda), yordam oynasi,
     tepadagi soat va sarlavhalardagi O'zbekiston konturi.

   Eksport:
     AUTH_TABS        — kirish talab qiladigan bo'limlar: ["dash", "admin"]
     Tabs             — klass: show(tab); konstruktor tab tugmalari, [data-tab-go] va hashchange ni ulaydi
     tabs             — yagona nusxa
     showTab(tab)     — bo'limga o'tish ("map" | "wall" | "dash" | "admin")
     AppShell         — klass: startClock(), drawHeadMaps(); konstruktor yon menyu va yordamni ulaydi
     appShell         — yagona nusxa
     startClock()     — tepadagi sana/soatni har soniyada yangilash
     drawHeadMaps()   — .ph-map SVG larga kontur va kamera nuqtalarini chizish (Promise)

   Bog'liqliklar:
     import: ../core/state.js, ../map/map.js (hasGeo, map), ../map/selection.js
             (selPlayer, selectCamera), ../wall/video-wall.js (buildWall, stopWall),
             ../dashboard/dashboard.js (renderDash), ../core/modals.js (openModal),
             ../auth/auth.js (openLogin), ../admin/admin.js (loadAdminCameras)

   DOM: #tabs, [data-tab-go], #map-view, #wall-view, #dash-view, #admin-view,
        #bell-panel, #side-toggle, body.side-open, #help-btn, #help-modal,
        #clock-date, #clock-time, svg.ph-map
   Backend: GET /assets/uz.geojson (kontur, statik); bo'lim ochilganda
            tegishli modul o'z so'rovini yuboradi

   Qoidalar / tuzoqlar:
     - Kirilmagan foydalanuvchi #dash/#admin ni chuqur havola bilan ham
       ocholmaydi: kirish ekrani chiqadi, manzil tozalanadi, bo'lim
       state.pendingTab ga yoziladi (kirgandan keyin ochiladi).
     - Operator uchun "admin" har doim "map" ga aylanadi.
     - Xaritadan chiqilsa panel pleyeri, devordan chiqilsa devor oqimlari to'xtaydi.
     - Xarita yashirin turganda o'lchamini bilmaydi — ko'ringanda invalidateSize.
     - Ilgari shu faylda bo'lgan dashboard tugmalari (#dash-refresh, #reg-csv,
       #qa-add, #qa-mtx) endi dashboard.js da, xarita to'liq ekrani (#map-fs) — map.js da.
   ========================================================================== */
import { $, state } from "../core/state.js";
import { hasGeo, map } from "../map/map.js";
import { selPlayer, selectCamera } from "../map/selection.js";
import { buildWall, stopWall } from "../wall/video-wall.js";
import { renderDash } from "../dashboard/dashboard.js";
import { openModal } from "../core/modals.js";
import { openLogin } from "../auth/auth.js";
import { loadAdminCameras } from "../admin/admin.js";

/* ---------- Tab'lar ---------- */
/* Kirish talab qiladigan bo'limlar. */
export const AUTH_TABS = ["dash", "admin"];

export class Tabs {
  constructor() {
    window.addEventListener("hashchange", () => {
      const t = location.hash.replace("#", "") || "map";
      if (["map", "wall", "dash", "admin"].includes(t) && t !== state.tab) this.show(t);
    });
    document.querySelectorAll("#tabs button").forEach((b) =>
      b.addEventListener("click", () => this.show(b.dataset.tab)));
    // Karta sarlavhalari va tezkor amallardagi havolalar.
    document.querySelectorAll("[data-tab-go]").forEach((b) =>
      b.addEventListener("click", () => {
        if (b.id === "bell-panel" || b.closest("#bell-panel")) $("bell-panel").hidden = true;
        this.show(b.dataset.tabGo);
      }));
  }

  show(tab) {
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
    // Bo'lim sarlavhalari tepa qatorda — faqat joriy bo'limniki ko'rinadi.
    document.querySelectorAll("#top .top-page").forEach((el) => { el.hidden = el.dataset.page !== tab; });
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
}

/* ---------- Ilova qobig'i: yon menyu, yordam, soat, kontur ---------- */
export class AppShell {
  constructor() {
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
  }

  /* Tepa qatordagi soat. */
  startClock() {
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
  async drawHeadMaps() {
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
}

export const tabs = new Tabs();
export const appShell = new AppShell();

export function showTab(tab) { tabs.show(tab); }
export function startClock() { appShell.startClock(); }
export function drawHeadMaps() { return appShell.drawHeadMaps(); }
