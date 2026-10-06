/* ==========================================================================
   admin/nvr.js — registrator (NVR) kanallarini ommaviy qo'shish
   --------------------------------------------------------------------------
   Vazifasi:
     "NVR dan qo'shish" oynasi: registrator manzili va kanallari, avtomatik
     aniqlash (skaner), avval tekshirish (dry run — jadvalda har kanal holati),
     keyin qo'shish. Nuqta xaritadan tanlanadi, kameralar shu nuqta atrofiga
     tarqatiladi.

   Eksport:
     NvrImport   — klass: openDialog, startPicking, run(dryRun), scan, renderTable ...
     nvrImport   — yagona nusxa
     (boshqa modullar bu fayldan hech narsa import qilmaydi — main.js uni
      faqat yon ta'siri, ya'ni tugmalarni ulash uchun yuklaydi)

   Bog'liqliklar:
     import: ../core/state.js, ../core/api.js, ../core/data.js (loadCameras),
             ../layout/notifications.js (addEvent), ../layout/tabs.js (showTab),
             ../core/modals.js, ./admin.js (loadAdminCameras)

   DOM: #nvr-btn, #nvr-modal, #nvr-err, #n-out, #n-table, #n-save, #n-check,
        #n-scan, #n-pick, #n-vendor, #n-ip, #n-port, #n-user, #n-pass,
        #n-channels, #n-region, #n-prefix, #n-lat, #n-lng, #n-spread, #n-stream,
        #f-vendor (shablonlar ro'yxati shu yerdan nusxalanadi), body.picking
   Backend: POST /api/admin/nvr/import (dry_run: true — tekshirish, false — qo'shish),
            POST /api/admin/scan

   Qoidalar / tuzoqlar:
     - "Qo'shish" tugmasi tekshiruvda kamida bitta kanal javob bersa yoki
       skaner kanal topsa ochiladi.
     - Xaritadan joy tanlash camera-form.js dagi umumiy mexanizm orqali
       (state.picking = "nvr"; viloyat ham avtomatik to'ldiriladi).
   ========================================================================== */
import { $, esc, state, toast } from "../core/state.js";
import { api } from "../core/api.js";
import { loadCameras } from "../core/data.js";
import { addEvent } from "../layout/notifications.js";
import { showTab } from "../layout/tabs.js";
import { closeModal, openModal } from "../core/modals.js";
import { loadAdminCameras } from "./admin.js";

/* ---------- NVR dan ommaviy qo'shish ---------- */
export class NvrImport {
  constructor() {
    $("nvr-btn").addEventListener("click", () => this.openDialog());
    $("n-pick").addEventListener("click", () => this.startPicking());
    $("n-scan").addEventListener("click", () => this.scan());
    $("n-check").addEventListener("click", () => this.run(true));
    $("n-save").addEventListener("click", () => this.run(false));
  }

  openDialog() {
    $("nvr-err").classList.remove("show");
    $("n-out").className = "probe-out";
    $("n-table").innerHTML = "";
    $("n-save").disabled = true;
    $("n-vendor").innerHTML = $("f-vendor").innerHTML;
    $("n-vendor").value = "hikvision";
    openModal("nvr-modal");
  }

  startPicking() {
    $("nvr-modal").classList.remove("open");
    state.picking = "nvr";
    document.body.classList.add("picking");
    showTab("map");
    toast("Xaritada registrator joylashgan nuqtani bosing");
  }

  body(dryRun) {
    return {
      ip: $("n-ip").value.trim(),
      port: Number($("n-port").value) || 554,
      username: $("n-user").value.trim(),
      password: $("n-pass").value,
      vendor: $("n-vendor").value,
      channels: $("n-channels").value.trim(),
      region: $("n-region").value.trim(),
      name_prefix: $("n-prefix").value.trim(),
      lat: parseFloat($("n-lat").value),
      lng: parseFloat($("n-lng").value),
      spread_m: Number($("n-spread").value) || 0,
      stream: $("n-stream").value,
      probe: true,
      dry_run: dryRun
    };
  }

