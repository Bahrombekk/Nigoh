/* Kirish ekrani, sessiya (/api/auth/*), rol (admin/operator) va mehmon rejimi. */
import { $, state, toast } from "./holat.js";
import { api } from "./api.js";
import { loadCameras } from "./malumot.js";
import { AUTH_TABS, showTab } from "./tablar.js";
import { closeModal, openModal } from "./modallar.js";
import { stopPicking } from "./kamera-shakli.js";

/* ---------- Autentifikatsiya ---------- */
export function setAdmin(admin) {
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
  if (admin && admin.role === "operator" && state.tab === "admin") showTab("map");
}

/* /api/auth/me javobini qo'llash. Kirilmagan bo'lsa interfeys ochilmaydi;
   server anonim ko'rishga ruxsat bersa (public_view) kirish ekranida
   "Mehmon sifatida davom etish" tugmasi chiqadi. */
export function applyMe(me) {
  setAdmin(me && me.authenticated ? { username: me.username, role: me.role } : null);
  $("l-guest").hidden = !(me && !me.authenticated && me.public_view);
  $("ls-gate").hidden = !$("l-guest").hidden;
}

/* Kirish ekranini ochadi. Ko'rish uchun kirish shart bo'lsa, ma'lumot
   yuklash muvaffaqiyatli kirishgacha kutib turadi. */
let pendingStart = null;
/* Ishga tushirish kirishni kutadi: muvaffaqiyatli kirish (yoki mehmon)
   shu va'dani hal qiladi. */
export function kirishniKut() {
  return new Promise((resolve) => { pendingStart = resolve; });
}
export function openLogin(focus) {
  $("login-err").classList.remove("show");
  $("l-pass").value = "";
  openModal("login-modal");
  if (focus !== false) setTimeout(() => $("l-pass").focus(), 80);
}

$("avatar").addEventListener("click", async () => {
  if (!state.admin) { openLogin(); return; }
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

$("l-submit").addEventListener("click", doLogin);
// Mehmon: server anonim ko'rishga ruxsat bergan bo'lsagina ko'rinadi.
$("l-guest").addEventListener("click", () => {
  closeModal("login-modal");
  if (pendingStart) { const go = pendingStart; pendingStart = null; go(); }
});
$("l-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });

async function doLogin() {
  const err = $("login-err");
  err.classList.remove("show");
  try {
    const me = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: $("l-user").value.trim(), password: $("l-pass").value })
    });
    setAdmin({ username: me.username, role: me.role });
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
    if (!pendingStart) loadCameras().catch(() => {});
    // Kirish kutilayotgan bo'lsa (ko'rish uchun kirish shart) — endi yuklanadi.
    if (pendingStart) { const go = pendingStart; pendingStart = null; go(); }
    if (tab) showTab(tab);
  } catch (e) {
    err.textContent = e.message;
    err.classList.add("show");
  }
}
