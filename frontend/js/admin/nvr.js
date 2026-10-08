/* ==========================================================================
   admin/nvr.js — "NVR ochish": registrator kanallarini ommaviy qo'shish
   --------------------------------------------------------------------------
   Vazifasi:
     Boshqaruv "⋯ Koʻproq → NVR ochish" oynasi (v3 dialog): registrator manzili
     va kanallari, avtomatik aniqlash (skaner), avval tekshirish (dry run —
     jadvalda har kanal holati), keyin qo'shish. Joy oyna ichidagi mini xaritada
     tanlanadi (hudud ham avtomatik), kameralar shu nuqta atrofiga tarqatiladi.

   Eksport:
     NvrImport, nvrImport — klass/nusxa (boshqa modullar import qilmaydi:
     admin.js "admin:nvr" hodisasini yuboradi, main.js faylni yon ta'sir uchun yuklaydi)

   Bog'liqliklar:
     import: ../core/state.js, ../core/api.js, ../core/icons.js, ../core/modals.js,
             ../core/data.js (loadCameras), ./admin.js (loadAdminCameras),
             ./camera-form.js (MiniMap, loadVendors, loadRegions, fillRegionSelect,
             autoRegion, setFieldError, validators, showAlert)
   DOM: #nvr-modal, #nvr-err, #n-out, #n-table, #n-save, #n-check, #n-scan, #n-map,
        #n-vendor, #n-ip, #n-port, #n-user, #n-pass, #n-channels, #n-region, #n-prefix,
        #n-lat, #n-lng, #n-spread, #n-stream
   Backend: POST /api/admin/nvr/import (dry_run: true — tekshirish, false — qo'shish),
            POST /api/admin/scan

   Qoidalar / tuzoqlar:
     - "Qoʻshish" tekshiruvda kamida bitta kanal javob bersa yoki skaner kanal topsa ochiladi.
     - Mini xarita oyna ko'ringandan keyin invalidateSize qilinadi (MiniMap.show).
   ========================================================================== */
import { $, esc, state, toast } from "../core/state.js";
import { api } from "../core/api.js";
import { hydrateIcons } from "../core/icons.js";
import { closeModal, openModal } from "../core/modals.js";
import { loadCameras } from "../core/data.js";
import { loadAdminCameras } from "./admin.js";
import { MiniMap, loadVendors, loadRegions, fillRegionSelect, autoRegion, setFieldError, validators, showAlert } from "./camera-form.js";

const num = (v) => { const n = Number(String(v).replace(",", ".").trim()); return String(v).trim() && Number.isFinite(n) ? n : null; };

export class NvrImport {
  constructor() {
    hydrateIcons($("nvr-modal"));
    this.mm = new MiniMap($("n-map"), (lat, lng) => {
      $("n-lat").value = lat.toFixed(5); $("n-lng").value = lng.toFixed(5);
      setFieldError($("n-lat"), ""); setFieldError($("n-lng"), "");
      autoRegion($("n-region"), lat, lng);
    });
    ["n-lat", "n-lng"].forEach((id) => $(id).addEventListener("change", () => {
      const lat = num($("n-lat").value), lng = num($("n-lng").value);
      if (lat != null && lng != null) { this.mm.set(lat, lng, false); autoRegion($("n-region"), lat, lng); }
    }));
    $("n-ip").addEventListener("blur", () => setFieldError($("n-ip"), validators.ip($("n-ip").value)));
    $("n-port").addEventListener("blur", () => setFieldError($("n-port"), validators.port($("n-port").value)));
    $("n-lat").addEventListener("blur", () => setFieldError($("n-lat"), validators.lat($("n-lat").value, false)));
    $("n-lng").addEventListener("blur", () => setFieldError($("n-lng"), validators.lng($("n-lng").value, false)));

    document.addEventListener("admin:nvr", () => this.openDialog());
    $("n-scan").addEventListener("click", () => this.scan());
    $("n-check").addEventListener("click", () => this.run(true));
    $("n-save").addEventListener("click", () => this.run(false));
  }

  async openDialog() {
    if (!state.vendors.length) await loadVendors().catch(() => {});
    await loadRegions();
    showAlert($("nvr-err"), null);
    showAlert($("n-out"), null);
    $("n-table").innerHTML = "";
    $("n-save").disabled = true;
    $("n-vendor").innerHTML = (state.vendors || []).map((v) => '<option value="' + esc(v.id) + '">' + esc(v.name) + "</option>").join("");
    $("n-vendor").value = "hikvision";
    fillRegionSelect($("n-region"), $("n-region").value, "Koordinatadan aniqlansin");
    ["n-ip", "n-port", "n-lat", "n-lng"].forEach((id) => setFieldError($(id), ""));
    openModal("nvr-modal");
    this.mm.show(num($("n-lat").value), num($("n-lng").value));
  }

