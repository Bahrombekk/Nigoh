/* pages/dash/TrendTab.tsx — Statistika / Dinamika (Figma 03.02 + v2 vidjetlari; v3 dashboard/trend.js).
     * Onlaynlik darajasi — HOZIR / OʻRTACHA / ENG PAST / MAQSAD va SLA (maqsadda, maqsaddan past,
       yetishmagan kamera-soat, o'lchovlar); maydonli chiziq, maqsad 95% punktiri, eng past nuqta;
     * Kunlik onlaynlik va Kunlik uzilishlar — ustunlar, bugungi to'q rangda;
     * Uzilishlar xaritasi — hafta kuni × soat, cho'qqi soati sarlavhada;
     * Sutka soatlari — uzilish + qisqa uzilish, cho'qqi oynasi;
     * Oldingi davr bilan — joriy / oldingi / o'zgarish. Oldingi davrda o'lchov bo'lmasa (null,
       0 kamera-soat yoki 0% qamrov) — "—" va o'zgarish belgisi yo'q.
   SLA yoki compare bo'lmasa (eski server) — tegishli qism yashiriladi. */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useT } from "@/i18n/I18nProvider";
import { cssVar } from "@/lib/theme";
import { Columns, HEAT_ALPHA, Heatmap, HourBars, LineChart, type ColItem, type HeatRow } from "./charts";
import {
  CardHead, Empty, ErrBox, Loading, Section, SkelBars, SkelBlock, dayLabel, fmtDur, fmtInt, fmtPct, hhmm, p2,
} from "./common";
import {
  useAvailability, useDaily, useHeatmap, useHourly, useHourlyDay, useSeries, useSla, useSummary, view, type Days,
} from "./queries";

const WEEK = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];
const GOAL = 95;

export function TrendTab({ days }: { days: Days }) {
  return (
    <div className="db-panel" id="db-trend" role="tabpanel" aria-label="Dinamika">
      <Section>Onlaynlik</Section>
      <OnlineCard days={days} />
      <Section>Kunlar kesimida</Section>
      <div className="db-grid3 db-grid3--trend">
        <DailyCards days={days} />
        <HeatCard days={days} />
      </div>
      <Section>Soatlar va taqqoslash</Section>
      <div className="db-g21 db-g21--trend">
        <HourlyCard days={days} />
        <CompareCard days={days} />
      </div>
    </div>
  );
}

/* ====================== Onlaynlik darajasi ====================== */
function Stat({ label, tip, children, cls }: { label: string; tip?: string; children: ReactNode; cls?: string }) {
  const t = useT();
  return <div data-tip={tip}><span className="overline">{t(label)}</span><b className={cls || undefined}>{children}</b></div>;
}

