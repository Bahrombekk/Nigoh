/* components/overlays.tsx — suzuvchi qatlamlar (Figma: Tooltip, Popover, Menu, Dialog, Toast).
   TooltipLayer   — App'da bir marta; [data-tip] (+data-tip-title, data-tip-place) bo'lgan
                    har qanday element: 150 ms kechikish, Esc yopadi, matn joriy tilda.
   Popover        — anchor elementga bog'langan portal; tashqariga click / Esc yopadi,
                    menyuda ↑↓.
   Menu           — Popover ichida MenuItem'lar (items: {label, icon, kbd, danger, on, disabled, onClick} | "sep" | {heading}).
   Dialog         — .dialog-backdrop; Esc / fonga click yopadi.
   OverlayProvider — useToast() (toast(text, {tone, action, onAction, ms})) va
                    useConfirm() (await confirm({title, text, ok, danger}) → boolean).
   useShortcut(key, fn) — global yorliq (input ichida ishlamaydi).
   useDelayed(flag, 300) — skeleton faqat 300 ms dan uzoq yuklansa. */
import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { Button } from "./ui";
import { useT } from "@/i18n/I18nProvider";

/* ---------- Tooltip ---------- */
export function TooltipLayer() {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const elRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = elRef.current!;
    let timer = 0;
    let target: HTMLElement | null = null;
    const hide = () => { clearTimeout(timer); target = null; el.classList.remove("show"); };
    const show = (tg: HTMLElement) => {
      if (!document.contains(tg)) return;
      const tip = tg.dataset.tip || "";
      const title = tg.dataset.tipTitle;
      el.textContent = "";
      if (title) { const b = document.createElement("b"); b.textContent = tRef.current(title); el.appendChild(b); }
      el.appendChild(document.createTextNode(tRef.current(tip)));
      el.classList.remove("below", "side");
      const r = tg.getBoundingClientRect();
      const tw = el.offsetWidth, th = el.offsetHeight;
      const place = tg.dataset.tipPlace || "top";
      let x: number, y: number;
      if (place === "right") { x = r.right + 8; y = r.top + r.height / 2 - th / 2; el.classList.add("side"); }
      else {
        x = Math.max(8, Math.min(innerWidth - tw - 8, r.left + r.width / 2 - tw / 2));
        y = r.top - th - 8;
        if (place === "bottom" || y < 8) { y = r.bottom + 8; el.classList.add("below"); }
        el.style.setProperty("--arrow-x", r.left + r.width / 2 - x + "px");
      }
      el.style.left = x + "px"; el.style.top = y + "px";
      el.classList.add("show");
    };
    const over = (e: Event) => {
      // Fokus orqali — faqat klaviatura fokusida (sichqoncha bosganda tooltip chiqmasin, v3 dagidek).
      if (e.type === "focusin" && !(e.target as Element)?.matches?.(":focus-visible")) return;
      const tg = (e.target as Element)?.closest?.("[data-tip]") as HTMLElement | null;
      if (!tg || tg === target || !tg.dataset.tip) return;
      target = tg;
      clearTimeout(timer);
      timer = window.setTimeout(() => show(tg), 150);
    };
    const out = (e: MouseEvent | FocusEvent) => {
      if (!target) return;
      const rt = e.relatedTarget as Node | null;
      if (rt && target.contains(rt)) return;
      hide();
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); };
    document.addEventListener("mouseover", over);
    document.addEventListener("focusin", over);
    document.addEventListener("mouseout", out);
    document.addEventListener("focusout", out);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mouseover", over);
      document.removeEventListener("focusin", over);
      document.removeEventListener("mouseout", out);
      document.removeEventListener("focusout", out);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", key);
    };
  }, []);
  return createPortal(<div id="tooltip" role="tooltip" ref={elRef} />, document.body);
}

/* ---------- Popover ---------- */
export type Place = "bottom-end" | "bottom-start" | "right-end" | "right-start" | "top-end" | "top-start";

