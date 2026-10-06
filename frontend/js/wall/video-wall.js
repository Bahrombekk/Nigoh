/* ==========================================================================
   wall/video-wall.js — video devor
   --------------------------------------------------------------------------
   Vazifasi:
     Bir sahifada ko'p kamera: setka (2x2 ... 8x8), sahifalash, hudud filtri,
     oqim sifati (auto/sub/main), kadrni katakka moslash, avto-aylanish,
     biriktirish (pin), devordan olish, plitka to'liq ekrani, surat saqlash.
     Sozlamalar brauzerda saqlanadi.

   Eksport:
     VideoWall           — klass: build(), stop(), makeTile(), syncAuto(), prefs
     videoWall           — yagona nusxa
     wallPlayers         — JONLI eksport (let): devordagi faol Player'lar ro'yxati
     buildWall()         — devorni (diff bilan) qayta qurish
     stopWall()          — barcha plitka oqimlarini to'xtatish
     saveSnapshot(cam)   — kamera suratini .jpg qilib yuklab berish (panel ham ishlatadi)

   Bog'liqliklar:
     import: ../core/state.js, ../core/icons.js (ICO), ../map/map.js (refreshMarkerIcons),
             ../map/camera-list.js (renderFootStats), ../player/player.js (createPlayer),
             ../map/selection.js (selectCamera)

   DOM: #wall-view, #wall-grid, #wall-sizes, #wall-quality, #wall-region, #wall-fit,
        #wall-auto, #wall-interval, #wall-fs, #wall-prev, #wall-next, #wall-page,
        #wall-label, #wall-live, #wall-conn, #wall-upd
   Backend: GET /api/cameras/{id}/snapshot (poster, surat),
            oqim — Player orqali (/api/cameras/{id}/stream?quality=sub|"")
   localStorage kaliti: "nigoh-wall"

   Qoidalar / tuzoqlar:
     - build() DIFF qiladi: mavjud plitkalar qayta ishlatiladi (oqim uzilmaydi),
       faqat ketganlari to'xtatiladi, yangilari yaratiladi. Har 30 s dagi
       yangilanish shu sababli tasvirni uzmaydi.
     - To'liq ekrandagi plitka har doim asosiy (asl) oqimga o'tadi.
     - Sozlamalar konstruktorda (modul yuklanishida) o'qiladi — avvalgidek.
     - ← → tugmalari devor ochiq va modal yo'q bo'lsagina sahifa almashtiradi.
   ========================================================================== */
import { $, HEVC_OK, esc, state, toast } from "../core/state.js";
import { ICO } from "../core/icons.js";
import { refreshMarkerIcons } from "../map/map.js";
import { renderFootStats } from "../map/camera-list.js";
import { createPlayer } from "../player/player.js";
import { selectCamera } from "../map/selection.js";

/* Jonli eksport — camera-list.js ochiq oqimlarni sanaydi. VideoWall.players
   bilan birga yoziladi. */
export let wallPlayers = [];

/* Devor kataklari qaysi oqimni oladi. Past — kameraning 2-oqimi (~704x576,
   ~1 Mbit/s): 16-64 katak tarmoq va brauzer dekoderini bo'g'masin.
   Yuqori — asl oqim (1080p/1440p, 2-5 Mbit/s har biri). Avto — 4 tagacha
   katakda asl sifat (ular katta, farq ko'rinadi), ko'prog'ida past. */
const WALL_AUTO_MAIN_MAX = 4;
/* Avto-almashishda keyingi sahifa shuncha oldin ko'rinmas joyda ochiladi —
   almashish paytida kataklar allaqachon video ko'rsatib turadi. Devorda
   o'lchangan ochilish vaqti 1,5–4,8 s; 5 s zaxira (oraliq qisqa bo'lsa —
   uning yarmi). Shu soniyalarda trafik ikki sahifalik bo'ladi. */
