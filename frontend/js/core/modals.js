/* ==========================================================================
   core/modals.js — index.html dagi statik oynalar (Dialog / Modal)
   --------------------------------------------------------------------------
   `.dialog-backdrop` (v3) oynalarini ochish/yopish. `[data-close="id"]`
   tugmalari, fonga bosish va Esc oynani yopadi. Dinamik dialoglar uchun
   core/ui.js (confirmDialog) ishlatiladi.

   Eksport: Modals, modals, openModal(id), closeModal(id), topModal()
   Hodisa: "modal:closed" (detail: id) — modul o'z holatini tozalashi uchun
           (masalan kamera shakli xaritadan joy tanlashni to'xtatadi).
   ========================================================================== */
import { $ } from "./state.js";

const SEL = ".dialog-backdrop, .backdrop";

export class Modals {
  constructor() {
    document.addEventListener("click", (e) => {
      const c = e.target.closest && e.target.closest("[data-close]");
      if (c) { this.close(c.dataset.close); return; }
      const bd = e.target.matches && e.target.matches(SEL) ? e.target : null;
      if (bd && bd.id && bd.classList.contains("open")) this.close(bd.id);
    });
  }

  open(id) {
    const el = $(id);
    if (!el) return;
    el.classList.add("open");
    const f = el.querySelector("[autofocus], input:not([type=hidden]), select, textarea, .btn--primary");
    if (f) setTimeout(() => f.focus(), 30);
  }

  close(id) {
    const el = $(id);
    if (!el) return;
    el.classList.remove("open");
    document.dispatchEvent(new CustomEvent("modal:closed", { detail: { id } }));
  }

  top() {
    const open = [...document.querySelectorAll(SEL)].filter((x) => x.classList.contains("open"));
    return open.length ? open[open.length - 1] : null;
  }
}

export const modals = new Modals();

export function openModal(id) { modals.open(id); }
export function closeModal(id) { modals.close(id); }
export function topModal() { return modals.top(); }
