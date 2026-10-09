/* pages/settings/SxSearch.tsx — v3 Sozlamalar qidiruv maydoni (.search.sx-search): "/" yorlig'isiz,
   × tozalash, .is-filled. Qiymatni chaqiruvchi 300 ms kechiktirib ishlatadi (useDebounced). */
import { useRef } from "react";
import { useT } from "@/i18n/I18nProvider";
import { Icon } from "@/components/Icon";
import { cx } from "@/components/ui";

export function SxSearch({ value, onChange, placeholder, label, small }: {
  value: string; onChange: (v: string) => void; placeholder: string; label: string; small?: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <label className={cx("search sx-search", small && "sx-search--sm", value && "is-filled")}>
      <Icon name="search" size={small ? "sm" : "md"} />
      <input ref={ref} type="search" placeholder={t(placeholder)} autoComplete="off" aria-label={t(label)}
        value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="search__clear" aria-label={t("Tozalash")}
        onClick={() => { onChange(""); ref.current?.focus(); }}>
        <Icon name="xmark" size="sm" />
      </button>
    </label>
  );
}
