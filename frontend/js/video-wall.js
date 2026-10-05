/* Video devor: setka (2x2...8x8), sifat tanlovi, hudud filtri, avto-almashish. */
import { $, HEVC_OK, esc, state, toast } from "./state.js";
import { ICO } from "./icons.js";
import { refreshMarkerIcons } from "./map.js";
import { renderFootStats } from "./camera-list.js";
import { createPlayer } from "./player.js";
import { selectCamera } from "./selection.js";

/* ---------- Video devor ---------- */
export let wallPlayers = [];
let wallAutoTimer = null;
const wallTiles = new Map();   // kamera id → { tile, player, down }

/* Devor sozlamalari brauzerda saqlanadi — qayta ochilganda tiklanadi. */
function saveWallPrefs() {
  try {
    localStorage.setItem("nigoh-wall", JSON.stringify({
      size: state.wallSize, fit: state.wallFit, interval: state.wallInterval,
      region: state.wallRegion, auto: state.wallAuto, quality: state.wallQuality
    }));
  } catch (e) {}
}
function loadWallPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem("nigoh-wall") || "{}");
    if ([2, 3, 4, 6, 8].includes(p.size)) state.wallSize = p.size;
    if (p.fit === "cover" || p.fit === "contain") state.wallFit = p.fit;
    if (typeof p.region === "string") state.wallRegion = p.region;
    if (Number(p.interval) >= 5) state.wallInterval = Number(p.interval);
    state.wallAuto = !!p.auto;
    if (["auto", "sub", "main"].includes(p.quality)) state.wallQuality = p.quality;
  } catch (e) {}
  document.querySelectorAll("#wall-sizes button").forEach((b) =>
    b.classList.toggle("on", Number(b.dataset.wsize) === state.wallSize));
  document.querySelectorAll("#wall-quality button").forEach((b) =>
    b.classList.toggle("on", b.dataset.wq === state.wallQuality));
}

/* Devor kataklari qaysi oqimni oladi. Past — kameraning 2-oqimi (~704x576,
   ~1 Mbit/s): 16-64 katak tarmoq va brauzer dekoderini bo'g'masin.
   Yuqori — asl oqim (1080p/1440p, 2-5 Mbit/s har biri). Avto — 4 tagacha
   katakda asl sifat (ular katta, farq ko'rinadi), ko'prog'ida past. */
const WALL_AUTO_MAIN_MAX = 4;
function wallStreamQuality(tileCount) {
  if (state.wallQuality === "main") return "";
  if (state.wallQuality === "sub") return "sub";
  return tileCount <= WALL_AUTO_MAIN_MAX ? "" : "sub";
}
loadWallPrefs();

/* Devorga tushadigan kameralar: biriktirilganlar oldinda, keyin qolganlar. */
function wallCams() {
  const seen = new Set();
  const out = [];
  const fits = (cam) =>
    !state.wallHidden.has(cam.id) &&
    (!state.wallRegion || cam.region === state.wallRegion);
  state.pinned.forEach((id) => {
    const cam = state.byId.get(id);
    if (cam && !seen.has(id) && fits(cam)) { seen.add(id); out.push(cam); }
  });
  state.cameras.forEach((cam) => {
    if (!seen.has(cam.id) && cam.online !== false && fits(cam)) {
      seen.add(cam.id); out.push(cam);
    }
  });
  return out;
}

function fillWallRegions() {
  const sel = $("wall-region");
  const regions = [...new Set(state.cameras.map((c) => c.region))].sort();
  const cur = state.wallRegion;
  sel.innerHTML = '<option value="">Barcha hududlar</option>' +
    regions.map((r) => '<option value="' + esc(r) + '"' +
      (r === cur ? " selected" : "") + ">" + esc(r) + "</option>").join("");
  if (cur && !regions.includes(cur)) { state.wallRegion = ""; sel.value = ""; }
}

