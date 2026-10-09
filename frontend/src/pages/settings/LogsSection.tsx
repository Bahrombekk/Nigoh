/* pages/settings/LogsSection.tsx — Tizim jurnali (06.07) va Oʻzgarishlar jurnali (06.08).
   v3 settings/logs.js dan.
   Tizim jurnali: daraja Segmented "Hammasi / Xato / Ogohlantirish" (sonlari /logs/summary dan,
   tanlangan toifa va davr bo'yicha) + toifa, davr, qidiruv (300 ms). Qator: vaqt (mono) · daraja
   tegi · xizmat · xabar; bosilsa — to'liq tafsilot (matn belgilansa — yo'q).
   Jurnal: avatar + "admin oʻzgartirdi — Holat tekshiruvi oraligʻi · 60 → 45 s" + vaqt; bosilsa —
   barcha o'zgargan maydonlar va IP.
   Filtrlar holati SettingsPage'da (bo'lim almashganda saqlanadi; Tizim holati "Koʻrish" qo'yadi). */
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useT } from "@/i18n/I18nProvider";
import { EmptyState, cx } from "@/components/ui";
import { useToast } from "@/components/overlays";
import { api } from "@/lib/api";
import { sk, useAudit, type AuditItem, type LogsRes, type LogsSummary } from "./queries";
import { clockText, initials, useDebounced, whenText } from "./util";
import { SxSearch } from "./SxSearch";

export const CATEGORIES: [string, string][] = [["camera", "Kamera"], ["app", "Ilova"], ["mediamtx", "MediaMTX"], ["security", "Xavfsizlik"],
  ["database", "Baza"], ["stats", "Statistika"], ["access", "HTTP soʻrovlar"], ["errors", "Barcha xatolar"]];
const LV_TAG: Record<string, string> = { ERROR: "error", CRITICAL: "error", WARNING: "warn", WARN: "warn" };
const fmtN = (n: number) => Number(n || 0).toLocaleString("ru-RU").replace(/,/g, " ");

export interface LogFilter { cat: string; hours: string; level: string; q: string }
export const LOG_FILTER0: LogFilter = { cat: "camera", hours: "24", level: "", q: "" };

