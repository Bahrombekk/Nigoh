/* pages/map/onboardingSteps.ts — xarita tanishtiruvi qadamlari (STEPS) va holati prefs'da
   (onboarding.map = "done"): onboardingDone(), saveOnboardingDone(). Ko'rinish — Onboarding.tsx. */
import { prefs } from "@/lib/prefs";

export const STEPS = [
  { target: () => document.getElementById("mp-panel"), place: "right", title: "Panel va qidiruv",
    text: "Kamerani nomi, km yoki hudud boʻyicha toping. Holat filtrlari roʻyxat va xaritaga birga qoʻllanadi." },
  { target: () => document.getElementById("mp-layers"), place: "bottom", title: "Xarita qatlamlari",
    text: "Temir yoʻl, hudud chegaralari va klasterlarni shu yerdan yoqing." },
  { target: () => findMarker(), place: "bottom", title: "Kamera tanlash",
    text: "Markerni bosing — kichik kamera kartasi ochiladi. “Batafsil” — jonli video va tafsilotlar." },
];

/* Ekran markaziga eng yaqin ko'rinib turgan marker yoki klaster. */
function findMarker(): Element | null {
  const map = document.getElementById("map");
  if (!map) return null;
  const box = map.getBoundingClientRect();
  const cx = box.left + box.width * 0.6, cy = box.top + box.height / 2;
  let best: Element | null = null, bd = Infinity;
  map.querySelectorAll(".mp-cl-wrap, .mp-mk-wrap").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.right < box.left + 460 || r.left > box.right - 80 || r.top < box.top + 80 || r.bottom > box.bottom - 80) return;
    const d = (r.left + r.width / 2 - cx) ** 2 + (r.top + r.height / 2 - cy) ** 2;
    if (d < bd) { bd = d; best = el; }
  });
  return best;
}

export function onboardingDone() {
  return (prefs.get<Record<string, string>>("onboarding", {}) || {}).map === "done";
}
export function saveOnboardingDone() {
  prefs.set("onboarding", { ...(prefs.get<Record<string, string>>("onboarding", {}) || {}), map: "done" });
}
