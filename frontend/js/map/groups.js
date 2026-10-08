/* ==========================================================================
   map/groups.js — foydalanuvchi kamera guruhlari (Panel → "Guruhlar" tabi, 02.12)
   --------------------------------------------------------------------------
   Vazifasi:
     Foydalanuvchi o'ziga kerakli kameralarni tanlab, nom berib saqlaydi
     (GET/POST/PATCH/DELETE /api/groups). Guruh:
       * xaritada va ro'yxatda filtr (state.groupFilter — map.js visibleCams;
         panel chiplarida olib tashlanadigan "guruh" chipi);
       * panelning "Guruhlar" tabi (renderGroupList) — Figma uslubida qatorlar,
         "Yangi guruh", "Roʻyxatdan tanlash" (Tanlash rejimi), "Xaritada belgilash" (lasso);
       * drawer'dagi "Guruh" qatori (renderCamGroups);
       * video devorda to'plam (wall/video-wall.js — groupById, allGroups).
     Guruh oynasi (#group-modal, v3 Dialog): mavjud guruhga qo'shish, yangi
     guruh, tahrirlash — har kamera katakcha bilan.

   Eksport:
     GroupStore, groupStore
     initGroups()         — tugmalarni ulash + xarita sahifasini ishga tushirish (main.js dan)
     loadGroups()         — serverdan qayta o'qish
     groupById(id), allGroups(), openGroupPicker(ids, title)
     renderGroupList(body, head), renderGroupBar() (v2 mos), renderCamGroups(cam), togglePick(id)
     GROUP_COLORS

   Bog'liqliklar:
     import: ../core/state.js, ../core/api.js, ../core/modals.js, ../core/ui.js, ../core/icons.js,
             ./map.js (map, mapView, visibleCams), ./util.js, ./camera-list.js (renderList, cameraList),
             ../layout/tabs.js (showTab), ./page.js (initMapPage)
     global: L (polyline/polygon)
   DOM: #group-modal, #gm-*, #pick-bar*, #lasso-hint, #sel-f-groups, #list-body, #mp-listhead
   Backend: GET /api/groups, POST /api/groups, PATCH/DELETE /api/groups/{id},
            POST /api/groups/{id}/cameras {camera_ids, mode}

   Qoidalar / tuzoqlar:
     - Faqat kirgan foydalanuvchi uchun so'raladi (state.admin); "Kuzatuvchi"
       (viewer) guruh yarata/o'zgartira olmaydi.
     - init() main.js dan (modullar yuklangach) — aylanma importlar tufayli.
     - Lasso paytida xarita surilmaydi (dragging o'chiriladi), tugagach tiklanadi.
     - Guruh rangi — foydalanuvchi tanlagan ma'lumot (inline style), token emas.
   ========================================================================== */
import { $, esc, state, toast } from "../core/state.js";
import { api } from "../core/api.js";
import { closeModal, openModal } from "../core/modals.js";
import { confirmDialog, emptyState, infotip, tooltip } from "../core/ui.js";
import { icon, hydrateIcons } from "../core/icons.js";
import { map, mapView, visibleCams } from "./map.js";
import { camStatus, hasGeo, norm } from "./util.js";
import { cameraList, renderList } from "./camera-list.js";
import { showTab } from "../layout/tabs.js";
import { initMapPage } from "./page.js";

export const GROUP_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444",
                             "#a855f7", "#14b8a6", "#ec4899", "#64748b"];
