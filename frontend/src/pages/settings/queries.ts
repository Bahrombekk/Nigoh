/* pages/settings/queries.ts — Sozlamalar sahifasi so'rovlari (TanStack Query).
   Backend (docs/V3_API.md §6–8):
     GET/PUT /api/admin/settings ({values})            — useSiteSettings, usePutSettings
     GET/POST /api/admin/users, PUT/DELETE /api/admin/users/{id},
     POST /api/admin/users/{id}/reset-password           — useUsers, useRegions
     GET /api/groups, PATCH/DELETE /api/groups/{id},
     POST /api/groups, POST /api/groups/{id}/cameras      — useGroups, groupsApi
     GET /api/admin/status, /api/admin/db, /api/system/state — useSystemStatus
     GET /api/admin/logs, /api/admin/logs/summary, /api/admin/audit */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/data/queries";
import type { Role } from "@/lib/types";

/* ---------- Sayt sozlamalari ---------- */
export interface Setting {
  key: string; group: string; label: string; help: string;
  kind: "int" | "bool" | "str" | "choice";
  min: number | null; max: number | null; unit: string; choices: string[] | null;
  value: unknown; default: unknown; changed: boolean;
}
export const sk = {
  settings: ["admin-settings"] as const,
  users: ["admin-users"] as const,
  regions: ["admin-regions"] as const,
  groups: ["sx-groups"] as const,   // boshqa sahifalarning ["groups"] kaliti bilan shakl to'qnashmasin
  status: ["admin-status"] as const,
  logs: (p: string) => ["admin-logs", p] as const,
  summary: (h: number) => ["admin-logs-summary", h] as const,
  audit: ["admin-audit"] as const,
};

export function useSiteSettings() {
  return useQuery({
    queryKey: sk.settings,
    queryFn: async () => (await api<{ settings: Setting[] }>("/api/admin/settings")).settings || [],
    staleTime: 30_000,
  });
}

export function usePutSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      api<{ settings?: Setting[] }>("/api/admin/settings", { method: "PUT", body: { values } }),
    onSuccess: (res) => {
      if (res && res.settings) qc.setQueryData(sk.settings, res.settings);
      // Sayt nomi, standart til, yangilanish oralig'i — /auth/me orqali hamma joyga.
      qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}

/* ---------- Foydalanuvchilar ---------- */
export interface AdminUser {
  id: number; username: string; role: Role; full_name: string; is_active: boolean;
  created_at?: string; last_login_at: string | null; regions: string[];
}
export function useUsers() {
  return useQuery({
    queryKey: sk.users,
    queryFn: async () => (await api<{ users: AdminUser[] }>("/api/admin/users")).users || [],
  });
}
export function useRegions() {
  return useQuery({
    queryKey: sk.regions,
    queryFn: async () => {
      try {
        const r = await api<{ regions: ({ name: string } | string)[] }>("/api/admin/regions");
        return (r.regions || []).map((x) => (typeof x === "string" ? x : x.name));
      } catch { return [] as string[]; }
    },
    staleTime: 5 * 60_000,
  });
}

export interface UserBody {
  username: string; full_name: string; role: Role; is_active: boolean; regions: string[]; password?: string;
}
export const usersApi = {
  create: (b: UserBody) => api("/api/admin/users", { method: "POST", body: b }),
  update: (id: number, b: UserBody) => api("/api/admin/users/" + id, { method: "PUT", body: b }),
  remove: (id: number) => api("/api/admin/users/" + id, { method: "DELETE" }),
  /** Yangi backend: server parol yaratadi. Eski (404/405): o'zimiz yaratib PUT bilan qo'yamiz. */
  async resetPassword(u: AdminUser, gen: () => string): Promise<string> {
    try {
      return (await api<{ password: string }>("/api/admin/users/" + u.id + "/reset-password", { method: "POST" })).password;
    } catch (e) {
      if (!(e instanceof ApiError) || (e.status !== 404 && e.status !== 405)) throw e;
      const pass = gen();
      await api("/api/admin/users/" + u.id, { method: "PUT", body: {
        username: u.username, full_name: u.full_name, role: u.role, regions: u.regions, is_active: u.is_active, password: pass } });
      return pass;
    }
  },
};