export function buildWall() {
  clearInterval(wallAutoTimer);
  wallAutoTimer = null;
  fillWallRegions();
  const all = wallCams();
  const slots = state.wallSize * state.wallSize;
  const pages = Math.max(1, Math.ceil(all.length / slots));
  state.wallPage = Math.min(state.wallPage, pages - 1);
  const cams = all.slice(state.wallPage * slots, state.wallPage * slots + slots);

  const grid = $("wall-grid");
  grid.classList.toggle("cover", state.wallFit === "cover");
  // Setka kamera soniga moslashadi: 2 ta kamera 2×2 katakka qisilmaydi,
  // butun ekranni to'ldiradi. Tanlangan o'lcham — yuqori chegara.
  const n = Math.max(1, cams.length);
  const cols = Math.min(state.wallSize, Math.ceil(Math.sqrt(n)));
  const rows = Math.min(state.wallSize, Math.ceil(n / cols));
  grid.style.gridTemplateColumns = "repeat(" + cols + ",1fr)";
  grid.style.gridTemplateRows = "repeat(" + rows + ",1fr)";

  $("wall-label").textContent = state.wallSize + "×" + state.wallSize + " setka · " +
    all.length + " kamera" +
    (state.wallRegion ? " · " + state.wallRegion : "") +
    (state.pinned.length ? " · " + state.pinned.length + " biriktirilgan" : "");
  $("wall-page").textContent = (state.wallPage + 1) + " / " + pages;
  $("wall-prev").disabled = state.wallPage === 0;
  $("wall-next").disabled = state.wallPage >= pages - 1;
  $("wall-fit").textContent = state.wallFit === "cover" ? "Katakni to'ldirish" : "Butun ko'rinish";
  $("wall-auto").classList.toggle("on", state.wallAuto);
  $("wall-auto").setAttribute("aria-checked", state.wallAuto ? "true" : "false");
  $("wall-interval").value = String(state.wallInterval);
  const upNow = cams.filter((c) => c.online !== false).length;
  $("wall-live").textContent = "Sahifada " + upNow + " / " + cams.length + " onlayn";
  const bad = cams.length - upNow;
  const conn = $("wall-conn");
  conn.textContent = bad === 0 ? "Ulanish barqaror"
    : bad === cams.length ? "Ulanish yo'q" : bad + " ta kamerada uzilish";
  const p2 = (x) => String(x).padStart(2, "0");
  const nw = new Date();
  $("wall-upd").textContent = p2(nw.getHours()) + ":" + p2(nw.getMinutes()) + ":" + p2(nw.getSeconds());

  // Diff: bor plitkalar qayta ishlatiladi (oqim uzilmaydi), ketganlari
  // to'xtatiladi, yangilari yaratiladi, tartib DOM'da to'g'rilanadi.
  const want = new Set(cams.map((c) => c.id));
  wallTiles.forEach((t, id) => {
    const cam = state.byId.get(id);
    const stillOk = want.has(id) && cam && (cam.online === false) === t.down;
    if (!stillOk) { if (t.player) t.player.stop(); t.tile.remove(); wallTiles.delete(id); }
  });
  grid.querySelectorAll(".empty").forEach((e) => e.remove());
  if (!cams.length) {
    grid.insertAdjacentHTML("beforeend",
      '<div class="empty" style="grid-column:1/-1">Ko‘rsatiladigan kamera yo‘q.</div>');
  }

  const quality = wallStreamQuality(cams.length);
  cams.forEach((cam, i) => {
    let t = wallTiles.get(cam.id);
    if (!t) { t = makeTile(cam, quality); wallTiles.set(cam.id, t); }
    else if (t.player && t.quality !== quality) {
      // Sifat yoki katak soni o'zgardi — bor plitka yangi oqimga o'tadi.
      t.quality = quality;
      if (document.fullscreenElement !== t.tile) t.player.open(cam, HEVC_OK, quality);
    }
    // Yengil yangilanishlar: biriktirilganlik va tanlanganlik.
    t.tile.querySelector('[data-w="pin"]').classList.toggle("on", state.pinned.includes(cam.id));
    t.tile.classList.toggle("sel", cam.id === state.selectedId);
    if (grid.children[i] !== t.tile) grid.insertBefore(t.tile, grid.children[i] || null);
  });
  wallPlayers = [...wallTiles.values()].map((t) => t.player).filter(Boolean);
  renderFootStats();
  syncWallAuto();
}

