/* pages/dash/TahlilTab.tsx — Statistika / Tahlil (Figma 03.03 + v2 vidjetlari; v3 overview.js + ranking.js).
     * Ishonchlilik — 7 KpiTile: Ishlash ulushi, Uzilishlar, Qisqa uzilishlar, Tasvir to'xtashlari,
       Tiklanish vaqti, Uzilishlar orasidagi vaqt, Kuzatuv qamrovi (eng uzun bo'shliq bilan);
     * Hududlar reytingi (+ CSV) va Ishlash ulushi taqsimoti;
     * Kamera markalari (bosilsa modellari ochiladi) va Kamera holatlari (donut, sabablar maslahatda);
     * Muammoli kameralar: Reyting (4 saralash), Eng uzun uzilishlar, Ochilish vaqti;
     * Texnik kesim (to'plangan chiziq + legenda) va Maʼlumot sifati — admin: Boshqaruv mos filtr
       bilan (README.md "Boshqaruv filtri"), boshqalar: qator ostida kameralar ro'yxati. */
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useT } from "@/i18n/I18nProvider";
import { useAuth } from "@/auth/AuthProvider";
import { useCameras } from "@/data/queries";
import { useToast } from "@/components/overlays";
import { Icon } from "@/components/Icon";
import { InfoTip } from "@/components/ui";
import { openTimes } from "@/player/openTimes.js";
import type { ApiState, Camera } from "@/lib/types";
import { Donut, type DonutPart } from "./charts";
import {
  AlertBox, CardHead, Empty, ErrBox, Loading, Section, SkelBars, Tile, camState, dayLabel, fmtDur, fmtInt, fmtPct, hhmm,
  is404, LABEL, STATUS, useDashNav,
} from "./common";
import {
  useAvailability, useCoverage, useLongest, useOpenMetrics, useOutageSummary, useQuality, useRanking, useRegions,
  useVendors, view, type Days, type OutageItem, type RankItem, type Regions, type Vendor, type VendorRow,
} from "./queries";

export function TahlilTab({ days }: { days: Days }) {
  return (
    <div className="db-panel" id="db-tahlil" role="tabpanel" aria-label="Tahlil">
      <Section>Umumiy koʻrsatkichlar</Section>
      <ReliabilityCard days={days} />
      <Section>Hududlar</Section>
      <div className="db-g21">
        <RegionTableCard days={days} />
        <DistributionCard days={days} />
      </div>
      <Section>Kameralar tarkibi</Section>
      <div className="db-g21">
        <VendorsCard days={days} />
        <StatesCard />
      </div>
      <Section>Muammoli kameralar</Section>
      <div className="db-grid3 db-grid3--tahlil">
        <RankingCard days={days} />
        <LongestCard days={days} />
        <OpenTimesCard />
      </div>
      <Section>Texnik holat va maʼlumot sifati</Section>
      <div className="db-g12">
        <TechCard days={days} />
        <QualityCard />
      </div>
    </div>
  );
}

const kmOf = (x: { km?: number | null; picket?: number | null }) => (x.km != null ? x.km + (x.picket ? "/" + x.picket : "") + " km" : "");
/** Nomida km bo'lsa (masalan "3377/1 km") — takrorlanmaydi. */
const where = (x: { region?: string | null; name?: string; km?: number | null; picket?: number | null }) =>
  [x.region, String(x.name || "").includes(kmOf(x)) ? "" : kmOf(x)].filter(Boolean).join(" · ");
const upTone = (v: number | null | undefined) => (v == null ? "unknown" : v >= 99 ? "online" : v >= 95 ? "no-video" : "offline");
const upCls = (v: number | null | undefined) => (v == null ? "" : v >= 99 ? "t-success" : v >= 95 ? "t-warning" : "t-error");
const periodWord = (days: Days) => (days === 1 ? "bugun" : days + " kun");

