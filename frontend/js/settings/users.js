/* ==========================================================================
   settings/users.js — Foydalanuvchilar (06.03) va "Yangi foydalanuvchi" (06.10)
   --------------------------------------------------------------------------
   Vazifasi:
     Jadval: Foydalanuvchi (avatar + F.I.Sh + login) · Rol tegi (ustun
     sarlavhasida InfoTip — rollar izohi) · Hududlar · Holat (Faol /
     Bloklangan) · Oxirgi kirish · ⋯ menyu: Tahrirlash, Parolni tiklash,
     Bloklash/Faollashtirish, Oʻchirish (confirmDialog).
     #user-modal — yaratish va tahrirlash (rol, hududlar — ko'p tanlovli
     popover, vaqtinchalik parol). Yaratilgach va parol tiklangach parol
     BIR MARTA dialogda ko'rsatiladi (nusxalash tugmasi bilan).

   Eksport: UsersSection (klass)
   Backend: GET/POST /api/admin/users, PUT/DELETE /api/admin/users/{id},
            POST /api/admin/users/{id}/reset-password (yo'q bo'lsa — PUT bilan
            vaqtinchalik parol), GET /api/admin/regions
   Qoidalar:
     - O'zini bloklash/o'chirish menyuda o'chiq (server ham oxirgi adminni saqlaydi).
     - Parollar ro'yxatda hech qachon ko'rsatilmaydi.
   ========================================================================== */
import { $, esc, state } from "../core/state.js";
import { api } from "../core/api.js";
import { closeModal, openModal } from "../core/modals.js";
import { icon } from "../core/icons.js";
import { toast, menu, popover, closePopovers, confirmDialog, infotip, emptyState, tooltip } from "../core/ui.js";
import { agoText, initials, tempPassword, copyText, bindSearch, whenText } from "./util.js";

export const ROLE_LABEL = { admin: "Administrator", operator: "Operator", viewer: "Kuzatuvchi" };
const ROLE_HINT = {
  admin: "Hamma boʻlimlar va sozlamalar",
  operator: "Oʻz hududlari: xarita, video devor, tasdiqlash",
  viewer: "Oʻz hududlarini faqat koʻradi",
};
const ROLE_TIP = "Administrator — barcha boʻlimlar. Operator — oʻz hududlari: xarita, video devor, tasdiqlash. Kuzatuvchi — faqat koʻrish.";

export class UsersSection {
  constructor() {
    this.users = [];
    this.regions = [];
    this.editing = null;
    this.pickRegions = [];
    this.bound = false;
  }

