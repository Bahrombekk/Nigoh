/* ==========================================================================
   map/groups.js — foydalanuvchi kamera guruhlari
   --------------------------------------------------------------------------
   Vazifasi:
     Foydalanuvchi o'ziga kerakli kameralarni tanlab, nom berib saqlaydi
     (GET/POST/PATCH/DELETE /api/groups). Guruh:
       * xaritada va ro'yxatda filtr (state.groupFilter — map.js visibleCams);
       * chap ro'yxatda "Guruhlar" ko'rinishi (renderGroupList);
       * kamera panelida "Guruhlar" qatori (renderCamGroups);
       * video devorda to'plam (wall/video-wall.js — groupById).
     Kameralar uch yo'l bilan qo'shiladi: ro'yxatda "Tanlash" rejimi
     (state.pickMode / state.pickIds), panel qatoridagi "+" va xaritada
     soha chizish (lasso). Devordan — "guruh sifatida saqlash".

   Eksport:
     GroupStore           — klass: load, setFilter, openPicker, openEditor,
                            renderGroupList, renderCamGroups, lasso, init
     groupStore           — yagona nusxa
     initGroups()         — tugmalarni ulash (main.js dan, modullar yuklangach)
     loadGroups()         — serverdan qayta o'qish (kirgandan keyin)
     groupById(id)        — guruh obyekti yoki undefined
     openGroupPicker(ids, title) — kameralarni guruhga qo'shish oynasi
     renderGroupList()    — ro'yxatdagi "Guruhlar" ko'rinishi
     renderCamGroups(cam) — panel qatori
     togglePick(id)       — tanlash rejimida kamerani belgilash/olib tashlash
     GROUP_COLORS         — rang palitrasi

   Bog'liqliklar:
     import: ../core/state.js, ../core/api.js, ../core/modals.js,
             ./map.js (map, hasGeo, rebuildMarkers, visibleCams),
             ./camera-list.js (renderList), ../layout/tabs.js (showTab)
     global: L (polyline/polygon, latLngBounds)

   DOM: #group-modal, #gm-*, #map-groups (xarita pastidagi filtr chizig'i),
        #sel-mode, #pick-bar*, #lasso-btn,
        #lasso-hint, #sel-f-groups, .lh-tabs [data-lview="grps"]
   Backend: GET /api/groups, POST /api/groups, PATCH/DELETE /api/groups/{id},
            POST /api/groups/{id}/cameras {camera_ids, mode}

   Qoidalar / tuzoqlar:
     - Faqat kirgan foydalanuvchi uchun so'raladi: api() 401 da kirish
       oynasini ochadi — mehmonga keraksiz oyna chiqmasin (state.admin).
     - Tugmalar init() da ulanadi (import paytida emas): camera-list.js bilan
       aylanma import bor.
     - Lasso paytida xarita surilmaydi (dragging o'chiriladi), tugagach tiklanadi.
   ========================================================================== */
import { $, esc, state, toast } from "../core/state.js";
import { api } from "../core/api.js";
import { closeModal, openModal } from "../core/modals.js";
import { hasGeo, map, rebuildMarkers, visibleCams } from "./map.js";
import { renderList } from "./camera-list.js";
import { showTab } from "../layout/tabs.js";

export const GROUP_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444",
                             "#a855f7", "#14b8a6", "#ec4899", "#64748b"];
const colorOf = (g) => (g && g.color) || "var(--accent)";

/* Nuqta ko'pburchak ichidami (nur kesish usuli, lat/lng tekisligida —
   bir necha o'n km lik soha uchun yetarli aniq). */
function inside(lat, lng, poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ai, bi] = [poly[i].lat, poly[i].lng], [aj, bj] = [poly[j].lat, poly[j].lng];
    if ((bi > lng) !== (bj > lng) && lat < ((aj - ai) * (lng - bi)) / (bj - bi) + ai) hit = !hit;
  }
  return hit;
}

export class GroupStore {
  constructor() {
    this.groups = [];
    this.byId = new Map();
    this.modal = null;          // { mode: "add" | "edit" | "new", ids, group }
    this.lassoOn = false;
    this.initialized = false;
  }