  body(dryRun) {
    return {
      ip: $("n-ip").value.trim(),
      port: Number($("n-port").value) || 554,
      username: $("n-user").value.trim(),
      password: $("n-pass").value,
      vendor: $("n-vendor").value,
      channels: $("n-channels").value.trim(),
      region: $("n-region").value,
      name_prefix: $("n-prefix").value.trim(),
      lat: num($("n-lat").value),
      lng: num($("n-lng").value),
      spread_m: Number($("n-spread").value) || 0,
      stream: $("n-stream").value,
      probe: true,
      dry_run: dryRun,
    };
  }

  validate(b) {
    let ok = setFieldError($("n-ip"), validators.ip($("n-ip").value));
    ok = setFieldError($("n-port"), validators.port($("n-port").value)) && ok;
    ok = setFieldError($("n-lat"), validators.lat($("n-lat").value, true)) && ok;
    ok = setFieldError($("n-lng"), validators.lng($("n-lng").value, true)) && ok;
    if (!ok) showAlert($("nvr-err"), "error", "Maydonlarni tekshiring", b.lat == null ? "Registrator joyini xaritada tanlang" : "");
    else showAlert($("nvr-err"), null);
    return ok;
  }

  async run(dryRun) {
    const body = this.body(dryRun);
    if (!this.validate(body)) return;
    const btn = dryRun ? $("n-check") : $("n-save");
    btn.disabled = true;
    showAlert($("n-out"), "wait", "Kanallar tekshirilmoqda…", "Biroz kuting");
    try {
      const res = await api("/api/admin/nvr/import", { method: "POST", body: JSON.stringify(body) });
      this.renderTable(res.planned);
      const ok = res.reachable;
      if (dryRun) {
        showAlert($("n-out"), ok ? "success" : "error", res.planned.length + " ta kanaldan " + ok + " tasi javob berdi",
                  ok ? "«Qoʻshish» tugmasini bosing" : "Manzil, login va parolni tekshiring");
        $("n-save").disabled = ok === 0;
      } else {
        closeModal("nvr-modal");
        await loadCameras().catch(() => {});
        if (state.tab === "admin") await loadAdminCameras(0).catch(() => {});
        toast(res.created + " ta kamera qoʻshildi");
      }
    } catch (e) {
      showAlert($("n-out"), "error", "Bajarilmadi", e.message);
    }
    btn.disabled = false;
  }

  renderTable(planned) {
    if (!planned || !planned.length) { $("n-table").innerHTML = ""; return; }
    const rows = planned.map((p) => {
      const st = p.ok === null ? "unknown" : p.ok ? "online" : "offline";
      const tx = p.ok === null ? "—" : p.ok ? "Javob berdi" : "Javobsiz";
      return '<tr><td class="mono-xs">' + p.channel + "-kanal</td>" +
        '<td><span class="badge" data-status="' + st + '"><span class="dot" data-status="' + st + '"></span>' + tx + "</span></td>" +
        '<td><span class="codec-tag">' + esc((p.codec || "—") + (p.transcode ? " → H.264" : "")) + "</span></td>" +
        '<td><span class="ellipsis" title="' + esc(p.message) + '">' + esc(p.message || "") + "</span></td></tr>";
    }).join("");
    $("n-table").innerHTML = '<div class="ad-ntable"><table class="tbl"><thead><tr><th>Kanal</th><th>Holat</th><th>Kodek</th><th>Izoh</th></tr></thead><tbody>' +
      rows + "</tbody></table></div>";
  }

  async scan() {
    if (!setFieldError($("n-ip"), validators.ip($("n-ip").value))) return;
    $("n-scan").disabled = true;
    showAlert($("n-out"), "wait", "Qurilma aniqlanmoqda…", "Kanallar sanalmoqda (10–30 s)");
    try {
      const res = await api("/api/admin/scan", { method: "POST", body: JSON.stringify({
        ip: $("n-ip").value.trim(), port: Number($("n-port").value) || 554,
        username: $("n-user").value.trim(), password: $("n-pass").value || "" }) });
      if (!res.found) showAlert($("n-out"), "error", "Aniqlab boʻlmadi", res.message);
      else {
        if ([...$("n-vendor").options].some((o) => o.value === res.vendor)) $("n-vendor").value = res.vendor;
        $("n-channels").value = res.channels.map((c) => c.channel).join(",");
        showAlert($("n-out"), "success", "Qurilma aniqlandi: " + res.vendor_name,
                  res.channels.length + " ta jonli kanal · hudud va nuqtani belgilab «Qoʻshish»ni bosing");
        $("n-save").disabled = false;
      }
    } catch (e) { showAlert($("n-out"), "error", "Aniqlab boʻlmadi", e.message); }
    $("n-scan").disabled = false;
  }
}

export const nvrImport = new NvrImport();
