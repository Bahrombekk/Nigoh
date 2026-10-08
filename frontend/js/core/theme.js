/* ==========================================================================
   core/theme.js — uch mavzu: White · Cream · Dark (Figma v3)
   --------------------------------------------------------------------------
   <html data-theme="white | cream | dark">. Boshlang'ich mavzuni index.html
   dagi kichik skript birinchi chizishdan OLDIN qo'yadi (miltillamasin).
   Almashtirish: kirish ekranidagi Preferences/Bar, Profil menyusi va
   Sozlamalar → Umumiy — hammasi shu modul orqali, bir-biri bilan sinxron.

   Eksport:
     THEMES                 — [{ id, label, icon }]
     getTheme()             — joriy mavzu
     setTheme(theme, persist=true) — qo'llash; "theme:changed" hodisasi
                              (xarita plitkalari, grafiklar shunga quloq soladi)
   ========================================================================== */
import { prefs } from "./prefs.js";

export const THEMES = [
  { id: "white", label: "Oq", icon: "sun" },
  { id: "cream", label: "Qaymoq", icon: "mug-saucer" },
  { id: "dark", label: "Qorongʻi", icon: "moon" },
];

export function getTheme() {
  const t = document.documentElement.dataset.theme;
  return THEMES.some((x) => x.id === t) ? t : "white";
}

export function setTheme(theme, persist = true) {
  if (theme === "light") theme = "white";
  if (!THEMES.some((x) => x.id === theme)) theme = "white";
  document.documentElement.dataset.theme = theme;
  if (persist) prefs.set("theme", theme);
  document.dispatchEvent(new CustomEvent("theme:changed", { detail: { theme } }));
}

// Serverdan kelgan afzalliklar (kirgandan keyin) mavzuni almashtirishi mumkin.
document.addEventListener("prefs:loaded", () => {
  const t = prefs.get("theme");
  if (t && t !== getTheme()) setTheme(t, false);
});

/* Eski API (v2): themeSwitcher.set */
export const themeSwitcher = { set: setTheme };
