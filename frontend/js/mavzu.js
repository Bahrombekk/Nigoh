/* Qorong'i / yorug' mavzu almashtirish (setTheme) va saqlash. */
import { $ } from "./holat.js";
import { ICO } from "./ikonkalar.js";
import { setTiles, tiles, uzBorder, uzBorderStyle, uzMask, uzMaskStyle } from "./xarita.js";

/* ---------- Mavzu ---------- */
export function setTheme(theme, persist = true) {
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
$("theme-btn").addEventListener("click", () =>
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
