/* components/ui.tsx — Figma komponentlari (css/base.css klasslari bilan).
   Button, IconButton, Badge (StatusBadge), Dot, Chip (FilterChip), Seg (Segmented),
   Switch, Check, InfoTip, Alert, EmptyState, SkeletonRows, SearchField, Field, Kbd.
   Matnlar chaqiruvchi tomonidan o'zbekcha beriladi — bu yerda useT() bilan tarjima. */
import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconSize } from "./Icon";
import { useT } from "@/i18n/I18nProvider";
import { STATUS_LABEL, type UiStatus } from "@/lib/types";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/* ---------- Button ---------- */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "tertiary" | "danger";
  size?: "md" | "sm";
  block?: boolean;
  icon?: string;
};
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = "secondary", size = "md", block, icon, className, children, type = "button", ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={cx("btn", "btn--" + variant, size === "sm" && "btn--sm", block && "btn--block", className)} {...rest}>
      {icon && <Icon name={icon} size={size === "sm" ? "sm" : "md"} />}
      {children}
    </button>
  );
});

/* ---------- IconButton (tip majburiy — aria-label va tooltip) ---------- */
type IconBtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: string; tip: string; size?: "md" | "sm"; variant?: "tertiary" | "secondary" | "primary";
  on?: boolean; tipPlace?: "top" | "bottom" | "right";
};
export const IconButton = forwardRef<HTMLButtonElement, IconBtnProps>(function IconButton(
  { icon, tip, size = "md", variant = "tertiary", on, tipPlace, className, type = "button", ...rest }, ref) {
  const t = useT();
  return (
    <button ref={ref} type={type} aria-label={t(tip)} data-tip={tip} data-tip-place={tipPlace}
      className={cx("icon-btn", size === "sm" && "icon-btn--sm", variant !== "tertiary" && "icon-btn--" + variant, on && "is-on", className)}
      {...rest}>
      <Icon name={icon} size={size === "sm" ? "sm" : "md"} />
    </button>
  );
});

/* ---------- Status ---------- */
export function Dot({ status, className }: { status: UiStatus | "brand"; className?: string }) {
  return status === "brand" ? <span className={cx("dot dot--brand", className)} /> : <span className={cx("dot", className)} data-status={status} />;
}
export function Badge({ status, children, count, solid }: {
  status?: UiStatus | "brand" | "warning"; children?: ReactNode; count?: boolean; solid?: boolean;
}) {
  const t = useT();
  const label = children ?? (status && status in STATUS_LABEL ? t(STATUS_LABEL[status as UiStatus]) : null);
  return (
    <span className={cx("badge", count && "badge--count", solid && "badge--solid")} data-status={status}>
      {!count && status && status !== "brand" && status !== "warning" && <span className="dot" data-status={status} />}
      {label}
    </span>
  );
}

/* ---------- FilterChip ---------- */
export function Chip({ on, status, label, count, onClick, tip }: {
  on?: boolean; status?: UiStatus; label: string; count?: number | string; onClick?: () => void; tip?: string;
}) {
  const t = useT();
  return (
    <button type="button" className={cx("chip", on && "is-on")} aria-pressed={!!on} onClick={onClick} data-tip={tip}>
      {status && <span className="dot" data-status={status} />}
      {t(label)}
      {count != null && <span className="chip__count">{count}</span>}
    </button>
  );
}

