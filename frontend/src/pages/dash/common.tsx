/* pages/dash/common.tsx — dashboard umumiy komponentlari (v3 dashboard/common.js dan).
   Karta ichidagi holatlar (skeleton 300 ms dan keyin / Alert + "Qayta urinish" / bo'sh) va karta sarlavhasi.
   Formatlash va holat modeli — format.ts; useDashNav, useRetry, is404 — hooks.ts. */
import type { ReactNode } from "react";
import { useT } from "@/i18n/i18nContext";
import { Icon } from "@/components/Icon";
import { EmptyState, InfoTip } from "@/components/ui";
import { useDelayed } from "@/components/overlayHooks";
import { ApiError } from "@/lib/api";
import { useRetry } from "./hooks";

export function SkelBars({ n = 4, h = 16 }: { n?: number; h?: number }) {
  return (
    <div className="db-skel">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="skeleton" style={{ height: h, width: 55 + ((i * 23) % 40) + "%" }} />
      ))}
    </div>
  );
}
export function SkelBlock({ h = 120 }: { h?: number }) {
  return <div className="db-skel"><span className="skeleton db-skel__block" style={{ height: h }} /></div>;
}

export function AlertBox({ title = "Maʼlumot yuklanmadi", text = "Server javob bermadi." }: { title?: string; text?: string }) {
  const t = useT();
  const retry = useRetry();
  return (
    <div className="alert alert--error db-alert" role="alert">
      <Icon name="triangle-exclamation" size="sm" />
      <div className="alert__body"><div className="alert__title">{t(title)}</div><div className="alert__text">{t(text)}</div></div>
      <button type="button" className="btn btn--tertiary btn--sm" onClick={retry}>{t("Qayta urinish")}</button>
    </div>
  );
}
export function Empty({ title, text }: { title: string; text?: string }) {
  return <EmptyState type="nodata" title={title} text={text} />;
}
/** Eski (v2) serverda endpoint bo'lmasa — xato emas, "hali yo'q" holati. */
export function ErrBox({ err }: { err: unknown }) {
  if (err instanceof ApiError && err.status === 404) {
    return <Empty title="Server bu hisobotni bermaydi" text="Server yangilangach shu yerda koʻrinadi." />;
  }
  return <AlertBox />;
}

/** Yuklanayotganda: 300 ms gacha hech narsa, keyin skeleton. */
export function Loading({ pending, children }: { pending: boolean; children: ReactNode }) {
  const show = useDelayed(pending);
  return show ? <>{children}</> : null;
}

/* ---------- Karta sarlavhasi ---------- */
export function CardHead({ title, tip, sub, children, titleId }: {
  title: string; tip: string; sub?: ReactNode; children?: ReactNode; titleId?: string;
}) {
  const t = useT();
  return (
    <div className="db-card__head">
      <h3 className="card__title" id={titleId}>{t(title)}</h3><InfoTip text={tip} />
      {sub != null && <span className="db-card__sub">{sub}</span>}
      {children}
    </div>
  );
}

/** KpiTile (Bugungi tahlil, Ishonchlilik) */
export function Tile({ label, tip, value, meta, cls = "", clamp }: {
  label: string; tip: string; value: string; meta: string; cls?: string; clamp?: boolean;
}) {
  const t = useT();
  return (
    <div className="kpi-tile db-tile">
      <div className="db-tile__head">
        <span className={clamp ? "db-tile__label" : undefined}>{t(label)}</span><span className="spacer" />
        <InfoTip text={tip} />
      </div>
      <div className="db-tile__val">
        <span className={"kpi-tile__value " + (clamp ? "" : "ellipsis ") + cls}>{t(value)}</span>
        <span className={"kpi-tile__meta " + (clamp ? "db-tile__meta" : "ellipsis")}>{t(meta)}</span>
      </div>
    </div>
  );
}

export function Section({ children }: { children: ReactNode }) {
  const t = useT();
  return <h2 className="overline db-sec">{t(children as string)}</h2>;
}