  /* ---------- ma'lumot ---------- */

  async load() {
    if (!state.admin) { this.apply([]); return; }
    try {
      const res = await api("/api/groups");
      this.apply(res.groups || []);
    } catch (e) { /* server eski bo'lsa — guruhsiz ishlayveradi */ }
  }

  apply(list) {
    this.groups = list;
    this.byId = new Map(list.map((g) => [g.id, g]));
    if (state.groupFilter != null && !this.byId.has(state.groupFilter)) this.setFilter(null, true);
    else this.syncFilterSet();
    this.renderFilterChip();
    if (state.listView === "grps") renderList(true);
    const cam = state.byId.get(state.selectedId);
    if (cam) this.renderCamGroups(cam);
    document.dispatchEvent(new Event("groups:changed"));     // devor tanlovi yangilansin
  }

  syncFilterSet() {
    const g = this.byId.get(state.groupFilter);
    state.groupMembers = g ? new Set(g.camera_ids) : null;
  }

  /* Xarita va ro'yxatni guruh bilan cheklash (null — olib tashlash). */
  setFilter(id, quiet) {
    state.groupFilter = id;
    this.syncFilterSet();
    this.renderFilterChip();
    if (quiet) return;
    renderList(true);
    rebuildMarkers();
    const g = this.byId.get(id);
    if (g) this.flyTo(g);
  }

  flyTo(g) {
    const pts = g.camera_ids.map((id) => state.byId.get(id)).filter((c) => c && hasGeo(c))
      .map((c) => [c.lat, c.lng]);
    if (pts.length === 1) map.flyTo(pts[0], 14, { duration: 0.6 });
    else if (pts.length > 1) map.flyToBounds(L.latLngBounds(pts).pad(0.25), { duration: 0.6 });
  }

