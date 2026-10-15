/* pages/settings/logFilter.ts — Tizim jurnali filtri: toifalar ro'yxati (CATEGORIES), filtr turi va
   boshlang'ich qiymati (LOG_FILTER0). Holat SettingsPage'da, ko'rinish — LogsSection.tsx. */
export const CATEGORIES: [string, string][] = [["camera", "Kamera"], ["app", "Ilova"], ["mediamtx", "MediaMTX"], ["security", "Xavfsizlik"],
  ["database", "Baza"], ["stats", "Statistika"], ["access", "HTTP soʻrovlar"], ["errors", "Barcha xatolar"]];

export interface LogFilter { cat: string; hours: string; level: string; q: string }
export const LOG_FILTER0: LogFilter = { cat: "camera", hours: "24", level: "", q: "" };
