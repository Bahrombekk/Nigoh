/* Boshqaruv jadvali: kameralar ro'yxati, filtr, saralash, eksport, MediaMTX tugmalari. */
import { $, esc, state, toast } from "./holat.js";
import { api } from "./api.js";
import { ICO } from "./ikonkalar.js";
import { hasGeo, map } from "./xarita.js";
import { loadCameras } from "./malumot.js";
import { selectCamera } from "./tanlov.js";
import { addEvent } from "./dashboard.js";
import { showTab } from "./tablar.js";
import { closeModal, openModal } from "./modallar.js";
import { openCameraForm } from "./kamera-shakli.js";

/* ---------- Boshqaruv jadvali ---------- */
export async function loadAdminCameras(offset) {
  const size = state.adminSize;
  const start = offset || 0;
  const query = encodeURIComponent(state.adminQuery || "");
  const res = await api("/api/admin/cameras?q=" + query +
                        "&limit=" + size + "&offset=" + start);
  state.adminCameras = res.cameras;
  state.adminOffset = start;
  state.adminTotal = res.total;

  const last = Math.min(start + res.cameras.length, res.total);
  $("admin-count").textContent = res.total
    ? (start + 1) + "–" + last + " / " + res.total + " ta kamera" : "Kamera yo'q";
  $("admin-total").textContent = "";
  $("adm-prev").disabled = start === 0;
  $("adm-next").disabled = start + size >= res.total;

  renderAdminPages(Math.ceil(res.total / size), Math.floor(start / size));
  renderAdminKpis();
  fillAdminRegions();
  renderAdminTable();
}

/* Raqamli sahifalar: 1 2 3 … oxirgi (joriy atrofida oyna). */
function renderAdminPages(pages, cur) {
  const box = $("adm-pages");
  if (pages < 2) { box.innerHTML = ""; return; }
  const want = new Set([0, pages - 1, cur, cur - 1, cur + 1]);
  if (cur <= 2) [1, 2, 3].forEach((i) => want.add(i));
  if (cur >= pages - 3) [pages - 2, pages - 3, pages - 4].forEach((i) => want.add(i));
  const list = [...want].filter((i) => i >= 0 && i < pages).sort((a, b) => a - b);
  let out = "", prev = -1;
  list.forEach((i) => {
    if (prev >= 0 && i - prev > 1) out += '<span class="gap">…</span>';
    out += '<button data-pg="' + i + '"' + (i === cur ? ' class="on"' : "") + ">" + (i + 1) + "</button>";
    prev = i;
  });
  box.innerHTML = out;
  box.querySelectorAll("[data-pg]").forEach((b) =>
    b.addEventListener("click", () => loadAdminCameras(Number(b.dataset.pg) * state.adminSize)));
}

/* Boshqaruv KPI kartalari va filtr tugmalaridagi hisoblar.
   Jami — admin ro'yxati (o'chirilganlar bilan), onlayn/oflayn — ochiq ro'yxatdan;
   o'chirilganlar soni ikkovining farqi (ochiq ro'yxatda ular ko'rinmaydi). */
function renderAdminKpis() {
  const total = state.adminTotal;
  const on = state.cameras.filter((c) => c.online === true).length;
  const off = state.cameras.filter((c) => c.online === false).length;
  const dis = Math.max(0, total - state.cameras.length);
  const pc = (v) => total ? Math.round((v / total) * 100) + "%" : "—";
  $("adm-k-total").textContent = total;
  $("adm-k-on").textContent = on;
  $("adm-k-on-pct").textContent = pc(on);
  $("adm-k-on-bar").style.width = (total ? (on / total) * 100 : 0) + "%";
  $("adm-k-off").textContent = off;
  $("adm-k-off-pct").textContent = pc(off);
  $("adm-k-off-bar").style.width = (total ? (off / total) * 100 : 0) + "%";
  $("adm-k-dis").textContent = dis;
  $("adm-c-all").textContent = total;
  $("adm-c-on").textContent = on;
  $("adm-c-off").textContent = off;
  $("adm-c-dis").textContent = dis;
}