function OnlineCard({ days }: { days: Days }) {
  const t = useT();
  const sQ = view(useSeries(days));
  const slaQ = view(useSla(days, days === 1 ? "5m" : "hour"));
  const s = sQ.d;
  const span = days === 1 ? "day" : days === 7 ? "week" : "month";
  // Grafik oralig'i — ma'lumot kelgan paytdagi "hozir" (har chizishda siljimaydi).
  const range = useMemo(() => ({ from: Date.now() - days * 86400e3, to: Date.now() }), [s, days]); // eslint-disable-line react-hooks/exhaustive-deps

  let now = "—", avg = "—", min = "—", nowCls = "";
  let body: ReactNode;
  if (sQ.err) body = <ErrBox err={sQ.err} />;
  else if (!s) body = <Loading pending={sQ.pending}><SkelBlock h={160} /></Loading>;
  else if (s.length < 2) body = <Empty title="Tarix yigʻilmoqda" text="Grafik dastlabki oʻlchovlar toʻplangach chiziladi." />;
  else {
    const cur = s[s.length - 1].pct;
    const a = s.reduce((acc, p) => acc + p.pct, 0) / s.length;
    let low = s[0];
    s.forEach((p) => { if (p.pct < low.pct) low = p; });
    now = fmtPct(cur, 0); nowCls = cur >= GOAL ? "t-success" : cur < 80 ? "t-error" : "t-warning";
    avg = fmtPct(a, 0);
    min = fmtPct(low.pct, 0) + " · " + (days === 1 ? hhmm(low.t) : t(dayLabel(new Date(low.t))));
    body = <LineChart points={s} label="Onlaynlik darajasi grafigi" opts={{ goal: GOAL, span, from: range.from, to: range.to }} />;
  }
  const sla = slaQ.d;
  const slaHide = !sla;          // yo'q yoki xato — ajratgich yashirin
  const slaErr = !!slaQ.err;     // xato — to'rtlik ham yashirin
  const inPct = sla?.in_goal_pct;
  return (
    <article className="card db-card db-online" id="db-tl-card">
      <CardHead title="Onlaynlik darajasi"
        tip="Onlayn kameralar ulushi vaqt boʻyicha. Qizil nuqta — eng past qiymat, punktir — maqsad 95%."
        sub={t(days === 1 ? "soʻnggi 24 soat · 5 daqiqalik oʻlchov" : "soʻnggi " + days + " kun · " + (days === 7 ? "1 soatlik" : "6 soatlik") + " oʻlchov")} />
      <div className="db-tl-stats" id="db-tl-stats">
        <Stat label="Hozir" cls={nowCls}>{now}</Stat>
        <Stat label="Oʻrtacha">{avg}</Stat>
        <Stat label="Eng past" cls="t-error">{min}</Stat>
        <Stat label="Maqsad" cls="t-tertiary">95%</Stat>
        {!slaHide && <span className="db-tl-div" aria-hidden="true" />}
        {!slaErr && <>
          <Stat label="Maqsadda" tip="Oʻlchovlarning necha foizida onlaynlik maqsaddan (95%) past boʻlmagan."
            cls={inPct == null ? "" : inPct >= 90 ? "t-success" : inPct < 50 ? "t-error" : "t-warning"}>{sla ? fmtPct(inPct, 0) : "—"}</Stat>
          <Stat label="Maqsaddan past" tip="Onlaynlik maqsaddan past boʻlgan umumiy vaqt.">
            {sla ? (sla.below_goal_seconds ? t(fmtDur(sla.below_goal_seconds)) : "0") : "—"}</Stat>
          <Stat label="Yetishmagan" tip="Maqsadga yetishmagan kamera-soatlar: har oʻlchovda 95% × jami − onlayn.">
            {sla ? <>{fmtInt(sla.deficit_camera_hours)} <small>{t("kamera-soat")}</small></> : "—"}</Stat>
          <Stat label="Oʻlchovlar" tip="Davrda server yozgan oʻlchovlar soni.">{sla ? fmtInt(sla.observed_slots) : "—"}</Stat>
        </>}
      </div>
      <div className="db-body db-tl" id="db-tl">{body}</div>
    </article>
  );
}

