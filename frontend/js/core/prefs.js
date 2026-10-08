/* ==========================================================================
   core/prefs.js — foydalanuvchi afzalliklari (mavzu, til, qatlamlar, onboarding)
   --------------------------------------------------------------------------
   Figma: "Tanlov localStorage’da, kirgach profilga yoziladi."
   Brauzerda "nigoh.prefs" (JSON) da saqlanadi; kirgan foydalanuvchida
   PATCH /api/auth/me/prefs bilan serverga ham yoziladi (500 ms jamlab).
   /api/auth/me javobidagi `prefs` kirishda mahalliy qiymatlar ustiga
   qo'yiladi (applyServerPrefs).

   Eksport:
     prefs.get(key, def), prefs.set(key, value), prefs.all()
     applyServerPrefs(obj), setPrefsUser(isAuthed)
   Kalitlar (kelishuv): theme ("white"|"cream"|"dark"), lang ("uz"|"uz-cyrl"|"ru"|"en"),
     layers ({rail, regions, clusters, offline, labels, base}), onboarding ({map: "done"}),
     panel ("open"|"closed"), wall ({size, quality, auto, interval, group}),
     dashTab, dashPeriod
   ========================================================================== */
const KEY = "nigoh.prefs";
let data = {};
try { data = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { data = {}; }
// Eski kalit (v2): "nigoh-theme" = dark | light
try {
  const old = localStorage.getItem("nigoh-theme");
  if (old && !data.theme) data.theme = old === "light" ? "white" : "dark";
} catch (e) {}

let authed = false;
let dirty = {};
let timer = null;

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
}

function flush() {
  clearTimeout(timer);
  timer = null;
  if (!authed || !Object.keys(dirty).length) return;
  const body = JSON.stringify(dirty);
  dirty = {};
  // keepalive — sahifa yopilayotgan/yangilanayotgan bo'lsa ham so'rov yetib boradi.
  fetch("/api/auth/me/prefs", {
    method: "PATCH", credentials: "same-origin", keepalive: true,
    headers: { "Content-Type": "application/json" }, body,
  }).catch(() => {});
}
// Yangilash/yopishdan oldin jamlangan o'zgarishlar darhol yuboriladi — aks
// holda serverdagi eski qiymat keyingi ochilishda mahalliy tanlovni bosib ketardi.
addEventListener("pagehide", flush);

export const prefs = {
  get(key, def) { return data[key] === undefined ? def : data[key]; },
  set(key, value) {
    data[key] = value;
    persist();
    dirty[key] = value;
    if (!timer) timer = setTimeout(flush, 500);
    document.dispatchEvent(new CustomEvent("prefs:changed", { detail: { key, value } }));
  },
  all() { return Object.assign({}, data); },
};

export function setPrefsUser(isAuthed) { authed = !!isAuthed; }

export function applyServerPrefs(obj) {
  if (!obj || typeof obj !== "object") return;
  Object.keys(obj).forEach((k) => { data[k] = obj[k]; });
  persist();
  document.dispatchEvent(new CustomEvent("prefs:loaded"));
}