/* ====================== Ishonchlilik ====================== */
function ReliabilityCard({ days }: { days: Days }) {
  const t = useT();
  const aQ = view(useAvailability(days));
  const oQ = view(useOutageSummary(days));
  const cQ = view(useCoverage(days));
  const av = aQ.d, ov = oQ.d, cv = cQ.d;

  let body: ReactNode;
  if (!av && !ov && !aQ.err && !oQ.err) body = <Loading pending><SkelBars n={2} h={18} /></Loading>;
  else if (!av && !ov) body = <AlertBox />;
  else {
    const up = av ? av.uptime_pct : null;
    const cov = av ? av.coverage_pct : cv ? cv.pct : null;
    const thr = ov ? Math.round(ov.blip_threshold_s / 60) : 2;
    const gap = cv && cv.gaps && cv.gaps.length ? [...cv.gaps].sort((x, y) => y.hours - x.hours)[0] : null;
    const tiles: [string, string, string, string, string][] = [
      ["Ishlash ulushi", "Uptime — kameralar onlayn boʻlgan vaqt ulushi (faqat kuzatilgan vaqt boʻyicha). 90% dan past — ogohlantirish, 95% va undan yuqori — yaxshi.",
        fmtPct(up), "barcha kameralar boʻyicha", up == null ? "" : up < 90 ? "t-warning" : up >= 95 ? "t-success" : ""],
      ["Uzilishlar", thr + " daqiqadan uzun yoki hali davom etayotgan uzilishlar soni. Qisqa uzilishlar bunga kirmaydi.",
        ov ? fmtInt(ov.outages) : "—", thr + " daqiqadan uzun", ""],
      ["Qisqa uzilishlar", thr + " daqiqadan qisqa, oʻzi tiklangan uzilishlar — odatda tarmoq beqarorligi belgisi.",
        ov ? fmtInt(ov.blips) : "—", thr + " daqiqadan qisqa", ""],
      ["Tasvir toʻxtashlari", "Port ochiq, lekin video kelmay qolgan holatlar. Uzilish hisobiga kirmaydi.",
        ov && ov.stalls != null ? fmtInt(ov.stalls) : "—", "aloqa bor, kadr yoʻq", ""],
      ["Tiklanish vaqti", "MTTR — uzilishdan tiklanishgacha oʻtgan vaqt (mediana). Pastda: uzilishlarning 90 foizi shu vaqt ichida tiklanadi.",
        ov && ov.mttr ? fmtDur(ov.mttr.median_s) : "—", ov && ov.mttr && ov.mttr.p90_s != null ? "90 foizi — " + fmtDur(ov.mttr.p90_s) + " ichida" : "", ""],
      ["Uzilishlar orasidagi vaqt", "MTBF — bitta kamerada ikki uzilish orasidagi oʻrtacha vaqt. Qancha katta boʻlsa, shuncha yaxshi.",
        ov && ov.mtbf_s ? fmtDur(ov.mtbf_s) : "—", "har bir kamera uchun", ""],
      ["Kuzatuv qamrovi", "Davrning qancha qismida server oʻlchov yozgan. Past boʻlsa boshqa koʻrsatkichlar toʻliq emas.",
        cov == null ? "—" : fmtPct(cov, cov >= 99.95 ? 0 : 1),
        cov == null ? "" : cov >= 99.95 ? "kuzatuv toʻliq" : gap ? "eng uzun boʻshliq — " + fmtDur(gap.hours * 3600) : cv ? fmtInt(cv.missing_hours) + " soat kuzatuvsiz" : "",
        cov == null ? "" : cov >= 95 ? "t-success" : cov < 70 ? "t-error" : "t-warning"],
    ];
    body = tiles.map(([label, tip, value, meta, cls]) => <Tile key={label} clamp label={label} tip={tip} value={value} meta={meta} cls={cls} />);
  }
  return (
    <article className="card db-card" id="db-rel-card">
      <CardHead title="Ishonchlilik" sub={t(periodWord(days) + " · kuzatuv boʻlgan vaqt boʻyicha")}
        tip="Kuzatuv boʻlgan vaqt boʻyicha ishonchlilik. Atamalar izohi har koʻrsatkichning “?” belgisida." />
      <div className="db-tiles db-tiles--rel db-body" id="db-rel">{body}</div>
    </article>
  );
}

/* ====================== Hududlar reytingi ====================== */
const FLOOR = 90;   // shkala 90–100%: 0–100 da 95 va 98 bir xil uzunlikda ko'rinib, farq yo'qolardi