/* ====================== Kunlik ustunlar ====================== */
function DailyCards({ days }: { days: Days }) {
  const t = useT();
  const n = Math.max(7, days);
  const q = view(useDaily(n));
  const dateTitle = (s: string) => { const d = new Date(s + "T12:00:00"); return d.getDate() + "." + p2(d.getMonth() + 1); };
  const ds = useMemo(() => (q.d?.days || []).slice(-n), [q.d, n]);
  const last = ds.length - 1;
  const up: ColItem[] = useMemo(() => ds.map((x, i) => ({
    label: dayLabel(x.date, i === last), value: x.uptime_pct,
    cap: x.uptime_pct == null ? null : Math.round(x.uptime_pct) + "%",
    tipTitle: x.uptime_pct == null ? "Kuzatuv yoʻq" : fmtPct(x.uptime_pct) + " onlayn",
    tipText: dateTitle(x.date) + (x.coverage_pct != null && x.coverage_pct < 100 ? " · kuzatuv qamrovi " + fmtPct(x.coverage_pct, 0) : "") +
      (x.offline_camera_hours != null ? " · ishlamagan vaqt " + fmtInt(x.offline_camera_hours) + " kamera-soat" : ""),
    hi: i === last,
  })), [ds, last]);
  const ev: ColItem[] = useMemo(() => ds.map((x, i) => {
    const none = !x.coverage_pct && !x.outages;
    return {
      label: dayLabel(x.date, i === last), value: none ? null : x.outages || 0,
      cap: none ? null : fmtInt(x.outages || 0),
      tipTitle: none ? "Kuzatuv yoʻq" : fmtInt(x.outages || 0) + " ta uzilish",
      tipText: dateTitle(x.date) + (x.blips ? " · " + fmtInt(x.blips) + " ta qisqa uzilish" : ""),
      hi: i === last,
    };
  }), [ds, last]);

  const body = (chart: ReactNode) => q.err ? <ErrBox err={q.err} />
    : !q.d ? <Loading pending={q.pending}><SkelBlock h={190} /></Loading>
      : !ds.length ? <Empty title="Kunlik tarix yoʻq" text="Server ishlagan sari toʻlib boradi." /> : chart;
  return (
    <>
      <article className="card db-card">
        <CardHead title="Kunlik onlaynlik" sub={t(n + " kun · oʻrtacha")}
          tip="Har kungi oʻrtacha ishlash ulushi. Punktirli ustun — oʻsha kuni kuzatuv boʻlmagan." />
        <div className="db-body db-cols" id="db-du">{body(<Columns items={up} max={100} color="--color-icon-brand" label="Kunlik onlaynlik" />)}</div>
      </article>
      <article className="card db-card">
        <CardHead title="Kunlik uzilishlar" sub={t(n + " kun · hodisalar")}
          tip="Har kuni boshlangan uzilishlar soni (2 daqiqadan uzun). Qisqa uzilishlar soni — ustun izohida." />
        <div className="db-body db-cols" id="db-de">{body(<Columns items={ev} color="--color-icon-error" label="Kunlik uzilishlar" />)}</div>
      </article>
    </>
  );
}

/* ====================== Uzilishlar xaritasi ====================== */
function HeatCard({ days }: { days: Days }) {
  const t = useT();
  const q = view(useHeatmap(Math.max(7, days)));
  const [, setTheme] = useState(0);
  const { rows, peak, sums } = useMemo(() => {
    const byKey = new Map((q.d?.rows || []).map((r) => [r.key, r]));
    const rows: HeatRow[] = WEEK.map((w, i) => {
      const r = byKey.get(i + 1);
      const has = !!(r && (r.days || 0) > 0 && r.hours);
      return { label: w, hours: has ? r!.hours : null, tip: w + (has ? " · " + r!.days + " kunlik oʻrtacha" : "") };
    });
    const sums = new Array(24).fill(0) as number[];
    rows.forEach((r) => (r.hours || []).forEach((v, i) => { sums[i] += v || 0; }));
    return { rows, sums, peak: sums.indexOf(Math.max(...sums)) };
  }, [q.d]);
  // Legenda rangi tokendan — mavzu almashsa qayta o'qiladi.
  useThemeTick(setTheme);
  const red = cssVar("--color-icon-error");
  return (
    <article className="card db-card">
      <CardHead title="Uzilishlar xaritasi" sub={t("hafta × soat" + (q.d && sums[peak] > 0 ? " · choʻqqi " + p2(peak) + ":00" : ""))}
        tip="Hafta kuni × soat boʻyicha uzilishlar (kunlik oʻrtacha). Toʻqroq — koʻproq uzilish." />
      <div className="db-body db-hm" id="db-hm">
        {q.err ? <ErrBox err={q.err} /> : !q.d ? <Loading pending={q.pending}><SkelBlock h={120} /></Loading> : <Heatmap rows={rows} />}
      </div>
      <div className="db-hm-legend" id="db-hm-legend">
        {q.d && !q.err && <>
          <span>{t("kam")}</span>
          {HEAT_ALPHA.slice(1).map((a) => <i key={a} style={{ background: red, opacity: a }} />)}
          <span>{t("koʻp")}</span><i className="db-hm-none" /><span>{t("kuzatuv yoʻq")}</span>
        </>}
      </div>
    </article>
  );
}
function useThemeTick(set: (f: (x: number) => number) => void) {
  useEffect(() => {
    const h = () => set((x) => x + 1);
    window.addEventListener("nigoh:theme", h);
    return () => window.removeEventListener("nigoh:theme", h);
  }, [set]);
}