const PRELOAD_LEAD_MS = 5000;

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

/* ---------- Video devor ---------- */
export class VideoWall {
  constructor() {
    this.players = [];
    this.wallAutoTimer = null;
    this.stageTimer = null;
    this.autoKey = "";            // taymer qaysi sahifa/sozlama uchun qo'yilgan
    this.wallTiles = new Map();   // kamera id → { tile, player, down, quality }
    this.staged = new Map();      // keyingi sahifa: oldindan ochilgan, ko'rinmas plitkalar

    this.loadPrefs();
    this.bindControls();
  }

  /* Devor sozlamalari brauzerda saqlanadi — qayta ochilganda tiklanadi. */
  savePrefs() {
    try {
      localStorage.setItem("nigoh-wall", JSON.stringify({
        size: state.wallSize, fit: state.wallFit, interval: state.wallInterval,
        region: state.wallRegion, auto: state.wallAuto, quality: state.wallQuality
      }));
    } catch (e) {}
  }

  loadPrefs() {
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

  streamQuality(tileCount) {
    if (state.wallQuality === "main") return "";
    if (state.wallQuality === "sub") return "sub";
    return tileCount <= WALL_AUTO_MAIN_MAX ? "" : "sub";
  }

  /* Devorga tushadigan kameralar: biriktirilganlar oldinda, keyin qolganlar. */
  cams() {
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

  fillRegions() {
    const sel = $("wall-region");
    const regions = [...new Set(state.cameras.map((c) => c.region))].sort();
    const cur = state.wallRegion;
    sel.innerHTML = '<option value="">Barcha hududlar</option>' +
      regions.map((r) => '<option value="' + esc(r) + '"' +
        (r === cur ? " selected" : "") + ">" + esc(r) + "</option>").join("");
    if (cur && !regions.includes(cur)) { state.wallRegion = ""; sel.value = ""; }
  }

  build() {
    this.fillRegions();
    const all = this.cams();
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
    const wallTiles = this.wallTiles;
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

    const quality = this.streamQuality(cams.length);
    cams.forEach((cam, i) => {
      let t = wallTiles.get(cam.id);
      let fromStage = false;
      if (!t) {
        // Avto-almashish keyingi sahifani oldindan ochgan bo'lsa — tayyorini olamiz.
        const st = this.staged.get(cam.id);
        if (st && st.quality === quality && st.down === (cam.online === false)) {
          this.staged.delete(cam.id);
          t = st;
          fromStage = true;
        } else {
          t = this.makeTile(cam, quality);
        }
        wallTiles.set(cam.id, t);
      } else if (t.player && t.quality !== quality) {
        // Sifat yoki katak soni o'zgardi — bor plitka yangi oqimga o'tadi.
        t.quality = quality;
        if (document.fullscreenElement !== t.tile) t.player.open(cam, HEVC_OK, quality);
      }
      // Yengil yangilanishlar: biriktirilganlik va tanlanganlik.
      t.tile.querySelector('[data-w="pin"]').classList.toggle("on", state.pinned.includes(cam.id));
      t.tile.classList.toggle("sel", cam.id === state.selectedId);
      if (grid.children[i] !== t.tile) grid.insertBefore(t.tile, grid.children[i] || null);
      // DOM'da ko'chirilgan <video> ni brauzer to'xtatadi — oqim tirik, davom ettiramiz.
      if (fromStage) t.tile.querySelector("video").play().catch(() => {});
    });
    wallPlayers = this.players = [...wallTiles.values()].map((t) => t.player).filter(Boolean);
    renderFootStats();
    // Keyingi sahifaga tegishli bo'lmagan oldindan ochilganlar — yopiladi.
    this.discardStaged(new Set(this.pageCams(state.wallPage + 1).map((c) => c.id)));
    this.syncAuto();
  }

  /* `page` sahifadagi kameralar (oxiridan keyin — birinchisi, aylana). */
  pageCams(page) {
    const all = this.cams();
    const slots = state.wallSize * state.wallSize;
    const pages = Math.max(1, Math.ceil(all.length / slots));
    const p = ((page % pages) + pages) % pages;
    return all.slice(p * slots, p * slots + slots);
  }

  /* Ko'rinmas joy: oldindan ochiladigan plitkalar shu yerda o'ynaydi
     (display:none emas — unda brauzer videoni dekodlamaydi). */
  stageBox() {
    let box = document.getElementById("wall-stage");
    if (!box) {
      box = document.createElement("div");
      box.id = "wall-stage";
      box.setAttribute("aria-hidden", "true");
      document.body.appendChild(box);
    }
    return box;
  }

  /* Keyingi sahifa kameralarini oldindan ochadi (faqat avto-almashishda). */
  preloadNext() {
    if (!state.wallAuto || state.tab !== "wall") return;
    const pages = Math.ceil(this.cams().length / (state.wallSize * state.wallSize));
    if (pages < 2) return;
    const cams = this.pageCams(state.wallPage + 1);
    const quality = this.streamQuality(cams.length);
    const box = this.stageBox();
    cams.forEach((cam) => {
      if (this.wallTiles.has(cam.id) || this.staged.has(cam.id)) return;
      const t = this.makeTile(cam, quality);
      box.appendChild(t.tile);
      this.staged.set(cam.id, t);
    });
  }

  discardStaged(keep = new Set()) {
    this.staged.forEach((t, id) => {
      if (keep.has(id)) return;
      if (t.player) t.player.stop();
      t.tile.remove();
      this.staged.delete(id);
    });
  }

  /* Bitta plitka: video, ustki/ostki yozuvlar, tugmalar va pleyer. */
  makeTile(cam, quality) {
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
      this.build();
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
      this.build();
    });
    // Bir bosish — devorda ajratib ko'rsatish (xaritaga o'tmaydi, oqimlar
    // uzilmaydi); ikki bosish — to'liq ekran; xaritaga «◎» tugmasi.
    tile.addEventListener("click", () => {
      state.selectedId = cam.id;
      this.wallTiles.forEach((t, id) => t.tile.classList.toggle("sel", id === cam.id));
      refreshMarkerIcons();
    });
    tile.addEventListener("dblclick", goFull);

    let player = null;
    if (!down) {
      player = createPlayer(tile.querySelector("video"), tile.querySelector(".t-msg"));
      const msEl = tile.querySelector(".t-foot span:last-child");
      player.onOpen = (ms) => { msEl.textContent = (ms / 1000).toFixed(2) + "s"; };
      // Oqim sifati devor tanloviga bog'liq (streamQuality). Sub
      // bo'lmasa server asosiysini beradi; to'liq ekranda doim asosiy.
      player.open(cam, HEVC_OK, quality);
      tile.addEventListener("fullscreenchange", () => {
        const t = this.wallTiles.get(cam.id);
        player.open(cam, HEVC_OK,
          document.fullscreenElement === tile ? "" : (t ? t.quality : quality));
      });
    } else {
      tile.querySelector(".t-msg").textContent = "ulanish yo'q";
    }
    return { tile, player, down, quality };
  }