export function Popover({ anchor, open, onClose, place = "bottom-end", offset = 8, className = "", width, children }: {
  anchor: HTMLElement | null; open: boolean; onClose: () => void; place?: Place; offset?: number;
  className?: string; width?: number; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) return;
    const place_ = () => {
      const el = ref.current!;
      const r = anchor.getBoundingClientRect();
      const w = el.offsetWidth, h = el.offsetHeight;
      let x: number, y: number;
      if (place.startsWith("right")) { x = r.right + offset; y = place === "right-end" ? r.bottom - h : r.top; }
      else if (place.startsWith("top")) { y = r.top - h - offset; x = place === "top-start" ? r.left : r.right - w; }
      else { y = r.bottom + offset; x = place === "bottom-start" ? r.left : r.right - w; }
      setPos({ x: Math.max(8, Math.min(innerWidth - w - 8, x)), y: Math.max(8, Math.min(innerHeight - h - 8, y)) });
    };
    place_();
    addEventListener("resize", onClose);
    return () => removeEventListener("resize", onClose);
  }, [open, anchor, place, offset, onClose]);

  useEffect(() => {
    if (!open) return;
    anchor?.setAttribute("aria-expanded", "true");
    const down = (e: PointerEvent) => {
      const n = e.target as Node;
      if (ref.current?.contains(n) || anchor?.contains(n)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); onClose(); anchor?.focus(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>(".menu__item:not(:disabled)") || [])];
        if (!items.length) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        items[e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length].focus();
      }
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    return () => {
      anchor?.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [open, anchor, onClose]);

  if (!open) return null;
  return createPortal(
    <div ref={ref} className={"popover " + className}
      style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, width, visibility: pos ? "visible" : "hidden" }}>
      {children}
    </div>, document.body);
}

/* ---------- Menu ---------- */
export type MenuEntry = "sep" | { heading: string } | {
  label: string; icon?: string; kbd?: string; danger?: boolean; on?: boolean; disabled?: boolean; onClick?: () => void;
};
export function Menu({ items, onDone, autoFocus = true }: { items: MenuEntry[]; onDone: () => void; autoFocus?: boolean }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (autoFocus) ref.current?.querySelector<HTMLButtonElement>(".menu__item")?.focus(); }, [autoFocus]);
  return (
    <div className="menu" role="menu" ref={ref}>
      {items.map((it, i) => {
        if (it === "sep") return <div key={i} className="menu__sep" role="separator" />;
        if ("heading" in it) return <div key={i} className="menu__label">{t(it.heading)}</div>;
        return (
          <button key={i} type="button" role="menuitem" disabled={it.disabled}
            className={"menu__item" + (it.danger ? " is-danger" : "") + (it.on ? " is-on" : "")}
            onClick={() => { onDone(); it.onClick?.(); }}>
            {it.icon && <Icon name={it.icon} size="sm" />}
            <span className="ellipsis">{t(it.label)}</span>
            {it.kbd && <span className="menu__kbd">{it.kbd}</span>}
            {it.on && !it.kbd && <span className="menu__check"><Icon name="check" size="sm" /></span>}
          </button>
        );
      })}
    </div>
  );
}

/** Tugma + menyu: const m = useMenuAnchor(); <button ref={m.ref} onClick={m.toggle}/> {m.render(items)} */
export function useMenuAnchor(place: Place = "bottom-end") {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return {
    ref: setAnchor,
    open,
    toggle: () => setOpen((o) => !o),
    close,
    render: (items: MenuEntry[], width?: number) => (
      <Popover anchor={anchor} open={open} onClose={close} place={place} width={width}>
        <Menu items={items} onDone={close} />
      </Popover>
    ),
  };
}

/* ---------- Dialog ---------- */
export function Dialog({ open, onClose, title, size, children, actions, role = "dialog", className = "" }: {
  open: boolean; onClose: () => void; title?: string; size?: "md" | "lg"; children?: ReactNode; actions?: ReactNode;
  role?: "dialog" | "alertdialog"; className?: string;
}) {
  const t = useT();
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="dialog-backdrop open" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={"dialog" + (size ? " dialog--" + size : "") + " " + className} role={role} aria-modal="true">
        {title && (
          <div className="dialog__head">
            <h2 className="dialog__title">{t(title)}</h2>
            <button type="button" className="icon-btn icon-btn--sm dialog__close" data-tip="Yopish" aria-label={t("Yopish")} onClick={onClose}>
              <Icon name="xmark" size="sm" />
            </button>
          </div>
        )}
        {children}
        {actions && <div className="dialog__actions">{actions}</div>}
      </div>
    </div>, document.body);
}

/* ---------- Toast + Confirm ---------- */
type Tone = "success" | "info" | "error";
interface ToastOpts { tone?: Tone; action?: string; onAction?: () => void; ms?: number }
interface ToastItem extends ToastOpts { id: number; text: string; out?: boolean }
interface ConfirmOpts { title: string; text?: string; ok?: string; cancel?: string; danger?: boolean; icon?: string }

