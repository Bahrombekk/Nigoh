/* ==========================================================================
   admin/camera-form.js — kamera qo'shish (3 qadam) va tahrirlash (drawer)
   --------------------------------------------------------------------------
   Vazifasi (Figma 05.05–05.07, 05.09, 05.17):
     CameraWizard — "Yangi kamera" oynasi, Stepper: 1 Joylashuv (nomi, hudud,
       mini xarita, koordinata) → 2 Ulanish (RTSP / tayyor oqim, ishlab
       chiqaruvchi, IP+port, login/parol, "Qurilmani aniqlash" + Alert, bir
       nechta kanal bo'lsa — belgilash) → 3 Tekshiruv (kadr, Ochilish / Kodek /
       Signal, ishlash rejimi) → "Saqlash" → toast "Kamera qoʻshildi · Ochish".
       Har qadam alohida tekshiriladi; tugagan qadamga Stepper orqali qaytish mumkin.
     CameraDrawer — o'ng drawer "Kamerani tahrirlash": nomi, hudud, oqim manzili
       (mono, "ip:port/yo'l"), kodek (faqat ko'rish), rejim, faol; "Qoʻshimcha
       sozlamalar" ichida login/parol, ishlab chiqaruvchi, koordinata + mini xarita,
       izoh. "Tekshirish" — saqlamasdan ulanishni sinash.
     MiniMap — modal ichidagi kichik Leaflet xarita (bosish → koordinata,
       marker suriladi, maydonga yozish → marker siljiydi). NVR oynasi ham ishlatadi.
     Validatsiya — blur'da (TextField: .field.is-error + hint).

   Eksport:
     CameraWizard/cameraWizard, CameraDrawer/cameraDrawer, MiniMap,
     openCameraForm(cam)     — cam=null → qo'shish oynasi, aks holda tahrirlash drawer'i
     openCameraDrawer(cam)   — tahrirlash drawer'i
     loadVendors()           — /api/vendors (Promise)
     loadRegions()           — /api/admin/regions (+ ma'lum hududlar), Promise<string[]>
     fillRegionSelect(sel, value, placeholder)
     regionAt(lat, lng)      — koordinatadan viloyat (uz_regions.geojson)
     setFieldError(input, msg) / validators { ip, port, lat, lng, url }
     stopPicking(), xaritaTanlashniUlash() — v2 mosligi (endi asosiy xaritada tanlash yo'q)

   Bog'liqliklar:
     import: ../core/state.js, ../core/api.js, ../core/icons.js, ../core/ui.js,
             ../core/modals.js, ../core/data.js (loadCameras),
             ./admin.js (loadAdminCameras, probeCamera, codecLabel, fmtSec, fmtRes)
     global: L (Leaflet)
   DOM: #cam-modal (#f-*, #cam-steps, #cam-err), #cam-drawer (#e-*, #ed-*)
   Backend: GET /api/vendors, GET /api/admin/regions, POST /api/devices/scan (+ SSE
            events, snapshot) — yo'q bo'lsa POST /api/admin/scan; POST /api/admin/probe,
            POST /api/admin/cameras, PUT /api/admin/cameras/{id}, POST /api/admin/nvr/import

   Qoidalar / tuzoqlar:
     - Saqlashdan oldin MediaMTX yo'li yo'q — 3-qadamda jonli video emas, skan
       topgan kanalning surati (har 5 s yangilanadi). Skan bo'lmasa — faqat probe.
     - Tahrirlashda parol bo'sh → null (server eskisini saqlaydi); external_id,
       km, piket, temir yo'l qayta yuboriladi — PUT ularni o'chirib yubormasin.
     - modal yopilganda ("modal:closed") skan SSE va surat taymeri to'xtatiladi.
   ========================================================================== */
import { $, esc, state, toast } from "../core/state.js";
import { api, ApiError } from "../core/api.js";
import { hydrateIcons } from "../core/icons.js";
import { tooltip } from "../core/ui.js";
import { closeModal, openModal } from "../core/modals.js";
import { loadCameras } from "../core/data.js";
import { loadAdminCameras, probeCamera, codecLabel, fmtSec, fmtRes } from "./admin.js";

/* ---------- Hududlar ---------- */
function pointInRing(lat, lng, ring) {
  // Nur usuli (ray casting); geojson koordinatasi [lng, lat] tartibida.
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

let regionGeo = null;
let regionGeoP = null;
function ensureRegionGeo() {
  if (regionGeo) return Promise.resolve(regionGeo);
  if (!regionGeoP) regionGeoP = fetch("/assets/uz_regions.geojson")
    .then((r) => { if (!r.ok) throw new Error("chegara fayli yuklanmadi"); return r.json(); })
    .then((g) => { regionGeo = g; return g; })
    .catch((e) => { regionGeoP = null; throw e; });
  return regionGeoP;
}
export function regionAt(lat, lng) {
  if (!regionGeo) return "";
  for (const f of regionGeo.features) {
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const poly of polys) {
      if (pointInRing(lat, lng, poly[0]) && !poly.slice(1).some((h) => pointInRing(lat, lng, h))) return f.properties.name;
    }
  }
  return "";
}
/* Koordinatadan hududni aniqlab, select'ga qo'yadi (bo'lsa variant qo'shiladi). */
export function autoRegion(sel, lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  ensureRegionGeo().then(() => {
    const name = regionAt(lat, lng);
    if (!name) return;
    if (![...sel.options].some((o) => o.value === name)) sel.add(new Option(name, name));
    sel.value = name;
  }).catch(() => {});
}

