/* pages/dash/HozirTab.tsx — Statistika / Hozir (Figma 03.01, 03.04, 03.05; v3 dashboard/hozir.js).
   Operativ holat bir qarashda:
     * 4 StatCard — Onlayn kameralar · Uzilgan · Ishlash ulushi · Uzilishlar (davr): sparkline,
       delta (oldingi teng davrga nisbatan, ?compare=1 — bo'lmasa yashirin), InfoTip;
     * Liniya holati — har kamera bitta kvadrat, km tartibida, hududlar bo'yicha;
     * Diqqat talab qiladi — Uzilgan (eng uzog'i birinchi) / Beqaror (ranking?by=flapping);
     * Hududlar holati (bosilsa hudud xaritada), Soʻnggi hodisalar (uzildi / qayta ulandi /
       oqim ochildi; eng so'nggilarida kameraning oxirgi surati);
     * Bugungi tahlil (6 xulosa), Tezkor amallar (faqat admin), Tizim holati (xizmatlar + yuklama).
   Qoida: har raqam shu tabda BIR marta. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/i18n/I18nProvider";
import { useAuth } from "@/auth/AuthProvider";
import { useCameras } from "@/data/queries";
import { apiOk } from "@/lib/api";
import { Icon } from "@/components/Icon";
import { InfoTip } from "@/components/ui";
import type { ApiState, Camera } from "@/lib/types";
import { Sparkline } from "./charts";
import {
  AlertBox, CardHead, Empty, ErrBox, Loading, Section, SkelBars, Tile, camState, dayLabel, fmtDur, fmtInt, fmtPct,
  fmtSince, hhmm, p2, STATUS, LABEL, WD, useDashNav,
} from "./common";
import {
  useAvailability, useDaily, useFeed, useHourly, useOpenOutages, useOutageSummary, useRanking, useRegions, useSeries,
  useSla, useSummary, useSystemInfo, view, type Days, type FeedItem,
} from "./queries";

export function HozirTab({ days }: { days: Days }) {
  return (
    <div className="db-panel" id="db-hozir" role="tabpanel" aria-label="Hozir">
      <Section>Joriy holat</Section>
      <StatCards days={days} />
      <LineCard />
      <Section>Diqqat va hodisalar</Section>
      <div className="db-grid3 db-grid3--hozir">
        <AttentionCard days={days} />
        <RegionsCard />
        <EventsCard />
      </div>
      <Section>Davr xulosasi va tizim</Section>
      <div className="db-g21">
        <div className="db-col db-col--left">
          <TodayCard days={days} />
          <ActionsCard />
        </div>
        <SystemCard />
      </div>
    </div>
  );
}

/* ====================== StatCard ====================== */
interface Delta { text: string }
function pctDelta(v: number | null | undefined): Delta | null {
  if (v == null || !isFinite(v)) return null;
  const a = Math.abs(v);
  const s = a < 1 && a > 0 ? a.toFixed(1).replace(".", ",") : String(Math.round(a));
  return { text: (v > 0 ? "▲ " : v < 0 ? "▼ " : "") + s + "%" };
}
function numDelta(v: number | null | undefined): Delta | null {
  if (v == null || !isFinite(v)) return null;
  return { text: (v > 0 ? "▲ " : v < 0 ? "▼ " : "") + fmtInt(Math.abs(v)) };
}
/** Sparkline uchun ~48 nuqta: 5 daqiqalik shovqin o'rtacha bilan tekislanadi. */
function thin(values: number[], n = 48): number[] {
  if (values.length <= n) return values;
  const out: number[] = [], k = values.length / n;
  for (let i = 0; i < n; i++) {
    const part = values.slice(Math.floor(i * k), Math.floor((i + 1) * k));
    out.push(part.reduce((a, b) => a + b, 0) / part.length);
  }
  return out;
}

