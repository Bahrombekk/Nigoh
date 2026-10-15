/* components/overlayHooks.tsx — suzuvchi qatlamlar bilan ishlaydigan hook'lar.
   useMenuAnchor(place) — tugma + Popover/Menu.
   useShortcut(key, fn) — global yorliq (input ichida ishlamaydi).
   useDelayed(flag, 300) — skeleton faqat 300 ms dan uzoq yuklansa. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Menu, Popover, type MenuEntry, type Place } from "./overlays";

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
