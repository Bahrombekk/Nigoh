/* ==========================================================================
   map/camera-list.js — Panel / Kameralar (Figma 02.01–02.04, 02.07–02.16)
   --------------------------------------------------------------------------
   Vazifasi:
     Xarita ustidagi suzuvchi panel (360px; 1280–1439 da 320; <1024 — overlay
     drawer; telefonda pastki varaq):
       * sarlavha "Oʻzbekiston xaritasi" + "Panelni yigʻish" (`?panel=closed`,
         prefs "panel");
       * SearchField ("/" — fokus, 300 ms): kamera nomi, km/piket, hudud.
         Natijalar guruhlangan (Kameralar · Km / piket · Hududlar), mos qism
         qalin + brand, ↑↓ tanlash, Enter — xaritada markazlash (02.04);
         natija yo'q — EmptyState (02.08);
       * Segmented Kameralar / Hududlar / Guruhlar (sonlar bilan);
       * FilterChip'lar Hammasi / Onlayn / Uzilgan / Tasvirsiz — ko'p tanlov,
         ro'yxat va xaritaga birga qo'llanadi (yagona son manbai);
       * "N HUDUD" + InfoTip + "Hammasini ochish"; RegionRow (uzilganlar ↓,
         chap nuqta — eng yomon holat) → ochiladi + fitBounds; CameraRow;
         "Belgilanmagan · koordinatasiz" guruhi;
       * footer "Yangilandi HH:MM:SS · har N s" (jonli nuqta; aloqa yo'q — qizil);
       * Skeleton (yuklash > 300 ms, 02.07), Alert "Server bilan aloqa yoʻq" +
         "Qayta urinish" (2 ketma-ket xato, 02.09).

   Eksport:
     CameraList, cameraList
     renderList(force), renderFootStats() (v2 mos — bo'sh), MOBILE,
     setListOpen(open), setQuery(v, now), renderStrip(), initCameraList()

   Bog'liqliklar:
     import: ../core/state.js, ../core/prefs.js, ../core/icons.js, ../core/ui.js,
             ./map.js (mapView, visibleCams), ./util.js, ./selection.js (selectCamera, openCard),
             ../player/player.js (prewarm), ../layout/notifications.js (renderBell),
             ../layout/tabs.js (showTab), ./groups.js (renderGroupList, togglePick, groupStore),
             ../core/data.js (refreshStatus) — "Qayta urinish"
   Hodisalar: "cameras:status" (data.js), "map:hover" (map.js), "groups:changed"

   Qoidalar / tuzoqlar:
     - 5000+ kamerada qotmasligi uchun: imzo (sig) o'zgarmasa qayta chizilmaydi;
       yopiq hudud qatorlari faqat ochilganda yaratiladi; natijalar 60 tagacha.
     - Konstruktor DOM ga tegmaydi — init() page.js dan (aylanma importlar).
   ========================================================================== */
import { $, esc, state } from "../core/state.js";
import { prefs } from "../core/prefs.js";
import { icon, hydrateIcons } from "../core/icons.js";
import { emptyState, infotip, onShortcut, tooltip } from "../core/ui.js";
import { mapView, visibleCams } from "./map.js";
import { NOGEO, STATUS_LABEL, camMeta, camStatus, getParam, hasGeo, highlight, hms, norm,
         regionKey, setParam, worstStatus } from "./util.js";
import { openCard, selectCamera } from "./selection.js";
import { prewarm } from "../player/player.js";
import { renderBell } from "../layout/notifications.js";
import { showTab } from "../layout/tabs.js";
import { groupStore, renderGroupList, togglePick } from "./groups.js";
import { refreshStatus } from "../core/data.js";

/* Tor ekran (<1024): panel va drawer xarita ustida overlay. */
export const MOBILE = window.matchMedia("(max-width:1023px)");
const PHONE = window.matchMedia("(max-width:640px)");