  stop() {
    this.wallTiles.forEach((t) => { if (t.player) t.player.stop(); t.tile.remove(); });
    this.wallTiles.clear();
    wallPlayers = this.players = [];
    clearTimeout(this.wallAutoTimer);
    clearTimeout(this.stageTimer);
    this.wallAutoTimer = this.stageTimer = null;
    this.autoKey = "";
    this.discardStaged();
    renderFootStats();
  }

  /* Avto-aylanish: bir necha sahifa bo'lsa, har N soniyada keyingisiga o'tadi.
     Almashishdan PRELOAD_LEAD_MS oldin keyingi sahifa ko'rinmas joyda ochiladi.

     Taymer faqat sahifa yoki sozlama o'zgarganda qayta qo'yiladi: ma'lumot
     har 30 s da yangilanib build() chaqirilganda (core/data.js) ilgari taymer
     har safar noldan boshlanardi — sahifa 12 s o'rniga 20+ s turib qolardi. */
  syncAuto() {
    const key = [state.wallAuto, state.tab, state.wallPage, state.wallSize,
                 state.wallRegion, state.wallInterval].join("|");
    if (key === this.autoKey && this.wallAutoTimer) return;
    this.autoKey = key;
    clearTimeout(this.wallAutoTimer);
    clearTimeout(this.stageTimer);
    this.wallAutoTimer = this.stageTimer = null;
    if (!state.wallAuto || state.tab !== "wall") { this.discardStaged(); return; }
    const period = Math.max(5, state.wallInterval) * 1000;
    const lead = Math.min(PRELOAD_LEAD_MS, period / 2);
    this.stageTimer = setTimeout(() => this.preloadNext(), period - lead);
    this.wallAutoTimer = setTimeout(() => {
      this.wallAutoTimer = null;
      const pages = Math.max(1, Math.ceil(this.cams().length /
        (state.wallSize * state.wallSize)));
      if (pages >= 2) state.wallPage = (state.wallPage + 1) % pages;
      this.autoKey = "";                 // yangi davr
      this.build();
    }, period);
  }

