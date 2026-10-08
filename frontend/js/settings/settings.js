/* ==========================================================================
   settings/settings.js — "Sozlamalar" sahifasi (Figma 06): qobiq va marshrut
   --------------------------------------------------------------------------
   Vazifasi:
     .page--sheet > .sheet: sarlavha "Sozlamalar" + Toolbar/Tizim (sysbar),
     chapda SettingsNav (guruhlar: Sozlamalar / Boshqaruv / Tizim; joriy
     bo'lim — aria-current), o'ngda panel. Ichki manzil #settings/<bo'lim>:
       umumiy · xavfsizlik · kuzatuv · foydalanuvchilar · guruhlar · tizim · loglar · jurnal
     Eski nomlar ham ishlaydi (general, access, monitoring, users, groups,
     status, logs, audit) — sysbar holat tugmasi #settings/status ochadi.
     Bo'limlar o'z fayllarida:
       site.js    — Umumiy, Kirish va xavfsizlik, Kuzatuv (SettingRow, saqlash paneli)
       users.js   — Foydalanuvchilar + #user-modal
       groups.js  — Kamera guruhlari
       system.js  — Tizim holati
       logs.js    — Loglar, Oʻzgarishlar jurnali

   Eksport:
     SettingsPage, settingsPage, loadSettingsPage(sub), hideSettingsPage(),
     applySiteName (util.js dan)

   Bog'liqliklar: ../layout/tabs.js (setSub), ../layout/notifications.js (mountSysbar),
     ../core/icons.js (hydrateIcons)
   Qoidalar:
     - Faqat admin: rail bandi .admin-only, tabs.js boshqalarni xaritaga qaytaradi.
     - Oxirgi ochilgan bo'lim brauzerda eslab qolinadi (try/catch).
     - Saqlanmagan qoralama bo'lim almashganda yo'qolmaydi; sahifada .is-dirty.
   ========================================================================== */
import { $ } from "../core/state.js";
import { hydrateIcons } from "../core/icons.js";
import { setSub } from "../layout/tabs.js";
import { mountSysbar } from "../layout/notifications.js";
import { SiteForm, FORM_SECTIONS } from "./site.js";
import { UsersSection } from "./users.js";
import { GroupsSection } from "./groups.js";
import { SystemSection } from "./system.js";
import { LogsSection, AuditSection } from "./logs.js";

export { applySiteName } from "./util.js";

export const SECTIONS = ["umumiy", "xavfsizlik", "kuzatuv", "foydalanuvchilar", "guruhlar", "tizim", "loglar", "jurnal"];
const ALIAS = {
  general: "umumiy", site: "umumiy", access: "xavfsizlik", security: "xavfsizlik", monitoring: "kuzatuv",
  users: "foydalanuvchilar", groups: "guruhlar", status: "tizim", system: "tizim", logs: "loglar", audit: "jurnal",
};
const KEY = "nigoh.settings-tab";

export class SettingsPage {
  constructor() {
    this.section = "umumiy";
    this.site = new SiteForm(this);
    this.users = new UsersSection();
    this.groups = new GroupsSection();
    this.system = new SystemSection(this);
    this.logs = new LogsSection();
    this.audit = new AuditSection();
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;
    const root = $("settings-view");
    hydrateIcons(root);
    hydrateIcons($("user-modal"));
    mountSysbar($("sx-sysbar"));
    root.querySelectorAll(".sx-nav__item").forEach((b) => b.addEventListener("click", () => this.go(b.dataset.st)));
  }

  resolve(sub) {
    let s = ALIAS[sub] || sub;
    if (!SECTIONS.includes(s)) {
      try { s = localStorage.getItem(KEY) || ""; } catch (e) { s = ""; }
      s = ALIAS[s] || s;
      if (!SECTIONS.includes(s)) s = "umumiy";
    }
    return s;
  }

  show(sub) {
    this.init();
    this.open(this.resolve(sub));
  }

  hide() { this.system.stop(); }

  /* Bo'limga o'tish (menyu, "Koʻrish" havolasi). */
  go(sec, opts) {
    if (sec === "loglar" && opts) this.logs.preset(opts);
    this.open(sec);
  }

  open(sec) {
    if (!SECTIONS.includes(sec)) sec = "umumiy";
    const prev = this.section;
    this.section = sec;
    try { localStorage.setItem(KEY, sec); } catch (e) { /* xotira yopiq */ }
    setSub(sec);
    const root = $("settings-view");
    root.querySelectorAll(".sx-nav__item").forEach((b) => {
      const on = b.dataset.st === sec;
      b.classList.toggle("is-on", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    root.querySelectorAll(".sx-sec").forEach((el) => { el.hidden = el.dataset.st !== sec; });
    const on = root.querySelector('.sx-nav__item[data-st="' + sec + '"]');
    if (on && on.scrollIntoView && innerWidth <= 1023) on.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (prev === "tizim" && sec !== "tizim") this.system.stop();

    if (FORM_SECTIONS.includes(sec)) this.site.load();
    else this.site.syncBar();
    if (sec === "foydalanuvchilar") this.users.load();
    if (sec === "guruhlar") this.groups.load();
    if (sec === "tizim") this.system.start();
    if (sec === "loglar") this.logs.load();
    if (sec === "jurnal") this.audit.load();
  }
}

export const settingsPage = new SettingsPage();

export function loadSettingsPage(sub) { settingsPage.show(sub); }
export function hideSettingsPage() { settingsPage.hide(); }