function StatCard({ tone, label, tip, num, unit, meta, delta, error, spark, color }: {
  tone: string; label: string; tip: string; num: string; unit?: string; meta?: string;
  delta?: Delta | null; error?: boolean; spark: number[]; color: string;
}) {
  const t = useT();
  return (
    <article className="card db-stat" data-tone={tone}>
      <div className="db-stat__head">
        <span className="db-stat__label">{t(label)}</span><InfoTip text={tip} /><span className="spacer" />
        {delta && <span className="db-delta" data-tip="Oldingi teng davrga nisbatan">{delta.text}</span>}
      </div>
      <div className="db-stat__value">
        <span className="db-stat__num">{num}</span>
        {unit && <span className="db-stat__unit">{unit}</span>}
      </div>
      <Sparkline values={spark} color={color} />
      <div className={"db-stat__meta ellipsis" + (error ? " t-error" : "")}>{t(error ? "Maʼlumot yuklanmadi" : meta || "")}</div>
    </article>
  );
}

function counts(cams: Camera[]) {
  const n = { online: 0, stalled: 0, offline: 0, disabled: 0, unknown: 0 } as Record<ApiState, number>;
  cams.forEach((c) => { const s = camState(c); n[s in n ? s : "unknown"]++; });
  return { ...n, total: cams.length, measured: n.online + n.stalled + n.offline };
}

function StatCards({ days }: { days: Days }) {
  const { cameras } = useCameras();
  const summary = view(useSummary());
  const avail = view(useAvailability(days));
  const out = view(useOutageSummary(days));
  const hourly = view(useHourly(1, days === 1));
  const daily = view(useDaily(days, days !== 1));
  const seriesQ = view(useSeries(days));
  const series = seriesQ.d || [];
  const n = counts(cameras);

  // 1. Onlayn kameralar
  const meta1 = days === 1 ? (n.stalled ? n.stalled + " tasi tasvirsiz" : "Tasvirsiz kamera yoʻq")
    : series.length ? days + " kunda oʻrtacha " + fmtInt(series.reduce((s, p) => s + p.online, 0) / series.length) : "";
  const prevS = summary.d?.previous;
  const d1 = prevS && summary.d!.online_pct != null && prevS.online_pct != null ? pctDelta(summary.d!.online_pct - prevS.online_pct) : null;

  // 2. Uzilgan
  let meta2 = "";
  if (days === 1) {
    const never = cameras.filter((c) => camState(c) === "offline" && !c.last_seen).length;
    meta2 = never ? never + " tasi hech ulanmagan" : "Hech ulanmagan kamera yoʻq";
  } else if (series.length) {
    let peak = series[0];
    series.forEach((p) => { if (p.total - p.online > peak.total - peak.online) peak = p; });
    meta2 = (days === 7 ? "Haftalik" : "Oylik") + " choʻqqi: " + dayLabel(new Date(peak.t)) + " · " + fmtInt(peak.total - peak.online);
  }
  const prevOff = prevS?.by_state ? prevS.by_state.offline : null;

  // 3. Ishlash ulushi
  const a = avail.d, prevA = a?.previous;

  // 4. Uzilishlar (davr)
  let meta4 = "";
  const sp4: number[] = [];
  const tr = days === 1 ? hourly.d : daily.d;
  if (days === 1 && hourly.d && Array.isArray(hourly.d.outages)) {
    const h = hourly.d.outages;
    const peak = h.indexOf(Math.max(...h));
    meta4 = h[peak] ? "Choʻqqi " + p2(peak) + ":00 · " + h[peak] + " ta" : "Uzilish qayd etilmagan";
    // Soatlar xronologik tartibda (oxirgi 24 soat), yig'ma.
    const nowH = new Date().getHours();
    let acc = 0;
    for (let i = 1; i <= 24; i++) sp4.push(acc += h[(nowH + i) % 24] || 0);
  } else if (tr && daily.d && Array.isArray(daily.d.days)) {
    const ds = daily.d.days;
    let peak = ds[0];
    ds.forEach((x) => { if ((x.outages || 0) > (peak.outages || 0)) peak = x; });
    meta4 = peak && peak.outages ? "Choʻqqi: " + dayLabel(peak.date) + " · " + fmtInt(peak.outages) : "Uzilish qayd etilmagan";
    let acc = 0;
    ds.forEach((x) => sp4.push(acc += x.outages || 0));
  }
  const o = out.d, prevO = o?.previous;
  const d4 = o && prevO && prevO.outages != null
    ? (days === 1 ? numDelta(o.outages - prevO.outages)
      : prevO.outages ? pctDelta(((o.outages - prevO.outages) / prevO.outages) * 100) : null)
    : null;

  return (
    <div className="db-stats">
      <StatCard tone="success" label="Onlayn kameralar" color="--color-icon-success"
        tip="Oqim ochiladigan va kadr kelayotgan kameralar. Tasvirsiz kameralar onlayn hisoblanmaydi."
        num={fmtInt(n.online)} unit={"/ " + fmtInt(n.total)} meta={meta1} delta={d1}
        spark={thin(series.map((p) => p.online))} />
      <StatCard tone="error" label="Uzilgan" color="--color-icon-error"
        tip="Port javob bermayotgan kameralar soni va ulushi. Hech ulanmagan — kuzatuv davomida bir marta ham onlayn boʻlmagan."
        num={fmtInt(n.offline)} unit={n.measured ? fmtPct((n.offline / n.measured) * 100) : ""} meta={meta2}
        delta={prevOff != null ? numDelta(n.offline - prevOff) : null}
        spark={thin(series.map((p) => p.total - p.online))} />
      <StatCard tone="brand" label="Ishlash ulushi" color="--color-icon-brand"
        tip="Uptime — tanlangan davrda kameralar onlayn boʻlgan vaqt ulushi (faqat kuzatilgan vaqt boʻyicha)."
        num={a ? fmtPct(a.uptime_pct) : "—"}
        meta={a && a.coverage_pct != null ? "Kuzatuv qamrovi " + fmtPct(a.coverage_pct, a.coverage_pct >= 99.95 ? 0 : 1) : ""}
        delta={prevA && a!.uptime_pct != null && prevA.uptime_pct != null ? pctDelta(a!.uptime_pct - prevA.uptime_pct) : null}
        error={!!avail.err} spark={thin(series.map((p) => p.pct))} />
      <StatCard tone="warning" label={days === 1 ? "Bugungi uzilishlar" : "Uzilishlar · " + days + " kun"} color="--color-icon-warning"
        tip="2 daqiqadan uzun yoki hali davom etayotgan uzilishlar. Qisqa uzilishlar kirmaydi."
        num={o ? fmtInt(o.outages) : "—"} meta={meta4} delta={d4} error={!!out.err} spark={sp4} />
    </div>
  );
}

