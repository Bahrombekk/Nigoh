/* pages/map/Onboarding.tsx — Coachmark onboarding (Figma 02.22 → 02.06 → 02.23), v3 map/onboarding.js.
   Faqat birinchi kirishda 3 qadam: Panel va qidiruv → Qatlamlar → Kamera tanlash. Scrim +
   ajratilgan element (brand halqa) + coachmark (strelka elementga qaragan). "Keyingi" /
   "Oʻtkazib yuborish" / × / Esc. Holat prefs'da: onboarding.map = "done".
   Yordam oynasidagi "Tanishtiruvni qayta koʻrish" — window "nigoh:tour" (MapPage). */
import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n/I18nProvider";
import { Icon } from "@/components/Icon";
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

export function Onboarding({ step, onNext, onSkip }: { step: number; onNext: () => void; onSkip: () => void }) {
  const t = useT();
  const hlRef = useRef<HTMLDivElement>(null);
  const coachRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const s = STEPS[step];

  const paint = () => {
    const hl = hlRef.current, coach = coachRef.current;
    if (!hl || !coach || !s) return;
    const tg = s.target();
    const vw = innerWidth, vh = innerHeight;
    const r = tg ? tg.getBoundingClientRect()
      : { left: vw / 2 - 20, top: vh / 2 - 20, width: 40, height: 40, right: vw / 2 + 20, bottom: vh / 2 + 20 };
    const pad = step === 2 ? 6 : 4;
    hl.style.left = r.left - pad + "px";
    hl.style.top = r.top - pad + "px";
    hl.style.width = r.width + pad * 2 + "px";
    hl.style.height = r.height + pad * 2 + "px";
    hl.classList.toggle("is-round", step === 2);
    const w = coach.offsetWidth, h = coach.offsetHeight;
    let place = s.place;
    if (place === "right" && r.right + 16 + w > vw - 8) place = "bottom-in";
    let x: number, y: number;
    if (place === "right") {
      x = r.right + 16; y = Math.max(8, Math.min(vh - h - 8, r.top + 72));
      coach.dataset.arrow = "left";
      coach.style.setProperty("--arrow-y", Math.max(16, Math.min(h - 24, r.top + 92 - y)) + "px");
    } else if (place === "bottom-in") {
      x = Math.max(8, Math.min(vw - w - 8, r.left + 16)); y = Math.max(8, Math.min(vh - h - 8, r.top + 140));
      coach.dataset.arrow = "none";
    } else {
      x = Math.max(8, Math.min(vw - w - 8, r.left + r.width / 2 - w + 40));
      y = r.bottom + 14;
      if (y + h > vh - 8) { y = r.top - h - 14; coach.dataset.arrow = "bottom"; } else coach.dataset.arrow = "top";
      const ax = Math.max(16, Math.min(w - 24, r.left + r.width / 2 - x - 8));
      coach.style.setProperty("--arrow-x", ax + "px");
    }
    coach.style.left = x + "px";
    coach.style.top = y + "px";
  };
  const paintRef = useRef(paint);
  paintRef.current = paint;

  useLayoutEffect(() => { paint(); });
  useEffect(() => {
    const h = () => paintRef.current();
    addEventListener("resize", h);
    return () => removeEventListener("resize", h);
  }, []);
  useEffect(() => { const h = setTimeout(() => nextRef.current?.focus(), 50); return () => clearTimeout(h); }, []);

  if (!s) return null;
  return createPortal(
    <div className="mp-coach-layer">
      <div className="mp-coach-hl" ref={hlRef} />
      <div className="mp-coach" role="dialog" aria-modal="true" aria-labelledby="mp-coach-t" ref={coachRef}>
        <div className="mp-coach__top">
          <span className="mono-xs mp-coach__n">{(step + 1) + " / " + STEPS.length}</span><span className="spacer" />
          <button type="button" className="mp-coach__x" aria-label={t("Yopish")} onClick={onSkip}><Icon name="xmark" size="sm" /></button>
        </div>
        <div className="heading-sm" id="mp-coach-t">{t(s.title)}</div>
        <div className="body-sm mp-coach__text">{t(s.text)}</div>
        <div className="mp-coach__acts">
          <button type="button" className="label-sm mp-coach__skip" onClick={onSkip}>{t("Oʻtkazib yuborish")}</button>
          <span className="spacer" />
          <button type="button" ref={nextRef} className="mp-coach__next label-sm" onClick={onNext}>{t(step === STEPS.length - 1 ? "Tushunarli" : "Keyingi")}</button>
        </div>
        <span className="mp-coach__arrow" />
      </div>
    </div>, document.body);
}
