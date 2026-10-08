/* ==========================================================================
   map/onboarding.js — Coachmark onboarding (Figma 02.22 → 02.06 → 02.23)
   --------------------------------------------------------------------------
   Vazifasi:
     Faqat birinchi kirishda 3 qadam: (1) Panel va qidiruv → (2) Qatlamlar →
     (3) Kamera tanlash. Scrim + ajratilgan element (brand halqa) + brand
     rangli coachmark (strelka elementga qaragan). "Keyingi" / "Oʻtkazib
     yuborish" / × / Esc (= o'tkazib yuborish). Holat prefs'da:
     onboarding.map = "done". Yordam oynasidagi "Tanishtiruvni qayta koʻrish"
     (#help-tour) qayta boshlaydi.

   Eksport: Onboarding, onboarding
     onboarding.maybeStart() — birinchi kirishda (page.js, ma'lumot kelgach)
     onboarding.start()      — majburan boshlash
     onboarding.escape()     — Esc (true — yopildi)
   Bog'liqliklar: ../core/state.js, ../core/prefs.js, ../core/icons.js, ./map.js (map)
   ========================================================================== */
import { $, state } from "../core/state.js";
import { prefs } from "../core/prefs.js";
import { icon } from "../core/icons.js";
import { map } from "./map.js";

const STEPS = [
  { target: () => $("mp-panel"), place: "right", title: "Panel va qidiruv",
    text: "Kamerani nomi, km yoki hudud boʻyicha toping. Holat filtrlari roʻyxat va xaritaga birga qoʻllanadi." },
  { target: () => $("mp-layers"), place: "bottom", title: "Xarita qatlamlari",
    text: "Temir yoʻl, hudud chegaralari va klasterlarni shu yerdan yoqing." },
  { target: () => findMarker(), place: "bottom", title: "Kamera tanlash",
    text: "Markerni bosing — kichik kamera kartasi ochiladi. “Batafsil” — jonli video va tafsilotlar." },
];

/* Ekran markaziga eng yaqin ko'rinib turgan marker yoki klaster. */
function findMarker() {
  const box = map.getContainer().getBoundingClientRect();
  const cx = box.left + box.width * 0.6, cy = box.top + box.height / 2;
  let best = null, bd = Infinity;
  map.getContainer().querySelectorAll(".mp-cl-wrap, .mp-mk-wrap").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.right < box.left + 460 || r.left > box.right - 80 || r.top < box.top + 80 || r.bottom > box.bottom - 80) return;
    const d = (r.left + r.width / 2 - cx) ** 2 + (r.top + r.height / 2 - cy) ** 2;
    if (d < bd) { bd = d; best = el; }
  });
  return best;
}

export class Onboarding {
  constructor() { this.step = -1; this.el = null; }

  get active() { return this.step >= 0; }

  done() { return (prefs.get("onboarding", {}) || {}).map === "done"; }

  maybeStart() {
    if (this.done() || this.active) return;
    if (document.querySelector(".login.open, .dialog-backdrop.open")) return;
    this.start();
  }

  start() {
    if (state.tab !== "map") return;
    this.finish(false);
    this.step = 0;
    this.el = document.createElement("div");
    this.el.className = "mp-coach-layer";
    this.el.innerHTML = '<div class="mp-coach-hl"></div>' +
      '<div class="mp-coach" role="dialog" aria-modal="true" aria-labelledby="mp-coach-t">' +
        '<div class="mp-coach__top"><span class="mono-xs mp-coach__n"></span><span class="spacer"></span>' +
          '<button class="mp-coach__x" data-c="skip" aria-label="Yopish">' + icon("xmark", "sm") + "</button></div>" +
        '<div class="heading-sm" id="mp-coach-t"></div>' +
        '<div class="body-sm mp-coach__text"></div>' +
        '<div class="mp-coach__acts"><button class="label-sm mp-coach__skip" data-c="skip">Oʻtkazib yuborish</button>' +
          '<span class="spacer"></span><button class="mp-coach__next label-sm" data-c="next">Keyingi</button></div>' +
        '<span class="mp-coach__arrow"></span>' +
      "</div>";
    document.body.appendChild(this.el);
    this.el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-c]");
      if (!b) return;
      if (b.dataset.c === "next") this.next(); else this.finish(true);
    });
    this.onResize = () => this.paint();
    addEventListener("resize", this.onResize);
    this.paint();
    setTimeout(() => { const n = this.el && this.el.querySelector("[data-c=next]"); if (n) n.focus(); }, 50);
  }

  next() {
    if (this.step >= STEPS.length - 1) { this.finish(true); return; }
    this.step++;
    this.paint();
  }

  paint() {
    if (!this.el) return;
    const s = STEPS[this.step];
    const coach = this.el.querySelector(".mp-coach");
    coach.querySelector(".mp-coach__n").textContent = (this.step + 1) + " / " + STEPS.length;
    coach.querySelector("#mp-coach-t").textContent = s.title;
    coach.querySelector(".mp-coach__text").textContent = s.text;
    coach.querySelector("[data-c=next]").textContent = this.step === STEPS.length - 1 ? "Tushunarli" : "Keyingi";
    const t = s.target();
    const hl = this.el.querySelector(".mp-coach-hl");
    const vw = innerWidth, vh = innerHeight;
    let r = t ? t.getBoundingClientRect() : { left: vw / 2 - 20, top: vh / 2 - 20, width: 40, height: 40, right: vw / 2 + 20, bottom: vh / 2 + 20 };
    const pad = this.step === 2 ? 6 : 4;
    hl.style.left = r.left - pad + "px";
    hl.style.top = r.top - pad + "px";
    hl.style.width = r.width + pad * 2 + "px";
    hl.style.height = r.height + pad * 2 + "px";
    hl.classList.toggle("is-round", this.step === 2);
    const w = coach.offsetWidth, h = coach.offsetHeight;
    let place = s.place;
    if (place === "right" && r.right + 16 + w > vw - 8) place = "bottom-in";
    let x, y, ax;
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
      ax = Math.max(16, Math.min(w - 24, r.left + r.width / 2 - x - 8));
      coach.style.setProperty("--arrow-x", ax + "px");
    }
    coach.style.left = x + "px";
    coach.style.top = y + "px";
  }

  finish(save) {
    if (this.el) { this.el.remove(); this.el = null; }
    if (this.onResize) { removeEventListener("resize", this.onResize); this.onResize = null; }
    const was = this.step >= 0;
    this.step = -1;
    if (save && was) prefs.set("onboarding", Object.assign({}, prefs.get("onboarding", {}) || {}, { map: "done" }));
  }

  escape() {
    if (!this.active) return false;
    this.finish(true);
    return true;
  }
}

export const onboarding = new Onboarding();
