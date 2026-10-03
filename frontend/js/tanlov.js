/* Tanlangan kamera paneli: jonli ko'rish, tafsilotlar, oldindan isitish (prewarm). */
import { $, HEVC_OK, state, toast } from "./holat.js";
import { api } from "./api.js";
import { hasGeo, map, refreshMarkerIcons } from "./xarita.js";
import { MOBILE, renderFootStats, renderList, setListOpen } from "./royxat.js";
import { createPlayer } from "./pleyer.js";
import { saveSnapshot } from "./devor.js";
import { addEvent } from "./dashboard.js";
import { showTab } from "./tablar.js";
import { openCameraForm } from "./kamera-shakli.js";

/* ---------- Tanlangan kamera paneli ---------- */
export let selPlayer = null;

export function fmtLastSeen(iso) {
  if (!iso) return "ma'lum emas";
  const t = new Date(iso);
  if (isNaN(t)) return "ma'lum emas";
  const diff = (Date.now() - t.getTime()) / 1000;
  if (diff < 90) return "hozirgina";
  if (diff < 3600) return Math.round(diff / 60) + " daqiqa oldin";
  if (diff < 86400) return Math.round(diff / 3600) + " soat oldin";
  const p = (n) => String(n).padStart(2, "0");
  return p(t.getDate()) + "." + p(t.getMonth() + 1) + "." + t.getFullYear() +
         " " + p(t.getHours()) + ":" + p(t.getMinutes());
}

export function selectCamera(id, fly) {
  state.selectedId = id;
  const cam = state.byId.get(id);
  if (!cam) return;
  // Boshqa tab'dan kelinsa avval xaritaga o'tamiz — showTab o'zi qayta chaqiradi.
  if (state.tab !== "map") { showTab("map"); return; }
  if (fly !== false && hasGeo(cam)) map.flyTo([cam.lat, cam.lng], Math.max(map.getZoom(), 13), { duration: 0.6 });

  setSelOpen(true);
  if (MOBILE.matches) setListOpen(false);
  updateSelHead();
  renderList();
  refreshMarkerIcons();

  const video = $("sel-video");
  video.poster = "";
  video.poster = "/api/cameras/" + cam.id + "/snapshot?" + Date.now();
  if (!selPlayer) selPlayer = createPlayer(video, $("sel-msg"));
  selPlayer.onOpen = (ms, mode) => {
    $("sel-f-open").textContent = (ms / 1000).toFixed(2).replace(".", ",") + " s";
    const modeText = { raw: "xom H.265", direct: "to'g'ridan-to'g'ri",
                       transcode: "H.264 ga o'girilgan", manual: "tashqi oqim" }[mode] || mode;
    $("sel-f-mode").textContent = cam.always_on ? "doim tayyor" : modeText;
    addEvent(cam.name + " — oqim ochildi (" + (ms / 1000).toFixed(1) + " s)", "ok");
  };
  $("sel-f-open").innerHTML = "&mdash;";
  selPlayer.open(cam, HEVC_OK);
  // O'chiq kamera — kutish o'rniga darhol sabab ko'rsatiladi (oqim baribir
  // sinab ko'riladi: tekshiruv 60 soniya eskirgan bo'lishi mumkin).
  if (cam.online === false) {
    selPlayer.setMsg("Kamera o'chiq · oxirgi onlayn: " + fmtLastSeen(cam.last_seen), "wait");
  }
  renderFootStats();
}

/* Keng ekranda panel doim ko'rinadi: tanlov bo'lmasa o'rniga yo'riqnoma
   turadi. Tor ekranda u xarita ustida suzadi — faqat tanlov bo'lsa
   ko'rinadi (body.has-sel, style.css). */
export function setSelOpen(open) {
  $("sel-body").hidden = !open;
  $("sel-empty").hidden = open;
  document.body.classList.toggle("has-sel", open);
}

export function updateSelHead() {
  const cam = state.byId.get(state.selectedId);
  if (!cam) { setSelOpen(false); return; }
  const down = cam.online === false;
  $("sel-name").textContent = cam.name;
  $("sel-sub").textContent = "ID " + cam.id + (cam.external_id ? " · " + cam.external_id : "");
  document.querySelector(".sp-st").classList.toggle("down", down);
  $("sel-badge").classList.toggle("down", down);
  $("sel-badge-tx").textContent = down ? "Uzilgan" : "Onlayn";
  $("sel-badge-2").textContent = down ? "OFFLINE" : "LIVE";
  $("sel-f-region").textContent = cam.region || "—";
  $("sel-f-res").textContent = cam.resolution || "—";
  $("sel-f-seen").textContent = down ? fmtLastSeen(cam.last_seen) : "hozirgina";
  $("sel-f-codec").textContent = cam.codec || "—";
  $("sel-f-mode").textContent = cam.always_on ? "doim tayyor" : "so'rov bo'yicha";
  const p = (n) => String(n).padStart(2, "0");
  const now = new Date();
  $("sel-stamp").textContent = p(now.getDate()) + "-" + p(now.getMonth() + 1) + "-" +
    now.getFullYear() + " " + p(now.getHours()) + ":" + p(now.getMinutes());
}

export function closeSel() {
  state.selectedId = null;
  setSelOpen(false);
  if (selPlayer) selPlayer.stop();
  renderList();
  refreshMarkerIcons();
  renderFootStats();
}
$("sel-close").addEventListener("click", closeSel);

$("sel-full").addEventListener("click", () => {
  const v = $("sel-video");
  (v.requestFullscreen || v.webkitEnterFullscreen || function(){}).call(v);
});

$("sel-shot").addEventListener("click", () => {
  const cam = state.byId.get(state.selectedId);
  if (cam) saveSnapshot(cam);
});
$("sel-edit").addEventListener("click", async () => {
  const cam = state.byId.get(state.selectedId);
  if (!cam) return;
  if (!state.admin) { toast("Avval super-admin sifatida kiring", true); return; }
  // Shakl to'liq yozuvni talab qiladi (IP, login, yo'l) — uni admin API dan
  // nomi bo'yicha qidirib olamiz; topilmasa boshqaruv bo'limiga o'tkazamiz.
  try {
    const res = await api("/api/admin/cameras?q=" + encodeURIComponent(cam.name) +
                          "&limit=50&offset=0");
    const full = (res.cameras || []).find((c) => c.id === cam.id);
    if (full) { openCameraForm(full); return; }
  } catch (e) { /* pastda boshqaruvga o'tamiz */ }
  toast("Kamera yozuvi topilmadi — boshqaruv bo'limidan tahrirlang", true);
  showTab("admin");
});
$("sel-center").addEventListener("click", () => {
  const cam = state.byId.get(state.selectedId);
  if (cam && hasGeo(cam)) map.flyTo([cam.lat, cam.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
  else if (cam) toast("Bu kameraga koordinata kiritilmagan", true);
});

$("sel-wall").addEventListener("click", () => {
  const id = state.selectedId;
  if (id && !state.pinned.includes(id)) state.pinned.push(id);
  showTab("wall");
});