  bind() {
    if (this.bound) return;
    this.bound = true;
    bindSearch($("su-search"), () => this.render());
    $("su-new").addEventListener("click", () => this.open(null));
    $("um-role").addEventListener("change", () => this.syncRole());
    $("um-regions").addEventListener("click", (e) => this.openRegionPicker(e.currentTarget));
    $("um-pass-gen").addEventListener("click", () => { $("um-pass").value = tempPassword(); });
    document.querySelector("#user-modal form").addEventListener("submit", (e) => { e.preventDefault(); this.save(); });
    $("su-table").addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-id]");
      if (!tr || e.target.closest(".infotip")) return;
      const u = this.users.find((x) => x.id === Number(tr.dataset.id));
      if (!u) return;
      const more = e.target.closest("[data-more]");
      if (more) this.rowMenu(more, u); else this.open(u);
    });
  }

  async load() {
    this.bind();
    if (!this.users.length) $("su-table").innerHTML = '<tbody><tr><td colspan="6">' +
      '<span class="skeleton" style="display:block;height:12px;width:40%"></span></td></tr></tbody>';
    try {
      const [u, r] = await Promise.all([api("/api/admin/users"),
        this.regions.length ? null : api("/api/admin/regions").catch(() => null)]);
      this.users = u.users || [];
      if (r) this.regions = (r.regions || []).map((x) => x.name || x);
    } catch (e) { toast(e.message, { tone: "error" }); return; }
    this.render();
  }

  render() {
    const q = $("su-q").value.trim().toLowerCase();
    const list = this.users.filter((u) => !q || (u.username + " " + (u.full_name || "")).toLowerCase().includes(q));
    const admins = this.users.filter((u) => u.role === "admin").length;
    $("su-sub").textContent = this.users.length + " ta · " + admins + " administrator";
    const me = state.admin && state.admin.username;
    $("su-table").innerHTML =
      '<thead><tr><th>Foydalanuvchi</th><th class="sx-c-role"><span class="sx-th">Rol' + infotip(ROLE_TIP, "Rollar") + "</span></th>" +
      '<th class="sx-c-reg">Hududlar</th><th class="sx-c-state">Holat</th><th class="sx-c-last">Oxirgi kirish</th><th class="sx-c-act"><span class="sr-only">Amallar</span></th></tr></thead><tbody>' +
      (list.length ? list.map((u) => {
        const name = u.full_name || u.username;
        return '<tr data-id="' + u.id + '">' +
          '<td><div class="sx-who"><span class="avatar">' + esc(initials(name)) + '</span><span class="sx-who__txt">' +
            '<span class="label-sm ellipsis t-primary">' + esc(name) + (u.username === me ? ' <span class="t-tertiary">(siz)</span>' : "") + "</span>" +
            '<span class="mono-xs t-tertiary ellipsis">' + esc(u.username) + "</span></span></div></td>" +
          '<td class="sx-c-role"><span class="sx-tag' + (u.role === "admin" ? " sx-tag--brand" : "") + '">' + esc(ROLE_LABEL[u.role] || u.role) + "</span></td>" +
          '<td class="sx-c-reg"><span class="ellipsis sx-reg">' + (u.role === "admin" ? "Hamma hududlar"
            : u.regions && u.regions.length ? esc(u.regions.join(", ")) : '<span class="t-warning">Hudud biriktirilmagan</span>') + "</span></td>" +
          '<td class="sx-c-state">' + (u.is_active ? '<span class="badge" data-status="online"><span class="dot"></span>Faol</span>'
            : '<span class="badge" data-status="disabled"><span class="dot"></span>Bloklangan</span>') + "</td>" +
          '<td class="sx-c-last t-tertiary" data-tip="' + esc(u.last_login_at ? whenText(u.last_login_at) : "Hali kirmagan") + '">' + esc(agoText(u.last_login_at)) + "</td>" +
          '<td class="sx-c-act"><button class="icon-btn icon-btn--sm" data-more data-tip="Amallar" aria-haspopup="menu">' +
            icon("dots-horizontal", "sm") + "</button></td></tr>";
      }).join("") : '<tr class="sx-empty-row"><td colspan="6">' +
        emptyState({ type: "search", title: q ? "Foydalanuvchi topilmadi" : "Hali foydalanuvchi yoʻq",
          text: q ? "“" + q + "” boʻyicha mos login yoki F.I.Sh yoʻq" : "" }) + "</td></tr>") + "</tbody>";
    tooltip.label($("su-table"));
  }

  rowMenu(anchor, u) {
    const self = state.admin && state.admin.username === u.username;
    menu(anchor, [
      { label: "Tahrirlash", icon: "pen", onClick: () => this.open(u) },
      { label: "Parolni tiklash", icon: "key", onClick: () => this.resetPassword(u) },
      { label: u.is_active ? "Bloklash" : "Faollashtirish", icon: u.is_active ? "ban" : "circle-check",
        disabled: self, onClick: () => this.toggleBlock(u) },
      "sep",
      { label: "Oʻchirish", icon: "trash", danger: true, disabled: self, onClick: () => this.remove(u) },
    ], { place: "bottom-end", width: 220 });
  }

  /* ---------- 06.10 dialog ---------- */
  open(u) {
    this.bind();
    this.editing = u;
    $("um-title").textContent = u ? "Foydalanuvchini tahrirlash" : "Yangi foydalanuvchi";
    $("um-save").textContent = u ? "Saqlash" : "Yaratish";
    $("um-name").value = u ? u.full_name || "" : "";
    $("um-login").value = u ? u.username : "";
    $("um-role").value = u ? u.role : "operator";
    this.pickRegions = u ? [...(u.regions || [])] : [];
    $("um-pass-box").hidden = !!u;
    $("um-pass").value = u ? "" : tempPassword();
    $("um-err").hidden = true;
    $("um-login-field").classList.remove("is-error");
    $("um-login-hint").hidden = true;
    this.syncRole();
    openModal("user-modal");
    setTimeout(() => $("um-name").focus(), 40);
  }

  syncRole() {
    const role = $("um-role").value;
    $("um-role-hint").textContent = ROLE_HINT[role] || "";
    $("um-regions-box").hidden = role === "admin";
    this.syncRegionsText();
  }

  syncRegionsText() {
    const r = this.pickRegions;
    const el = $("um-regions-text");
    el.textContent = r.length ? r.join(", ") : "Hududni tanlang";
    el.classList.toggle("t-tertiary", !r.length);
  }

  openRegionPicker(anchor) {
    const wrap = document.createElement("div");
    wrap.className = "sx-regpick";
    wrap.setAttribute("role", "listbox");
    wrap.setAttribute("aria-multiselectable", "true");
    wrap.innerHTML = this.regions.length ? this.regions.map((r) =>
      '<label class="check-row sx-regpick__row"><input type="checkbox" class="check" value="' + esc(r) + '"' +
      (this.pickRegions.includes(r) ? " checked" : "") + "><span>" + esc(r) + "</span></label>").join("")
      : '<div class="body-sm t-tertiary" style="padding:8px">Hududlar roʻyxati yoʻq</div>';
    wrap.addEventListener("change", () => {
      this.pickRegions = [...wrap.querySelectorAll("input:checked")].map((i) => i.value);
      this.syncRegionsText();
    });
    const el = popover(anchor, wrap, { place: "bottom-start", width: anchor.offsetWidth, force: false });
    if (el) { el.style.zIndex = "calc(var(--z-modal) + 1)"; const f = el.querySelector("input"); if (f) f.focus(); }
  }

  fail(msg) {
    $("um-err-text").textContent = msg;
    $("um-err").hidden = false;
  }

  async save() {
    closePopovers();
    const u = this.editing;
    const body = {
      username: $("um-login").value.trim(), full_name: $("um-name").value.trim(),
      role: $("um-role").value, is_active: u ? u.is_active : true,
      regions: $("um-role").value === "admin" ? [] : this.pickRegions,
    };
    const pass = $("um-pass").value.trim();
    if (!u) body.password = pass;
    if (!body.username) {
      $("um-login-field").classList.add("is-error");
      $("um-login-hint").textContent = "Login kiriting";
      $("um-login-hint").hidden = false;
      $("um-login").focus();
      return;
    }
    if (!u && pass.length < 8) { this.fail("Parol kamida 8 belgi boʻlsin"); return; }
    const btn = $("um-save");
    btn.disabled = true;
    try {
      if (u) await api("/api/admin/users/" + u.id, { method: "PUT", body: JSON.stringify(body) });
      else await api("/api/admin/users", { method: "POST", body: JSON.stringify(body) });
    } catch (e) {
      this.fail(e.status === 422 && body.role === "viewer" ? "Server “Kuzatuvchi” rolini hali qabul qilmaydi" : e.message);
      btn.disabled = false;
      return;
    }
    btn.disabled = false;
    closeModal("user-modal");
    if (u) toast("Foydalanuvchi saqlandi");
    else this.showPassword(body.username, pass, "Foydalanuvchi yaratildi");
    this.load();
  }

  /* ---------- amallar ---------- */
  async resetPassword(u) {
    const ok = await confirmDialog({
      title: "“" + u.username + "” paroli tiklansinmi?",
      text: "Joriy parol va ochiq seanslar bekor boʻladi. Yangi vaqtinchalik parol bir marta koʻrsatiladi.",
      ok: "Parolni tiklash", icon: "key",
    });
    if (!ok) return;
    let pass = null;
    try {
      pass = (await api("/api/admin/users/" + u.id + "/reset-password", { method: "POST" })).password;
    } catch (e) {
      if (e.status !== 404 && e.status !== 405) { toast(e.message, { tone: "error" }); return; }
      // Eski backend: vaqtinchalik parolni o'zimiz yaratib PUT bilan qo'yamiz.
      pass = tempPassword();
      try {
        await api("/api/admin/users/" + u.id, { method: "PUT", body: JSON.stringify({
          username: u.username, full_name: u.full_name, role: u.role, regions: u.regions,
          is_active: u.is_active, password: pass }) });
      } catch (e2) { toast(e2.message, { tone: "error" }); return; }
    }
    this.showPassword(u.username, pass, "Parol tiklandi");
  }

  /* Vaqtinchalik parol — bir marta, nusxalash bilan. */
  showPassword(login, pass, title) {
    const bd = document.createElement("div");
    bd.className = "dialog-backdrop open";
    bd.innerHTML =
      '<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="sx-pw-title">' +
        '<div class="dialog__head"><h2 class="dialog__title" id="sx-pw-title">' + esc(title) + "</h2>" +
          '<button type="button" class="icon-btn icon-btn--sm dialog__close" data-x data-tip="Yopish">' + icon("xmark", "sm") + "</button></div>" +
        '<div class="field"><span class="field__label">Vaqtinchalik parol · <span class="mono">' + esc(login) + "</span></span>" +
          '<div class="input-wrap"><input class="input mono" readonly value="' + esc(pass) + '" aria-label="Vaqtinchalik parol">' +
          '<button type="button" class="icon-btn icon-btn--sm" data-copy data-tip="Nusxalash">' + icon("copy", "sm") + "</button></div></div>" +
        '<div class="alert alert--warning">' + icon("triangle-exclamation", "sm") +
          '<div class="alert__body"><span class="alert__title">Parol faqat hozir koʻrsatiladi</span>' +
          '<span class="alert__text">Nusxalab foydalanuvchiga yetkazing — keyin uni koʻrib boʻlmaydi.</span></div></div>' +
        '<div class="dialog__actions"><button type="button" class="btn btn--secondary" data-copy>' + icon("copy", "sm") + "Nusxalash</button>" +
          '<button type="button" class="btn btn--primary" data-x>Tayyor</button></div></div>';
    document.body.appendChild(bd);
    tooltip.label(bd);
    const close = () => { document.removeEventListener("keydown", onKey, true); bd.remove(); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", onKey, true);
    bd.addEventListener("click", async (e) => {
      if (e.target.closest("[data-x]")) { close(); return; }
      if (e.target.closest("[data-copy]")) {
        toast(await copyText(pass) ? "Parol nusxalandi" : "Nusxalab boʻlmadi — qoʻlda belgilang", { tone: "info" });
      }
    });
    const inp = bd.querySelector("input");
    inp.addEventListener("focus", () => inp.select());
    bd.querySelector(".btn--primary").focus();
  }

  async toggleBlock(u) {
    const ok = await confirmDialog(u.is_active
      ? { title: "“" + u.username + "” bloklansinmi?", text: "U tizimga kira olmaydi, ochiq seansi yopiladi.", ok: "Bloklash", danger: true, icon: "ban" }
      : { title: "“" + u.username + "” faollashtirilsinmi?", text: "Foydalanuvchi yana tizimga kira oladi.", ok: "Faollashtirish", icon: "circle-check" });
    if (!ok) return;
    try {
      await api("/api/admin/users/" + u.id, { method: "PUT", body: JSON.stringify({
        username: u.username, full_name: u.full_name, role: u.role, regions: u.regions, is_active: !u.is_active }) });
    } catch (e) { toast(e.message, { tone: "error" }); return; }
    toast(u.is_active ? "Foydalanuvchi bloklandi" : "Foydalanuvchi faollashtirildi");
    this.load();
  }

  async remove(u) {
    const ok = await confirmDialog({
      title: "“" + (u.full_name || u.username) + "” oʻchirilsinmi?",
      text: "Foydalanuvchi va uning shaxsiy guruhlari oʻchadi. Oʻzgarishlar jurnali saqlanadi.",
      ok: "Oʻchirish", danger: true,
    });
    if (!ok) return;
    try { await api("/api/admin/users/" + u.id, { method: "DELETE" }); }
    catch (e) { toast(e.message, { tone: "error" }); return; }
    toast("Foydalanuvchi oʻchirildi");
    this.load();
  }
}