  /* Xarita pastidagi guruhlar chizig'i: "Hammasi" + har guruh (onlayn/jami)
     + "Guruh". Bir bosishda filtr; faol guruh qayta bosilsa — olib tashlanadi.
     Ro'yxat har chizilganda chaqiriladi — holat soni yangi bo'lsin. */
  renderFilterChip() {
    const bar = $("map-groups");
    if (!bar) return;
    if (!state.admin || !this.groups.length) { bar.hidden = true; return; }
    bar.hidden = false;
    const chip = (id, color, name, count, on, title) =>
      '<button class="mg-chip' + (on ? " on" : "") + '" data-g="' + id + '" title="' + esc(title) + '">' +
      (color ? '<i style="background:' + color + '"></i>' : "") + "<span>" + esc(name) + "</span>" +
      (count ? "<b>" + count + "</b>" : "") + "</button>";   // count — faqat raqam va <em>
    const html = [chip("", "", "Hammasi", "", state.groupFilter == null, "Filtrsiz — barcha kameralar")];
    this.groups.forEach((g) => {
      const cams = g.camera_ids.map((id) => state.byId.get(id)).filter(Boolean);
      const down = cams.filter((c) => c.online === false).length;
      const count = (cams.length - down) + "/" + cams.length;
      html.push(chip(g.id, colorOf(g), g.name, down ? count + '<em>' + down + "↓</em>" : count,
        state.groupFilter === g.id, g.name + " · " + cams.length + " kamera" + (down ? ", " + down + " uzilgan" : "")));
    });
    html.push('<button class="mg-chip add" data-g="new" title="Yangi guruh">+ Guruh</button>');
    bar.innerHTML = html.join("");
    const on = bar.querySelector(".mg-chip.on");
    if (on && on.dataset.g) on.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  /* ---------- chap ro'yxat: "Guruhlar" ko'rinishi ---------- */

  renderGroupList() {
    const body = $("list-body");
    const head = '<div class="gl-head"><button class="btn acc gl-new">' +
      '<svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>Yangi guruh</button>' +
      '<span>Bosilsa — xaritada faqat shu guruh</span></div>';
    if (!this.groups.length) {
      body.innerHTML = head + '<div class="empty">Hali guruh yo‘q. “Tanlash” bilan ro‘yxatdan, ' +
        'xaritada soha chizib yoki kamera panelidan kameralarni guruhga qo‘shing.</div>';
    } else {
      body.innerHTML = head + this.groups.map((g) => {
        const cams = g.camera_ids.map((id) => state.byId.get(id)).filter(Boolean);
        const down = cams.filter((c) => c.online === false).length;
        const who = g.mine ? (g.shared ? "umumiy" : "shaxsiy") : g.owner_name + " · umumiy";
        return '<div class="gl-row' + (state.groupFilter === g.id ? " on" : "") + '" data-g="' + g.id + '">' +
          '<i class="gl-dot" style="background:' + colorOf(g) + '"></i>' +
          '<span class="nm">' + esc(g.name) + "<em>" + esc(who) +
            (g.hidden ? " · " + g.hidden + " ta yashirin" : "") + "</em></span>" +
          '<span class="bdg"><span>' + (cams.length - down) + "</span>" +
            (down ? '<span class="d">' + down + "</span>" : "") + "</span>" +
          '<button class="gl-ic" data-act="wall" title="Video devorda ochish"><svg viewBox="0 0 24 24"><rect width="7.5" height="7.5" x="3" y="3" rx="1.6"/><rect width="7.5" height="7.5" x="13.5" y="3" rx="1.6"/><rect width="7.5" height="7.5" x="13.5" y="13.5" rx="1.6"/><rect width="7.5" height="7.5" x="3" y="13.5" rx="1.6"/></svg></button>' +
          (g.can_edit ? '<button class="gl-ic" data-act="edit" title="Tahrirlash"><svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>' : "") +
          "</div>";
      }).join("");
    }
    body.querySelector(".gl-new").addEventListener("click", () => this.openPicker([], "Yangi guruh"));
    body.querySelectorAll(".gl-row").forEach((row) => {
      const g = this.byId.get(Number(row.dataset.g));
      row.addEventListener("click", (e) => {
        const act = e.target.closest("[data-act]");
        if (act && act.dataset.act === "edit") { this.openEditor(g); return; }
        if (act && act.dataset.act === "wall") { this.openOnWall(g); return; }
        // Guruh tanlansa — filtr va kameralar ro'yxati (hududlari ochiq).
        const off = state.groupFilter === g.id;
        if (!off) this.openRegionsOf(g);
        state.listView = off ? "grps" : "cams";
        document.querySelectorAll(".lh-tabs button").forEach((b) =>
          b.classList.toggle("on", b.dataset.lview === state.listView));
        this.setFilter(off ? null : g.id);
      });
    });
  }

  openRegionsOf(g) {
    g.camera_ids.forEach((id) => {
      const c = state.byId.get(id);
      if (c) state.openRegions[c.region] = true;
    });
  }

  openOnWall(g) {
    state.wallGroup = g.id;
    state.wallRegion = "";
    state.wallPage = 0;
    showTab("wall");
  }

  /* ---------- kamera paneli: "Guruhlar" qatori ---------- */

  renderCamGroups(cam) {
    const box = $("sel-f-groups");
    if (!box) return;
    if (!state.admin) { box.textContent = "—"; return; }
    const mine = this.groups.filter((g) => g.camera_ids.includes(cam.id));
    box.innerHTML = mine.map((g) =>
      '<span class="chip" data-g="' + g.id + '" title="Xaritada faqat shu guruh">' +
        '<i style="background:' + colorOf(g) + '"></i>' + esc(g.name) +
        (g.can_edit ? '<b data-rm="' + g.id + '" title="Guruhdan chiqarish">×</b>' : "") + "</span>").join("") +
      '<button class="chip add" title="Guruhga qo\'shish">+ guruh</button>';
    box.onclick = async (e) => {
      const rm = e.target.closest("[data-rm]");
      if (rm) {
        e.stopPropagation();
        await this.members(Number(rm.dataset.rm), [cam.id], "remove");
        return;
      }
      if (e.target.closest(".add")) { this.openPicker([cam.id], cam.name); return; }
      const chip = e.target.closest("[data-g]");
      if (chip) this.setFilter(Number(chip.dataset.g));
    };
  }

  /* ---------- server amallari ---------- */

  async members(groupId, ids, mode) {
    try {
      const g = await api("/api/groups/" + groupId + "/cameras", {
        method: "POST", body: JSON.stringify({ camera_ids: ids, mode }) });
      this.replace(g);
      return g;
    } catch (e) { toast(e.message, true); return null; }
  }

  replace(g) {
    const list = this.byId.has(g.id)
      ? this.groups.map((x) => (x.id === g.id ? g : x)) : [g, ...this.groups];
    this.apply(list);
  }

  /* ---------- oyna: qo'shish / yangi / tahrirlash ---------- */

  /* ids — qo'shiladigan kameralar (bo'sh bo'lishi mumkin: yangi bo'sh guruh). */
  openPicker(ids, title) {
    if (!state.admin) { toast("Guruhlar uchun tizimga kiring", true); return; }
    const editable = this.groups.filter((g) => g.can_edit);
    this.modal = { mode: ids.length && editable.length ? "add" : "new", ids, group: null, target: null };
    $("gm-title").textContent = ids.length ? "Guruhga qo‘shish" : "Yangi guruh";
    $("gm-lead").textContent = ids.length
      ? (ids.length === 1 && title ? title + " — " : ids.length + " ta kamera — ") +
        (editable.length ? "mavjud guruhni tanlang yoki yangisini yarating." : "yangi guruhga nom bering.")
      : "Nom bering — kameralarni keyin ro‘yxatdan, xaritadan yoki panel orqali qo‘shasiz.";
    const list = $("gm-list");
    list.innerHTML = ids.length && editable.length ? editable.map((g) => {
      const has = ids.filter((id) => g.camera_ids.includes(id)).length;
      return '<button class="gm-opt" data-g="' + g.id + '"><i style="background:' + colorOf(g) + '"></i>' +
        '<span>' + esc(g.name) + "<em>" + g.camera_ids.length + " kamera" +
        (has ? " · " + (has === ids.length ? "hammasi bor" : has + " tasi bor") : "") + "</em></span></button>";
    }).join("") + '<button class="gm-opt new on" data-g="new"><i>+</i><span>Yangi guruh<em>nom berib yaratish</em></span></button>' : "";
    list.hidden = !list.innerHTML;
    list.querySelectorAll(".gm-opt").forEach((b) => b.addEventListener("click", () => {
      list.querySelectorAll(".gm-opt").forEach((x) => x.classList.toggle("on", x === b));
      this.modal.target = b.dataset.g === "new" ? null : Number(b.dataset.g);
      $("gm-new").hidden = this.modal.target != null;
    }));
    this.fillForm({ name: "", color: GROUP_COLORS[this.groups.length % GROUP_COLORS.length], shared: false });
    $("gm-new").hidden = false;
    $("gm-delete").hidden = true;
    $("gm-save").textContent = ids.length ? "Qo‘shish" : "Yaratish";
    this.showModal();
  }

  openEditor(g) {
    this.modal = { mode: "edit", ids: [], group: g, target: null };
    $("gm-title").textContent = "Guruhni tahrirlash";
    $("gm-lead").textContent = g.camera_ids.length + " ta kamera" +
      (g.mine ? "" : " · egasi: " + g.owner_name) +
      " · kameralarni olib tashlash uchun kamera panelidagi × dan foydalaning.";
    $("gm-list").hidden = true;
    $("gm-list").innerHTML = "";
    this.fillForm(g);
    $("gm-new").hidden = false;
    $("gm-delete").hidden = false;
    $("gm-save").textContent = "Saqlash";
    this.showModal();
  }

  fillForm(g) {
    $("gm-name").value = g.name || "";
    $("gm-shared").checked = !!g.shared;
    this.color = g.color || "";
    $("gm-colors").innerHTML = GROUP_COLORS.map((c) =>
      '<button type="button" data-c="' + c + '" style="background:' + c + '"' +
      (c === this.color ? ' class="on"' : "") + ' title="' + c + '"></button>').join("");
    $("gm-colors").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      this.color = b.dataset.c;
      $("gm-colors").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    }));
  }

  showModal() {
    $("gm-err").classList.remove("show");
    openModal("group-modal");
    if (!$("gm-new").hidden) setTimeout(() => $("gm-name").focus(), 60);
  }

  fail(msg) {
    $("gm-err").textContent = msg;
    $("gm-err").classList.add("show");
  }

  async save() {
    const m = this.modal;
    if (!m) return;
    const name = $("gm-name").value.trim();
    const shared = $("gm-shared").checked;
    try {
      if (m.mode === "edit") {
        this.replace(await api("/api/groups/" + m.group.id, { method: "PATCH",
          body: JSON.stringify({ name, color: this.color, shared }) }));
        toast("Guruh saqlandi");
      } else if (m.target != null) {
        const g = await this.members(m.target, m.ids, "add");
        if (!g) return;
        toast(m.ids.length + " ta kamera “" + g.name + "” guruhiga qo‘shildi");
      } else {
        if (!name) { this.fail("Guruh nomini kiriting"); return; }
        const g = await api("/api/groups", { method: "POST",
          body: JSON.stringify({ name, color: this.color, shared, camera_ids: m.ids }) });
        this.replace(g);
        toast("“" + g.name + "” guruhi yaratildi" + (m.ids.length ? " · " + m.ids.length + " kamera" : ""));
      }
    } catch (e) { this.fail(e.message); return; }
    closeModal("group-modal");
    this.modal = null;
    if (m.ids.length > 1) this.setPickMode(false);
  }

  async remove() {
    const g = this.modal && this.modal.group;
    if (!g || !confirm("“" + g.name + "” guruhi o‘chirilsinmi? Kameralarning o‘ziga tegilmaydi.")) return;
    try { await api("/api/groups/" + g.id, { method: "DELETE" }); }
    catch (e) { this.fail(e.message); return; }
    closeModal("group-modal");
    this.apply(this.groups.filter((x) => x.id !== g.id));
    toast("Guruh o‘chirildi");
  }

  /* ---------- ro'yxatda "Tanlash" rejimi ---------- */

  setPickMode(on) {
    state.pickMode = on;
    if (!on) state.pickIds.clear();
    // Tanlash kameralar ro'yxatida bo'ladi — boshqa ko'rinishdan o'tiladi.
    if (on && state.listView !== "cams") {
      state.listView = "cams";
      document.querySelectorAll(".lh-tabs button").forEach((b) =>
        b.classList.toggle("on", b.dataset.lview === "cams"));
    }
    $("sel-mode").classList.toggle("on", on);
    $("sel-mode").textContent = on ? "Tugatish" : "Tanlash";
    document.body.classList.toggle("pick-mode", on);
    this.renderPickBar();
    renderList(true);
  }

  togglePick(id) {
    if (state.pickIds.has(id)) state.pickIds.delete(id); else state.pickIds.add(id);
    this.renderPickBar();
  }

  renderPickBar() {
    $("pick-bar").hidden = !state.pickMode;
    const n = state.pickIds.size;
    $("pick-bar-n").textContent = n + " ta tanlandi";
    $("pick-bar-add").disabled = !n;
  }

  /* ---------- xaritada soha chizish (lasso) ---------- */

  setLasso(on) {
    this.lassoOn = on;
    const el = map.getContainer();
    el.classList.toggle("lasso", on);
    $("lasso-btn").classList.toggle("on", on);
    $("lasso-hint").style.display = on ? "block" : "none";
    if (on) map.dragging.disable(); else map.dragging.enable();
    if (!on && this.lassoLine) { map.removeLayer(this.lassoLine); this.lassoLine = null; }
  }

  bindLasso() {
    const el = map.getContainer();
    let pts = null, lastPx = null;
    const down = (e) => {
      if (!this.lassoOn || e.button > 0) return;
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
      pts = [map.mouseEventToLatLng(e)];
      lastPx = [e.clientX, e.clientY];
      this.lassoLine = L.polyline(pts, { color: "#3b82f6", weight: 2, dashArray: "6 5", interactive: false }).addTo(map);
    };
    const move = (e) => {
      if (!pts) return;
      if (Math.hypot(e.clientX - lastPx[0], e.clientY - lastPx[1]) < 5) return;
      lastPx = [e.clientX, e.clientY];
      pts.push(map.mouseEventToLatLng(e));
      this.lassoLine.setLatLngs(pts);
    };
    const up = () => {
      if (!pts) return;
      const poly = pts;
      pts = null;
      this.setLasso(false);
      if (poly.length < 3) return;
      const ids = visibleCams().filter((c) => hasGeo(c) && inside(c.lat, c.lng, poly)).map((c) => c.id);
      // Chizilgan soha bir zum ko'rinib turadi — nima tanlanganini ko'rish uchun.
      const shape = L.polygon(poly, { color: "#3b82f6", weight: 2, fillOpacity: 0.08, interactive: false }).addTo(map);
      setTimeout(() => map.removeLayer(shape), 900);
      if (!ids.length) { toast("Sohada kamera topilmadi", true); return; }
      this.openPicker(ids, "");
    };
    el.addEventListener("pointerdown", down, true);
    el.addEventListener("pointermove", move, true);
    el.addEventListener("pointerup", up, true);
    el.addEventListener("pointercancel", () => { pts = null; this.setLasso(false); }, true);
  }

  /* ---------- ulash ---------- */

  init() {
    if (this.initialized) return;
    this.initialized = true;
    state.pickIds = new Set();
    state.pickMode = false;
    $("gm-save").addEventListener("click", () => this.save());
    $("gm-delete").addEventListener("click", () => this.remove());
    $("gm-name").addEventListener("keydown", (e) => { if (e.key === "Enter") this.save(); });
    $("map-groups").addEventListener("click", (e) => {
      const b = e.target.closest(".mg-chip");
      if (!b) return;
      if (b.dataset.g === "new") { this.openPicker([], "Yangi guruh"); return; }
      const id = b.dataset.g ? Number(b.dataset.g) : null;
      if (id != null && state.groupFilter !== id) this.openRegionsOf(this.byId.get(id));
      this.setFilter(id === state.groupFilter ? null : id);
    });
    // Sichqoncha g'ildiragi chiziqni gorizontal suradi (guruh ko'p bo'lsa).
    $("map-groups").addEventListener("wheel", (e) => {
      const bar = $("map-groups");
      if (bar.scrollWidth <= bar.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      bar.scrollLeft += e.deltaY;
    }, { passive: false });
    $("sel-mode").addEventListener("click", () => this.setPickMode(!state.pickMode));
    $("pick-bar-clear").addEventListener("click", () => this.setPickMode(false));
    $("pick-bar-add").addEventListener("click", () => {
      if (state.pickIds.size) this.openPicker([...state.pickIds], "");
    });
    $("lasso-btn").addEventListener("click", () => this.setLasso(!this.lassoOn));
    // Kirish/chiqishda boshqa foydalanuvchining guruhlari qolib ketmasin.
    document.addEventListener("auth:changed", () => {
      if (!state.admin) { this.setPickMode(false); this.setLasso(false); }
      this.load();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (this.lassoOn) this.setLasso(false);
      else if (state.pickMode && !document.querySelector(".backdrop.open")) this.setPickMode(false);
    });
    this.bindLasso();
  }
}

export const groupStore = new GroupStore();

export function initGroups() { groupStore.init(); }
export function loadGroups() { return groupStore.load(); }
export function groupById(id) { return groupStore.byId.get(id); }
export function allGroups() { return groupStore.groups; }
export function openGroupPicker(ids, title) { groupStore.openPicker(ids, title); }
export function renderGroupList() { groupStore.renderGroupList(); }
export function renderGroupBar() { groupStore.renderFilterChip(); }
export function renderCamGroups(cam) { groupStore.renderCamGroups(cam); }
export function togglePick(id) { groupStore.togglePick(id); }
