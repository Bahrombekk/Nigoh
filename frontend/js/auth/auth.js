/* ==========================================================================
   auth/auth.js — 01 Kirish, sessiya, rol, mehmon rejimi va 07.02 Profil menyusi
   --------------------------------------------------------------------------
   Vazifasi:
     Kirish ekrani (Default / Xato / Sessiya tugadi / Til), Preferences/Bar
     (til + 3 mavzu, kirishdan oldin ham), kim kirganini interfeysga qo'llash,
     profil menyusi (mavzu, til, klaviatura, parol, chiqish).

   Eksport:
     Auth, auth
     setAdmin(admin)        — joriy foydalanuvchi ({username, role, full_name}) yoki null
     applyMe(me)            — /api/auth/me javobini qo'llash (prefs, mehmon, sayt nomi)
     kirishniKut()          — Promise: kirish (yoki mehmon) bo'lganda hal bo'ladi
     openLogin(opts)        — kirish ekrani; opts.reason === "expired" → 01.03
     ROLE_LABEL             — { admin, operator, viewer } → o'zbekcha nom

   DOM: #login (va ichidagi #l-*), #avatar, body.authed/.anon/.is-admin/.operator/.viewer
   Backend: POST /api/auth/login {username, password, remember}, POST /api/auth/logout,
            POST /api/auth/password, GET /api/public/info (docs/V3_API.md)

   Qoidalar / tuzoqlar:
     - localStorage "nigoh-login" faqat login nomini saqlaydi, parolni HECH QACHON.
     - Xato matni login/parolni alohida aytmaydi (xavfsizlik) — server matni.
     - Chiqishda sahifa qayta yuklanadi — xotirada oqim/grafik qolmasin.
   ========================================================================== */
import { $, esc, state, toast } from "../core/state.js";
import { api } from "../core/api.js";
import { loadCameras } from "../core/data.js";
import { AUTH_TABS, showTab } from "../layout/tabs.js";
import { icon, hydrateIcons } from "../core/icons.js";
import { menu, popover, closePopovers } from "../core/ui.js";
import { THEMES, getTheme, setTheme } from "../core/theme.js";
import { applyServerPrefs, setPrefsUser } from "../core/prefs.js";
import { openModal } from "../core/modals.js";
import { LANGS, getLang, setLang, setSiteLang, t } from "../core/i18n.js";

export const ROLE_LABEL = { admin: "Administrator", operator: "Operator", viewer: "Kuzatuvchi" };
export { LANGS };

function initials(a) {
  const src = (a.full_name || a.username || "?").trim();
  const parts = src.split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : src.slice(0, 2)).toUpperCase();
}

/* ---------- Mavzu tugmalari (Preferences/Bar) ---------- */
function renderThemeButtons(box) {
  box.innerHTML = THEMES.map((t) =>
    '<button type="button" role="radio" data-theme-id="' + t.id + '" aria-checked="' + (getTheme() === t.id) +
    '" data-tip="' + t.label + '">' + icon(t.icon, "sm") + "</button>").join("");
  box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => setTheme(b.dataset.themeId)));
}
document.addEventListener("theme:changed", () => {
  document.querySelectorAll("[data-theme-id]").forEach((b) =>
    b.setAttribute("aria-checked", String(b.dataset.themeId === getTheme())));
});

/* Til menyusi — 4 til; nomlar o'z yozuvida (data-no-i18n — tarjima qilinmaydi). */
export function openLangMenu(anchor, opts) {
  const cur = getLang();
  const el = menu(anchor, LANGS.map((l) => ({
    label: l.label, on: l.id === cur,
    onClick: () => setLang(l.id),
  })), Object.assign({ place: "bottom-start", cls: anchor.closest("#login") ? "popover--login" : "" }, opts));
  if (el) el.querySelectorAll(".menu__item .ellipsis").forEach((s) => s.setAttribute("data-no-i18n", ""));
}
function syncLangName() {
  const l = LANGS.find((x) => x.id === getLang()) || LANGS[0];
  const el = document.getElementById("l-lang-name");
  if (el) el.textContent = l.label;
}
document.addEventListener("lang:changed", syncLangName);