/* ====================== Sutka soatlari ====================== */
function HourlyCard({ days }: { days: Days }) {
  const t = useT();
  const q = view(useHourly(days));
  const h = q.d;
  const sum = (a?: number[]) => (a || []).reduce((s, v) => s + (v || 0), 0);
  const pk = h?.peak;
  const sub = h ? (days === 1 ? "soʻnggi 24 soat" : days + " kun yigʻindisi") +
    (pk && pk.outages ? " · choʻqqi " + p2(pk.from_hour) + ":00–" + p2(pk.to_hour) + ":00" : "") : "";
  return (
    <article className="card db-card" id="db-hr-card">
      <CardHead title="Sutka soatlari" sub={t(sub)}
        tip="Har soatda boshlangan uzilishlar va qisqa uzilishlar. Ajratilgan oraliq — eng zich 3 soat.">
        <span className="spacer" />
        <span className="db-legend"><span><i className="db-k-err" />{t("Uzilish")}</span><span><i className="db-k-warn" />{t("Qisqa uzilish")}</span></span>
      </CardHead>
      <div className="db-body db-hr" id="db-hr">
        {q.err ? <ErrBox err={q.err} />
          : !h ? <Loading pending={q.pending}><SkelBlock h={180} /></Loading>
            : !sum(h.outages) && !sum(h.blips) ? <Empty title="Uzilish qayd etilmagan" text="Bu davrda uzilish ham, qisqa uzilish ham boʻlmagan." />
              : <HourBars data={h} />}
      </div>
    </article>
  );
}

/* ====================== Oldingi davr bilan ====================== */
type Row = [string, string, number | null, number | null, "pp" | "n" | "h", boolean];