/* Kamera suratini faylga saqlash (plitka va tafsilot panelidan). */
export async function saveSnapshot(cam) {
  try {
    const blob = await (await fetch("/api/cameras/" + cam.id + "/snapshot")).blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = cam.name.replace(/[^\w\-]+/g, "_") + ".jpg";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Surat saqlandi");
  } catch (e) { toast("Surat olinmadi", true); }
}

/* Bitta plitka: video, ustki/ostki yozuvlar, tugmalar va pleyer. */
function makeTile(cam, quality) {
  const down = cam.online === false;
  const tile = document.createElement("div");
  tile.className = "tile" + (down ? " down" : "");
  tile.innerHTML =
    '<video muted playsinline poster="/api/cameras/' + cam.id + '/snapshot"></video>' +
    '<div class="t-msg"></div>' +
    '<div class="t-head"><i></i><span class="nm">' + esc(cam.name) + "</span>" +
      // Ba'zi bazalarda hudud nomi kamera nomi bilan bir xil — ikki marta yozmaymiz.
      (cam.region && cam.region !== cam.name
        ? '<span class="rg">' + esc(cam.region) + "</span>" : "") +
      '<span class="st">' + (down ? "OFFLINE" : "LIVE") + "</span></div>" +
    '<div class="t-btns">' +
      '<button data-w="pin" title="Devorga biriktirish">' + ICO.star + "</button>" +
      '<button data-w="map" title="Xaritada ko\'rsatish">' + ICO.pin + "</button>" +
      '<button data-w="shot" title="Suratini yuklab olish">' + ICO.down + "</button>" +
      '<button data-w="full" title="To\'liq ekran">' + ICO.full + "</button>" +
      '<button data-w="x" title="Devordan olish">' + ICO.close + "</button>" +
    "</div>" +
    '<div class="t-foot"><span>' + esc(cam.codec || "") + "</span>" +
      '<span style="margin-left:auto"></span></div>';

  const on = (act, fn) => tile.querySelector('[data-w="' + act + '"]')
    .addEventListener("click", (e) => { e.stopPropagation(); fn(); });
  on("pin", () => {
    state.pinned = state.pinned.includes(cam.id)
      ? state.pinned.filter((x) => x !== cam.id) : [cam.id, ...state.pinned];
    buildWall();
  });
  on("map", () => selectCamera(cam.id, true));
  on("shot", () => saveSnapshot(cam));
  // Plitkaning o'zi to'liq ekranga chiqadi — nomi, LIVE belgisi va
  // pastki ma'lumotlar saqlanib qoladi. Qayta bosish/ESC — chiqish.
  const goFull = () => {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    const v = tile.querySelector("video");
    if (tile.requestFullscreen) tile.requestFullscreen();
    else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
  };
  on("full", goFull);
  on("x", () => {
    state.wallHidden.add(cam.id);
    state.pinned = state.pinned.filter((x) => x !== cam.id);
    buildWall();
  });
  // Bir bosish — devorda ajratib ko'rsatish (xaritaga o'tmaydi, oqimlar
  // uzilmaydi); ikki bosish — to'liq ekran; xaritaga «◎» tugmasi.
  tile.addEventListener("click", () => {
    state.selectedId = cam.id;
    wallTiles.forEach((t, id) => t.tile.classList.toggle("sel", id === cam.id));
    refreshMarkerIcons();
  });
  tile.addEventListener("dblclick", goFull);

  let player = null;
  if (!down) {
    player = createPlayer(tile.querySelector("video"), tile.querySelector(".t-msg"));
    const msEl = tile.querySelector(".t-foot span:last-child");
    player.onOpen = (ms) => { msEl.textContent = (ms / 1000).toFixed(2) + "s"; };
    // Oqim sifati devor tanloviga bog'liq (wallStreamQuality). Sub
    // bo'lmasa server asosiysini beradi; to'liq ekranda doim asosiy.
    player.open(cam, HEVC_OK, quality);
    tile.addEventListener("fullscreenchange", () => {
      const t = wallTiles.get(cam.id);
      player.open(cam, HEVC_OK,
        document.fullscreenElement === tile ? "" : (t ? t.quality : quality));
    });
  } else {
    tile.querySelector(".t-msg").textContent = "ulanish yo'q";
  }
  return { tile, player, down, quality };
}

