/* pages/settings/SiteForm.tsx — sayt sozlamalari: Umumiy (06.01), Kirish va xavfsizlik (06.05),
   Kuzatuv (06.02 / 06.09). v3 settings/site.js dan.
   /api/admin/settings ro'yxatidan SettingRow qatorlari: nom + InfoTip + bitta qator meta
   ("Standart: 60 s · oraliq 30–600") + boshqaruv (Switch / Number / Select / Segmented / TextField).
     - Number/Select/Text — qoralamaga (draft, SettingsPage'da); pastdagi panel saqlaydi.
       O'zgargan qator: meta "Oʻzgartirildi: 60 s → 45 s" (brand), maydon 1.5px brand.
     - Switch — darhol qo'llanadi (Saqlash kerak emas); xato bo'lsa qaytadi.
     - Mavzu — shaxsiy (useTheme), darhol.
     - Til — server `language` bersa saytning standart tili (qoralama → Saqlash), bermasa
       shaxsiy afzallik (setLang, darhol). Til nomlari o'z yozuvida (tarjima qilinmaydi).
   Server bermagan sozlama (eski backend) — qatori chizilmaydi. */
import { useState, type ReactNode } from "react";
import { useT, useI18n, type LangId } from "@/i18n/I18nProvider";
import { useTheme, THEMES } from "@/lib/theme";
import { InfoTip, cx } from "@/components/ui";
import { useToast } from "@/components/overlays";
import { usePutSettings, type Setting } from "./queries";

export const FORM_SECTIONS = ["umumiy", "xavfsizlik", "kuzatuv"];
export type Draft = Record<string, unknown>;

/* Bo'lim tarkibi (tartib — Figma). "@" bilan boshlanganlar — mijoz tomonidagi qatorlar. */
const LAYOUT: Record<string, string[]> = {
  umumiy: ["site_name", "@theme", "language", "timezone"],
  xavfsizlik: ["session_hours", "public_view"],
  kuzatuv: ["health_interval_s", "stall_after_s", "transport_check_after_s", "ui_poll_s", "notify_outage"],
};
const GROUP_SECTION: Record<string, string> = { "Sayt": "umumiy", "Kirish": "xavfsizlik", "Kuzatuv": "kuzatuv" };

/* Figma matnlari: nom, InfoTip (≤ 120 belgi), meta (bo'sh — standart/oraliq avtomatik). */
const COPY: Record<string, { label?: string; tip?: string; meta?: string | null }> = {
  site_name: { label: "Sayt nomi", tip: "Yon menyu, brauzer sarlavhasi va kirish oynasida koʻrinadigan nom (40 belgigacha).",
    meta: "Yon menyu, brauzer sarlavhasi va kirish oynasida" },
  "@theme": { label: "Mavzu", meta: "Har bir foydalanuvchi uchun alohida saqlanadi" },
  language: { label: "Til", tip: "", meta: "Saytning standart tili · shaxsiy til — profil menyusida" },
  timezone: { label: "Vaqt zonasi", tip: "", meta: "Hisobot va hodisalar vaqti shu boʻyicha" },
  session_hours: { label: "Seans muddati", tip: "Shuncha vaqtdan keyin qaytadan kirish kerak. Yangi kirishlarga qoʻllanadi." },
  public_view: { label: "Mehmon koʻrishi",
    tip: "Kirmagan foydalanuvchi xarita va jonli oqimni koʻradi. Dashboard, guruhlar va boshqaruv yopiq.",
    meta: "Kirmaganlar uchun · faqat koʻrish" },
  health_interval_s: { label: "Holat tekshiruvi oraligʻi",
    tip: "Kameralar RTSP porti qanchalik tez-tez tekshiriladi. Kichik qiymat — uzilish tezroq bilinadi, lekin tarmoqqa yuk koʻproq." },
  stall_after_s: { label: "Tasvir toʻxtashi chegarasi",
    tip: "Ochiq oqimda shuncha vaqt maʼlumot kelmasa — tasvir toʻxtagan hisoblanadi. Juda kichik qiymat soxta ogohlantirish beradi." },
  transport_check_after_s: { label: "Uzatish usulini tekshirish",
    tip: "Oqim shuncha vaqt ochilmasa, TCP va UDP sinab koʻriladi va yaxshisi tanlanadi." },
  ui_poll_s: { label: "Xarita va roʻyxat yangilanishi", tip: "Xarita va kameralar roʻyxati shuncha soniyada bir yangilanadi." },
  notify_outage: { label: "Uzilish haqida bildirishnoma",
    tip: "Kamera uzilgani va qayta ulangani bildirishnomalar roʻyxatida koʻrsatiladi.",
    meta: "Bildirishnomalar roʻyxatida koʻrsatiladi" },
};