function regionsCsv(data: Regions | null, days: Days, toast: ReturnType<typeof useToast>) {
  const list = data?.regions || [];
  if (!list.length) { toast("Eksport uchun maʼlumot yoʻq", { tone: "error" }); return; }
  const cell = (v: unknown) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const head = ["Hudud", "Kameralar soni", "Hozir onlayn", "Hozir tasvirsiz", "Hozir uzilgan", "Hozir onlayn, %",
    "Ishlash ulushi, % (" + days + " kun)", "Uzilishlar", "Qisqa uzilishlar", "Ishlamagan vaqt, soat"];
  const body = list.map((r) => {
    const n = r.now || {};
    return [r.region, r.cameras, n.online, n.stalled, n.offline, r.online_now_pct, r.uptime_pct, r.outages, r.blips,
      r.offline_hours].map(cell).join(",");
  });
  const blob = new Blob(["﻿" + [head.map(cell).join(","), ...body].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "nigoh-hududlar-" + days + "kun.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(list.length + " ta hudud eksport qilindi", { tone: "success" });
}

function RegionTableCard({ days }: { days: Days }) {
  const t = useT();
  const go = useDashNav();
  const toast = useToast();
  const q = view(useRegions(days));
  const list = q.d?.regions || [];
  const rows = useMemo(() => [...list].sort((a, b) => (a.uptime_pct ?? 101) - (b.uptime_pct ?? 101)), [list]);
  let body: ReactNode;
  if (q.err) body = <ErrBox err={q.err} />;
  else if (!q.d) body = <Loading pending={q.pending}><SkelBars n={6} h={16} /></Loading>;
  else if (!list.length) body = <Empty title="Hudud yoʻq" />;
  else body = (
    <div className="db-rt">
      <div className="db-rt-row db-rt-head">
        <span>#</span><span>{t("Hudud")}</span><span data-tip="Hozir onlayn / tekshirilgan kameralar">{t("Hozir onlayn")}</span>
        <span data-tip="Uptime — davrda onlayn boʻlgan vaqt ulushi. Shkala 90–100%">{t("Ishlash ulushi")}</span>
        <span>{t("Uzilish")}</span><span data-tip="2 daqiqadan qisqa uzilishlar">{t("Qisqa uzilish")}</span><span>{t("Ishlamagan vaqt")}</span>
      </div>
      {rows.map((r, i) => {
        const v = r.uptime_pct;
        const w = v == null ? 0 : Math.max(2, Math.min(100, ((v - FLOOR) / (100 - FLOOR)) * 100));
        const now = r.now || {};
        const measured = (now.online || 0) + (now.stalled || 0) + (now.offline || 0);
        return (
          <button key={r.region} type="button" className="db-rt-row" data-tip="Xaritada koʻrsatish" onClick={() => go.region(r.region)}>
            <span className="db-rt-n">{i + 1}</span>
            <span className="db-rt-name ellipsis">{t(r.region)}</span>
            <span className="db-num">{measured ? fmtInt(now.online) + "/" + fmtInt(measured) : "—"}</span>
            <span className="db-rt-up"><span className="db-bar"><i data-status={upTone(v)} style={{ width: w.toFixed(1) + "%" }} /></span>
              <span className={"db-num " + upCls(v)}>{fmtPct(v)}</span></span>
            <span className={"db-num" + (r.outages ? " t-error" : "")}>{fmtInt(r.outages || 0)}</span>
            <span className="db-num">{fmtInt(r.blips || 0)}</span>
            <span className="db-num">{r.offline_hours != null ? t(fmtDur(r.offline_hours * 3600)) : "—"}</span>
          </button>
        );
      })}
    </div>
  );
  return (
    <article className="card db-card" id="db-rr-card">
      <CardHead title="Hududlar reytingi" sub={t(periodWord(days) + " · eng yomoni yuqorida")}
        tip="Davrdagi ishlash ulushi (shkala 90–100%), uzilishlar va ishlamagan vaqt. Eng yomoni yuqorida. Qator bosilsa hudud xaritada ochiladi.">
        <span className="spacer" />
        {!q.err && (
          <button type="button" className="db-link" onClick={() => regionsCsv(q.d, days, toast)}><Icon name="download" size="sm" />CSV</button>
        )}
      </CardHead>
      <div className="db-body db-xscroll" id="db-rr">{body}</div>
    </article>
  );
}

/* ====================== Ishlash ulushi taqsimoti ====================== */
const BAND_TONE: Record<string, string> = { "100%": "online", "99–100%": "online", "95–99%": "brand", "90–95%": "no-video", "<90%": "offline" };
const BAND_LABEL: Record<string, string> = { "100%": "100% (uzilishsiz)", "99–100%": "99–100%", "95–99%": "95–99%", "90–95%": "90–95%", "<90%": "90% dan past" };

function DistributionCard({ days }: { days: Days }) {
  const t = useT();
  const q = view(useAvailability(days));
  const dist = q.d?.distribution || [];
  const total = dist.reduce((s, b) => s + b.cameras, 0);
  const max = Math.max(...dist.map((b) => b.cameras), 1);
  // Band nomlari serverdan "99–100%" (en-dash) bilan keladi.
  const good = dist.filter((b) => b.band === "100%" || b.band.startsWith("99")).reduce((s, b) => s + b.cameras, 0);
  let body: ReactNode;
  if (q.err) body = <ErrBox err={q.err} />;
  else if (!q.d) body = <Loading pending={q.pending}><SkelBars n={4} h={16} /></Loading>;
  else if (!total) body = <Empty title="Taqsimot yoʻq" text="Davrda kuzatilgan kamera boʻlmagan." />;
  else body = (
    <div className="db-dist">
      {dist.map((b) => {
        const pct = (b.cameras / total) * 100;
        return (
          <div key={b.band} className="db-dist-row" data-tip={fmtInt(b.cameras) + " kamera · " + Math.round(pct) + "%"}>
            <span className="db-dist-l">{t(BAND_LABEL[b.band] || b.band)}</span>
            <span className="db-dist-bar"><i data-tone={BAND_TONE[b.band] || "unknown"} style={{ width: Math.max(1.5, (b.cameras / max) * 100).toFixed(1) + "%" }} /></span>
            <span className="db-num">{fmtInt(b.cameras)}</span><span className="db-tech-pct">{Math.round(pct) + "%"}</span>
          </div>
        );
      })}
    </div>
  );
  return (
    <article className="card db-card" id="db-dist-card">
      <CardHead title="Ishlash ulushi taqsimoti" sub={q.d && total ? t(Math.round((good / total) * 100) + "% kamerada 99% dan yuqori") : ""}
        tip="Ishlash ulushi (uptime) oraliqlari boʻyicha kameralar soni. 100% — davrda bir marta ham uzilmagan kameralar." />
      <div className="db-body" id="db-dist">{body}</div>
    </article>
  );
}

/* ====================== Kamera markalari ====================== */
const VENDOR: Record<string, string> = { dahua: "Dahua", hikvision: "Hikvision", holowits: "Holowits", boshqa: "Boshqa", unknown: "Nomaʼlum" };
const vendorLabel = (v: string) => VENDOR[v] || (v ? v[0].toUpperCase() + v.slice(1) : "Nomaʼlum");
const NOW_PARTS = ["online", "stalled", "offline"] as const;

function VendorsCard({ days }: { days: Days }) {
  const t = useT();
  const q = view(useVendors(days));
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const list = q.d?.vendors || [];
  const models = list.reduce((s, x) => s + (x.models || []).filter((m) => m.model).length, 0);

  let body: ReactNode;
  if (q.err) body = <ErrBox err={q.err} />;
  else if (!q.d) body = <Loading pending={q.pending}><SkelBars n={4} h={16} /></Loading>;
  else if (!list.length) body = <Empty title="Kamera yoʻq" />;
  else {
    const vUpCls = (u: number | null) => (u == null ? "" : u < 90 ? "t-warning" : u >= 95 ? "t-success" : "");
    const maxRate = Math.max(0.01, ...list.flatMap((x) => [x.outages_per_camera, ...(x.models || []).map((m) => m.outages_per_camera)])
      .filter((x): x is number => x != null));
    const nowCell = (r: VendorRow) => {
      const n = r.now || {};
      const measured = NOW_PARTS.reduce((s, k) => s + (n[k] || 0), 0);
      const tip = NOW_PARTS.map((k) => (n[k] || 0) + " " + LABEL[k].toLowerCase()).join(" · ");
      return (
        <span className="db-vt-now" data-tip={tip}>
          <span className="db-vt-stack">
            {NOW_PARTS.filter((k) => n[k]).map((k) => <i key={k} data-status={STATUS[k]} style={{ flex: n[k] + " 1 0px" }} />)}
          </span>
          <b>{measured ? fmtInt(n.online) + "/" + fmtInt(measured) : "—"}</b>
        </span>
      );
    };
    const rateCell = (x: number | null) => (
      <span className="db-vt-rate"><span className="db-bar"><i data-status="offline" style={{ width: (x == null ? 0 : Math.max(3, (x / maxRate) * 100)).toFixed(1) + "%" }} /></span>
        <b>{x == null ? "—" : x.toFixed(1).replace(".", ",")}</b></span>
    );
    const cells = (r: VendorRow, top: Vendor | null) => (
      <>
        <span>{fmtInt(r.cameras)}</span>{nowCell(r)}
        <span className={vUpCls(r.uptime_pct)}>{fmtPct(r.uptime_pct)}</span>
        {rateCell(r.outages_per_camera)}
        <span>{fmtInt(r.blips)}</span>
        <span>{t(fmtDur(r.mttr_median_s))}</span>
        <span>{top ? (top.transcode ? fmtInt(top.transcode) : "—") : ""}</span>
      </>
    );
    body = (
      <div className="db-vt">
        <div className="db-vt-row db-vt-head"><span>{t("Marka")}</span><span>{t("Kamera")}</span>
          <span data-tip="Hozir onlayn / tekshirilgan kameralar">{t("Hozir onlayn")}</span>
          <span data-tip="Uptime — davrda onlayn boʻlgan vaqt ulushi">{t("Ishlash ulushi")}</span>
          <span data-tip="Davrdagi uzilishlar soni ÷ kameralar soni">{t("Uzilish (har kameraga)")}</span>
          <span data-tip="2 daqiqadan qisqa uzilishlar">{t("Qisqa uzilish")}</span>
          <span data-tip="MTTR — uzilishdan tiklanishgacha oʻtgan vaqt (mediana)">{t("Tiklanish vaqti")}</span>
          <span data-tip="H.265 → H.264 oʻgirilayotgan kameralar">{t("Oʻgirish")}</span></div>
        {list.map((r) => {
          const codecs = ([["H.264", r.codecs?.H264], ["H.265", r.codecs?.H265]] as [string, number | undefined][])
            .filter(([, n]) => n).map(([k, n]) => k + ": " + n).join(" · ");
          const nm = (r.models || []).filter((m) => m.model).length;
          const isOpen = open.has(r.vendor);
          const toggle = () => setOpen((s) => { const x = new Set(s); if (x.has(r.vendor)) x.delete(r.vendor); else x.add(r.vendor); return x; });
          return (
            <Fragment key={r.vendor}>
              <button type="button" className={"db-vt-row" + (isOpen ? " is-open" : "")} aria-expanded={isOpen} onClick={toggle}>
                <span className="db-vt-name"><b><span className="db-vt-chev"><Icon name="chevron-right" size="sm" /></span>{t(vendorLabel(r.vendor))}</b>
                  <i>{t(nm + " model") + (codecs ? " · " + codecs : "") + (r.no_model ? " · " + t("modeli nomaʼlum: " + r.no_model) : "")}</i></span>
                {cells(r, r)}
              </button>
              {isOpen && (r.models || []).map((m, i) => (
                <div key={(m.model || "") + i} className="db-vt-row db-vt-sub">
                  <span className="db-vt-name"><i>{m.model || t("Model nomaʼlum")}</i></span>{cells(m, null)}
                </div>
              ))}
            </Fragment>
          );
        })}
      </div>
    );
  }
  return (
    <article className="card db-card" id="db-ven-card">
      <CardHead title="Kamera markalari" sub={list.length ? t(list.length + " marka · " + models + " model") : ""}
        tip="Marka va model kesimida koʻrsatkichlar. Uzilish (har kameraga) — davrdagi uzilishlar soni ÷ kameralar soni. Qator bosilsa modellari ochiladi." />
      <div className="db-body db-xscroll" id="db-vendors">{body}</div>
    </article>
  );
}

/* ====================== Kamera holatlari (donut) ====================== */
const STATE_PARTS: [ApiState, string][] = [
  ["online", "--color-status-online-icon"], ["stalled", "--color-status-no-video-icon"],
  ["offline", "--color-status-offline-icon"], ["disabled", "--color-status-disabled-icon"],
  ["unknown", "--color-status-unknown-icon"],
];
const STATE_HINT: Record<ApiState, string> = {
  online: "Tarmoq va tasvir bor", stalled: "Aloqa bor, lekin kadr kelmayapti", offline: "Tarmoqdan javob yoʻq",
  disabled: "Administrator oʻchirgan", unknown: "Server hali tekshirmagan yoki IP manzil yoʻq",
};

function StatesCard() {
  const t = useT();
  const { cameras, isPending } = useCameras();
  const total = cameras.length;
  const { parts, n, by, regions } = useMemo(() => {
    const n: Partial<Record<ApiState, number>> = {}, by: Partial<Record<ApiState, Camera[]>> = {};
    cameras.forEach((c) => {
      const s = camState(c);
      n[s] = (n[s] || 0) + 1;
      (by[s] = by[s] || []).push(c);
    });
    const parts: (DonutPart & { key: ApiState })[] = STATE_PARTS.map(([k, color]) => ({ key: k, n: n[k] || 0, color, label: t(LABEL[k]) }))
      .filter((p) => p.n || p.key !== "unknown");
    return { parts, n, by, regions: new Set(cameras.map((c) => c.region || "Belgilanmagan")).size };
  }, [cameras, t]);
  const active = total - (n.disabled || 0);
  const pct = active ? ((n.online || 0) / active) * 100 : 0;
  // Muammoli holatda qaysi kameralar va nega — maslahatda.
  const why = (k: ApiState) => {
    const list = by[k];
    if (k === "online" || !list) return STATE_HINT[k];
    return t(STATE_HINT[k]) + ": " + list.slice(0, 6).map((c) => c.name + (c.state_reason ? " — " + c.state_reason : "")).join("; ") +
      (list.length > 6 ? " " + t("… va yana " + (list.length - 6) + " ta") : "");
  };
  return (
    <article className="card db-card" id="db-states-card">
      <CardHead title="Kamera holatlari" sub={total ? t(fmtInt(total) + " kamera · " + regions + " hudud") : t("joriy taqsimot")}
        tip="Barcha kameralar joriy holat boʻyicha. Markazdagi foiz oʻchirilganlarsiz. Qatorda — sabablar." />
      <div className="db-body db-states" id="db-states">
        {!total ? (isPending ? null : <Empty title="Kamera yoʻq" />) : <>
          <Donut parts={parts} value={Math.round(pct) + "%"} sub={fmtInt(n.online || 0) + " / " + fmtInt(active)} />
          <div className="db-states__legend">
            {parts.map((p) => (
              <div key={p.key} className="db-tech-row" data-tip={why(p.key)} data-tip-title={LABEL[p.key]}>
                <span className="dot" data-status={STATUS[p.key]} />
                <span className="ellipsis">{p.label}</span><span className="spacer" /><span className="db-num">{fmtInt(p.n)}</span>
                <span className="db-tech-pct">{Math.round((p.n / total) * 100) + "%"}</span>
              </div>
            ))}
          </div>
        </>}
      </div>
    </article>
  );
}

/* ====================== Reyting ====================== */
const RANK_BY: Record<string, { val: (c: RankItem) => number; main: (c: RankItem) => string; note: (c: RankItem) => string }> = {
  offline_time: { val: (c) => c.offline_seconds, main: (c) => fmtDur(c.offline_seconds), note: (c) => "ishlash ulushi " + fmtPct(c.uptime_pct) },
  outages: { val: (c) => c.outages, main: (c) => fmtInt(c.outages) + " marta", note: (c) => "ishlamagan vaqt — " + fmtDur(c.offline_seconds) },
  blips: { val: (c) => c.blips, main: (c) => fmtInt(c.blips) + " marta", note: (c) => "uzilish: " + fmtInt(c.outages) },
  stalls: { val: (c) => c.stalls, main: (c) => fmtInt(c.stalls) + " marta", note: (c) => "ishlash ulushi " + fmtPct(c.uptime_pct) },
};
const RANK_MODES = [
  ["offline_time", "Ishlamagan", "Ishlamagan vaqt boʻyicha"], ["outages", "Uzilish", "Uzilishlar soni boʻyicha"],
  ["blips", "Qisqa uzilish", "Qisqa uzilishlar soni boʻyicha"], ["stalls", "Toʻxtash", "Tasvir toʻxtashlari soni boʻyicha"],
] as const;

function RankingCard({ days }: { days: Days }) {
  const t = useT();
  const go = useDashNav();
  const [by, setBy] = useState<string>("offline_time");
  const rq = useRanking(days, by, 25);
  const q = view(rq);
  // Saralash almashganda eski ro'yxat ko'rsatilmaydi (v3: skeleton).
  const data = q.d && q.d.by === by ? q.d : rq.isPlaceholderData ? null : q.d;
  let body: ReactNode;
  if (q.err) body = <ErrBox err={q.err} />;
  else if (!data) body = <Loading pending><SkelBars n={6} h={14} /></Loading>;
  else if (!data.items.length) body = <Empty title="Muammoli kamera yoʻq" text="Bu davrda shu koʻrsatkich boʻyicha kamera topilmadi." />;
  else {
    const m = RANK_BY[by] || RANK_BY.offline_time;
    const max = Math.max(1, ...data.items.map(m.val));
    body = data.items.map((c, i) => {
      const st = c.state || "unknown";
      return (
        <button key={c.id} type="button" className="db-rk-row" onClick={() => go.camera(c.id)}>
          <span className="db-rk-n">{i + 1}</span>
          <span className="dot" data-status={STATUS[st]} data-tip={LABEL[st] || ""} />
          <span className="db-att-row__t"><span className="ellipsis">{c.name}</span><span className="db-att-row__s ellipsis">{t(where(c))}</span></span>
          <span className="db-rk-v"><span className="db-num">{t(m.main(c))}</span>
            <span className="db-bar"><i data-status="offline" style={{ width: Math.max(4, (m.val(c) / max) * 100).toFixed(1) + "%" }} /></span>
            <span className="db-rk-note ellipsis">{t(m.note(c))}</span></span>
        </button>
      );
    });
  }
  return (
    <article className="card db-card" id="db-rank-card">
      <CardHead title="Reyting" sub={data && data.total ? t(fmtInt(data.total) + " kamera") : ""}
        tip="Davrda eng koʻp muammo bergan kameralar. Kamera bosilsa xaritada ochiladi." />
      <div className="seg seg--sm db-att-mode" role="group" aria-label={t("Saralash")}>
        {RANK_MODES.map(([k, label, tip]) => (
          <button key={k} type="button" className={by === k ? "is-on" : ""} data-tip={tip} onClick={() => setBy(k)}>{t(label)}</button>
        ))}
      </div>
      <div className="db-body db-scroll" id="db-rank">{body}</div>
    </article>
  );
}

/* ====================== Eng uzun uzilishlar ====================== */
function LongestCard({ days }: { days: Days }) {
  const t = useT();
  const go = useDashNav();
  const q = view(useLongest(days));
  const when = (iso: string) => (days === 1 ? hhmm(iso) : t(dayLabel(new Date(iso))) + " " + hhmm(iso));
  let body: ReactNode;
  if (q.err) body = <ErrBox err={q.err} />;
  else if (!q.d) body = <Loading pending={q.pending}><SkelBars n={6} h={14} /></Loading>;
  else if (!q.d.items.length) body = <Empty title="Uzilish yoʻq" text="Bu davrda uzilish qayd etilmagan." />;
  else body = q.d.items.map((o: OutageItem, i) => (
    <button key={o.camera_id + ":" + o.start + ":" + i} type="button" className="db-att-row" onClick={() => go.camera(o.camera_id)}
      data-tip={when(o.start) + " → " + (o.open ? t("hozirgacha") : when(o.end || o.start))}>
      <span className="dot" data-status={o.open ? "offline" : "disabled"} />
      <span className="db-att-row__t"><span className="ellipsis">{o.name}</span><span className="db-att-row__s ellipsis">{t(where(o))}</span></span>
      {o.open ? <span className="db-tag db-tag--err">{t("Davom etmoqda")}</span> : <span className="db-att-row__s db-long-when">{when(o.start)}</span>}
      <span className={"db-att-row__d " + (o.open ? "t-error" : "")}>{t(fmtDur(o.seconds))}</span>
    </button>
  ));
  return (
    <article className="card db-card" id="db-long-card">
      <CardHead title="Eng uzun uzilishlar" sub={q.d && !q.err ? t("eng uzuni birinchi") : ""}
        tip="Davrdagi eng uzun uzilishlar. Faqat kuzatilgan qismi hisoblanadi." />
      <div className="db-body db-scroll" id="db-long">{body}</div>
    </article>
  );
}

/* ====================== Ochilish vaqti ====================== */
function OpenTimesCard() {
  const t = useT();
  const { byId } = useCameras();
  const q = view(useOpenMetrics());
  const m = q.d;
  const sec = (ms: number) => (ms / 1000).toFixed(1).replace(".", ",") + " s";
  let rows: { name: string; ms: number; id: number; tip: string }[] = [];
  let sub = "";
  if (m && m.items && m.items.length) {
    rows = m.items.map((x) => ({ name: x.name, ms: x.median_ms, id: (x.camera_id || x.id) as number,
      tip: x.n + " ochilish · oxirgisi " + sec(x.last_ms) + (x.max_ms ? " · eng sekini " + sec(x.max_ms) : "") + (x.transport ? " · " + x.transport : "") }));
    sub = "mediana " + sec(m.p50_ms) + (m.p95_ms ? " · 95 foizi — " + sec(m.p95_ms) + " ichida" : "") + " · " + fmtInt(m.opens) + " ochilish";
  } else {
    rows = [...(openTimes.byCam as Map<number, number>).entries()].map(([id, ms]) => ({ cam: byId.get(id), ms, id }))
      .filter((r) => r.cam).map((r) => ({ name: r.cam!.name, ms: r.ms, id: r.id, tip: "shu seans" }));
    if (rows.length) sub = "shu seans oʻlchovlari";
  }
  let body: ReactNode;
  if (!m && !q.err && !rows.length) body = <Loading pending={q.pending}><SkelBars n={4} h={14} /></Loading>;
  else if (!rows.length) {
    body = q.err && !is404(q.err) ? <AlertBox />
      : <Empty title="Hali oʻlchov yoʻq" text="Kamera oqimi ochilganda birinchi kadrgacha vaqt shu yerda koʻrinadi." />;
  } else {
    rows = rows.sort((a, b) => b.ms - a.ms).slice(0, 12);
    const max = rows[0].ms || 1;
    body = rows.map((r) => {
      const s = r.ms / 1000;
      const st = s <= 2 ? "online" : s <= 5 ? "no-video" : "offline";
      return (
        <div key={r.id + r.name} className="db-open-row" data-tip={r.tip}>
          <span className="ellipsis">{r.name}</span>
          <div className="db-bar"><i data-status={st} style={{ width: Math.max(4, (r.ms / max) * 100).toFixed(1) + "%" }} /></div>
          <span className="db-num">{t(sec(r.ms))}</span>
        </div>
      );
    });
  }
  return (
    <article className="card db-card" id="db-open-card">
      <CardHead title="Ochilish vaqti" sub={t(sub)}
        tip="Oqim ochilishidan birinchi kadrgacha ketgan vaqt: har kameraning oxirgi 10 ochilishi medianasi. Sekinlari yuqorida." />
      <div className="db-body db-scroll" id="db-open">{body}</div>
    </article>
  );
}

/* ====================== Texnik kesim ====================== */
function TechCard({ days }: { days: Days }) {
  const t = useT();
  const { cameras, isPending } = useCameras();
  const v = view(useVendors(days));
  const total = cameras.length;
  const parts = useMemo(() => {
    const isH264 = (c: Camera) => /h264|avc/i.test(c.codec || ""), isH265 = (c: Camera) => /h265|hevc/i.test(c.codec || "");
    const p: [string, number, string][] = [
      ["H.265 → H.264 oʻgirish", cameras.filter((c) => c.transcode).length, "db-k-brand"],
      ["H.264 (oʻgirishsiz)", cameras.filter((c) => isH264(c) && !c.transcode).length, "db-k-brand2"],
      ["H.265 (oʻgirilmaydi)", cameras.filter((c) => isH265(c) && !c.transcode).length, "db-k-warn"],
      ["Doim tayyor rejim", cameras.filter((c) => c.always_on).length, "db-k-muted"],
    ];
    if (v.d?.vendors) p.push(["RTSP UDP orqali", v.d.vendors.reduce((s, x) => s + (x.udp || 0), 0), "db-k-muted"]);
    return p;
  }, [cameras, v.d]);
  const pct = (n: number) => Math.round((n / total) * 100);
  return (
    <article className="card db-card" id="db-tech-card">
      <CardHead title="Texnik kesim" sub={t("kodek va rejim")}
        tip="Kodek va ishlash rejimi. H.265 → H.264 — server oqimni oʻgiradi (protsessor yuklanadi)." />
      <div className="db-body" id="db-tech">
        {!total ? (isPending ? null : <Empty title="Kamera yoʻq" />) : <>
          <div className="db-stack" role="img" aria-label={t("Kodeklar taqsimoti")}>
            {parts.slice(0, 3).filter((p) => p[1]).map((p) => (
              <i key={p[0]} className={p[2]} style={{ flex: p[1] + " 1 0px" }} data-tip={p[0] + ": " + p[1] + " kamera"} />
            ))}
          </div>
          <div className="db-tech-rows">
            {parts.map((p) => (
              <div key={p[0]} className="db-tech-row"><i className={"db-key " + p[2]} /><span className="ellipsis">{t(p[0])}</span>
                <span className="spacer" /><span className="db-num">{fmtInt(p[1])}</span><span className="db-tech-pct">{pct(p[1]) + "%"}</span></div>
            ))}
          </div>
        </>}
      </div>
    </article>
  );
}

/* ====================== Maʼlumot sifati ====================== */
const QUALITY: [string, string, string][] = [
  ["no_location", "Koordinatasi yoʻq", "Xaritada koʻrinmaydi, hudud koordinatadan aniqlanmaydi."],
  ["no_region", "Hududi aniqlanmagan", "Hududlar hisobotiga kirmaydi — hududni qoʻlda tanlang."],
  ["no_km", "Km / piket yoʻq", "Liniya holatida koʻrinmaydi. NVR kanallari uchun odatiy hol."],
  ["no_codec", "Kodek nomaʼlum", "Kamera javob bermagan — pasport tekshiruvi fonda qayta urinadi."],
  ["never_seen", "Hech ulanmagan", "IP manzil yoki parol notoʻgʻri boʻlishi mumkin — joyida tekshiring."],
  ["no_model", "Qurilma modeli nomaʼlum", "Qurilma pasport bermaydi — proshivka yangilanishini kuzatib boʻlmaydi."],
  ["probe_failed", "Pasport tekshiruvi xatosi", "Sabab: parol notoʻgʻri, RTSP yoʻli notoʻgʻri yoki tarmoq javob bermaydi."],
  ["vendor_mismatch", "Marka modelga mos emas", "Import paytida marka notoʻgʻri taxmin qilingan — markani tuzating."],
  ["km_name_mismatch", "Nomdagi km mos emas", "Nomni “3428/1 km” koʻrinishiga keltiring yoki km qiymatini tuzating."],
];
/** probe_failed.detail prefiksi → sabab */
const CAUSE: Record<string, string> = { parol: "parol", oqim: "oqim yoʻli", tarmoq: "tarmoq" };

function QualityCard() {
  const t = useT();
  const go = useDashNav();
  const { user } = useAuth();
  const admin = user?.role === "admin";
  const q = view(useQuality());
  const [qOpen, setQOpen] = useState<string | null>(null);
  const d = q.d;
  const checks = d ? QUALITY.filter(([k]) => d[k] || (k.indexOf("mismatch") < 0 && k !== "probe_failed")) : [];
  const total = checks.reduce((s, [k]) => s + (d?.[k]?.count || 0), 0);

  const activate = (k: string, label: string) => {
    const c = d?.[k];
    if (!c || !c.count) return;
    if (!admin) { setQOpen((o) => (o === k ? null : k)); return; }
    go.admin({ quality: k, ids: c.items.map((x) => x.id), label, count: c.count });
  };
  const causes = (k: string) => {
    const c = d?.[k];
    if (k !== "probe_failed" || !c) return "";
    const n: Record<string, number> = {};
    c.items.forEach((x) => { const cs = CAUSE[String(x.detail || "").split(":")[0].trim()] || "boshqa"; n[cs] = (n[cs] || 0) + 1; });
    return Object.entries(n).map(([cs, v]) => t(cs) + " " + v).join(" · ");
  };

  let body: ReactNode;
  if (q.err) body = <ErrBox err={q.err} />;
  else if (!d) body = <Loading pending={q.pending}><SkelBars n={6} h={16} /></Loading>;
  else body = (
    <div className="db-q-grid">
      {checks.map(([k, label, tip]) => {
        const c = d[k]?.count || 0;
        const go_ = c > 0;
        const isOpen = !admin && qOpen === k && !!c;
        const sub = causes(k);
        const items = d[k]?.items || [];
        return (
          <Fragment key={k}>
            <div className={"db-q-row" + (go_ ? " is-link" : "") + (isOpen ? " is-open" : "")} data-k={k}
              role={go_ ? "button" : undefined} tabIndex={go_ ? 0 : undefined} aria-expanded={go_ && !admin ? isOpen : undefined}
              onClick={(e) => { if ((e.target as Element).closest(".infotip")) return; activate(k, label); }}
              onKeyDown={(e) => { if (go_ && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); activate(k, label); } }}>
              <span className={"db-q-ic " + (c ? "t-warning" : "t-success")}><Icon name={c ? "triangle-exclamation" : "circle-check"} size="sm" /></span>
              <span className="db-q-label"><span>{t(label)}</span>{sub && <span className="db-q-cause">{sub}</span>}</span>
              <InfoTip text={tip} />
              <span className="spacer" /><span className="db-num">{fmtInt(c)}</span>
              <span className="db-q-chev">{go_ && <Icon name={admin ? "chevron-right" : isOpen ? "chevron-up" : "chevron-down"} size="sm" />}</span>
            </div>
            {isOpen && (
              <div className="db-q-list">
                {items.map((x) => (
                  <button key={x.id} type="button" className="db-q-cam" data-tip={x.detail || undefined} onClick={() => go.camera(x.id)}>
                    {x.name}<i>{t(x.region || "")}</i>
                  </button>
                ))}
                {c > items.length && <span className="db-q-more">{t("va yana " + fmtInt(c - items.length) + " ta")}</span>}
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
  return (
    <article className="card db-card" id="db-q-card">
      <CardHead title="Maʼlumot sifati" sub={d && !q.err ? t(fmtInt(total) + " kamchilik · " + checks.length + " tekshiruv") : ""}
        tip="Chala yoki notoʻgʻri yozuvlar. Qator bosilsa kameralar roʻyxati ochiladi (administratorga — Boshqaruv boʻlimida)." />
      <div className="db-body" id="db-quality">{body}</div>
    </article>
  );
}
