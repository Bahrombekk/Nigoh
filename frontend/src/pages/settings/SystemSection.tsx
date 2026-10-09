/* pages/settings/SystemSection.tsx — Tizim holati (06.04). v3 settings/system.js dan.
   Kartalar: Video xizmati (MediaMTX, ish vaqti) · Holat tekshiruvi (onlayn / tekshirilgan) ·
   Maʼlumotlar bazasi (versiya, jadval, hajm) · API · Tarmoq (kechikish) · Versiya (yangilanish).
   Disk nazorati hozircha o'chiq (backend app/system_state.DISK_MONITORING) — disk kartasi yo'q.
   Muammo bo'lsa (warn/error) — Alert ("Koʻrish" → Tizim jurnali, toifa va daraja bilan).
   Ochiq turganda har 30 s yangilanadi (sahifa yashirin bo'lsa — yo'q); "Yangilash" — darhol. */
import { useEffect, useState } from "react";
import { useT } from "@/i18n/I18nProvider";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui";
import { useToast } from "@/components/overlays";
import { useSystemStatus, type StatusBundle } from "./queries";
import { durText, mbText } from "./util";

type SvcState = "ok" | "warn" | "error" | "unknown";
const DOT: Record<SvcState, string> = { ok: "online", warn: "no-video", error: "offline", unknown: "unknown" };
const DOT_LABEL: Record<SvcState, string> = { ok: "Ishlamoqda", warn: "Diqqat", error: "Nosoz", unknown: "Nomaʼlum" };
interface Card { key: string; icon: string; name: string; state: SvcState; value: string; meta: string; metaTone?: string }
interface Issue { tone: "error" | "warning"; title: string; text?: string; logs?: string; level?: string }

function agoShort(iso: string | null | undefined) {
  if (!iso) return "hali boʻlmagan";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return Math.round(s) + " s oldin";
  if (s < 3600) return Math.round(s / 60) + " daq oldin";
  return Math.round(s / 3600) + " soat oldin";
}

function build({ st, db, sys }: StatusBundle): { cards: Card[]; issues: Issue[] } {
  const cards: Card[] = [], issues: Issue[] = [];
  if (!st) return { cards, issues };
  const svc: Record<string, { state: SvcState; detail?: string }> = {};
  ((sys && sys.services) || []).forEach((s) => { svc[s.key] = s; });

  // 1. MediaMTX
  const mm = st.mediamtx;
  const mmOk = typeof mm === "object" && mm !== null ? mm.ok !== false && mm.available !== false : !!mm;
  const uptime = (mm && typeof mm === "object" ? mm.uptime_s : null) ?? st.mediamtx_uptime_s ?? null;
  const stalled = (st.stalled || []).length;
  const nodes = st.nodes || [];
  const offNodes = nodes.filter((n) => n.status === "offline").length;
  const mmState: SvcState = svc.mediamtx ? svc.mediamtx.state : !mmOk ? "error" : stalled || offNodes ? "warn" : "ok";
  cards.push({ key: "mediamtx", icon: "video", name: "Video xizmati (MediaMTX)", state: mmState,
    value: mmOk ? "Ishlamoqda" : "Javob yoʻq",
    meta: !mmOk ? "Jonli oqim ochilmaydi" : uptime != null ? "Ish vaqti " + durText(uptime)
      : stalled ? stalled + " ta oqimda tasvir toʻxtagan" : nodes.reduce((a, n) => a + (n.ready || 0), 0) + " ta oqim ochiq" });
  if (!mmOk) issues.push({ tone: "error", title: "Video xizmati (MediaMTX) javob bermayapti", text: "Jonli tasvir ochilmaydi — xizmatni tekshiring", logs: "mediamtx", level: "ERROR" });
  else if (stalled) issues.push({ tone: "warning", title: stalled + " ta ochiq oqimda tasvir toʻxtagan", text: "Kamera yoki tarmoqni tekshirish kerak", logs: "camera", level: "WARNING" });
  else if (offNodes) issues.push({ tone: "warning", title: offNodes + " ta media tugun javob bermayapti", text: "Shu tugundagi kameralar ochilmaydi", logs: "mediamtx" });

  // 2. Holat kuzatuvi
  const h = st.health || {};
  const hState: SvcState = svc.health ? svc.health.state : !h.at ? "warn" : (Date.now() - new Date(h.at).getTime()) / 1000 > 1800 ? "error" : "ok";
  cards.push({ key: "health", icon: "eye", name: "Holat tekshiruvi", state: hState,
    value: h.checked != null ? (h.online ?? 0) + " / " + h.checked : "—",
    meta: "Oxirgi tekshiruv " + agoShort(h.at) });
  if (hState === "error") issues.push({ tone: "error", title: "Holat tekshiruvi toʻxtagan", text: "Kameralar holati yangilanmayapti", logs: "camera" });

  // 3. Baza
  const dbState: SvcState = svc.db ? svc.db.state : !db ? "unknown" : db.up_to_date === false ? "warn" : "ok";
  const dbMb = db && db.size_bytes != null ? db.size_bytes / 1048576 : st.disk && st.disk.db_mb;
  cards.push({ key: "db", icon: "server", name: "Maʼlumotlar bazasi", state: dbState,
    value: db ? "PostgreSQL " + String(db.server_version || "").split(" ")[0] : "—",
    meta: db ? (db.tables ? db.tables.length + " jadval · " : "") + mbText(dbMb) +
      (db.up_to_date === false ? " · yangilash kerak" : "") : (svc.db && svc.db.detail) || "Maʼlumot yoʻq" });
  if (dbState === "warn" || dbState === "error") issues.push({ tone: dbState === "error" ? "error" : "warning",
    title: dbState === "error" ? "Baza javob bermayapti" : db && db.up_to_date === false ? "Baza sxemasi eski" : "Baza sekin javob bermoqda",
    text: (svc.db && svc.db.detail) || "Server jurnalini koʻring", logs: "database" });

  // 4. API (disk nazorati hozircha o'chiq — 2026-10-08 qarori; disk kartasi yo'q)
  const apiSvc = svc.api;
  cards.push({ key: "api", icon: "server", name: "API", state: apiSvc ? apiSvc.state : "ok",
    value: apiSvc && apiSvc.state !== "ok" ? "Muammo bor" : "Ishlamoqda",
    meta: (apiSvc && apiSvc.detail) || "Soʻrovlarga javob bermoqda" });

  // 5. Tarmoq
  const lat = (st.network || {}).latency_ms ?? null;
  const nState: SvcState = svc.network ? svc.network.state : lat == null ? "unknown" : lat > 200 ? "warn" : "ok";
  cards.push({ key: "network", icon: "wifi", name: "Tarmoq", state: nState,
    value: nState === "unknown" ? "—" : nState === "ok" ? "Barqaror" : nState === "warn" ? "Sekin" : "Uzilish bor",
    meta: lat != null ? "Kechikish " + Math.round(lat) + " ms" : (svc.network && svc.network.detail) || "Oʻlchov hali yoʻq" });
  if (nState === "warn" || nState === "error") issues.push({ tone: nState === "error" ? "error" : "warning",
    title: nState === "error" ? "Kamera tarmogʻida uzilish" : "Kamera tarmogʻi sekin",
    text: (svc.network && svc.network.detail) || (lat != null ? "Oʻrtacha kechikish " + Math.round(lat) + " ms" : ""), logs: "camera" });

  // 6. Versiya
  const up = st.update || null;
  const hasNew = !!(up && up.latest && up.latest !== (up.current || st.version));
  cards.push({ key: "version", icon: "circle-check", name: "Versiya", state: hasNew ? "warn" : up ? "ok" : "unknown",
    value: "v" + (st.version || (up && up.current) || "—"),
    meta: hasNew ? "Yangi versiya: v" + up!.latest : up ? "Yangilanish yoʻq" : "Yangilanish tekshirilmaydi",
    metaTone: hasNew ? "brand" : "" });

  const order = { error: 0, warning: 1 };
  issues.sort((a, b) => order[a.tone] - order[b.tone]);
  return { cards, issues: issues.slice(0, 3) };
}