const LANG_LABEL: Record<string, string> = { "uz": "Oʻzbekcha (lotin)", "uz-cyrl": "Ўзбекча (кирилл)", "ru": "Русский", "en": "English" };
const TZ: [string, string][] = [
  ["Asia/Tashkent", "Asia/Tashkent (UTC+5)"], ["Asia/Samarkand", "Asia/Samarkand (UTC+5)"],
  ["Asia/Almaty", "Asia/Almaty (UTC+5)"], ["Asia/Dushanbe", "Asia/Dushanbe (UTC+5)"],
  ["Asia/Bishkek", "Asia/Bishkek (UTC+6)"], ["Europe/Moscow", "Europe/Moscow (UTC+3)"], ["UTC", "UTC (UTC+0)"],
];

/* ---------- sof yordamchilar (SettingsPage ham ishlatadi) ---------- */
export function validSetting(s: Setting | undefined, v: unknown): boolean {
  if (!s) return true;
  if (s.kind === "int") return Number.isInteger(v) && (s.min == null || (v as number) >= s.min) && (s.max == null || (v as number) <= s.max);
  if (s.kind === "str") return typeof v === "string" && v.trim().length > 0 && (!s.max || v.trim().length <= s.max);
  return true;
}
/** Qoralamaga yozish: asl qiymatga qaytsa — kalit o'chadi. */
export function nextDraft(draft: Draft, s: Setting, v: unknown): Draft {
  const d = { ...draft };
  if (v === s.value || (typeof v === "string" && typeof s.value === "string" && v.trim() === s.value)) delete d[s.key];
  else d[s.key] = v;
  return d;
}
function fmt(s: Setting, v: unknown) {
  if (s.kind === "bool") return v ? "yoqiq" : "oʻchiq";
  if (s.kind === "choice" && LANG_LABEL[v as string]) return LANG_LABEL[v as string];
  return String(v) + (s.unit ? " " + s.unit : "");
}

