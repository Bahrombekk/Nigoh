/* ==========================================================================
   map/tools.js — Map controls, Map/ScaleBar, masofa o'lchash (02.17), to'liq ekran (02.18)
   --------------------------------------------------------------------------
   Vazifasi:
     * O'ngdagi boshqaruvlar: Zoom + / −, "Joylashuvim" (geolocation),
       "Masofa oʻlchash" (nuqtalar bosiladi — bo'laklar va jami), "Toʻliq ekran".
       Klaviatura: + / − zoom, L — joylashuv (input ichida ishlamaydi).
     * Masshtab chizig'i + kursor koordinatasi (bosilsa nusxalanadi).

   Eksport: MapTools, tools, initTools()
   Bog'liqliklar: ../core/state.js, ../core/ui.js (onShortcut, toast), ../core/icons.js,
                  ./map.js (map), ./util.js (cssColor)
   DOM: #z-in, #z-out, #mp-locate, #mp-measure, #mp-fs, #mp-measure-bar*, #mp-scale*
   Hodisa: "measure:point" (detail: {lat, lng}) — o'lchash paytida marker bosilsa (selection.js)
   Holat: state.measuring — o'lchash rejimi (karta ochilmaydi)
   ========================================================================== */
import { $, state } from "../core/state.js";
import { onShortcut, toast } from "../core/ui.js";
import { icon } from "../core/icons.js";
import { map } from "./map.js";
import { cssColor } from "./util.js";

function niceNum(m) {
  const pow = Math.pow(10, Math.floor(Math.log10(m)));
  const d = m / pow;
  return pow * (d >= 5 ? 5 : d >= 3 ? 3 : d >= 2 ? 2 : 1);
}
function fmtDist(m) {
  if (m < 1000) return Math.round(m) + " m";
  return (m / 1000).toFixed(m < 10000 ? 2 : 1).replace(".", ",") + " km";
}
function fmtCoord(ll) {
  return Math.abs(ll.lat).toFixed(4) + "° " + (ll.lat >= 0 ? "N" : "S") + " · " +
         Math.abs(ll.lng).toFixed(4) + "° " + (ll.lng >= 0 ? "E" : "W");
}

export class MapTools {
  constructor() {
    this.pts = [];
    this.layer = null;
    this.me = null;
  }

  init() {
    $("z-in").addEventListener("click", () => map.zoomIn());
    $("z-out").addEventListener("click", () => map.zoomOut());
    $("mp-locate").addEventListener("click", () => this.locate());
    $("mp-measure").addEventListener("click", () => this.setMeasure(!state.measuring));
    $("mp-measure-clear").addEventListener("click", () => this.clearMeasure());
    $("mp-measure-done").addEventListener("click", () => this.setMeasure(false));
    $("mp-fs").addEventListener("click", () => this.toggleFullscreen());
    document.addEventListener("fullscreenchange", () => {
      const on = document.fullscreenElement === $("map-view");
      $("mp-fs").classList.toggle("is-on", on);
      $("mp-fs").innerHTML = icon(on ? "minimize" : "maximize");
      $("mp-fs").dataset.tip = on ? "Toʻliq ekrandan chiqish" : "Toʻliq ekran";
      $("mp-fs").setAttribute("aria-label", $("mp-fs").dataset.tip);
      if (state.tab === "map") setTimeout(() => map.invalidateSize(), 120);
    });

    const onMap = (fn) => () => { if (state.tab !== "map") return false; fn(); };
    onShortcut("+", onMap(() => map.zoomIn()));
    onShortcut("=", onMap(() => map.zoomIn()));
    onShortcut("-", onMap(() => map.zoomOut()));
    onShortcut("l", onMap(() => this.locate()));
    onShortcut("L", onMap(() => this.locate()));

    // Masofa o'lchash: xarita bosilganda nuqta.
    map.on("click", (e) => { if (state.measuring) this.addPoint(e.latlng); });
    map.on("dblclick", (e) => { if (state.measuring) { L.DomEvent.stop(e); this.setMeasure(false); } });
    document.addEventListener("measure:point", (e) => this.addPoint(L.latLng(e.detail.lat, e.detail.lng)));
    document.addEventListener("theme:changed", () => this.drawMeasure());

    // Masshtab + kursor koordinatasi.
    map.on("zoomend moveend resize", () => this.updateScale());
    map.on("mousemove", (e) => { this.cursor = e.latlng; this.paintCoord(); });
    map.getContainer().addEventListener("mouseleave", () => { this.cursor = null; this.paintCoord(); });
    $("mp-scale-coord").addEventListener("click", () => this.copyCoord());
    this.updateScale();
  }

  updateScale() {
    const y = map.getSize().y / 2;
    const maxPx = 80;
    const a = map.containerPointToLatLng([0, y]);
    const b = map.containerPointToLatLng([maxPx, y]);
    const meters = map.distance(a, b);
    if (!meters || !isFinite(meters)) return;
    const nice = niceNum(meters);
    $("mp-scale-bar").style.width = Math.round((maxPx * nice) / meters) + "px";
    $("mp-scale-label").textContent = nice >= 1000 ? nice / 1000 + " km" : nice + " m";
    this.paintCoord();
  }