/* ====================== Liniya holati ====================== */
function LineCard() {
  const t = useT();
  const go = useDashNav();
  const { cameras } = useCameras();
  const stripRef = useRef<HTMLDivElement>(null);
  const cams = useMemo(() => cameras.filter((c) => c.km != null)
    .map((c) => ({ c, pos: (c.km as number) + (c.picket || 0) / 10, st: camState(c) })), [cameras]);
  const segs = useMemo(() => {
    const groups = new Map<string, typeof cams>();
    cams.forEach((x) => {
      const k = x.c.region || "Belgilanmagan";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(x);
    });
    return [...groups.entries()].map(([region, list]) => {
      list.sort((a, b) => a.pos - b.pos);
      // Hudud km oralig'i — eng katta uzluksiz bo'lagidan (100 km dan katta uzilish — alohida bo'lak).
      const runs = [[list[0]]];
      for (let i = 1; i < list.length; i++) {
        if (list[i].pos - list[i - 1].pos > 100) runs.push([]);
        runs[runs.length - 1].push(list[i]);
      }
      const main = runs.reduce((a, b) => (b.length > a.length ? b : a));
      const lo = Math.floor(main[0].pos / 10) * 10, hi = Math.ceil(main[main.length - 1].pos / 10) * 10;
      return { region, list, center: main[Math.floor(main.length / 2)].pos, range: lo === hi ? "km " + lo : "km " + lo + "–" + hi };
    }).sort((a, b) => a.center - b.center);
  }, [cams]);

  // Tor bo'lakda km oralig'i sig'masa — yashiriladi (nom qoladi, Figma'dagidek).
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const fit = () => strip.querySelectorAll<HTMLElement>(".db-seg__l").forEach((l) => {
      const km = l.querySelector<HTMLElement>(".db-seg__km")!;
      km.hidden = false;
      if (l.scrollWidth > l.clientWidth + 1) km.hidden = true;
    });
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(strip);
    return () => ro.disconnect();
  }, [segs, t]);

  const onClick = (e: React.MouseEvent) => {
    const sq = (e.target as Element).closest<HTMLElement>(".db-sq");
    if (sq) { go.camera(Number(sq.dataset.id)); return; }
    if ((e.target as Element).closest(".infotip")) return;
    go.map();
  };
  return (
    <article className="card db-card db-line" id="db-line" onClick={onClick}>
      <CardHead title="Liniya holati" sub={cams.length ? t(fmtInt(cams.length) + " kamera · km tartibida") : ""}
        tip="Har kvadrat — bitta kamera, km tartibida, hududlar boʻyicha. Kvadrat bosilsa kamera xaritada ochiladi.">
        <span className="spacer" />
        <span className="db-legend">
          <span><i data-status="online" />{t("Onlayn")}</span><span><i data-status="offline" />{t("Uzilgan")}</span>
          <span><i data-status="no-video" />{t("Tasvirsiz")}</span><span><i data-status="unknown" />{t("Nomaʼlum")}</span>
        </span>
      </CardHead>
      <div className={"db-line__strip" + (cams.length > 500 ? " is-dense" : "")} id="db-line-strip" ref={stripRef}>
        {!cams.length ? (
          cameras.length ? <Empty title="Km maʼlumoti yoʻq" text="Kameralarga km va piket kiritilsa liniya shu yerda koʻrinadi." /> : null
        ) : segs.map((s) => (
          <div key={s.region} className="db-seg" style={{ flex: s.list.length + " 1 0px", ["--n" as string]: s.list.length }}>
            <div className="db-sqs">
              {s.list.map((x) => {
                const c = x.c;
                const since = x.st === "offline" ? fmtSince(c.last_seen) : x.st === "online" && c.online_since ? fmtSince(c.online_since) : null;
                return <i key={c.id} className="db-sq" data-status={STATUS[x.st]} data-id={c.id}
                  data-tip={c.name + " · " + t(LABEL[x.st]) + (since ? " · " + t(since) : "")} />;
              })}
            </div>
            <div className="db-seg__l"><span className="db-seg__name">{t(s.region)}</span><span className="db-seg__km">{s.range}</span></div>
          </div>
        ))}
      </div>
    </article>
  );
}

