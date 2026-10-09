/* pages/dash/common.tsx — dashboard umumiy yordamchilari (v3 dashboard/common.js dan).
   Formatlash (foiz, son, davomiylik, kun yorlig'i), holat modeli (backend state → UI status/yorliq),
   karta ichidagi holatlar (skeleton 300 ms dan keyin / Alert + "Qayta urinish" / bo'sh), kartaning
   "Qayta urinish" (barcha statistika so'rovlari qayta yuklanadi) va kamera / hudud / admin o'tishlari.
   Raqam formatlari v3 bilan aynan bir xil (lib/format dagisi bilan aralashtirmang — davomiylik boshqacha). */
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useT } from "@/i18n/I18nProvider";
import { Icon } from "@/components/Icon";
import { EmptyState, InfoTip } from "@/components/ui";
import { useDelayed } from "@/components/overlays";
import { ApiError } from "@/lib/api";
import type { ApiState, Camera, UiStatus } from "@/lib/types";

/* ---------- Formatlash ---------- */
export const p2 = (n: number) => String(n).padStart(2, "0");
/** Date.getDay() tartibida (0 = yakshanba) */
export const WD = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toFixed(digits).replace(".", ",") + "%";
}
export function fmtInt(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
/** Soniya → "45 s", "7 daq", "3,9 soat", "28 kun" */
export function fmtDur(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec)) return "—";
  if (sec < 60) return Math.round(sec) + " s";
  if (sec < 3600) return Math.round(sec / 60) + " daq";
  if (sec < 86400) {
    const h = sec / 3600;
    return (h < 10 ? h.toFixed(1).replace(".", ",").replace(",0", "") : Math.round(h)) + " soat";
  }
  return Math.round(sec / 86400) + " kun";
}
/** ISO vaqtdan hozirgacha: "10 daq", "11 soat", "28 kun" */
export function fmtSince(iso: string | null | undefined): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (!t) return null;
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 60) return min + " daq";
  if (min < 1440) return Math.round(min / 60) + " soat";
  return Math.round(min / 1440) + " kun";
}
export function hhmm(ts: string | number | Date): string {
  const d = new Date(ts);
  return p2(d.getHours()) + ":" + p2(d.getMinutes());
}
/** "Ju 2" — kun yorlig'i; bugun bo'lsa "Bugun" */
export function dayLabel(date: string | number | Date, isToday?: boolean): string {
  if (isToday) return "Bugun";
  const d = typeof date === "string" ? new Date(date + "T12:00:00") : new Date(date);
  return WD[d.getDay()] + " " + d.getDate();
}

/* ---------- Holat modeli ---------- */
export function camState(c: Pick<Camera, "state" | "online">): ApiState {
  if (c.state) return c.state;
  return c.online === true ? "online" : c.online === false ? "offline" : "unknown";
}
export const STATUS: Record<ApiState, UiStatus> = { online: "online", stalled: "no-video", offline: "offline", disabled: "disabled", unknown: "unknown" };
export const LABEL: Record<ApiState, string> = { online: "Onlayn", stalled: "Tasvirsiz", offline: "Uzilgan", disabled: "Oʻchirilgan", unknown: "Nomaʼlum" };

/* ---------- Navigatsiya ---------- */
/** Admin sahifasiga filtr ishorasi (README.md: "Boshqaruv filtri"). */
export interface AdminFilterHint {
  /** "offline" — Diqqat talab qiladi → Barchasi */
  status?: "offline";
  /** Maʼlumot sifati tekshiruvi kaliti (no_location, probe_failed, …) */
  quality?: string;
  /** Aniq kameralar (id) — sifat tekshiruvi ro'yxati (ko'pi bilan 50 ta, server shuncha beradi) */
  ids?: number[];
  /** Filtr yorlig'i (o'zbekcha, t() bilan tarjima qilinadi) */
  label?: string;
  /** Tekshiruvdagi jami kamchiliklar soni (ids dan ko'p bo'lishi mumkin) */
  count?: number;
}
export type AdminAction = "new-camera" | "sync";

export function useDashNav() {
  const nav = useNavigate();
  return {
    camera: (id: number) => nav("/?camera=" + id),
    /** Hudud xaritada: kameralar ro'yxati shu hudud nomi bilan filtrlanadi (v2/v3 xatti-harakati). */
    region: (region: string) => nav("/?q=" + encodeURIComponent(region)),
    map: () => nav("/"),
    wall: () => nav("/wall"),
    settings: (sub: string) => nav("/settings/" + sub),
    admin: (adminFilter?: AdminFilterHint, adminAction?: AdminAction) =>
      nav("/admin", { state: { adminFilter, adminAction } }),
  };
}

/* ---------- Karta holatlari ---------- */
/** "Qayta urinish" — barcha statistika so'rovlari keshdan o'chirilib qayta so'raladi (v3 invalidate()). */
export function useRetry() {
  const qc = useQueryClient();
  return () => { qc.invalidateQueries({ queryKey: ["stats"] }); };
}

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
export const is404 = (e: unknown) => e instanceof ApiError && e.status === 404;

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