export function stopWall() {
  wallTiles.forEach((t) => { if (t.player) t.player.stop(); t.tile.remove(); });
  wallTiles.clear();
  wallPlayers = [];
  clearInterval(wallAutoTimer);
  wallAutoTimer = null;
  renderFootStats();
}

/* Avto-aylanish: bir necha sahifa bo'lsa, har 12 soniyada keyingisiga o'tadi. */
function syncWallAuto() {
  clearInterval(wallAutoTimer);
  wallAutoTimer = null;
  if (!state.wallAuto || state.tab !== "wall") return;
  wallAutoTimer = setInterval(() => {
    const pages = Math.max(1, Math.ceil(wallCams().length /
      (state.wallSize * state.wallSize)));
    if (pages < 2) return;
    state.wallPage = (state.wallPage + 1) % pages;
    buildWall();
  }, Math.max(5, state.wallInterval) * 1000);
}

document.querySelectorAll("#wall-sizes button").forEach((b) =>
  b.addEventListener("click", () => {
    state.wallSize = Number(b.dataset.wsize);
    state.wallPage = 0;
    document.querySelectorAll("#wall-sizes button").forEach((x) =>
      x.classList.toggle("on", x === b));
    saveWallPrefs();
    buildWall();
  }));
document.querySelectorAll("#wall-quality button").forEach((b) =>
  b.addEventListener("click", () => {
    state.wallQuality = b.dataset.wq;
    document.querySelectorAll("#wall-quality button").forEach((x) =>
      x.classList.toggle("on", x === b));
    saveWallPrefs();
    buildWall();
  }));
$("wall-region").addEventListener("change", (e) => {
  state.wallRegion = e.target.value;
  state.wallPage = 0;
  saveWallPrefs();
  buildWall();
});
$("wall-fit").addEventListener("click", () => {
  state.wallFit = state.wallFit === "cover" ? "contain" : "cover";
  saveWallPrefs();
  buildWall();
});
$("wall-auto").addEventListener("click", () => {
  state.wallAuto = !state.wallAuto;
  saveWallPrefs();
  buildWall();
});
$("wall-interval").addEventListener("change", (e) => {
  state.wallInterval = Number(e.target.value) || 12;
  saveWallPrefs();
  syncWallAuto();
});
/* Devorni to'liq ekranga chiqarish — sarlavha va boshqaruvlar bilan birga. */
$("wall-fs").addEventListener("click", () => {
  if (document.fullscreenElement) { document.exitFullscreen(); return; }
  const el = $("wall-view");
  if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
});
$("wall-prev").addEventListener("click", () => {
  state.wallPage = Math.max(0, state.wallPage - 1);
  buildWall();
});
$("wall-next").addEventListener("click", () => {
  state.wallPage++;
  buildWall();
});
// Devorda ← → sahifalarni almashtiradi (matn maydonida bo'lmasa).
document.addEventListener("keydown", (e) => {
  if (state.tab !== "wall" || document.querySelector(".backdrop.open, .login-screen.open")) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
  if (e.key === "ArrowRight" && !$("wall-next").disabled) $("wall-next").click();
  if (e.key === "ArrowLeft" && !$("wall-prev").disabled) $("wall-prev").click();
});
