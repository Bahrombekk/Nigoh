/* ==========================================================================
   core/theme.js — qorong'i / yorug' mavzu
   --------------------------------------------------------------------------
   Vazifasi:
     Mavzuni almashtirish, brauzerda saqlash va xaritadagi mavzuga bog'liq
     qatlamlarni (plitkalar, chegara, parda) moslash.

   Eksport:
     ThemeSwitcher             — klass: set(theme, persist); konstruktor tugmani ulaydi
     themeSwitcher             — yagona nusxa
     setTheme(theme, persist)  — themeSwitcher.set ga yo'naltiradi

   Bog'liqliklar:
     import: ./state.js ($), ./icons.js (ICO.sun / ICO.moon),
             ../map/map.js (tiles, setTiles, uzMask, uzBorder, uzMaskStyle, uzBorderStyle)

   DOM: #theme-btn, <html data-theme>
   Backend: yo'q. localStorage kaliti: "nigoh-theme"

   Qoidalar / tuzoqlar:
     - Boshlang'ich mavzuni index.html dagi kichik skript sahifa chizilishidan
       OLDIN qo'yadi (miltillash bo'lmasin); main.js keyin setTheme(..., false)
       bilan tugma ikonkasini va xarita plitkalarini moslaydi.
     - Plitka qatlami birinchi setTheme chaqiruvida yaratiladi (setTiles).
   ========================================================================== */
import { $ } from "./state.js";
import { ICO } from "./icons.js";
import { setTiles, tiles, uzBorder, uzBorderStyle, uzMask, uzMaskStyle } from "../map/map.js";

/* ---------- Mavzu ---------- */
export class ThemeSwitcher {
  constructor() {
    $("theme-btn").addEventListener("click", () =>
      this.set(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  }

  set(theme, persist = true) {
    document.documentElement.dataset.theme = theme;
    if (persist) localStorage.setItem("nigoh-theme", theme);
    const tb = $("theme-btn");
    tb.innerHTML = theme === "dark" ? ICO.sun : ICO.moon;
    tb.title = theme === "dark" ? "Yorug' mavzuga o'tish" : "Tungi mavzuga o'tish";
    if (!tiles) setTiles();
    // Hudud pardasi va chegara rangi ham mavzuga moslashadi.
    if (uzMask) uzMask.setStyle(uzMaskStyle());
    if (uzBorder) uzBorder.setStyle(uzBorderStyle());
  }
}

export const themeSwitcher = new ThemeSwitcher();

export function setTheme(theme, persist = true) {
  themeSwitcher.set(theme, persist);
}
