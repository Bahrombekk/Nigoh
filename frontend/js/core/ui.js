/* ==========================================================================
   core/ui.js — umumiy UI xizmatlari (Figma v3 komponentlari xatti-harakati)
   --------------------------------------------------------------------------
   Vazifasi:
     Har sahifa ishlatadigan kichik xizmatlar — markup css/base.css da:
       Tooltip   — [data-tip] (va [data-tip-title]) bo'lgan har qanday element:
                   hover/focus'da 150 ms kechikish bilan; Esc yopadi.
                   IconButton va InfoTip shu bilan ishlaydi (aria-label/
                   aria-describedby avtomatik qo'yiladi).
       toast()   — pastki markazda; 4 s, hover'da to'xtaydi; ixtiyoriy amal.
       confirmDialog() — Dialog/Tasdiqlash (fokus "Bekor qilish"da, Esc = bekor).
       popover() — elementga bog'langan suzuvchi oyna (menyu, qatlamlar...):
                   tashqariga click / Esc yopadi, ↑↓ Enter menyuda.
       menu()    — popover ichida MenuItem ro'yxati.
       emptyState(), skeletonRows(), infotip() — HTML satr yasovchilar.
       shortcuts — global klaviatura: on(key, fn) (input ichida ishlamaydi).

   Eksport: tooltip, toast, confirmDialog, popover, closePopovers, menu,
            emptyState, skeletonRows, infotip, shortcuts, onShortcut,
            debounce, fmtTime, fmtDateShort, delayed

   Bog'liqliklar: ./icons.js (icon, hydrateIcons), ./state.js ($, esc)
   ========================================================================== */
import { icon, hydrateIcons } from "./icons.js";
import { esc, setToastImpl } from "./state.js";
import { dateShort } from "./i18n.js";

/* ---------- Tooltip ---------- */
class Tooltip {
  constructor() {
    this.el = document.createElement("div");
    this.el.id = "tooltip";
    this.el.setAttribute("role", "tooltip");
    document.body.appendChild(this.el);
    this.timer = null;
    this.target = null;
    const show = (e) => {
      const t = e.target.closest && e.target.closest("[data-tip]");
      if (!t || t === this.target) return;
      this.target = t;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.show(t), 150);
    };
    const hide = (e) => {
      if (!this.target) return;
      if (e.relatedTarget && this.target.contains(e.relatedTarget)) return;
      this.hide();
    };
    document.addEventListener("mouseover", show);
    document.addEventListener("focusin", (e) => { if (e.target.matches && e.target.matches(":focus-visible")) show(e); });
    document.addEventListener("mouseout", hide);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", () => this.hide(), true);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") this.hide(); });
    // aria: IconButton — aria-label, InfoTip — aria-describedby
    this.label(document);
  }

  label(root) {
    root.querySelectorAll("[data-tip]").forEach((el) => {
      if (!el.getAttribute("aria-label") && !el.textContent.trim()) el.setAttribute("aria-label", el.dataset.tip);
      if (el.classList.contains("infotip")) el.setAttribute("aria-describedby", "tooltip");
    });
  }

  show(t) {
    if (!document.contains(t)) return;
    const title = t.dataset.tipTitle;
    this.el.innerHTML = (title ? "<b>" + esc(title) + "</b>" : "") + esc(t.dataset.tip);
    this.el.classList.remove("below", "side");
    const r = t.getBoundingClientRect();
    const tw = this.el.offsetWidth, th = this.el.offsetHeight;
    const place = t.dataset.tipPlace || "top";
    let x, y;
    if (place === "right") {
      x = r.right + 8; y = r.top + r.height / 2 - th / 2; this.el.classList.add("side");
    } else {
      x = Math.max(8, Math.min(innerWidth - tw - 8, r.left + r.width / 2 - tw / 2));
      y = r.top - th - 8;
      if (place === "bottom" || y < 8) { y = r.bottom + 8; this.el.classList.add("below"); }
      this.el.style.setProperty("--arrow-x", (r.left + r.width / 2 - x) + "px");
    }
    this.el.style.left = x + "px";
    this.el.style.top = y + "px";
    this.el.classList.add("show");
  }

  hide() {
    clearTimeout(this.timer);
    this.target = null;
    this.el.classList.remove("show");
  }
}
export const tooltip = new Tooltip();

/* ---------- Toast ---------- */
const toasts = document.createElement("div");
toasts.id = "toasts";
toasts.setAttribute("role", "status");
toasts.setAttribute("aria-live", "polite");
document.body.appendChild(toasts);

const TOAST_ICON = { success: "circle-check", info: "circle-question", error: "triangle-exclamation" };

