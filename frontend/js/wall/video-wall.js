/* ==========================================================================
   wall/video-wall.js — Video devor (Figma 04.01–04.07)
   --------------------------------------------------------------------------
   Vazifasi:
     Devor rejimi: toolbar (Guruh menyusi, setka 2×2/3×3/4×4 [+6×6, 8×8 TV'da],
     sifat Avto/Past/Yuqori, avto-aylanish + oraliq, Toʻliq ekran, sysbar),
     kataklar (wall/tile.js), footer ("7 / 9 onlayn", sahifalagich, keyingi
     sahifagacha teskari sanoq). Kataklarni sudrab tartiblash, ←/→ sahifalar,
     hover'da avto-aylanish pauzasi, keyingi sahifani oldindan ochish.
     Fokus rejimi (04.02) — wall/focus.js; Toʻliq ekran (04.05) — TV rejimi
     (rail yashirin, pastda "Sahifa 1 / 16 · keyingisi 8 s").

   Eksport:
     VideoWall           — klass: show(sub), hide(), build(), stop(), cams(), enterFocus(id),
                           exitFocus(), enterTv(), exitTv()
     videoWall           — yagona nusxa
     wallPlayers         — JONLI eksport (let): devordagi faol Player'lar (camera-list.js sanaydi)
     buildWall(sub?)     — sub berilsa (tabs show) — sahifani ochish; berilmasa (data.js,
                           har 30 s) — diff bilan yangilash
     stopWall()          — barcha oqimlarni to'xtatish (tab yopildi)
     saveSnapshot(cam)   — suratni .jpg qilib yuklab berish + toast 04.07 (selection.js ham)

   Bog'liqliklar:
     import: ../core/state.js, ../core/icons.js, ../core/ui.js, ../core/prefs.js,
             ../layout/tabs.js (setSub), ../layout/notifications.js (mountSysbar),
             ../map/camera-list.js (renderFootStats), ../map/groups.js (allGroups, groupById),
             ./tile.js, ./focus.js
   DOM: #wall-view, #wall-bar, #wall-group(-text), #wall-sizes, #wall-quality, #wall-auto,
        #wall-auto-label, #wall-interval, #wall-fs, #wall-sysbar, #wall-grid, #wall-foot,
        #wall-live, #wall-prev, #wall-next, #wall-page, #wall-upd, #wall-tvbar, #wall-tvtext
   Backend: GET /api/cameras/{id}/snapshot; oqim — Player (/api/cameras/{id}/stream?quality=sub|"")
   Prefs: "wall" — { size, quality, auto, interval, group ("" | "g:<id>" | "r:<hudud>"),
                     order: [kamera id...] (sudrab tartiblash), focus: id }
   Hodisalar: tinglaydi — "page:escape", "groups:changed", "prefs:loaded",
              "fullscreenchange", resize; chiqaradi — "camera:select" (Xaritada)

   Qoidalar / tuzoqlar:
     - build() DIFF qiladi: bor kataklar qayta ishlatiladi (oqim uzilmaydi).
     - Sifat "Avto": katak kengligi ≤ 480 px → sub, aks holda asosiy (Dev handoff §7).
       O'lcham o'zgarsa (resize, TV) kataklar kerak bo'lsa yangi oqimga o'tadi.
     - Fokusda devor kataklari to'xtatiladi (trafik), qaytganda sahifa o'sha.
     - Avto-aylanish taymeri 1 s lik tik: hover/sudrash paytida sanoq to'xtaydi;
       ma'lumot yangilanishi (build) sanoqni noldan boshlamaydi.
     - groups.js `openOnWall` state.wallGroup ni o'zi qo'yadi — show() uni prefs bilan
       ustidan yozmaydi, aksincha prefs'ga saqlaydi.
   ========================================================================== */
