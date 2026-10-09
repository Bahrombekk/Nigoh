/* pages/dash/DashPage.tsx — Statistika sahifasi (Figma 03; v3 dashboard/dashboard.js).
   Sarlavha (3 tabda bir xil): tablar Hozir / Dinamika / Tahlil (marshrut #/dash/hozir|trend|tahlil,
   prefs dashTab; ← / → bilan almashadi), davr Bugun / 7 kun / 30 kun (prefs dashPeriod, barcha
   kartalarga), Toolbar / Tizim (<Sysbar flat/>). Faqat faol tab chiziladi (so'rovlari ham faqat o'shaniki).
   Kartalar: HozirTab.tsx, TrendTab.tsx, TahlilTab.tsx; grafiklar — charts.tsx; so'rovlar — queries.ts. */
import "@/styles/dash.css";
import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router";
import { useT } from "@/i18n/I18nProvider";
import { usePref } from "@/lib/prefs";
import { PageSheet } from "@/layout/AppShell";
import { Sysbar } from "@/layout/Sysbar";
import { chTipHide } from "./charts";
import { HozirTab } from "./HozirTab";
import { TrendTab } from "./TrendTab";
import { TahlilTab } from "./TahlilTab";
import type { Days } from "./queries";

const SUBS = ["hozir", "trend", "tahlil"] as const;
type Sub = (typeof SUBS)[number];
const SUB_LABEL: Record<Sub, string> = { hozir: "Hozir", trend: "Dinamika", tahlil: "Tahlil" };
const PERIODS: { p: Days; label: string }[] = [{ p: 1, label: "Bugun" }, { p: 7, label: "7 kun" }, { p: 30, label: "30 kun" }];

const isSub = (s: unknown): s is Sub => SUBS.includes(s as Sub);

export default function DashPage() {
  const t = useT();
  const nav = useNavigate();
  const { sub: param } = useParams();
  const [savedTab, setSavedTab] = usePref<string>("dashTab", "hozir");
  const [rawPeriod, setPeriod] = usePref<number>("dashPeriod", 1);
  const days: Days = ([1, 7, 30] as number[]).includes(Number(rawPeriod)) ? (Number(rawPeriod) as Days) : 1;
  const sub: Sub = isSub(param) ? param : isSub(savedTab) ? savedTab : "hozir";
  const tabsRef = useRef<HTMLDivElement>(null);

  // Marshrutda tab yo'q (#/dash) yoki noto'g'ri — saqlangan tabga; ochilgan tab eslab qolinadi.
  useEffect(() => {
    if (param !== sub) nav("/dash/" + sub, { replace: true });
    else if (savedTab !== sub) setSavedTab(sub);
    chTipHide();
  }, [param, sub]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (s: Sub) => { setSavedTab(s); nav("/dash/" + s); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const i = SUBS.indexOf(sub) + (e.key === "ArrowRight" ? 1 : -1);
    const next = SUBS[(i + SUBS.length) % SUBS.length];
    open(next);
    requestAnimationFrame(() => tabsRef.current?.querySelector<HTMLButtonElement>('[data-sub="' + next + '"]')?.focus());
    e.preventDefault();
  };

  return (
    <PageSheet id="dash-view" className="db">
      <header className="page-head db-head">
        <h1 className="page-head__title">{t("Statistika")}</h1>
        <div className="seg db-tabs" id="db-tabs" role="tablist" aria-label={t("Statistika boʻlimlari")} ref={tabsRef} onKeyDown={onKey}>
          {SUBS.map((s) => (
            <button key={s} type="button" role="tab" data-sub={s} aria-controls={"db-" + s} aria-selected={s === sub}
              tabIndex={s === sub ? 0 : -1} className={s === sub ? "is-on" : ""} onClick={() => open(s)}>{t(SUB_LABEL[s])}</button>
          ))}
        </div>
        <span className="spacer" />
        <div className="seg db-period" id="db-period" role="group" aria-label={t("Davr")}>
          {PERIODS.map(({ p, label }) => (
            <button key={p} type="button" aria-pressed={p === days} className={p === days ? "is-on" : ""} onClick={() => setPeriod(p)}>{t(label)}</button>
          ))}
        </div>
        <div className="db-sysbar" id="db-sysbar"><Sysbar flat /></div>
      </header>
      {sub === "hozir" && <HozirTab days={days} />}
      {sub === "trend" && <TrendTab days={days} />}
      {sub === "tahlil" && <TahlilTab days={days} />}
    </PageSheet>
  );
}