  paintCoord() {
    const ll = this.cursor || map.getCenter();
    $("mp-scale-coord").textContent = fmtCoord(ll);
  }

  copyCoord() {
    const ll = this.cursor || map.getCenter();
    const text = ll.lat.toFixed(6) + ", " + ll.lng.toFixed(6);
    const done = () => toast("Koordinata nusxalandi: " + text, { tone: "success" });
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => toast(text, { tone: "info" }));
    else toast(text, { tone: "info" });
  }

  /* ---------- Joylashuvim ---------- */
  locate() {
    if (!navigator.geolocation) { toast("Brauzer joylashuvni aniqlay olmaydi", { tone: "error" }); return; }
    const btn = $("mp-locate");
    btn.classList.add("is-busy");
    navigator.geolocation.getCurrentPosition((pos) => {
      btn.classList.remove("is-busy");
      btn.classList.add("is-on");
      const ll = [pos.coords.latitude, pos.coords.longitude];
      if (this.me) this.me.remove();
      const brand = cssColor("--color-bg-brand").color;
      this.me = L.layerGroup([
        L.circle(ll, { radius: Math.min(pos.coords.accuracy || 0, 3000), color: brand, weight: 1, opacity: 0.4, fillOpacity: 0.08, interactive: false }),
        L.marker(ll, { interactive: false, keyboard: false,
          icon: L.divIcon({ className: "mp-me", html: '<span class="mp-me__dot pulse"></span>', iconSize: [24, 24], iconAnchor: [12, 12] }) }),
      ]).addTo(map);
      map.flyTo(ll, Math.max(map.getZoom(), 14), { duration: 0.6 });
    }, (err) => {
      btn.classList.remove("is-busy");
      toast(err && err.code === 1 ? "Joylashuvga ruxsat berilmagan" : "Joylashuvni aniqlab boʻlmadi", { tone: "error" });
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  /* ---------- Masofa o'lchash ---------- */
  setMeasure(on) {
    state.measuring = !!on;
    $("mp-measure").classList.toggle("is-on", state.measuring);
    $("mp-measure").setAttribute("aria-pressed", String(state.measuring));
    $("mp-measure-bar").hidden = !state.measuring;
    map.getContainer().classList.toggle("mp-measuring", state.measuring);
    if (state.measuring) map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
    if (!state.measuring) this.clearMeasure();
    else this.paintMeasure();
  }

  addPoint(ll) {
    if (!state.measuring) return;
    this.pts.push(ll);
    this.drawMeasure();
  }

  clearMeasure() {
    this.pts = [];
    this.drawMeasure();
  }

  drawMeasure() {
    if (this.layer) { this.layer.remove(); this.layer = null; }
    this.paintMeasure();
    if (!this.pts.length) return;
    const c = cssColor("--color-bg-brand").color;
    const halo = cssColor("--map-label-halo", "#ffffff").color;
    const g = this.layer = L.layerGroup().addTo(map);
    if (this.pts.length > 1) {
      L.polyline(this.pts, { color: halo, weight: 6, opacity: 0.9, interactive: false }).addTo(g);
      L.polyline(this.pts, { color: c, weight: 3, dashArray: "8 6", interactive: false }).addTo(g);
    }
    this.pts.forEach((p, i) => {
      L.circleMarker(p, { radius: 5, color: c, weight: 2, fillColor: halo, fillOpacity: 1, interactive: false }).addTo(g);
      if (i > 0) {
        const a = this.pts[i - 1];
        const mid = L.latLng((a.lat + p.lat) / 2, (a.lng + p.lng) / 2);
        L.tooltip({ permanent: true, direction: "center", className: "mp-measure-tip", interactive: false })
          .setLatLng(mid).setContent(fmtDist(map.distance(a, p))).addTo(g);
      }
    });
  }

  paintMeasure() {
    let total = 0;
    for (let i = 1; i < this.pts.length; i++) total += map.distance(this.pts[i - 1], this.pts[i]);
    $("mp-measure-total").textContent = this.pts.length > 1 ? fmtDist(total)
      : this.pts.length ? "Keyingi nuqtani bosing" : "Xaritada boshlangʻich nuqtani bosing";
    $("mp-measure-n").textContent = this.pts.length > 1 ? (this.pts.length - 1) + " boʻlak" : "";
    $("mp-measure-clear").disabled = !this.pts.length;
  }

  /* ---------- To'liq ekran ---------- */
  toggleFullscreen() {
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
    const el = $("map-view");
    if (el.requestFullscreen) el.requestFullscreen().catch(() => toast("Toʻliq ekran rejimi mavjud emas", { tone: "error" }));
  }

  escape() {
    if (state.measuring) { this.setMeasure(false); return true; }
    return false;
  }
}

export const tools = new MapTools();
export function initTools() { tools.init(); }
