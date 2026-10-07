/* ==========================================================================
   auth/auth.js — kirish ekrani, sessiya, rol va mehmon rejimi
   --------------------------------------------------------------------------
   Vazifasi:
     Kim kirganini interfeysga qo'llash (admin / operator / kirilmagan),
     kirish ekranini ochish, login/logout, "Meni esda saqlash" va
     ishga tushirishni kirishgacha kutib turish.

   Eksport:
     Auth              — klass: setAdmin, applyMe, waitForLogin, openLogin, doLogin
     auth              — yagona nusxa
     setAdmin(admin)   — joriy foydalanuvchini qo'llash (null — chiqish)
     applyMe(me)       — /api/auth/me javobini qo'llash, mehmon tugmasini ko'rsatish
     kirishniKut()     — Promise: muvaffaqiyatli kirish (yoki mehmon) bo'lganda hal bo'ladi
     openLogin(focus)  — kirish ekranini ochish (focus=false — parolga fokus bermaslik)

   Bog'liqliklar:
     import: ../core/state.js, ../core/api.js, ../core/data.js (loadCameras),
             ../layout/tabs.js (AUTH_TABS, showTab), ../core/modals.js,
             ../admin/camera-form.js (stopPicking)

   DOM: #avatar, #user-av, #user-name, #user-role, #login-modal, #login-err,
        #l-user, #l-pass, #l-eye, #l-remember, #l-submit, #l-guest, #ls-gate,
        body.anon / body.operator klasslari
   Backend: POST /api/auth/login, POST /api/auth/logout (me ni main.js so'raydi)

   Qoidalar / tuzoqlar:
     - localStorage "nigoh-login" faqat login nomini saqlaydi, parolni HECH QACHON.
     - Chiqishda sahifa qayta yuklanadi — xotirada oqim/grafik qolmasin.
     - Operator boshqaruv bo'limini ko'rmaydi (server ham 403 beradi).
     - Kirish kutilayotgan bo'lsa (ko'rish uchun kirish shart) kameralar
       main.js da yuklanadi; aks holda kirgandan keyin shu yerda qayta so'raladi.
   ========================================================================== */
import { $, state, toast } from "../core/state.js";
import { api } from "../core/api.js";
import { loadCameras } from "../core/data.js";
import { AUTH_TABS, showTab } from "../layout/tabs.js";
import { closeModal, openModal } from "../core/modals.js";
import { stopPicking } from "../admin/camera-form.js";

