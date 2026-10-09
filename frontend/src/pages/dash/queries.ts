/* pages/dash/queries.ts — Statistika so'rovlari (TanStack Query), docs/STATS_API.md.
   Har endpoint — alohida hook; kalit ["stats", url] (url ichida davr: days=N), shuning uchun davr
   almashsa yangi so'rov, eski javob esa yangisi kelguncha ko'rinib turadi (v3 dagidek — karta
   bo'shab qolmaydi). Davr ma'lumoti 55 s yangi hisoblanadi va har 60 s qayta so'raladi (server 60 s
   keshlaydi), lenta va tizim holati — 30 s. Xato bo'lsa qayta urinmaydi: karta Alert + "Qayta
   urinish" ko'rsatadi (common.useRetry → ["stats"] bekor qilinadi). */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { p2 } from "./common";

export type Days = 1 | 7 | 30;

function useStat<T>(url: string | null, opts: { every?: number; stale?: number } = {}) {
  return useQuery<T, ApiError>({
    queryKey: ["stats", url],
    queryFn: () => api<T>(url!),
    enabled: !!url,
    staleTime: opts.stale ?? 55_000,
    refetchInterval: opts.every ?? 60_000,
    refetchIntervalInBackground: false,
    retry: false,
    placeholderData: keepPreviousData,
  });
}

/* ---------- Javob shakllari ---------- */
export type StateCounts = { online?: number; stalled?: number; offline?: number; unknown?: number; disabled?: number };

export interface Summary {
  at: string; total: number; by_state: StateCounts; measured: number; online_pct: number | null;
  previous?: { at: string; measured: number; online: number; online_pct: number | null; by_state?: StateCounts } | null;
}
export interface Availability {
  from: string; to: string; days: number; cameras: number;
  coverage_pct: number | null; uptime_pct: number | null;
  camera_hours_observed: number; camera_hours_offline: number; never_down: number;
  distribution: { band: string; cameras: number }[];
  previous?: Availability | null;
}
export interface OutageItem {
  camera_id: number; name: string; region?: string | null; km?: number | null; picket?: number | null;
  start: string; end: string | null; open: boolean; seconds: number; kind: string;
}
export interface OutageSummary {
  outages: number; blips: number; blip_threshold_s: number; stalls?: number; open_now: number;
  affected_cameras: number; offline_camera_hours: number | null;
  mttr?: { median_s: number | null; p90_s: number | null; mean_s: number | null; recovered: number } | null;
  mtbf_s: number | null; longest: OutageItem | null;
  previous?: { outages: number | null } | null;
}
export interface Hourly {
  outages: number[]; blips: number[]; offline_camera_minutes?: number[];
  peak: { from_hour: number; to_hour: number; outages: number } | null;
}
export interface DailyDay { date: string; coverage_pct: number | null; uptime_pct: number | null; outages: number; blips: number; offline_camera_hours: number | null }
export interface Daily { days: DailyDay[] }
export interface SeriesPoint { t: number; pct: number; online: number; total: number }
export interface Region {
  region: string; admin_area_id: number | null; cameras: number; now: StateCounts;
  online_now_pct: number | null; uptime_pct: number | null; outages: number; blips: number; offline_hours: number | null;
}
export interface Regions { regions: Region[] }
export interface Sla {
  goal_pct: number; observed_slots: number; in_goal_slots: number; in_goal_pct: number | null;
  below_goal_seconds: number; deficit_camera_hours: number; avg_pct: number | null;
  worst: { ts: string; pct: number } | null;
}
export interface FeedItem {
  id?: number; ts: string; camera_id: number; name: string; region?: string | null;
  km?: number | null; picket?: number | null; kind: "online" | "offline" | "open"; ms?: number;
}
export interface Feed { items: FeedItem[]; next_before_id?: number | null }
export interface RankItem {
  id: number; name: string; region?: string | null; km?: number | null; picket?: number | null;
  uptime_pct: number | null; offline_seconds: number; outages: number; blips: number; stalls: number;
  last_offline_at?: string | null; state?: "online" | "stalled" | "offline" | "disabled" | "unknown";
}
export interface Ranking { by: string; total: number; items: RankItem[] }
export interface Outages { total: number; items: OutageItem[] }
export interface Heatmap { rows: { key: number | string; days?: number; hours: (number | null)[] | null; coverage_pct?: number }[] }
export interface Coverage { pct: number | null; observed_hours: number; missing_hours: number; gaps: { from: string; to: string; hours: number }[] }
export interface VendorRow {
  cameras: number; now: StateCounts; online_now_pct: number | null; uptime_pct: number | null;
  outages: number; blips: number; stalls?: number; offline_hours: number | null;
  outages_per_camera: number | null; mttr_median_s: number | null;
}
export interface Vendor extends VendorRow {
  vendor: string; codecs?: Record<string, number>; transcode?: number; udp?: number; no_model?: number;
  models?: (VendorRow & { model: string | null })[];
}
export interface Vendors { vendors: Vendor[] }
export interface QualityCheck { count: number; items: { id: number; name: string; region?: string | null; detail?: string }[] }
export type Quality = Record<string, QualityCheck | undefined>;
export interface OpenMetrics {
  p50_ms: number; p95_ms?: number | null; opens: number;
  items: { camera_id?: number; id?: number; name: string; median_ms: number; last_ms: number; max_ms?: number; n: number; transport?: string }[];
}
export interface HealthInfo {
  mediamtx?: boolean; streams?: number | null; readers?: number | null;
  egress_mbps?: number | null; egress_capacity_mbps?: number | null;
  snapshots?: { ok: number; total: number };
  health?: { at?: string; checked?: number; online?: number; latency_ms?: number | null };
}
export interface SysState {
  state: string; label?: string; checked_at?: string;
  services: { key: string; name: string; state: string; detail?: string }[];
}