  bindControls() {
    document.querySelectorAll("#wall-sizes button").forEach((b) =>
      b.addEventListener("click", () => {
        state.wallSize = Number(b.dataset.wsize);
        state.wallPage = 0;
        document.querySelectorAll("#wall-sizes button").forEach((x) =>
          x.classList.toggle("on", x === b));
        this.savePrefs();
        this.build();
      }));
    document.querySelectorAll("#wall-quality button").forEach((b) =>
      b.addEventListener("click", () => {
        state.wallQuality = b.dataset.wq;
        document.querySelectorAll("#wall-quality button").forEach((x) =>
          x.classList.toggle("on", x === b));
        this.savePrefs();
        this.build();
      }));
    $("wall-region").addEventListener("change", (e) => {
      state.wallRegion = e.target.value;
      state.wallPage = 0;
      this.savePrefs();
      this.build();
    });
    $("wall-fit").addEventListener("click", () => {
      state.wallFit = state.wallFit === "cover" ? "contain" : "cover";
      this.savePrefs();
      this.build();
    });
    $("wall-auto").addEventListener("click", () => {
      state.wallAuto = !state.wallAuto;
      this.savePrefs();
      this.build();
    });
    $("wall-interval").addEventListener("change", (e) => {
      state.wallInterval = Number(e.target.value) || 12;
      this.savePrefs();
      this.autoKey = "";
      this.syncAuto();
    });
    /* Devorni to'liq ekranga chiqarish — sarlavha va boshqaruvlar bilan birga. */
    $("wall-fs").addEventListener("click", () => {
      if (document.fullscreenElement) { document.exitFullscreen(); return; }
      const el = $("wall-view");
      if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    });
    $("wall-prev").addEventListener("click", () => {
      state.wallPage = Math.max(0, state.wallPage - 1);
      this.build();
    });
    $("wall-next").addEventListener("click", () => {
      state.wallPage++;
      this.build();
    });
    // Devorda ← → sahifalarni almashtiradi (matn maydonida bo'lmasa).
    document.addEventListener("keydown", (e) => {
      if (state.tab !== "wall" || document.querySelector(".backdrop.open, .login-screen.open")) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
      if (e.key === "ArrowRight" && !$("wall-next").disabled) $("wall-next").click();
      if (e.key === "ArrowLeft" && !$("wall-prev").disabled) $("wall-prev").click();
    });
  }
}

export const videoWall = new VideoWall();

export function buildWall() { videoWall.build(); }
export function stopWall() { videoWall.stop(); }
