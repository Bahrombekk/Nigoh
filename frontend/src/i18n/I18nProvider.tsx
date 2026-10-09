/* i18n/I18nProvider.tsx — interfeys tili (uz manba; uz-cyrl, ru, en).
   Tanlov: prefs.lang (shaxsiy) → sayt standarti (me.language) → "uz".
   Komponentlarda: const t = useT(); <span>{t("Saqlash")}</span>
   Rail yorlig'i uchun qisqa shakl: tShort(uz). */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LANGS, SHORT, setCurrentLang, translate } from "./core.js";
import { prefs, usePref } from "@/lib/prefs";

export type LangId = "uz" | "uz-cyrl" | "ru" | "en";
export const LANG_LIST = LANGS as { id: LangId; label: string; html: string }[];

interface Ctx {
  lang: LangId;
  setLang: (l: LangId) => void;
  setSiteLang: (l: string | undefined) => void;
  t: (s: string) => string;
  tShort: (s: string) => string;
}
const I18nCtx = createContext<Ctx | null>(null);

function valid(l: unknown): LangId | null {
  return LANG_LIST.some((x) => x.id === l) ? (l as LangId) : null;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [own] = usePref<string | null>("lang", null);
  const [site, setSite] = useState<LangId>("uz");
  const lang: LangId = valid(own) || site;

  // Modul darajasidagi joriy til (sana nomlari, translate standarti) — render vaqtida.
  setCurrentLang(lang);
  useEffect(() => {
    document.documentElement.lang = LANG_LIST.find((x) => x.id === lang)?.html || "uz";
  }, [lang]);

  const t = useCallback((s: string) => (lang === "uz" || s == null ? s : translate(s, lang)), [lang]);
  const tShort = useCallback((s: string) => {
    const sh = (SHORT as Record<string, Record<string, string>>)[lang];
    return (sh && sh[s]) || t(s);
  }, [lang, t]);

  const value = useMemo<Ctx>(() => ({
    lang,
    setLang: (l) => prefs.set("lang", l),
    setSiteLang: (l) => setSite(valid(l) || "uz"),
    t, tShort,
  }), [lang, t, tShort]);

  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n(): Ctx {
  const c = useContext(I18nCtx);
  if (!c) throw new Error("I18nProvider yo'q");
  return c;
}
export function useT() { return useI18n().t; }