/* ---------- Segmented ---------- */
export interface SegItem<V extends string> { value: V; label: string; count?: number | string; disabled?: boolean; tip?: string }
export function Seg<V extends string>({ items, value, onChange, inline, small, className, ariaLabel }: {
  items: SegItem<V>[]; value: V; onChange: (v: V) => void; inline?: boolean; small?: boolean; className?: string; ariaLabel?: string;
}) {
  const t = useT();
  return (
    <div className={cx("seg", inline && "seg--inline", small && "seg--sm", className)} role="tablist" aria-label={ariaLabel && t(ariaLabel)}>
      {items.map((it) => (
        <button key={it.value} type="button" role="tab" aria-selected={it.value === value} disabled={it.disabled}
          className={cx(it.value === value && "is-on")} onClick={() => onChange(it.value)} data-tip={it.tip}>
          {t(it.label)}
          {it.count != null && <span className="seg__count">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- Switch / Checkbox ---------- */
export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  const t = useT();
  return <button type="button" role="switch" className="switch" aria-checked={checked} disabled={disabled}
    aria-label={label && t(label)} onClick={() => onChange(!checked)} />;
}
export function Check({ checked, indeterminate, onChange, label, disabled }: {
  checked: boolean; indeterminate?: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate; }, [indeterminate]);
  return <input ref={ref} type="checkbox" className="check" checked={checked} disabled={disabled}
    aria-label={label} onChange={(e) => onChange(e.target.checked)} />;
}

/* ---------- InfoTip ---------- */
export function InfoTip({ text, title }: { text: string; title?: string }) {
  const t = useT();
  return (
    <button type="button" className="infotip" data-tip={text} data-tip-title={title} aria-label={t(text)}>
      <Icon name="circle-question" size="sm" />
    </button>
  );
}

/* ---------- Alert ---------- */
export function Alert({ tone = "info", title, text, action, onAction }: {
  tone?: "error" | "warning" | "info" | "success"; title: string; text?: string; action?: string; onAction?: () => void;
}) {
  const t = useT();
  const icon = tone === "info" ? "circle-info" : tone === "success" ? "circle-check" : "triangle-exclamation";
  return (
    <div className={"alert alert--" + tone} role={tone === "error" ? "alert" : "status"}>
      <Icon name={icon} size="sm" />
      <div className="alert__body">
        <span className="alert__title">{t(title)}</span>
        {text && <span className="alert__text">{t(text)}</span>}
      </div>
      {action && <Button variant="tertiary" size="sm" onClick={onAction}>{t(action)}</Button>}
    </div>
  );
}

/* ---------- EmptyState ---------- */
export function EmptyState({ type = "search", title, text, action, onAction, primary }: {
  type?: "search" | "filter" | "nodata" | string; title: string; text?: string; action?: string; onAction?: () => void; primary?: boolean;
}) {
  const t = useT();
  const icon = ({ search: "search", filter: "filter", nodata: "camera" } as Record<string, string>)[type] || type;
  return (
    <div className="empty">
      <div className="empty__icon"><Icon name={icon} size="lg" /></div>
      <div className="empty__title">{t(title)}</div>
      {text && <div className="empty__text">{t(text)}</div>}
      {action && <Button size="sm" variant={primary ? "primary" : "secondary"} onClick={onAction}>{t(action)}</Button>}
    </div>
  );
}

/* ---------- Skeleton (faqat 300 ms dan uzoq yuklansa ko'rsating: useDelayed) ---------- */
export function SkeletonRows({ n = 6 }: { n?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, height: 52, padding: "8px 12px" }}>
          <span className="skeleton" style={{ width: 8, height: 8 }} />
          <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="skeleton" style={{ height: 12, width: 50 + ((i * 17) % 40) + "%" }} />
            <span className="skeleton" style={{ height: 10, width: "30%" }} />
          </span>
          <span className="skeleton" style={{ width: 28, height: 18 }} />
        </div>
      ))}
    </>
  );
}

/* ---------- SearchField ("/" yorlig'i bilan) ---------- */
export const SearchField = forwardRef<HTMLInputElement, {
  value: string; onChange: (v: string) => void; placeholder?: string; shortcut?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void; className?: string;
}>(function SearchField({ value, onChange, placeholder, shortcut = true, onKeyDown, className }, ref) {
  const t = useT();
  return (
    <label className={cx("search", value && "is-filled", className)}>
      <Icon name="search" />
      <input ref={ref} type="search" value={value} placeholder={placeholder && t(placeholder)}
        onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} />
      <button type="button" className="search__clear" aria-label={t("Tozalash")} onClick={() => onChange("")}>
        <Icon name="xmark" size="sm" />
      </button>
      {shortcut && <span className="kbd">/</span>}
    </label>
  );
});

/* ---------- Field (label + boshqaruv + hint) ---------- */
export function Field({ label, hint, error, info, children }: {
  label: string; hint?: string; error?: string | null; info?: string; children: ReactNode;
}) {
  const t = useT();
  return (
    <label className={cx("field", error && "is-error")}>
      <span className="field__label">{t(label)}{info && <InfoTip text={info} />}</span>
      {children}
      {(error || hint) && (
        <span className="field__hint">{error && <Icon name="triangle-exclamation" size="sm" />}{t(error || hint || "")}</span>
      )}
    </label>
  );
}

export function Kbd({ children }: { children: ReactNode }) { return <span className="kbd">{children}</span>; }
export function IconSpan({ name, size = "md" as IconSize }: { name: string; size?: IconSize }) { return <Icon name={name} size={size} />; }
export { cx };
