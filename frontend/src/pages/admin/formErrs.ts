/* pages/admin/formErrs.ts — Boshqaruv shakllari uchun xato holati (useErrs).
   blur'da tekshirish: set(k, msg) → bool, live(k, msg) (faqat xato ko'rsatilayotgan bo'lsa),
   reg(k) — fokus uchun ref, checkAll — birinchi xatoga fokus. Maydon ko'rinishi — FormBits.tsx (Fld). */
import { useCallback, useRef, useState } from "react";

export function useErrs() {
  const [errs, setErrs] = useState<Record<string, string>>({});
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const errsRef = useRef(errs);
  errsRef.current = errs;

  const set = useCallback((k: string, msg: string) => {
    setErrs((e) => ((e[k] || "") === msg ? e : { ...e, [k]: msg }));
    return !msg;
  }, []);
  /** "input" hodisasi: maydon xato holatida bo'lsa qayta tekshiriladi. */
  const live = useCallback((k: string, msg: string) => { if (errsRef.current[k]) set(k, msg); }, [set]);
  const reset = useCallback(() => setErrs({}), []);
  const reg = useCallback((k: string) => (el: HTMLElement | null) => { refs.current[k] = el; }, []);
  const focus = useCallback((k: string) => { refs.current[k]?.focus(); }, []);
  /** Bir nechta tekshiruv: birinchi xato maydonga fokus. [k, msg][] → hammasi to'g'rimi */
  const checkAll = useCallback((list: [string, string][]) => {
    let ok = true;
    for (const [k, msg] of list) {
      if (!set(k, msg)) { if (ok) refs.current[k]?.focus(); ok = false; }
    }
    return ok;
  }, [set]);
  return { errs, set, live, reset, reg, focus, checkAll };
}
