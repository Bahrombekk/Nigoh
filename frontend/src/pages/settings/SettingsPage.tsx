/* pages/settings/SettingsPage.tsx — "Sozlamalar" sahifasi (Figma 06): qobiq va marshrut.
   v3 settings/settings.js + index.html #settings-view dan.
   .page--sheet > .sheet.sx: sarlavha "Sozlamalar" + Sysbar, chapda SettingsNav (guruhlar:
   Sozlamalar / Boshqaruv / Tizim; joriy bo'lim — aria-current), o'ngda panel (.sx-panel).
   Marshrut #/settings/<bo'lim>:
     umumiy · xavfsizlik · kuzatuv · foydalanuvchilar · guruhlar · tizim · loglar · jurnal
   Eski nomlar ham ishlaydi (general, site, access, security, monitoring, users, groups, status,
   system, logs, audit) — sysbar holat tugmasi /settings/status ochadi.
   Bo'limlar: SiteForm.tsx (Umumiy, Kirish va xavfsizlik, Kuzatuv), UsersSection.tsx,
   GroupsSection.tsx (+GroupDialog), SystemSection.tsx, LogsSection.tsx (Loglar, Jurnal).
   Qoidalar:
     - Faqat admin (App.tsx Guard).
     - Oxirgi ochilgan bo'lim brauzerda eslab qolinadi (try/catch).
     - Saqlanmagan qoralama bo'lim almashganda (va sahifadan chiqib qaytganda) yo'qolmaydi;
       qoralama bor ekan #settings-view da .is-dirty (profil "Chiqish" ogohlantiradi) va
       beforeunload ogohlantirishi; pastda "N ta oʻzgarish saqlanmagan" paneli. */
import "@/styles/settings.css";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useT } from "@/i18n/I18nProvider";
import { PageSheet } from "@/layout/AppShell";
import { Sysbar } from "@/layout/Sysbar";
import { Icon } from "@/components/Icon";
import { Button, cx } from "@/components/ui";
import { useToast } from "@/components/overlays";
import { usePutSettings, useSiteSettings } from "./queries";
import { FORM_SECTIONS, SiteForm, validSetting, type Draft } from "./SiteForm";
import { UsersSection } from "./UsersSection";
import { GroupsSection } from "./GroupsSection";
import { SystemSection } from "./SystemSection";
import { AuditSection, CATEGORIES, LOG_FILTER0, LogsSection, type LogFilter } from "./LogsSection";

export const SECTIONS = ["umumiy", "xavfsizlik", "kuzatuv", "foydalanuvchilar", "guruhlar", "tizim", "loglar", "jurnal"];
const ALIAS: Record<string, string> = {
  general: "umumiy", site: "umumiy", access: "xavfsizlik", security: "xavfsizlik", monitoring: "kuzatuv",
  users: "foydalanuvchilar", groups: "guruhlar", status: "tizim", system: "tizim", logs: "loglar", audit: "jurnal",
};
const KEY = "nigoh.settings-tab";
const TITLE: Record<string, string> = { umumiy: "Umumiy", xavfsizlik: "Kirish va xavfsizlik", kuzatuv: "Kuzatuv" };
const NAV: { h: string; items: [string, string, string][] }[] = [
  { h: "Sozlamalar", items: [["umumiy", "gear", "Umumiy"], ["xavfsizlik", "lock", "Kirish va xavfsizlik"], ["kuzatuv", "eye", "Kuzatuv"]] },
  { h: "Boshqaruv", items: [["foydalanuvchilar", "user", "Foydalanuvchilar"], ["guruhlar", "grid", "Kamera guruhlari"]] },
  { h: "Tizim", items: [["tizim", "server", "Tizim holati"], ["loglar", "list", "Tizim jurnali"], ["jurnal", "clock", "Oʻzgarishlar jurnali"]] },
];

function resolve(sub: string | undefined): string {
  let s = sub ? ALIAS[sub] || sub : "";
  if (!SECTIONS.includes(s)) {
    try { s = localStorage.getItem(KEY) || ""; } catch { s = ""; }
    s = ALIAS[s] || s;
    if (!SECTIONS.includes(s)) s = "umumiy";
  }
  return s;
}

// Sahifadan chiqib qaytganda ham saqlanadigan holat (v3 — sahifa obyekti yashab turardi).
let keptDraft: Draft = {};
let keptLogs: LogFilter = LOG_FILTER0;
let keptUserQ = "";

