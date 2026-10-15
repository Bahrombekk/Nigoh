/* i18n/I18nProvider.tsx — interfeys tili (uz manba; uz-cyrl, ru, en).
   Tanlov: prefs.lang (shaxsiy) → sayt standarti (me.language) → "uz".
   Komponentlarda: const t = useT(); <span>{t("Saqlash")}</span>
   Rail yorlig'i uchun qisqa shakl: tShort(uz). */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { SHORT, langReady, loadLang, setCurrentLang, translate } from "./core.js";
import { prefs, usePref } from "@/lib/prefs";
import { I18nCtx, LANG_LIST, type Ctx, type LangId } from "./i18nContext";

function valid(l: unknown): LangId | null {
  return LANG_LIST.some((x) => x.id === l) ? (l as LangId) : null;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [own] = usePref<string | null>("lang", null);
  const [site, setSite] = useState<LangId>("uz");
  const lang: LangId = valid(own) || site;
  // Lug'at (ru/en) kerak bo'lganda yuklanadi; tayyor bo'lgach t() yangilanadi.
  const [, setDictVer] = useState(0);
  const ready = langReady(lang);

  // Modul darajasidagi joriy til (sana nomlari, translate standarti) — render vaqtida.
  setCurrentLang(lang);
  useEffect(() => {
    document.documentElement.lang = LANG_LIST.find((x) => x.id === lang)?.html || "uz";
    if (!langReady(lang)) loadLang(lang).then(() => setDictVer((v) => v + 1)).catch(() => {});
  }, [lang]);

  const t = useCallback((s: string) => (lang === "uz" || s == null ? s : translate(s, lang)), [lang, ready]); // eslint-disable-line react-hooks/exhaustive-deps
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
