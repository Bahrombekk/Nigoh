/* i18n/i18nContext.ts — til konteksti: LangId, LANG_LIST, I18nCtx, useI18n() va useT().
   Provayder (tanlov, lug'at yuklash) — I18nProvider.tsx da. */
import { createContext, useContext } from "react";
import { LANGS } from "./core.js";

export type LangId = "uz" | "uz-cyrl" | "ru" | "en";
export const LANG_LIST = LANGS as { id: LangId; label: string; html: string }[];

export interface Ctx {
  lang: LangId;
  setLang: (l: LangId) => void;
  setSiteLang: (l: string | undefined) => void;
  t: (s: string) => string;
  tShort: (s: string) => string;
}
export const I18nCtx = createContext<Ctx | null>(null);

export function useI18n(): Ctx {
  const c = useContext(I18nCtx);
  if (!c) throw new Error("I18nProvider yo'q");
  return c;
}
export function useT() { return useI18n().t; }
