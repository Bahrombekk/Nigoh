/* lib/theme.ts — uch mavzu: white · cream · dark (<html data-theme>).
   Boshlang'ich qiymatni index.html dagi skript qo'yadi. useTheme() — joriy mavzu va
   o'zgartirish; "nigoh:theme" hodisasi (xarita plitkalari, grafik ranglari). */
import { useEffect } from "react";
import { prefs, usePref } from "./prefs";

export type Theme = "white" | "cream" | "dark";
export const THEMES: { id: Theme; label: string; icon: string }[] = [
  { id: "white", label: "Oq", icon: "sun" },
  { id: "cream", label: "Qaymoq", icon: "mug-saucer" },
  { id: "dark", label: "Qorongʻi", icon: "moon" },
];

function valid(t: unknown): Theme { return t === "cream" || t === "dark" ? t : "white"; }

export function useTheme(): [Theme, (t: Theme) => void] {
  const [raw, set] = usePref<string>("theme", document.documentElement.dataset.theme || "white");
  const theme = valid(raw);
  useEffect(() => {
    if (document.documentElement.dataset.theme !== theme) {
      document.documentElement.dataset.theme = theme;
      window.dispatchEvent(new CustomEvent("nigoh:theme", { detail: { theme } }));
    }
  }, [theme]);
  return [theme, (t) => set(t)];
}

export function setTheme(t: Theme) { prefs.set("theme", valid(t)); }

/** CSS token qiymati (grafiklar, Leaflet uslublari uchun). */
export function cssVar(name: string, fallback = ""): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