export default function SettingsPage() {
  const t = useT();
  const nav = useNavigate();
  const toast = useToast();
  const { sub } = useParams();
  const section = resolve(sub);
  const settingsQ = useSiteSettings();
  const put = usePutSettings();
  const [draft, setDraftState] = useState<Draft>(keptDraft);
  const [logs, setLogsState] = useState<LogFilter>(keptLogs);
  const [userQ, setUserQState] = useState(keptUserQ);
  const navRef = useRef<HTMLElement>(null);
  const setDraft = (d: Draft) => { keptDraft = d; setDraftState(d); };
  const setLogs = (f: LogFilter) => { keptLogs = f; setLogsState(f); };
  const setUserQ = (v: string) => { keptUserQ = v; setUserQState(v); };

  // Marshrut: taxallus / noma'lum → kanonik nom; oxirgi bo'lim eslab qolinadi.
  useEffect(() => {
    if (sub !== section) nav("/settings/" + section, { replace: true });
    try { localStorage.setItem(KEY, section); } catch { /* xotira yopiq */ }
    const on = navRef.current?.querySelector<HTMLElement>('.sx-nav__item[data-st="' + section + '"]');
    if (on && innerWidth <= 1023) on.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [sub, section, nav]);

  useEffect(() => { if (settingsQ.error) toast((settingsQ.error as Error).message, { tone: "error" }); }, [settingsQ.error, toast]);

  // Qoralama: .is-dirty va beforeunload
  const n = Object.keys(draft).length;
  useEffect(() => {
    const el = document.getElementById("settings-view");
    el?.classList.toggle("is-dirty", n > 0);
    if (!n) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    addEventListener("beforeunload", h);
    return () => removeEventListener("beforeunload", h);
  }, [n]);

  const settings = settingsQ.data;
  const def = (k: string) => settings?.find((s) => s.key === k);
  const invalid = Object.keys(draft).some((k) => !validSetting(def(k), draft[k]));

  async function save() {
    const keys = Object.keys(draft);
    if (!keys.length) return;
    const values: Draft = {};
    keys.forEach((k) => { const v = draft[k]; values[k] = typeof v === "string" ? v.trim() : v; });
    try { await put.mutateAsync(values); }
    catch (e) { toast((e as Error).message, { tone: "error" }); return; }
    setDraft({});
    toast("Sozlamalar saqlandi");
  }

  const go = (sec: string) => nav("/settings/" + sec);
  const goLogs = (category: string, level: string) => {
    setLogs({ ...logs, cat: CATEGORIES.some(([v]) => v === category) ? category : logs.cat, level: level || "" });
    go("loglar");
  };

  const onForm = FORM_SECTIONS.includes(section);
  return (
    <PageSheet id="settings-view" className="sx">
      <header className="page-head">
        <h1 className="page-head__title">{t("Sozlamalar")}</h1>
        <span className="spacer" />
        <div className="sx-sysbar"><Sysbar /></div>
      </header>

      <div className="sx-body">
        <nav className="sx-nav" aria-label={t("Sozlamalar boʻlimlari")} ref={navRef}>
          {NAV.map((g) => (
            <div className="sx-nav__group" key={g.h}>
              <div className="overline sx-nav__h">{t(g.h)}</div>
              {g.items.map(([id, icon, label]) => (
                <button key={id} type="button" data-st={id} className={cx("sx-nav__item", section === id && "is-on")}
                  aria-current={section === id ? "page" : undefined} onClick={() => go(id)}>
                  <Icon name={icon} />{t(label)}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sx-panel">
          {onForm && (
            <div className="sx-sec" data-st={section}>
              <div className="sx-head"><h2 className="heading-lg">{t(TITLE[section])}</h2></div>
              <div className="sx-scroll">
                <SiteForm section={section} settings={settings} draft={draft} setDraft={setDraft} />
              </div>
            </div>
          )}
          {section === "foydalanuvchilar" && <UsersSection q={userQ} setQ={setUserQ} />}
          {section === "guruhlar" && <GroupsSection />}
          {section === "tizim" && <SystemSection onLogs={goLogs} />}
          {section === "loglar" && <LogsSection f={logs} setF={setLogs} />}
          {section === "jurnal" && <AuditSection />}

          {n > 0 && onForm && (
            <div className="sx-bar">
              <span className="dot dot--brand" />
              <span className="label-sm t-brand" id="sx-bar-n">{t(n + " ta oʻzgarish saqlanmagan")}</span>
              <span className="spacer" />
              <Button variant="tertiary" onClick={() => setDraft({})}>{t("Bekor qilish")}</Button>
              <Button variant="primary" disabled={invalid || put.isPending} onClick={save}>{t("Saqlash")}</Button>
            </div>
          )}
        </div>
      </div>
    </PageSheet>
  );
}