let regionList = null;
export async function loadRegions() {
  if (regionList) return regionList;
  const set = new Set();
  try {
    const r = await api("/api/admin/regions");
    (r.regions || []).forEach((x) => { const n = typeof x === "string" ? x : (x.name || x.title || ""); if (n) set.add(n); });
  } catch (e) { /* zaxira: kameralardagi hududlar */ }
  state.cameras.forEach((c) => { if (c.region) set.add(c.region); });
  regionList = [...set].sort((a, b) => a.localeCompare(b, "uz"));
  return regionList;
}
export function fillRegionSelect(sel, value, placeholder) {
  const list = [...(regionList || [])];
  if (value && !list.includes(value)) list.unshift(value);
  sel.innerHTML = (placeholder != null ? '<option value="">' + esc(placeholder) + "</option>" : "") +
    list.map((r) => '<option value="' + esc(r) + '">' + esc(r) + "</option>").join("");
  sel.value = value || "";
}

/* ---------- Validatsiya (TextField: blur'da) ---------- */
export function setFieldError(input, msg) {
  const f = input.closest(".field");
  if (!f) return !msg;
  f.classList.toggle("is-error", !!msg);
  input.setAttribute("aria-invalid", msg ? "true" : "false");
  const hint = f.querySelector(".field__hint");
  if (hint) {
    if (hint.dataset.orig === undefined) hint.dataset.orig = hint.hidden ? "" : hint.innerHTML || " ";
    if (msg) {
      hint.hidden = false;
      hint.innerHTML = '<svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg><span>' + esc(msg) + "</span>";
    } else {
      const o = hint.dataset.orig;
      if (o && o !== " ") hint.innerHTML = o; else { hint.innerHTML = ""; hint.hidden = true; }
    }
  }
  return !msg;
}
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const HOST = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
export const validators = {
  required: (v, m) => (v.trim() ? "" : m),
  ip(v) {
    v = v.trim();
    if (!v) return "IP manzilni kiriting";
    if (/^\d+(\.\d+)*$/.test(v)) return IPV4.test(v) ? "" : "Manzil formati notoʻgʻri: 0–255.0–255.0–255.0–255";
    return HOST.test(v) ? "" : "Manzil formati notoʻgʻri";
  },
  port(v) {
    const n = Number(String(v).trim());
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? "" : "Port 1–65535 oraligʻida boʻlsin";
  },
  lat(v, required) {
    if (!String(v).trim()) return required ? "Xaritada nuqtani tanlang" : "";
    const n = Number(String(v).replace(",", "."));
    return Number.isFinite(n) && n >= -90 && n <= 90 ? "" : "Kenglik −90…90 oraligʻida";
  },
  lng(v, required) {
    if (!String(v).trim()) return required ? "Xaritada nuqtani tanlang" : "";
    const n = Number(String(v).replace(",", "."));
    return Number.isFinite(n) && n >= -180 && n <= 180 ? "" : "Uzunlik −180…180 oraligʻida";
  },
  url(v) {
    v = v.trim();
    if (!v) return "Oqim manzilini kiriting";
    return /^(rtsp|rtsps|https?):\/\/[^\s]+$/i.test(v) ? "" : "Manzil rtsp:// yoki http(s):// bilan boshlansin";
  },
};
const num = (v) => { const n = Number(String(v).replace(",", ".").trim()); return String(v).trim() && Number.isFinite(n) ? n : null; };
function blurCheck(input, fn) {
  input.addEventListener("blur", () => setFieldError(input, fn(input.value)));
  input.addEventListener("input", () => { if (input.closest(".field.is-error")) setFieldError(input, fn(input.value)); });
}

/* Alert yasovchi: tone success | error | warning | info | wait */
export function showAlert(el, tone, title, text) {
  if (!tone) { el.hidden = true; el.innerHTML = ""; return; }
  const ic = { success: "circle-check", error: "triangle-exclamation", warning: "triangle-exclamation", info: "circle-question" }[tone];
  el.hidden = false;
  el.className = "alert" + (tone === "wait" ? " alert--wait" : " alert--" + tone);
  el.setAttribute("role", tone === "error" ? "alert" : "status");
  el.innerHTML = (tone === "wait" ? '<span class="spinner ad-spin-sm" aria-hidden="true"></span>' : '<span data-icon="' + ic + '" data-icon-size="sm"></span>') +
    '<div class="alert__body"><span class="alert__title">' + esc(title) + "</span>" +
    (text ? '<span class="alert__text">' + esc(text) + "</span>" : "") + "</div>";
  hydrateIcons(el);
}