$("adm-size").addEventListener("change", (e) => {
  state.adminSize = Number(e.target.value) || 50;
  loadAdminCameras(0);
});
$("adm-clear").addEventListener("click", () => {
  state.adminFilters = { status: "", region: "", codec: "", mode: "" };
  state.adminQuery = "";
  $("admin-search").value = "";
  ["adm-region", "adm-codec", "adm-mode"].forEach((id) => { $(id).value = ""; });
  document.querySelectorAll("#adm-status button").forEach((x) =>
    x.classList.toggle("on", x.dataset.st === ""));
  loadAdminCameras(0);
});
/* Export — joriy sahifadagi filtrlangan qatorlar CSV faylga. */
$("adm-export").addEventListener("click", () => {
  const rows = visibleAdminRows();
  if (!rows.length) { toast("Eksport uchun qator yo'q", true); return; }
  const head = ["Nomi", "Hudud", "Holat", "Manzil", "Kodek", "Rejim", "Faol"];
  const cell = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const body = rows.map((c) => [
    c.name, c.region, camStatus(c),
    c.source_type === "rtsp" ? c.ip + ":" + c.port + (c.rtsp_path || "") : (c.raw_stream_url || ""),
    (c.codec || "") + (c.transcode ? " -> H264" : ""),
    c.always_on ? "doim tayyor" : "so'rov bo'yicha",
    c.enabled ? "ha" : "yo'q",
  ].map(cell).join(","));
  // BOM — Excel CSV ni UTF-8 deb o'qishi uchun.
  const blob = new Blob(["\ufeff" + [head.map(cell).join(","), ...body].join("\r\n")],
                        { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "nigoh-kameralar.csv";
  a.click();
  URL.revokeObjectURL(a.href);
  toast(rows.length + " ta qator eksport qilindi");
});

/* Kamera holati filtrlash/saralash uchun yagona qiymatga keltiriladi. */
function camStatus(cam) {
  if (!cam.enabled) return "disabled";
  const pub = state.byId.get(cam.id);
  if (pub && pub.online === false) return "offline";
  if (pub && pub.online === true) return "online";
  return "unknown";
}
function camCodecKind(cam) {
  if (cam.transcode) return "trans";
  if (/h265|hevc/i.test(cam.codec || "")) return "h265raw";
  if (/h264|avc/i.test(cam.codec || "")) return "h264";
  return "";
}

function fillAdminRegions() {
  const sel = $("adm-region");
  const cur = sel.value;
  const regions = [...new Set(state.adminCameras.map((c) => c.region))].sort();
  sel.innerHTML = '<option value="">Barcha hududlar</option>' +
    regions.map((r) => '<option value="' + esc(r) + '"' +
      (r === cur ? " selected" : "") + ">" + esc(r) + "</option>").join("");
}

/* Joriy sahifadagi filtrlardan o'tgan qatorlar (jadval ham, eksport ham shundan). */
function visibleAdminRows() {
  const f = state.adminFilters;
  return state.adminCameras.filter((cam) =>
    (!f.status || camStatus(cam) === f.status) &&
    (!f.region || cam.region === f.region) &&
    (!f.codec || camCodecKind(cam) === f.codec) &&
    (!f.mode || (f.mode === "always") === !!cam.always_on));
}

function renderAdminTable() {
  let rows = visibleAdminRows();

  const s = state.adminSort;
  if (s.key) {
    const val = (cam) => s.key === "status" ? camStatus(cam)
      : s.key === "codec" ? camCodecKind(cam)
      : s.key === "mode" ? (cam.always_on ? "a" : "b")
      : String(cam[s.key] || "").toLowerCase();
    rows = [...rows].sort((a, b) => s.dir * val(a).localeCompare(val(b), "uz"));
  }
  document.querySelectorAll("#admin-table th.sortable").forEach((th) => {
    th.querySelector(".arr").textContent =
      th.dataset.key === s.key ? (s.dir > 0 ? "▲" : "▼") : "";
  });

  $("adm-shown").textContent = rows.length !== state.adminCameras.length
    ? rows.length + " / " + state.adminCameras.length + " ko'rsatilyapti" : "";

  const tbody = $("admin-tbody");
  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty">' +
      (state.adminCameras.length ? "Filtrlarga mos kamera topilmadi."
        : state.adminQuery ? "Qidiruvga mos kamera topilmadi."
        : "Hali kamera qo'shilmagan — «+ Kamera» dan boshlang.") +
      "</div></td></tr>";
    return;
  }
  rows.forEach((cam, i) => tbody.appendChild(adminRow(cam, state.adminOffset + i + 1)));
}

document.querySelectorAll("#adm-status button").forEach((b) =>
  b.addEventListener("click", () => {
    state.adminFilters.status = b.dataset.st;
    document.querySelectorAll("#adm-status button").forEach((x) =>
      x.classList.toggle("on", x === b));
    renderAdminTable();
  }));
$("adm-region").addEventListener("change", (e) => {
  state.adminFilters.region = e.target.value; renderAdminTable();
});
$("adm-codec").addEventListener("change", (e) => {
  state.adminFilters.codec = e.target.value; renderAdminTable();
});
$("adm-mode").addEventListener("change", (e) => {
  state.adminFilters.mode = e.target.value; renderAdminTable();
});
document.querySelectorAll("#admin-table th.sortable").forEach((th) =>
  th.addEventListener("click", () => {
    const key = th.dataset.key;
    if (state.adminSort.key === key) state.adminSort.dir *= -1;
    else state.adminSort = { key, dir: 1 };
    renderAdminTable();
  }));

function adminRow(cam, idx) {
  const tr = document.createElement("tr");
  const st = camStatus(cam);
  const stateInfo = { disabled: { tx: "O'chirilgan", cls: "dis" },
                      offline: { tx: "Oflayn", cls: "down" },
                      online: { tx: "Onlayn", cls: "" },
                      unknown: { tx: "Noma'lum", cls: "unk" } }[st];
  const addr = cam.source_type === "rtsp"
    ? cam.ip + ":" + cam.port + (cam.rtsp_path || "")
    : (cam.raw_stream_url || "—");

  tr.innerHTML =
    '<td class="num">' + idx + "</td>" +
    '<td><span class="st-chip ' + stateInfo.cls + '"><i></i>' + stateInfo.tx + "</span></td>" +
    '<td style="font-weight:600">' + esc(cam.name) + "</td>" +
    '<td style="color:var(--muted)">' + esc(cam.region) + "</td>" +
    '<td class="mono" style="font-size:11px;color:var(--muted);word-break:break-all">' + esc(addr) + "</td>" +
    "<td>" + (cam.codec
      ? '<span class="cdx-chip">' + esc(cam.codec) + (cam.transcode ? " → H264" : "") + "</span>"
      : '<span style="color:var(--faint)">—</span>') + "</td>" +
    '<td style="color:var(--muted);font-size:11.5px">' +
      (cam.always_on ? "doim tayyor" : "so'rov bo'yicha") + "</td>" +
    '<td style="text-align:right;white-space:nowrap">' +
      '<span class="tacts">' +
        '<button class="tbtn" data-act="edit">' + ICO.edit + "Tahrirlash</button>" +
        (cam.source_type === "rtsp" ? '<button class="tbtn ok" data-act="test">' + ICO.play + "Test</button>" : "") +
        '<button class="tbtn warn" data-act="find">' + ICO.map + "Xarita</button>" +
        '<button class="tbtn bad" data-act="del">' + ICO.trash + "O‘chirish</button>" +
      "</span><div class=\"adm-probe\"></div></td>";

  const out = tr.querySelector(".adm-probe");
  tr.querySelector('[data-act="edit"]').addEventListener("click", () => openCameraForm(cam));
  tr.querySelector('[data-act="del"]').addEventListener("click", () => deleteCamera(cam));
  tr.querySelector('[data-act="find"]').addEventListener("click", () => {
    showTab("map");
    if (hasGeo(cam)) map.setView([cam.lat, cam.lng], 15);
    else toast("Bu kameraga koordinata kiritilmagan", true);
    selectCamera(cam.id, false);
  });
  const testBtn = tr.querySelector('[data-act="test"]');
  if (testBtn) testBtn.addEventListener("click", async () => {
    testBtn.disabled = true;
    out.className = "adm-probe show wait";
    out.textContent = "Tekshirilmoqda…";
    try {
      const r = await api("/api/admin/probe", {
        method: "POST",
        body: JSON.stringify({
          ip: cam.ip, port: cam.port, username: cam.username,
          rtsp_path: cam.rtsp_path, camera_id: cam.id
        })
      });
      out.className = "adm-probe show " + (r.ok ? "ok" : "bad");
      out.textContent = r.message;
    } catch (e) {
      out.className = "adm-probe show bad";
      out.textContent = e.message;
    }
    testBtn.disabled = false;
  });
  return tr;
}

$("adm-prev").addEventListener("click", () =>
  loadAdminCameras(Math.max(0, state.adminOffset - state.adminSize)));
$("adm-next").addEventListener("click", () =>
  loadAdminCameras(state.adminOffset + state.adminSize));

let adminSearchTimer = null;
$("admin-search").addEventListener("input", (e) => {
  state.adminQuery = e.target.value;
  clearTimeout(adminSearchTimer);
  adminSearchTimer = setTimeout(() => loadAdminCameras(0), 250);
});

async function deleteCamera(cam) {
  if (!confirm('"' + cam.name + '" kamerasi butunlay o‘chirilsinmi?')) return;
  try {
    await api("/api/admin/cameras/" + cam.id, { method: "DELETE" });
    await loadAdminCameras(state.adminOffset);
    await loadCameras();
    addEvent(cam.name + " — o'chirildi", "warn");
    toast("Kamera o'chirildi");
  } catch (e) { toast(e.message, true); }
}

/* ---------- MediaMTX ---------- */
$("sync-btn").addEventListener("click", async () => {
  openModal("mtx-modal");
  $("mtx-text").textContent = "Yuklanmoqda…";
  try {
    const r = await api("/api/admin/mediamtx/config");
    $("mtx-text").textContent = r.text;
    $("mtx-lead").textContent = r.api_available
      ? "MediaMTX ishlab turibdi — o'zgarishlar qayta ishga tushirmasdan qo'llanadi."
      : "MediaMTX hozir ishlamayapti — fayl yoziladi, keyin MediaMTX'ni ishga tushiring.";
  } catch (e) {
    $("mtx-text").textContent = e.message;
  }
});

$("mtx-apply").addEventListener("click", async () => {
  $("mtx-apply").disabled = true;
  try {
    const r = await api("/api/admin/mediamtx/sync", { method: "POST" });
    closeModal("mtx-modal");
    toast(r.written + " ta kamera yozildi · " + r.live.message, !r.live.ok);
    addEvent("MediaMTX konfiguratsiyasi qo'llandi", "ok");
  } catch (e) {
    toast(e.message, true);
  }
  $("mtx-apply").disabled = false;
});