/* ---------- Autentifikatsiya ---------- */
export class Auth {
  constructor() {
    /* Ishga tushirish kirishni kutadi: muvaffaqiyatli kirish (yoki mehmon)
       shu va'dani hal qiladi. */
    this.pendingStart = null;

    $("avatar").addEventListener("click", async () => {
      if (!state.admin) { this.openLogin(); return; }
      if (confirm("Chiqmoqchimisiz?")) {
        await api("/api/auth/logout", { method: "POST" });
        // Sahifa qaytadan yuklanadi: xotiradagi kameralar, oqimlar va
        // grafiklar ekranda qolib ketmaydi, kirish ekrani toza ochiladi.
        location.reload();
      }
    });

    $("l-eye").addEventListener("click", () => {
      const inp = $("l-pass");
      inp.type = inp.type === "password" ? "text" : "password";
      $("l-eye").classList.toggle("on", inp.type === "text");
      inp.focus();
    });
    // "Meni esda saqlash" — faqat loginni brauzerda saqlaydi, parolni emas.
    try {
      const saved = localStorage.getItem("nigoh-login");
      if (saved) { $("l-user").value = saved; $("l-remember").checked = true; }
    } catch (e) {}

    $("l-submit").addEventListener("click", () => this.doLogin());
    // Mehmon: server anonim ko'rishga ruxsat bergan bo'lsagina ko'rinadi.
    $("l-guest").addEventListener("click", () => {
      closeModal("login-modal");
      this.releaseStart();
    });
    $("l-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") this.doLogin(); });
  }

  setAdmin(admin) {
    state.admin = admin;
    if (admin) {
      $("user-av").textContent = admin.username.slice(0, 2).toUpperCase();
      $("user-name").textContent = admin.username;
      $("user-role").textContent = admin.role === "operator" ? "Operator" : "Tizim administratori";
      $("avatar").title = admin.username + " — chiqish uchun bosing";
    } else {
      $("user-av").textContent = "?";
      $("user-name").textContent = "—";
      $("user-role").textContent = "Kirilmagan";
      $("avatar").title = "Super-admin sifatida kirish";
      if (AUTH_TABS.includes(state.tab)) showTab("map");
      stopPicking(true);
    }
    // Kirilmagan holatda yopiq bo'limlar yon panelda qulf bilan belgilanadi.
    document.body.classList.toggle("anon", !admin);
    // Operator boshqaruv bo'limini ko'rmaydi — server ham 403 qaytaradi.
    document.body.classList.toggle("operator", !!admin && admin.role === "operator");
    // Super-admin bo'limlari (Sozlamalar) faqat adminga ko'rinadi — .admin-only.
    document.body.classList.toggle("is-admin", !!admin && admin.role === "admin");
    if (!(admin && admin.role === "admin") && state.tab === "settings") showTab("map");
    if (admin && admin.role === "operator" && state.tab === "admin") showTab("map");
    // Foydalanuvchiga bog'liq ma'lumot (guruhlar) qayta yuklansin — map/groups.js.
    document.dispatchEvent(new Event("auth:changed"));
  }

  /* /api/auth/me javobini qo'llash. Kirilmagan bo'lsa interfeys ochilmaydi;
     server anonim ko'rishga ruxsat bersa (public_view) kirish ekranida
     "Mehmon sifatida davom etish" tugmasi chiqadi. */
  applyMe(me) {
    // Sayt nomi (Sozlamalar → Sayt) — kirish oynasidan oldin ham ko'rinsin.
    if (me && me.site_name) {
      document.querySelectorAll(".site-name").forEach((el) => { el.textContent = me.site_name; });
      document.title = me.site_name + " — video nazorat tizimi";
    }
    this.setAdmin(me && me.authenticated ? { username: me.username, role: me.role } : null);
    $("l-guest").hidden = !(me && !me.authenticated && me.public_view);
    $("ls-gate").hidden = !$("l-guest").hidden;
  }

  /* Kirish ekranini ochadi. Ko'rish uchun kirish shart bo'lsa, ma'lumot
     yuklash muvaffaqiyatli kirishgacha kutib turadi. */
  waitForLogin() {
    return new Promise((resolve) => { this.pendingStart = resolve; });
  }

  /* Kutilayotgan ishga tushirishni davom ettiradi (bir marta). */
  releaseStart() {
    if (this.pendingStart) { const go = this.pendingStart; this.pendingStart = null; go(); }
  }

  openLogin(focus) {
    $("login-err").classList.remove("show");
    $("l-pass").value = "";
    openModal("login-modal");
    if (focus !== false) setTimeout(() => $("l-pass").focus(), 80);
  }

  async doLogin() {
    const err = $("login-err");
    err.classList.remove("show");
    try {
      const me = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: $("l-user").value.trim(), password: $("l-pass").value })
      });
      this.setAdmin({ username: me.username, role: me.role });
      try {
        if ($("l-remember").checked) localStorage.setItem("nigoh-login", me.username);
        else localStorage.removeItem("nigoh-login");
      } catch (e) {}
      // closeModal pendingTab'ni tozalaydi — so'ralgan bo'lim avval olinadi.
      const tab = state.pendingTab;
      closeModal("login-modal");
      toast("Xush kelibsiz, " + me.username);
      // Mehmon sifatida yuklangan ro'yxat operator hududlariga mos kelmasligi
      // mumkin — kirgandan keyin kameralar qayta so'raladi.
      if (!this.pendingStart) loadCameras().catch(() => {});
      // Kirish kutilayotgan bo'lsa (ko'rish uchun kirish shart) — endi yuklanadi.
      this.releaseStart();
      if (tab) showTab(tab);
    } catch (e) {
      err.textContent = e.message;
      err.classList.add("show");
    }
  }
}

export const auth = new Auth();

export function setAdmin(admin) { auth.setAdmin(admin); }
export function applyMe(me) { auth.applyMe(me); }
export function kirishniKut() { return auth.waitForLogin(); }
export function openLogin(focus) { auth.openLogin(focus); }