/* ---------- Kamera guruhlari ---------- */
export interface Group {
  id: number; name: string; color: string; shared: boolean; owner_name: string; mine: boolean;
  can_edit: boolean; camera_ids: number[]; hidden: number; updated_at?: string;
}
export function useGroups() {
  return useQuery({
    queryKey: sk.groups,
    queryFn: async () => (await api<{ groups: Group[] }>("/api/groups")).groups || [],
  });
}
export const groupsApi = {
  patch: (id: number, b: Partial<Pick<Group, "name" | "color" | "shared">>) =>
    api<Group>("/api/groups/" + id, { method: "PATCH", body: b }),
  remove: (id: number) => api("/api/groups/" + id, { method: "DELETE" }),
  create: (b: { name: string; color: string; shared: boolean; camera_ids: number[] }) =>
    api<Group>("/api/groups", { method: "POST", body: b }),
  setCameras: (id: number, ids: number[]) =>
    api<Group>("/api/groups/" + id + "/cameras", { method: "POST", body: { camera_ids: ids, mode: "set" } }),
};
/** Guruhni keshda almashtirish/qo'shish (v3 groupStore.replace). */
export function useGroupCache() {
  const qc = useQueryClient();
  const others = () => qc.invalidateQueries({ queryKey: ["groups"] });
  return {
    others,
    replace: (g: Group) => qc.setQueryData<Group[]>(sk.groups, (l = []) =>
      l.some((x) => x.id === g.id) ? l.map((x) => (x.id === g.id ? g : x)) : [g, ...l]),
    drop: (id: number) => qc.setQueryData<Group[]>(sk.groups, (l = []) => l.filter((x) => x.id !== id)),
  };
}

/* ---------- Tizim holati ---------- */
export interface AdminStatus {
  version?: string;
  update?: { current?: string; latest?: string | null } | null;
  mediamtx?: boolean | { ok?: boolean; available?: boolean; uptime_s?: number | null } | null;
  mediamtx_uptime_s?: number | null;
  health?: { checked?: number; online?: number; at?: string | null };
  network?: { latency_ms?: number | null };
  disk?: { db_mb?: number };
  stalled?: unknown[];
  nodes?: { status?: string; ready?: number }[];
}
export interface DbInfo { server_version?: string; up_to_date?: boolean; size_bytes?: number | null; tables?: unknown[] }
export interface SysState { services?: { key: string; state: "ok" | "warn" | "error"; detail?: string }[] }

let noState = false;   // eski backend: /api/system/state yo'q — qayta so'ralmaydi
export interface StatusBundle { st: AdminStatus | null; db: DbInfo | null; sys: SysState | null; err: string | null }
export function useSystemStatus(enabled: boolean) {
  return useQuery({
    queryKey: sk.status,
    enabled,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<StatusBundle> => {
      let err: string | null = null;
      const [st, db, sys] = await Promise.all([
        api<AdminStatus>("/api/admin/status").catch((e: Error) => { err = e.message; return null; }),
        api<DbInfo>("/api/admin/db").catch(() => null),
        noState ? null : api<SysState>("/api/system/state").catch((e) => {
          if (e instanceof ApiError && e.status === 404) noState = true;
          return null;
        }),
      ]);
      return { st, db, sys, err };
    },
  });
}

/* ---------- Loglar va jurnal ---------- */
export type LogItem = Record<string, unknown> & { ts?: string; level?: string; category?: string; service?: string; event?: string; msg?: string; message?: string };
export interface LogsRes { items: LogItem[]; count: number; limit: number }
export interface LogsSummary { categories?: Record<string, Record<string, number>> }
export interface AuditItem {
  id: number; ts: string; actor: string; action: string; entity?: string; entity_id?: string | null;
  before: Record<string, unknown> | null; after: Record<string, unknown> | null; ip?: string | null;
}
export function useAudit(enabled: boolean) {
  return useQuery({
    queryKey: sk.audit,
    enabled,
    queryFn: async () => (await api<{ items: AuditItem[] }>("/api/admin/audit?limit=100")).items || [],
  });
}
