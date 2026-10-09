/* pages/wall/queries.ts — Video devor so'rovlari.
   useGroups()      — GET /api/groups (kirganlar uchun; mehmonda 401 → bo'sh ro'yxat)
   useFocusKpis(id) — Fokus KPI: /api/metrics/open?camera_id=, /api/stats/cameras/{id}?days=7 va ?from=bugun.
                      Endpoint 404/409 bersa — null ("—"), UI buzilmaydi. */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { p2 } from "@/lib/format";

export interface Group {
  id: number;
  name: string;
  camera_ids: number[];
  color?: string;
  [key: string]: unknown;
}

export function useGroups(enabled: boolean) {
  return useQuery({
    queryKey: ["groups", "wall"],
    queryFn: async () => {
      const r = await api<{ groups?: Group[] } | Group[]>("/api/groups");
      return Array.isArray(r) ? r : r.groups || [];
    },
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

const todayIso = () => { const d = new Date(); return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); };

interface OpenItem { camera_id?: number; median_ms?: number | null; p50_ms?: number | null; last_ms?: number | null }
interface OpenResp extends OpenItem { items?: OpenItem[] }

export interface FocusKpis { server: number | null; uptime: number | null; outages: number | null }

export function useFocusKpis(id: number | null) {
  return useQuery({
    queryKey: ["wall", "focus-kpis", id],
    enabled: id != null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    queryFn: async (): Promise<FocusKpis> => {
      const get = <T,>(p: string) => api<T>(p).catch(() => null);
      const [open, week, today] = await Promise.all([
        get<OpenResp>("/api/metrics/open?camera_id=" + id + "&limit=200"),
        get<{ uptime_pct?: number | null }>("/api/stats/cameras/" + id + "?days=7"),
        get<{ outages?: number | null }>("/api/stats/cameras/" + id + "?from=" + todayIso()),
      ]);
      // Yangi server: {camera_id, median_ms, last_ms, ...}; eski: {items: [...]}.
      let srv: number | null = null;
      if (open) {
        const it = open.camera_id === id ? open : (open.items || []).find((x) => x.camera_id === id);
        if (it) srv = it.median_ms ?? it.p50_ms ?? it.last_ms ?? null;
      }
      return { server: srv, uptime: week ? week.uptime_pct ?? null : null, outages: today ? today.outages ?? null : null };
    },
  });
}
