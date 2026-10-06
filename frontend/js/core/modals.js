/* ==========================================================================
   core/modals.js — modal oynalar
   --------------------------------------------------------------------------
   Vazifasi:
     `.backdrop` modal oynalarini ochish/yopish. `[data-close="id"]` tugmalari
     va fon (backdrop) ga bosish oynani yopadi.

   Eksport:
     Modals          — klass: open(id), close(id); konstruktor yopish tugmalarini ulaydi
     modals          — yagona nusxa
     openModal(id)   — modals.open ga yo'naltiradi
     closeModal(id)  — modals.close ga yo'naltiradi

   Bog'liqliklar:
     import: ./state.js ($, state), ../admin/camera-form.js (stopPicking)

   DOM: barcha `.backdrop` (cam-modal, nvr-modal, login-modal, mtx-modal,
        help-modal ...), barcha `[data-close]` tugmalar
   Backend: yo'q

   Qoidalar / tuzoqlar:
     - Kamera shakli yopilsa xaritadan joy tanlash ham to'xtaydi (marker o'chadi).
     - Kirish oynasi yopilsa kutilayotgan bo'lim (state.pendingTab) unutiladi.
     - Tugmalar konstruktorda, ya'ni modul yuklanayotganda ulanadi (avvalgidek).
   ========================================================================== */
import { $, state } from "./state.js";
import { stopPicking } from "../admin/camera-form.js";

/* ---------- Modallar ---------- */
export class Modals {
  constructor() {
    document.querySelectorAll("[data-close]").forEach((b) =>
      b.addEventListener("click", () => this.close(b.dataset.close)));
    document.querySelectorAll(".backdrop").forEach((bd) =>
      bd.addEventListener("click", (e) => { if (e.target === bd) this.close(bd.id); }));
  }

  open(id) { $(id).classList.add("open"); }

  close(id) {
    $(id).classList.remove("open");
    if (id === "cam-modal") stopPicking(true);
    if (id === "login-modal") state.pendingTab = null;
  }
}

export const modals = new Modals();

export function openModal(id) { modals.open(id); }
export function closeModal(id) { modals.close(id); }