const OverlayCtx = createContext<{
  toast: (text: string, opts?: ToastOpts | boolean) => () => void;
  confirm: (o: ConfirmOpts) => Promise<boolean>;
} | null>(null);

const TOAST_ICON: Record<Tone, string> = { success: "circle-check", info: "circle-info", error: "triangle-exclamation" };
let toastSeq = 0;

export function OverlayProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [conf, setConf] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const close = useCallback((id: number) => {
    setToasts((l) => l.map((x) => (x.id === id ? { ...x, out: true } : x)));
    setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), 200);
  }, []);

  const toast = useCallback((text: string, opts?: ToastOpts | boolean) => {
    const o: ToastOpts = typeof opts === "boolean" ? { tone: opts ? "error" : "success" } : opts || {};
    const id = ++toastSeq;
    setToasts((l) => [...l.slice(-2), { id, text, ...o }]);
    return () => close(id);        // toast'ni oldinroq yopish (masalan "tekshirilmoqda…" tugaganda)
  }, [close]);

  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setConf({ ...o, resolve })), []);
  useEffect(() => { if (conf) setTimeout(() => cancelRef.current?.focus(), 20); }, [conf]);
  const done = (v: boolean) => { conf?.resolve(v); setConf(null); };

  return (
    <OverlayCtx.Provider value={{ toast, confirm }}>
      {children}
      {createPortal(
        <div id="toasts" role="status" aria-live="polite">
          {toasts.map((x) => <ToastView key={x.id} item={x} onClose={() => close(x.id)} />)}
        </div>, document.body)}
      <Dialog open={!!conf} onClose={() => done(false)} role="alertdialog"
        actions={<>
          <Button ref={cancelRef} variant="secondary" onClick={() => done(false)}>{t(conf?.cancel || "Bekor qilish")}</Button>
          <Button variant={conf?.danger ? "danger" : "primary"} onClick={() => done(true)}>{t(conf?.ok || "Tasdiqlash")}</Button>
        </>}>
        {conf && (conf.icon || conf.danger) && <div className="dialog__icon"><Icon name={conf.icon || "trash"} size="lg" /></div>}
        {conf && (
          <div>
            <div className="heading-md">{t(conf.title)}</div>
            {conf.text && <p className="dialog__text" style={{ marginTop: 6 }}>{t(conf.text)}</p>}
          </div>
        )}
      </Dialog>
    </OverlayCtx.Provider>
  );
}

function ToastView({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const t = useT();
  const timer = useRef(0);
  // onClose har chizishda yangi funksiya — taymer faqat bir marta (yoki hover'dan keyin) qo'yiladi,
  // aks holda yangi toast qo'shilganda eskilarining taymeri qayta boshlanardi.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const arm = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => closeRef.current(), item.ms || 4000);
  }, [item.ms]);
  useEffect(() => { arm(); return () => clearTimeout(timer.current); }, [arm]);
  const tone = item.tone || "success";
  return (
    <div className={"toast toast--" + tone + (item.out ? " out" : "")}
      onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={arm}>
      <Icon name={TOAST_ICON[tone]} size="sm" />
      <span className="toast__msg">{t(item.text)}</span>
      {item.action && <button type="button" className="toast__action" onClick={() => { onClose(); item.onAction?.(); }}>{t(item.action)}</button>}
      <button type="button" className="toast__close" aria-label={t("Yopish")} onClick={onClose}><Icon name="xmark" size="sm" /></button>
    </div>
  );
}

export function useToast() {
  const c = useContext(OverlayCtx);
  if (!c) throw new Error("OverlayProvider yo'q");
  return c.toast;
}
export function useConfirm() {
  const c = useContext(OverlayCtx);
  if (!c) throw new Error("OverlayProvider yo'q");
  return c.confirm;
}

/* ---------- Klaviatura ---------- */
export function useShortcut(key: string, fn: (e: KeyboardEvent) => boolean | void, enabled = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== key || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const tg = e.target as HTMLElement;
      if (tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))) return;
      if (document.querySelector(".dialog-backdrop.open, .login.open")) return;
      if (ref.current(e) !== false) e.preventDefault();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [key, enabled]);
}

export function useDelayed(flag: boolean, ms = 300) {
  const [v, setV] = useState(false);
  useEffect(() => {
    if (!flag) { setV(false); return; }
    const id = setTimeout(() => setV(true), ms);
    return () => clearTimeout(id);
  }, [flag, ms]);
  return v;
}
