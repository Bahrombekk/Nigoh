/* ==========================================================================
   admin/camera-form.js — kamera qo'shish / tahrirlash shakli
   --------------------------------------------------------------------------
   Vazifasi:
     "Yangi kamera" / "Kamerani tahrirlash" oynasi: maydonlar, RTSP manzil
     ko'rinishi, ishlab chiqaruvchi shablonlari, ulanishni tekshirish,
     qurilmani avtomatik aniqlash (bir nechta kanal bo'lsa — har biri
     alohida kamera), saqlash. Shuningdek: koordinatadan viloyatni aniqlash
     va xaritadan nuqta tanlash (bu ikkisini NVR shakli ham ishlatadi).

   Eksport:
     CameraForm              — klass: open(cam), loadVendors, save, scan, testConnection,
                               autoRegion(prefix), stopPicking, attachMapPicking ...
     cameraForm              — yagona nusxa
     loadVendors()           — /api/vendors dan shablonlar ro'yxati (Promise)
     openCameraForm(cam)     — shaklni ochish (cam=null — yangi kamera)
     stopPicking(removeMarker) — xaritadan joy tanlash rejimini to'xtatish
     xaritaTanlashniUlash()  — xaritaga "click" ni ulash (main.js chaqiradi, bir marta)

   Bog'liqliklar:
     import: ../core/state.js, ../core/api.js, ../map/map.js (map), ../core/data.js (loadCameras),
             ../layout/notifications.js (addEvent), ../layout/tabs.js (showTab),
             ../core/modals.js, ./admin.js (loadAdminCameras)
     global: L (tanlangan nuqta markeri)

   DOM: #cam-modal, #cam-title, #cam-err, #pass-hint, .seg tugmalari, #rtsp-block,
        #manual-block, #f-name, #f-region, #f-lat, #f-lng, #f-ip, #f-port, #f-user,
        #f-pass, #f-path, #f-vendor, #f-url, #f-note, #f-enabled, #f-always,
        #f-preview, #f-probe, #f-test, #f-scan, #f-scan-out, #f-channels, #f-save,
        #f-pick, #new-cam, #n-lat, #n-lng, #n-region (NVR shakli — autoRegion uchun),
        #nvr-modal, body.picking
   Backend: GET /api/vendors, POST /api/admin/probe, POST /api/admin/scan,
            POST /api/admin/cameras, PUT /api/admin/cameras/{id},
            POST /api/admin/nvr/import (skaner bir nechta kanal topganda);
            GET /assets/uz_regions.geojson (viloyat chegaralari, bir marta)

   Qoidalar / tuzoqlar:
     - xaritaTanlashniUlash() modul yuklanishida EMAS, main.js dan chaqiriladi:
       aylanma bog'lanishda xarita moduli hali tayyor bo'lmasligi mumkin.
     - Tahrirlashda parol maydoni bo'sh qoldirilsa server eskisini saqlaydi (null).
     - state.picking: "cam" yoki "nvr" — xarita bosilganda qaysi shaklga
       qaytish va qaysi maydonlarni (f-/n-) to'ldirishni belgilaydi.
   ========================================================================== */
import { $, esc, state, toast } from "../core/state.js";
import { api } from "../core/api.js";
import { map } from "../map/map.js";
import { loadCameras } from "../core/data.js";
import { addEvent } from "../layout/notifications.js";
import { showTab } from "../layout/tabs.js";
import { closeModal, openModal } from "../core/modals.js";
import { loadAdminCameras } from "./admin.js";