import { $, state, toast } from "../core/state.js";
import { hydrateIcons } from "../core/icons.js";
import { menu, onShortcut, emptyState, fmtTime, debounce } from "../core/ui.js";
import { prefs } from "../core/prefs.js";
import { setSub } from "../layout/tabs.js";
import { mountSysbar } from "../layout/notifications.js";
import { renderFootStats } from "../map/camera-list.js";
import { allGroups, groupById } from "../map/groups.js";
import { WallTile, isDown } from "./tile.js";
import { FocusView } from "./focus.js";

/* Jonli eksport — camera-list.js ochiq oqimlarni sanaydi. */
export let wallPlayers = [];

const SIZES = [2, 3, 4, 6, 8];
const INTERVALS = [8, 12, 20, 30];          // Figma: "interval Select’da: 8/12/20/30 s"
/* Katak shu kenglikdan (px) tor bo'lsa "Avto" past oqimni oladi. */
const SUB_MAX_CELL = 480;
/* Keyingi sahifa almashishdan shuncha oldin ko'rinmas joyda ochiladi
   (devorda o'lchangan ochilish 1,5–4,8 s). Oraliq qisqa bo'lsa — yarmi. */
const PRELOAD_LEAD_MS = 5000;
/* 6×6 va 8×8 — faqat keng (TV) ekranda; torroqda 4×4 gacha qisiladi. */
const TV_MIN_WIDTH = 1720;