/* ---------- Autentifikatsiya ---------- */
export class Auth {
  constructor() {
    this.pendingStart = null;
    this.publicInfo = null;

    $("avatar").addEventListener("click", (e) => {
      if (!state.admin) { this.openLogin(); return; }
      this.openProfileMenu(e.currentTarget);
    });

    renderThemeButtons(document.querySelector("#l-prefbar .prefbar__themes"));
    $("l-lang").addEventListener("click", (e) => openLangMenu(e.currentTarget));
    syncLangName();

    $("l-eye").addEventListener("click", () => {
      const inp = $("l-pass");
      const show = inp.type === "password";
      inp.type = show ? "text" : "password";
      const eye = $("l-eye");
      eye.innerHTML = icon(show ? "eye-slash" : "eye", "sm");
      eye.dataset.tip = show ? "Parolni yashirish" : "Parolni koʻrsatish";
      inp.focus();
    });
    try {
      const saved = localStorage.getItem("nigoh-login");
      if (saved) { $("l-user").value = saved; $("l-remember").checked = true; }
    } catch (e) {}

    $("l-form").addEventListener("submit", (e) => { e.preventDefault(); this.doLogin(); });
    $("l-pass").addEventListener("input", () => this.clearError(true));
    $("l-guest").addEventListener("click", () => {
      state.guest = true;
      this.closeLogin();
      this.releaseStart();
    });

    this.loadPublicInfo();
  }

  async loadPublicInfo() {
    try {
      const r = await fetch("/api/public/info");
      if (!r.ok) return;
      const info = this.publicInfo = await r.json();
      if (info.version) $("l-foot").textContent = "v" + info.version + " · Barqaror va xavfsiz nazorat";
      if (info.site_name) this.applySiteName(info.site_name);
    } catch (e) {}
  }

  applySiteName(name) {
    document.querySelectorAll(".site-name").forEach((el) => { el.textContent = name; });
    document.title = name + " — video nazorat tizimi";
  }

  setAdmin(admin) {
    state.admin = admin;
    const av = $("avatar");
    if (admin) {
      av.textContent = initials(admin);
      av.dataset.tip = (admin.full_name || admin.username) + " · " + (ROLE_LABEL[admin.role] || admin.role);
      state.guest = false;
    } else {
      av.textContent = "?";
      av.dataset.tip = "Kirish";
      if (AUTH_TABS.includes(state.tab)) showTab("map");
    }
    av.setAttribute("aria-label", av.dataset.tip);
    const role = admin ? admin.role : "";
    document.body.classList.toggle("anon", !admin);
    document.body.classList.toggle("authed", !!admin);
    document.body.classList.toggle("operator", role === "operator");
    document.body.classList.toggle("viewer", role === "viewer");
    document.body.classList.toggle("is-admin", role === "admin");
    setPrefsUser(!!admin);
    if (role !== "admin" && (state.tab === "settings" || state.tab === "admin")) showTab("map");
    document.dispatchEvent(new Event("auth:changed"));
  }

  applyMe(me) {
    if (me && me.site_name) this.applySiteName(me.site_name);
    if (me && me.language) setSiteLang(me.language);     // sayt standarti (shaxsiy tanlov bo'lmasa)
    if (me && me.authenticated && me.prefs) applyServerPrefs(me.prefs);
    if (me) {
      state.pollS = me.poll_s || state.pollS || 30;
      state.sessionHours = me.session_hours || state.sessionHours || 12;
      if (me.version) $("l-foot").textContent = "v" + me.version + " · Barqaror va xavfsiz nazorat";
    }
    this.setAdmin(me && me.authenticated
      ? { username: me.username, role: me.role, full_name: me.full_name || "" } : null);
    const guestOk = !!(me && !me.authenticated && (me.public_view || me.guest_view));
    $("l-guest-row").hidden = !guestOk;
  }

  waitForLogin() {
    return new Promise((resolve) => { this.pendingStart = resolve; });
  }

  releaseStart() {
    if (this.pendingStart) { const go = this.pendingStart; this.pendingStart = null; go(); }
  }

  /* ---------- Kirish ekrani ---------- */
  openLogin(opts) {
    if (opts === false) opts = { focus: false };
    opts = opts || {};
    closePopovers();
    this.clearError();
    const expired = opts.reason === "expired";
    $("l-title").textContent = expired ? "Qayta kiring" : "Tizimga kirish";
    if (expired) {
      this.showAlert("info", "Seans tugadi",
        (state.sessionHours || 12) + " soatlik seans muddati tugadi · xavfsizlik uchun");
    }
    $("l-pass").value = "";
    $("login").classList.add("open");
    document.documentElement.classList.remove("booting");
    if (opts.focus !== false) {
      setTimeout(() => ($("l-user").value && !expired ? $("l-pass") : ($("l-user").value ? $("l-pass") : $("l-user"))).focus(), 60);
    }
  }