function CompareCard({ days }: { days: Days }) {
  const t = useT();
  const aQ = view(useAvailability(days));
  const smQ = view(useSummary(days));
  const today = useMemo(() => (days === 1 ? new Date() : null), [days]);
  const yest = useMemo(() => (today ? new Date(today.getTime() - 86400e3) : null), [today]);
  const hToday = view(useHourlyDay(today));
  const hYest = view(useHourlyDay(yest));
  const d14 = view(useDaily(14, days === 7));
  const a = aQ.d, sm = smQ.d;

  let body: ReactNode;
  if (aQ.pending && !a) body = <Loading pending><SkelBars n={6} h={16} /></Loading>;
  else if (aQ.err && !sm) body = <ErrBox err={aQ.err} />;
  else {
    const pa = a && a.previous && (a.previous.coverage_pct || 0) > 0 && a.previous.camera_hours_observed > 0 ? a.previous : null;
    const smPrev = sm && sm.previous && sm.previous.measured > 0 ? sm.previous : null;
    const rows: Row[] = [];
    if (a) {
      rows.push(["Ishlash ulushi", "Uptime — kuzatilgan vaqtda onlayn boʻlgan ulush.", a.uptime_pct, pa ? pa.uptime_pct : null, "pp", true]);
      rows.push(["Kuzatuv qamrovi", "Davrning qancha qismida server oʻlchov yozgan.", a.coverage_pct, pa ? pa.coverage_pct : null, "pp", true]);
      rows.push(["Ishlamagan vaqt", "Kameralarning ishlamagan vaqti, kamera-soatda.", a.camera_hours_offline, pa ? pa.camera_hours_offline : null, "h", false]);
      rows.push(["Uzilmagan kameralar", "Davrda bir marta ham uzilmagan kameralar.", a.never_down, pa ? pa.never_down : null, "n", true]);
    }
    if (sm && sm.online_pct != null) {
      rows.push(["Hozir onlayn",
        "Hozirgi onlaynlik va " + (days === 1 ? "kechagi" : days + " kun oldingi") + " shu paytdagi oʻlchov.",
        sm.online_pct, smPrev ? smPrev.online_pct : null, "pp", true]);
    }
    // Uzilishlar: Bugun — bugun shu soatgacha vs kecha shu soatgacha; 7 kun — kalendar kunlar.
    const sumTo = (arr: number[] | undefined, h: number) => (arr || []).slice(0, h + 1).reduce((s, v) => s + (v || 0), 0);
    if (days === 1 && hToday.d && hYest.d) {
      const hNow = new Date().getHours();
      rows.push(["Uzilishlar", "Bugun soat " + p2(hNow) + ":59 gacha va kecha shu vaqtgacha.",
        sumTo(hToday.d.outages, hNow), sumTo(hYest.d.outages, hNow), "n", false]);
      rows.push(["Qisqa uzilishlar", "Bugun va kecha shu vaqtgacha boʻlgan 2 daqiqadan qisqa uzilishlar.",
        sumTo(hToday.d.blips, hNow), sumTo(hYest.d.blips, hNow), "n", false]);
    } else if (days === 7 && d14.d) {
      const ds = d14.d.days || [];
      const cur = ds.slice(-7), prev = ds.slice(-14, -7);
      const s = (xs: typeof ds, k: "outages" | "blips") => xs.reduce((tt, x) => tt + (x[k] || 0), 0);
      const prevSeen = prev.some((x) => (x.coverage_pct || 0) > 0);
      if (prev.length) {
        rows.push(["Uzilishlar", "Oxirgi 7 kalendar kun va undan oldingi 7 kun.", s(cur, "outages"), prevSeen ? s(prev, "outages") : null, "n", false]);
        rows.push(["Qisqa uzilishlar", "Oxirgi 7 kalendar kun va undan oldingi 7 kun.", s(cur, "blips"), prevSeen ? s(prev, "blips") : null, "n", false]);
      }
    }
    if (!rows.length) body = <Empty title="Taqqoslash yoʻq" text="Server oldingi davr maʼlumotini bermadi." />;
    else {
      const fmtV = (v: number | null, kind: string) => (v == null ? "—" : kind === "pp" ? fmtPct(v, 1) : kind === "h" ? t(fmtInt(v) + " soat") : fmtInt(v));
      const prevNote = days === 30 ? "30 kundan eski tarix saqlanmaydi — oldingi davr toʻliq emas." : "";
      body = (
        <>
          <div className="db-cmp-row db-cmp-head"><span>{t("Koʻrsatkich")}</span><span>{t("Joriy")}</span><span>{t("Oldingi")}</span><span /></div>
          {rows.map(([label, tip, cur, prev, kind, up]) => {
            let chip: ReactNode = <span />;          // oldingi yo'q — belgi ham yo'q
            if (cur != null && prev != null) {
              const diff = cur - prev;
              const rel = kind === "pp" ? diff : prev ? (diff / prev) * 100 : null;
              const good = diff === 0 ? null : (diff > 0) === up;
              const txt = kind === "pp" ? Math.abs(diff).toFixed(1).replace(".", ",") + " punkt"
                : rel == null ? fmtInt(Math.abs(diff)) : Math.round(Math.abs(rel)) + "%";
              chip = <span className="db-chg" data-good={good == null ? "" : String(good)}>{(diff > 0 ? "▲ " : diff < 0 ? "▼ " : "") + t(txt)}</span>;
            }
            return (
              <div key={label} className="db-cmp-row" data-tip={tip + (prevNote ? " " + prevNote : "")}>
                <span className="ellipsis">{t(label)}</span>
                <span className="db-num">{fmtV(cur, kind)}</span><span className="db-num t-tertiary">{fmtV(prev, kind)}</span>{chip}
              </div>
            );
          })}
        </>
      );
    }
  }
  return (
    <article className="card db-card" id="db-cmp-card">
      <CardHead title="Oldingi davr bilan" sub={t(days === 1 ? "soʻnggi 24 soat · undan oldingi 24 soat" : days + " kun · oldingi " + days + " kun")}
        tip="Tanlangan davr va undan oldingi teng davr. Yashil — yaxshilangan, qizil — yomonlashgan." />
      <div className="db-body" id="db-cmp">{body}</div>
    </article>
  );
}
