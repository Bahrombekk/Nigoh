/* ==========================================================================
   admin/settings.js — super-admin "Sozlamalar" sahifasi
   --------------------------------------------------------------------------
   Vazifasi:
     Katta platformalardagi admin panellar tuzilishi: chapda bo'limlar
     menyusi (guruhlangan), o'ngda bo'lim sarlavhasi, izohi va kartalar.
       Sozlamalar:  Umumiy, Kirish va xavfsizlik, Kuzatuv — /api/admin/settings
                    ro'yxatidan shakl (guruh bo'yicha); o'zgarishlar pastdagi
                    "saqlanmagan o'zgarishlar" panelidan birga saqlanadi;
       Boshqaruv:   Foydalanuvchilar (yaratish, tahrirlash, bloklash, o'chirish,
                    hududlar), Kamera guruhlari (hammasi; xaritada/devorda
                    ochish, tahrirlash — kameralari bilan, umumiy qilish, o'chirish);
       Tizim:       Holat (server, MediaMTX + sinxronlash, tekshiruv, baza, disk,
                    jadvallar), Loglar (toifa/daraja/davr/qidiruv),
                    O'zgarishlar jurnali (audit).

   Eksport:
     SettingsPage        — klass: show, showTab, load* / render* metodlari
     settingsPage        — yagona nusxa
     loadSettingsPage()  — bo'limga kirilganda (layout/tabs.js)
     applySiteName(name) — sayt nomini sarlavha va logotiplarga qo'yish

   Bog'liqliklar:
     import: ../core/state.js, ../core/api.js, ../core/modals.js,
             ../map/groups.js (groupStore, loadGroups), ../layout/tabs.js (showTab)

   DOM: #settings-view, #st-tabs (chap menyu), .st-panel, #su-*, #sg-*, #ss-*,
        #sl-*, #sa-list, #sx-form-*, #sx-bar, #sx-save, #sx-cancel, #user-modal,
        #um-*, .site-name
   Backend: /api/admin/users, /api/admin/regions, /api/groups, /api/admin/status,
            /api/admin/db, /api/admin/mediamtx/sync, /api/admin/logs,
            /api/admin/audit, /api/admin/settings

   Qoidalar / tuzoqlar:
     - Faqat admin: menyu bandi operator/mehmonga yashirin (.admin-only),
       tabs.js operatorni xaritaga qaytaradi, server ham 403 beradi.
     - Tanlangan ichki yorliq brauzerda eslab qolinadi (try/catch).
     - Parollar hech qachon ko'rsatilmaydi; tahrirda bo'sh parol — o'zgarmaydi.
   ========================================================================== */
import { $, esc, state, toast } from "../core/state.js";
import { api } from "../core/api.js";
import { closeModal, openModal } from "../core/modals.js";
import { groupStore, loadGroups } from "../map/groups.js";
import { showTab } from "../layout/tabs.js";

const p2 = (n) => String(n).padStart(2, "0");
function fmtTime(iso, withYear) {
  if (!iso) return "—";
  const t = new Date(iso);
  if (isNaN(t)) return "—";
  return p2(t.getDate()) + "." + p2(t.getMonth() + 1) + (withYear ? "." + t.getFullYear() : "") +
    " " + p2(t.getHours()) + ":" + p2(t.getMinutes());
}
function ago(iso) {
  if (!iso) return "hech qachon";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "hozirgina";
  if (s < 3600) return Math.round(s / 60) + " daqiqa oldin";
  if (s < 86400) return Math.round(s / 3600) + " soat oldin";
  if (s < 30 * 86400) return Math.round(s / 86400) + " kun oldin";
  return fmtTime(iso, true);
}
const ICO = {
  edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  del: '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  unlock: '<svg viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>',
  map: '<svg viewBox="0 0 24 24"><path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>',
  wall: '<svg viewBox="0 0 24 24"><rect width="7.5" height="7.5" x="3" y="3" rx="1.6"/><rect width="7.5" height="7.5" x="13.5" y="3" rx="1.6"/><rect width="7.5" height="7.5" x="13.5" y="13.5" rx="1.6"/><rect width="7.5" height="7.5" x="3" y="13.5" rx="1.6"/></svg>',
};
const SECTIONS = ["general", "access", "monitoring", "users", "groups", "status", "logs", "audit"];
const OLD_TAB = { site: "general", system: "status" };          // avvalgi versiyada eslab qolingan nomlar
const FORM_OF = { "Sayt": "general", "Kirish": "access", "Kuzatuv": "monitoring" };   // sozlama guruhi -> bo'lim