const CHIPS = [
  { key: "", label: "Hammasi" },
  { key: "online", label: "Onlayn" },
  { key: "offline", label: "Uzilgan" },
  { key: "no-video", label: "Tasvirsiz" },
];
const RES_LIMIT = 60;

export class CameraList {
  constructor() {
    this.lastSig = "";
    this.qTimer = null;
    this.focus = null;          // ochilgan hudud konteksti ("JIZZAX · 36 KAMERA")
    this.nav = -1;              // qidiruv natijalarida ↑↓ tanlangan qator
    this.ready = false;
    this.collapsed = false;
    state.filters = state.filters || new Set();
    state.listView = state.listView || "cams";
  }

  init() {
    if (this.ready) return;
    this.ready = true;
    const input = $("q-list");
    input.addEventListener("input", () => this.setQuery(input.value));
    input.addEventListener("keydown", (e) => this.onSearchKey(e));
    $("mp-search-clear").addEventListener("click", () => { this.setQuery("", true); input.focus(); });

    $("mp-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-lview]");
      if (b) this.setView(b.dataset.lview);
    });
    $("mp-chips").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-f]");
      if (!b) return;
      if (b.dataset.f === "group") { groupStore.setFilter(null); return; }
      this.toggleFilter(b.dataset.f);
    });
    $("mp-listhead").addEventListener("click", (e) => this.onHeadClick(e));
    $("list-body").addEventListener("click", (e) => this.onBodyClick(e));
    $("list-body").addEventListener("change", (e) => this.onBodyChange(e));
    $("list-body").addEventListener("mouseover", (e) => {
      const row = e.target.closest("[data-id]");
      const id = row ? Number(row.dataset.id) : null;
      if (id === this.hoverId) return;
      this.hoverId = id;
      mapView.setHover(id);
      // Uzilgan kamerani uyg'otish befoyda (snapshot 404, oqim ochilmaydi).
      if (id != null) { const c = state.byId.get(id); if (c && camStatus(c) !== "offline") prewarm(c); }
    });
    $("list-body").addEventListener("mouseleave", () => { this.hoverId = null; mapView.setHover(null); });
    document.addEventListener("map:hover", (e) => {
      $("list-body").querySelectorAll(".mp-crow.is-hover").forEach((r) => r.classList.remove("is-hover"));
      const id = e.detail.id;
      if (id == null) return;
      const row = $("list-body").querySelector('.mp-crow[data-id="' + id + '"]');
      if (row) row.classList.add("is-hover");
    });

    $("mp-collapse").addEventListener("click", () => this.setCollapsed(!this.collapsed, true));
    $("mp-expand").addEventListener("click", () => this.setCollapsed(false, true));
    $("mp-scrim").addEventListener("click", () => this.setCollapsed(true, false));
    $("mp-alert-retry").addEventListener("click", () => {
      $("mp-alert-retry").disabled = true;
      refreshStatus(true).finally(() => { $("mp-alert-retry").disabled = false; });
    });

    document.addEventListener("cameras:status", () => { this.renderFoot(); this.renderAlert(); });
    document.addEventListener("groups:changed", () => this.render(true));
    setInterval(() => { if (state.tab === "map" && !document.hidden) this.renderFoot(); }, 15000);

    onShortcut("/", () => {
      if (state.tab !== "map") return false;
      this.setCollapsed(false, false);
      input.focus();
      input.select();
    });

    // Boshlang'ich holat: ?panel=closed yoki saqlangan tanlov (≥1024).
    const closed = getParam("panel") === "closed" || (!getParam("panel") && prefs.get("panel") === "closed");
    this.setCollapsed(MOBILE.matches ? true : closed, false);
    MOBILE.addEventListener("change", () => this.setCollapsed(MOBILE.matches ? true : prefs.get("panel") === "closed", false));

    // 02.07 — ma'lumot 300 ms da kelmasa skeleton.
    setTimeout(() => { if (!state.camsLoaded) this.renderSkeleton(); }, 300);
    this.renderFoot();
    hydrateIcons($("mp-panel"));
  }

  /* ---------- holat ---------- */
  setView(v) {
    state.listView = v;
    this.focus = null;
    mapView.setFocusRegion(null);
    this.render(true);
  }

  toggleFilter(f) {
    const set = state.filters;
    if (!f) set.clear();
    else if (set.has(f)) set.delete(f);
    else set.add(f);
    // Hammasi tanlangandek bo'lsa — filtrsiz.
    if (set.size >= 3) set.clear();
    this.render(true);
    mapView.rebuildMarkers();
  }

  setCollapsed(c, persist) {
    this.collapsed = !!c;
    const view = $("map-view");
    view.classList.toggle("mp-collapsed", this.collapsed);
    $("mp-collapse").dataset.tip = this.collapsed && PHONE.matches ? "Panelni ochish" : "Panelni yigʻish";
    $("mp-collapse").setAttribute("aria-label", $("mp-collapse").dataset.tip);
    $("mp-collapse").setAttribute("aria-expanded", String(!this.collapsed));
    state.listOpen = !this.collapsed;
    if (persist && !MOBILE.matches) {
      prefs.set("panel", this.collapsed ? "closed" : "open");
      setParam("panel", this.collapsed ? "closed" : null);
    }
  }

  setOpen(open) { this.setCollapsed(!open, false); }

  setQuery(v, now) {
    state.q = v;
    const input = $("q-list");
    if (input && input.value !== v) input.value = v;
    if ($("mp-search")) $("mp-search").classList.toggle("is-filled", !!v);
    clearTimeout(this.qTimer);
    const run = () => { this.nav = -1; this.render(true, true); };
    if (now) run(); else this.qTimer = setTimeout(run, 300);
  }

  onSearchKey(e) {
    if (e.key === "Escape" && e.target.value) { e.stopPropagation(); e.preventDefault(); this.setQuery("", true); return; }
    if (!state.q.trim()) return;
    const rows = [...$("list-body").querySelectorAll("[data-nav]")];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!rows.length) return;
      e.preventDefault();
      this.nav = e.key === "ArrowDown" ? Math.min(rows.length - 1, this.nav + 1) : Math.max(0, this.nav - 1);
      rows.forEach((r, i) => r.classList.toggle("is-active", i === this.nav));
      rows[this.nav].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(this.qTimer);
      if (this.pendingQ !== state.q) this.render(true, true);
      const list = [...$("list-body").querySelectorAll("[data-nav]")];
      const row = list[Math.max(0, this.nav)];
      if (row) this.activateResult(row, true);
    }
  }

  /* ---------- chizish ---------- */
  render(force, searchChanged) {
    if (!this.ready || !state.camsLoaded) return;
    const q = state.q.trim();
    const sig = [state.listView, q, [...state.filters].join(","), state.groupFilter, state.pickMode,
      state.pickIds ? state.pickIds.size : 0, groupStore.groups.length,
      state.cameras.map((c) => c.id + camStatus(c)[1]).join("")].join("|");
    if (!force && sig === this.lastSig) { this.syncSel(); return; }
    this.lastSig = sig;
    this.renderTabs();
    this.renderChips(!!q);
    if (q) this.renderResults(q, searchChanged !== false && this.pendingQ !== q);
    else {
      if (this.pendingQ) mapView.setSearch(null);
      if (state.listView === "regs") this.renderRegions();
      else if (state.listView === "grps") renderGroupList($("list-body"), $("mp-listhead"));
      else this.renderCams();
    }
    this.pendingQ = q;
    hydrateIcons($("mp-panel"));
    tooltip.label($("mp-panel"));
  }

  syncSel() {
    $("list-body").querySelectorAll(".mp-crow").forEach((row) =>
      row.classList.toggle("is-sel", Number(row.dataset.id) === state.selectedId));
  }

  renderTabs() {
    const cams = visibleCams();
    const regs = new Set(cams.map(regionKey)).size;
    const n = { cams: cams.length, regs, grps: state.admin ? groupStore.groups.length : null };
    $("mp-tabs").querySelectorAll("button").forEach((b) => {
      const v = b.dataset.lview;
      b.classList.toggle("is-on", v === state.listView);
      b.setAttribute("aria-selected", String(v === state.listView));
      const c = b.querySelector(".seg__count");
      if (c) c.textContent = n[v] == null ? "" : n[v];
    });
  }

  renderChips(hidden) {
    const box = $("mp-chips");
    box.hidden = hidden;
    $("mp-divider").hidden = false;
    const group = state.groupMembers;
    const base = group ? state.cameras.filter((c) => group.has(c.id)) : state.cameras;
    const cnt = { "": base.length, online: 0, offline: 0, "no-video": 0 };
    base.forEach((c) => { const s = camStatus(c); if (cnt[s] != null) cnt[s]++; });
    let html = CHIPS.map(({ key, label }) => {
      const on = key ? state.filters.has(key) : !state.filters.size;
      return '<button class="chip' + (on ? " is-on" : "") + '" data-f="' + key + '" aria-pressed="' + on + '">' +
        (key ? '<span class="dot" data-status="' + key + '"></span>' : "") + label +
        ' <span class="chip__count">' + cnt[key] + "</span></button>";
    }).join("");
    const g = state.groupFilter != null && groupStore.byId.get(state.groupFilter);
    if (g) {
      html += '<button class="chip is-on mp-chip-group" data-f="group" data-tip="Guruh filtrini olib tashlash">' +
        '<span class="dot" style="background:' + esc(g.color || "var(--color-bg-brand)") + '"></span>' +
        '<span class="ellipsis">' + esc(g.name) + "</span>" + icon("xmark", "xs") + "</button>";
    }
    box.innerHTML = html;
  }

  head(title, tip, btn) {
    $("mp-listhead").innerHTML = '<span class="overline">' + esc(title) + "</span>" + (tip ? infotip(tip) : "") +
      '<span class="spacer"></span>' + (btn || "");
  }

  /* Hududlar bo'yicha guruhlash: uzilganlar soni ↓, keyin jami ↓; koordinatasizlar oxirida. */
  groupByRegion(cams) {
    const by = new Map();
    cams.forEach((c) => {
      const k = regionKey(c);
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(c);
    });
    const list = [...by.entries()].map(([key, items]) => {
      const n = { online: 0, offline: 0, "no-video": 0 };
      items.forEach((c) => { const s = camStatus(c); if (n[s] != null) n[s]++; });
      return { key, name: key === NOGEO ? "Belgilanmagan" : key, items, n, worst: worstStatus(items) };
    });
    list.sort((a, b) => (a.key === NOGEO) - (b.key === NOGEO) || b.n.offline - a.n.offline ||
      b.n["no-video"] - a.n["no-video"] || b.items.length - a.items.length || a.name.localeCompare(b.name));
    return list;
  }

  counts(n) {
    return '<span class="mp-counts">' +
      '<span class="badge badge--count" data-status="online" data-tip="Onlayn">' + n.online + "</span>" +
      (n["no-video"] ? '<span class="badge badge--count" data-status="no-video" data-tip="Tasvirsiz">' + n["no-video"] + "</span>" : "") +
      (n.offline ? '<span class="badge badge--count" data-status="offline" data-tip="Uzilgan">' + n.offline + "</span>" : "") +
      "</span>";
  }

  regionMeta(r) {
    return r.items.length + " kamera" + (r.key === NOGEO ? " · koordinatasiz" : "");
  }

  renderCams() {
    const regions = this.groupByRegion(visibleCams());
    this.regionsCache = regions;
    const focus = this.focus && regions.find((r) => r.key === this.focus && state.openRegions[r.key]);
    if (focus) {
      this.head(focus.name + " · " + focus.items.length + " kamera",
        "Hudud ichidagi kameralar. Qator bosilsa — xaritada markazlanadi va tafsilotlar ochiladi.",
        '<button class="btn btn--tertiary btn--sm" data-act="all-regions">Barcha hududlar</button>');
    } else {
      const anyClosed = regions.some((r) => !state.openRegions[r.key]);
      this.head(regions.length + " hudud",
        "Hududlar uzilganlar soni boʻyicha saralangan. Chap nuqta — hududdagi eng yomon holat.",
        regions.length ? '<button class="btn btn--tertiary btn--sm" data-act="expand">' +
          (anyClosed ? "Hammasini ochish" : "Hammasini yopish") + "</button>" : "");
    }
    const body = $("list-body");
    if (!regions.length) { body.innerHTML = this.emptyFilter(); return; }
    body.innerHTML = regions.map((r) => {
      const open = !!state.openRegions[r.key];
      const pickAll = state.pickMode ? r.items.every((c) => state.pickIds.has(c.id)) : false;
      return '<div class="mp-reg' + (open ? " is-open" : "") + (focus && focus.key === r.key ? " is-sel" : "") +
        '" data-key="' + esc(r.key) + '">' +
        '<div class="mp-reg__head">' +
          (state.pickMode ? '<input type="checkbox" class="check mp-reg__pick" data-pickreg="' + esc(r.key) + '"' +
            (pickAll ? " checked" : "") + ' aria-label="Hududdagi hammasini belgilash">' : "") +
          '<button class="mp-rrow" data-act="toggle" aria-expanded="' + open + '">' +
            '<span class="mp-rrow__chev">' + icon("chevron-right", "sm") + "</span>" +
            '<span class="dot" data-status="' + r.worst + '"></span>' +
            '<span class="mp-rrow__txt"><span class="label-md ellipsis mp-rrow__name">' + esc(r.name) + "</span>" +
              '<span class="body-xs t-tertiary">' + esc(this.regionMeta(r)) + "</span></span>" +
            this.counts(r.n) +
          "</button></div>" +
        '<div class="mp-cams">' + (open ? this.camRows(r.items) : "") + "</div></div>";
    }).join("");
  }

  camRows(items) {
    return items.map((c) => {
      const st = camStatus(c);
      const meta = camMeta(c);
      const picked = state.pickMode && state.pickIds.has(c.id);
      return '<button class="mp-crow' + (c.id === state.selectedId ? " is-sel" : "") + (picked ? " is-picked" : "") +
        '" data-id="' + c.id + '"' + (c.state_reason ? ' data-tip="' + esc(c.state_reason) + '"' : "") + ">" +
        (state.pickMode ? '<span class="mp-crow__pick" aria-hidden="true">' + icon("check", "xs") + "</span>" : "") +
        '<span class="dot" data-status="' + st + '" aria-label="' + STATUS_LABEL[st] + '"></span>' +
        '<span class="label-sm ellipsis mp-crow__name">' + esc(c.name) + "</span>" +
        '<span class="mono-xs mp-crow__meta' + (meta.bad ? " t-error" : meta.warn ? " t-warning" : "") + '">' +
        esc(meta.text) + "</span></button>";
    }).join("");
  }

  renderRegions() {
    const regions = this.groupByRegion(visibleCams());
    this.regionsCache = regions;
    this.head(regions.length + " hudud", "Hudud bosilsa — xarita shu hududga yaqinlashadi. Saralash: uzilganlar soni boʻyicha.");
    const body = $("list-body");
    if (!regions.length) { body.innerHTML = this.emptyFilter(); return; }
    body.innerHTML = regions.map((r) => {
      const pct = r.items.length ? Math.round((r.n.online / r.items.length) * 100) : 0;
      return '<button class="mp-rrow mp-rrow--flat' + (this.focus === r.key ? " is-sel" : "") + '" data-act="fly" data-key="' + esc(r.key) + '">' +
        '<span class="dot" data-status="' + r.worst + '"></span>' +
        '<span class="mp-rrow__txt"><span class="label-md ellipsis mp-rrow__name">' + esc(r.name) + "</span>" +
          '<span class="body-xs t-tertiary">' + esc(this.regionMeta(r)) + " · " + pct + "% onlayn</span></span>" +
        this.counts(r.n) + icon("chevron-right", "sm", "mp-rrow__go") + "</button>";
    }).join("");
  }

  emptyFilter() {
    return emptyState({ type: "filter", title: "Hech narsa topilmadi", text: "Tanlangan filtrga mos kamera yoʻq",
      action: "Filtrlarni tozalash", id: "mp-clear-filters" });
  }

  /* ---------- 02.04 qidiruv natijalari ---------- */
  renderResults(q, fit) {
    const qn = norm(q);
    const cams = visibleCams();
    const camHits = cams.filter((c) => norm(c.name).includes(qn) || (c.km != null && String(c.km).includes(qn)));
    const kmMap = new Map();
    cams.forEach((c) => {
      if (c.km == null || !String(c.km).includes(qn)) return;
      const k = String(c.km);
      if (!kmMap.has(k)) kmMap.set(k, []);
      kmMap.get(k).push(c);
    });
    const regions = this.groupByRegion(cams).filter((r) => norm(r.name).includes(qn));
    const ids = new Set(camHits.map((c) => c.id));
    kmMap.forEach((l) => l.forEach((c) => ids.add(c.id)));
    regions.forEach((r) => r.items.forEach((c) => ids.add(c.id)));
    this.results = { kmMap, regions };
    const total = camHits.length + kmMap.size + regions.length;
    mapView.setSearch(ids, fit && ids.size > 0);

    const body = $("list-body");
    if (!total) {
      $("mp-listhead").innerHTML = "";
      $("mp-divider").hidden = true;
      body.innerHTML = emptyState({ type: "search", title: "Hech narsa topilmadi",
        text: "“" + q + "” boʻyicha kamera, km yoki hudud yoʻq", action: "Qidiruvni tozalash", id: "mp-clear-q" });
      return;
    }
    this.head(total + " natija", "Mos qism ajratib koʻrsatiladi. ↑↓ — tanlash, Enter — xaritada markazlash.");
    let html = "";
    if (camHits.length) {
      html += '<div class="overline mp-res__h">Kameralar · ' + camHits.length + "</div>";
      html += camHits.slice(0, RES_LIMIT).map((c) => {
        const st = camStatus(c);
        const meta = camMeta(c);
        return '<button class="mp-crow mp-crow--res' + (c.id === state.selectedId ? " is-sel" : "") +
          '" data-nav data-id="' + c.id + '">' +
          '<span class="dot" data-status="' + st + '"></span>' +
          '<span class="label-sm ellipsis mp-crow__name">' + highlight(c.name, q) + "</span>" +
          '<span class="mono-xs mp-crow__meta ellipsis' + (meta.bad ? " t-error" : meta.warn ? " t-warning" : "") + '">' +
          esc([c.region, meta.text].filter(Boolean).join(" · ")) + "</span></button>";
      }).join("");
      if (camHits.length > RES_LIMIT) {
        html += '<div class="body-xs t-tertiary mp-res__more">va yana ' + (camHits.length - RES_LIMIT) + " ta — qidiruvni aniqlashtiring</div>";
      }
    }
    if (kmMap.size) {
      html += '<div class="overline mp-res__h">Km / piket · ' + kmMap.size + "</div>";
      html += [...kmMap.entries()].slice(0, RES_LIMIT).map(([km, list]) => {
        const regs = [...new Set(list.map((c) => c.region))].join(", ");
        return '<button class="mp-crow mp-crow--res mp-crow--plain" data-nav data-km="' + esc(km) + '">' +
          '<span class="label-sm ellipsis mp-crow__name">' + highlight(km + " km", q) + "</span>" +
          '<span class="mono-xs mp-crow__meta ellipsis">' + esc(regs + " · " + list.length + " kamera") + "</span></button>";
      }).join("");
    }
    if (regions.length) {
      html += '<div class="overline mp-res__h">Hududlar · ' + regions.length + "</div>";
      html += regions.map((r) =>
        '<button class="mp-crow mp-crow--res mp-crow--plain" data-nav data-reg="' + esc(r.key) + '">' +
          '<span class="dot" data-status="' + r.worst + '"></span>' +
          '<span class="label-sm ellipsis mp-crow__name">' + highlight(r.name, q) + "</span>" +
          '<span class="mono-xs mp-crow__meta">' + esc(this.regionMeta(r)) + "</span></button>").join("");
    }
    body.innerHTML = html;
    const first = body.querySelector("[data-nav]");
    if (first && this.nav < 0) { first.classList.add("is-active"); this.nav = 0; }
  }

  activateResult(row, enter) {
    if (row.dataset.id) {
      const id = Number(row.dataset.id);
      const cam = state.byId.get(id);
      if (!cam) return;
      if (enter && hasGeo(cam)) {
        // Enter → xaritada markazlash + kichik karta.
        mapView.map.flyTo([cam.lat, cam.lng], Math.max(mapView.map.getZoom(), 15), { duration: 0.5 });
        mapView.map.once("moveend", () => mapView.reveal(id, () => openCard(id)));
        if (MOBILE.matches) this.setCollapsed(true, false);
      } else selectCamera(id, true);
    } else if (row.dataset.km) {
      mapView.fitCams(this.results.kmMap.get(row.dataset.km) || [], { zoom: 15 });
    } else if (row.dataset.reg) {
      const r = this.results.regions.find((x) => x.key === row.dataset.reg);
      if (r) this.flyToRegion(r);
    }
  }

  /* ---------- hodisalar ---------- */
  onHeadClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    if (act === "expand") {
      const regions = this.regionsCache || [];
      const anyClosed = regions.some((r) => !state.openRegions[r.key]);
      regions.forEach((r) => { state.openRegions[r.key] = anyClosed; });
      this.focus = null;
      mapView.setFocusRegion(null);
      this.render(true);
    } else if (act === "all-regions") {
      this.focus = null;
      Object.keys(state.openRegions).forEach((k) => { state.openRegions[k] = false; });
      mapView.setFocusRegion(null);
      mapView.fitCams(visibleCams());
      this.render(true);
    } else if (groupStore.onHeadAction) groupStore.onHeadAction(act, b);
  }

  onBodyClick(e) {
    const t = e.target;
    if (t.closest("#mp-clear-q")) { this.setQuery("", true); $("q-list").focus(); return; }
    if (t.closest("#mp-clear-filters")) { state.filters.clear(); if (state.groupFilter != null) groupStore.setFilter(null); this.render(true); mapView.rebuildMarkers(); return; }
    if (t.closest(".mp-reg__pick")) return;            // change hodisasida
    const nav = t.closest("[data-nav]");
    if (nav) { this.activateResult(nav, false); return; }
    const row = t.closest(".mp-crow[data-id]");
    if (row) {
      const id = Number(row.dataset.id);
      if (state.pickMode) {
        togglePick(id);
        row.classList.toggle("is-picked", state.pickIds.has(id));
        return;
      }
      selectCamera(id, true);
      return;
    }
    const act = t.closest("[data-act]");
    if (!act) return;
    if (act.dataset.act === "toggle") {
      const key = act.closest(".mp-reg").dataset.key;
      const open = !state.openRegions[key];
      state.openRegions[key] = open;
      const r = (this.regionsCache || []).find((x) => x.key === key);
      if (open && r) {
        this.focus = key;
        this.flyToRegion(r);
      } else if (this.focus === key) {
        this.focus = null;
        mapView.setFocusRegion(null);
      }
      this.render(true);
    } else if (act.dataset.act === "fly") {
      const r = (this.regionsCache || []).find((x) => x.key === act.dataset.key);
      if (r) { this.focus = r.key; this.flyToRegion(r); this.render(true); }
    } else if (groupStore.onBodyAction) groupStore.onBodyAction(act.dataset.act, act, e);
  }

  onBodyChange(e) {
    const cb = e.target.closest(".mp-reg__pick");
    if (!cb) return;
    const r = (this.regionsCache || []).find((x) => x.key === cb.dataset.pickreg);
    if (!r) return;
    const all = r.items.every((c) => state.pickIds.has(c.id));
    r.items.forEach((c) => { if (all === state.pickIds.has(c.id)) togglePick(c.id); });
    state.openRegions[r.key] = true;
    this.render(true);
  }

  flyToRegion(r) {
    const items = r.items || [];
    if (r.key !== NOGEO) mapView.setFocusRegion(r.name);
    if (!mapView.fitCams(items)) return;
    if (MOBILE.matches && !PHONE.matches) this.setCollapsed(true, false);
  }

  /* ---------- skeleton, footer, alert ---------- */
  renderSkeleton() {
    $("mp-chips").innerHTML = [0, 1, 2].map(() => '<span class="skeleton mp-sk-chip"></span>').join("");
    this.head("Hududlar", "Hududlar uzilganlar soni boʻyicha saralangan.",
      '<button class="btn btn--tertiary btn--sm" disabled>Hammasini ochish</button>');
    const op = [1, 0.88, 0.76, 0.64, 0.52, 0.4];
    $("list-body").innerHTML = op.map((o, i) =>
      '<div class="mp-sk-row" style="opacity:' + o + '"><span class="skeleton mp-sk-dot"></span>' +
      '<span class="mp-sk-lines"><span class="skeleton" style="width:' + (120 + (i * 23) % 40) + 'px;height:12px"></span>' +
      '<span class="skeleton" style="width:80px;height:10px"></span></span>' +
      '<span class="skeleton mp-sk-pill"></span></div>').join("");
    hydrateIcons($("mp-panel"));
  }

  renderFoot() {
    const foot = $("mp-foot");
    if (!foot) return;
    const every = state.pollS || 30;
    const fails = state.pollFails || 0;
    let dot, text;
    if (!state.camsLoaded) { dot = "unknown"; text = "Yuklanmoqda…"; }
    else if (fails >= 2) { dot = "offline"; text = "Ulanish yoʻq · oxirgi " + (state.camsAt ? hms(state.camsAt) : "—"); }
    else { dot = "online"; text = "Yangilandi " + (state.camsAt ? hms(state.camsAt) : "—") + " · har " + every + " s"; }
    foot.innerHTML = '<span class="mp-foot__dot' + (dot === "online" ? " pulse" : "") + '" data-status="' + dot + '"></span>' +
      '<span class="body-xs t-tertiary">' + esc(text) + "</span>" +
      infotip("Holat har " + every + " soniyada yangilanadi (Sozlamalar → Kuzatuv). Aloqa uzilsa nuqta qizil boʻladi.");
    tooltip.label(foot);
  }

  renderAlert() {
    const bad = (state.pollFails || 0) >= 2;
    $("mp-alert").hidden = !bad;
    if (bad) $("mp-alert-text").textContent = "Maʼlumotlar " + (state.camsAt ? hms(state.camsAt) : "—") + " holatida";
    mapView.setStale(bad);
  }

  renderFootStats() { /* v2 mosligi: pastki statistika olib tashlangan (Figma footer) */ }

  renderStrip() { renderBell(); }
}

export const cameraList = new CameraList();

export function initCameraList() { cameraList.init(); }
export function renderList(force) { cameraList.render(force); }
export function renderFootStats() { cameraList.renderFootStats(); }
export function setListOpen(open) { cameraList.setOpen(open); }
export function setQuery(v, now) {
  if (state.tab !== "map") showTab("map");
  cameraList.setCollapsed(false, false);
  cameraList.setQuery(v, now);
}
export function renderStrip() { cameraList.renderStrip(); }