  closeLogin() {
    $("login").classList.remove("open");
    state.pendingTab = state.pendingTab || null;
  }

  showAlert(tone, title, text) {
    const a = $("l-alert");
    a.className = "alert alert--" + tone;
    a.setAttribute("role", tone === "error" ? "alert" : "status");
    a.querySelector(".i").outerHTML = icon(tone === "info" ? "circle-info" : "triangle-exclamation", "sm");
    $("l-alert-title").textContent = title;
    $("l-alert-text").textContent = text || "";
    $("l-alert-text").hidden = !text;
    a.hidden = false;
  }

  clearError(keepAlert) {
    if (!keepAlert) $("l-alert").hidden = true;
    $("l-pass-field").classList.remove("is-error");
    $("l-pass-hint").hidden = true;
  }

  async doLogin() {
    const user = $("l-user").value.trim();
    const pass = $("l-pass").value;
    if (!user) { $("l-user").focus(); return; }
    if (!pass) { $("l-pass").focus(); return; }
    const btn = $("l-submit");
    btn.disabled = true;
    try {
      const me = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: user, password: pass, remember: $("l-remember").checked })
      });
      try {
        if ($("l-remember").checked) localStorage.setItem("nigoh-login", me.username);
        else localStorage.removeItem("nigoh-login");
      } catch (e) {}
      // To'liq /me — prefs, full_name, poll_s.
      let full = me;
      try { full = await api("/api/auth/me"); } catch (e) {}
      this.applyMe(Object.assign({ authenticated: true }, me, full));
      const tab = state.pendingTab;
      state.pendingTab = null;
      this.closeLogin();
      toast("Xush kelibsiz, " + (full.full_name || me.username));
      if (!this.pendingStart) loadCameras().catch(() => {});
      this.releaseStart();
      if (tab) showTab(tab);
    } catch (e) {
      if (e.status === 429) {
        this.showAlert("error", "Juda koʻp urinish", e.body && e.body.retry_after
          ? Math.ceil(e.body.retry_after / 60) + " daqiqadan keyin qayta urinib koʻring" : e.message);
      } else if (e.status === 401 || e.status === 403) {
        const left = e.body && e.body.remaining;
        this.showAlert("error", e.status === 403 ? e.message : "Login yoki parol notoʻgʻri",
          typeof left === "number" ? "Yana " + left + " ta urinish qoldi" : "");
        $("l-pass-field").classList.add("is-error");
        $("l-pass-hint").hidden = false;
      } else {
        this.showAlert("error", "Kirib boʻlmadi", e.message);
      }
      $("login").classList.remove("is-shake");
      void $("login").offsetWidth;
      $("login").classList.add("is-shake");
      $("l-pass").select();
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- 07.02 Profil menyusi ---------- */
  openProfileMenu(anchor) {
    const a = state.admin;
    const lang = LANGS.find((l) => l.id === getLang()) || LANGS[0];
    const html =
      '<div class="menu profile" role="menu">' +
        '<div class="profile__head"><span class="avatar avatar--lg">' + esc(initials(a)) + "</span>" +
          '<span style="display:flex;flex-direction:column;min-width:0"><span class="label-md ellipsis">' +
          esc(a.full_name || a.username) + '</span><span class="body-xs t-tertiary ellipsis">' +
          esc((ROLE_LABEL[a.role] || a.role) + " · " + a.username) + "</span></span></div>" +
        '<div class="menu__sep"></div>' +
        '<button class="menu__item" role="menuitem" data-act="password">' + icon("user", "sm") + "<span>Profil va parol</span></button>" +
        '<div class="menu__label">Mavzu</div>' +
        '<div class="profile__seg"><div class="seg seg--sm">' +
          THEMES.map((t) => '<button data-theme-id="' + t.id + '" class="' + (getTheme() === t.id ? "is-on" : "") + '">' +
            ({ white: "Oq", cream: "Qaymoq", dark: "Qorongʻi" }[t.id]) + "</button>").join("") + "</div></div>" +
        '<button class="menu__item" role="menuitem" data-act="lang">' + icon("globe", "sm") + "<span>Til: <span data-no-i18n>" + esc(lang.label) + "</span></span></button>" +
        '<button class="menu__item" role="menuitem" data-act="keys">' + icon("keyboard", "sm") +
          '<span>Klaviatura yorliqlari</span><span class="menu__kbd">?</span></button>' +
        '<div class="menu__sep"></div>' +
        '<button class="menu__item is-danger" role="menuitem" data-act="logout">' + icon("arrow-right-from-bracket", "sm") + "<span>Chiqish</span></button>" +
      "</div>";
    const el = popover(anchor, html, { place: "right-end", offset: 24, cls: "popover--profile" });
    if (!el) return;
    el.querySelectorAll("[data-theme-id]").forEach((b) => b.addEventListener("click", () => {
      setTheme(b.dataset.themeId);
      el.querySelectorAll("[data-theme-id]").forEach((x) => x.classList.toggle("is-on", x === b));
    }));
    el.querySelector('[data-act="password"]').addEventListener("click", () => { closePopovers(); this.openPasswordDialog(); });
    // force: profil popover'i shu anchor'da ochiq — aks holda popover() uni "ikkinchi bosish" deb yopardi.
    el.querySelector('[data-act="lang"]').addEventListener("click", () => openLangMenu(anchor, { force: true, place: "right-end", offset: 24 }));
    el.querySelector('[data-act="keys"]').addEventListener("click", () => { closePopovers(); openModal("help-modal"); });
    el.querySelector('[data-act="logout"]').addEventListener("click", () => this.logout());
    el.querySelector(".menu__item").focus();
  }

  async logout() {
    closePopovers();
    if (document.querySelector(".is-dirty") &&
        !window.confirm(t("Saqlanmagan oʻzgarishlar bor. Baribir chiqasizmi?"))) return;
    try { await api("/api/auth/logout", { method: "POST" }); } catch (e) {}
    location.reload();
  }

  /* Profil va parol — o'z parolini almashtirish (POST /api/auth/password). */
  openPasswordDialog() {
    const bd = document.createElement("div");
    bd.className = "dialog-backdrop open";
    bd.innerHTML =
      '<form class="dialog" role="dialog" aria-modal="true" aria-labelledby="pw-title" novalidate>' +
        '<div class="dialog__head"><h2 class="dialog__title" id="pw-title">Profil va parol</h2>' +
          '<button type="button" class="icon-btn icon-btn--sm dialog__close" data-x data-tip="Yopish">' + icon("xmark", "sm") + "</button></div>" +
        '<div class="detail-row" style="border:0;padding:0"><span class="detail-row__k">Login</span><span class="detail-row__v mono">' + esc(state.admin.username) + "</span></div>" +
        '<label class="field"><span class="field__label">Joriy parol</span><input class="input" type="password" name="cur" autocomplete="current-password"></label>' +
        '<label class="field"><span class="field__label">Yangi parol</span><input class="input" type="password" name="new" autocomplete="new-password">' +
          '<span class="field__hint">Kamida 8 belgi</span></label>' +
        '<label class="field"><span class="field__label">Yangi parolni takrorlang</span><input class="input" type="password" name="rep" autocomplete="new-password"></label>' +
        '<div class="alert alert--error" hidden>' + icon("triangle-exclamation", "sm") + '<div class="alert__body"><span class="alert__title"></span></div></div>' +
        '<div class="dialog__actions"><button type="button" class="btn btn--secondary" data-x>Bekor qilish</button>' +
          '<button class="btn btn--primary" type="submit">Saqlash</button></div>' +
      "</form>";
    document.body.appendChild(bd);
    const f = bd.querySelector("form");
    const close = () => { document.removeEventListener("keydown", onKey, true); bd.remove(); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", onKey, true);
    bd.addEventListener("click", (e) => { if (e.target === bd || e.target.closest("[data-x]")) close(); });
    const err = (msg) => {
      const a = f.querySelector(".alert");
      a.hidden = !msg;
      a.querySelector(".alert__title").textContent = msg || "";
    };
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const cur = f.cur.value, nw = f.new.value, rep = f.rep.value;
      if (nw.length < 8) return err("Yangi parol kamida 8 belgi boʻlsin");
      if (nw !== rep) return err("Parollar mos kelmadi");
      try {
        await api("/api/auth/password", { method: "POST", body: JSON.stringify({ current: cur, new: nw }) });
        close();
        toast("Parol yangilandi");
      } catch (ex) { err(ex.message); }
    });
    f.cur.focus();
  }
}

export const auth = new Auth();
hydrateIcons(document.getElementById("login"));

export function setAdmin(admin) { auth.setAdmin(admin); }
export function applyMe(me) { auth.applyMe(me); }
export function kirishniKut() { return auth.waitForLogin(); }
export function openLogin(opts) { auth.openLogin(opts); }