const ACTIONS = {
  "settings.update": "Sozlamalar o'zgartirildi", "user.create": "Foydalanuvchi yaratildi",
  "user.update": "Foydalanuvchi o'zgartirildi", "user.delete": "Foydalanuvchi o'chirildi",
  "group.create": "Guruh yaratildi", "group.update": "Guruh o'zgartirildi", "group.delete": "Guruh o'chirildi",
};

export function applySiteName(name) {
  if (!name) return;
  document.querySelectorAll(".site-name").forEach((el) => { el.textContent = name; });
  document.title = name + " — video nazorat tizimi";
}

export class SettingsPage {
  constructor() {
    this.tab = "general";
    try {
      const saved = localStorage.getItem("nigoh.settings-tab") || "general";
      this.tab = SECTIONS.includes(OLD_TAB[saved] || saved) ? (OLD_TAB[saved] || saved) : "general";
    } catch (e) { /* xotira yopiq */ }
    this.users = [];
    this.regions = [];
    this.editing = null;          // tahrirlanayotgan foydalanuvchi (null — yangi)
    this.settings = [];
    this.draft = {};              // sayt sozlamalari: o'zgartirilgan, saqlanmagan qiymatlar
    this.logTimer = 0;
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;
    document.querySelectorAll("#st-tabs button").forEach((b) =>
      b.addEventListener("click", () => this.showTab(b.dataset.st)));
    $("su-new").addEventListener("click", () => this.openUser(null));
    $("su-q").addEventListener("input", () => this.renderUsers());
    $("um-role").addEventListener("change", () => this.syncRoleBox());
    $("um-save").addEventListener("click", () => this.saveUser());
    $("sg-new").addEventListener("click", () => groupStore.openPicker([], "Yangi guruh"));
    $("sg-q").addEventListener("input", () => this.renderGroups());
    document.addEventListener("groups:changed", () => { if (state.tab === "settings") this.renderGroups(); });
    ["sl-cat", "sl-level", "sl-hours"].forEach((id) => $(id).addEventListener("change", () => this.loadLogs()));
    $("sl-q").addEventListener("input", () => {
      clearTimeout(this.logTimer);
      this.logTimer = setTimeout(() => this.loadLogs(), 350);
    });
    $("sx-save").addEventListener("click", () => this.saveSettings());
    $("sx-cancel").addEventListener("click", () => { this.draft = {}; this.renderSettings(); });
  }

  show() {
    this.init();
    this.showTab(this.tab);
  }