/* toast("Matn", { tone: "success"|"info"|"error", action: "Qaytarish", onAction, ms }) */
export function toast(text, opts = {}) {
  if (typeof opts === "boolean") opts = { tone: opts ? "error" : "success" };
  const tone = opts.tone || "success";
  const el = document.createElement("div");
  el.className = "toast toast--" + tone;
  el.innerHTML = icon(TOAST_ICON[tone] || "circle-check", "sm") +
    '<span class="toast__msg">' + esc(text) + "</span>" +
    (opts.action ? '<button class="toast__action">' + esc(opts.action) + "</button>" : "") +
    '<button class="toast__close" aria-label="Yopish">' + icon("xmark", "sm") + "</button>";
  toasts.appendChild(el);
  let timer = null;
  const close = () => {
    clearTimeout(timer);
    el.classList.add("out");
    setTimeout(() => el.remove(), 200);
  };
  const arm = () => { timer = setTimeout(close, opts.ms || 4000); };
  el.addEventListener("mouseenter", () => clearTimeout(timer));
  el.addEventListener("mouseleave", arm);
  el.querySelector(".toast__close").addEventListener("click", close);
  if (opts.action) el.querySelector(".toast__action").addEventListener("click", () => {
    close();
    if (opts.onAction) opts.onAction();
  });
  while (toasts.children.length > 3) toasts.firstChild.remove();
  arm();
  return close;
}
setToastImpl(toast);

/* ---------- Dialog / Tasdiqlash ---------- */
/* await confirmDialog({ title, text, ok: "Oʻchirish", danger: true, icon: "trash" }) → true/false */
export function confirmDialog({ title, text = "", ok = "Tasdiqlash", cancel = "Bekor qilish",
                                danger = false, icon: ic = danger ? "trash" : null } = {}) {
  return new Promise((resolve) => {
    const bd = document.createElement("div");
    bd.className = "dialog-backdrop open";
    bd.innerHTML =
      '<div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="cd-title">' +
        (ic ? '<div class="dialog__icon">' + icon(ic, "lg") + "</div>" : "") +
        '<div><div class="heading-md" id="cd-title">' + esc(title) + "</div>" +
        (text ? '<p class="dialog__text" style="margin-top:6px">' + esc(text) + "</p>" : "") + "</div>" +
        '<div class="dialog__actions">' +
          '<button class="btn btn--secondary" data-v="0">' + esc(cancel) + "</button>" +
          '<button class="btn ' + (danger ? "btn--danger" : "btn--primary") + '" data-v="1">' + esc(ok) + "</button>" +
        "</div></div>";
    document.body.appendChild(bd);
    const done = (v) => {
      document.removeEventListener("keydown", onKey, true);
      bd.remove();
      resolve(v);
    };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(false); } };
    document.addEventListener("keydown", onKey, true);
    bd.addEventListener("click", (e) => {
      if (e.target === bd) return done(false);
      const b = e.target.closest("[data-v]");
      if (b) done(b.dataset.v === "1");
    });
    // Xavfsiz standart: fokus "Bekor qilish"da.
    bd.querySelector('[data-v="0"]').focus();
  });
}

/* ---------- Popover ---------- */
let openPop = null;

export function closePopovers() {
  if (!openPop) return;
  const p = openPop;
  openPop = null;
  p.el.remove();
  if (p.anchor) p.anchor.setAttribute("aria-expanded", "false");
  if (p.onClose) p.onClose();
}

/* popover(anchor, html | element, { place: "bottom-end"|"bottom-start"|"right-end"|"right-start"|"top-end",
                                     offset: 8, cls, onClose, width }) → element */
export function popover(anchor, content, opts = {}) {
  const reopen = openPop && openPop.anchor === anchor;
  closePopovers();
  if (reopen && !opts.force) return null;          // ikkinchi bosish — yopadi
  const el = document.createElement("div");
  el.className = "popover " + (opts.cls || "");
  if (opts.width) el.style.width = opts.width + "px";
  if (typeof content === "string") el.innerHTML = content; else el.appendChild(content);
  document.body.appendChild(el);
  hydrateIcons(el);
  tooltip.label(el);
  openPop = { el, anchor, onClose: opts.onClose };
  if (anchor) anchor.setAttribute("aria-expanded", "true");
  placePopover(el, anchor, opts);
  return el;
}

export function placePopover(el, anchor, opts = {}) {
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  const off = opts.offset ?? 8;
  const w = el.offsetWidth, h = el.offsetHeight;
  const place = opts.place || "bottom-end";
  let x, y;
  if (place.startsWith("right")) {
    x = r.right + off;
    y = place === "right-end" ? r.bottom - h : r.top;
  } else if (place.startsWith("top")) {
    y = r.top - h - off;
    x = place === "top-start" ? r.left : r.right - w;
  } else {
    y = r.bottom + off;
    x = place === "bottom-start" ? r.left : r.right - w;
  }
  x = Math.max(8, Math.min(innerWidth - w - 8, x));
  y = Math.max(8, Math.min(innerHeight - h - 8, y));
  el.style.left = x + "px";
  el.style.top = y + "px";
}