  validate(body) {
    const err = $("nvr-err");
    const fail = (m) => { err.textContent = m; err.classList.add("show"); return false; };
    err.classList.remove("show");
    if (!body.ip) return fail("NVR manzilini kiriting");
    if (!body.region) return fail("Hududni kiriting");
    if (Number.isNaN(body.lat) || Number.isNaN(body.lng))
      return fail("Koordinatani xaritadan tanlang yoki qo'lda kiriting");
    return true;
  }

  showOut(kind, tx) {
    const el = $("n-out");
    el.className = "probe-out show " + kind;
    el.textContent = tx;
  }

  async run(dryRun) {
    const body = this.body(dryRun);
    if (!this.validate(body)) return;

    const btn = dryRun ? $("n-check") : $("n-save");
    btn.disabled = true;
    this.showOut("wait", "Kanallar tekshirilmoqda — biroz kuting…");
    try {
      const res = await api("/api/admin/nvr/import", {
        method: "POST", body: JSON.stringify(body)
      });
      this.renderTable(res.planned);
      const ok = res.reachable;
      if (dryRun) {
        this.showOut(ok ? "ok" : "bad",
          res.planned.length + " ta kanaldan " + ok + " tasi javob berdi" +
          (ok ? " — «Qo'shish» tugmasini bosing" : ""));
        $("n-save").disabled = ok === 0;
      } else {
        this.showOut("ok", res.created + " ta kamera qo'shildi");
        closeModal("nvr-modal");
        await loadCameras();
        if (state.tab === "admin") await loadAdminCameras(0);
        addEvent(body.region + " — NVR'dan " + res.created + " ta kamera qo'shildi", "ok");
        toast(res.created + " ta kamera qo'shildi — darhol ishlatsa bo'ladi");
      }
    } catch (e) {
      this.showOut("bad", e.message);
    }
    btn.disabled = false;
  }

  renderTable(planned) {
    if (!planned || !planned.length) { $("n-table").innerHTML = ""; return; }
    const rows = planned.map((p) => {
      const mark = p.ok === null ? "·" : p.ok ? "✓" : "✕";
      const cls = p.ok === null ? "" : p.ok ? "ok" : "bad";
      return '<tr class="' + cls + '"><td>' + p.channel + "</td>" +
             "<td>" + mark + "</td>" +
             "<td>" + esc(p.codec || "—") + (p.transcode ? " →H264" : "") + "</td>" +
             '<td title="' + esc(p.message) + '">' + esc(p.message.slice(0, 44)) + "</td></tr>";
    }).join("");
    $("n-table").innerHTML =
      '<table class="nvr-table"><thead><tr><th>Kanal</th><th></th><th>Kodek</th>' +
      "<th>Holat</th></tr></thead><tbody>" + rows + "</tbody></table>";
  }

  async scan() {
    const ip = $("n-ip").value.trim();
    if (!ip) { this.showOut("bad", "Avval NVR manzilini kiriting"); return; }
    $("n-scan").disabled = true;
    this.showOut("wait", "Qurilma aniqlanmoqda — kanallar sanalmoqda…");
    try {
      const res = await api("/api/admin/scan", {
        method: "POST",
        body: JSON.stringify({
          ip,
          port: Number($("n-port").value) || 554,
          username: $("n-user").value.trim(),
          password: $("n-pass").value || ""
        })
      });
      if (!res.found) { this.showOut("bad", res.message); }
      else {
        $("n-vendor").value = res.vendor;
        $("n-channels").value = res.channels.map((c) => c.channel).join(",");
        this.showOut("ok", res.vendor_name + " — " + res.channels.length +
          " ta jonli kanal topildi; hudud va nuqtani belgilab «Qo'shish»ni bosing");
        $("n-save").disabled = false;
      }
    } catch (e) { this.showOut("bad", e.message); }
    $("n-scan").disabled = false;
  }
}

export const nvrImport = new NvrImport();