/* ====================== Diqqat talab qiladi ====================== */
function AttentionCard({ days }: { days: Days }) {
  const t = useT();
  const go = useDashNav();
  const { user } = useAuth();
  const { cameras } = useCameras();
  const [mode, setMode] = useState<"down" | "flap">("down");
  const open = view(useOpenOutages());
  const flapQ = useRanking(days, "flapping", 30, mode === "flap");
  const flap = view(flapQ);
  const off = useMemo(() => cameras.filter((c) => camState(c) === "offline"), [cameras]);

  const rows = useMemo(() => {
    const openSec = new Map<number, number>();
    open.d?.items.forEach((x) => openSec.set(x.camera_id, x.seconds));
    const age = (c: Camera) => (c.last_seen ? Date.now() - Date.parse(c.last_seen) : (openSec.get(c.id) || 0) * 1000 + 1e12);
    return [...off].sort((a, b) => age(b) - age(a)).slice(0, 60).map((c) => ({
      c, dur: c.last_seen ? fmtSince(c.last_seen) : openSec.has(c.id) ? fmtDur(openSec.get(c.id)) : "",
    }));
  }, [off, open.d]);

  let body: React.ReactNode;
  if (mode === "flap") {
    if (flap.err) body = <ErrBox err={flap.err} />;
    else if (!flap.d) body = <Loading pending><SkelBars n={6} h={14} /></Loading>;
    else if (!flap.d.items.length) body = <Empty title="Beqaror kamera yoʻq" text="Bu davrda uzilish ham, qisqa uzilish ham qayd etilmadi." />;
    else body = flap.d.items.map((c) => (
      <button key={c.id} type="button" className="db-att-row" onClick={() => go.camera(c.id)}
        data-tip={c.outages + " ta uzilish · " + c.blips + " ta qisqa uzilish"}>
        <span className="dot" data-status={STATUS[c.state || "unknown"]} />
        <span className="db-att-row__t"><span className="ellipsis">{c.name}</span><span className="db-att-row__s ellipsis">{t(c.region || "")}</span></span>
        <span className="db-att-row__d t-warning">{t(fmtInt((c.outages || 0) + (c.blips || 0)) + " marta")}</span>
      </button>
    ));
  } else if (!cameras.length) {
    body = null;
  } else if (!off.length) {
    body = <Empty title="Barcha kameralar onlayn" text="Diqqat talab qiladigan kamera yoʻq." />;
  } else {
    body = rows.map(({ c, dur }) => (
      <button key={c.id} type="button" className="db-att-row" onClick={() => go.camera(c.id)}>
        <span className="dot" data-status="offline" />
        <span className="db-att-row__t"><span className="ellipsis">{c.name}</span><span className="db-att-row__s ellipsis">{t(c.region || "")}</span></span>
        {!c.last_seen && <span className="db-tag">{t("Hech ulanmagan")}</span>}
        {dur && <span className="db-att-row__d t-error">{t(dur)}</span>}
      </button>
    ));
  }

  return (
    <article className="card db-card" id="db-att-card">
      <CardHead title="Diqqat talab qiladi"
        tip="Uzilgan — hozir javob bermayotganlar, eng uzoq uzilgani birinchi. Beqaror — davrda eng koʻp uzilish va qisqa uzilish boʻlgan kameralar.">
        <span className="spacer" />
        {off.length > 0 && (
          <button type="button" className="db-link" onClick={() => (user?.role === "admin" ? go.admin({ status: "offline" }) : go.map())}>
            {t("Barchasi · " + fmtInt(off.length))}
          </button>
        )}
      </CardHead>
      <div className="seg seg--sm db-att-mode" role="group" aria-label={t("Roʻyxat")}>
        <button type="button" className={mode === "down" ? "is-on" : ""} onClick={() => setMode("down")}>{t("Uzilgan")}</button>
        <button type="button" className={mode === "flap" ? "is-on" : ""} onClick={() => setMode("flap")}>{t("Beqaror")}</button>
      </div>
      <div className="db-body db-scroll" id="db-att">{body}</div>
    </article>
  );
}