/* ---------- Hook'lar ---------- */
export const useSummary = (days?: Days) =>
  useStat<Summary>("/api/stats/summary?compare=1" + (days ? "&days=" + days : ""));
export const useAvailability = (days: Days) => useStat<Availability>("/api/stats/availability?days=" + days + "&compare=1");
export const useOutageSummary = (days: Days) => useStat<OutageSummary>("/api/stats/outages/summary?days=" + days);
export const useHourly = (days: Days, enabled = true) => useStat<Hourly>(enabled ? "/api/stats/hourly?days=" + days : null);
export const useHourlyDay = (d: Date | null) =>
  useStat<Hourly>(d ? "/api/stats/hourly?day=" + d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) : null);
export const useDaily = (days: number, enabled = true) => useStat<Daily>(enabled ? "/api/stats/daily?days=" + days : null);
export const useRegions = (days: Days) => useStat<Regions>("/api/stats/regions?days=" + days);
export const useSla = (days: Days, step?: "5m" | "hour") =>
  useStat<Sla>("/api/stats/sla?days=" + days + "&goal=95" + (step ? "&step=" + step : ""));
export const useOpenOutages = () => useStat<Outages>("/api/stats/outages?open_only=true&days=30&sort=duration&limit=500");
export const useLongest = (days: Days) => useStat<Outages>("/api/stats/outages?days=" + days + "&sort=duration&limit=20");
export const useFeed = () => useStat<Feed>("/api/stats/feed?limit=14", { every: 30_000, stale: 15_000 });
export const useRanking = (days: Days, by: string, limit: number, enabled = true) =>
  useStat<Ranking>(enabled ? "/api/stats/ranking?days=" + days + "&by=" + by + "&limit=" + limit : null);
export const useHeatmap = (days: number) => useStat<Heatmap>("/api/stats/heatmap?mode=weekday&days=" + days);
export const useCoverage = (days: Days) => useStat<Coverage>("/api/stats/coverage?days=" + days + "&min_gap_minutes=60");
export const useVendors = (days: Days) => useStat<Vendors>("/api/stats/vendors?days=" + days);
export const useQuality = () => useStat<Quality>("/api/stats/quality");
export const useOpenMetrics = () => useStat<OpenMetrics>("/api/metrics/open?limit=12", { every: 30_000, stale: 20_000 });

/** Tizim holati: v3 — /api/system/state (404 bo'lsa null); /health — qo'shimcha server yuklamasi. */
export function useSystemInfo() {
  const st = useQuery<SysState | null, ApiError>({
    queryKey: ["stats", "/api/system/state"],
    queryFn: () => api<SysState>("/api/system/state").catch((e) => {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }),
    staleTime: 25_000, refetchInterval: 30_000, retry: false,
  });
  const hl = useQuery<HealthInfo | null, ApiError>({
    queryKey: ["stats", "/health"],
    queryFn: () => api<HealthInfo>("/health").catch(() => null),
    staleTime: 25_000, refetchInterval: 30_000, retry: false,
  });
  return { st, hl };
}

/** Onlaynlik qatori davrga ko'ra: Bugun — 5 daq, 7 kun — soatlik, 30 kun — 6 soatlik.
    Eski backend `step=6h` ni bilmaydi (422/400) — soatlik olib, shu yerda 6 soatga yig'iladi. */
export function useSeries(days: Days) {
  return useQuery<SeriesPoint[], ApiError>({
    queryKey: ["stats", "series", days],
    queryFn: () => loadSeries(days),
    staleTime: 55_000, refetchInterval: 60_000, retry: false,
    placeholderData: keepPreviousData,
  });
}
type RawSeries = { points?: { ts: string; online: number; total: number; pct: number | null }[] };
const pts = (j: RawSeries): SeriesPoint[] => (j.points || []).filter((p) => p.total > 0)
  .map((p) => ({ t: Date.parse(p.ts), pct: p.pct != null ? p.pct : (p.online / p.total) * 100, online: p.online, total: p.total }));
async function loadSeries(days: Days): Promise<SeriesPoint[]> {
  if (days <= 1) return pts(await api<RawSeries>("/api/stats/series?days=1&step=5m"));
  if (days <= 7) return pts(await api<RawSeries>("/api/stats/series?days=" + days + "&step=hour"));
  try {
    return pts(await api<RawSeries>("/api/stats/series?days=" + days + "&step=6h"));
  } catch (e) {
    if (!(e instanceof ApiError) || (e.status !== 422 && e.status !== 400)) throw e;
    const hourly = pts(await api<RawSeries>("/api/stats/series?days=" + days + "&step=hour"));
    const buckets = new Map<number, { t: number; on: number; tot: number; n: number }>();
    hourly.forEach((p) => {
      const d = new Date(p.t);
      d.setHours(Math.floor(d.getHours() / 6) * 6, 0, 0, 0);
      const k = d.getTime();
      const b = buckets.get(k) || { t: k, on: 0, tot: 0, n: 0 };
      b.on += p.online; b.tot += p.total; b.n++;
      buckets.set(k, b);
    });
    return [...buckets.values()].sort((a, b) => a.t - b.t)
      .map((b) => ({ t: b.t, online: b.on / b.n, total: b.tot / b.n, pct: (b.on / b.tot) * 100 }));
  }
}

/** Kartaga qulay: ma'lumot (xato bo'lsa null), xato, birinchi yuklanish. */
export function view<T>(q: { data?: T; error: ApiError | null; isPending: boolean }) {
  return { d: q.error ? null : q.data ?? null, err: q.error, pending: q.isPending };
}
