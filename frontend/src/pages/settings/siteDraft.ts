/* pages/settings/siteDraft.ts — sayt sozlamalari qoralamasi uchun sof yordamchilar (SiteForm va SettingsPage):
   FORM_SECTIONS (shakl bo'limlari), Draft turi, validSetting (qiymat to'g'rimi), nextDraft (qoralamaga yozish). */
import type { Setting } from "./queries";

export const FORM_SECTIONS = ["umumiy", "xavfsizlik", "kuzatuv"];
export type Draft = Record<string, unknown>;

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