/* ====================== Hududlar holati ====================== */
function RegionsCard() {
  const t = useT();
  const go = useDashNav();
  const { cameras } = useCameras();
  const rows = useMemo(() => {
    const by = new Map<string, { region: string; on: number; n: number }>();
    cameras.forEach((c) => {
      const k = c.region || "Belgilanmagan";
      const r = by.get(k) || { region: k, on: 0, n: 0 };
      const s = camState(c);
      if (s !== "disabled") r.n++;
      if (s === "online") r.on++;
      by.set(k, r);
    });
    return [...by.values()].filter((r) => r.n)
      .map((r) => ({ ...r, pct: (r.on / r.n) * 100 }))
      .sort((a, b) => a.pct - b.pct || a.region.localeCompare(b.region, "uz"));
  }, [cameras]);
  return (
    <article className="card db-card" id="db-reg-card">
      <CardHead title="Hududlar holati" sub={t("hozir onlayn")}
        tip="Har hududda hozir onlayn kameralar ulushi. Eng yomoni yuqorida. Qator bosilsa hudud xaritada ochiladi." />
      <div className="db-body db-scroll" id="db-regions">
        {!rows.length ? (cameras.length ? <Empty title="Kamera yoʻq" /> : null) : rows.map((r) => {
          const st = r.pct < 80 ? "offline" : r.pct < 95 ? "no-video" : "online";
          return (
            <button key={r.region} type="button" className="db-reg" data-tip="Xaritada koʻrsatish" onClick={() => go.region(r.region)}>
              <div className="db-reg__top"><span className="ellipsis">{t(r.region)}</span>
                <span className="db-reg__v">{r.on + "/" + r.n + " · " + Math.round(r.pct) + "%"}</span></div>
              <div className="db-bar"><i data-status={st} style={{ width: r.pct.toFixed(1) + "%" }} /></div>
            </button>
          );
        })}
      </div>
    </article>
  );
}

/* ====================== Soʻnggi hodisalar ====================== */
/* Shu seansda ochilgan oqimlar (pleyer "nigoh:open-time") — sahifadan chiqilganda ham saqlanadi. */
const openEvents: FeedItem[] = [];
const openSubs = new Set<() => void>();
window.addEventListener("nigoh:open-time", (e) => {
  const { id, ms } = (e as CustomEvent<{ id: number; ms: number }>).detail;
  openEvents.unshift({ ts: new Date().toISOString(), camera_id: id, name: "", kind: "open", ms });
  openEvents.length = Math.min(openEvents.length, 20);
  openSubs.forEach((f) => f());
});
function useOpenEvents() {
  const [, set] = useState(0);
  useEffect(() => {
    const f = () => set((x) => x + 1);
    openSubs.add(f);
    return () => { openSubs.delete(f); };
  }, []);
  return openEvents;
}

