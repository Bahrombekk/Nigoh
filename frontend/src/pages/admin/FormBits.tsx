/* pages/admin/FormBits.tsx — Boshqaruv shakllari uchun kichik bo'laklar (v3 camera-form.js).
   Fld        — .field (label yoki div) + .field__hint; xato bo'lsa .is-error, ogohlantirish ikonkasi.
   AlertBox   — showAlert(): tone success | error | warning | info | wait (spinner).
   useErrs    — blur'da tekshirish: set(k, msg) → bool, live(k, msg) (faqat xato ko'rsatilayotgan bo'lsa),
                reg(k) — fokus uchun ref, birinchi xatoga fokus. */
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { InfoTip, cx } from "@/components/ui";
import { useT } from "@/i18n/I18nProvider";

export function Fld({ label, info, hint, hintClass, error, div, htmlFor, labelId, className, children }: {
  label: string; info?: string; hint?: ReactNode; hintClass?: string; error?: string; div?: boolean;
  htmlFor?: string; labelId?: string; className?: string; children: ReactNode;
}) {
  const t = useT();
  const cls = cx("field", !!error && "is-error", className);
  const lbl = div
    ? <span className="field__label"><label htmlFor={htmlFor}>{t(label)}</label>{info && <InfoTip text={info} />}</span>
    : <span className="field__label" id={labelId}>{t(label)}{info && <InfoTip text={info} />}</span>;
  const h = error
    ? <span className={cx("field__hint", hintClass)}><Icon name="triangle-exclamation" size="sm" /><span>{t(error)}</span></span>
    : hint != null && hint !== "" ? <span className={cx("field__hint", hintClass)}>{typeof hint === "string" ? t(hint) : hint}</span> : null;
  return div
    ? <div className={cls}>{lbl}{children}{h}</div>
    : <label className={cls}>{lbl}{children}{h}</label>;
}

export type AlertTone = "success" | "error" | "warning" | "info" | "wait";
export interface AlertState { tone: AlertTone; title: string; text?: string }

const ALERT_ICON: Record<string, string> = {
  success: "circle-check", error: "triangle-exclamation", warning: "triangle-exclamation", info: "circle-question",
};

export function AlertBox({ st }: { st: AlertState | null }) {
  const t = useT();
  if (!st) return null;
  return (
    <div className={"alert " + (st.tone === "wait" ? "alert--wait" : "alert--" + st.tone)} role={st.tone === "error" ? "alert" : "status"}>
      {st.tone === "wait"
        ? <span className="spinner ad-spin-sm" aria-hidden="true" />
        : <span data-icon={ALERT_ICON[st.tone]}><Icon name={ALERT_ICON[st.tone]} size="sm" /></span>}
      <div className="alert__body">
        <span className="alert__title">{t(st.title)}</span>
        {st.text && <span className="alert__text">{t(st.text)}</span>}
      </div>
    </div>
  );
}

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