/* ---------- Mini xarita ---------- */
const DEFAULT_VIEW = { center: [41.3, 64.6], zoom: 5 };
export class MiniMap {
  constructor(el, onPick) {
    this.el = el;
    this.onPick = onPick;
    this.map = null;
    this.marker = null;
  }

  ensure() {
    if (this.map || typeof L === "undefined") return !!this.map;
    this.map = L.map(this.el, { zoomControl: true, attributionControl: false, scrollWheelZoom: "center" })
      .setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, className: "ad-mm__tiles" }).addTo(this.map);
    this.map.on("click", (e) => { this.place(e.latlng.lat, e.latlng.lng); this.pick(); });
    return true;
  }

  icon() {
    return L.divIcon({ className: "", iconSize: [44, 44], iconAnchor: [22, 22],
      html: '<span class="ad-mk"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3Z"/><circle cx="12" cy="13" r="3.5"/></svg></span>' });
  }

  place(lat, lng) {
    if (!this.map) return;
    if (!this.marker) {
      this.marker = L.marker([lat, lng], { icon: this.icon(), draggable: true, keyboard: false }).addTo(this.map);
      this.marker.on("dragend", () => this.pick());
    } else this.marker.setLatLng([lat, lng]);
  }

  pick() {
    const p = this.marker.getLatLng();
    this.onPick(Number(p.lat.toFixed(5)), Number(p.lng.toFixed(5)));
  }

  /* Ko'rinadigan bo'lganda chaqiriladi (modal ochilgach — o'lcham tayyor). */
  show(lat, lng) {
    if (!this.ensure()) return;
    setTimeout(() => {
      this.map.invalidateSize();
      this.set(lat, lng, true);
    }, 60);
  }

  /* Maydonlardan: marker siljiydi. */
  set(lat, lng, recenter) {
    if (!this.map) return;
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng)) {
      this.place(lat, lng);
      if (recenter) this.map.setView([lat, lng], Math.max(this.map.getZoom(), 14));
      else if (!this.map.getBounds().contains([lat, lng])) this.map.panTo([lat, lng]);
    } else {
      if (this.marker) { this.map.removeLayer(this.marker); this.marker = null; }
      if (recenter) this.map.setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
    }
  }
}

/* Kenglik/uzunlik maydonlari + mini xarita + hudud select'ini bog'laydi. */
function bindCoords({ latEl, lngEl, mapEl, regionEl, required }) {
  const mm = new MiniMap(mapEl, (lat, lng) => {
    latEl.value = lat.toFixed(5); lngEl.value = lng.toFixed(5);
    setFieldError(latEl, ""); setFieldError(lngEl, "");
    if (regionEl) autoRegion(regionEl, lat, lng);
  });
  const sync = () => {
    const lat = num(latEl.value), lng = num(lngEl.value);
    if (lat != null && lng != null) { mm.set(lat, lng, false); if (regionEl) autoRegion(regionEl, lat, lng); }
  };
  latEl.addEventListener("change", sync);
  lngEl.addEventListener("change", sync);
  blurCheck(latEl, (v) => validators.lat(v, required()));
  blurCheck(lngEl, (v) => validators.lng(v, required()));
  return mm;
}

function fillVendors(sel, value) {
  sel.innerHTML = (state.vendors || []).map((v) => '<option value="' + esc(v.id) + '">' + esc(v.name) + "</option>").join("") ||
    '<option value="boshqa">Boshqa</option>';
  sel.value = value || "boshqa";
  if (!sel.value && sel.options.length) sel.selectedIndex = 0;
}

