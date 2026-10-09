/* pages/admin/queries.ts — Boshqaruv so'rovlari (TanStack Query).
   ADMIN_KEY ["admin-cameras", …] — jadval (server rejimi: sahifa; eski backend / brauzer
   filtrlari: butun ro'yxat). O'zgartirishdan keyin invalidateAdmin(qc) — jadval + xarita ro'yxati.
   useVendors — /api/vendors; useRegionList — /api/admin/regions + kameralardagi hududlar. */
import { useMemo } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { qk, useCameras } from "@/data/queries";
import type { AdminCamera, AdminList, Vendor } from "./util";

export const ADMIN_KEY = ["admin-cameras"] as const;

export function invalidateAdmin(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ADMIN_KEY });
  qc.invalidateQueries({ queryKey: qk.cameras });
}

/** Eski backend / brauzer filtrlari: butun ro'yxat (500 talab). */
export async function fetchAllAdmin(): Promise<AdminCamera[]> {
  const out: AdminCamera[] = [];
  let total = Infinity;
  for (let off = 0; off < total; off += 500) {
    const res = await api<AdminList>("/api/admin/cameras?limit=500&offset=" + off);
    total = res.total || 0;
    out.push(...(res.cameras || []));
    if (!res.cameras || !res.cameras.length) break;
  }
  return out;
}

export function useVendors(enabled = true) {
  return useQuery({
    queryKey: ["vendors"],
    queryFn: () => api<Vendor[]>("/api/vendors"),
    staleTime: Infinity,
    enabled,
    retry: false,
  });
}

export function useRegionList(enabled = true): string[] {
  const q = useQuery({
    queryKey: ["admin-regions"],
    queryFn: async () => {
      try {
        const r = await api<{ regions?: (string | { name?: string; title?: string })[] }>("/api/admin/regions");
        return (r.regions || []).map((x) => (typeof x === "string" ? x : x.name || x.title || "")).filter(Boolean);
      } catch { return [] as string[]; }
    },
    staleTime: Infinity,
    enabled,
  });
  const { cameras } = useCameras(enabled);
  return useMemo(() => {
    const set = new Set(q.data || []);
    cameras.forEach((c) => { if (c.region) set.add(c.region); });
    return [...set].sort((a, b) => a.localeCompare(b, "uz"));
  }, [q.data, cameras]);
}