const colorOf = (g) => (g && g.color) || "var(--color-bg-brand)";
const canEdit = () => !!(state.admin && state.admin.role !== "viewer");

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
    this.modal = null;
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
    const cam = state.byId.get(state.selectedId);
    if (cam) this.renderCamGroups(cam);
    document.dispatchEvent(new Event("groups:changed"));
  }

  syncFilterSet() {
    const g = this.byId.get(state.groupFilter);
    state.groupMembers = g ? new Set(g.camera_ids) : null;
  }

  setFilter(id, quiet) {
    state.groupFilter = id;
    this.syncFilterSet();
    if (quiet) return;
    renderList(true);
    mapView.rebuildMarkers();
    const g = this.byId.get(id);
    if (g) this.flyTo(g);
  }

  flyTo(g) {
    mapView.fitCams(g.camera_ids.map((id) => state.byId.get(id)).filter((c) => c && hasGeo(c)), { zoom: 14 });
  }

  /* ---------- Panel: "Guruhlar" tabi ---------- */
  renderGroupList(body, head) {
    body = body || $("list-body");
    head = head || $("mp-listhead");
    if (!state.admin) {
      head.innerHTML = "";
      body.innerHTML = emptyState({ type: "nodata", title: "Guruhlar", text: "Guruhlar uchun tizimga kiring" });
      return;
    }
    const edit = canEdit();
    head.innerHTML = '<span class="overline">' + this.groups.length + " guruh</span>" +
      infotip("Guruh bosilsa — xarita va roʻyxatda faqat shu guruh kameralari. Yana bosilsa — filtr olinadi.") +
      '<span class="spacer"></span>' +
      (edit ? '<button class="btn btn--tertiary btn--sm" data-act="g-new">' + icon("plus", "sm") + "Yangi guruh</button>" : "");
    let html = edit ? '<div class="mp-gtools">' +
      '<button class="btn btn--secondary btn--sm" data-act="g-pick">' + icon("list", "sm") + "Roʻyxatdan tanlash</button>" +
      '<button class="btn btn--secondary btn--sm' + (this.lassoOn ? " is-on" : "") + '" data-act="g-lasso">' +
        icon("draw-polygon", "sm") + "Xaritada belgilash</button></div>" : "";
    if (!this.groups.length) {
      html += emptyState({ type: "nodata", title: "Hali guruh yoʻq", text: "Kameralarni roʻyxatdan yoki xaritadan belgilab guruh yarating",
        action: edit ? "Yangi guruh" : "", primary: true, id: "mp-g-empty" });
    } else {
      html += this.groups.map((g) => {
        const cams = g.camera_ids.map((id) => state.byId.get(id)).filter(Boolean);
        const n = { online: 0, offline: 0, "no-video": 0 };
        cams.forEach((c) => { const s = camStatus(c); if (n[s] != null) n[s]++; });
        const who = g.mine ? (g.shared ? "umumiy" : "shaxsiy") : (g.owner_name || "") + " · umumiy";
        return '<div class="mp-grow' + (state.groupFilter === g.id ? " is-sel" : "") + '">' +
          '<button class="mp-rrow mp-rrow--flat" data-act="g-filter" data-g="' + g.id + '" aria-pressed="' + (state.groupFilter === g.id) + '">' +
            '<span class="mp-gdot" style="background:' + esc(colorOf(g)) + '"></span>' +
            '<span class="mp-rrow__txt"><span class="label-md ellipsis mp-rrow__name">' + esc(g.name) + "</span>" +
              '<span class="body-xs t-tertiary ellipsis">' + cams.length + " kamera · " + esc(who) +
              (g.hidden ? " · " + g.hidden + " ta yashirin" : "") + "</span></span>" +
            '<span class="mp-counts"><span class="badge badge--count" data-status="online">' + n.online + "</span>" +
              (n.offline ? '<span class="badge badge--count" data-status="offline">' + n.offline + "</span>" : "") + "</span>" +
          "</button>" +
          '<span class="mp-grow__acts">' +
            '<button class="icon-btn icon-btn--sm" data-act="g-wall" data-g="' + g.id + '" data-tip="Video devorda ochish">' + icon("grid", "sm") + "</button>" +
            (g.can_edit && edit ? '<button class="icon-btn icon-btn--sm" data-act="g-edit" data-g="' + g.id + '" data-tip="Tahrirlash">' + icon("pen", "sm") + "</button>" : "") +
          "</span></div>";
      }).join("");
    }
    body.innerHTML = html;
    tooltip.label(body);
  }

  onHeadAction(act) {
    if (act === "g-new") this.openPicker([], "Yangi guruh");
  }

  onBodyAction(act, el) {
    const g = el.dataset.g ? this.byId.get(Number(el.dataset.g)) : null;
    if (act === "g-pick") this.setPickMode(true);
    else if (act === "g-lasso") this.setLasso(!this.lassoOn);
    else if (act === "g-wall" && g) this.openOnWall(g);
    else if (act === "g-edit" && g) this.openEditor(g);
    else if (act === "g-filter" && g) {
      const off = state.groupFilter === g.id;
      if (!off) { this.openRegionsOf(g); state.listView = "cams"; }
      this.setFilter(off ? null : g.id);
    }
  }

  openRegionsOf(g) {
    if (!g) return;
    g.camera_ids.forEach((id) => {
      const c = state.byId.get(id);
      if (c) state.openRegions[hasGeo(c) ? c.region : "\u0000nogeo"] = true;
    });
  }

  openOnWall(g) {
    state.wallGroup = g.id;
    state.wallRegion = "";
    state.wallPage = 0;
    showTab("wall");
  }

  /* ---------- drawer: "Guruh" qatori ---------- */
  renderCamGroups(cam) {
    const box = $("sel-f-groups");
    if (!box) return;
    if (!state.admin) { box.textContent = "—"; return; }
    const mine = this.groups.filter((g) => g.camera_ids.includes(cam.id));
    box.innerHTML = mine.map((g) =>
      '<span class="mp-gchip" data-g="' + g.id + '" data-tip="Xaritada faqat shu guruh">' +
        '<i style="background:' + esc(colorOf(g)) + '"></i>' + esc(g.name) +
        (g.can_edit && canEdit() ? '<button data-rm="' + g.id + '" aria-label="Guruhdan chiqarish">' + icon("xmark", "xs") + "</button>" : "") +
      "</span>").join("") +
      (canEdit() ? '<button class="mp-gchip mp-gchip--add" data-add>' + icon("plus", "xs") + "guruh</button>" : (mine.length ? "" : "—"));
    tooltip.label(box);
    box.onclick = async (e) => {
      const rm = e.target.closest("[data-rm]");
      if (rm) { e.stopPropagation(); await this.members(Number(rm.dataset.rm), [cam.id], "remove"); return; }
      if (e.target.closest("[data-add]")) { this.openPicker([cam.id], cam.name); return; }
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
    } catch (e) { toast(e.message, { tone: "error" }); return null; }
  }

  replace(g) {
    const list = this.byId.has(g.id)
      ? this.groups.map((x) => (x.id === g.id ? g : x)) : [g, ...this.groups];
    this.apply(list);
  }

  /* ---------- oyna: qo'shish / yangi / tahrirlash ---------- */
  openPicker(ids, title) {
    if (!canEdit()) { toast(state.admin ? "Kuzatuvchi guruh yarata olmaydi" : "Guruhlar uchun tizimga kiring", { tone: "info" }); return; }
    const editable = this.groups.filter((g) => g.can_edit);
    this.modal = { mode: ids.length && editable.length ? "add" : "new", ids, group: null, target: null };
    $("gm-title").textContent = ids.length ? "Guruhga qoʻshish" : "Yangi guruh";
    $("gm-lead").textContent = ids.length
      ? (ids.length === 1 && title ? title + " — " : ids.length + " ta kamera — ") +
        (editable.length ? "mavjud guruhni tanlang yoki yangisini yarating." : "yangi guruhga nom bering.")
      : "Nom bering va kameralarni pastdagi roʻyxatdan belgilang (keyin ham qoʻshsa boʻladi).";
    const list = $("gm-list");
    list.innerHTML = ids.length && editable.length ? editable.map((g) => {
      const has = ids.filter((id) => g.camera_ids.includes(id)).length;
      return '<button type="button" class="mp-gm__opt" data-g="' + g.id + '"><i style="background:' + esc(colorOf(g)) + '"></i>' +
        '<span class="label-sm">' + esc(g.name) + '</span><span class="body-xs t-tertiary">' + g.camera_ids.length + " kamera" +
        (has ? " · " + (has === ids.length ? "hammasi bor" : has + " tasi bor") : "") + "</span></button>";
    }).join("") + '<button type="button" class="mp-gm__opt is-on" data-g="new"><i class="mp-gm__plus">' + icon("plus", "xs") +
      '</i><span class="label-sm">Yangi guruh</span><span class="body-xs t-tertiary">nom berib yaratish</span></button>' : "";
    list.hidden = !list.innerHTML;
    list.querySelectorAll(".mp-gm__opt").forEach((b) => b.addEventListener("click", () => {
      list.querySelectorAll(".mp-gm__opt").forEach((x) => x.classList.toggle("is-on", x === b));
      this.modal.target = b.dataset.g === "new" ? null : Number(b.dataset.g);
      $("gm-new").hidden = this.modal.target != null;
    }));
    this.fillForm({ name: "", color: GROUP_COLORS[this.groups.length % GROUP_COLORS.length], shared: false });
    $("gm-new").hidden = false;
    $("gm-delete").hidden = true;
    $("gm-save").textContent = ids.length ? "Qoʻshish" : "Yaratish";
    if (ids.length) this.closeCams(); else this.openCams([]);
    this.showModal();
  }

  openEditor(g) {
    this.modal = { mode: "edit", ids: [], group: g, target: null };
    $("gm-title").textContent = "Guruhni tahrirlash";
    $("gm-lead").textContent = (g.mine ? "Nomi, rangi, koʻrinishi va kameralari." : "Egasi: " + g.owner_name + ".") +
      (g.hidden ? " " + g.hidden + " ta kamera sizning hududingizda emas — ular oʻzgarmaydi." : "");
    $("gm-list").hidden = true;
    $("gm-list").innerHTML = "";
    this.fillForm(g);
    $("gm-new").hidden = false;
    $("gm-delete").hidden = false;
    $("gm-save").textContent = "Saqlash";
    this.openCams(g.camera_ids);
    this.showModal();
  }

  openCams(ids) {
    this.editIds = [...ids];
    this.origIds = [...ids];
    this.onlyPicked = false;
    $("gm-cams").hidden = false;
    $("gm-dialog").classList.add("dialog--lg");
    $("gm-cam-q").value = "";
    $("gm-only").classList.remove("is-on");
    const regions = [...new Set(state.cameras.map((c) => c.region))].sort();
    $("gm-cam-reg").innerHTML = '<option value="">Barcha hududlar</option>' +
      regions.map((r) => '<option value="' + esc(r) + '">' + esc(r) + "</option>").join("");
    this.renderPick();
  }

  closeCams() {
    $("gm-cams").hidden = true;
    $("gm-dialog").classList.remove("dialog--lg");
    this.editIds = null;
  }

  renderPick() {
    const picked = new Set(this.editIds);
    const q = norm($("gm-cam-q").value);
    const reg = $("gm-cam-reg").value;
    const cams = state.cameras.filter((c) =>
      (!reg || c.region === reg) && (!this.onlyPicked || picked.has(c.id)) &&
      (!q || norm(c.name + " " + (c.km != null ? c.km : "") + " " + c.region).includes(q)));
    const changed = this.editIds.length !== this.origIds.length ||
      this.editIds.some((id, i) => id !== this.origIds[i]);
    $("gm-cams-n").innerHTML = "<b>" + this.editIds.length + "</b> ta tanlangan" +
      (changed ? ' · <span class="t-brand">oʻzgardi</span>' : "") +
      (this.editIds.length ? ' <button type="button" class="label-xs t-brand mp-gm__clear">tanlovni tozalash</button>' : "");
    $("gm-only").innerHTML = "Faqat tanlanganlar <span class=\"chip__count\">" + this.editIds.length + "</span>";
    const box = $("gm-pick");
    if (!cams.length) {
      box.innerHTML = '<div class="body-sm t-tertiary mp-gm__empty">' + (this.onlyPicked ? "Hali kamera tanlanmagan." : "Mos kamera topilmadi.") + "</div>";
      return;
    }
    const LIMIT = 400;
    const byReg = new Map();
    cams.slice(0, LIMIT).forEach((c) => {
      if (!byReg.has(c.region)) byReg.set(c.region, []);
      byReg.get(c.region).push(c);
    });
    let html = "";
    byReg.forEach((list, region) => {
      const n = list.filter((c) => picked.has(c.id)).length;
      html += '<div class="mp-gm__rh"><span class="overline">' + esc(region) + " · " + n + " / " + list.length + "</span>" +
        '<button type="button" class="label-xs t-brand mp-gm__rall" data-r="' + esc(region) + '">' +
        (n === list.length ? "hammasini olib tashlash" : "hammasini belgilash") + "</button></div>";
      html += list.map((c) => {
        const where = c.km != null ? c.km + (c.picket ? "/" + c.picket : "") + " km" : "";
        return '<label class="mp-gm__cam"><input type="checkbox" class="check" data-id="' + c.id + '"' +
          (picked.has(c.id) ? " checked" : "") + '><span class="dot" data-status="' + camStatus(c) + '"></span>' +
          '<span class="label-sm ellipsis">' + esc(c.name) + "</span>" +
          (where && where !== c.name ? '<span class="mono-xs t-tertiary">' + esc(where) + "</span>" : "") + "</label>";
      }).join("");
    });
    if (cams.length > LIMIT) html += '<div class="body-xs t-tertiary mp-gm__empty">va yana ' + (cams.length - LIMIT) + " ta — qidiruv yoki hudud bilan toraytiring</div>";
    const top = box.scrollTop;
    box.innerHTML = html;
    box.scrollTop = top;
  }

  fillForm(g) {
    $("gm-name").value = g.name || "";
    $("gm-shared").checked = !!g.shared;
    this.color = g.color || "";
    $("gm-colors").innerHTML = GROUP_COLORS.map((c) =>
      '<button type="button" role="radio" aria-checked="' + (c === this.color) + '" data-c="' + c + '" style="background:' + c + '"' +
      ' aria-label="Rang ' + c + '"></button>').join("");
    $("gm-colors").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      this.color = b.dataset.c;
      $("gm-colors").querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    }));
  }

  showModal() {
    $("gm-err").hidden = true;
    openModal("group-modal");
    if (!$("gm-new").hidden) setTimeout(() => $("gm-name").focus(), 60);
  }

  fail(msg) {
    $("gm-err").textContent = msg;
    $("gm-err").hidden = false;
  }

  async save() {
    const m = this.modal;
    if (!m) return;
    const name = $("gm-name").value.trim();
    const shared = $("gm-shared").checked;
    try {
      if (m.mode === "edit") {
        if (!name) { this.fail("Guruh nomini kiriting"); return; }
        let g = await api("/api/groups/" + m.group.id, { method: "PATCH",
          body: JSON.stringify({ name, color: this.color, shared }) });
        const changed = this.editIds && (this.editIds.length !== this.origIds.length ||
          this.editIds.some((id, i) => id !== this.origIds[i]));
        if (changed) {
          g = await api("/api/groups/" + m.group.id + "/cameras", { method: "POST",
            body: JSON.stringify({ camera_ids: this.editIds, mode: "set" }) });
        }
        this.replace(g);
        toast("Guruh saqlandi" + (changed ? " · " + g.camera_ids.length + " kamera" : ""));
      } else if (m.target != null) {
        const g = await this.members(m.target, m.ids, "add");
        if (!g) return;
        toast(m.ids.length + " ta kamera “" + g.name + "” guruhiga qoʻshildi");
      } else {
        if (!name) { this.fail("Guruh nomini kiriting"); return; }
        const ids = m.ids.length ? m.ids : (this.editIds || []);
        const g = await api("/api/groups", { method: "POST",
          body: JSON.stringify({ name, color: this.color, shared, camera_ids: ids }) });
        this.replace(g);
        toast("“" + g.name + "” guruhi yaratildi" + (ids.length ? " · " + ids.length + " kamera" : ""));
      }
    } catch (e) { this.fail(e.message); return; }
    closeModal("group-modal");
    this.modal = null;
    if (m.ids.length > 1) this.setPickMode(false);
  }

  async remove() {
    const g = this.modal && this.modal.group;
    if (!g) return;
    const ok = await confirmDialog({ title: "“" + g.name + "” oʻchirilsinmi?", text: "Kameralarning oʻziga tegilmaydi.",
      ok: "Oʻchirish", danger: true });
    if (!ok) return;
    try { await api("/api/groups/" + g.id, { method: "DELETE" }); }
    catch (e) { this.fail(e.message); return; }
    closeModal("group-modal");
    this.apply(this.groups.filter((x) => x.id !== g.id));
    toast("Guruh oʻchirildi");
  }

  /* ---------- ro'yxatda "Tanlash" rejimi ---------- */
  setPickMode(on) {
    state.pickMode = on;
    if (!on) state.pickIds.clear();
    if (on) {
      state.listView = "cams";
      cameraList.setCollapsed(false, false);
      if (state.q) cameraList.setQuery("", true);
    }
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
    map.getContainer().classList.toggle("lasso", on);
    $("lasso-hint").hidden = !on;
    if (on) map.dragging.disable(); else map.dragging.enable();
    if (!on && this.lassoLine) { map.removeLayer(this.lassoLine); this.lassoLine = null; }
    if (state.listView === "grps") renderList(true);
  }

  bindLasso() {
    const el = map.getContainer();
    let pts = null, lastPx = null;
    const color = () => getComputedStyle(document.documentElement).getPropertyValue("--color-bg-brand").trim() || "#2556eb";
    const down = (e) => {
      if (!this.lassoOn || e.button > 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
      pts = [map.mouseEventToLatLng(e)];
      lastPx = [e.clientX, e.clientY];
      this.lassoLine = L.polyline(pts, { color: color(), weight: 2, dashArray: "6 5", interactive: false }).addTo(map);
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
      const shape = L.polygon(poly, { color: color(), weight: 2, fillOpacity: 0.08, interactive: false }).addTo(map);
      setTimeout(() => map.removeLayer(shape), 900);
      if (!ids.length) { toast("Belgilangan sohada kamera topilmadi", { tone: "info" }); return; }
      this.openPicker(ids, "");
    };
    el.addEventListener("pointerdown", down, true);
    el.addEventListener("pointermove", move, true);
    el.addEventListener("pointerup", up, true);
    el.addEventListener("pointercancel", () => { pts = null; this.setLasso(false); }, true);
  }

  /* Esc: lasso → tanlash rejimi (page.js chaqiradi). */
  escape() {
    if (this.lassoOn) { this.setLasso(false); return true; }
    if (state.pickMode) { this.setPickMode(false); return true; }
    return false;
  }

  /* ---------- ulash ---------- */
  init() {
    if (this.initialized) return;
    this.initialized = true;
    state.pickIds = new Set();
    state.pickMode = false;
    initMapPage();
    $("gm-save").addEventListener("click", () => this.save());
    $("gm-delete").addEventListener("click", () => this.remove());
    $("gm-name").addEventListener("keydown", (e) => { if (e.key === "Enter") this.save(); });
    $("gm-cam-q").addEventListener("input", () => this.renderPick());
    $("gm-cam-q").addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
    $("gm-cam-reg").addEventListener("change", () => this.renderPick());
    $("gm-only").addEventListener("click", () => {
      this.onlyPicked = !this.onlyPicked;
      $("gm-only").classList.toggle("is-on", this.onlyPicked);
      this.renderPick();
    });
    $("gm-pick").addEventListener("click", (e) => {
      const all = e.target.closest(".mp-gm__rall");
      if (!all) return;
      const rows = [...$("gm-pick").querySelectorAll("input[data-id]")].map((r) => Number(r.dataset.id))
        .filter((id) => state.byId.get(id).region === all.dataset.r);
      const picked = new Set(this.editIds);
      const every = rows.every((id) => picked.has(id));
      if (every) this.editIds = this.editIds.filter((id) => !rows.includes(id));
      else rows.forEach((id) => { if (!picked.has(id)) this.editIds.push(id); });
      this.renderPick();
    });
    $("gm-pick").addEventListener("change", (e) => {
      const cb = e.target.closest("input[data-id]");
      if (!cb) return;
      const id = Number(cb.dataset.id);
      if (cb.checked) { if (!this.editIds.includes(id)) this.editIds.push(id); }
      else this.editIds = this.editIds.filter((x) => x !== id);
      this.renderPick();
    });
    $("gm-cams-n").addEventListener("click", async (e) => {
      if (!e.target.closest(".mp-gm__clear")) return;
      if (this.editIds.length > 5 && !(await confirmDialog({ title: this.editIds.length + " ta tanlangan kamera olib tashlansinmi?", ok: "Olib tashlash" }))) return;
      this.editIds = [];
      this.renderPick();
    });
    $("list-body").addEventListener("click", (e) => {
      if (e.target.closest("#mp-g-empty")) this.openPicker([], "Yangi guruh");
    });
    $("pick-bar-clear").addEventListener("click", () => this.setPickMode(false));
    $("pick-bar-add").addEventListener("click", () => {
      if (state.pickIds.size) this.openPicker([...state.pickIds], "");
    });
    $("lasso-cancel").addEventListener("click", () => this.setLasso(false));
    document.addEventListener("auth:changed", () => {
      if (!canEdit()) { this.setPickMode(false); this.setLasso(false); }
      this.load();
    });
    this.bindLasso();
    hydrateIcons($("group-modal"));
  }
}

export const groupStore = new GroupStore();

export function initGroups() { groupStore.init(); }
export function loadGroups() { return groupStore.load(); }
export function groupById(id) { return groupStore.byId.get(id); }
export function allGroups() { return groupStore.groups; }
export function openGroupPicker(ids, title) { groupStore.openPicker(ids, title); }
export function renderGroupList(body, head) { groupStore.renderGroupList(body, head); }
export function renderGroupBar() { /* v2 mosligi: xarita pastidagi guruh chizig'i olib tashlangan */ }
export function renderCamGroups(cam) { groupStore.renderCamGroups(cam); }
export function togglePick(id) { groupStore.togglePick(id); }