/* ---------- Kamera qo'shish: 3 qadam ---------- */
export class CameraWizard {
  constructor() {
    this.step = 1;
    this.done = 0;                    // eng katta tugagan qadam
    this.src = "rtsp";
    this.scan = null;                 // {vendor, vendor_name, device, channels: [...]}
    this.es = null;
    this.snapTimer = null;
    this.probe = null;
    this.probeKey = "";

    const m = $("cam-modal");
    hydrateIcons(m);
    this.mm = bindCoords({ latEl: $("f-lat"), lngEl: $("f-lng"), mapEl: $("f-map"), regionEl: $("f-region"), required: () => true });

    blurCheck($("f-name"), (v) => validators.required(v, "Kamera nomini kiriting"));
    blurCheck($("f-ip"), (v) => validators.ip(v));
    blurCheck($("f-port"), (v) => validators.port(v));
    blurCheck($("f-url"), (v) => validators.url(v));

    document.querySelectorAll("#f-src button").forEach((b) => b.addEventListener("click", () => this.setSrc(b.dataset.src)));
    $("f-vendor").addEventListener("change", () => {
      const v = (state.vendors || []).find((x) => x.id === $("f-vendor").value);
      if (!v) return;
      $("f-path").value = v.path;
      if (!$("f-port").value || $("f-port").value === "554") $("f-port").value = v.port;
      this.updatePreview();
    });
    ["f-ip", "f-port", "f-user", "f-pass", "f-path"].forEach((id) => $(id).addEventListener("input", () => {
      this.updatePreview();
      if (id !== "f-path" && this.scan) { this.scan = null; this.renderChannels(); showAlert($("f-scan-out"), null); }
    }));
    $("f-scan").addEventListener("click", () => this.runScan());
    $("f-next").addEventListener("click", () => this.go(this.step + 1));
    $("f-back").addEventListener("click", () => this.go(this.step - 1));
    $("f-save").addEventListener("click", () => this.save());
    document.querySelectorAll("#cam-steps .ad-step").forEach((li) =>
      li.querySelector("button").addEventListener("click", () => {
        const s = Number(li.dataset.step);
        if (s <= this.done + 1 && s !== this.step) this.go(s);
      }));
    m.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.matches("input") && !e.isComposing) {
        e.preventDefault();
        if (this.step < 3) this.go(this.step + 1); else this.save();
      }
    });
    document.addEventListener("modal:closed", (e) => { if (e.detail.id === "cam-modal") this.cleanup(); });
  }

  async open() {
    if (!state.vendors.length) await loadVendors().catch(() => {});
    await loadRegions();
    this.step = 1; this.done = 0; this.scan = null; this.probe = null; this.probeKey = "";
    ["f-name", "f-lat", "f-lng", "f-ip", "f-user", "f-pass", "f-url"].forEach((id) => { $(id).value = ""; setFieldError($(id), ""); });
    $("f-port").value = 554; setFieldError($("f-port"), "");
    $("f-path").value = "/stream1";
    $("f-mode").value = "ondemand";
    fillRegionSelect($("f-region"), "", "Koordinatadan aniqlansin");
    fillVendors($("f-vendor"), "boshqa");
    this.setSrc("rtsp");
    this.renderChannels();
    showAlert($("f-scan-out"), null);
    showAlert($("cam-err"), null);
    this.updatePreview();
    this.paint();
    openModal("cam-modal");
    this.mm.show(null, null);
    setTimeout(() => $("f-name").focus(), 60);
  }

  cleanup() {
    if (this.es) { this.es.close(); this.es = null; }
    clearInterval(this.snapTimer); this.snapTimer = null;
  }

  setSrc(type) {
    this.src = type;
    document.querySelectorAll("#f-src button").forEach((b) => {
      const on = b.dataset.src === type;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-checked", String(on));
    });
    $("rtsp-block").hidden = type !== "rtsp";
    $("manual-block").hidden = type !== "manual";
  }

  updatePreview() {
    const ip = $("f-ip").value.trim() || "IP";
    const port = $("f-port").value || "554";
    const user = $("f-user").value.trim();
    let path = $("f-path").value.trim();
    if (path && !path.startsWith("/")) path = "/" + path;
    $("f-preview").textContent = "rtsp://" + (user ? user + ($("f-pass").value ? ":•••" : "") + "@" : "") + ip + ":" + port + (path || "/");
  }

  validate(step) {
    let ok = true;
    const chk = (el, msg) => { if (!setFieldError(el, msg)) { if (ok) el.focus(); ok = false; } };
    if (step === 1) {
      chk($("f-name"), validators.required($("f-name").value, "Kamera nomini kiriting"));
      chk($("f-lat"), validators.lat($("f-lat").value, true));
      chk($("f-lng"), validators.lng($("f-lng").value, true));
    } else if (step === 2) {
      if (this.src === "rtsp") {
        chk($("f-ip"), validators.ip($("f-ip").value));
        chk($("f-port"), validators.port($("f-port").value));
      } else chk($("f-url"), validators.url($("f-url").value));
    }
    return ok;
  }

  go(step) {
    if (step < 1 || step > 3) return;
    if (step > this.step) {
      for (let s = this.step; s < step; s++) {
        if (s !== this.step) { this.step = s; this.paint(); }
        if (!this.validate(s)) return;
      }
      this.done = Math.max(this.done, step - 1);
    }
    this.step = step;
    showAlert($("cam-err"), null);
    this.paint();
    if (step === 1) this.mm.show(num($("f-lat").value), num($("f-lng").value));
    if (step === 3) this.enterReview(); else { clearInterval(this.snapTimer); this.snapTimer = null; }
    const first = document.querySelector('#cam-modal [data-pane="' + step + '"] input:not([type=hidden]), #cam-modal [data-pane="' + step + '"] select');
    if (first && step !== 3) setTimeout(() => first.focus(), 30);
  }

  paint() {
    document.querySelectorAll("#cam-modal .ad-pane").forEach((p) => { p.hidden = Number(p.dataset.pane) !== this.step; });
    const lines = document.querySelectorAll("#cam-steps .ad-step__line");
    document.querySelectorAll("#cam-steps .ad-step").forEach((li) => {
      const s = Number(li.dataset.step);
      const st = s === this.step ? "current" : s <= this.done ? "done" : "upcoming";
      li.dataset.status = st;
      li.querySelector(".ad-step__mk").innerHTML = st === "done"
        ? '<svg class="i xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
        : String(s);
      const b = li.querySelector("button");
      b.disabled = !(s <= this.done + 1) || s === this.step;
      if (st === "current") b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
    });
    lines.forEach((l, i) => l.classList.toggle("is-done", i + 1 <= this.done));
    $("f-back").hidden = this.step === 1;
    $("f-next").hidden = this.step === 3;
    $("f-save").hidden = this.step !== 3;
    this.updateSaveLabel();
  }

  /* --- qurilmani aniqlash --- */
  picked() {
    if (!this.scan) return null;
    return this.scan.channels.filter((c) => {
      const cb = document.querySelector('#f-channels input[data-ch="' + c.channel + '"]');
      return cb ? cb.checked : true;
    });
  }

  updateSaveLabel() {
    const p = this.src === "rtsp" ? this.picked() : null;
    $("f-save-label").textContent = p && p.length > 1 ? p.length + " ta kamerani saqlash" : "Saqlash";
  }

  renderChannels() {
    const box = $("f-channels");
    const ch = this.scan ? this.scan.channels : [];
    if (ch.length < 2) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = '<div class="label-xs t-tertiary">Qoʻshiladigan kanallar</div>' + ch.map((c) =>
      '<label class="check-row ad-ch"><input type="checkbox" class="check" data-ch="' + c.channel + '" checked>' +
      '<span class="label-sm t-primary">' + c.channel + "-kanal</span>" +
      '<span class="codec-tag">' + esc((c.codec || "?") + (c.needs_transcode ? " → H.264" : "")) + "</span>" +
      '<span class="mono-xs t-tertiary ellipsis">' + esc(c.rtsp_path) + "</span></label>").join("");
    box.querySelectorAll("input").forEach((cb) => cb.addEventListener("change", () => this.updateSaveLabel()));
  }

  scanBody() {
    return { ip: $("f-ip").value.trim(), port: Number($("f-port").value) || 554,
             username: $("f-user").value.trim(), password: $("f-pass").value || "" };
  }

  async runScan() {
    const okIp = setFieldError($("f-ip"), validators.ip($("f-ip").value));
    const okPort = setFieldError($("f-port"), validators.port($("f-port").value));
    if (!okIp || !okPort) return;
    this.cleanup();
    this.scan = null; this.probe = null; this.probeKey = "";
    this.renderChannels(); this.updateSaveLabel();
    const out = $("f-scan-out");
    showAlert(out, "wait", "Qurilma aniqlanmoqda…", "Shablon va kanallar tekshirilmoqda (10–30 s)");
    $("f-scan").disabled = true;
    try {
      const job = await api("/api/devices/scan", { method: "POST", body: JSON.stringify(this.scanBody()) });
      await this.listen(job);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 405)) await this.legacyScan();
      else showAlert(out, "error", "Aniqlab boʻlmadi", e.message);
    }
    $("f-scan").disabled = false;
  }

  listen(job) {
    const out = $("f-scan-out");
    return new Promise((resolve) => {
      const res = { vendor: "", vendor_name: "", channels: [] };
      const es = this.es = new EventSource(job.events);
      const finish = () => { es.close(); if (this.es === es) this.es = null; resolve(); };
      es.addEventListener("meta", (ev) => { Object.assign(res, JSON.parse(ev.data)); });
      es.addEventListener("channel", (ev) => {
        const c = JSON.parse(ev.data);
        if (!c.ok) return;
        res.channels.push(c);
        res.channels.sort((a, b) => a.channel - b.channel);
        showAlert(out, "wait", (res.vendor_name || "Qurilma") + " · " + res.channels.length + " kanal topildi", "Qolgan kanallar tekshirilmoqda…");
      });
      es.addEventListener("done", (ev) => {
        const d = JSON.parse(ev.data);
        res.device = d.device || (res.channels.length > 1 ? "nvr" : "camera");
        res.vendor = d.vendor || res.vendor; res.vendor_name = d.vendor_name || res.vendor_name;
        this.applyScan(res);
        finish();
      });
      es.addEventListener("error", (ev) => {
        // Server "error" hodisasi (data bor) yoki ulanish uzildi.
        let msg = "Qurilma javob bermadi";
        try { if (ev.data) msg = JSON.parse(ev.data).message || msg; } catch (e) { /* jim */ }
        if (res.channels.length) { res.device = res.channels.length > 1 ? "nvr" : "camera"; this.applyScan(res); }
        else showAlert(out, "error", "Aniqlab boʻlmadi", msg);
        finish();
      });
    });
  }

  async legacyScan() {
    const out = $("f-scan-out");
    try {
      const res = await api("/api/admin/scan", { method: "POST", body: JSON.stringify(this.scanBody()) });
      if (!res.found) showAlert(out, "error", "Aniqlab boʻlmadi", res.message);
      else this.applyScan(res);
    } catch (e) { showAlert(out, "error", "Aniqlab boʻlmadi", e.message); }
  }

  applyScan(res) {
    if (!res.channels || !res.channels.length) { showAlert($("f-scan-out"), "error", "Aniqlab boʻlmadi", "Jonli kanal topilmadi"); return; }
    this.scan = res;
    const first = res.channels[0];
    if (res.vendor && [...$("f-vendor").options].some((o) => o.value === res.vendor)) $("f-vendor").value = res.vendor;
    if (first.rtsp_path) $("f-path").value = first.rtsp_path;
    this.updatePreview();
    this.renderChannels();
    this.updateSaveLabel();
    const n = res.channels.length;
    showAlert($("f-scan-out"), "success",
      "Qurilma aniqlandi: " + (res.vendor_name || res.vendor || "kamera") + (res.device === "nvr" ? " registrator (NVR)" : ""),
      n + " kanal · RTSP yoʻli avtomatik toʻldirildi");
  }

  /* --- 3-qadam: tekshiruv --- */
  async enterReview() {
    const box = $("f-preview-box");
    const img = $("f-preview-img");
    const setState = (st, msg) => {
      box.dataset.state = st;
      $("f-preview-msg").innerHTML = st === "connecting"
        ? '<span class="spinner"></span><span class="label-sm">' + esc(msg || "Ulanmoqda…") + "</span>"
        : st === "offline"
          ? '<svg class="i lg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m2 2 20 20"/><path d="M9.5 4h5L17 7h3a2 2 0 0 1 2 2v7.5"/><path d="M14.1 14.1A3.5 3.5 0 1 1 9.9 9.9"/><path d="M18 20H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2.5"/></svg><span class="label-sm">' + esc(msg) + "</span>"
          : "";
    };
    const kp = (open, codec, codecMeta, signal, signalMeta) => {
      $("f-k-open").textContent = open; $("f-k-codec").textContent = codec; $("f-k-codec-meta").textContent = codecMeta;
      $("f-k-signal").textContent = signal; $("f-k-signal-meta").textContent = signalMeta;
    };
    $("f-preview-time").textContent = "";

    if (this.src !== "rtsp") {
      img.removeAttribute("src");
      setState("offline", "Oldindan koʻrish saqlangandan keyin");
      $("f-preview-meta").textContent = $("f-url").value.trim();
      kp("—", "—", "server aniqlaydi", "—", "tayyor oqim");
      return;
    }

    const picked = this.picked();
    const ch = picked && picked.length ? picked[0] : (this.scan && this.scan.channels[0]);
    const path = (ch && ch.rtsp_path) || $("f-path").value.trim() || "/";
    const body = { ip: $("f-ip").value.trim(), port: Number($("f-port").value) || 554, username: $("f-user").value.trim(),
                   password: $("f-pass").value || null, rtsp_path: path, camera_id: null };
    const key = JSON.stringify(body);

    // Kadr: skan topgan kanal surati (saqlanmagan qurilmadan), 5 s da yangilanadi.
    clearInterval(this.snapTimer); this.snapTimer = null;
    if (ch && ch.snapshot_url) {
      setState("connecting");
      let tries = 0;
      const load = () => {
        if (++tries > 24 || this.step !== 3) { clearInterval(this.snapTimer); return; }
        const u = ch.snapshot_url + (ch.snapshot_url.includes("?") ? "&" : "?") + "t=" + Date.now();
        const im = new Image();
        im.onload = () => { img.src = u; setState("live"); $("f-preview-time").textContent = new Date().toTimeString().slice(0, 8); };
        im.onerror = () => { if (!img.getAttribute("src")) setState("offline", "Kadr olinmadi"); };
        im.src = u;
      };
      load();
      this.snapTimer = setInterval(load, 5000);
    } else {
      img.removeAttribute("src");
      setState("connecting", "Tekshirilmoqda…");
    }

    if (this.probe && this.probeKey === key) { this.paintProbe(this.probe, ch, kp, setState); return; }
    kp("…", "…", "aniqlanmoqda", "…", "tekshirilmoqda");
    try {
      const r = await probeCamera({}, body);
      if (this.step !== 3) return;
      this.probe = r; this.probeKey = key;
      this.paintProbe(r, ch, kp, setState);
    } catch (e) {
      if (this.step !== 3) return;
      kp("—", "—", "—", "Javob yoʻq", e.message);
      if (!(ch && ch.snapshot_url)) setState("offline", e.message);
    }
  }

  paintProbe(r, ch, kp, setState) {
    const codec = r.codec ? (r.needs_transcode ? "H.265 → H.264" : codecLabel({ codec: r.codec })) : "—";
    const meta = [fmtRes(r.resolution), r.fps ? Math.round(r.fps) + " fps" : ""].filter(Boolean).join(" · ") || "—";
    $("f-preview-meta").textContent = [r.codec ? codecLabel({ codec: r.codec }) : "", fmtRes(r.resolution), r.fps ? Math.round(r.fps) + " fps" : ""].filter(Boolean).join(" · ") || "—";
    if (r.ok) kp(fmtSec(r.ms), codec, meta, "Barqaror", "0 uzilish");
    else kp("—", codec, meta, "Javob yoʻq", r.message || "ulanmadi");
    if (!(ch && ch.snapshot_url)) setState("offline", r.ok ? "Jonli tasvir saqlangandan keyin ochiladi" : (r.message || "Kamera javob bermadi"));
  }

  /* --- saqlash --- */
  async save() {
    for (const s of [1, 2]) {
      if (!this.validate(s)) { this.step = s; this.paint(); this.validate(s); return; }
    }
    const err = $("cam-err");
    showAlert(err, null);
    const lat = num($("f-lat").value), lng = num($("f-lng").value);
    const body = {
      name: $("f-name").value.trim(), region: $("f-region").value, lat, lng,
      source_type: this.src, enabled: true, always_on: $("f-mode").value === "always", note: "",
      ip: $("f-ip").value.trim(), port: Number($("f-port").value) || 554, username: $("f-user").value.trim(),
      password: $("f-pass").value || null, rtsp_path: $("f-path").value.trim() || "/stream1",
      vendor: $("f-vendor").value || "boshqa", stream_url: $("f-url").value.trim(),
    };
    const btn = $("f-save");
    btn.disabled = true;
    try {
      const picked = this.src === "rtsp" ? this.picked() : null;
      if (picked && picked.length > 1) {
        const res = await api("/api/admin/nvr/import", { method: "POST", body: JSON.stringify({
          ip: body.ip, port: body.port, username: body.username, password: $("f-pass").value || "",
          vendor: this.scan.vendor || body.vendor, channels: picked.map((c) => c.channel).join(","),
          region: body.region, name_prefix: body.name, lat, lng, spread_m: 60, stream: "main",
          enabled: true, probe: true, dry_run: false }) });
        closeModal("cam-modal");
        await this.afterSave();
        toast(res.created + " ta kamera qoʻshildi");
      } else {
        if (picked && picked.length === 1) { body.rtsp_path = picked[0].rtsp_path || body.rtsp_path; body.vendor = this.scan.vendor || body.vendor; }
        const cam = await api("/api/admin/cameras", { method: "POST", body: JSON.stringify(body) });
        closeModal("cam-modal");
        await this.afterSave();
        toast("Kamera qoʻshildi", { action: "Ochish", ms: 6000,
          onAction: () => document.dispatchEvent(new CustomEvent("camera:select", { detail: { id: cam.id } })) });
      }
    } catch (e) {
      showAlert(err, "error", "Saqlanmadi", e.message);
    }
    btn.disabled = false;
  }

  async afterSave() {
    await loadCameras().catch(() => {});
    if (state.tab === "admin") await loadAdminCameras(0).catch(() => {});
  }
}