function pointInRing(lat, lng, ring) {
  // Nur usuli (ray casting); geojson koordinatasi [lng, lat] tartibida.
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* ---------- Kamera shakli ---------- */
export class CameraForm {
  constructor() {
    this.regionGeo = null;

    document.querySelectorAll(".seg button").forEach((b) =>
      b.addEventListener("click", () => this.setSourceType(b.dataset.src)));

    $("f-vendor").addEventListener("change", () => {
      const v = state.vendors.find((x) => x.id === $("f-vendor").value);
      if (!v) return;
      $("f-path").value = v.path;
      if (!$("f-port").value || $("f-port").value === "554") $("f-port").value = v.port;
      this.updatePreview();
    });

    ["f-ip", "f-port", "f-user", "f-pass", "f-path"].forEach((id) =>
      $(id).addEventListener("input", () => this.updatePreview()));

    $("new-cam").addEventListener("click", () => this.open(null));

    ["f", "n"].forEach((prefix) =>
      ["-lat", "-lng"].forEach((suffix) =>
        $(prefix + suffix).addEventListener("change", () => this.autoRegion(prefix))));

    /* --- xaritadan koordinata tanlash --- */
    $("f-pick").addEventListener("click", () => {
      $("cam-modal").classList.remove("open");
      state.picking = "cam";
      document.body.classList.add("picking");
      showTab("map");
      toast("Xaritada kerakli nuqtani bosing");
    });

    $("f-test").addEventListener("click", () => this.testConnection());
    $("f-scan").addEventListener("click", () => this.scan());
    $("f-save").addEventListener("click", () => this.save());
  }

  async loadVendors() {
    state.vendors = await api("/api/vendors");
    $("f-vendor").innerHTML = state.vendors
      .map((v) => '<option value="' + v.id + '">' + esc(v.name) + "</option>").join("");
  }

  setSourceType(type) {
    state.sourceType = type;
    document.querySelectorAll(".seg button").forEach((b) =>
      b.classList.toggle("on", b.dataset.src === type));
    $("rtsp-block").hidden = type !== "rtsp";
    $("manual-block").hidden = type !== "manual";
  }

  updatePreview() {
    const ip = $("f-ip").value.trim() || "IP";
    const port = $("f-port").value || "554";
    const user = $("f-user").value.trim();
    const pass = $("f-pass").value ? "•••" : "";
    let path = $("f-path").value.trim();
    if (path && !path.startsWith("/")) path = "/" + path;
    const cred = user ? user + (pass ? ":" + pass : "") + "@" : "";
    $("f-preview").textContent = "rtsp://" + cred + ip + ":" + port + (path || "/");
  }

  open(cam) {
    // Vendor ro'yxati ishga tushishda yuklanmay qolgan bo'lsa — hozir yuklaymiz.
    if (!state.vendors.length) this.loadVendors().catch(() => {});
    state.editingId = cam ? cam.id : null;
    $("cam-title").textContent = cam ? "Kamerani tahrirlash" : "Yangi kamera";
    $("cam-err").classList.remove("show");
    $("f-probe").className = "probe-out";
    $("pass-hint").hidden = !cam;
    this.resetScan();

    this.setSourceType(cam ? cam.source_type : "rtsp");
    $("f-name").value = cam ? cam.name : "";
    $("f-region").value = cam ? cam.region : "";
    $("f-lat").value = cam ? cam.lat : "";
    $("f-lng").value = cam ? cam.lng : "";
    $("f-ip").value = cam ? cam.ip : "";
    $("f-port").value = cam ? cam.port : 554;
    $("f-user").value = cam ? cam.username : "";
    $("f-pass").value = "";
    $("f-path").value = cam ? cam.rtsp_path : "/stream1";
    $("f-vendor").value = cam ? cam.vendor : "boshqa";
    $("f-url").value = cam ? cam.raw_stream_url : "";
    $("f-note").value = cam ? cam.note : "";
    $("f-enabled").checked = cam ? cam.enabled : true;
    $("f-always").checked = cam ? cam.always_on : false;

    const out = $("f-probe");
    if (cam && cam.codec) {
      out.className = "probe-out show " + (cam.transcode ? "wait" : "ok");
      out.textContent = cam.transcode
        ? "Kodek " + cam.codec + " — brauzer o'qiy olmaydi, H.264 ga o'girib beriladi"
        : "Kodek " + cam.codec + " — to'g'ridan-to'g'ri uzatiladi";
    }

    this.updatePreview();
    openModal("cam-modal");
    setTimeout(() => $("f-name").focus(), 60);
  }

  /* --- viloyatni koordinatadan aniqlash --- */
  async ensureRegionGeo() {
    if (this.regionGeo) return this.regionGeo;
    const r = await fetch("/assets/uz_regions.geojson");
    if (!r.ok) throw new Error("chegara fayli yuklanmadi");
    this.regionGeo = await r.json();
    return this.regionGeo;
  }

  regionAt(lat, lng) {
    if (!this.regionGeo) return "";
    for (const f of this.regionGeo.features) {
      const g = f.geometry;
      const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
      for (const poly of polys) {
        if (pointInRing(lat, lng, poly[0]) &&
            !poly.slice(1).some((hole) => pointInRing(lat, lng, hole)))
          return f.properties.name;
      }
    }
    return "";
  }

  autoRegion(prefix) {
    const lat = parseFloat($(prefix + "-lat").value);
    const lng = parseFloat($(prefix + "-lng").value);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;
    const fill = () => {
      const name = this.regionAt(lat, lng);
      if (name) $(prefix + "-region").value = name;
    };
    if (this.regionGeo) fill();
    else this.ensureRegionGeo().then(fill).catch(() => {});
  }

  stopPicking(removeMarker) {
    state.picking = null;
    document.body.classList.remove("picking");
    if (removeMarker && state.pickMarker) {
      map.removeLayer(state.pickMarker);
      state.pickMarker = null;
    }
  }

  /* Xaritada nuqta tanlash (kamera/NVR shakli uchun). Modul yuklanishida emas,
     main.js chaqiradi: aylanma bog'lanishda xarita moduli hali tayyor
     bo'lmasligi mumkin. */
  attachMapPicking() {
    map.on("click", (e) => {
      if (!state.picking) return;
      const target = state.picking === "nvr" ? "nvr-modal" : "cam-modal";
      const prefix = state.picking === "nvr" ? "n" : "f";
      $(prefix + "-lat").value = e.latlng.lat.toFixed(5);
      $(prefix + "-lng").value = e.latlng.lng.toFixed(5);
      this.autoRegion(prefix);
      if (state.pickMarker) map.removeLayer(state.pickMarker);
      state.pickMarker = L.marker(e.latlng, {
        icon: L.divIcon({ className: "",
          html: '<div class="mk sel"><span class="r"></span><span class="c"></span></div>',
          iconSize: [24, 24], iconAnchor: [12, 12] })
      }).addTo(map);
      this.stopPicking(false);
      openModal(target);
    });
  }

  /* --- ulanishni tekshirish --- */
  async testConnection() {
    const out = $("f-probe");
    const show = (kind, tx) => { out.className = "probe-out show " + kind; out.textContent = tx; };
    if (!$("f-ip").value.trim()) { show("bad", "Avval IP manzilni kiriting"); return; }
    $("f-test").disabled = true;
    show("wait", "Tekshirilmoqda… (10 soniyagacha)");
    try {
      const r = await api("/api/admin/probe", {
        method: "POST",
        body: JSON.stringify({
          ip: $("f-ip").value.trim(),
          port: Number($("f-port").value) || 554,
          username: $("f-user").value.trim(),
          password: $("f-pass").value || null,
          rtsp_path: $("f-path").value.trim() || "/",
          camera_id: state.editingId
        })
      });
      show(r.ok ? "ok" : "bad", r.message);
    } catch (e) {
      show("bad", e.message);
    }
    $("f-test").disabled = false;
  }

  /* --- qurilmani avtomatik aniqlash --- */
  scanPicked() {
    if (!state.scan) return null;
    return state.scan.channels.filter((c) => {
      const cb = document.querySelector('#f-channels input[data-ch="' + c.channel + '"]');
      return cb ? cb.checked : true;
    });
  }

  updateSaveLabel() {
    const picked = this.scanPicked();
    $("f-save").textContent = picked && picked.length > 1
      ? picked.length + " ta kamerani qo'shish"
      : "Saqlash";
  }

  resetScan() {
    state.scan = null;
    $("f-channels").innerHTML = "";
    $("f-scan-out").className = "probe-out";
    this.updateSaveLabel();
  }

  renderScanChannels(res) {
    const box = $("f-channels");
    if (res.channels.length < 2) { box.innerHTML = ""; return; }
    box.innerHTML =
      '<div class="section" style="margin-top:8px">' +
      '<div class="section-title">Topilgan kanallar — qo\'shiladiganlarini belgilang</div>' +
      res.channels.map((c) =>
        '<label style="display:flex;align-items:center;gap:9px;color:var(--text);' +
        'font-size:13px;font-weight:500;cursor:pointer">' +
        '<input type="checkbox" data-ch="' + c.channel + '" checked style="width:auto;margin:0">' +
        c.channel + "-kanal " +
        '<span class="cdx-chip">' + esc(c.codec || "?") + (c.needs_transcode ? " →H264" : "") + "</span>" +
        '<span class="mono" style="color:var(--muted);font-size:11px">' + esc(c.rtsp_path) + "</span>" +
        "</label>").join("") +
      '<div class="hint">Har biri alohida kamera bo\'lib qo\'shiladi: «Nomi 1-kanal», ' +
      "«Nomi 2-kanal»… Nuqtalar tanlangan joy atrofiga tarqatiladi, keyin har birini " +
      "xaritada o'z joyiga surish mumkin.</div></div>";
    box.querySelectorAll("input[data-ch]").forEach((cb) =>
      cb.addEventListener("change", () => this.updateSaveLabel()));
  }

  async scan() {
    const out = $("f-scan-out");
    const show = (kind, tx) => { out.className = "probe-out show " + kind; out.textContent = tx; };
    const ip = $("f-ip").value.trim();
    if (!ip) { show("bad", "Avval IP manzilni kiriting"); return; }
    $("f-scan").disabled = true;
    state.scan = null;
    $("f-channels").innerHTML = "";
    this.updateSaveLabel();
    show("wait", "Qurilma aniqlanmoqda — shablonlar va kanallar tekshirilmoqda (~10-30 s)…");
    try {
      const res = await api("/api/admin/scan", {
        method: "POST",
        body: JSON.stringify({
          ip,
          port: Number($("f-port").value) || 554,
          username: $("f-user").value.trim(),
          password: $("f-pass").value || "",
          camera_id: state.editingId
        })
      });
      if (!res.found) { show("bad", res.message); }
      else {
        state.scan = res;
        const first = res.channels[0];
        $("f-vendor").value = res.vendor;
        $("f-path").value = first.rtsp_path;
        this.updatePreview();
        this.renderScanChannels(res);
        this.updateSaveLabel();
        show("ok", res.device === "nvr"
          ? res.vendor_name + " registrator (NVR) — " + res.channels.length +
            " ta jonli kanal topildi"
          : res.vendor_name + " — bitta kamera · kodek " + (first.codec || "noma'lum") +
            (first.needs_transcode ? " (H.264 ga o'girib beriladi)" : ""));
      }
    } catch (e) { show("bad", e.message); }
    $("f-scan").disabled = false;
  }

  /* --- saqlash --- */
  async save() {
    const err = $("cam-err");
    err.classList.remove("show");
    const lat = parseFloat($("f-lat").value);
    const lng = parseFloat($("f-lng").value);

    const body = {
      name: $("f-name").value.trim(),
      region: $("f-region").value.trim(),
      lat, lng,
      source_type: state.sourceType,
      enabled: $("f-enabled").checked,
      always_on: $("f-always").checked,
      note: $("f-note").value.trim(),
      ip: $("f-ip").value.trim(),
      port: Number($("f-port").value) || 554,
      username: $("f-user").value.trim(),
      password: $("f-pass").value || null,
      rtsp_path: $("f-path").value.trim() || "/stream1",
      vendor: $("f-vendor").value,
      stream_url: $("f-url").value.trim()
    };

    const fail = (m) => { err.textContent = m; err.classList.add("show"); };
    if (!body.name || !body.region) return fail("Nomi va hududini to'ldiring");
    if (Number.isNaN(lat) || Number.isNaN(lng)) return fail("Koordinatani xaritadan tanlang yoki qo'lda kiriting");
    if (body.source_type === "rtsp" && !body.ip) return fail("IP manzilni kiriting");
    if (body.source_type === "manual" && !body.stream_url) return fail("Oqim manzilini kiriting");

    // Skaner bir nechta kanal topgan bo'lsa — har biri alohida kamera bo'ladi.
    const picked = state.sourceType === "rtsp" ? this.scanPicked() : null;
    if (!state.editingId && picked && picked.length > 1) {
      $("f-save").disabled = true;
      try {
        const res = await api("/api/admin/nvr/import", {
          method: "POST",
          body: JSON.stringify({
            ip: body.ip, port: body.port,
            username: body.username, password: $("f-pass").value || "",
            vendor: state.scan.vendor,
            channels: picked.map((c) => c.channel).join(","),
            region: body.region, name_prefix: body.name,
            lat, lng, spread_m: 60, stream: "main",
            enabled: body.enabled, probe: true, dry_run: false
          })
        });
        closeModal("cam-modal");
        this.resetScan();
        await loadCameras();
        if (state.tab === "admin") await loadAdminCameras(0);
        addEvent(body.name + " — " + res.created + " ta kamera qo'shildi", "ok");
        toast(res.created + " ta kamera qo'shildi");
      } catch (e) { fail(e.message); }
      $("f-save").disabled = false;
      return;
    }
    if (picked && picked.length === 1 && state.scan) {
      body.rtsp_path = picked[0].rtsp_path;
      body.vendor = state.scan.vendor;
    }

    $("f-save").disabled = true;
    try {
      if (state.editingId) {
        await api("/api/admin/cameras/" + state.editingId, { method: "PUT", body: JSON.stringify(body) });
      } else {
        await api("/api/admin/cameras", { method: "POST", body: JSON.stringify(body) });
      }
      closeModal("cam-modal");
      await loadCameras();
      if (state.tab === "admin") await loadAdminCameras(state.adminOffset);
      addEvent(body.name + (state.editingId ? " — tahrirlandi" : " — qo'shildi"), "ok");
      toast(state.editingId ? "O'zgarishlar saqlandi" : "Kamera qo'shildi");
      if (body.always_on) {
        toast("«Doim tayyor» o'zgardi — «MediaMTX» tugmasini bosing");
      }
    } catch (e) {
      fail(e.message);
    }
    $("f-save").disabled = false;
  }
}

export const cameraForm = new CameraForm();

export function loadVendors() { return cameraForm.loadVendors(); }
export function openCameraForm(cam) { cameraForm.open(cam); }
export function stopPicking(removeMarker) { cameraForm.stopPicking(removeMarker); }
export function xaritaTanlashniUlash() { cameraForm.attachMapPicking(); }