function EventsCard() {
  const t = useT();
  const go = useDashNav();
  const { byId } = useCameras();
  const feedQ = useFeed();
  const feed = view(feedQ);
  const opens = useOpenEvents();
  const [broken, setBroken] = useState<Set<number>>(() => new Set());

  const items = [...(feed.d?.items || []),
    ...opens.map((e) => ({ ...e, name: byId.get(e.camera_id)?.name || "" })).filter((e) => e.name)]
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, 14);

  let body: React.ReactNode;
  if (feed.err && !opens.length) body = <ErrBox err={feed.err} />;
  else if (!feed.d && !opens.length) body = <Loading pending={feed.pending}><SkelBars n={6} h={14} /></Loading>;
  else if (!items.length) body = <Empty title="Hodisa yoʻq" text="Kameralar holati oʻzgarganda shu yerda koʻrinadi." />;
  else {
    // Surat faqat eng so'nggi 8 ta hodisada — oxirgi ma'lum kadr, uzilganda ham.
    const seen = new Set<number>();
    body = items.map((e, i) => {
      const desc = e.kind === "offline" ? "— uzildi"
        : e.kind === "open" ? "— oqim ochildi · " + ((e.ms || 0) / 1000).toFixed(1).replace(".", ",") + " s"
          : "— qayta ulandi";
      const thumb = i < 8 && e.camera_id && !seen.has(e.camera_id) && !broken.has(e.camera_id);
      if (thumb) seen.add(e.camera_id);
      const where = (e.region ? t(e.region) : "") + (e.km != null ? " · " + e.km + (e.picket ? "/" + e.picket : "") + " km" : "");
      return (
        <button key={(e.id ?? "o" + e.ts) + ":" + e.camera_id} type="button" className="db-ev" onClick={() => go.camera(e.camera_id)}
          data-tip={where || undefined}>
          <span className="db-ev__time">{hhmm(e.ts)}</span>
          <span className="dot" data-status={e.kind === "offline" ? "offline" : "online"} />
          <span className="db-ev__name">{e.name}</span><span className="db-ev__desc ellipsis">{t(desc)}</span>
          {thumb && <img className="db-ev__img" loading="lazy" alt="" src={"/api/cameras/" + e.camera_id + "/snapshot?stale=1&cached=1"}
            onError={() => setBroken((s) => new Set(s).add(e.camera_id))} />}
        </button>
      );
    });
  }
  return (
    <article className="card db-card" id="db-ev-card">
      <CardHead title="Soʻnggi hodisalar"
        tip="Uzilish, qayta ulanish va shu seansda ochilgan oqimlar. Surat — kameraning oxirgi maʼlum kadri.">
        <span className="spacer" />
        <button type="button" className="db-link" onClick={() => document.querySelector<HTMLButtonElement>(".db-sysbar .bell__btn")?.click()}>
          {t("Barchasi")}
        </button>
      </CardHead>
      <div className="db-body db-scroll" id="db-events">{body}</div>
    </article>
  );
}

