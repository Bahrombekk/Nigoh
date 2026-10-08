/* ==========================================================================
   settings/groups.js — Kamera guruhlari (06.06): barcha foydalanuvchilarning guruhlari
   --------------------------------------------------------------------------
   Qator: ikon katak + nom + meta ("24 kamera · Toshkent shahri, Jizzax") ·
   o'ngda "Video devorda" (shu guruh devorda tanlangan bo'lsa) yoki "–" · ⋯ menyu:
   Xaritada koʻrsatish, Video devorda ochish, Tahrirlash, Umumiy/Shaxsiy qilish,
   Oʻchirish. Qatorni bosish — tahrirlash. Oyna va saqlash — map/groups.js
   (groupStore; bu fayl uni faqat chaqiradi).

   Eksport: GroupsSection (klass)
   Backend: GET /api/groups (groupStore orqali), PATCH/DELETE /api/groups/{id}
   ========================================================================== */
import { $, esc, state } from "../core/state.js";
import { api } from "../core/api.js";
import { icon } from "../core/icons.js";
import { prefs } from "../core/prefs.js";
import { toast, menu, confirmDialog, emptyState, tooltip } from "../core/ui.js";
import { groupStore, loadGroups } from "../map/groups.js";
import { showTab } from "../layout/tabs.js";

export class GroupsSection {
  constructor() { this.bound = false; }

  bind() {
    if (this.bound) return;
    this.bound = true;
    $("sg-new").addEventListener("click", () => groupStore.openPicker([], "Yangi guruh"));
    document.addEventListener("groups:changed", () => { if (state.tab === "settings") this.render(); });
    $("sg-list").addEventListener("click", (e) => {
      const row = e.target.closest("[data-gid]");
      if (!row) return;
      const g = groupStore.byId.get(Number(row.dataset.gid));
      if (!g) return;
      const more = e.target.closest("[data-more]");
      if (more) this.rowMenu(more, g); else if (g.can_edit !== false) groupStore.openEditor(g);
    });
    $("sg-list").addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || !e.target.matches("[data-gid]")) return;
      const g = groupStore.byId.get(Number(e.target.dataset.gid));
      if (g) groupStore.openEditor(g);
    });
  }

  async load() {
    this.bind();
    if (!groupStore.groups.length) $("sg-list").innerHTML = '<div class="sx-glist">' + [0, 1, 2].map(() =>
      '<div class="sx-grow"><span class="skeleton" style="width:36px;height:36px;border-radius:8px"></span>' +
      '<span style="flex:1;display:flex;flex-direction:column;gap:6px"><span class="skeleton" style="height:12px;width:30%"></span>' +
      '<span class="skeleton" style="height:10px;width:45%"></span></span></div>').join("") + "</div>";
    try { await loadGroups(); } catch (e) { /* groupStore o'zi xabar beradi */ }
    this.render();
  }

  onWall(g) {
    const w = prefs.get("wall", {}) || {};
    return state.wallGroup === g.id || w.group === g.id;
  }

  meta(g) {
    const cams = g.camera_ids.map((id) => state.byId.get(id)).filter(Boolean);
    const regions = [...new Set(cams.map((c) => c.region).filter(Boolean))];
    const parts = [g.camera_ids.length + " kamera"];
    if (regions.length) parts.push(regions.length > 2 ? regions.length + " hudud" : regions.join(", "));
    parts.push(g.shared ? "Umumiy" : "Shaxsiy");
    if (!g.mine && g.owner_name) parts.push(g.owner_name);
    if (g.hidden) parts.push("+" + g.hidden + " yashirin");
    return parts.join(" · ");
  }

  render() {
    const all = groupStore.groups;
    $("sg-sub").textContent = all.length + " ta guruh";
    $("sg-list").innerHTML = all.length ? '<div class="sx-glist">' + all.map((g) =>
      '<div class="sx-grow" data-gid="' + g.id + '" tabindex="0">' +
        '<span class="sx-gicon" style="--g-color:' + esc(g.color || "") + '">' + icon("grid") + "</span>" +
        '<span class="sx-grow__txt"><span class="label-md ellipsis">' + esc(g.name) + "</span>" +
          '<span class="body-xs t-tertiary ellipsis">' + esc(this.meta(g)) + "</span></span>" +
        (this.onWall(g) ? '<span class="label-sm t-success sx-grow__wall">Video devorda</span>'
          : '<span class="body-sm t-tertiary sx-grow__wall">–</span>') +
        '<button class="icon-btn icon-btn--sm" data-more data-tip="Amallar" aria-haspopup="menu">' + icon("dots-horizontal", "sm") + "</button>" +
      "</div>").join("") + "</div>"
      : emptyState({ type: "layer-group", title: "Hali guruh yoʻq", text: "Kameralarni guruhlab xarita va devorda tez oching" });
    tooltip.label($("sg-list"));
  }

  rowMenu(anchor, g) {
    const edit = g.can_edit !== false;
    menu(anchor, [
      { label: "Xaritada koʻrsatish", icon: "map", onClick: () => { showTab("map"); groupStore.openRegionsOf(g); groupStore.setFilter(g.id); } },
      { label: "Video devorda ochish", icon: "grid", onClick: () => groupStore.openOnWall(g) },
      { label: "Tahrirlash", icon: "pen", disabled: !edit, onClick: () => groupStore.openEditor(g) },
      { label: g.shared ? "Shaxsiy qilish" : "Umumiy qilish", icon: g.shared ? "lock" : "users", disabled: !edit,
        onClick: () => this.toggleShared(g) },
      "sep",
      { label: "Oʻchirish", icon: "trash", danger: true, disabled: !edit, onClick: () => this.remove(g) },
    ], { place: "bottom-end" });
  }

  async toggleShared(g) {
    try {
      groupStore.replace(await api("/api/groups/" + g.id, { method: "PATCH", body: JSON.stringify({ shared: !g.shared }) }));
      toast(g.shared ? "Guruh shaxsiy qilindi" : "Guruh hamma uchun ochildi");
    } catch (e) { toast(e.message, { tone: "error" }); }
  }

  async remove(g) {
    const ok = await confirmDialog({ title: "“" + g.name + "” guruhi oʻchirilsinmi?",
      text: "Faqat guruh oʻchadi — kameralarga tegilmaydi.", ok: "Oʻchirish", danger: true });
    if (!ok) return;
    try { await api("/api/groups/" + g.id, { method: "DELETE" }); }
    catch (e) { toast(e.message, { tone: "error" }); return; }
    groupStore.apply(groupStore.groups.filter((x) => x.id !== g.id));
    toast("Guruh oʻchirildi");
  }
}