document.addEventListener("pointerdown", (e) => {
  if (!openPop) return;
  if (openPop.el.contains(e.target) || (openPop.anchor && openPop.anchor.contains(e.target))) return;
  closePopovers();
}, true);
document.addEventListener("keydown", (e) => {
  if (!openPop) return;
  if (e.key === "Escape") {
    e.stopPropagation();
    const a = openPop.anchor;
    closePopovers();
    if (a) a.focus();
    return;
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    const items = [...openPop.el.querySelectorAll(".menu__item:not(:disabled)")];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement);
    const n = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[n].focus();
  }
}, true);
addEventListener("resize", closePopovers);

/* menu(anchor, items, opts) — items: [{ label, icon, kbd, danger, on, disabled, onClick } | "sep" | { heading }] */
export function menu(anchor, items, opts = {}) {
  const wrap = document.createElement("div");
  wrap.className = "menu";
  wrap.setAttribute("role", "menu");
  items.forEach((it) => {
    if (it === "sep") { wrap.insertAdjacentHTML("beforeend", '<div class="menu__sep" role="separator"></div>'); return; }
    if (it.heading) { wrap.insertAdjacentHTML("beforeend", '<div class="menu__label">' + esc(it.heading) + "</div>"); return; }
    const b = document.createElement("button");
    b.className = "menu__item" + (it.danger ? " is-danger" : "") + (it.on ? " is-on" : "");
    b.setAttribute("role", "menuitem");
    b.disabled = !!it.disabled;
    b.innerHTML = (it.icon ? icon(it.icon, "sm") : "") + '<span class="ellipsis">' + esc(it.label) + "</span>" +
      (it.kbd ? '<span class="menu__kbd">' + esc(it.kbd) + "</span>" : "") +
      (it.on && !it.kbd ? '<span class="menu__check">' + icon("check", "sm") + "</span>" : "");
    b.addEventListener("click", () => { closePopovers(); if (it.onClick) it.onClick(); });
    wrap.appendChild(b);
  });
  const el = popover(anchor, wrap, Object.assign({ place: "bottom-end" }, opts));
  if (el) { const first = el.querySelector(".menu__item"); if (first && opts.focus !== false) first.focus(); }
  return el;
}

/* ---------- HTML yasovchilar ---------- */
export function infotip(text, title) {
  return '<button type="button" class="infotip" data-tip="' + esc(text) + '"' +
    (title ? ' data-tip-title="' + esc(title) + '"' : "") + ">" + icon("circle-question", "sm") + "</button>";
}

/* EmptyState: type search | filter | nodata */
export function emptyState({ type = "search", title, text = "", action = "", primary = false, id = "" }) {
  const ic = { search: "search", filter: "filter", nodata: "camera" }[type] || type;
  return '<div class="empty">' +
    '<div class="empty__icon">' + icon(ic, "lg") + "</div>" +
    '<div class="empty__title">' + esc(title) + "</div>" +
    (text ? '<div class="empty__text">' + esc(text) + "</div>" : "") +
    (action ? '<button class="btn btn--sm ' + (primary ? "btn--primary" : "btn--secondary") + '"' +
      (id ? ' id="' + id + '"' : "") + ">" + esc(action) + "</button>" : "") + "</div>";
}

export function skeletonRows(n = 6) {
  let h = "";
  for (let i = 0; i < n; i++) {
    h += '<div class="sk-row" style="display:flex;align-items:center;gap:12px;height:52px;padding:8px 12px">' +
      '<span class="skeleton" style="width:8px;height:8px"></span>' +
      '<span style="flex:1;display:flex;flex-direction:column;gap:6px">' +
        '<span class="skeleton" style="height:12px;width:' + (50 + (i * 17) % 40) + '%"></span>' +
        '<span class="skeleton" style="height:10px;width:30%"></span></span>' +
      '<span class="skeleton" style="width:28px;height:18px"></span></div>';
  }
  return h;
}

/* Skeleton faqat yuklash 300 ms dan oshsa (Dev handoff §7):
   const stop = delayed(() => el.innerHTML = skeletonRows(), 300); … stop(); */
export function delayed(fn, ms = 300) {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
}

/* ---------- Klaviatura yorliqlari ---------- */
const keyHandlers = new Map();
export const shortcuts = {
  on(key, fn) { (keyHandlers.get(key) || keyHandlers.set(key, []).get(key)).push(fn); },
};
export function onShortcut(key, fn) { shortcuts.on(key, fn); }
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if (document.querySelector(".dialog-backdrop.open, .login.open")) return;
  const list = keyHandlers.get(e.key);
  if (!list) return;
  for (const fn of list) {
    if (fn(e) !== false) { e.preventDefault(); return; }
  }
});

/* ---------- Mayda yordamchilar ---------- */
export function debounce(fn, ms = 300) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
const p2 = (n) => String(n).padStart(2, "0");
export function fmtTime(d = new Date()) {
  d = d instanceof Date ? d : new Date(d);
  return p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds());
}
/* "Chor, 8 okt" — joriy tilda (core/i18n.js). */
export function fmtDateShort(d = new Date()) {
  return dateShort(d);
}