export function LogsSection({ f, setF }: { f: LogFilter; setF: (f: LogFilter) => void }) {
  const t = useT();
  const toast = useToast();
  const q = useDebounced(f.q.trim(), 300);
  const [open, setOpen] = useState<Set<number>>(new Set());

  const qs = new URLSearchParams({ category: f.cat, hours: f.hours, limit: "300" });
  if (f.level) qs.set("level", f.level);
  if (q) qs.set("q", q);
  const logsQ = useQuery({
    queryKey: sk.logs(qs.toString()),
    queryFn: () => api<LogsRes>("/api/admin/logs?" + qs),
    placeholderData: keepPreviousData,
  });
  const hours = Math.max(1, Math.round(Number(f.hours)));
  const sumQ = useQuery({
    queryKey: sk.summary(hours),
    queryFn: () => api<LogsSummary>("/api/admin/logs/summary?hours=" + hours).catch(() => null),
  });
  useEffect(() => { if (logsQ.error) toast((logsQ.error as Error).message, { tone: "error" }); }, [logsQ.error, toast]);
  useEffect(() => { setOpen(new Set()); }, [logsQ.data]);

  // Daraja sonlari
  const sum = sumQ.data;
  const c: Record<string, number> | null = sum && sum.categories ? (f.cat === "errors"
    ? Object.values(sum.categories).reduce<Record<string, number>>((a, x) => ({ ERROR: (a.ERROR || 0) + (x.ERROR || 0) + (x.CRITICAL || 0) }), {})
    : sum.categories[f.cat] || {}) : null;
  const all = c ? Object.values(c).reduce((a, b) => a + b, 0) : null;
  const val: Record<string, number | null> = { "": all, ERROR: c ? (c.ERROR || 0) + (c.CRITICAL || 0) : null, WARNING: c ? c.WARNING || 0 : null };
  const LEVELS: [string, string][] = [["", "Hammasi"], ["ERROR", "Xato"], ["WARNING", "Ogohlantirish"]];

  const res = logsQ.data;
  const skip = new Set(["ts", "level", "category", "service", "event", "msg", "message"]);

  return (
    <div className="sx-sec" data-st="loglar">
      <div className="sx-head">
        <h2 className="heading-lg">{t("Tizim jurnali")}</h2>
        <span className="spacer" />
        <div className="sx-logtools">
          <select className="select select--sm sx-sel" aria-label={t("Toifa")} value={f.cat} onChange={(e) => setF({ ...f, cat: e.target.value })}>
            {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
          </select>
          <select className="select select--sm sx-sel" aria-label={t("Davr")} value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })}>
            <option value="1">{t("1 soat")}</option><option value="24">{t("24 soat")}</option><option value="168">{t("7 kun")}</option>
          </select>
          <SxSearch small value={f.q} onChange={(v) => setF({ ...f, q: v })} placeholder="Qidirish" label="Jurnaldan qidirish" />
          <div className="seg seg--inline seg--sm" role="group" aria-label={t("Daraja")}>
            {LEVELS.map(([lv, l]) => (
              <button key={lv} type="button" className={cx(f.level === lv && "is-on")} onClick={() => setF({ ...f, level: lv })}>
                {t(l)} <span className="seg__count">{val[lv] == null ? "" : fmtN(val[lv]!)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="sx-scroll sx-logs">
        {!res ? (
          logsQ.isPending ? (
            <div className="sx-loglist">
              {[0, 1, 2, 3, 4].map((i) => <div className="sx-log" key={i}><span className="skeleton" style={{ height: 12, width: "70%" }} /></div>)}
            </div>
          ) : null
        ) : res.items && res.items.length ? (
          <>
            <div className="sx-loglist">
              {res.items.map((r, i) => {
                const lv = String(r.level || "").toUpperCase();
                const rest = Object.entries(r).filter(([k]) => !skip.has(k))
                  .map(([k, v]) => k + "=" + (typeof v === "object" ? JSON.stringify(v) : String(v))).join("  ");
                const msg = String(r.event || r.msg || r.message || "");
                return (
                  <div key={i} className={cx("sx-log", open.has(i) && "is-open")} onClick={() => {
                    if (window.getSelection()?.toString()) return;
                    setOpen((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
                  }}>
                    <span className="sx-log__t">{clockText(r.ts)}</span>
                    <span className={cx("sx-lv", LV_TAG[lv] && "sx-lv--" + LV_TAG[lv])}>{lv === "WARNING" ? "WARN" : lv || "—"}</span>
                    <span className="sx-log__svc ellipsis">{String(r.service || r.category || "")}</span>
                    <span className="sx-log__msg">{msg}{rest && <span className="sx-log__rest"> · {rest}</span>}</span>
                  </div>
                );
              })}
            </div>
            {res.count >= res.limit && <div className="body-xs t-tertiary sx-more">{t("Oxirgi " + res.limit + " ta yozuv koʻrsatildi")}</div>}
          </>
        ) : (
          <EmptyState type="search" title="Bu davrda yozuv yoʻq" text="Toifa, davr yoki darajani oʻzgartirib koʻring" />
        )}
      </div>
    </div>
  );
}

/* ---------- O'zgarishlar jurnali ---------- */
const VERB: Record<string, string> = { create: "qoʻshdi", update: "tahrirladi", delete: "oʻchirdi", restore: "qaytardi",
  password_reset: "parolni tikladi", password: "parolini almashtirdi", bulk: "ommaviy oʻzgartirdi" };
const ENTITY: Record<string, string> = { user: "Foydalanuvchi", group: "Guruh", camera: "Kamera", settings: "Sozlamalar", wall: "Video devor" };
const SETTING_LABEL: Record<string, string> = {
  site_name: "Sayt nomi", timezone: "Vaqt zonasi", language: "Til", ui_poll_s: "Xarita va roʻyxat yangilanishi",
  notify_outage: "Uzilish haqida bildirishnoma", public_view: "Mehmon koʻrishi", session_hours: "Seans muddati",
  health_interval_s: "Holat tekshiruvi oraligʻi", stall_after_s: "Tasvir toʻxtashi chegarasi", transport_check_after_s: "Uzatish usulini tekshirish",
};
const show = (v: unknown) => (v === true ? "yoqilgan" : v === false ? "oʻchirilgan" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));

function AuditRow({ a }: { a: AuditItem }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [ent, act] = String(a.action || "").split(".");
  const verb = a.action === "settings.update" ? "oʻzgartirdi" : VERB[act] || act || a.action;
  const b = a.before || {}, f = a.after || {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(f)])].filter((k) => show(b[k]) !== show(f[k]));
  let what: string;
  if (ent === "settings") {
    what = keys.length ? keys.slice(0, 2).map((k) => (SETTING_LABEL[k] || k) + " · " +
      (k in b ? show(b[k]) + " → " : "") + show(f[k])).join("; ") + (keys.length > 2 ? " +" + (keys.length - 2) : "") : "Sozlamalar";
  } else {
    const nm = f.name || f.username || b.name || b.username || (a.entity_id ? "#" + a.entity_id : "");
    what = (ENTITY[ent] || ent || "") + (nm ? " " + String(nm) : "");
    const extra = keys.filter((k) => !["name", "username", "password"].includes(k));
    if (act === "update" && extra.length) {
      const k = extra[0];
      what += " · " + k + " " + (k in b ? show(b[k]) + " → " : "") + show(f[k]);
    }
  }
  const has = keys.length > 0;
  const toggle = () => { if (has) setOpen((o) => !o); };
  return (
    <div className={cx("sx-arow", open && "is-open")} data-has={has ? "1" : undefined}
      role={has ? "button" : undefined} tabIndex={has ? 0 : undefined} aria-expanded={has ? open : undefined}
      onClick={toggle} onKeyDown={(e) => { if (has && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggle(); } }}>
      <span className="avatar">{initials(a.actor)}</span>
      <span className="sx-arow__txt body-sm">
        <span className="t-primary">{t((a.actor || "tizim") + " " + verb)}</span>
        <span className="t-secondary">{t(" — " + what)}</span>
        {has && (
          <ul className="sx-arow__diff">
            {keys.map((k) => (
              <li key={k}><b>{t(SETTING_LABEL[k] || k)}</b>: {k in b && <><s>{t(show(b[k]))}</s> → </>}{t(k in f ? show(f[k]) : "—")}</li>
            ))}
            {a.ip && <li className="t-tertiary">IP: <span className="mono">{a.ip}</span></li>}
          </ul>
        )}
      </span>
      <span className="sx-arow__t mono-xs t-tertiary">{t(whenText(a.ts))}</span>
    </div>
  );
}

export function AuditSection() {
  const t = useT();
  const toast = useToast();
  const q = useAudit(true);
  useEffect(() => { if (q.error) toast((q.error as Error).message, { tone: "error" }); }, [q.error, toast]);
  const items = q.data;
  return (
    <div className="sx-sec" data-st="jurnal">
      <div className="sx-head"><h2 className="heading-lg">{t("Oʻzgarishlar jurnali")}</h2></div>
      <div className="sx-scroll sx-audit">
        {items && (items.length
          ? <div className="sx-alist">{items.map((a) => <AuditRow key={a.id} a={a} />)}</div>
          : <EmptyState type="history" title="Hali oʻzgarish yoʻq" text="Sozlama, foydalanuvchi va guruh oʻzgarishlari shu yerda koʻrinadi" />)}
      </div>
    </div>
  );
}