/* ====================== Bugungi tahlil ====================== */
function TodayCard({ days }: { days: Days }) {
  const t = useT();
  const reg = view(useRegions(days));
  const sla = view(useSla(days));
  const out = view(useOutageSummary(days));
  const all = [reg, sla, out];

  let body: React.ReactNode;
  if (all.every((x) => !x.d && !x.err)) body = <Loading pending><SkelBars n={2} h={18} /></Loading>;
  else if (all.every((x) => !x.d)) body = all.some((x) => x.err) ? <AlertBox /> : null;
  else {
    const worst = reg.d ? [...reg.d.regions].filter((r) => r.outages).sort((a, b) => b.outages - a.outages)[0] : null;
    const w = sla.d?.worst || null;
    const o = out.d;
    const wd = w ? new Date(w.ts) : null;
    const tiles: [string, string, string, string, string][] = [
      ["Eng muammoli hudud", "Davrda eng koʻp uzilish (2 daqiqadan uzun) boʻlgan hudud.",
        worst ? worst.region : "Yoʻq", worst ? fmtInt(worst.outages) + " ta uzilish" : "uzilish qayd etilmagan", ""],
      ["Eng past nuqta", "Onlayn kameralar ulushi eng past tushgan payt (5 daqiqalik oʻlchov boʻyicha).",
        w ? fmtPct(w.pct, 0) : "—", wd ? (days === 1 ? "" : WD[wd.getDay()] + " " + wd.getDate() + " · ") + p2(wd.getHours()) + ":" + p2(wd.getMinutes()) : "",
        w && w.pct < 50 ? "t-error" : w && w.pct < 90 ? "t-warning" : ""],
      ["Tiklangan uzilishlar", "Davrda tugagan, yaʼni kamera qayta ulangan uzilishlar soni.",
        o && o.mttr ? fmtInt(o.mttr.recovered) : "—", "qayta ulangan", ""],
      ["Uzilish boʻlgan kameralar", "Davrda kamida bir marta uzilgan kameralar soni.",
        o ? fmtInt(o.affected_cameras) : "—", "kamida 1 marta uzilgan", ""],
      ["Eng uzun uzilish", "Davrdagi eng uzun uzilish (faqat kuzatilgan qismi). Hali davom etayotgan boʻlishi mumkin.",
        o && o.longest ? fmtDur(o.longest.seconds) : "—",
        o && o.longest ? o.longest.name + (o.longest.open ? " · davom etmoqda" : "") : "uzilish qayd etilmagan",
        o && o.longest && o.longest.open ? "t-error" : ""],
      ["Ishlamagan vaqt", "Davrda barcha kameralarning ishlamagan (onlayn boʻlmagan) vaqti yigʻindisi, kamera-soatda.",
        o && o.offline_camera_hours != null ? fmtInt(o.offline_camera_hours) : "—", "kamera-soat", ""],
    ];
    body = tiles.map(([label, tip, value, meta, cls]) => <Tile key={label} label={label} tip={tip} value={value} meta={meta} cls={cls} />);
  }
  return (
    <article className="card db-card" id="db-today-card">
      <CardHead title={days === 1 ? "Bugungi tahlil" : "Davr tahlili"}
        sub={t((days === 1 ? "soʻnggi 24 soat" : days + " kun") + " · server tarixidan")}
        tip="Davr tarixidan hisoblangan xulosalar: qayerda va qachon muammo boʻlgan, qanchasi tiklangan." />
      <div className="db-tiles db-tiles--3 db-body" id="db-today">{body}</div>
    </article>
  );
}

/* ====================== Tezkor amallar (faqat admin) ====================== */
function ActionsCard() {
  const t = useT();
  const go = useDashNav();
  const { user } = useAuth();
  if (user?.role !== "admin") return null;
  return (
    <article className="card db-card" id="db-actions-card">
      <CardHead title="Tezkor amallar" tip="Eng koʻp ishlatiladigan boshqaruv amallari. Faqat administratorga koʻrinadi." />
      <div className="db-actions">
        <button type="button" className="btn btn--primary btn--sm" onClick={() => go.admin(undefined, "new-camera")}><Icon name="plus" size="sm" />{t("Kamera qoʻshish")}</button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={go.map}><Icon name="map" size="sm" />{t("Xarita")}</button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={go.wall}><Icon name="grid" size="sm" />{t("Video devor")}</button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => go.admin(undefined, "sync")}><Icon name="server" size="sm" />{t("MediaMTX")}</button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => go.settings("tizim")}><Icon name="activity" size="sm" />{t("Tizim holati")}</button>
      </div>
    </article>
  );
}

/* ====================== Tizim holati ====================== */
const SVC_ICON: Record<string, string> = { api: "server", db: "database", mediamtx: "video", health: "activity", disk: "hard-drive",
  network: "wifi", snapshots: "camera", stream: "play" };
const SVC_BADGE: Record<string, [string, string]> = { ok: ["online", "Faol"], warn: ["warning", "Diqqat"], warning: ["warning", "Diqqat"],
  degraded: ["warning", "Diqqat"], unknown: ["unknown", "Nomaʼlum"] };