/* Kamera suratini faylga saqlash (devor, Fokus va xarita paneli). Toast — 04.07. */
export async function saveSnapshot(cam) {
  try {
    const res = await fetch("/api/cameras/" + cam.id + "/snapshot", { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, "0");
    const name = String(cam.name).replace(/[^\w\-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") +
      "_" + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds()) + ".jpg";
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast("Surat saqlandi · " + name, {
      tone: "info", action: "Ochish", ms: 6000,
      onAction: () => window.open(url, "_blank", "noopener"),
    });
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  } catch (e) {
    toast("Surat olinmadi", { tone: "error" });
  }
}

/* ---------- Video devor ---------- */
export class VideoWall {
  constructor() {
    this.tiles = new Map();       // kamera id → WallTile (joriy sahifa)
    this.staged = new Map();      // keyingi sahifa: oldindan ochilgan, ko'rinmas kataklar
    this.order = [];              // sudrab tartiblangan kamera id lari
    this.focusId = null;
    this.tv = false;
    this.hover = false;
    this.dragId = null;
    this.remain = 0;              // keyingi sahifagacha (ms)
    this.tick = null;
    this.updatedAt = null;
    this.focus = new FocusView(this);

    this.loadPrefs();
    this.bindControls();
    mountSysbar($("wall-sysbar"), { flat: true });
  }

  /* ---------- Sozlamalar (prefs "wall") ---------- */
  loadPrefs() {
    const p = prefs.get("wall", {}) || {};
    if (SIZES.includes(Number(p.size))) state.wallSize = Number(p.size);
    if (["auto", "sub", "main"].includes(p.quality)) state.wallQuality = p.quality;
    state.wallAuto = !!p.auto;
    const iv = Number(p.interval);
    if (iv > 0) state.wallInterval = INTERVALS.reduce((a, b) => Math.abs(b - iv) < Math.abs(a - iv) ? b : a);
    if (typeof p.group === "string") {
      state.wallGroup = p.group.startsWith("g:") ? Number(p.group.slice(2)) : null;
      state.wallRegion = p.group.startsWith("r:") ? p.group.slice(2) : "";
    }
    this.order = Array.isArray(p.order) ? p.order.filter(Number.isInteger) : [];
    this.focusId = Number.isInteger(p.focus) ? p.focus : null;
  }

  groupKey() {
    return state.wallGroup != null ? "g:" + state.wallGroup : state.wallRegion ? "r:" + state.wallRegion : "";
  }

  savePrefs() {
    prefs.set("wall", {
      size: state.wallSize, quality: state.wallQuality, auto: state.wallAuto,
      interval: state.wallInterval, group: this.groupKey(), order: this.order, focus: this.focusId,
    });
  }

  rememberFocus(id) { this.focusId = id; this.savePrefs(); }

  /* ---------- Kameralar ---------- */
  /* Devorga tushadigan kameralar: guruh yoki hudud filtri; tartib — avval
     "Devorga qoʻshish" bilan biriktirilganlar, keyin sudrab saqlangan tartib.
     Uzilganlar ham ko'rsatiladi (Figma), o'chirilganlar — yo'q. */
  cams() {
    const ok = (c) => c && c.state !== "disabled" && !state.wallHidden.has(c.id);
    const g = state.wallGroup != null ? groupById(state.wallGroup) : null;
    const base = g ? g.camera_ids.map((id) => state.byId.get(id)).filter(ok)
      : state.cameras.filter((c) => ok(c) && (!state.wallRegion || c.region === state.wallRegion));
    return this.sorted(base);
  }

  sorted(list) {
    const ord = new Map(this.order.map((id, i) => [id, i]));
    const pin = new Map(state.pinned.map((id, i) => [id, i]));
    const key = (c, i) => pin.has(c.id) ? -1e6 + pin.get(c.id) : ord.has(c.id) ? ord.get(c.id) : 1e6 + i;
    return list.map((c, i) => [key(c, i), c]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  }

  /* Sudrab tartiblash: `fromId` ni `toId` o'rniga. Faqat ko'rinayotgan ro'yxat
     ichida joy almashadi — boshqa kameralarning global tartibi saqlanadi. */
  reorder(fromId, toId) {
    const list = this.cams().map((c) => c.id);
    const a = list.indexOf(fromId), b = list.indexOf(toId);
    if (a < 0 || b < 0 || a === b) return;
    list.splice(a, 1);
    list.splice(b, 0, fromId);
    const inList = new Set(list);
    let k = 0;
    this.order = this.sorted(state.cameras).map((c) => (inList.has(c.id) ? list[k++] : c.id));
    // Biriktirilganlik — faqat "oldinda turish"; endi o'rni tartibda saqlandi.
    state.pinned = state.pinned.filter((id) => !inList.has(id));
    this.savePrefs();
    this.build();
  }

  /* ---------- O'lchamlar ---------- */
  /* Ekran kengligiga qarab amaldagi setka: telefon — 1 ustun (2×2 sahifa),
     planshet — 2×2 gacha, TV'dan tor — 4×4 gacha. */
  effSize() {
    const w = innerWidth;
    if (w < 1024) return Math.min(state.wallSize, 2);
    if (w < TV_MIN_WIDTH && !this.tv) return Math.min(state.wallSize, 4);
    return state.wallSize;
  }

  isPhone() { return innerWidth <= 640; }

  slots() { const n = this.effSize(); return n * n; }

  pageCount(all) { return Math.max(1, Math.ceil(all.length / this.slots())); }

  pageCams(page, all = this.cams()) {
    const s = this.slots();
    const pages = this.pageCount(all);
    const p = ((page % pages) + pages) % pages;
    return all.slice(p * s, p * s + s);
  }

  /* Setka kamera soniga moslashadi (2 ta kamera 3×3 ga qisilmaydi). */
  layout(n) {
    const size = this.effSize();
    if (this.isPhone()) return { cols: 1, rows: Math.max(1, n) };
    const count = Math.max(1, n);
    let cols = Math.min(size, Math.ceil(Math.sqrt(count)));
    let rows = Math.min(size, Math.ceil(count / cols));
    // Ekran shakliga moslash: shu sondagi kameralar uchun 16:9 katak eng katta
    // chiqadigan ustunlar soni. Oddiy ekranda bu odatdagi N×N; eni uzun
    // monitorda (21:9, 32:9) 9 ta kamera 5×2 bo'lib, bo'sh yon joy qolmaydi.
    const grid = $("wall-grid");
    const W = grid && grid.clientWidth, H = grid && grid.clientHeight;
    if (W && H) {
      const gap = 8;
      const cell = (c, r) => Math.min((W - gap * (c - 1)) / c, ((H - gap * (r - 1)) / r) * 16 / 9);
      let best = cell(cols, rows);
      for (let c = 1; c <= count; c++) {
        const r = Math.ceil(count / c);
        const w = cell(c, r);
        if (w > best * 1.04) { best = w; cols = c; rows = r; }
      }
    }
    return { cols, rows };
  }

  streamQuality(cols) {
    if (state.wallQuality === "main") return "";
    if (state.wallQuality === "sub") return "sub";
    const grid = $("wall-grid");
    const gap = 8;
    const w = grid.clientWidth || (innerWidth - 136);
    return (w - gap * (cols - 1)) / cols <= SUB_MAX_CELL ? "sub" : "";
  }

  tileOpts() {
    return {
      onShot: (cam) => this.snapshot(cam),
      onMap: (cam) => this.showOnMap(cam),
      onFocus: (cam) => this.enterFocus(cam.id),
    };
  }

  snapshot(cam) { saveSnapshot(cam); }

  showOnMap(cam) {
    document.dispatchEvent(new CustomEvent("camera:select", { detail: { id: cam.id } }));
  }

  /* ---------- Sahifa ---------- */
  show(sub) {
    if (this.groupKey() !== ((prefs.get("wall", {}) || {}).group || "")) this.savePrefs();
    if (sub === "focus") {
      const all = this.cams();
      const id = [this.focusId, state.selectedId].find((x) => x != null && state.byId.has(x)) ??
        (all[0] && all[0].id);
      if (id != null) { this.enterFocus(id); return; }
    }
    if (this.focus.active) this.exitFocus(); else this.build();
  }

  hide() {
    if (this.tv) this.exitTv();
    this.focus.close();
    $("wall-focus").hidden = true;
    this.setGridMode(true);
    this.stop();
  }

  setGridMode(on) {
    ["wall-bar", "wall-grid", "wall-foot"].forEach((id) => { $(id).hidden = !on; });
    $("wall-view").classList.toggle("is-focus", !on);
  }

  /* ---------- Devorni qurish (diff) ---------- */
  build() {
    if (state.tab !== "wall") return;
    this.updatedAt = new Date();
    if (this.focus.active) { this.focus.refresh(); this.syncPlayers(); return; }
    this.paintControls();
    const all = this.cams();
    const pages = this.pageCount(all);
    state.wallPage = Math.min(Math.max(0, state.wallPage), pages - 1);
    const cams = this.pageCams(state.wallPage, all);

    const grid = $("wall-grid");
    const { cols, rows } = this.layout(cams.length);
    grid.style.setProperty("--wl-cols", cols);
    grid.style.setProperty("--wl-rows", rows);
    this.fitGrid();
    grid.classList.toggle("is-dense", this.effSize() >= 6);

    const want = new Set(cams.map((c) => c.id));
    this.tiles.forEach((t, id) => { if (!want.has(id)) { t.stop(); this.tiles.delete(id); } });
    const empty = grid.querySelector(".empty");
    if (empty) empty.remove();
    if (!cams.length) {
      grid.insertAdjacentHTML("beforeend", emptyState({
        type: "nodata", title: "Koʻrsatiladigan kamera yoʻq",
        text: "Boshqa guruh yoki hududni tanlang.",
      }));
      hydrateIcons(grid);
    }

    const quality = this.streamQuality(cols);
    cams.forEach((cam, i) => {
      let t = this.tiles.get(cam.id);
      let fromStage = false;
      if (!t) {
        const st = this.staged.get(cam.id);
        if (st && st.quality === quality) { this.staged.delete(cam.id); t = st; fromStage = true; }
        else { t = new WallTile(cam, this.tileOpts()); t.start(quality); }
        t.el.draggable = !this.isPhone();
        this.tiles.set(cam.id, t);
      } else {
        t.update(cam);
        t.setQuality(quality);
      }
      t.setSelected(cam.id === state.selectedId);
      if (grid.children[i] !== t.el) grid.insertBefore(t.el, grid.children[i] || null);
      // DOM'da ko'chirilgan <video> ni brauzer to'xtatadi — oqim tirik, davom ettiramiz.
      if (fromStage) t.q("video").play().catch(() => {});
    });

    const up = cams.filter((c) => !isDown(c) && c.state !== "stalled").length;
    $("wall-live").textContent = up + " / " + cams.length + " onlayn";
    $("wall-page").textContent = (state.wallPage + 1) + " / " + pages;
    $("wall-prev").disabled = pages < 2;
    $("wall-next").disabled = pages < 2;
    this.pages = pages;
    // Keyingi sahifaga tegishli bo'lmagan oldindan ochilganlar yopiladi.
    this.discardStaged(new Set(this.pageCams(state.wallPage + 1, all).map((c) => c.id)));
    this.syncPlayers();
    this.syncAuto();
  }

  syncPlayers() {
    const list = this.focus.active ? this.focus.players()
      : [...this.tiles.values()].filter((t) => t.player).map((t) => t.player);
    wallPlayers = list;
    renderFootStats();
  }

  paintControls() {
    const eff = this.effSize();
    document.querySelectorAll("#wall-sizes button").forEach((b) =>
      b.classList.toggle("is-on", Number(b.dataset.wsize) === eff));
    document.querySelectorAll("#wall-quality button").forEach((b) =>
      b.classList.toggle("is-on", b.dataset.wq === state.wallQuality));
    $("wall-auto").setAttribute("aria-checked", state.wallAuto ? "true" : "false");
    $("wall-interval").textContent = state.wallInterval + " s";
    $("wall-group-text").textContent = "Guruh: " + this.groupLabel();
  }

  groupLabel() {
    const g = state.wallGroup != null ? groupById(state.wallGroup) : null;
    if (state.wallGroup != null && !g && allGroups().length) state.wallGroup = null;
    if (g) return g.name;
    if (state.wallRegion) return state.wallRegion;
    return "Barcha kameralar";
  }

  goPage(d) {
    const pages = this.pageCount(this.cams());
    if (pages < 2) return;
    state.wallPage = (state.wallPage + d + pages) % pages;
    this.resetAuto();
    this.build();
  }

  /* ---------- Oldindan ochish (avto-aylanish) ---------- */
  stageBox() {
    let box = document.getElementById("wall-stage");
    if (!box) {
      box = document.createElement("div");
      box.id = "wall-stage";
      box.className = "wl-stage";
      box.setAttribute("aria-hidden", "true");
      document.body.appendChild(box);
    }
    return box;
  }

  preloadNext() {
    const all = this.cams();
    if (this.pageCount(all) < 2) return;
    const cams = this.pageCams(state.wallPage + 1, all);
    const quality = this.streamQuality(this.layout(cams.length).cols);
    const box = this.stageBox();
    cams.forEach((cam) => {
      if (this.tiles.has(cam.id) || this.staged.has(cam.id)) return;
      const t = new WallTile(cam, this.tileOpts());
      box.appendChild(t.el);
      t.start(quality);
      this.staged.set(cam.id, t);
    });
  }

  discardStaged(keep = new Set()) {
    this.staged.forEach((t, id) => {
      if (keep.has(id)) return;
      t.stop();
      this.staged.delete(id);
    });
  }

  /* ---------- Avto-aylanish ---------- */
  period() { return Math.max(5, state.wallInterval) * 1000; }

  resetAuto() { this.remain = this.period(); this.preloaded = false; }

  syncAuto() {
    const on = state.wallAuto && state.tab === "wall" && !this.focus.active && (this.pages || 1) >= 2;
    if (!on) {
      clearInterval(this.tick);
      this.tick = null;
      this.discardStaged();
      this.paintFoot();
      return;
    }
    if (!this.tick) {
      if (!this.remain) this.resetAuto();
      this.tick = setInterval(() => this.onTick(), 1000);
    }
    this.paintFoot();
  }

  paused() { return this.hover || this.dragId != null || document.hidden; }

  onTick() {
    if (!this.paused()) this.remain -= 1000;
    const lead = Math.min(PRELOAD_LEAD_MS, this.period() / 2);
    if (!this.preloaded && this.remain <= lead) { this.preloaded = true; this.preloadNext(); }
    if (this.remain <= 0) {
      const pages = this.pageCount(this.cams());
      state.wallPage = (state.wallPage + 1) % pages;
      this.resetAuto();
      this.build();
      return;
    }
    this.paintFoot();
  }

  paintFoot() {
    const upd = this.updatedAt ? "yangilandi " + fmtTime(this.updatedAt) : "";
    const auto = this.tick != null;
    const sec = Math.max(0, Math.ceil(this.remain / 1000));
    const next = !auto ? "" : this.paused() ? "Keyingi sahifa: pauza" : "Keyingi sahifa: " + sec + " s";
    $("wall-upd").textContent = [next, upd].filter(Boolean).join(" · ");
    $("wall-tvtext").textContent = "Sahifa " + (state.wallPage + 1) + " / " + (this.pages || 1) +
      (auto ? " · keyingisi " + (this.paused() ? "pauza" : sec + " s") : "");
  }

  /* ---------- Fokus ---------- */
  enterFocus(id) {
    if (state.tab !== "wall") return;
    if (!this.focus.active) {
      // Devor kataklari to'xtaydi — fokusda trafik bitta katta + 3 kichik oqim.
      this.tiles.forEach((t) => t.stop());
      this.tiles.clear();
      this.discardStaged();
      clearInterval(this.tick);
      this.tick = null;
      this.setGridMode(false);
      setSub("focus");
      this.focus.open(id);
    } else this.focus.show(id);
    this.syncPlayers();
  }

  exitFocus() {
    if (!this.focus.active) return;
    if (document.fullscreenElement && !this.tv) document.exitFullscreen().catch(() => {});
    this.focus.close();
    this.setGridMode(true);
    setSub("");
    this.build();
  }

  /* ---------- To'liq ekran (TV, 04.05) ---------- */
  enterTv() {
    if (this.tv) return;
    this.tv = true;
    document.body.classList.add("wl-tv");
    $("wall-tvbar").hidden = false;
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => {});
    requestAnimationFrame(() => this.build());
  }

  exitTv() {
    if (!this.tv) return;
    this.tv = false;
    document.body.classList.remove("wl-tv");
    $("wall-tvbar").hidden = true;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    requestAnimationFrame(() => this.build());
  }

  /* ---------- Guruh menyusi (04.06) ---------- */
  openGroupMenu(anchor) {
    const ok = (c) => c.state !== "disabled";
    const all = state.cameras.filter(ok);
    const regions = new Map();
    all.forEach((c) => regions.set(c.region, (regions.get(c.region) || 0) + 1));
    const cur = this.groupKey();
    const pick = (key) => () => {
      state.wallGroup = key.startsWith("g:") ? Number(key.slice(2)) : null;
      state.wallRegion = key.startsWith("r:") ? key.slice(2) : "";
      state.wallPage = 0;
      this.resetAuto();
      this.savePrefs();
      this.build();
    };
    const item = (key, label, n, ic) => ({
      label, kbd: String(n), icon: key === cur ? "check" : ic, on: key === cur, onClick: pick(key),
    });
    const items = [item("", "Barcha kameralar", all.length, "grid")];
    const groups = allGroups();
    if (groups.length) {
      items.push({ heading: "Guruhlar" });
      groups.forEach((g) => items.push(item("g:" + g.id, g.name,
        g.camera_ids.filter((id) => { const c = state.byId.get(id); return c && ok(c); }).length, "grid")));
    }
    if (regions.size) {
      items.push({ heading: "Hududlar" });
      [...regions.keys()].sort((a, b) => String(a).localeCompare(String(b), "uz"))
        .forEach((r) => items.push(item("r:" + r, r, regions.get(r), "location-pin")));
    }
    anchor.classList.add("is-open");
    $("wall-group-text").textContent = "Hududni tanlang";
    const el = menu(anchor, items, {
      place: "bottom-start", cls: "wl-menu", width: Math.max(260, anchor.offsetWidth + 20),
      onClose: () => { anchor.classList.remove("is-open"); this.paintControls(); },
    });
    if (!el) { anchor.classList.remove("is-open"); this.paintControls(); }
  }

  openIntervalMenu(anchor) {
    menu(anchor, INTERVALS.map((s) => ({
      label: s + " soniya", on: s === state.wallInterval,
      onClick: () => {
        state.wallInterval = s;
        if (!state.wallAuto) state.wallAuto = true;
        this.resetAuto();
        this.savePrefs();
        this.build();
      },
    })), { place: "bottom-start", cls: "wl-menu" });
  }

  /* ---------- To'xtatish ---------- */
  stop() {
    this.tiles.forEach((t) => t.stop());
    this.tiles.clear();
    this.discardStaged();
    this.focus.stop();
    clearInterval(this.tick);
    this.tick = null;
    this.remain = 0;
    wallPlayers = [];
    renderFootStats();
  }

  /* ---------- Boshqaruvlar ---------- */
  bindControls() {
    hydrateIcons($("wall-view"));
    document.querySelectorAll("#wall-sizes button").forEach((b) =>
      b.addEventListener("click", () => {
        state.wallSize = Number(b.dataset.wsize);
        state.wallPage = 0;
        this.resetAuto();
        this.savePrefs();
        this.build();
      }));
    document.querySelectorAll("#wall-quality button").forEach((b) =>
      b.addEventListener("click", () => {
        state.wallQuality = b.dataset.wq;
        this.savePrefs();
        this.build();
      }));
    $("wall-group").addEventListener("click", (e) => this.openGroupMenu(e.currentTarget));
    $("wall-auto").addEventListener("click", () => {
      state.wallAuto = !state.wallAuto;
      this.resetAuto();
      this.savePrefs();
      this.build();
    });
    $("wall-auto-label").addEventListener("click", (e) => this.openIntervalMenu(e.currentTarget));
    $("wall-fs").addEventListener("click", () => (this.tv ? this.exitTv() : this.enterTv()));
    $("wall-prev").addEventListener("click", () => this.goPage(-1));
    $("wall-next").addEventListener("click", () => this.goPage(1));

    const grid = $("wall-grid");
    // Hover — avto-aylanish pauzasi (Figma 04.01).
    grid.addEventListener("mouseenter", () => { this.hover = true; this.paintFoot(); });
    grid.addEventListener("mouseleave", () => { this.hover = false; this.paintFoot(); });
    // Katakni bosish yoki ikki marta bosish — Fokus.
    grid.addEventListener("click", (e) => {
      const el = e.target.closest(".wl-tile");
      if (el && !e.target.closest("button")) this.enterFocus(Number(el.dataset.id));
    });
    grid.addEventListener("keydown", (e) => {
      const el = e.target.closest && e.target.closest(".wl-tile");
      if (el && e.key === "Enter") this.enterFocus(Number(el.dataset.id));
    });
    // Sudrab tartiblash.
    grid.addEventListener("dragstart", (e) => {
      const el = e.target.closest(".wl-tile");
      if (!el) return;
      this.dragId = Number(el.dataset.id);
      el.classList.add("is-drag");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(this.dragId));
    });
    grid.addEventListener("dragover", (e) => {
      if (this.dragId == null) return;
      const el = e.target.closest(".wl-tile");
      e.preventDefault();
      grid.querySelectorAll(".is-drop").forEach((x) => { if (x !== el) x.classList.remove("is-drop"); });
      if (el && Number(el.dataset.id) !== this.dragId) el.classList.add("is-drop");
    });
    grid.addEventListener("drop", (e) => {
      if (this.dragId == null) return;
      e.preventDefault();
      const el = e.target.closest(".wl-tile");
      const from = this.dragId;
      this.endDrag();
      if (el) this.reorder(from, Number(el.dataset.id));
    });
    grid.addEventListener("dragend", () => this.endDrag());

    // ← / → : devorda — sahifa, Fokusda — kamera.
    const arrow = (d) => () => {
      if (state.tab !== "wall") return false;
      if (this.focus.active) this.focus.step(d); else this.goPage(d);
      return true;
    };
    onShortcut("ArrowLeft", arrow(-1));
    onShortcut("ArrowRight", arrow(1));
    document.addEventListener("page:escape", (e) => {
      if (state.tab !== "wall") return;
      if (this.tv) { this.exitTv(); e.preventDefault(); return; }
      if (this.focus.active) { this.exitFocus(); e.preventDefault(); }
    });
    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement && this.tv && this.tvNative) this.exitTv();
      this.tvNative = !!document.fullscreenElement && this.tv;
    });
    // Guruhlar o'zgarsa (yaratildi, a'zo qo'shildi) devor ham yangilansin.
    document.addEventListener("groups:changed", () => { if (state.tab === "wall") this.build(); });
    // Kirgandan keyin serverdagi afzalliklar keldi.
    document.addEventListener("prefs:loaded", () => { this.loadPrefs(); if (state.tab === "wall") this.build(); });
    addEventListener("resize", debounce(() => { if (state.tab === "wall") this.build(); }, 300));
    // Devor maydoni o'lchami o'zgarsa (oyna, TV rejimi, panel) — kataklar 16:9 da qoladi.
    if (window.ResizeObserver) new ResizeObserver(() => this.relayout()).observe($("wall-grid"));
  }

  /* Kataklar har doim 16:9: eni uzun monitorda (21:9, 32:9) devor bo'yi
     bo'yicha o'lchanadi va markazga qo'yiladi — kadr cho'zilib, yon tomondan
     kesilib ketmaydi. Telefonda (bir ustun) CSS o'zi 16:9 beradi. */
  /* O'lcham o'zgarganda: oqimlarni qayta ochmasdan ustun/qatorni va katak
     o'lchamini yangilash. */
  relayout() {
    const grid = $("wall-grid");
    if (!grid || !grid.clientWidth) return;
    const n = grid.querySelectorAll(":scope > .wl-tile").length;
    if (n) {
      const { cols, rows } = this.layout(n);
      grid.style.setProperty("--wl-cols", cols);
      grid.style.setProperty("--wl-rows", rows);
    }
    this.fitGrid();
  }

  fitGrid() {
    const grid = $("wall-grid");
    if (!grid || !grid.clientWidth) return;
    const cs = getComputedStyle(grid);
    const cols = Number(cs.getPropertyValue("--wl-cols")) || 1;
    const rows = Number(cs.getPropertyValue("--wl-rows")) || 1;
    const gap = parseFloat(cs.columnGap) || 0;
    const w = (grid.clientWidth - gap * (cols - 1)) / cols;
    const h = (grid.clientHeight - gap * (rows - 1)) / rows;
    const cw = Math.max(0, Math.floor(Math.min(w, h * 16 / 9)));
    grid.style.setProperty("--wl-cw", cw + "px");
    grid.style.setProperty("--wl-ch", Math.floor(cw * 9 / 16) + "px");
  }

  endDrag() {
    this.dragId = null;
    document.querySelectorAll("#wall-grid .is-drag, #wall-grid .is-drop")
      .forEach((x) => x.classList.remove("is-drag", "is-drop"));
  }
}

export const videoWall = new VideoWall();

/* sub berilsa — tabs.js sahifani ochdi; berilmasa — data.js yangilanishi. */
export function buildWall(sub) {
  if (sub === undefined) videoWall.build(); else videoWall.show(sub);
}
export function stopWall() { videoWall.hide(); }
