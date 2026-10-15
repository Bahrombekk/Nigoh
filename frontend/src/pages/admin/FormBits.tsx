/* pages/admin/FormBits.tsx — Boshqaruv shakllari uchun kichik bo'laklar (v3 camera-form.js).
   Fld        — .field (label yoki div) + .field__hint; xato bo'lsa .is-error, ogohlantirish ikonkasi.
   AlertBox   — showAlert(): tone success | error | warning | info | wait (spinner).
   useErrs    — formErrs.ts da (blur'da tekshirish, birinchi xatoga fokus). */
import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { InfoTip } from "@/components/ui";
import { cx } from "@/lib/cx";
import { useT } from "@/i18n/i18nContext";

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