function SystemCard() {
  const t = useT();
  const { st: stQ, hl: hlQ } = useSystemInfo();
  const st = stQ.data && !stQ.error ? stQ.data : null;
  const h = hlQ.data ?? null;
  const pending = stQ.isPending || hlQ.isPending;

  let services: { key: string; name: string; state: string; detail?: string }[] | null = null;
  if (st && Array.isArray(st.services) && st.services.length) services = st.services;
  else if (h) {
    // Eski server: /health dan taxminiy xizmatlar ro'yxati.
    const hc = h.health || {};
    const fresh = hc.at && Date.now() - Date.parse(hc.at) < 10 * 60000;
    const ok = apiOk();
    services = [
      { key: "api", name: "API", state: ok ? "ok" : "down", detail: ok ? "Soʻrovlarga javob bermoqda" : "Javob yoʻq" },
      { key: "mediamtx", name: "Video server", state: h.mediamtx ? "ok" : "down", detail: h.mediamtx ? "Ishlamoqda" : "Ishlamayapti" },
      { key: "health", name: "Holat tekshiruvi", state: fresh ? "ok" : "warn",
        detail: hc.checked ? hc.online + "/" + hc.checked + " qurilma javob berdi" : "Hali tekshirilmagan" },
      { key: "network", name: "Kamera tarmogʻi", state: hc.latency_ms == null ? "unknown" : hc.latency_ms < 300 ? "ok" : "warn",
        detail: hc.latency_ms == null ? "—" : Math.round(hc.latency_ms) + " ms" },
    ];
    if (h.snapshots) services.push({ key: "snapshots", name: "Suratlar", state: h.snapshots.ok >= h.snapshots.total * 0.8 ? "ok" : "warn",
      detail: h.snapshots.ok + "/" + h.snapshots.total + " surat olindi" });
  }
  const at = st?.checked_at ? new Date(st.checked_at) : h?.health?.at ? new Date(h.health.at) : null;
  const mbps = (v: number | null | undefined) => (v == null ? "—" : (Math.round(v * 10) / 10).toString().replace(".", ","));

  let body: React.ReactNode;
  if (!services) {
    body = pending ? <Loading pending><SkelBars n={5} h={16} /></Loading>
      : stQ.error ? <AlertBox /> : <Empty title="Maʼlumot yoʻq" text="Server tizim holatini bermadi." />;
  } else {
    body = (
      <>
        <div className="db-svc-list">
          {services.map((x) => {
            const [bs, bt] = SVC_BADGE[x.state] || ["offline", "Nosoz"];
            return (
              <div key={x.key} className="db-svc">
                <span className="db-svc__ic"><Icon name={SVC_ICON[x.key] || "circle-check"} size="sm" /></span>
                <span className="db-svc__t"><span className="ellipsis">{t(x.name)}</span><span className="db-svc__d ellipsis">{t(x.detail || "")}</span></span>
                <span className="badge" data-status={bs}><span className="dot" data-status={bs === "warning" ? "no-video" : bs} />{t(bt)}</span>
              </div>
            );
          })}
        </div>
        {h && (h.streams != null || h.readers != null) && (
          <div className="db-sys-foot">
            <span data-tip="Server hozir ochiq tutgan video oqimlar">{t("Oqimlar")} <b>{fmtInt(h.streams)}</b></span>
            <span data-tip="Oqimlarni hozir koʻrayotgan ulanishlar">{t("Tomoshabinlar")} <b>{fmtInt(h.readers)}</b></span>
            {h.egress_mbps != null && (
              <span data-tip="Serverdan chiqayotgan video trafik / sigʻim">{t("Trafik")} <b>{mbps(h.egress_mbps)}</b>
                {(h.egress_capacity_mbps ? " / " + fmtInt(h.egress_capacity_mbps) : "") + " Mbit/s"}</span>
            )}
          </div>
        )}
      </>
    );
  }
  return (
    <article className="card db-card" id="db-sys-card">
      <CardHead title="Tizim holati" sub={at && !isNaN(at.getTime()) ? t("tekshirildi " + hhmm(at)) : ""}
        tip="Server xizmatlari: API, baza, media server, holat tekshiruvi, disk va kamera tarmogʻi." />
      <div className="db-body" id="db-sys">{body}</div>
    </article>
  );
}