/* ---------- Tahrirlash drawer'i (05.09) ---------- */
/* "ip:port/yo'l" (ixtiyoriy rtsp:// va login[:parol]@) → qismlar */
function parseRtsp(v) {
  const m = /^(?:rtsps?:\/\/)?(?:([^:@/\s]+)(?::([^@/\s]*))?@)?([^:/\s?#]+)(?::(\d+))?(\/[^\s]*)?$/i.exec(v.trim());
  if (!m) return null;
  return { user: m[1] ? decodeURIComponent(m[1]) : null, pass: m[2] ? decodeURIComponent(m[2]) : null,
           ip: m[3], port: m[4] ? Number(m[4]) : 554, path: m[5] || "/" };
}

export class CameraDrawer {
  constructor() {
    this.cam = null;
    const d = $("cam-drawer");
    hydrateIcons(d);
    this.mm = bindCoords({ latEl: $("e-lat"), lngEl: $("e-lng"), mapEl: $("e-map"), regionEl: $("e-region"), required: () => false });
    blurCheck($("e-name"), (v) => validators.required(v, "Kamera nomini kiriting"));
    blurCheck($("e-url"), (v) => this.checkUrl(v));
    $("e-enabled").addEventListener("click", (e) => {
      const b = e.currentTarget;
      b.setAttribute("aria-checked", String(b.getAttribute("aria-checked") !== "true"));
    });
    $("e-more").addEventListener("toggle", () => {
      if ($("e-more").open) this.mm.show(num($("e-lat").value), num($("e-lng").value));
    });
    $("e-test").addEventListener("click", () => this.test());
    $("e-save").addEventListener("click", () => this.save());
    d.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.matches("input") && !e.isComposing) { e.preventDefault(); this.save(); }
    });
  }

  checkUrl(v) {
    if (!this.cam) return "";
    if (this.cam.source_type === "rtsp") {
      if (!v.trim()) return "Oqim manzilini kiriting";
      const p = parseRtsp(v);
      if (!p) return "Format: IP:port/yoʻl";
      const e = validators.ip(p.ip);
      if (e) return e;
      return validators.port(p.port);
    }
    return validators.url(v);
  }

  async open(cam) {
    if (!state.vendors.length) await loadVendors().catch(() => {});
    await loadRegions();
    this.cam = cam;
    $("ed-sub").textContent = cam.name + " · ID " + cam.id;
    $("e-name").value = cam.name || "";
    fillRegionSelect($("e-region"), cam.region || "", null);
    const rtsp = cam.source_type === "rtsp";
    $("e-url-label").textContent = rtsp ? "Oqim manzili (RTSP)" : "Oqim manzili";
    let p = cam.rtsp_path || "/";
    if (!p.startsWith("/")) p = "/" + p;
    $("e-url").value = rtsp ? (cam.ip ? cam.ip + ":" + (cam.port || 554) + p : "") : (cam.raw_stream_url || "");
    const lbl = codecLabel(cam);
    $("e-codec").innerHTML = '<option>' + esc(lbl === "—" ? "Hali aniqlanmagan" : lbl + (cam.transcode ? " (oʻgirish)" : "")) + "</option>";
    $("e-mode").value = cam.always_on ? "always" : "ondemand";
    $("e-enabled").setAttribute("aria-checked", String(cam.enabled !== false));
    fillVendors($("e-vendor"), cam.vendor || "boshqa");
    $("e-user").value = cam.username || "";
    $("e-pass").value = "";
    $("e-lat").value = cam.lat != null && cam.lat !== 0 ? Number(cam.lat).toFixed(5) : "";
    $("e-lng").value = cam.lng != null && cam.lng !== 0 ? Number(cam.lng).toFixed(5) : "";
    $("e-note").value = cam.note || "";
    $("e-more").open = false;
    $("e-test").disabled = !rtsp;
    ["e-name", "e-url", "e-lat", "e-lng"].forEach((id) => setFieldError($(id), ""));
    showAlert($("e-test-out"), null);
    showAlert($("e-err"), null);
    openModal("cam-drawer");
    tooltip.label($("cam-drawer"));
  }

  parts() {
    const c = this.cam;
    if (c.source_type !== "rtsp") return { ip: c.ip || "", port: c.port || 554, path: c.rtsp_path || "/stream1", user: $("e-user").value.trim(), pass: null };
    const p = parseRtsp($("e-url").value) || {};
    return { ip: p.ip || "", port: p.port || 554, path: p.path || "/",
             user: p.user != null ? p.user : $("e-user").value.trim(), pass: p.pass != null ? p.pass : ($("e-pass").value || null) };
  }

  async test() {
    if (!setFieldError($("e-url"), this.checkUrl($("e-url").value))) return;
    const out = $("e-test-out");
    const p = this.parts();
    showAlert(out, "wait", "Tekshirilmoqda…", "10 soniyagacha");
    $("e-test").disabled = true;
    try {
      const r = await probeCamera(this.cam, { ip: p.ip, port: p.port, username: p.user, password: p.pass, rtsp_path: p.path, camera_id: this.cam.id });
      const meta = [r.codec ? (r.needs_transcode ? "H.265 → H.264" : codecLabel({ codec: r.codec })) : "", fmtRes(r.resolution),
                    r.fps ? Math.round(r.fps) + " fps" : "", fmtSec(r.ms)].filter(Boolean).join(" · ");
      if (r.ok) showAlert(out, "success", "Ulanish barqaror", meta);
      else showAlert(out, "error", r.message || "Ulanmadi", meta);
    } catch (e) { showAlert(out, "error", "Tekshirib boʻlmadi", e.message); }
    $("e-test").disabled = false;
  }

  async save() {
    const c = this.cam;
    let ok = setFieldError($("e-name"), validators.required($("e-name").value, "Kamera nomini kiriting"));
    ok = setFieldError($("e-url"), this.checkUrl($("e-url").value)) && ok;
    const latErr = validators.lat($("e-lat").value, false), lngErr = validators.lng($("e-lng").value, false);
    if (latErr || lngErr) { $("e-more").open = true; setFieldError($("e-lat"), latErr); setFieldError($("e-lng"), lngErr); ok = false; }
    if (!ok) return;
    const p = this.parts();
    const lat = num($("e-lat").value), lng = num($("e-lng").value);
    const body = {
      name: $("e-name").value.trim(), region: $("e-region").value, lat, lng,
      source_type: c.source_type, enabled: $("e-enabled").getAttribute("aria-checked") === "true",
      always_on: $("e-mode").value === "always", note: $("e-note").value.trim(),
      external_id: c.external_id || "", node_id: c.node_id || 1,
      rail_line_id: c.rail_line_id ?? null, km: c.km ?? null, picket: c.picket ?? null,
      ip: p.ip, port: p.port, username: p.user, password: p.pass || null, rtsp_path: p.path,
      vendor: $("e-vendor").value || c.vendor || "boshqa",
      stream_url: c.source_type === "rtsp" ? (c.raw_stream_url || "") : $("e-url").value.trim(),
    };
    const btn = $("e-save");
    btn.disabled = true;
    showAlert($("e-err"), null);
    try {
      await api("/api/admin/cameras/" + c.id, { method: "PUT", body: JSON.stringify(body) });
      closeModal("cam-drawer");
      await loadCameras().catch(() => {});
      if (state.tab === "admin") await loadAdminCameras().catch(() => {});
      toast("Oʻzgarishlar saqlandi");
    } catch (e) {
      showAlert($("e-err"), "error", "Saqlanmadi", e.message);
    }
    btn.disabled = false;
  }
}

export const cameraWizard = new CameraWizard();
export const cameraDrawer = new CameraDrawer();

export async function loadVendors() {
  state.vendors = await api("/api/vendors");
  return state.vendors;
}
export function openCameraDrawer(cam) { return cameraDrawer.open(cam); }
export function openCameraForm(cam) { return cam ? cameraDrawer.open(cam) : cameraWizard.open(); }
/* v2 mosligi: asosiy xaritada joy tanlash endi yo'q (mini xarita modal ichida). */
export function stopPicking() {
  state.picking = null;
  document.body.classList.remove("picking");
}
export function xaritaTanlashniUlash() {}