function AlertRow({ i, onLogs }: { i: Issue; onLogs: (category: string, level: string) => void }) {
  const t = useT();
  return (
    <div className={"alert alert--" + i.tone} role={i.tone === "error" ? "alert" : undefined}>
      <Icon name={i.tone === "error" ? "circle-exclamation" : "triangle-exclamation"} size="sm" />
      <div className="alert__body">
        <span className="alert__title">{t(i.title)}</span>
        {i.text && <span className="alert__text">{t(i.text)}</span>}
      </div>
      {i.logs != null && <Button variant="tertiary" size="sm" onClick={() => onLogs(i.logs!, i.level || "")}>{t("Koʻrish")}</Button>}
    </div>
  );
}

export function SystemSection({ onLogs }: { onLogs: (category: string, level: string) => void }) {
  const t = useT();
  const toast = useToast();
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const h = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, []);
  const q = useSystemStatus(visible);
  const [manual, setManual] = useState(false);
  useEffect(() => { if (q.data?.err) toast(q.data.err, { tone: "error" }); }, [q.data, toast]);

  const refresh = async () => { setManual(true); await q.refetch(); setManual(false); };
  const data = q.data;
  const { cards, issues } = data ? build(data) : { cards: [], issues: [] };

  return (
    <div className="sx-sec" data-st="tizim">
      <div className="sx-head">
        <h2 className="heading-lg">{t("Tizim holati")}</h2>
        <span className="body-sm t-tertiary">{t("Server, video oqim, baza va disk")}</span>
        <span className="spacer" />
        <Button variant="secondary" icon="rotate-cw" disabled={manual} onClick={refresh}>{t("Yangilash")}</Button>
      </div>
      <div className="sx-scroll">
        <div className="sx-services">
          {!data ? [0, 1, 2, 3, 4, 5].map((i) => (
            <div className="sx-svc" key={i}>
              <span className="skeleton" style={{ height: 12, width: "60%" }} />
              <span className="skeleton" style={{ height: 18, width: "40%" }} />
              <span className="skeleton" style={{ height: 10, width: "70%" }} />
            </div>
          )) : cards.map((c) => (
            <div className="sx-svc" data-svc={c.key} key={c.key}>
              <div className="sx-svc__head">
                <Icon name={c.icon} />
                <span className="label-sm t-secondary ellipsis">{t(c.name)}</span>
                <span className="spacer" />
                <span className="dot" data-status={DOT[c.state || "unknown"]} role="img" aria-label={t(DOT_LABEL[c.state] || "Nomaʼlum")} />
              </div>
              <div className="numeric-md ellipsis">{t(c.value)}</div>
              <div className={"body-xs " + (c.metaTone ? "t-" + c.metaTone : "t-tertiary") + " ellipsis"}>{t(c.meta)}</div>
            </div>
          ))}
        </div>
        <div className="sx-alerts">
          {data && !data.st
            ? <AlertRow i={{ tone: "error", title: "Holatni olib boʻlmadi", text: "Server javob bermadi — keyinroq qayta urinib koʻring" }} onLogs={onLogs} />
            : issues.map((i) => <AlertRow key={i.title} i={i} onLogs={onLogs} />)}
        </div>
      </div>
    </div>
  );
}
