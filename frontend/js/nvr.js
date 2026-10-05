/* Registrator (NVR) kanallarini ommaviy qo'shish. */
import { $, esc, state, toast } from "./state.js";
import { api } from "./api.js";
import { loadCameras } from "./data.js";
import { addEvent } from "./dashboard.js";
import { showTab } from "./tabs.js";
import { closeModal, openModal } from "./modals.js";
import { loadAdminCameras } from "./admin.js";

/* ---------- NVR dan ommaviy qo'shish ---------- */
$("nvr-btn").addEventListener("click", () => {
  $("nvr-err").classList.remove("show");
  $("n-out").className = "probe-out";
  $("n-table").innerHTML = "";
  $("n-save").disabled = true;
  $("n-vendor").innerHTML = $("f-vendor").innerHTML;
  $("n-vendor").value = "hikvision";
  openModal("nvr-modal");
});

$("n-pick").addEventListener("click", () => {
  $("nvr-modal").classList.remove("open");
  state.picking = "nvr";
  document.body.classList.add("picking");
  showTab("map");
  toast("Xaritada registrator joylashgan nuqtani bosing");
});

function nvrBody(dryRun) {
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

function nvrValidate(body) {
  const err = $("nvr-err");
  const fail = (m) => { err.textContent = m; err.classList.add("show"); return false; };
  err.classList.remove("show");
  if (!body.ip) return fail("NVR manzilini kiriting");
  if (!body.region) return fail("Hududni kiriting");
  if (Number.isNaN(body.lat) || Number.isNaN(body.lng))
    return fail("Koordinatani xaritadan tanlang yoki qo'lda kiriting");
  return true;
}

function showNvrOut(kind, tx) {
  const el = $("n-out");
  el.className = "probe-out show " + kind;
  el.textContent = tx;
}

async function nvrRun(dryRun) {
  const body = nvrBody(dryRun);
  if (!nvrValidate(body)) return;

  const btn = dryRun ? $("n-check") : $("n-save");
  btn.disabled = true;
  showNvrOut("wait", "Kanallar tekshirilmoqda — biroz kuting…");
  try {
    const res = await api("/api/admin/nvr/import", {
      method: "POST", body: JSON.stringify(body)
    });
    renderNvrTable(res.planned);
    const ok = res.reachable;
    if (dryRun) {
      showNvrOut(ok ? "ok" : "bad",
        res.planned.length + " ta kanaldan " + ok + " tasi javob berdi" +
        (ok ? " — «Qo'shish» tugmasini bosing" : ""));
      $("n-save").disabled = ok === 0;
    } else {
      showNvrOut("ok", res.created + " ta kamera qo'shildi");
      closeModal("nvr-modal");
      await loadCameras();
      if (state.tab === "admin") await loadAdminCameras(0);
      addEvent(body.region + " — NVR'dan " + res.created + " ta kamera qo'shildi", "ok");
      toast(res.created + " ta kamera qo'shildi — darhol ishlatsa bo'ladi");
    }
  } catch (e) {
    showNvrOut("bad", e.message);
  }
  btn.disabled = false;
}

function renderNvrTable(planned) {
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

$("n-scan").addEventListener("click", async () => {
  const ip = $("n-ip").value.trim();
  if (!ip) { showNvrOut("bad", "Avval NVR manzilini kiriting"); return; }
  $("n-scan").disabled = true;
  showNvrOut("wait", "Qurilma aniqlanmoqda — kanallar sanalmoqda…");
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
    if (!res.found) { showNvrOut("bad", res.message); }
    else {
      $("n-vendor").value = res.vendor;
      $("n-channels").value = res.channels.map((c) => c.channel).join(",");
      showNvrOut("ok", res.vendor_name + " — " + res.channels.length +
        " ta jonli kanal topildi; hudud va nuqtani belgilab «Qo'shish»ni bosing");
      $("n-save").disabled = false;
    }
  } catch (e) { showNvrOut("bad", e.message); }
  $("n-scan").disabled = false;
});

$("n-check").addEventListener("click", () => nvrRun(true));
$("n-save").addEventListener("click", () => nvrRun(false));