/* ---------- komponent ---------- */
export function SiteForm({ section, settings, draft, setDraft }: {
  section: string; settings: Setting[] | undefined; draft: Draft; setDraft: (d: Draft) => void;
}) {
  const t = useT();
  const { lang, setLang } = useI18n();
  const [theme, setTheme] = useTheme();
  const toast = useToast();
  const put = usePutSettings();
  const [busy, setBusy] = useState<Record<string, boolean>>({});   // switch: optimistik qiymat

  if (!settings) {
    return (
      <div className="sx-rows">
        {[0, 1, 2].map((i) => (
          <div className="sx-row" key={i}><div className="sx-row__text">
            <span className="skeleton" style={{ width: 180, height: 14 }} />
            <span className="skeleton" style={{ width: 240, height: 10 }} />
          </div></div>
        ))}
      </div>
    );
  }

  const def = (key: string) => settings.find((s) => s.key === key);
  const cur = (s: Setting) => (s.key in draft ? draft[s.key] : s.key in busy ? busy[s.key] : s.value);
  const set = (s: Setting, v: unknown) => setDraft(nextDraft(draft, s, v));

  const keys = LAYOUT[section].filter((k) => k.startsWith("@") || def(k));
  if (section === "umumiy" && !def("language")) keys.splice(keys.indexOf("@theme") + 1, 0, "@lang");
  const known = new Set(Object.values(LAYOUT).flat());
  settings.forEach((s) => { if (!known.has(s.key) && GROUP_SECTION[s.group] === section) keys.push(s.key); });

  async function toggleNow(s: Setting) {
    if (s.key in busy) return;
    const v = !cur(s);
    setBusy((b) => ({ ...b, [s.key]: v }));
    try {
      await put.mutateAsync({ [s.key]: v });
      toast("Sozlamalar saqlandi");
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    }
    setBusy((b) => { const n = { ...b }; delete n[s.key]; return n; });
  }

  function metaNode(s: Setting): ReactNode {
    const c = COPY[s.key] || {};
    if (s.key in draft) {
      const v = draft[s.key];
      if (!validSetting(s, v)) {
        return <span className="t-error">{t(s.kind === "int" ? "Oraliq " + s.min + "–" + s.max + (s.unit ? " " + s.unit : "")
          : "1–" + (s.max || 40) + " belgi")}</span>;
      }
      return <span className="t-brand">{t("Oʻzgartirildi: " + fmt(s, s.value) + " → " + fmt(s, v))}</span>;
    }
    let m: string;
    if (c.meta === null) m = "";
    else if (c.meta === undefined) {
      m = "Standart: " + fmt(s, s.default) + (s.kind === "int" && s.min != null ? " · oraliq " + s.min + "–" + s.max : "");
    } else m = c.meta;
    const reset = s.changed && s.kind !== "bool" && s.value !== s.default;
    if (!m && !reset) return null;
    return (
      <>
        {m && t(m)}{reset && m ? " · " : ""}
        {reset && <button type="button" className="sx-link" onClick={() => set(s, s.default)}>{t("Standartga qaytarish")}</button>}
      </>
    );
  }

  function langSelect(value: string, onChange: (v: string) => void, choices?: string[] | null) {
    const ids = choices && choices.length ? choices : Object.keys(LANG_LABEL);
    return (
      <select className="select sx-sel240" aria-label={t("Til")} value={value} onChange={(e) => onChange(e.target.value)}>
        {ids.map((id) => <option key={id} value={id}>{LANG_LABEL[id] || id}</option>)}
      </select>
    );
  }

  function row(key: string, label: string, tip: string | null, meta: ReactNode, ctl: ReactNode, opts: { sw?: Setting; dirty?: boolean; bad?: boolean } = {}) {
    const onRow = opts.sw ? (e: React.MouseEvent) => {
      const tg = e.target as HTMLElement;
      if (tg.closest(".infotip") || tg.closest(".switch")) return;   // InfoTip bundan mustasno
      toggleNow(opts.sw!);
    } : undefined;
    return (
      <div key={key} data-row={key} onClick={onRow}
        className={cx("sx-row", opts.dirty && "sx-row--dirty", opts.bad && "sx-row--error", opts.sw && "sx-row--switch")}>
        <div className="sx-row__text">
          <div className="sx-row__title"><span className="label-md">{t(label)}</span>{tip && <InfoTip text={tip} />}</div>
          {meta != null && meta !== "" && <div className="sx-row__meta body-xs">{meta}</div>}
        </div>
        <div className="sx-row__ctl">{ctl}</div>
      </div>
    );
  }

  const rows = keys.map((key) => {
    const c = COPY[key] || {};
    if (key === "@theme") {
      return row(key, c.label!, null, t(c.meta!),
        <div className="seg sx-seg" role="radiogroup" aria-label={t("Mavzu")}>
          {THEMES.map((th) => (
            <button key={th.id} type="button" role="radio" aria-checked={theme === th.id}
              className={theme === th.id ? "is-on" : undefined} onClick={() => setTheme(th.id)}>{t(th.label)}</button>
          ))}
        </div>);
    }
    if (key === "@lang") return row(key, "Til", null, null, langSelect(lang, (v) => setLang(v as LangId)));

    const s = def(key)!;
    const label = c.label || s.label;
    const tip = "tip" in c ? c.tip! : s.help && s.help.length > 120 ? s.help.slice(0, 117) + "…" : s.help || "";
    const v = cur(s);
    const dirty = s.key in draft;
    const bad = dirty && !validSetting(s, draft[s.key]);
    let ctl: ReactNode;
    if (s.kind === "bool") {
      ctl = <button type="button" className="switch" role="switch" aria-checked={!!v} aria-label={t(label)}
        disabled={s.key in busy} onClick={() => toggleNow(s)} />;
    } else if (s.kind === "int") {
      ctl = (
        <label className="sx-num">
          <input className="input" type="number" inputMode="numeric" aria-label={t(label)}
            value={typeof v === "number" && !isNaN(v) ? String(v) : ""}
            min={s.min ?? undefined} max={s.max ?? undefined}
            onChange={(e) => set(s, e.target.value === "" ? NaN : Number(e.target.value))} />
          {s.unit && <span className="sx-num__u">{t(s.unit)}</span>}
        </label>
      );
    } else if (s.key === "language" || (s.kind === "choice" && (s.choices || []).every((x) => LANG_LABEL[x]))) {
      ctl = langSelect(String(v), (nv) => set(s, nv), s.choices);
    } else if (s.kind === "choice") {
      ctl = (
        <select className="select sx-sel240" aria-label={t(label)} value={String(v)} onChange={(e) => set(s, e.target.value)}>
          {(s.choices || []).map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      );
    } else if (s.key === "timezone") {
      const list = TZ.some(([id]) => id === v) ? TZ : [[String(v), String(v)] as [string, string], ...TZ];
      ctl = (
        <select className="select sx-sel240" aria-label={t("Vaqt zonasi")} value={String(v)} onChange={(e) => set(s, e.target.value)}>
          {list.map(([id, txt]) => <option key={id} value={id}>{txt}</option>)}
        </select>
      );
    } else {
      ctl = <input className="input sx-text" value={String(v ?? "")} maxLength={s.max || undefined} aria-label={t(label)}
        onChange={(e) => set(s, e.target.value)} />;
    }
    return row(key, label, tip, metaNode(s), ctl, { sw: s.kind === "bool" ? s : undefined, dirty, bad });
  });

  return <div className="sx-rows">{rows}</div>;
}