  showTab(tab) {
    if (!SECTIONS.includes(tab)) tab = "general";
    this.tab = tab;
    try { localStorage.setItem("nigoh.settings-tab", tab); } catch (e) { /* xotira yopiq */ }
    document.querySelectorAll("#st-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.st === tab));
    document.querySelectorAll("#settings-view .st-panel").forEach((el) => { el.hidden = el.dataset.st !== tab; });
    $("settings-view").scrollTop = 0;
    if (["general", "access", "monitoring"].includes(tab)) {
      if (this.settings.length) this.renderSettings(); else this.loadSettings();
    }
    if (tab === "users") this.loadUsers();
    if (tab === "groups") loadGroups().then(() => this.renderGroups());
    if (tab === "status") this.loadSystem();
    if (tab === "logs") this.loadLogs();
    if (tab === "audit") this.loadAudit();
  }

  /* ================= Foydalanuvchilar ================= */

  async loadUsers() {
    try {
      const [u, r] = await Promise.all([api("/api/admin/users"),
        this.regions.length ? null : api("/api/admin/regions")]);
      this.users = u.users;
      if (r) this.regions = r.regions.map((x) => x.name);
    } catch (e) { toast(e.message, true); return; }
    this.renderUsers();
  }

  renderUsers() {
    const q = $("su-q").value.trim().toLowerCase();
    const list = this.users.filter((u) => !q || (u.username + " " + u.full_name).toLowerCase().includes(q));
    const admins = this.users.filter((u) => u.role === "admin").length;
    const blocked = this.users.filter((u) => !u.is_active).length;
    $("su-sub").textContent = this.users.length + " ta · " + admins + " administrator · " +
      (this.users.length - admins) + " operator" + (blocked ? " · " + blocked + " bloklangan" : "");
    $("su-table").innerHTML = '<thead><tr><th>Foydalanuvchi</th><th>Rol</th><th>Hududlar</th>' +
      '<th>Holat</th><th>Oxirgi kirish</th><th>Yaratilgan</th><th class="act"></th></tr></thead><tbody>' +
      (list.length ? list.map((u) => '<tr data-id="' + u.id + '"' + (u.is_active ? "" : ' class="off"') + ">" +
        '<td><div class="st-who"><span class="av">' + esc(u.username.slice(0, 2).toUpperCase()) + "</span>" +
          "<span><b>" + esc(u.username) + "</b><i>" + esc(u.full_name || "—") + "</i></span></div></td>" +
        '<td><span class="st-badge ' + u.role + '">' + (u.role === "admin" ? "Administrator" : "Operator") + "</span></td>" +
        "<td class=\"st-regions\">" + (u.role === "admin" ? '<i class="muted">hamma hududlar</i>'
          : u.regions.length ? u.regions.map((r) => '<span class="chip">' + esc(r) + "</span>").join("")
          : '<i class="bad">hudud biriktirilmagan</i>') + "</td>" +
        '<td><span class="st-state ' + (u.is_active ? "ok" : "bad") + '">' + (u.is_active ? "Faol" : "Bloklangan") + "</span></td>" +
        '<td title="' + esc(fmtTime(u.last_login_at, true)) + '">' + ago(u.last_login_at) + "</td>" +
        "<td>" + fmtTime(u.created_at, true) + "</td>" +
        '<td class="act">' +
          '<button class="st-ic" data-a="edit" title="Tahrirlash">' + ICO.edit + "</button>" +
          '<button class="st-ic" data-a="block" title="' + (u.is_active ? "Bloklash" : "Faollashtirish") + '">' +
            (u.is_active ? ICO.lock : ICO.unlock) + "</button>" +
          '<button class="st-ic bad" data-a="del" title="O\'chirish">' + ICO.del + "</button></td></tr>").join("")
        : '<tr><td colspan="7" class="empty">Foydalanuvchi topilmadi.</td></tr>') + "</tbody>";
    $("su-table").querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", () => {
      const u = this.users.find((x) => x.id === Number(b.closest("tr").dataset.id));
      if (b.dataset.a === "edit") this.openUser(u);
      if (b.dataset.a === "block") this.toggleBlock(u);
      if (b.dataset.a === "del") this.deleteUser(u);
    }));
  }

  openUser(u) {
    this.editing = u;
    $("um-title").textContent = u ? "Foydalanuvchini tahrirlash" : "Yangi foydalanuvchi";
    $("um-login").value = u ? u.username : "";
    $("um-name").value = u ? u.full_name : "";
    $("um-pass").value = "";
    $("um-pass").placeholder = u ? "bo'sh — o'zgarmaydi" : "kamida 6 belgi";
    $("um-role").value = u ? u.role : "operator";
    $("um-active").checked = u ? u.is_active : true;
    const mine = new Set(u ? u.regions : []);
    $("um-regions").innerHTML = this.regions.map((r) =>
      '<label class="gm-check"><input type="checkbox" value="' + esc(r) + '"' + (mine.has(r) ? " checked" : "") +
      "> " + esc(r) + "</label>").join("");
    this.syncRoleBox();
    $("um-err").classList.remove("show");
    openModal("user-modal");
    setTimeout(() => $(u ? "um-name" : "um-login").focus(), 60);
  }

  syncRoleBox() { $("um-regions-box").hidden = $("um-role").value !== "operator"; }

  async saveUser() {
    const body = {
      username: $("um-login").value.trim(), full_name: $("um-name").value.trim(),
      role: $("um-role").value, is_active: $("um-active").checked,
      regions: [...$("um-regions").querySelectorAll("input:checked")].map((i) => i.value),
    };
    const pass = $("um-pass").value;
    if (pass) body.password = pass;
    const fail = (m) => { $("um-err").textContent = m; $("um-err").classList.add("show"); };
    if (!body.username) { fail("Login kiriting"); return; }
    if (!this.editing && !pass) { fail("Parol kiriting"); return; }
    try {
      if (this.editing) await api("/api/admin/users/" + this.editing.id, { method: "PUT", body: JSON.stringify(body) });
      else await api("/api/admin/users", { method: "POST", body: JSON.stringify(body) });
    } catch (e) { fail(e.message); return; }
    closeModal("user-modal");
    toast(this.editing ? "Foydalanuvchi saqlandi" : "“" + body.username + "” yaratildi");
    this.loadUsers();
  }

  async toggleBlock(u) {
    const verb = u.is_active ? "bloklansinmi? U tizimga kira olmaydi, ochiq sessiyasi yopiladi." : "faollashtirilsinmi?";
    if (!confirm("“" + u.username + "” " + verb)) return;
    try {
      await api("/api/admin/users/" + u.id, { method: "PUT", body: JSON.stringify({
        username: u.username, full_name: u.full_name, role: u.role, regions: u.regions, is_active: !u.is_active }) });
    } catch (e) { toast(e.message, true); return; }
    toast(u.is_active ? "Bloklandi" : "Faollashtirildi");
    this.loadUsers();
  }

  async deleteUser(u) {
    if (!confirm("“" + u.username + "” o‘chirilsinmi? Uning shaxsiy guruhlari ham o‘chadi.")) return;
    try { await api("/api/admin/users/" + u.id, { method: "DELETE" }); }
    catch (e) { toast(e.message, true); return; }
    toast("Foydalanuvchi o‘chirildi");
    this.loadUsers();
  }

  /* ================= Guruhlar ================= */

  renderGroups() {
    const q = $("sg-q").value.trim().toLowerCase();
    const all = groupStore.groups;
    const list = all.filter((g) => !q || (g.name + " " + g.owner_name).toLowerCase().includes(q));
    const shared = all.filter((g) => g.shared).length;
    $("sg-sub").textContent = all.length + " ta guruh · " + shared + " umumiy · " +
      new Set(all.map((g) => g.owner_name)).size + " egasi";
    $("sg-table").innerHTML = '<thead><tr><th>Guruh</th><th>Egasi</th><th>Ko‘rinishi</th><th>Kameralar</th>' +
      '<th>Yangilangan</th><th class="act"></th></tr></thead><tbody>' +
      (list.length ? list.map((g) => {
        const cams = g.camera_ids.map((id) => state.byId.get(id)).filter(Boolean);
        const down = cams.filter((c) => c.online === false).length;
        return '<tr data-id="' + g.id + '">' +
          '<td><div class="st-who"><i class="gdot" style="background:' + (g.color || "var(--accent)") + '"></i><b>' + esc(g.name) + "</b></div></td>" +
          "<td>" + esc(g.owner_name || "—") + (g.mine ? ' <i class="muted">(siz)</i>' : "") + "</td>" +
          '<td><button class="st-toggle' + (g.shared ? " on" : "") + '" data-a="share" title="Boshqalar ko‘rsinmi">' +
            (g.shared ? "Umumiy" : "Shaxsiy") + "</button></td>" +
          '<td><span class="st-count">' + (cams.length - down) + "/" + cams.length + "</span>" +
            (down ? ' <span class="bad">' + down + " uzilgan</span>" : "") +
            (g.hidden ? ' <i class="muted">+' + g.hidden + " yashirin</i>" : "") + "</td>" +
          "<td>" + fmtTime(g.updated_at, true) + "</td>" +
          '<td class="act">' +
            '<button class="st-ic" data-a="map" title="Xaritada ko‘rsatish">' + ICO.map + "</button>" +
            '<button class="st-ic" data-a="wall" title="Video devorda ochish">' + ICO.wall + "</button>" +
            '<button class="st-ic" data-a="edit" title="Tahrirlash">' + ICO.edit + "</button>" +
            '<button class="st-ic bad" data-a="del" title="O‘chirish">' + ICO.del + "</button></td></tr>";
      }).join("") : '<tr><td colspan="6" class="empty">' + (all.length ? "Topilmadi." : "Hali guruh yo‘q.") + "</td></tr>") +
      "</tbody>";
    $("sg-table").querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", async () => {
      const g = groupStore.byId.get(Number(b.closest("tr").dataset.id));
      if (!g) return;
      const a = b.dataset.a;
      if (a === "map") { showTab("map"); groupStore.openRegionsOf(g); groupStore.setFilter(g.id); }
      if (a === "wall") groupStore.openOnWall(g);
      if (a === "edit") groupStore.openEditor(g);
      if (a === "share") {
        try {
          groupStore.replace(await api("/api/groups/" + g.id, { method: "PATCH",
            body: JSON.stringify({ shared: !g.shared }) }));
        } catch (e) { toast(e.message, true); }
      }
      if (a === "del") {
        if (!confirm("“" + g.name + "” guruhi o‘chirilsinmi? Kameralarga tegilmaydi.")) return;
        try { await api("/api/groups/" + g.id, { method: "DELETE" }); }
        catch (e) { toast(e.message, true); return; }
        groupStore.apply(groupStore.groups.filter((x) => x.id !== g.id));
        toast("Guruh o‘chirildi");
      }
    }));
  }

  /* ================= Tizim va loglar ================= */

  async loadSystem() {
    let st = null, db = null;
    try { [st, db] = await Promise.all([api("/api/admin/status"), api("/api/admin/db")]); }
    catch (e) { toast(e.message, true); }
    this.renderSystem(st, db);
    const tables = db ? db.tables : [];
    $("ss-db-sub").textContent = db ? db.database + " · " + tables.length + " jadval · " +
      (db.size_bytes / 1048576).toFixed(1) + " MB · migratsiyalar: " + db.migrations.length : "—";
    $("ss-db").innerHTML = '<thead><tr><th>Jadval</th><th>Qatorlar (taxminiy)</th><th>Hajm</th></tr></thead><tbody>' +
      tables.slice().sort((a, b) => b.bytes - a.bytes).map((t) =>
        "<tr><td><b>" + esc(t.name) + "</b></td><td>" + Number(t.rows).toLocaleString("ru-RU") + "</td><td>" +
        (t.bytes >= 1048576 ? (t.bytes / 1048576).toFixed(1) + " MB" : Math.round(t.bytes / 1024) + " KB") +
        "</td></tr>").join("") + "</tbody>";
  }

  renderSystem(st, db) {
    const card = (title, value, note, cls, extra) =>
      '<div class="st-card ' + (cls || "") + '"><span class="k">' + title + '</span><b>' + value + "</b>" +
      '<span class="n">' + note + "</span>" + (extra || "") + "</div>";
    if (!st) { $("ss-cards").innerHTML = '<div class="empty">Holatni olib bo‘lmadi.</div>'; return; }
    const h = st.health || {};
    const nodes = st.nodes || [];
    const stalled = (st.stalled || []).length;
    $("ss-cards").innerHTML = [
      card("Versiya", "v" + esc(st.version), "Server ishlayapti", "ok"),
      card("MediaMTX", st.mediamtx ? "Ishlayapti" : "Javob yo‘q",
           nodes.map((n) => esc(n.name) + ": " + n.ready + " oqim" + (n.stalled ? ", " + n.stalled + " muzlagan" : "")).join(" · ") || "tugun yo‘q",
           st.mediamtx ? (stalled ? "warn" : "ok") : "bad",
           '<button class="btn sm" id="ss-sync">Sinxronlash</button>'),
      card("Holat tekshiruvi", (h.online ?? "—") + " / " + (h.checked ?? "—"),
           "onlayn manzillar · " + (h.duration_ms != null ? (h.duration_ms / 1000).toFixed(1) + " s" : "—") +
           " · " + ago(h.at),
           // Onlayn ulushi: 90% dan past — diqqat, 60% dan past — jiddiy (masalan tarmoq uzilishi).
           !h.checked ? "warn" : h.online / h.checked >= 0.9 ? "ok" : h.online / h.checked >= 0.6 ? "warn" : "bad"),
      card("Baza", db ? "PostgreSQL " + esc(String(db.server_version).split(" ")[0]) : "—",
           db ? "sxema v" + db.schema_version + (db.up_to_date ? " · yangi" : " · yangilash kerak") +
             " · " + st.disk.db_mb + " MB" : "", db && !db.up_to_date ? "warn" : "ok"),
      card("Disk", (st.disk.db_mb + st.disk.log_mb + st.disk.snapshots_mb).toFixed(0) + " MB",
           "baza " + st.disk.db_mb + " · loglar " + st.disk.log_mb + " · suratlar " + st.disk.snapshots_mb + " MB"),
    ].join("");
    const sync = $("ss-sync");
    if (sync) sync.addEventListener("click", async () => {
      sync.disabled = true;
      try { await api("/api/admin/mediamtx/sync", { method: "POST" }); toast("MediaMTX sinxronlandi"); }
      catch (e) { toast(e.message, true); }
      sync.disabled = false;
    });
  }

  async loadLogs() {
    const sel = $("sl-cat");
    if (!sel.options.length) {
      sel.innerHTML = [["errors", "Xatolar (hammasi)"], ["app", "Ilova"], ["camera", "Kamera"],
        ["security", "Xavfsizlik"], ["database", "Baza"], ["stats", "Statistika"], ["access", "HTTP so‘rovlar"],
        ["mediamtx", "MediaMTX"]].map(([v, t]) => '<option value="' + v + '">' + t + "</option>").join("");
    }
    const qs = new URLSearchParams({ category: sel.value, hours: $("sl-hours").value, limit: "300" });
    if ($("sl-level").value) qs.set("level", $("sl-level").value);
    if ($("sl-q").value.trim()) qs.set("q", $("sl-q").value.trim());
    let res;
    try { res = await api("/api/admin/logs?" + qs); } catch (e) { toast(e.message, true); return; }
    $("sl-sub").textContent = res.count + " ta yozuv" + (res.count >= res.limit ? " (oxirgi " + res.limit + ")" : "");
    const skip = new Set(["ts", "level", "category", "service", "event", "msg", "message"]);
    $("sl-table").innerHTML = '<thead><tr><th>Vaqt</th><th>Daraja</th><th>Xizmat</th><th>Hodisa</th><th>Tafsilot</th></tr></thead><tbody>' +
      (res.items.length ? res.items.map((r) => {
        const rest = Object.entries(r).filter(([k]) => !skip.has(k))
          .map(([k, v]) => k + "=" + (typeof v === "object" ? JSON.stringify(v) : v)).join("  ");
        return '<tr class="lv-' + esc((r.level || "").toLowerCase()) + '"><td>' + fmtTime(r.ts) + "</td>" +
          '<td><span class="lv">' + esc(r.level || "") + "</span></td><td>" + esc(r.service || "") + "</td>" +
          "<td><b>" + esc(r.event || r.msg || r.message || "") + "</b></td>" +
          '<td class="rest" title="' + esc(rest) + '">' + esc(rest) + "</td></tr>";
      }).join("") : '<tr><td colspan="5" class="empty">Bu davrda yozuv yo‘q.</td></tr>') + "</tbody>";
  }

  async loadAudit() {
    let res;
    try { res = await api("/api/admin/audit?limit=100"); } catch (e) { return; }
    const show = (v) => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
    $("sa-list").innerHTML = res.items.length ? res.items.map((a) => {
      const keys = new Set([...Object.keys(a.before || {}), ...Object.keys(a.after || {})]);
      const diff = [...keys].filter((k) => show((a.before || {})[k]) !== show((a.after || {})[k]))
        .map((k) => "<li><b>" + esc(k) + "</b>: " +
          (a.before && k in a.before ? '<s>' + esc(show(a.before[k])) + "</s> → " : "") +
          esc(a.after && k in a.after ? show(a.after[k]) : "—") + "</li>").join("");
      return '<div class="sa-row"><div class="sa-h"><b>' + esc(ACTIONS[a.action] || a.action) + "</b>" +
        "<span>" + fmtTime(a.ts, true) + "</span></div>" +
        '<div class="sa-who">' + esc(a.actor) + (a.ip ? " · " + esc(a.ip) : "") +
        (a.entity_id ? " · #" + esc(a.entity_id) : "") + "</div>" + (diff ? "<ul>" + diff + "</ul>" : "") + "</div>";
    }).join("") : '<div class="empty">Hali o‘zgarish yo‘q.</div>';
  }

  /* ================= Sayt sozlamalari ================= */

  async loadSettings() {
    try { this.settings = (await api("/api/admin/settings")).settings; }
    catch (e) { toast(e.message, true); return; }
    this.draft = {};
    this.renderSettings();
  }

  /* Sozlamalar guruhi bo'yicha uch bo'limga chiziladi; qoralama (draft) umumiy —
     bo'lim almashsa ham saqlanmagan o'zgarishlar yo'qolmaydi. */
  renderSettings() {
    Object.entries(FORM_OF).forEach(([group, sec]) => {
      const box = $("sx-form-" + sec);
      const list = this.settings.filter((s) => s.group === group);
      box.innerHTML = list.length ? list.map((s) => this.settingRow(s)).join("")
        : '<div class="empty">Bu bo‘limda sozlama yo‘q.</div>';
    });
    const root = $("settings-view");
    root.querySelectorAll(".sx-in input[data-k]").forEach((el) => el.addEventListener("input", () => {
      const s = this.settings.find((x) => x.key === el.dataset.k);
      const val = s.kind === "int" ? (el.value === "" ? NaN : Number(el.value)) : el.value;
      this.setDraft(s, val, el.closest(".sx-row"));
    }));
    root.querySelectorAll(".sx-in .switch[data-k]").forEach((el) => el.addEventListener("click", () => {
      const s = this.settings.find((x) => x.key === el.dataset.k);
      const val = !el.classList.contains("on");
      el.classList.toggle("on", val);
      el.setAttribute("aria-checked", String(val));
      this.setDraft(s, val, el.closest(".sx-row"));
    }));
    root.querySelectorAll("[data-reset]").forEach((b) => b.addEventListener("click", () =>
      this.saveSettings({ [b.dataset.reset]: null })));
    this.syncSave();
  }

  settingRow(s) {
    const v = s.key in this.draft ? this.draft[s.key] : s.value;
    const input = s.kind === "bool"
      ? '<button class="switch' + (v ? " on" : "") + '" role="switch" aria-checked="' + v + '" data-k="' + s.key + '"><i></i></button>'
      : '<input data-k="' + s.key + '" type="' + (s.kind === "int" ? "number" : "text") + '" value="' + esc(String(v)) + '"' +
        (s.min != null ? ' min="' + s.min + '"' : "") + (s.max != null && s.kind === "int" ? ' max="' + s.max + '"' : "") +
        (s.kind === "str" && s.max ? ' maxlength="' + s.max + '"' : "") + ">" + (s.unit ? '<span class="u">' + s.unit + "</span>" : "");
    const dflt = s.kind === "bool" ? (s.default ? "yoqiq" : "o‘chiq") : s.default + (s.unit ? " " + s.unit : "");
    return '<div class="sx-row' + (s.key in this.draft ? " dirty" : "") + '">' +
      '<div class="sx-t"><b>' + esc(s.label) + (s.changed ? '<span class="sx-tag">o‘zgartirilgan</span>' : "") + "</b>" +
        "<p>" + esc(s.help) + "</p>" +
        '<span class="sx-meta">Standart: ' + esc(String(dflt)) + (s.kind === "int" ? " · ruxsat: " + s.min + "–" + s.max : "") +
        (s.changed ? " · " + esc(s.updated_by || "—") + ", " + fmtTime(s.updated_at, true) +
          ' <button class="sx-reset" data-reset="' + s.key + '">standartga qaytarish</button>' : "") + "</span></div>" +
      '<div class="sx-in">' + input + "</div></div>";
  }

  setDraft(s, val, row) {
    if (val === s.value) delete this.draft[s.key]; else this.draft[s.key] = val;
    if (row) row.classList.toggle("dirty", s.key in this.draft);
    this.syncSave();
  }

  syncSave() {
    const n = Object.keys(this.draft).length;
    $("sx-bar").hidden = !n;
    $("sx-bar-n").textContent = n + " ta saqlanmagan o‘zgarish";
  }

  async saveSettings(values) {
    const body = values || this.draft;
    if (!Object.keys(body).length) return;
    let res;
    try { res = await api("/api/admin/settings", { method: "PUT", body: JSON.stringify({ values: body }) }); }
    catch (e) { toast(e.message, true); return; }
    this.settings = res.settings;
    this.draft = {};
    this.renderSettings();
    const name = this.settings.find((s) => s.key === "site_name");
    if (name) applySiteName(name.value);
    toast(res.changed.length ? "Saqlandi — darhol qo‘llandi" : "O‘zgarish yo‘q");
  }
}

export const settingsPage = new SettingsPage();

export function loadSettingsPage() { settingsPage.show(); }
